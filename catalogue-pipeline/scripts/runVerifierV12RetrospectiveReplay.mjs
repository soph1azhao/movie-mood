import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateVerifierV12CandidatePayload } from './validateVerifierV12Contract.mjs'
import { buildGemini38Request } from '../adapters/geminiEditorialProvider.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const EXPERIMENT_DIR = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay')
export const EXECUTION_DIR = path.join(EXPERIMENT_DIR, 'execution')

export const PROTOCOL_PATH = path.join(EXPERIMENT_DIR, 'protocol.v1.json')
export const COHORT_MANIFEST_PATH = path.join(EXPERIMENT_DIR, 'cohort-manifest.v1.json')
export const PROTOCOL_MD_PATH = path.join(EXPERIMENT_DIR, 'PROTOCOL.md')
export const CANDIDATE_PROMPT_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.md')
export const CANDIDATE_SCHEMA_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json')
export const CANDIDATE_MANIFEST_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.manifest.json')
export const CANDIDATE_ADDENDUM_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json')
export const CANDIDATE_VALIDATOR_PATH = path.join(repoRoot, 'catalogue-pipeline/scripts/validateVerifierV12Contract.mjs')
export const PRICING_METADATA_PATH = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/gemini-pricing-metadata.v1.json')

export const VERIFIER_V12_REPLAY_AUTHORIZATION_TOKEN = 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY'

export const FROZEN_EXPECTED_HASHES = Object.freeze({
  protocol: {
    canonical: 'sha256:f02c62a8140f12784e589b1044980843ca1f9be025556e897938628aac67b032',
    raw: 'sha256:6dd1c1748abb41a192d67cd2a5f7c0f6505699012987efd4020bc6f442daba9c',
  },
  cohort: {
    canonical: 'sha256:63f83cc9863f455597e1a0141f7c0f5a56bbb7923ed1c9502d9e2235c7c2e45c',
    raw: 'sha256:63f83cc9863f455597e1a0141f7c0f5a56bbb7923ed1c9502d9e2235c7c2e45c',
  },
  protocolMd: {
    raw: 'sha256:8e604403a880c132f60d9f713865d6d9158d9236a6c12f464bc099713f92703e',
  },
  candidatePrompt: {
    raw: 'sha256:f173ba79458c3178e301299632a183fa9cc7138b40f31db0821e9c520af19760',
  },
  candidateSchema: {
    raw: 'sha256:6c21edb0ed18a8febc1c7ec667904719cd9be4e25baf26d3de0ea3284f28b4ff',
    canonical: 'sha256:3f18f18a458a9dd63767c2bf4bbee1ddeee10828febf609872a0ab7fa51ee14f',
  },
  candidateManifest: {
    raw: 'sha256:c40436b00c8ea4730590fdb9e7922d0bfecdca4c1b79b1dfaad5406599b6fecf',
    canonical: 'sha256:ae55bb5fe4c44b7497669c6b7349acc77468dbe67f04b31865546283c54cfd56',
  },
  candidateAddendum: {
    raw: 'sha256:f2b6c2313440f5cc8d2c563de23c91ad050f4203383e4c394e8db54bc67c125a',
    canonical: 'sha256:acf1e16ce52831880cc295dfb5d1b099b182ee8052c7abf7aa6bc074520a4bb4',
  },
  candidateValidator: {
    raw: 'sha256:634cdb4bbb475dc20bc007b090e341cfcee0d956f7ec72c7d908ba238c19b3b6',
  },
  pricingMetadata: {
    raw: 'sha256:6436706662718957e1ede60cecb73896e7af936dbf8abf6fbec4e42eccd10bfc',
    canonical: 'sha256:6436706662718957e1ede60cecb73896e7af936dbf8abf6fbec4e42eccd10bfc',
  },
})

export const FROZEN_MODEL_CONFIG = Object.freeze({
  provider: 'google-gemini-developer-api',
  modelId: 'gemini-3.8-flash',
  thinkingLevel: 'medium',
  maxOutputTokens: 4096,
  temperature: 0.0,
  timeoutMs: 30000,
})

export const FROZEN_CALL_LIMITS = Object.freeze({
  primaryCallsPlanned: 30,
  maxTechnicalRetriesBatch: 10,
  maxTheoreticalCalls: 40,
  maxRetriesPerCandidate: 2,
  costCeilingUsd: 0.50,
})

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

export const RETRYABLE_ERROR_CODES = Object.freeze(new Set([
  'HTTP_429',
  'HTTP_429_RATE_LIMIT',
  'HTTP_500',
  'HTTP_500_SERVER_ERROR',
  'HTTP_503',
  'HTTP_503_SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'NETWORK_TIMEOUT',
  'CONNECTION_RESET',
  'MALFORMED_JSON',
  'MALFORMED_JSON_STRING',
]))

export const NON_RETRYABLE_ERROR_CODES = Object.freeze(new Set([
  'HTTP_502',
  'HTTP_502_BAD_GATEWAY',
  'HTTP_504',
  'HTTP_504_GATEWAY_TIMEOUT',
  'SCHEMA_VALID_POOR_SEMANTIC_ANSWER',
  'SEMANTIC_VALIDATION_FAILURE',
  'VALID_LOW_RISK_ON_DEFECT',
  'VALID_HIGH_RISK_ON_CLEAN',
  'SCHEMA_INVALID',
  'SEMANTICALLY_INVALID',
]))

function sha256Bytes(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`
}

export function verifyExecutionAuthorization({ env = process.env } = {}) {
  const token = env.VERIFIER_V12_REPLAY_AUTHORIZATION
  if (token === VERIFIER_V12_REPLAY_AUTHORIZATION_TOKEN) {
    return {
      authorized: true,
      token,
    }
  }
  return {
    authorized: false,
    reason: 'EXECUTION_NOT_AUTHORIZED',
    detail: 'Explicit future environment variable VERIFIER_V12_REPLAY_AUTHORIZATION=AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY is required.',
  }
}

export const RELATIVE_PATHS = Object.freeze({
  protocol: 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/protocol.v1.json',
  cohort: 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json',
  protocolMd: 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/PROTOCOL.md',
  candidatePrompt: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.md',
  candidateSchema: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json',
  candidateManifest: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.manifest.json',
  candidateAddendum: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json',
  candidateValidator: 'catalogue-pipeline/scripts/validateVerifierV12Contract.mjs',
  pricingMetadata: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/gemini-pricing-metadata.v1.json',
})

export async function verifyHashes({ repoRoot: root = repoRoot, expectedHashes = FROZEN_EXPECTED_HASHES } = {}) {
  const readAndHash = async (relPath) => {
    const fullPath = path.join(root, relPath)
    const raw = await readFile(fullPath)
    const rawHash = sha256Bytes(raw)
    let canonicalHash = null
    try {
      const parsed = JSON.parse(raw.toString('utf8'))
      canonicalHash = hashArtifact(parsed)
    } catch {}
    return { rawHash, canonicalHash }
  }

  const results = {
    protocol: await readAndHash(RELATIVE_PATHS.protocol),
    cohort: await readAndHash(RELATIVE_PATHS.cohort),
    protocolMd: await readAndHash(RELATIVE_PATHS.protocolMd),
    candidatePrompt: await readAndHash(RELATIVE_PATHS.candidatePrompt),
    candidateSchema: await readAndHash(RELATIVE_PATHS.candidateSchema),
    candidateManifest: await readAndHash(RELATIVE_PATHS.candidateManifest),
    candidateAddendum: await readAndHash(RELATIVE_PATHS.candidateAddendum),
    candidateValidator: await readAndHash(RELATIVE_PATHS.candidateValidator),
    pricingMetadata: await readAndHash(RELATIVE_PATHS.pricingMetadata),
  }

  const mismatches = []

  const check = (name, key, actual, expected) => {
    if (expected && actual !== expected) {
      mismatches.push({ name, key, actual, expected })
    }
  }

  check('protocol', 'canonical', results.protocol.canonicalHash, expectedHashes.protocol.canonical)
  check('protocol', 'raw', results.protocol.rawHash, expectedHashes.protocol.raw)

  check('cohort', 'canonical', results.cohort.canonicalHash, expectedHashes.cohort.canonical)
  check('cohort', 'raw', results.cohort.rawHash, expectedHashes.cohort.raw)

  check('protocolMd', 'raw', results.protocolMd.rawHash, expectedHashes.protocolMd.raw)

  check('candidatePrompt', 'raw', results.candidatePrompt.rawHash, expectedHashes.candidatePrompt.raw)

  check('candidateSchema', 'canonical', results.candidateSchema.canonicalHash, expectedHashes.candidateSchema.canonical)
  check('candidateSchema', 'raw', results.candidateSchema.rawHash, expectedHashes.candidateSchema.raw)

  check('candidateManifest', 'canonical', results.candidateManifest.canonicalHash, expectedHashes.candidateManifest.canonical)
  check('candidateManifest', 'raw', results.candidateManifest.rawHash, expectedHashes.candidateManifest.raw)

  check('candidateAddendum', 'canonical', results.candidateAddendum.canonicalHash, expectedHashes.candidateAddendum.canonical)
  check('candidateAddendum', 'raw', results.candidateAddendum.rawHash, expectedHashes.candidateAddendum.raw)

  check('candidateValidator', 'raw', results.candidateValidator.rawHash, expectedHashes.candidateValidator.raw)

  check('pricingMetadata', 'canonical', results.pricingMetadata.canonicalHash, expectedHashes.pricingMetadata.canonical)
  check('pricingMetadata', 'raw', results.pricingMetadata.rawHash, expectedHashes.pricingMetadata.raw)

  if (mismatches.length > 0) {
    const err = new Error(`Hash preflight failed: ${mismatches.length} mismatch(es). STOP_HASH_MISMATCH`)
    err.code = 'STOP_HASH_MISMATCH'
    err.mismatches = mismatches
    throw err
  }

  return { ok: true, results }
}

export function resolveModelConfiguration({ env = process.env } = {}) {
  const envModel = env.GEMINI_MODEL
  if (envModel !== undefined && envModel !== '' && envModel !== FROZEN_MODEL_CONFIG.modelId) {
    const err = new Error(`Mismatched GEMINI_MODEL env override '${envModel}'. Expected '${FROZEN_MODEL_CONFIG.modelId}'. STOP_MODEL_CONFIG_MISMATCH`)
    err.code = 'STOP_MODEL_CONFIG_MISMATCH'
    err.actual = envModel
    err.expected = FROZEN_MODEL_CONFIG.modelId
    throw err
  }

  const credentialAvailable = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '')

  return {
    ok: true,
    modelConfig: FROZEN_MODEL_CONFIG,
    credentialStatus: credentialAvailable ? 'AVAILABLE' : 'PROVIDER_CREDENTIAL_NOT_AVAILABLE',
    credentialAvailable,
  }
}

function scanForForbiddenKeys(obj, path = '') {
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

export function buildVerifierV12ReplayPacket(riskInput) {
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

export const buildSevenSurfacePacket = buildVerifierV12ReplayPacket

export async function verifyCohortIntegrity({ repoRoot: root = repoRoot } = {}) {
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)

  if (cohort.cohortSize !== 30 || cohort.records.length !== 30) {
    throw new Error(`Cohort size must be exactly 30 (got ${cohort.cohortSize} size, ${cohort.records.length} records)`)
  }

  const summary = cohort.summary
  if (summary.approve !== 14 || summary.reviseMinor !== 15 || summary.reviseSevere !== 1 || summary.reject !== 0) {
    throw new Error(`Cohort composition mismatch: expected 14 approve, 15 reviseMinor, 1 reviseSevere, 0 reject. Got: ${JSON.stringify(summary)}`)
  }

  const recordAudits = []

  for (const record of cohort.records) {
    const fullInputPath = path.isAbsolute(record.sourceRiskInputPath)
      ? record.sourceRiskInputPath
      : path.join(root, record.sourceRiskInputPath)

    if (!existsSync(fullInputPath)) {
      throw new Error(`Risk input file missing for candidate ${record.candidateId}: ${fullInputPath}`)
    }

    const rawBytes = await readFile(fullInputPath)
    const actualHash = sha256Bytes(rawBytes)
    if (actualHash !== record.sourceRiskInputByteHash) {
      throw new Error(`Risk input byte hash mismatch for candidate ${record.candidateId}. Expected ${record.sourceRiskInputByteHash}, got ${actualHash}`)
    }

    const riskInput = JSON.parse(rawBytes.toString('utf8'))
    const packet = buildVerifierV12ReplayPacket(riskInput)

    recordAudits.push({
      candidateId: record.candidateId,
      tmdbId: record.tmdbId,
      humanDecision: record.humanDecision,
      severity: record.severity,
      hashValid: true,
      packetSurfacesValid: true,
      leakageClean: true,
    })
  }

  return {
    ok: true,
    cohortSize: cohort.cohortSize,
    summary,
    recordAudits,
  }
}

export function buildCandidateV12GeminiRequest({
  promptText,
  packet,
  schema,
  modelConfig = FROZEN_MODEL_CONFIG,
}) {
  const canonicalInput = serializeArtifactForPersistence(packet)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelConfig.modelId)}:generateContent`

  const body = {
    systemInstruction: { parts: [{ text: promptText }] },
    contents: [{ role: 'user', parts: [{ text: canonicalInput }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      maxOutputTokens: modelConfig.maxOutputTokens,
      thinkingConfig: { thinkingLevel: modelConfig.thinkingLevel },
      temperature: modelConfig.temperature,
    },
  }

  return {
    endpoint,
    requestMetadata: {
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      temperature: modelConfig.temperature,
      promptRawByteHash: sha256Bytes(Buffer.from(promptText, 'utf8')),
      packetCanonicalByteHash: sha256Bytes(Buffer.from(canonicalInput, 'utf8')),
    },
    body,
  }
}

export function calculateCallCost({ inputTokens = 0, outputTokens = 0, thinkingTokens = 0 } = {}) {
  const inputCost = (inputTokens / 1_000_000) * 0.75
  const outputCost = ((outputTokens + (thinkingTokens ?? 0)) / 1_000_000) * 3.75
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  }
}

export function checkPreDispatchAffordability({ accumulatedCost = 0, nextCallEstimate = 0.015, costCeiling = FROZEN_CALL_LIMITS.costCeilingUsd } = {}) {
  return accumulatedCost + nextCallEstimate <= costCeiling
}

export const checkCostAffordability = checkPreDispatchAffordability

export function checkPostResponseCap({ accumulatedCost = 0, costCeiling = FROZEN_CALL_LIMITS.costCeilingUsd } = {}) {
  return accumulatedCost <= costCeiling
}

export function shouldRetryError({
  errorCode,
  candidateRetries = 0,
  batchRetries = 0,
  totalCalls = 0,
} = {}) {
  if (totalCalls >= FROZEN_CALL_LIMITS.maxTheoreticalCalls) return false
  if (candidateRetries >= FROZEN_CALL_LIMITS.maxRetriesPerCandidate) return false
  if (batchRetries >= FROZEN_CALL_LIMITS.maxTechnicalRetriesBatch) return false

  if (NON_RETRYABLE_ERROR_CODES.has(errorCode)) return false
  return RETRYABLE_ERROR_CODES.has(errorCode)
}

export function classifyOutputDisposition({
  transportError = null,
  rawText = null,
  schema = null,
  semanticValidator = validateVerifierV12CandidatePayload,
} = {}) {
  if (transportError) {
    return {
      disposition: 'PROVIDER_FAILURE',
      error: transportError.message || String(transportError),
      isFailure: true,
      isValid: false,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(rawText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        disposition: 'MALFORMED_JSON',
        error: 'JSON root must be an object',
        isFailure: true,
        isValid: false,
      }
    }
  } catch (err) {
    return {
      disposition: 'MALFORMED_JSON',
      error: err.message,
      isFailure: true,
      isValid: false,
    }
  }

  if (schema && typeof schema === 'object') {
    const required = schema.required || []
    for (const prop of required) {
      if (parsed[prop] === undefined) {
        return {
          disposition: 'SCHEMA_INVALID',
          error: `Missing required property '${prop}'`,
          isFailure: true,
          isValid: false,
          parsed,
        }
      }
    }
  }

  const validation = semanticValidator(parsed)
  if (!validation.ok) {
    return {
      disposition: 'SEMANTICALLY_INVALID',
      failures: validation.failures,
      isFailure: true,
      isValid: false,
      parsed,
    }
  }

  const isHighRisk = parsed.riskLevel === 'HIGH_RISK' ||
    (Array.isArray(parsed.riskCategories) && parsed.riskCategories.includes('UNRESOLVED_SOURCE_GROUNDING_CONFLICT'))

  return {
    disposition: isHighRisk ? 'VALID_HIGH_RISK' : 'VALID_LOW_RISK',
    riskLevel: parsed.riskLevel,
    isFailure: false,
    isValid: true,
    payload: parsed,
  }
}

export function computeTwoLayerEvaluation({ records = [] } = {}) {
  let validOutputCount = 0
  let invalidOrFailureCount = 0

  let tp = 0
  let fn = 0
  let fp = 0
  let tn = 0

  let defectContainmentCount = 0
  let cleanAutoPassCount = 0
  let cleanOverRoutingCount = 0
  let totalHumanReviewRoutingBurdenCount = 0

  for (const record of records) {
    const humanDecision = record.humanDecision // 'APPROVE' or 'REVISE'
    const isDefect = humanDecision === 'REVISE'
    const disposition = record.disposition

    const isValid = disposition === 'VALID_HIGH_RISK' || disposition === 'VALID_LOW_RISK'

    if (isValid) {
      validOutputCount += 1
      if (isDefect && disposition === 'VALID_HIGH_RISK') tp += 1
      if (isDefect && disposition === 'VALID_LOW_RISK') fn += 1
      if (!isDefect && disposition === 'VALID_HIGH_RISK') fp += 1
      if (!isDefect && disposition === 'VALID_LOW_RISK') tn += 1
    } else {
      invalidOrFailureCount += 1
    }

    let operationalRoute
    if (disposition === 'VALID_HIGH_RISK') {
      operationalRoute = 'HUMAN_REVIEW_REQUIRED'
    } else if (disposition === 'VALID_LOW_RISK') {
      operationalRoute = 'AUTO_ELIGIBLE_SIMULATION'
    } else {
      operationalRoute = 'HUMAN_REVIEW_REQUIRED_FAIL_CLOSED'
    }

    if (operationalRoute === 'HUMAN_REVIEW_REQUIRED' || operationalRoute === 'HUMAN_REVIEW_REQUIRED_FAIL_CLOSED') {
      totalHumanReviewRoutingBurdenCount += 1
      if (isDefect) defectContainmentCount += 1
      else cleanOverRoutingCount += 1
    } else {
      if (!isDefect) cleanAutoPassCount += 1
    }
  }

  const totalRecords = records.length
  const totalDefects = records.filter((r) => r.humanDecision === 'REVISE').length
  const totalClean = records.filter((r) => r.humanDecision === 'APPROVE').length

  const layerA = {
    layerId: 'VALID_OUTPUT_APPARENT_RETROSPECTIVE_PERFORMANCE',
    validOutputCount,
    invalidOrFailureCount,
    validOutputRate: totalRecords > 0 ? validOutputCount / totalRecords : 0,
    confusionMatrix: { TP: tp, FN: fn, FP: fp, TN: tn },
    apparentDefectSensitivity: tp + fn > 0 ? tp / (tp + fn) : null,
    apparentSpecificity: tn + fp > 0 ? tn / (tn + fp) : null,
    apparentPpv: tp + fp > 0 ? tp / (tp + fp) : null,
    apparentNpv: tn + fn > 0 ? tn / (tn + fn) : null,
    apparentFalsePositiveRate: tn + fp > 0 ? fp / (tn + fp) : null,
  }

  const layerB = {
    layerId: 'FAIL_CLOSED_OPERATIONAL_CONTAINMENT',
    totalRecords,
    defectContainmentCount,
    defectContainmentRate: totalDefects > 0 ? defectContainmentCount / totalDefects : 0,
    cleanAutoPassCount,
    cleanAutoPassRate: totalClean > 0 ? cleanAutoPassCount / totalClean : 0,
    cleanOverRoutingCount,
    cleanOverRoutingRate: totalClean > 0 ? cleanOverRoutingCount / totalClean : 0,
    totalHumanReviewRoutingBurdenCount,
    totalHumanReviewRoutingBurdenRate: totalRecords > 0 ? totalHumanReviewRoutingBurdenCount / totalRecords : 0,
  }

  return { layerA, layerB }
}

export function evaluateSevereSafetyGate({ records = [] } = {}) {
  const severeCase = records.find((r) => r.candidateId === 'scale500-tmdb-14283')
  if (!severeCase) {
    return {
      evaluated: false,
      reason: 'Severe case scale500-tmdb-14283 not found in records',
    }
  }

  const disposition = severeCase.disposition
  const passedCandidate = disposition === 'VALID_LOW_RISK'

  return {
    evaluated: true,
    candidateId: 'scale500-tmdb-14283',
    disposition,
    severeSafetyOutcome: passedCandidate
      ? 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE'
      : 'SEVERE_DEFECT_FLAGGED_OR_CONTAINED',
    governanceEffect: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
  }
}

export function checkSystemicInvalidStop({ records = [] } = {}) {
  const invalidDispositions = new Set(['SCHEMA_INVALID', 'SEMANTICALLY_INVALID'])
  const invalidCount = records.filter((r) => invalidDispositions.has(r.disposition)).length
  const threshold = 6

  return {
    triggered: invalidCount >= threshold,
    rule: 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6',
    invalidCount,
    threshold,
    dispositionsIncluded: ['SCHEMA_INVALID', 'SEMANTICALLY_INVALID'],
  }
}

export const CANDIDATE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PRE_DISPATCH: 'PRE_DISPATCH',
  DISPATCH_STARTED: 'DISPATCH_STARTED',
  RESPONSE_PERSISTED: 'RESPONSE_PERSISTED',
  COMPLETED: 'COMPLETED',
  AMBIGUOUS_DISPATCH_STATE: 'AMBIGUOUS_DISPATCH_STATE',
})

export function normalizeTransportOutcome({
  response = null,
  status = null,
  ok = null,
  rawText = '',
  error = null,
  modelConfig = FROZEN_MODEL_CONFIG,
} = {}) {
  const resolvedStatus = status ?? response?.status ?? null
  const resolvedOk = ok ?? response?.ok ?? (resolvedStatus === 200)

  let usageMetadata = null
  let parsedBody = null
  if (typeof rawText === 'string' && rawText.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawText)
      if (parsedBody && typeof parsedBody === 'object') {
        usageMetadata = parsedBody.usageMetadata || null
      }
    } catch {}
  }

  let transportCategory
  let retryable
  let transportOutcome

  if (error) {
    transportOutcome = 'NETWORK_ERROR'
    const message = String(error?.message || '')
    const code = String(error?.code || '')
    const isTimeout = error?.name === 'AbortError' || code === 'ETIMEDOUT' || /timeout/i.test(message)
    const isConnReset = code === 'ECONNRESET' || /connection reset/i.test(message)

    if (isTimeout) {
      transportCategory = 'NETWORK_TIMEOUT'
      retryable = true
    } else if (isConnReset) {
      transportCategory = 'CONNECTION_RESET'
      retryable = true
    } else {
      transportCategory = 'NETWORK_ERROR'
      retryable = true
    }
  } else if (resolvedStatus === 200) {
    transportOutcome = 'SUCCESS'
    transportCategory = 'HTTP_200'
    retryable = false
  } else if (resolvedStatus === 429) {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = 'HTTP_429'
    retryable = true
  } else if (resolvedStatus === 500) {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = 'HTTP_500'
    retryable = true
  } else if (resolvedStatus === 503) {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = 'HTTP_503'
    retryable = true
  } else if (resolvedStatus === 502) {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = 'HTTP_502'
    retryable = false
  } else if (resolvedStatus === 504) {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = 'HTTP_504'
    retryable = false
  } else {
    transportOutcome = 'HTTP_ERROR'
    transportCategory = `HTTP_${resolvedStatus}`
    retryable = false
  }

  return {
    ok: resolvedOk,
    status: resolvedStatus,
    rawText: typeof rawText === 'string' ? rawText : '',
    providerMetadata: {
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
    },
    usageMetadata,
    transportOutcome,
    transportCategory,
    retryable,
    error: error ? { message: error.message, code: error.code || null } : null,
  }
}

export function createVerifierV12ProviderDispatch({
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = globalThis.fetch,
  modelConfig = FROZEN_MODEL_CONFIG,
  promptText = null,
  schema = null,
  repoRoot: root = repoRoot,
} = {}) {
  return async function verifierV12ProviderDispatch(packet) {
    if (!apiKey) {
      const err = new Error('GEMINI_API_KEY is required for verifier v1.2 provider dispatch.')
      err.code = 'MISSING_CREDENTIAL'
      throw err
    }

    const resolvedPrompt = promptText || (await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.md'), 'utf8'))
    const resolvedSchema = schema || JSON.parse(await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))

    const request = buildGemini38Request({
      modelId: modelConfig.modelId,
      promptText: resolvedPrompt,
      input: packet,
      responseSchema: resolvedSchema,
      thinkingLevel: modelConfig.thinkingLevel,
      maxOutputTokens: modelConfig.maxOutputTokens,
    })
    request.body.generationConfig.temperature = modelConfig.temperature

    let response
    try {
      response = await fetchImpl(request.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(request.body),
      })
    } catch (err) {
      return normalizeTransportOutcome({
        error: err,
        modelConfig,
      })
    }

    const status = response.status
    const ok = response.ok
    const rawText = await response.text()

    return normalizeTransportOutcome({
      response,
      status,
      ok,
      rawText,
      modelConfig,
    })
  }
}

export function getCandidateExecutionPaths({ executionDir = EXECUTION_DIR, candidateId } = {}) {
  if (!candidateId) throw new Error('candidateId is required.')
  const candidateDir = path.join(executionDir, candidateId)
  const attemptsDir = path.join(candidateDir, 'attempts')
  const ledgerPath = path.join(candidateDir, 'ledger.json')
  return { candidateDir, attemptsDir, ledgerPath }
}

export function formatAttemptArtifactName(attemptNumber) {
  return `attempt-${String(attemptNumber).padStart(3, '0')}.raw.json`
}

async function atomicWriteFile(targetPath, content) {
  const dir = path.dirname(targetPath)
  await mkdir(dir, { recursive: true })
  const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, targetPath)
}

async function atomicWriteJson(targetPath, data) {
  const content = `${serializeArtifactForPersistence(data)}\n`
  await atomicWriteFile(targetPath, content)
}

export async function executeSingleCandidateAttempt({
  record,
  packet,
  attemptNumber = 1,
  executionDir = EXECUTION_DIR,
  providerDispatch,
  repoRoot: root = repoRoot,
} = {}) {
  const candidateId = record?.candidateId || packet?.candidateId
  if (!candidateId) throw new Error('candidateId is required for candidate attempt.')
  if (typeof providerDispatch !== 'function') throw new Error('providerDispatch function is required.')

  const { candidateDir, attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir, candidateId })
  const artifactName = formatAttemptArtifactName(attemptNumber)
  const attemptArtifactPath = path.join(attemptsDir, artifactName)
  const relativeArtifactPath = path.join('attempts', artifactName)

  // Fail closed if attempt artifact already exists
  if (existsSync(attemptArtifactPath)) {
    const err = new Error(`Attempt artifact already exists at ${attemptArtifactPath}; refusing overwrite (fail closed).`)
    err.code = 'ATTEMPT_ARTIFACT_EXISTS'
    throw err
  }

  await mkdir(attemptsDir, { recursive: true })

  // Read existing ledger if present
  let ledger = {
    candidateId,
    state: CANDIDATE_STATES.NOT_STARTED,
    currentAttempt: attemptNumber,
    terminalAttempt: null,
    attempts: [],
    disposition: null,
    ambiguous: false,
  }

  if (existsSync(ledgerPath)) {
    try {
      ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    } catch (readErr) {
      const err = new Error(`Corrupted ledger for ${candidateId}: ${readErr.message}`)
      err.code = 'CORRUPTED_LEDGER'
      throw err
    }

    if (ledger.state === CANDIDATE_STATES.COMPLETED) {
      const err = new Error(`Candidate ${candidateId} is already COMPLETED; cannot redispatch.`)
      err.code = 'ALREADY_COMPLETED'
      throw err
    }

    if (ledger.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
      const err = new Error(`Candidate ${candidateId} is in AMBIGUOUS_DISPATCH_STATE; cannot redispatch.`)
      err.code = 'AMBIGUOUS_DISPATCH_STATE'
      throw err
    }
  }

  // 1. NOT_STARTED -> PRE_DISPATCH
  ledger.state = CANDIDATE_STATES.PRE_DISPATCH
  ledger.currentAttempt = attemptNumber
  await atomicWriteJson(ledgerPath, ledger)

  // 2. PRE_DISPATCH -> DISPATCH_STARTED immediately before awaiting provider
  ledger.state = CANDIDATE_STATES.DISPATCH_STARTED
  await atomicWriteJson(ledgerPath, ledger)

  // 3. Await provider dispatch
  let transportResult
  try {
    transportResult = await providerDispatch(packet)
  } catch (err) {
    // Process interruption or unhandled crash in dispatch
    throw err
  }

  // 4. Persist immutable raw response artifact BEFORE semantic interpretation
  if (existsSync(attemptArtifactPath)) {
    const err = new Error(`Attempt artifact already exists at ${attemptArtifactPath}; refusing overwrite.`)
    err.code = 'ATTEMPT_ARTIFACT_EXISTS'
    throw err
  }

  const rawTextContent = typeof transportResult.rawText === 'string' ? transportResult.rawText : ''
  const rawResponseHash = sha256Bytes(Buffer.from(rawTextContent, 'utf8'))

  // Write attempt raw file atomically
  await atomicWriteFile(attemptArtifactPath, rawTextContent)

  // 5. DISPATCH_STARTED -> RESPONSE_PERSISTED
  const attemptRecord = {
    attemptNumber,
    state: CANDIDATE_STATES.RESPONSE_PERSISTED,
    artifactPath: relativeArtifactPath,
    rawResponseHash,
    status: transportResult.status,
    ok: transportResult.ok,
    transportOutcome: transportResult.transportOutcome,
    transportCategory: transportResult.transportCategory,
    retryable: transportResult.retryable,
  }

  const existingAttempts = Array.isArray(ledger.attempts) ? ledger.attempts : []
  const attemptIndex = existingAttempts.findIndex((a) => a.attemptNumber === attemptNumber)
  if (attemptIndex >= 0) {
    existingAttempts[attemptIndex] = attemptRecord
  } else {
    existingAttempts.push(attemptRecord)
  }

  ledger.attempts = existingAttempts
  ledger.state = CANDIDATE_STATES.RESPONSE_PERSISTED
  await atomicWriteJson(ledgerPath, ledger)

  return {
    candidateId,
    attemptNumber,
    state: CANDIDATE_STATES.RESPONSE_PERSISTED,
    artifactPath: attemptArtifactPath,
    rawResponseHash,
    transportResult,
    ledger,
  }
}

export async function inspectCandidateResumeState({
  candidateId,
  executionDir = EXECUTION_DIR,
} = {}) {
  const { attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir, candidateId })

  if (!existsSync(ledgerPath)) {
    return {
      candidateId,
      state: CANDIDATE_STATES.NOT_STARTED,
      canDispatch: true,
      resumeAction: 'DISPATCH_NEW_ATTEMPT',
      nextAttemptNumber: 1,
    }
  }

  let ledger
  try {
    ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
  } catch (err) {
    return {
      candidateId,
      state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
      canDispatch: false,
      resumeAction: 'STOP_AMBIGUOUS',
      reason: `Corrupted ledger: ${err.message}`,
    }
  }

  if (ledger.state === CANDIDATE_STATES.COMPLETED) {
    return {
      candidateId,
      state: CANDIDATE_STATES.COMPLETED,
      canDispatch: false,
      resumeAction: 'ALREADY_COMPLETED',
      terminalAttempt: ledger.terminalAttempt,
      disposition: ledger.disposition,
    }
  }

  if (ledger.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
    return {
      candidateId,
      state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
      canDispatch: false,
      resumeAction: 'STOP_AMBIGUOUS',
      reason: ledger.ambiguousReason || 'Previous ambiguous dispatch state',
    }
  }

  if (ledger.state === CANDIDATE_STATES.DISPATCH_STARTED) {
    const attemptArtifact = path.join(attemptsDir, formatAttemptArtifactName(ledger.currentAttempt || 1))
    if (!existsSync(attemptArtifact)) {
      ledger.state = CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE
      ledger.ambiguous = true
      ledger.ambiguousReason = `Crash uncertainty: DISPATCH_STARTED for attempt ${ledger.currentAttempt || 1} without durable response persistence.`
      await atomicWriteJson(ledgerPath, ledger)

      return {
        candidateId,
        state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
        canDispatch: false,
        resumeAction: 'STOP_AMBIGUOUS',
        reason: ledger.ambiguousReason,
      }
    }

    ledger.state = CANDIDATE_STATES.RESPONSE_PERSISTED
    await atomicWriteJson(ledgerPath, ledger)
    return {
      candidateId,
      state: CANDIDATE_STATES.RESPONSE_PERSISTED,
      canDispatch: false,
      canInterpret: true,
      resumeAction: 'CONTINUE_INTERPRETATION',
      attemptNumber: ledger.currentAttempt,
    }
  }

  if (ledger.state === CANDIDATE_STATES.RESPONSE_PERSISTED) {
    return {
      candidateId,
      state: CANDIDATE_STATES.RESPONSE_PERSISTED,
      canDispatch: false,
      canInterpret: true,
      resumeAction: 'CONTINUE_INTERPRETATION',
      attemptNumber: ledger.currentAttempt,
    }
  }

  if (ledger.state === CANDIDATE_STATES.PRE_DISPATCH) {
    return {
      candidateId,
      state: CANDIDATE_STATES.PRE_DISPATCH,
      canDispatch: true,
      resumeAction: 'START_DISPATCH',
      nextAttemptNumber: ledger.currentAttempt || 1,
    }
  }

  return {
    candidateId,
    state: ledger.state || CANDIDATE_STATES.NOT_STARTED,
    canDispatch: false,
    resumeAction: 'STOP_UNKNOWN',
    reason: `Unrecognized ledger state: ${ledger.state}`,
  }
}

export async function markCandidateCompleted({
  candidateId,
  executionDir = EXECUTION_DIR,
  terminalAttempt = 1,
  disposition = null,
} = {}) {
  const { ledgerPath } = getCandidateExecutionPaths({ executionDir, candidateId })
  if (!existsSync(ledgerPath)) {
    throw new Error(`Cannot mark completed: ledger not found for candidate ${candidateId}`)
  }
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
  ledger.state = CANDIDATE_STATES.COMPLETED
  ledger.terminalAttempt = terminalAttempt
  ledger.disposition = disposition
  await atomicWriteJson(ledgerPath, ledger)
  return ledger
}

export async function runPreflight({ repoRoot: root = repoRoot, env = process.env } = {}) {
  const hashes = await verifyHashes({ repoRoot: root })
  const model = resolveModelConfiguration({ env })
  const cohort = await verifyCohortIntegrity({ repoRoot: root })
  const auth = verifyExecutionAuthorization({ env })

  const preflightReport = {
    protocolHashPass: hashes.ok,
    cohortHashPass: hashes.ok,
    candidateHashesPass: hashes.ok,
    pricingBindingPass: hashes.ok,
    modelConfigPass: model.ok,
    cohortCountPass: cohort.cohortSize === 30,
    riskInputHashesPass: cohort.recordAudits.every((r) => r.hashValid),
    authorizedSurfacesPass: cohort.recordAudits.every((r) => r.packetSurfacesValid),
    leakageAuditPass: cohort.recordAudits.every((r) => r.leakageClean),
    providerDispatches: 0,
    modelCalls: 0,
    networkCalls: 0,
    executionAuthorization: auth.authorized ? 'AUTHORIZED' : 'NOT PRESENT',
    credentialStatus: model.credentialStatus,
    status: 'READY_FOR_EXPLICIT_EXECUTION_AUTHORIZATION',
  }

  return preflightReport
}

export async function runDryRun({
  repoRoot: root = repoRoot,
  env = process.env,
  dispatchSpy = null,
} = {}) {
  const preflight = await runPreflight({ repoRoot: root, env })

  let providerDispatches = 0
  if (dispatchSpy) providerDispatches = dispatchSpy.count || 0

  const dryRunReport = {
    ...preflight,
    mode: 'DRY_RUN',
    providerDispatches,
    modelCalls: 0,
    networkCalls: 0,
    dryRunCandidateCount: 30,
    status: 'READY_FOR_EXPLICIT_EXECUTION_AUTHORIZATION',
  }

  return dryRunReport
}

export async function runReplayExecution({
  env = process.env,
} = {}) {
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    const err = new Error(`Replay execution blocked: ${auth.reason}. ${auth.detail}`)
    err.code = 'EXECUTION_NOT_AUTHORIZED'
    throw err
  }

  const err = new Error('Replay execution is blocked: Phase A implements transport, attempt persistence, and crash recovery only. Full 30-record replay execution loop belongs to Phase B.')
  err.code = 'PHASE_B_EXECUTION_NOT_YET_MATERIALIZED'
  throw err
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'preflight'

  if (command === 'preflight') {
    const report = await runPreflight()
    console.log('=== VERIFIER V1.2 RETROSPECTIVE REPLAY PREFLIGHT ===')
    console.log(JSON.stringify(report, null, 2))
    return
  }

  if (command === 'dry-run') {
    const report = await runDryRun()
    console.log('=== VERIFIER V1.2 RETROSPECTIVE REPLAY DRY-RUN ===')
    console.log(JSON.stringify(report, null, 2))
    return
  }

  if (command === 'run') {
    await runReplayExecution()
    return
  }

  console.error(`Unknown command '${command}'. Use 'preflight', 'dry-run', or 'run'.`)
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`ERROR [${err.code || 'UNKNOWN'}]: ${err.message}`)
    process.exit(1)
  })
}
