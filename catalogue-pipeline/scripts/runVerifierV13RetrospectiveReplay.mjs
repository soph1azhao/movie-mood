import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import {
  validateVerifierV13CandidatePayload,
  auditProviderSchemaKeywords,
} from './validateVerifierV13Contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const EXPERIMENT_DIR = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay')
export const EXECUTION_DIR = path.join(EXPERIMENT_DIR, 'execution')

export const PROTOCOL_PATH = path.join(EXPERIMENT_DIR, 'protocol.v1.json')
export const COHORT_MANIFEST_PATH = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json')
export const PROTOCOL_MD_PATH = path.join(EXPERIMENT_DIR, 'PROTOCOL.md')
export const CANDIDATE_PROMPT_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md')
export const CANDIDATE_SCHEMA_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json')
export const CANDIDATE_MANIFEST_PATH = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.manifest.json')
export const CANDIDATE_VALIDATOR_PATH = path.join(repoRoot, 'catalogue-pipeline/scripts/validateVerifierV13Contract.mjs')
export const TOKEN_MANIFEST_PATH = path.join(EXPERIMENT_DIR, 'verifier-v1.3-tokencounts.v1.json')
export const PRICING_METADATA_PATH = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/gemini-pricing-metadata.v1.json')

export const FROZEN_TOKEN_MANIFEST_BYTE_HASH = 'sha256:ab14416a966625d02bb3ed8d3d5ada8ac68db47ecfe1e917c159aea324e9b84a'
export const FROZEN_COHORT_CANONICAL_HASH = 'sha256:63f83cc9863f455597e1a0141f7c0f5a56bbb7923ed1c9502d9e2235c7c2e45c'

export const VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN = 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY_V1_3'

export const CANDIDATE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PRE_DISPATCH: 'PRE_DISPATCH',
  DISPATCH_STARTED: 'DISPATCH_STARTED',
  RESPONSE_PERSISTED: 'RESPONSE_PERSISTED',
  COMPLETED: 'COMPLETED',
  AMBIGUOUS_DISPATCH_STATE: 'AMBIGUOUS_DISPATCH_STATE',
})

export async function atomicWriteJson(filePath, data, { refuseOverwrite = false } = {}) {
  if (refuseOverwrite && existsSync(filePath)) {
    const err = new Error(`Refusing to overwrite existing durable artifact: ${filePath}`)
    err.code = 'REFUSE_OVERWRITE'
    throw err
  }
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}.${randomBytes(6).toString('hex')}`
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(tmpPath, filePath)
}

export async function atomicWriteFile(filePath, content, { refuseOverwrite = false } = {}) {
  if (refuseOverwrite && existsSync(filePath)) {
    const err = new Error(`Refusing to overwrite existing durable artifact: ${filePath}`)
    err.code = 'REFUSE_OVERWRITE'
    throw err
  }
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}.${randomBytes(6).toString('hex')}`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

export async function loadAndValidateTokenManifest({
  tokenManifestPath = TOKEN_MANIFEST_PATH,
  cohort,
  enforceFrozenBindings = true,
}) {
  if (!existsSync(tokenManifestPath)) {
    const err = new Error(`Token manifest is required but does not exist at: ${tokenManifestPath}`)
    err.code = 'TOKEN_MANIFEST_MISSING'
    throw err
  }

  let raw
  try {
    raw = await readFile(tokenManifestPath, 'utf8')
  } catch (err) {
    const e = new Error(`Cannot read token manifest at ${tokenManifestPath}: ${err.message}`)
    e.code = 'TOKEN_MANIFEST_READ_ERROR'
    throw e
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    const e = new Error(`Token manifest is malformed JSON: ${err.message}`)
    e.code = 'TOKEN_MANIFEST_MALFORMED'
    throw e
  }

  if (!manifest || typeof manifest !== 'object') {
    const err = new Error('Token manifest root must be an object')
    err.code = 'TOKEN_MANIFEST_MALFORMED'
    throw err
  }

  if (!Array.isArray(manifest.records)) {
    const err = new Error('Token manifest missing records array')
    err.code = 'TOKEN_MANIFEST_MALFORMED'
    throw err
  }

  const expectedCohortCandidates = new Set(cohort.records.map((r) => r.candidateId))
  if (expectedCohortCandidates.size !== 30) {
    const err = new Error(`Cohort manifest must contain exactly 30 candidates, found ${expectedCohortCandidates.size}`)
    err.code = 'COHORT_SIZE_MISMATCH'
    throw err
  }

  if (manifest.records.length !== 30) {
    const err = new Error(`Token manifest must contain exactly 30 records, found ${manifest.records.length}`)
    err.code = 'TOKEN_MANIFEST_COUNT_MISMATCH'
    throw err
  }

  const calibratedMap = new Map()
  for (const r of manifest.records) {
    if (!r.candidateId || typeof r.candidateId !== 'string') {
      const err = new Error('Token manifest record missing candidateId')
      err.code = 'TOKEN_MANIFEST_MALFORMED'
      throw err
    }

    if (!expectedCohortCandidates.has(r.candidateId)) {
      const err = new Error(`Token manifest contains unexpected candidate outside frozen cohort: ${r.candidateId}`)
      err.code = 'TOKEN_MANIFEST_UNEXPECTED_CANDIDATE'
      throw err
    }

    if (calibratedMap.has(r.candidateId)) {
      const err = new Error(`Token manifest contains duplicate calibration record for candidate: ${r.candidateId}`)
      err.code = 'TOKEN_MANIFEST_DUPLICATE_CANDIDATE'
      throw err
    }

    if (!r.requestHash || !/^sha256:[a-f0-9]{64}$/.test(r.requestHash)) {
      const err = new Error(`Token manifest record for ${r.candidateId} has invalid requestHash: ${r.requestHash}`)
      err.code = 'TOKEN_MANIFEST_INVALID_REQUEST_HASH'
      throw err
    }

    if (typeof r.countedInputTokens !== 'number' || r.countedInputTokens <= 0) {
      const err = new Error(`Token manifest record for ${r.candidateId} has invalid countedInputTokens: ${r.countedInputTokens}`)
      err.code = 'TOKEN_MANIFEST_INVALID_TOKEN_COUNT'
      throw err
    }

    calibratedMap.set(r.candidateId, r)
  }

  for (const cId of expectedCohortCandidates) {
    if (!calibratedMap.has(cId)) {
      const err = new Error(`Token manifest incomplete; missing candidate: ${cId}`)
      err.code = 'TOKEN_MANIFEST_INCOMPLETE'
      throw err
    }
  }

  if (enforceFrozenBindings) {
    const manifestByteHash = sha256Bytes(Buffer.from(raw, 'utf8'))
    if (manifestByteHash !== FROZEN_TOKEN_MANIFEST_BYTE_HASH) {
      const err = new Error(
        `Token manifest byte hash mismatch: expected ${FROZEN_TOKEN_MANIFEST_BYTE_HASH}, got ${manifestByteHash}`
      )
      err.code = 'TOKEN_MANIFEST_HASH_MISMATCH'
      throw err
    }

    const cohortCanonicalHash = hashArtifact(cohort)
    if (cohortCanonicalHash !== FROZEN_COHORT_CANONICAL_HASH) {
      const err = new Error(
        `Cohort manifest canonical hash mismatch: expected ${FROZEN_COHORT_CANONICAL_HASH}, got ${cohortCanonicalHash}`
      )
      err.code = 'COHORT_HASH_MISMATCH'
      throw err
    }
  }

  return {
    manifest,
    calibratedMap,
  }
}

export const FROZEN_MODEL_CONFIG = Object.freeze({
  provider: 'google-gemini-developer-api',
  modelId: 'gemini-3.8-flash',
  thinkingLevel: 'medium',
  maxOutputTokens: 6144,
  temperature: 0.0,
  timeoutMs: 30000,
})

export const FROZEN_CALL_LIMITS = Object.freeze({
  primaryCallsPlanned: 30,
  maxTechnicalRetriesBatch: 10,
  maxTheoreticalCalls: 40,
  maxRetriesPerCandidate: 2,
  costCeilingUsd: 1.10,
  governedPreDispatchCostCeilingUsd: 1.10,
  frozenNextCallCostReserveUsd: 0.026100,
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
  'HTTP_429_RATE_LIMIT',
  'HTTP_500_SERVER_ERROR',
  'HTTP_503_SERVICE_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'CONNECTION_RESET',
  'MALFORMED_JSON_STRING',
]))

export const NON_RETRYABLE_ERROR_CODES = Object.freeze(new Set([
  'HTTP_502_BAD_GATEWAY',
  'HTTP_504_GATEWAY_TIMEOUT',
  'NETWORK_ERROR',
  'SCHEMA_INVALID',
  'SEMANTICALLY_INVALID',
]))

function sha256Bytes(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`
}

export function verifyExecutionAuthorization({ env = process.env } = {}) {
  const token = env.VERIFIER_V13_REPLAY_AUTHORIZATION
  if (token === VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN) {
    return {
      authorized: true,
      token,
    }
  }
  return {
    authorized: false,
    reason: 'EXECUTION_NOT_AUTHORIZED',
    detail: `Explicit future environment variable VERIFIER_V13_REPLAY_AUTHORIZATION=${VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN} is required.`,
  }
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

  const completeRequestString = serializeArtifactForPersistence({ endpoint, body })
  const requestHash = `sha256:${createHash('sha256').update(completeRequestString).digest('hex')}`

  return {
    endpoint,
    requestMetadata: {
      modelId: modelConfig.modelId,
      thinkingLevel: modelConfig.thinkingLevel,
      temperature: modelConfig.temperature,
      maxOutputTokens: modelConfig.maxOutputTokens,
      promptRawByteHash: sha256Bytes(Buffer.from(promptText, 'utf8')),
      packetCanonicalByteHash: sha256Bytes(Buffer.from(canonicalInput, 'utf8')),
      requestHash,
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

export function checkPreDispatchAffordability({
  accumulatedCost = 0,
  nextCallEstimate = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
  costCeiling = FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
} = {}) {
  return accumulatedCost + nextCallEstimate <= costCeiling
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

export function extractVerifierText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null
  let json
  try {
    json = JSON.parse(rawText)
  } catch {
    return rawText
  }
  if (json && typeof json === 'object' && Array.isArray(json.candidates)) {
    const candidate = json.candidates[0]
    const parts = candidate?.content?.parts
    if (Array.isArray(parts)) {
      const textPart = parts.find((p) => typeof p?.text === 'string')
      if (textPart) {
        return textPart.text
      }
    }
    return null
  }
  return rawText
}

export function validateJsonSchema(data, schema, basePath = '') {
  const errors = []
  if (!schema || typeof schema !== 'object') return { valid: true, errors: [] }

  if (Array.isArray(schema.anyOf)) {
    let anyMatched = false
    const branchErrors = []
    for (let i = 0; i < schema.anyOf.length; i += 1) {
      const branchRes = validateJsonSchema(data, schema.anyOf[i], basePath)
      if (branchRes.valid) {
        anyMatched = true
        break
      }
      branchErrors.push(...branchRes.errors)
    }
    if (!anyMatched) {
      errors.push(`${basePath || 'root'}: failed anyOf schema validation`)
      return { valid: false, errors }
    }
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actualType = Array.isArray(data)
      ? 'array'
      : data === null
        ? 'null'
        : typeof data

    let typeMatches = false
    for (const t of expectedTypes) {
      if (t === 'integer' && typeof data === 'number' && Number.isInteger(data)) {
        typeMatches = true
        break
      }
      if (t === actualType) {
        typeMatches = true
        break
      }
    }
    if (!typeMatches) {
      errors.push(`${basePath || 'root'}: expected type ${expectedTypes.join('|')}, got ${actualType}`)
      return { valid: false, errors }
    }
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(data)) {
      errors.push(`${basePath || 'root'}: value ${JSON.stringify(data)} is not in enum [${schema.enum.join(', ')}]`)
    }
  }

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (Array.isArray(schema.required)) {
      for (const reqProp of schema.required) {
        if (data[reqProp] === undefined) {
          errors.push(`${basePath ? basePath + '.' + reqProp : reqProp}: missing required property`)
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}))
      for (const key of Object.keys(data)) {
        if (!allowedProps.has(key)) {
          errors.push(`${basePath ? basePath + '.' + key : key}: prohibited additional property`)
        }
      }
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (data[propName] !== undefined) {
          const subRes = validateJsonSchema(data[propName], propSchema, basePath ? `${basePath}.${propName}` : propName)
          if (!subRes.valid) {
            errors.push(...subRes.errors)
          }
        }
      }
    }
  }

  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push(`${basePath || 'root'}: array length ${data.length} is less than minItems ${schema.minItems}`)
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push(`${basePath || 'root'}: array length ${data.length} is greater than maxItems ${schema.maxItems}`)
    }

    if (schema.items && typeof schema.items === 'object') {
      for (let i = 0; i < data.length; i += 1) {
        const itemRes = validateJsonSchema(data[i], schema.items, `${basePath}[${i}]`)
        if (!itemRes.valid) {
          errors.push(...itemRes.errors)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates output text across the 3-step pipeline:
 * Step 1: JSON parse -> MALFORMED_JSON
 * Step 2: Provider schema -> SCHEMA_INVALID
 * Step 3: Local semantic validator -> SEMANTICALLY_INVALID
 */
export function validateVerifierV13OutputPipeline(rawText, schema) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      disposition: 'MALFORMED_JSON_STRING',
      outputRetryEligible: true,
      error: 'Empty or non-string output',
      parsed: null,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch (parseErr) {
    return {
      disposition: 'MALFORMED_JSON_STRING',
      outputRetryEligible: true,
      error: `JSON.parse failed: ${parseErr.message}`,
      parsed: null,
    }
  }

  // Schema validation
  const schemaRes = validateJsonSchema(parsed, schema)
  if (!schemaRes.valid) {
    return {
      disposition: 'SCHEMA_INVALID',
      outputRetryEligible: false,
      error: `Schema validation failed: ${schemaRes.errors.join('; ')}`,
      parsed,
      schemaErrors: schemaRes.errors,
    }
  }

  // Semantic validation
  const semanticRes = validateVerifierV13CandidatePayload(parsed)
  if (!semanticRes.ok) {
    return {
      disposition: 'SEMANTICALLY_INVALID',
      outputRetryEligible: false,
      error: `Semantic validation failed: ${semanticRes.failures.join('; ')}`,
      parsed,
      semanticFailures: semanticRes.failures,
    }
  }

  return {
    disposition: parsed.riskLevel === 'HIGH_RISK' ? 'VALID_HIGH_RISK' : 'VALID_LOW_RISK',
    outputRetryEligible: false,
    parsed,
  }
}

/**
 * Derives attempt record and evaluation metrics from raw durable evidence.
 * Exact raw evidence is preserved before this function is called.
 */
export function deriveAttemptRecordFromRaw({ rawEvidence, schema, calibrated }) {
  if (!rawEvidence || typeof rawEvidence !== 'object') {
    throw new Error('Raw evidence is missing or invalid')
  }

  const candidateId = rawEvidence.candidateId
  const attemptIndex = rawEvidence.attemptIndex
  const requestHash = rawEvidence.requestHash
  const httpStatus = rawEvidence.httpStatus ?? rawEvidence.status ?? null
  const rawResponse = rawEvidence.rawResponse ?? rawEvidence.rawResponseText ?? null
  const rawResponseSha256 = rawEvidence.rawResponseSha256 ?? rawEvidence.rawResponseHash ?? null
  const transportError = rawEvidence.transportError ?? rawEvidence.error ?? null

  let usageMetadata = rawEvidence.usageMetadata ?? null
  if (!usageMetadata && rawResponse) {
    if (typeof rawResponse === 'string') {
      try {
        const parsedEnvelope = JSON.parse(rawResponse)
        usageMetadata = parsedEnvelope?.usageMetadata ?? null
      } catch {}
    } else if (typeof rawResponse === 'object') {
      usageMetadata = rawResponse?.usageMetadata ?? null
    }
  }

  let callCostUsd = 0
  if (usageMetadata && typeof usageMetadata === 'object') {
    const inputTokens = usageMetadata.promptTokenCount ?? 0
    const outputTokens = usageMetadata.candidatesTokenCount ?? 0
    const thinkingTokens = usageMetadata.thinkingTokenCount ?? 0
    const costRes = calculateCallCost({ inputTokens, outputTokens, thinkingTokens })
    callCostUsd = costRes.totalCost
  } else if (typeof rawEvidence.callCostUsd === 'number') {
    callCostUsd = rawEvidence.callCostUsd
  } else {
    callCostUsd = 0.0025
  }

  let attemptDisposition = null
  let transportRetryable = false
  let outputRetryEligible = false
  let pipelineRes = null

  if (transportError || (httpStatus !== null && httpStatus !== 200)) {
    if (httpStatus === 429) {
      attemptDisposition = 'HTTP_429_RATE_LIMIT'
      transportRetryable = true
    } else if (httpStatus === 500) {
      attemptDisposition = 'HTTP_500_SERVER_ERROR'
      transportRetryable = true
    } else if (httpStatus === 503) {
      attemptDisposition = 'HTTP_503_SERVICE_UNAVAILABLE'
      transportRetryable = true
    } else if (httpStatus === 502) {
      attemptDisposition = 'HTTP_502_BAD_GATEWAY'
      transportRetryable = false
    } else if (httpStatus === 504) {
      attemptDisposition = 'HTTP_504_GATEWAY_TIMEOUT'
      transportRetryable = false
    } else if (
      transportError?.category === 'NETWORK_TIMEOUT' ||
      transportError?.code === 'NETWORK_TIMEOUT' ||
      transportError?.message?.includes('timeout')
    ) {
      attemptDisposition = 'NETWORK_TIMEOUT'
      transportRetryable = true
    } else if (
      transportError?.category === 'CONNECTION_RESET' ||
      transportError?.code === 'ECONNRESET' ||
      transportError?.message?.includes('reset')
    ) {
      attemptDisposition = 'CONNECTION_RESET'
      transportRetryable = true
    } else {
      attemptDisposition = 'NETWORK_ERROR'
      transportRetryable = false
    }
  } else {
    const extractedText = extractVerifierText(rawResponse)
    pipelineRes = validateVerifierV13OutputPipeline(extractedText, schema)
    attemptDisposition = pipelineRes.disposition
    outputRetryEligible = pipelineRes.outputRetryEligible
  }

  let promptDriftExceeded = false
  if (usageMetadata && calibrated && typeof calibrated.countedInputTokens === 'number') {
    const inputTokens = usageMetadata.promptTokenCount ?? 0
    if (inputTokens > calibrated.countedInputTokens * 1.05) {
      promptDriftExceeded = true
    }
  }

  const attemptRecord = {
    candidateId,
    attemptIndex,
    requestHash,
    httpStatus,
    attemptDisposition,
    transportRetryable,
    outputRetryEligible,
    callCostUsd,
    usageMetadata,
    rawResponseSha256,
    rawTextLength: rawResponse ? rawResponse.length : 0,
    parsed: pipelineRes ? pipelineRes.parsed : null,
    promptDriftExceeded,
  }

  return {
    attemptRecord,
    promptDriftExceeded,
  }
}

/**
 * Main Candidate v1.3 Retrospective Replay Orchestrator.
 * Fully testable offline with injected fetchImpl.
 */
export async function runVerifierV13RetrospectiveReplay({
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot: root = repoRoot,
  executionDir = EXECUTION_DIR,
  tokenManifestPath = TOKEN_MANIFEST_PATH,
  cohortPath = COHORT_MANIFEST_PATH,
  maxCandidates = Infinity,
  timeoutMs = FROZEN_MODEL_CONFIG.timeoutMs,
  enforceFrozenBindings = true,
} = {}) {
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: auth.reason,
      detail: auth.detail,
      networkCallsAttempted: 0,
    }
  }

  const modelResolution = resolveModelConfiguration({ env })
  if (!modelResolution.credentialAvailable) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: 'MISSING_CREDENTIAL',
      detail: 'GEMINI_API_KEY is required.',
      networkCallsAttempted: 0,
    }
  }

  // Load candidate prompt and schema
  const promptText = await readFile(path.isAbsolute(CANDIDATE_PROMPT_PATH) ? CANDIDATE_PROMPT_PATH : path.join(root, CANDIDATE_PROMPT_PATH), 'utf8')
  const schemaRaw = await readFile(path.isAbsolute(CANDIDATE_SCHEMA_PATH) ? CANDIDATE_SCHEMA_PATH : path.join(root, CANDIDATE_SCHEMA_PATH), 'utf8')
  const schema = JSON.parse(schemaRaw)

  // Audit provider schema keywords to ensure zero unsupported keywords
  const keywordViolations = auditProviderSchemaKeywords(schema)
  if (keywordViolations.length > 0) {
    const err = new Error(`Provider schema keyword audit failed: ${JSON.stringify(keywordViolations)}`)
    err.code = 'DISALLOWED_PROVIDER_SCHEMA_KEYWORD'
    throw err
  }

  // Load cohort manifest
  const cohortRaw = await readFile(path.isAbsolute(cohortPath) ? cohortPath : path.join(root, cohortPath), 'utf8')
  const cohort = JSON.parse(cohortRaw)

  // Token calibration is REQUIRED, not optional
  let tokenManifestRes
  try {
    tokenManifestRes = await loadAndValidateTokenManifest({
      tokenManifestPath: path.isAbsolute(tokenManifestPath) ? tokenManifestPath : path.join(root, tokenManifestPath),
      cohort,
      enforceFrozenBindings,
    })
  } catch (err) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: err.code || 'TOKEN_MANIFEST_INVALID',
      detail: err.message,
      networkCallsAttempted: 0,
    }
  }

  const calibratedTokensMap = tokenManifestRes.calibratedMap

  await mkdir(executionDir, { recursive: true })

  let accumulatedCostUsd = 0
  let primaryCalls = 0
  let technicalRetries = 0
  let totalExternalCalls = 0
  let systemicInvalidCount = 0
  let stoppedReason = null
  let severeCaseOutcome = 'NOT_EVALUATED'
  let batchRetryStatus = 'ACTIVE'

  const candidatesCompleted = []
  const candidateDispositions = {}
  const candidateActiveRetries = {}

  // Reconstruction scan from durable artifacts on disk
  for (const item of cohort.records) {
    const candidateId = item.candidateId
    const candidateDir = path.join(executionDir, candidateId)
    const statePath = path.join(candidateDir, 'candidate-state.json')

    if (!existsSync(statePath)) {
      continue
    }

    let state
    try {
      state = JSON.parse(await readFile(statePath, 'utf8'))
    } catch {
      continue
    }

    // Reconstruct calls from attempt files on disk
    let attemptIdx = 1
    let lastValidAttemptRecord = null

    while (true) {
      const rawPath = path.join(candidateDir, `attempt-${attemptIdx}.raw.json`)
      const jsonPath = path.join(candidateDir, `attempt-${attemptIdx}.json`)

      if (!existsSync(rawPath) && !existsSync(jsonPath)) {
        break
      }

      totalExternalCalls += 1
      if (attemptIdx === 1) {
        primaryCalls += 1
      } else {
        technicalRetries += 1
        if (technicalRetries >= FROZEN_CALL_LIMITS.maxTechnicalRetriesBatch) {
          batchRetryStatus = 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH'
        }
      }

      // Crash A / Crash B recovery: raw exists but json missing
      if (existsSync(rawPath) && !existsSync(jsonPath)) {
        let rawData
        try {
          rawData = JSON.parse(await readFile(rawPath, 'utf8'))
        } catch (err) {
          state.state = CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE
          state.ambiguousReason = `Corrupted raw attempt artifact: ${err.message}`
          await atomicWriteJson(statePath, state)
          stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
          break
        }

        const calibrated = calibratedTokensMap.get(candidateId)
        if (
          rawData.candidateId !== candidateId ||
          rawData.attemptIndex !== attemptIdx ||
          rawData.requestHash !== calibrated?.requestHash
        ) {
          state.state = CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE
          state.ambiguousReason = 'Persisted raw evidence metadata mismatch on resume.'
          await atomicWriteJson(statePath, state)
          stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
          break
        }

        const derived = deriveAttemptRecordFromRaw({
          rawEvidence: rawData,
          schema,
          calibrated,
        })
        await atomicWriteJson(jsonPath, derived.attemptRecord, { refuseOverwrite: true })
      }

      if (existsSync(jsonPath)) {
        try {
          const aJson = JSON.parse(await readFile(jsonPath, 'utf8'))
          lastValidAttemptRecord = aJson
          if (typeof aJson.callCostUsd === 'number') {
            accumulatedCostUsd += aJson.callCostUsd
          }
        } catch {}
      }

      attemptIdx += 1
    }

    if (stoppedReason) {
      break
    }

    // Check for ambiguous dispatch state on recovery
    if (state.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
      stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
      break
    }

    const currentAttemptIdx = state.currentAttempt || 1
    const currentRawPath = path.join(candidateDir, `attempt-${currentAttemptIdx}.raw.json`)

    if (state.state === CANDIDATE_STATES.DISPATCH_STARTED && !existsSync(currentRawPath)) {
      state.state = CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE
      state.ambiguousReason = `Crash recovery: DISPATCH_STARTED for attempt ${currentAttemptIdx} without durable raw response.`
      await atomicWriteJson(statePath, state)
      stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
      break
    }

    // Advance state if DISPATCH_STARTED or RESPONSE_PERSISTED
    if (
      state.state === CANDIDATE_STATES.DISPATCH_STARTED ||
      state.state === CANDIDATE_STATES.RESPONSE_PERSISTED
    ) {
      if (lastValidAttemptRecord) {
        if (state.state === CANDIDATE_STATES.DISPATCH_STARTED) {
          state.state = CANDIDATE_STATES.RESPONSE_PERSISTED
          await atomicWriteJson(statePath, state)
        }

        if (lastValidAttemptRecord.promptDriftExceeded) {
          state.state = CANDIDATE_STATES.COMPLETED
          state.finalDisposition = lastValidAttemptRecord.attemptDisposition
          state.completedAt = new Date().toISOString()
          await atomicWriteJson(statePath, state)
          stoppedReason = 'STOP_IF_UNEXPECTED_PROMPT_DRIFT'
        } else {
          const candidateRetriesSoFar = lastValidAttemptRecord.attemptIndex - 1
          const canRetry =
            (lastValidAttemptRecord.transportRetryable || lastValidAttemptRecord.outputRetryEligible) &&
            shouldRetryError({
              errorCode: lastValidAttemptRecord.attemptDisposition,
              candidateRetries: candidateRetriesSoFar,
              batchRetries: technicalRetries,
              totalCalls: totalExternalCalls,
            })

          if (!canRetry) {
            state.state = CANDIDATE_STATES.COMPLETED
            state.finalDisposition = lastValidAttemptRecord.attemptDisposition
            state.completedAt = new Date().toISOString()
            await atomicWriteJson(statePath, state)
          } else {
            candidateActiveRetries[candidateId] = candidateRetriesSoFar + 1
          }
        }
      }
    }

    if (state.state === CANDIDATE_STATES.COMPLETED) {
      candidatesCompleted.push(candidateId)
      candidateDispositions[candidateId] = state.finalDisposition

      if (state.finalDisposition === 'SCHEMA_INVALID' || state.finalDisposition === 'SEMANTICALLY_INVALID') {
        systemicInvalidCount += 1
      }

      if (candidateId === 'scale500-tmdb-14283') {
        if (state.finalDisposition === 'VALID_HIGH_RISK') {
          severeCaseOutcome = 'DETECTED_HIGH_RISK'
        } else if (state.finalDisposition === 'VALID_LOW_RISK') {
          severeCaseOutcome = 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE'
          stoppedReason = 'STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE'
          break
        } else {
          severeCaseOutcome = 'CONTAINED_NOT_DETECTED'
        }
      }
    }
  }

  // If already stopped after recovery scan, emit ledger and return
  if (stoppedReason) {
    const recoveryLedger = {
      activity: 'RETROSPECTIVE_DEVELOPMENT_REPLAY_V1_3',
      modelId: 'gemini-3.8-flash',
      maxOutputTokens: 6144,
      status: 'STOPPED',
      stoppedReason,
      severeCaseOutcome,
      batchRetryStatus,
      candidatesPlanned: 30,
      candidatesCompletedCount: candidatesCompleted.length,
      candidatesCompleted,
      candidateDispositions,
      callAccounting: {
        primaryCalls,
        technicalRetries,
        totalExternalCalls,
        accumulatedCostUsd,
        governedPreDispatchCostCeilingUsd: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
      },
      systemicInvalidCount,
    }
    await atomicWriteJson(path.join(executionDir, 'execution-ledger.json'), recoveryLedger)
    return {
      ok: true,
      executionLedger: recoveryLedger,
    }
  }

  for (const item of cohort.records) {
    if (candidatesCompleted.length >= maxCandidates) {
      break
    }

    const candidateId = item.candidateId
    const tmdbId = item.tmdbId

    // Skip already completed candidates on resume
    if (candidatesCompleted.includes(candidateId)) {
      continue
    }

    // Calibrated tokens map lookup
    const calibrated = calibratedTokensMap.get(candidateId)
    const nextCallCostReserve = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd

    // Pre-dispatch cost check
    if (!checkPreDispatchAffordability({
      accumulatedCost: accumulatedCostUsd,
      nextCallEstimate: nextCallCostReserve,
      costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
    })) {
      stoppedReason = 'STOP_IF_COST_EXCEEDS_CEILING'
      break
    }

    if (totalExternalCalls >= FROZEN_CALL_LIMITS.maxTheoreticalCalls) {
      stoppedReason = 'STOP_IF_CALL_COUNT_EXCEEDS_CAP'
      break
    }

    if (systemicInvalidCount >= 6) {
      stoppedReason = 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6'
      break
    }

    // Build model-visible packet
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

    // Token-count requestHash verification
    if (calibrated.requestHash !== req.requestMetadata.requestHash) {
      stoppedReason = 'STOP_IF_CALIBRATED_HASH_MISMATCH'
      break
    }

    const candidateDir = path.join(executionDir, candidateId)
    const candidateStatePath = path.join(candidateDir, 'candidate-state.json')
    await mkdir(candidateDir, { recursive: true })

    // Check candidate state before dispatch
    if (existsSync(candidateStatePath)) {
      const existingCandidateState = JSON.parse(await readFile(candidateStatePath, 'utf8'))
      if (existingCandidateState.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
        stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
        break
      }
      if (existingCandidateState.state === CANDIDATE_STATES.DISPATCH_STARTED) {
        const rawPath = path.join(candidateDir, `attempt-${existingCandidateState.currentAttempt || 1}.raw.json`)
        if (!existsSync(rawPath)) {
          existingCandidateState.state = CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE
          existingCandidateState.ambiguousReason = `DISPATCH_STARTED without durable raw response.`
          await atomicWriteJson(candidateStatePath, existingCandidateState)
          stoppedReason = 'STOP_AMBIGUOUS_DISPATCH_STATE'
          break
        }
      }
    }

    let candidateRetries = candidateActiveRetries[candidateId] || 0
    let finalDisposition = null
    let completedCandidate = false

    while (!completedCandidate) {
      const isRetry = candidateRetries > 0

      // If retry, verify retry allowances
      if (isRetry) {
        if (technicalRetries >= FROZEN_CALL_LIMITS.maxTechnicalRetriesBatch) {
          batchRetryStatus = 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH'
          break
        }
        if (candidateRetries > FROZEN_CALL_LIMITS.maxRetriesPerCandidate) {
          break
        }
      }

      // Check cost before retry/dispatch
      if (!checkPreDispatchAffordability({
        accumulatedCost: accumulatedCostUsd,
        nextCallEstimate: nextCallCostReserve,
        costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
      })) {
        stoppedReason = 'STOP_IF_COST_EXCEEDS_CEILING'
        break
      }

      const attemptIndex = candidateRetries + 1
      const attemptRawPath = path.join(candidateDir, `attempt-${attemptIndex}.raw.json`)
      const attemptJsonPath = path.join(candidateDir, `attempt-${attemptIndex}.json`)

      // Refuse overwrite if attempt artifacts already exist
      if (existsSync(attemptRawPath) || existsSync(attemptJsonPath)) {
        const err = new Error(`Attempt ${attemptIndex} artifacts already exist for ${candidateId}; refusing overwrite.`)
        err.code = 'REFUSE_OVERWRITE'
        throw err
      }

      // Lifecycle 1: PRE_DISPATCH
      const candidateState = {
        candidateId,
        tmdbId,
        requestHash: req.requestMetadata.requestHash,
        state: CANDIDATE_STATES.PRE_DISPATCH,
        currentAttempt: attemptIndex,
        startedAt: new Date().toISOString(),
      }
      await atomicWriteJson(candidateStatePath, candidateState)

      // Lifecycle 2: DISPATCH_STARTED
      const dispatchedAt = new Date().toISOString()
      candidateState.state = CANDIDATE_STATES.DISPATCH_STARTED
      candidateState.dispatchedAt = dispatchedAt
      await atomicWriteJson(candidateStatePath, candidateState)

      let httpStatus = null
      let rawText = ''
      let fetchError = null
      let resp = null

      totalExternalCalls += 1
      if (isRetry) {
        technicalRetries += 1
        if (technicalRetries === FROZEN_CALL_LIMITS.maxTechnicalRetriesBatch) {
          batchRetryStatus = 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH'
        }
      } else {
        primaryCalls += 1
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        resp = await fetchImpl(req.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify(req.body),
          signal: controller.signal,
        })

        httpStatus = resp.status
        rawText = await resp.text()
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          fetchError = new Error(`Request timed out after ${timeoutMs}ms`)
          fetchError.code = 'NETWORK_TIMEOUT'
          fetchError.isTimeout = true
        } else {
          fetchError = err
        }
      } finally {
        clearTimeout(timer)
      }

      // Lifecycle 3: RESPONSE_PERSISTED (durable write of exact raw evidence BEFORE ANY parsing/interpreting)
      const receivedAt = new Date().toISOString()
      const rawResponseSha256 = rawText ? sha256Bytes(Buffer.from(rawText, 'utf8')) : null

      const rawEvidence = {
        candidateId,
        attemptIndex,
        requestHash: req.requestMetadata.requestHash,
        httpStatus,
        status: httpStatus,
        ok: resp ? resp.ok : false,
        rawResponse: rawText || null,
        rawResponseText: rawText || null,
        rawResponseSha256,
        rawResponseHash: rawResponseSha256,
        transportError: fetchError
          ? {
              message: fetchError.message,
              code: fetchError.code,
              name: fetchError.name,
              category:
                fetchError.code === 'NETWORK_TIMEOUT' || fetchError.isTimeout
                  ? 'NETWORK_TIMEOUT'
                  : fetchError.code === 'ECONNRESET'
                    ? 'CONNECTION_RESET'
                    : 'NETWORK_ERROR',
            }
          : null,
        error: fetchError
          ? {
              message: fetchError.message,
              code: fetchError.code,
              name: fetchError.name,
            }
          : null,
        dispatchedAt,
        receivedAt,
      }

      await atomicWriteJson(attemptRawPath, rawEvidence, { refuseOverwrite: true })

      candidateState.state = CANDIDATE_STATES.RESPONSE_PERSISTED
      await atomicWriteJson(candidateStatePath, candidateState)

      // Lifecycle 4: Derived attempt record from persisted raw evidence
      const derived = deriveAttemptRecordFromRaw({
        rawEvidence,
        schema,
        calibrated,
      })
      const attemptRecord = derived.attemptRecord

      await atomicWriteJson(attemptJsonPath, attemptRecord, { refuseOverwrite: true })
      accumulatedCostUsd += attemptRecord.callCostUsd

      // Hard stop on unexpected prompt drift
      if (derived.promptDriftExceeded) {
        stoppedReason = 'STOP_IF_UNEXPECTED_PROMPT_DRIFT'
        finalDisposition = attemptRecord.attemptDisposition
        completedCandidate = true
        candidateState.state = CANDIDATE_STATES.COMPLETED
        candidateState.finalDisposition = finalDisposition
        candidateState.completedAt = new Date().toISOString()
        await atomicWriteJson(candidateStatePath, candidateState)
        break
      }

      // Severe case tracking on candidate scale500-tmdb-14283
      if (candidateId === 'scale500-tmdb-14283') {
        if (attemptRecord.attemptDisposition === 'VALID_HIGH_RISK') {
          severeCaseOutcome = 'DETECTED_HIGH_RISK'
        } else if (attemptRecord.attemptDisposition === 'VALID_LOW_RISK') {
          severeCaseOutcome = 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE'
          stoppedReason = 'STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE'
          finalDisposition = attemptRecord.attemptDisposition
          completedCandidate = true
          candidateState.state = CANDIDATE_STATES.COMPLETED
          candidateState.finalDisposition = finalDisposition
          candidateState.completedAt = new Date().toISOString()
          await atomicWriteJson(candidateStatePath, candidateState)
          break
        } else {
          severeCaseOutcome = 'CONTAINED_NOT_DETECTED'
        }
      }

      // Retry decision
      const retryEligible = attemptRecord.transportRetryable || attemptRecord.outputRetryEligible
      const canRetry =
        retryEligible &&
        shouldRetryError({
          errorCode: attemptRecord.attemptDisposition,
          candidateRetries,
          batchRetries: technicalRetries,
          totalCalls: totalExternalCalls,
        })

      if (canRetry) {
        candidateRetries += 1
      } else {
        finalDisposition = attemptRecord.attemptDisposition
        completedCandidate = true
        candidateState.state = CANDIDATE_STATES.COMPLETED
        candidateState.finalDisposition = finalDisposition
        candidateState.completedAt = new Date().toISOString()
        await atomicWriteJson(candidateStatePath, candidateState)
      }
    }

    if (completedCandidate) {
      candidateDispositions[candidateId] = finalDisposition
      candidatesCompleted.push(candidateId)

      if (finalDisposition === 'SCHEMA_INVALID' || finalDisposition === 'SEMANTICALLY_INVALID') {
        systemicInvalidCount += 1
      }
    }

    if (stoppedReason) {
      break
    }
  }

  // Final summary ledger
  const executionLedger = {
    activity: 'RETROSPECTIVE_DEVELOPMENT_REPLAY_V1_3',
    modelId: 'gemini-3.8-flash',
    maxOutputTokens: 6144,
    status: stoppedReason ? 'STOPPED' : 'COMPLETED',
    stoppedReason,
    severeCaseOutcome,
    batchRetryStatus,
    candidatesPlanned: 30,
    candidatesCompletedCount: candidatesCompleted.length,
    candidatesCompleted,
    candidateDispositions,
    callAccounting: {
      primaryCalls,
      technicalRetries,
      totalExternalCalls,
      accumulatedCostUsd,
      governedPreDispatchCostCeilingUsd: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
    },
    systemicInvalidCount,
  }

  await atomicWriteJson(path.join(executionDir, 'execution-ledger.json'), executionLedger)

  return {
    ok: true,
    executionLedger,
  }
}

/**
 * Real Preflight Checker.
 * Validates contracts, manifests, token calibration, credentials, and affordability.
 * Makes EXACTLY ZERO network/model calls.
 */
export async function runVerifierV13Preflight({
  env = process.env,
  repoRoot: root = repoRoot,
  tokenManifestPath = TOKEN_MANIFEST_PATH,
  cohortPath = COHORT_MANIFEST_PATH,
  executionDir = EXECUTION_DIR,
  enforceFrozenBindings = true,
} = {}) {
  const auth = verifyExecutionAuthorization({ env })
  const modelRes = resolveModelConfiguration({ env })

  // 1. Candidate artifacts
  const promptText = await readFile(
    path.isAbsolute(CANDIDATE_PROMPT_PATH) ? CANDIDATE_PROMPT_PATH : path.join(root, CANDIDATE_PROMPT_PATH),
    'utf8'
  )
  const schemaRaw = await readFile(
    path.isAbsolute(CANDIDATE_SCHEMA_PATH) ? CANDIDATE_SCHEMA_PATH : path.join(root, CANDIDATE_SCHEMA_PATH),
    'utf8'
  )
  const schema = JSON.parse(schemaRaw)
  const keywordViolations = auditProviderSchemaKeywords(schema)

  // 2. Cohort manifest
  const cohortRaw = await readFile(
    path.isAbsolute(cohortPath) ? cohortPath : path.join(root, cohortPath),
    'utf8'
  )
  const cohort = JSON.parse(cohortRaw)

  // 3. Token calibration manifest validation
  let tokenManifestValidation
  try {
    tokenManifestValidation = await loadAndValidateTokenManifest({
      tokenManifestPath: path.isAbsolute(tokenManifestPath) ? tokenManifestPath : path.join(root, tokenManifestPath),
      cohort,
      enforceFrozenBindings,
    })
  } catch (err) {
    return {
      ok: false,
      status: 'PREFLIGHT_BLOCKED',
      reason: err.code || 'TOKEN_MANIFEST_INVALID',
      detail: err.message,
      networkCallsAttempted: 0,
    }
  }

  // 4. Budget check for first candidate
  const initialReserve = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
  const affordable = checkPreDispatchAffordability({
    accumulatedCost: 0,
    nextCallEstimate: initialReserve,
    costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
  })

  const ok = auth.authorized && modelRes.credentialAvailable && keywordViolations.length === 0 && affordable

  return {
    ok,
    status: ok ? 'PREFLIGHT_PASSED' : 'PREFLIGHT_BLOCKED',
    authorization: auth,
    credentialStatus: modelRes.credentialStatus,
    schemaKeywordViolations: keywordViolations,
    cohortCandidatesCount: cohort.records.length,
    calibratedCandidatesCount: tokenManifestValidation.calibratedMap.size,
    initialCostReserveUsd: initialReserve,
    costCeilingUsd: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
    networkCallsAttempted: 0,
  }
}

/**
 * Real Dry-Run Checker.
 * Runs preflight and builds all 30 candidate requests without sending them.
 * Verifies leakage, requestHash parity, and pre-dispatch cost reserves.
 * Makes EXACTLY ZERO network/model calls.
 */
export async function runVerifierV13DryRun({
  env = process.env,
  repoRoot: root = repoRoot,
  tokenManifestPath = TOKEN_MANIFEST_PATH,
  executionDir = EXECUTION_DIR,
} = {}) {
  const preflight = await runVerifierV13Preflight({ env, repoRoot: root, tokenManifestPath, executionDir })
  if (!preflight.ok) {
    return {
      ok: false,
      status: 'DRY_RUN_BLOCKED',
      preflight,
      networkCallsAttempted: 0,
    }
  }

  const cohortRaw = await readFile(
    path.isAbsolute(COHORT_MANIFEST_PATH) ? COHORT_MANIFEST_PATH : path.join(root, COHORT_MANIFEST_PATH),
    'utf8'
  )
  const cohort = JSON.parse(cohortRaw)
  const promptText = await readFile(
    path.isAbsolute(CANDIDATE_PROMPT_PATH) ? CANDIDATE_PROMPT_PATH : path.join(root, CANDIDATE_PROMPT_PATH),
    'utf8'
  )
  const schemaRaw = await readFile(
    path.isAbsolute(CANDIDATE_SCHEMA_PATH) ? CANDIDATE_SCHEMA_PATH : path.join(root, CANDIDATE_SCHEMA_PATH),
    'utf8'
  )
  const schema = JSON.parse(schemaRaw)

  const tokenManifestRes = await loadAndValidateTokenManifest({
    tokenManifestPath: path.isAbsolute(tokenManifestPath) ? tokenManifestPath : path.join(root, tokenManifestPath),
    cohort,
  })

  let accumulatedReserveUsd = 0
  const candidateChecks = []

  for (const item of cohort.records) {
    const fullInputPath = path.isAbsolute(item.sourceRiskInputPath)
      ? item.sourceRiskInputPath
      : path.join(root, item.sourceRiskInputPath)
    const riskInputRaw = await readFile(fullInputPath, 'utf8')
    const riskInput = JSON.parse(riskInputRaw)

    const packet = buildVerifierV13ReplayPacket(riskInput)
    const leakage = scanForForbiddenKeys(packet)
    if (leakage.length > 0) {
      throw new Error(`Leakage detected for ${item.candidateId}: ${JSON.stringify(leakage)}`)
    }

    const req = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
    })

    const calibrated = tokenManifestRes.calibratedMap.get(item.candidateId)
    if (calibrated.requestHash !== req.requestMetadata.requestHash) {
      throw new Error(
        `requestHash mismatch for ${item.candidateId}: expected ${calibrated.requestHash}, got ${req.requestMetadata.requestHash}`
      )
    }

    const reserve = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
    accumulatedReserveUsd += reserve

    candidateChecks.push({
      candidateId: item.candidateId,
      requestHash: req.requestMetadata.requestHash,
      countedInputTokens: calibrated.countedInputTokens,
      nextCallReserveUsd: reserve,
    })
  }

  return {
    ok: true,
    status: 'DRY_RUN_PASSED',
    totalCandidates: candidateChecks.length,
    dispatchesAttempted: 0,
    accumulatedEstimatedMaxCostUsd: Math.round(accumulatedReserveUsd * 1e6) / 1e6,
    costCeilingUsd: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
    candidateChecks,
    networkCallsAttempted: 0,
  }
}

/**
 * Auditable CLI Entrypoint.
 * Usage: node catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs <preflight|dry-run|run>
 */
export async function main() {
  const subcommand = process.argv[2]
  if (!['preflight', 'dry-run', 'run'].includes(subcommand)) {
    console.error(
      'Invalid or missing CLI command. Usage: node catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs <preflight|dry-run|run>'
    )
    process.exitCode = 1
    return { ok: false, status: 'INVALID_CLI_COMMAND' }
  }

  if (subcommand === 'preflight') {
    const res = await runVerifierV13Preflight({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok ? 0 : 1
    return res
  }

  if (subcommand === 'dry-run') {
    const res = await runVerifierV13DryRun({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok ? 0 : 1
    return res
  }

  if (subcommand === 'run') {
    const res = await runVerifierV13RetrospectiveReplay({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok && res.executionLedger?.status === 'COMPLETED' ? 0 : 1
    return res
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`Fatal error in verifier v1.3 runner: ${err.message}`)
    process.exitCode = 1
  })
}
