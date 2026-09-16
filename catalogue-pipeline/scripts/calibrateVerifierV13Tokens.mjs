import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const V13_EXPERIMENT_DIR = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay')
export const V13_CALIBRATION_DIR = path.join(V13_EXPERIMENT_DIR, 'token-calibration')
export const V13_TOKEN_MANIFEST_PATH = path.join(V13_EXPERIMENT_DIR, 'verifier-v1.3-tokencounts.v1.json')
export const V13_CANDIDATE_PROMPT_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md')
export const V13_CANDIDATE_SCHEMA_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json')
export const COHORT_MANIFEST_PATH = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json')

export const CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN = 'AUTHORIZE_COUNT_TOKENS_CALIBRATION'
export const FROZEN_CALIBRATION_TIMEOUT_MS = 30000

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

export async function atomicWriteJson(filePath, data, { refuseOverwrite = false } = {}) {
  if (refuseOverwrite && existsSync(filePath)) {
    const err = new Error(`Refusing to overwrite existing durable artifact: ${filePath}`)
    err.code = 'REFUSE_OVERWRITE'
    throw err
  }
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(tmpPath, filePath)
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
 * Uses atomic per-candidate persistence, explicit state machine, and timeout.
 */
export async function runVerifierV13TokenizerCalibration({
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot: root = repoRoot,
  calibrationDir = V13_CALIBRATION_DIR,
  tokenManifestPath = V13_TOKEN_MANIFEST_PATH,
  timeoutMs = FROZEN_CALIBRATION_TIMEOUT_MS,
  nowIso = new Date().toISOString(),
  maxRecords = Infinity,
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

  await mkdir(calibrationDir, { recursive: true })

  const records = []
  let callsMade = 0

  for (const item of cohort.records) {
    if (records.length >= maxRecords) {
      break
    }
    const candidateId = item.candidateId
    const tmdbId = item.tmdbId

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

    const candidateDir = path.join(calibrationDir, candidateId)
    const stateFilePath = path.join(candidateDir, 'calibration-state.json')
    const rawResponsePath = path.join(candidateDir, 'raw-count-response.json')

    // Recovery & Resume Audit on Existing Directory
    if (existsSync(stateFilePath)) {
      const existingState = JSON.parse(await readFile(stateFilePath, 'utf8'))

      // Refuse silent recalibration if requestHash differs under existing run
      if (existingState.requestHash && existingState.requestHash !== requestHash) {
        const err = new Error(`Request hash mismatch for candidate ${candidateId}. Expected ${existingState.requestHash}, got ${requestHash}. STOP_IF_CALIBRATED_HASH_MISMATCH`)
        err.code = 'STOP_IF_CALIBRATED_HASH_MISMATCH'
        throw err
      }

      // If already completed with matching requestHash, resume with zero calls
      if (existingState.calibrationState === 'COMPLETED') {
        records.push({
          candidateId,
          tmdbId,
          requestHash,
          countedInputTokens: existingState.countedInputTokens,
          cached: true,
        })
        continue
      }

      // Ambiguous dispatch state check: dispatch was started but no raw response exists
      if (
        (existingState.calibrationState === 'DISPATCH_STARTED' ||
          existingState.calibrationState === 'TIMEOUT_AMBIGUOUS' ||
          existingState.calibrationState === 'NETWORK_ERROR_AMBIGUOUS') &&
        !existsSync(rawResponsePath)
      ) {
        const err = new Error(`Ambiguous dispatch state for candidate ${candidateId} (state=${existingState.calibrationState}) without durable response. STOP_AMBIGUOUS_DISPATCH_STATE`)
        err.code = 'STOP_AMBIGUOUS_DISPATCH_STATE'
        err.candidateId = candidateId
        throw err
      }

      // Recover from RESPONSE_PERSISTED if raw response is durable
      if (existingState.calibrationState === 'RESPONSE_PERSISTED' || existsSync(rawResponsePath)) {
        const rawJson = JSON.parse(await readFile(rawResponsePath, 'utf8'))
        let parsedResponse = null
        try {
          parsedResponse = JSON.parse(rawJson.rawText)
        } catch {}

        const totalTokens = parsedResponse?.totalTokens
        if (typeof totalTokens !== 'number') {
          const err = new Error(`Invalid countTokens response for ${candidateId}: missing totalTokens`)
          err.code = 'INVALID_COUNT_TOKENS_RESPONSE'
          throw err
        }

        await atomicWriteJson(stateFilePath, {
          candidateId,
          tmdbId,
          requestHash,
          countedInputTokens: totalTokens,
          calibrationState: 'COMPLETED',
          completedAt: new Date().toISOString(),
          recovered: true,
        })

        records.push({
          candidateId,
          tmdbId,
          requestHash,
          countedInputTokens: totalTokens,
          cached: true,
        })
        continue
      }
    }

    // State 1: PRE_DISPATCH
    await atomicWriteJson(stateFilePath, {
      candidateId,
      tmdbId,
      requestHash,
      calibrationState: 'PRE_DISPATCH',
      startedAt: new Date().toISOString(),
    })

    // State 2: DISPATCH_STARTED
    await atomicWriteJson(stateFilePath, {
      candidateId,
      tmdbId,
      requestHash,
      calibrationState: 'DISPATCH_STARTED',
      dispatchedAt: new Date().toISOString(),
    })

    // Prepare countTokens dispatch
    const countEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.requestMetadata.modelId)}:countTokens`
    const countBody = {
      generateContentRequest: {
        model: `models/${req.requestMetadata.modelId}`,
        contents: req.body.contents,
        systemInstruction: req.body.systemInstruction,
        generationConfig: req.body.generationConfig,
      },
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response = null
    let rawText = ''

    callsMade += 1

    try {
      response = await fetchImpl(countEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(countBody),
        signal: controller.signal,
      })
      rawText = await response.text()
    } catch (fetchErr) {
      clearTimeout(timer)
      if (controller.signal.aborted || fetchErr?.name === 'AbortError') {
        await atomicWriteJson(stateFilePath, {
          candidateId,
          tmdbId,
          requestHash,
          calibrationState: 'TIMEOUT_AMBIGUOUS',
          error: `Request timed out after ${timeoutMs}ms`,
          failedAt: new Date().toISOString(),
        })
        const err = new Error(`countTokens timed out after ${timeoutMs}ms for ${candidateId}. STOP_CALIBRATION_TIMEOUT`)
        err.code = 'STOP_CALIBRATION_TIMEOUT'
        throw err
      }

      await atomicWriteJson(stateFilePath, {
        candidateId,
        tmdbId,
        requestHash,
        calibrationState: 'NETWORK_ERROR_AMBIGUOUS',
        error: fetchErr.message,
        failedAt: new Date().toISOString(),
      })
      throw fetchErr
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      await atomicWriteJson(stateFilePath, {
        candidateId,
        tmdbId,
        requestHash,
        calibrationState: 'HTTP_ERROR_TERMINAL',
        status: response.status,
        error: rawText,
        failedAt: new Date().toISOString(),
      })
      throw new Error(`countTokens failed for ${candidateId} with status ${response.status}: ${rawText}`)
    }

    // State 3: RESPONSE_PERSISTED (durable write before interpretation)
    await atomicWriteJson(rawResponsePath, {
      candidateId,
      status: response.status,
      rawText,
      persistedAt: new Date().toISOString(),
    }, { refuseOverwrite: true })

    await atomicWriteJson(stateFilePath, {
      candidateId,
      tmdbId,
      requestHash,
      calibrationState: 'RESPONSE_PERSISTED',
      responsePersistedAt: new Date().toISOString(),
    })

    // Interpret response
    let responseJson = null
    try {
      responseJson = JSON.parse(rawText)
    } catch (parseErr) {
      const err = new Error(`countTokens response was not valid JSON for ${candidateId}: ${parseErr.message}`)
      err.code = 'MALFORMED_COUNT_TOKENS_RESPONSE'
      throw err
    }

    const totalTokens = responseJson?.totalTokens
    if (typeof totalTokens !== 'number') {
      const err = new Error(`Invalid countTokens response for ${candidateId}: missing totalTokens`)
      err.code = 'INVALID_COUNT_TOKENS_RESPONSE'
      throw err
    }

    // State 4: COMPLETED
    await atomicWriteJson(stateFilePath, {
      candidateId,
      tmdbId,
      requestHash,
      countedInputTokens: totalTokens,
      calibrationState: 'COMPLETED',
      completedAt: new Date().toISOString(),
    })

    records.push({
      candidateId,
      tmdbId,
      requestHash,
      countedInputTokens: totalTokens,
      cached: false,
    })
  }

  // Materialize final manifest ONLY after all candidate records in cohort are COMPLETED
  if (records.length !== cohort.records.length) {
    return {
      ok: false,
      status: 'CALIBRATION_INTERRUPTED',
      completedRecords: records.length,
      totalExpected: cohort.records.length,
      callsMade,
      records,
    }
  }

  const manifestArtifact = {
    manifestId: 'verifier-v1.3-tokencounts.v1',
    schemaVersion: 'token-calibration-manifest.v1',
    activity: 'RETROSPECTIVE_DEVELOPMENT_REPLAY_V1_3',
    modelId: 'gemini-3.8-flash',
    calibratedAt: nowIso,
    totalRecords: records.length,
    callsMade,
    records: records.map((r) => ({
      candidateId: r.candidateId,
      tmdbId: r.tmdbId,
      requestHash: r.requestHash,
      countedInputTokens: r.countedInputTokens,
      cached: Boolean(r.cached),
    })),
  }

  await atomicWriteJson(tokenManifestPath, manifestArtifact)

  return {
    ok: true,
    status: 'CALIBRATION_COMPLETED',
    totalRecords: records.length,
    callsMade,
    tokenManifestPath,
    records: manifestArtifact.records,
  }
}

/**
 * Auditable CLI Entrypoint.
 * Usage: node catalogue-pipeline/scripts/calibrateVerifierV13Tokens.mjs run
 */
export async function main() {
  const subcommand = process.argv[2]
  if (subcommand !== 'run') {
    console.error('Invalid or missing CLI command. Usage: node catalogue-pipeline/scripts/calibrateVerifierV13Tokens.mjs run')
    process.exitCode = 1
    return { ok: false, status: 'INVALID_CLI_COMMAND' }
  }

  const res = await runVerifierV13TokenizerCalibration({
    env: process.env,
  })

  if (!res.ok) {
    console.error(`Calibration blocked or failed: ${res.status} - ${res.reason || res.detail || ''}`)
    process.exitCode = 1
    return res
  }

  console.log(`Calibration successfully completed: ${res.totalRecords} records calibrated, manifest written to ${res.tokenManifestPath}`)
  process.exitCode = 0
  return res
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`Fatal error in tokenizer calibration: ${err.message}`)
    process.exitCode = 1
  })
}
