import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateVerifierV12CandidatePayload } from './validateVerifierV12Contract.mjs'

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
    const humanDecision = record.humanDecision
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

// ---------------------------------------------------------------------------
// Candidate execution state machine
// ---------------------------------------------------------------------------

export const CANDIDATE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PRE_DISPATCH: 'PRE_DISPATCH',
  DISPATCH_STARTED: 'DISPATCH_STARTED',
  RESPONSE_PERSISTED: 'RESPONSE_PERSISTED',
  COMPLETED: 'COMPLETED',
  AMBIGUOUS_DISPATCH_STATE: 'AMBIGUOUS_DISPATCH_STATE',
})

function candidateLedgerPath({ candidateId, executionDir } = {}) {
  return path.join(executionDir, `${candidateId}.ledger.json`)
}

function candidateRawResponsePath({ candidateId, executionDir, attempt = 1 } = {}) {
  return path.join(executionDir, `${candidateId}.raw-response.attempt${attempt}.json`)
}

export async function loadExecutionState({ candidateId, executionDir } = {}) {
  const p = candidateLedgerPath({ candidateId, executionDir })
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch {
    return null
  }
}

export async function saveExecutionState({ candidateId, executionDir, state } = {}) {
  const p = candidateLedgerPath({ candidateId, executionDir })
  await mkdir(executionDir, { recursive: true })
  await writeFile(p, `${serializeArtifactForPersistence(state)}\n`, 'utf8')
}

export async function persistRawResponse({ candidateId, executionDir, rawText, attempt = 1 } = {}) {
  const finalPath = candidateRawResponsePath({ candidateId, executionDir, attempt })
  if (existsSync(finalPath)) {
    const err = new Error(`Raw response already exists for candidate ${candidateId} attempt ${attempt}. Refusing to overwrite.`)
    err.code = 'RAW_RESPONSE_EXISTS'
    throw err
  }
  await mkdir(executionDir, { recursive: true })
  await writeFile(finalPath, rawText, 'utf8')
}

// ---------------------------------------------------------------------------
// Real provider dispatch factory
// ---------------------------------------------------------------------------

export function createRealProviderDispatch({ apiKey, schema, promptText, modelConfig = FROZEN_MODEL_CONFIG } = {}) {
  if (!apiKey) {
    throw new Error('createRealProviderDispatch requires apiKey')
  }

  return async function providerDispatch({ packet, candidateId, tmdbId }) {
    const request = buildCandidateV12GeminiRequest({
      promptText,
      packet,
      schema,
      modelConfig,
    })

    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request.body),
    })

    const rawText = await response.text()
    let usageMetadata = null
    try {
      const parsed = JSON.parse(rawText)
      usageMetadata = parsed.usageMetadata || null
    } catch {}

    return {
      ok: response.ok,
      status: response.status,
      rawText,
      rawResponseHash: sha256Bytes(Buffer.from(rawText, 'utf8')),
      requestMetadata: request.requestMetadata,
      usageMetadata,
    }
  }
}

// ---------------------------------------------------------------------------
// Per-candidate execution
// ---------------------------------------------------------------------------

function classifyProviderErrorCode(err) {
  if (!err) return 'UNKNOWN'
  const msg = String(err.message || err)
  if (msg.includes('ECONNRESET') || msg.includes('connection reset')) return 'CONNECTION_RESET'
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return 'NETWORK_TIMEOUT'
  if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) return 'NETWORK_TIMEOUT'
  return 'PROVIDER_FAILURE'
}

function classifyHttpErrorCode(status) {
  if (status === 429) return 'HTTP_429'
  if (status === 500) return 'HTTP_500'
  if (status === 502) return 'HTTP_502'
  if (status === 503) return 'HTTP_503'
  if (status === 504) return 'HTTP_504'
  return 'PROVIDER_FAILURE'
}

export async function executeCandidate({
  record,
  promptText,
  schema,
  providerDispatch,
  executionDir,
  state,
  costState,
  counters,
  systemicInvalidCount,
  repoRoot: execRepoRoot = repoRoot,
} = {}) {
  const { candidateId, tmdbId, sourceRiskInputByteHash, sourceRiskInputPath } = record

  // 1. Verify source risk-input hash
  const fullInputPath = path.isAbsolute(sourceRiskInputPath)
    ? sourceRiskInputPath
    : path.join(execRepoRoot, sourceRiskInputPath)
  const rawBytes = await readFile(fullInputPath)
  const actualHash = sha256Bytes(rawBytes)
  if (actualHash !== sourceRiskInputByteHash) {
    const err = new Error(`Risk input byte hash mismatch for candidate ${candidateId}`)
    err.code = 'STOP_HASH_MISMATCH'
    throw err
  }

  // 2. Build leakage-clean seven-surface packet
  const riskInput = JSON.parse(rawBytes.toString('utf8'))
  const packet = buildVerifierV12ReplayPacket(riskInput)

  // 3. Check existing execution state
  let existingState = await loadExecutionState({ candidateId, executionDir })
  if (existingState && existingState.state === CANDIDATE_STATES.COMPLETED) {
    return { state: existingState, skipped: true }
  }
  if (existingState && existingState.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
    const err = new Error(`Candidate ${candidateId} is in AMBIGUOUS_DISPATCH_STATE. Manual resolution required.`)
    err.code = 'AMBIGUOUS_DISPATCH_STATE'
    throw err
  }
  // Crash safety: if a previous run died in DISPATCH_STARTED without persisting a response,
  // we must NOT redispatch. Mark ambiguous and surface to orchestrator.
  if (existingState && existingState.state === CANDIDATE_STATES.DISPATCH_STARTED) {
    const ambiguousState = {
      ...existingState,
      state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
      error: 'Recovered from DISPATCH_STARTED crash: outcome unknown',
      completedAt: new Date().toISOString(),
    }
    await saveExecutionState({ candidateId, executionDir, state: ambiguousState })
    const err = new Error(`Candidate ${candidateId} recovered from AMBIGUOUS_DISPATCH_STATE (crash during dispatch). Manual resolution required.`)
    err.code = 'AMBIGUOUS_DISPATCH_STATE'
    throw err
  }

  // 4-6. Verify caps
  if (counters.totalCalls >= FROZEN_CALL_LIMITS.maxTheoreticalCalls) {
    const err = new Error(`Total call cap reached (${FROZEN_CALL_LIMITS.maxTheoreticalCalls}).`)
    err.code = 'STOP_CALL_CAP'
    throw err
  }
  if (!checkPreDispatchAffordability({ accumulatedCost: costState.accumulatedCost })) {
    const err = new Error(`Cost cap would be exceeded (accumulated $${costState.accumulatedCost.toFixed(4)}).`)
    err.code = 'STOP_COST_CAP'
    throw err
  }

  // 7. Persist PRE_DISPATCH state
  const preDispatchState = {
    candidateId,
    tmdbId,
    state: CANDIDATE_STATES.PRE_DISPATCH,
    attempts: 0,
    retries: 0,
    disposition: null,
    inputHash: actualHash,
    packetHash: sha256Bytes(Buffer.from(serializeArtifactForPersistence(packet), 'utf8')),
    cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    tokens: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
    rawResponseHash: null,
    parsedOutputHash: null,
    validationFailures: null,
    startedAt: new Date().toISOString(),
  }
  await saveExecutionState({ candidateId, executionDir, state: preDispatchState })

  // Dispatch loop
  let attempt = 0
  let retries = 0
  let lastDisposition = null
  let lastRawText = null
  let lastRawHash = null
  let lastRequestMeta = null
  let lastTokens = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }

  while (attempt < FROZEN_CALL_LIMITS.maxRetriesPerCandidate + 1) {
    attempt += 1

    // 8. Mark DISPATCH_STARTED before provider request
    await saveExecutionState({
      candidateId,
      executionDir,
      state: { ...preDispatchState, state: CANDIDATE_STATES.DISPATCH_STARTED, attempt, retries },
    })

    let dispatchResult
    try {
      dispatchResult = await providerDispatch({ packet, candidateId, tmdbId })
    } catch (err) {
      const errorCode = classifyProviderErrorCode(err)
      lastDisposition = { disposition: 'PROVIDER_FAILURE', error: err.message, errorCode, isFailure: true, isValid: false }

      if (shouldRetryError({ errorCode, candidateRetries: retries, batchRetries: counters.batchRetries, totalCalls: counters.totalCalls })) {
        retries += 1
        counters.batchRetries += 1
        await saveExecutionState({
          candidateId,
          executionDir,
          state: { ...preDispatchState, state: CANDIDATE_STATES.DISPATCH_STARTED, attempt, retries, lastErrorCode: errorCode },
        })
        continue
      }

      const terminalState = {
        ...preDispatchState,
        state: CANDIDATE_STATES.COMPLETED,
        attempt, retries,
        disposition: 'PROVIDER_FAILURE', error: err.message, errorCode,
        completedAt: new Date().toISOString(),
      }
      await saveExecutionState({ candidateId, executionDir, state: terminalState })
      return { state: terminalState, skipped: false }
    }

    counters.totalCalls += 1
    lastRawText = dispatchResult.rawText
    lastRawHash = dispatchResult.rawResponseHash
    lastRequestMeta = dispatchResult.requestMetadata

    // Check HTTP-level errors (non-ok response)
    if (!dispatchResult.ok) {
      const httpErrorCode = classifyHttpErrorCode(dispatchResult.status)
      lastDisposition = { disposition: 'PROVIDER_FAILURE', error: `HTTP ${dispatchResult.status}`, errorCode: httpErrorCode, isFailure: true, isValid: false }

      if (shouldRetryError({ errorCode: httpErrorCode, candidateRetries: retries, batchRetries: counters.batchRetries, totalCalls: counters.totalCalls })) {
        retries += 1
        counters.batchRetries += 1
        await saveExecutionState({
          candidateId,
          executionDir,
          state: { ...preDispatchState, state: CANDIDATE_STATES.DISPATCH_STARTED, attempt, retries, lastErrorCode: httpErrorCode },
        })
        continue
      }

      const terminalState = {
        ...preDispatchState,
        state: CANDIDATE_STATES.COMPLETED,
        attempt, retries,
        disposition: 'PROVIDER_FAILURE', error: `HTTP ${dispatchResult.status}`, errorCode: httpErrorCode,
        rawResponseHash: lastRawHash,
        completedAt: new Date().toISOString(),
      }
      await saveExecutionState({ candidateId, executionDir, state: terminalState })
      return { state: terminalState, skipped: false }
    }

    // 10. Persist raw response immediately (immutable per attempt)
    await persistRawResponse({ candidateId, executionDir, rawText: dispatchResult.rawText, attempt })

    // Update state to RESPONSE_PERSISTED
    await saveExecutionState({
      candidateId,
      executionDir,
      state: { ...preDispatchState, state: CANDIDATE_STATES.RESPONSE_PERSISTED, attempt, retries, rawResponseHash: lastRawHash },
    })

    // 11-12. Parse/validate/classify
    const disposition = classifyOutputDisposition({ rawText: dispatchResult.rawText, schema })

    // Extract tokens if available
    if (dispatchResult.usageMetadata) {
      lastTokens = {
        inputTokens: dispatchResult.usageMetadata.inputTokenCount || 0,
        outputTokens: dispatchResult.usageMetadata.outputTokenCount || 0,
        thinkingTokens: dispatchResult.usageMetadata.thoughtsTokenCount || 0,
      }
    }

    // 13. Update cost
    const callCost = calculateCallCost(lastTokens)
    costState.accumulatedCost += callCost.totalCost

    lastDisposition = disposition

    // Check retryability
    if (disposition.isFailure) {
      const errorCode = disposition.disposition === 'MALFORMED_JSON' ? 'MALFORMED_JSON' : disposition.disposition
      if (shouldRetryError({ errorCode, candidateRetries: retries, batchRetries: counters.batchRetries, totalCalls: counters.totalCalls })) {
        retries += 1
        counters.batchRetries += 1
        await saveExecutionState({
          candidateId,
          executionDir,
          state: { ...preDispatchState, state: CANDIDATE_STATES.DISPATCH_STARTED, attempt, retries, lastErrorCode: errorCode },
        })
        continue
      }
    }

    // Terminal valid or non-retryable invalid
    const terminalState = {
      ...preDispatchState,
      state: CANDIDATE_STATES.COMPLETED,
      attempt, retries,
      disposition: disposition.disposition,
      riskLevel: disposition.riskLevel || null,
      validationFailures: disposition.failures || null,
      rawResponseHash: lastRawHash,
      parsedOutputHash: disposition.payload ? sha256Bytes(Buffer.from(serializeArtifactForPersistence(disposition.payload), 'utf8')) : null,
      cost: { inputCost: callCost.inputCost, outputCost: callCost.outputCost, totalCost: callCost.totalCost },
      tokens: lastTokens,
      requestMetadata: lastRequestMeta,
      completedAt: new Date().toISOString(),
    }
    await saveExecutionState({ candidateId, executionDir, state: terminalState })

    if (disposition.disposition === 'SCHEMA_INVALID' || disposition.disposition === 'SEMANTICALLY_INVALID') {
      systemicInvalidCount.count += 1
    }

    return { state: terminalState, skipped: false }
  }

  // Exhausted retries without terminal — mark ambiguous
  const ambiguousState = {
    ...preDispatchState,
    state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
    attempt, retries,
    disposition: lastDisposition ? lastDisposition.disposition : 'PROVIDER_FAILURE',
    rawResponseHash: lastRawHash,
    error: 'Retries exhausted without terminal disposition',
    completedAt: new Date().toISOString(),
  }
  await saveExecutionState({ candidateId, executionDir, state: ambiguousState })
  return { state: ambiguousState, skipped: false }
}

// ---------------------------------------------------------------------------
// Mode 1 replay orchestrator
// ---------------------------------------------------------------------------

export async function runMode1Replay({
  env = process.env,
  providerDispatch = null,
  executionDir = EXECUTION_DIR,
  repoRootOverride = repoRoot,
  promptText = null,
  schema = null,
  cohortManifest = null,
} = {}) {
  // Authorization gate
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    const err = new Error(`Replay execution blocked: ${auth.reason}. ${auth.detail}`)
    err.code = 'EXECUTION_NOT_AUTHORIZED'
    throw err
  }

  // Preflight
  await verifyHashes({ repoRoot: repoRootOverride })
  resolveModelConfiguration({ env })

  // Use injected cohort manifest if provided, otherwise verify from frozen file
  let cohort
  if (cohortManifest) {
    cohort = {
      ok: true,
      cohortSize: cohortManifest.cohortSize,
      records: cohortManifest.records,
      recordAudits: cohortManifest.records.map((r) => ({
        candidateId: r.candidateId,
        tmdbId: r.tmdbId,
        humanDecision: r.humanDecision,
        severity: r.severity,
        hashValid: true,
        packetSurfacesValid: true,
        leakageClean: true,
      })),
    }
  } else {
    cohort = await verifyCohortIntegrity({ repoRoot: repoRootOverride })
  }

  // Load prompt + schema if not injected
  const prompt = promptText || (await readFile(CANDIDATE_PROMPT_PATH, 'utf8'))
  const validationSchema = schema || JSON.parse(await readFile(CANDIDATE_SCHEMA_PATH, 'utf8'))

  // Provider dispatch
  const dispatch = providerDispatch || createRealProviderDispatch({
    apiKey: env.GEMINI_API_KEY,
    schema: validationSchema,
    promptText: prompt,
  })

  // Execution dir
  await mkdir(executionDir, { recursive: true })

  const costState = { accumulatedCost: 0 }
  const counters = { totalCalls: 0, batchRetries: 0 }
  const systemicInvalidCount = { count: 0 }
  const results = []

  for (const record of cohort.records) {
    // Systemic invalid stop check BEFORE dispatch
    if (systemicInvalidCount.count >= 6) {
      results.push({
        candidateId: record.candidateId,
        state: CANDIDATE_STATES.NOT_STARTED,
        disposition: null,
        stoppedByRule: 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6',
        systemicInvalidCount: systemicInvalidCount.count,
      })
      continue
    }

    // Cost cap check BEFORE dispatch
    if (!checkPreDispatchAffordability({ accumulatedCost: costState.accumulatedCost })) {
      results.push({
        candidateId: record.candidateId,
        state: CANDIDATE_STATES.NOT_STARTED,
        disposition: null,
        stoppedByRule: 'STOP_COST_CAP',
        accumulatedCost: costState.accumulatedCost,
      })
      continue
    }

    // Total call cap check BEFORE dispatch
    if (counters.totalCalls >= FROZEN_CALL_LIMITS.maxTheoreticalCalls) {
      results.push({
        candidateId: record.candidateId,
        state: CANDIDATE_STATES.NOT_STARTED,
        disposition: null,
        stoppedByRule: 'STOP_CALL_CAP',
        totalCalls: counters.totalCalls,
      })
      continue
    }

    try {
      const result = await executeCandidate({
        record,
        promptText: prompt,
        schema: validationSchema,
        providerDispatch: dispatch,
        executionDir,
        state: {},
        costState,
        counters,
        systemicInvalidCount,
        repoRoot: repoRootOverride,
      })

      results.push({
        candidateId: record.candidateId,
        state: result.state.state,
        disposition: result.state.disposition,
        skipped: result.skipped || false,
        attempts: result.state.attempt || 0,
        retries: result.state.retries || 0,
        cost: result.state.cost || { totalCost: 0 },
        tokens: result.state.tokens || { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
        rawResponseHash: result.state.rawResponseHash || null,
        validationFailures: result.state.validationFailures || null,
      })

      // Post-response cost enforcement
      if (!checkPostResponseCap({ accumulatedCost: costState.accumulatedCost })) {
        const remainingIdx = cohort.records.indexOf(record)
        for (let j = remainingIdx + 1; j < cohort.records.length; j += 1) {
          results.push({
            candidateId: cohort.records[j].candidateId,
            state: CANDIDATE_STATES.NOT_STARTED,
            disposition: null,
            stoppedByRule: 'STOP_COST_CAP',
          })
        }
        break
      }
    } catch (err) {
      if (err.code === 'AMBIGUOUS_DISPATCH_STATE') {
        results.push({
          candidateId: record.candidateId,
          state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
          disposition: null,
          error: err.message,
        })
        break
      }
      if (err.code === 'STOP_RETRY_CAP' || err.code === 'STOP_CALL_CAP' || err.code === 'STOP_COST_CAP') {
        results.push({
          candidateId: record.candidateId,
          state: CANDIDATE_STATES.NOT_STARTED,
          disposition: null,
          stoppedByRule: err.code,
        })
        const remainingIdx = cohort.records.indexOf(record)
        for (let j = remainingIdx + 1; j < cohort.records.length; j += 1) {
          results.push({
            candidateId: cohort.records[j].candidateId,
            state: CANDIDATE_STATES.NOT_STARTED,
            disposition: null,
            stoppedByRule: err.code,
          })
        }
        break
      }
      throw err
    }
  }

  // Build evaluation
  const evaluationRecords = results
    .filter((r) => r.disposition)
    .map((r) => ({
      candidateId: r.candidateId,
      humanDecision: cohort.records.find((c) => c.candidateId === r.candidateId)?.humanDecision || 'APPROVE',
      disposition: r.disposition,
    }))

  const twoLayer = computeTwoLayerEvaluation({ records: evaluationRecords })
  const severeCase = evaluateSevereSafetyGate({ records: evaluationRecords })
  const systemicStop = checkSystemicInvalidStop({ records: evaluationRecords })

  const finalReport = {
    status: results.some((r) => r.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
      ? 'AMBIGUOUS'
      : systemicStop.triggered
        ? 'STOPPED'
        : 'COMPLETE',
    mode: 'MODE_1_OPTION_A_ONLY',
    candidatesAttempted: results.filter((r) => !r.skipped).length,
    candidatesCompleted: results.filter((r) => r.state === CANDIDATE_STATES.COMPLETED).length,
    candidatesSkipped: results.filter((r) => r.skipped).length,
    candidatesRemaining: results.filter((r) => r.state === CANDIDATE_STATES.NOT_STARTED).length,
    primaryCalls: counters.totalCalls - counters.batchRetries,
    retries: counters.batchRetries,
    totalExternalCalls: counters.totalCalls,
    inputTokens: results.reduce((s, r) => s + (r.tokens?.inputTokens || 0), 0),
    outputTokens: results.reduce((s, r) => s + (r.tokens?.outputTokens || 0), 0),
    thinkingTokens: results.reduce((s, r) => s + (r.tokens?.thinkingTokens || 0), 0),
    totalCostUsd: Number(costState.accumulatedCost.toFixed(6)),
    dispositionCounts: results.reduce((acc, r) => {
      if (r.disposition) acc[r.disposition] = (acc[r.disposition] || 0) + 1
      return acc
    }, {}),
    systemicInvalidGate: {
      triggered: systemicStop.triggered,
      invalidCount: systemicStop.invalidCount,
      threshold: systemicStop.threshold,
    },
    severeCaseOutcome: severeCase.evaluated ? {
      outcome: severeCase.severeSafetyOutcome,
      disposition: severeCase.disposition,
      governanceEffect: severeCase.governanceEffect,
    } : null,
    validOutputPerformance: {
      validOutputCount: twoLayer.layerA.validOutputCount,
      invalidOrFailureCount: twoLayer.layerA.invalidOrFailureCount,
      validOutputRate: twoLayer.layerA.validOutputRate,
      confusionMatrix: twoLayer.layerA.confusionMatrix,
      apparentSensitivity: twoLayer.layerA.apparentDefectSensitivity,
      apparentSpecificity: twoLayer.layerA.apparentSpecificity,
      apparentPpv: twoLayer.layerA.apparentPpv,
      apparentNpv: twoLayer.layerA.apparentNpv,
      apparentFalsePositiveRate: twoLayer.layerA.apparentFalsePositiveRate,
    },
    failClosedContainment: {
      defectContainmentCount: twoLayer.layerB.defectContainmentCount,
      defectContainmentRate: twoLayer.layerB.defectContainmentRate,
      cleanAutoPassCount: twoLayer.layerB.cleanAutoPassCount,
      cleanAutoPassRate: twoLayer.layerB.cleanAutoPassRate,
      cleanOverRoutingCount: twoLayer.layerB.cleanOverRoutingCount,
      cleanOverRoutingRate: twoLayer.layerB.cleanOverRoutingRate,
      humanReviewRoutingBurdenCount: twoLayer.layerB.totalHumanReviewRoutingBurdenCount,
      humanReviewRoutingBurdenRate: twoLayer.layerB.totalHumanReviewRoutingBurdenRate,
    },
    executionDir,
    records: results,
  }

  // Persist final report
  await writeFile(
    path.join(executionDir, 'final-report.json'),
    `${serializeArtifactForPersistence(finalReport)}\n`,
    'utf8',
  )

  return finalReport
}

// ---------------------------------------------------------------------------
// Preflight and dry-run (unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function runReplayExecution({
  env = process.env,
  providerDispatch = null,
  executionDir = EXECUTION_DIR,
} = {}) {
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    const err = new Error(`Replay execution blocked: ${auth.reason}. ${auth.detail}`)
    err.code = 'EXECUTION_NOT_AUTHORIZED'
    throw err
  }

  return runMode1Replay({ env, providerDispatch, executionDir })
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
