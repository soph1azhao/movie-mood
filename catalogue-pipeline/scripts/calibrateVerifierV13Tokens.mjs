import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const V13_EXPERIMENT_DIR = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay')
export const V13_TOKEN_MANIFEST_PATH = path.join(V13_EXPERIMENT_DIR, 'verifier-v1.3-tokencounts.v1.json')
export const V13_CANDIDATE_PROMPT_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md')
export const V13_CANDIDATE_SCHEMA_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json')
export const COHORT_MANIFEST_PATH = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json')

export const CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN = 'AUTHORIZE_COUNT_TOKENS_CALIBRATION'

export const AUTHORIZED_SURFACES = Object.freeze([
  'facts',
  'acceptedSemanticClassification',
  'semanticBoundaryFlags',
  'allowedSourceMaterial',
  'spoilerBoundaryRules',
  'copyConstraints',
  'visibleEditorialCopy',
])

export const FORBIDDEN_LEAKAGE_KEYS = Object.freeze([
  'humanDecision',
  'decision',
  'humanSeverity',
  'severity',
  'humanReason',
  'affectedFields',
  'effectiveAffectedFields',
  'analystAnnotations',
  'auditMembership',
  'retrospectiveDefectTaxonomy',
  'verifierGapAnnotations',
  'optionBAdjudicationLabels',
  'expectedAnswer',
  'severeCaseLabels',
  'auditSampleStatus',
  'candidateId',
  'tmdbId',
])

function sha256Bytes(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`
}

export function scanForForbiddenKeys(obj, path = '') {
  const forbiddenFound = []
  if (!obj || typeof obj !== 'object') return forbiddenFound

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_LEAKAGE_KEYS.includes(key)) {
      forbiddenFound.push({ key, path: currentPath })
    }
    if (value && typeof value === 'object') {
      forbiddenFound.push(...scanForForbiddenKeys(value, currentPath))
    }
  }

  return forbiddenFound
}

export function buildVerifierV13ReplayPacket(riskInput) {
  if (!riskInput || typeof riskInput !== 'object') {
    throw new Error('riskInput must be an object.')
  }

  const packet = {}
  for (const surface of AUTHORIZED_SURFACES) {
    if (riskInput[surface] === undefined) {
      throw new Error(`Missing authorized surface: '${surface}'`)
    }
    packet[surface] = riskInput[surface]
  }

  const leakage = scanForForbiddenKeys(packet)
  if (leakage.length > 0) {
    const err = new Error(`Input leakage detected in model-visible packet: ${leakage.map((l) => l.path).join(', ')}. STOP_INPUT_LEAKAGE`)
    err.code = 'STOP_INPUT_LEAKAGE'
    err.leakage = leakage
    throw err
  }

  return packet
}

export function buildCandidateV13GeminiRequest({
  promptText,
  packet,
  schema,
  modelId = 'gemini-3.8-flash',
  thinkingLevel = 'medium',
  temperature = 0.0,
  maxOutputTokens = 6144,
}) {
  const canonicalInput = serializeArtifactForPersistence(packet)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`

  const body = {
    systemInstruction: { parts: [{ text: promptText }] },
    contents: [{ role: 'user', parts: [{ text: canonicalInput }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel },
      temperature,
    },
  }

  const completeRequestString = serializeArtifactForPersistence({ endpoint, body })
  const requestHash = `sha256:${createHash('sha256').update(completeRequestString).digest('hex')}`

  return {
    endpoint,
    requestMetadata: {
      modelId,
      thinkingLevel,
      temperature,
      maxOutputTokens,
      promptRawByteHash: sha256Bytes(Buffer.from(promptText, 'utf8')),
      packetCanonicalByteHash: sha256Bytes(Buffer.from(canonicalInput, 'utf8')),
      requestHash,
    },
    body,
  }
}

export function verifyCalibrationAuthorization({ env = process.env } = {}) {
  const token = env.CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION
  if (token === CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN) {
    return {
      authorized: true,
      token,
    }
  }
  return {
    authorized: false,
    reason: 'CALIBRATION_NOT_AUTHORIZED',
    detail: `Explicit environment variable CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION=${CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN} is required.`,
  }
}

/**
 * Runs networked tokenizer calibration pass across all 30 development records.
 * Makes ZERO generation calls.
 * Fails closed unless separately explicitly authorized.
 */
export async function runVerifierV13TokenizerCalibration({
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot: root = repoRoot,
  tokenManifestPath = V13_TOKEN_MANIFEST_PATH,
  nowIso = new Date().toISOString(),
} = {}) {
  const auth = verifyCalibrationAuthorization({ env })
  if (!auth.authorized) {
    return {
      ok: false,
      status: 'CALIBRATION_BLOCKED',
      reason: auth.reason,
      detail: auth.detail,
      networkCallsAttempted: 0,
    }
  }

  const apiKey = env.GEMINI_API_KEY
  if (!apiKey || apiKey.trim() === '') {
    return {
      ok: false,
      status: 'MISSING_API_KEY',
      detail: 'GEMINI_API_KEY is required for countTokens calibration.',
      networkCallsAttempted: 0,
    }
  }

  // Load candidate prompt and schema
  const promptText = await readFile(V13_CANDIDATE_PROMPT_PATH, 'utf8')
  const schemaRaw = await readFile(V13_CANDIDATE_SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(schemaRaw)

  // Load cohort manifest
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)

  // Load existing token manifest if present to support safe resume
  let existingManifest = null
  if (existsSync(tokenManifestPath)) {
    try {
      const raw = await readFile(tokenManifestPath, 'utf8')
      existingManifest = JSON.parse(raw)
    } catch {}
  }

  const existingEntries = new Map()
  if (existingManifest && Array.isArray(existingManifest.records)) {
    for (const r of existingManifest.records) {
      if (r.candidateId && r.requestHash && typeof r.countedInputTokens === 'number') {
        existingEntries.set(r.candidateId, r)
      }
    }
  }

  const records = []
  let callsMade = 0

  for (const item of cohort.records) {
    const fullInputPath = path.isAbsolute(item.sourceRiskInputPath)
      ? item.sourceRiskInputPath
      : path.join(root, item.sourceRiskInputPath)

    const riskInputRaw = await readFile(fullInputPath, 'utf8')
    const riskInput = JSON.parse(riskInputRaw)
    const packet = buildVerifierV13ReplayPacket(riskInput)

    const req = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
    })

    const requestHash = req.requestMetadata.requestHash

    // Safe resume check
    const existing = existingEntries.get(item.candidateId)
    if (existing && existing.requestHash === requestHash) {
      records.push({
        candidateId: item.candidateId,
        tmdbId: item.tmdbId,
        requestHash,
        countedInputTokens: existing.countedInputTokens,
        cached: true,
      })
      continue
    }

    // Networked tokenizer call (countTokens only)
    const countEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens`
    const countBody = {
      generateContentRequest: {
        contents: req.body.contents,
        systemInstruction: req.body.systemInstruction,
        generationConfig: req.body.generationConfig,
      },
    }

    callsMade += 1
    const response = await fetchImpl(countEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(countBody),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`countTokens failed for ${item.candidateId} with status ${response.status}: ${errText}`)
    }

    const responseJson = await response.json()
    const totalTokens = responseJson?.totalTokens
    if (typeof totalTokens !== 'number') {
      throw new Error(`Invalid countTokens response for ${item.candidateId}: missing totalTokens`)
    }

    records.push({
      candidateId: item.candidateId,
      tmdbId: item.tmdbId,
      requestHash,
      countedInputTokens: totalTokens,
      cached: false,
    })
  }

  const manifestArtifact = {
    manifestId: 'verifier-v1.3-tokencounts.v1',
    schemaVersion: 'token-calibration-manifest.v1',
    activity: 'RETROSPECTIVE_DEVELOPMENT_REPLAY_V1_3',
    modelId: 'gemini-3.8-flash',
    calibratedAt: nowIso,
    totalRecords: records.length,
    callsMade,
    records,
  }

  await mkdir(path.dirname(tokenManifestPath), { recursive: true })
  await writeFile(tokenManifestPath, JSON.stringify(manifestArtifact, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    status: 'CALIBRATION_COMPLETED',
    totalRecords: records.length,
    callsMade,
    tokenManifestPath,
    records,
  }
}
