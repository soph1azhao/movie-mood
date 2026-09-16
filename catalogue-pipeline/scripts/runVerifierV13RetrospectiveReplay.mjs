import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
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

export const VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN = 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY_V1_3'

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
  'NETWORK_ERROR',
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
      disposition: 'MALFORMED_JSON',
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
      disposition: 'MALFORMED_JSON',
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
 * Main Candidate v1.3 Retrospective Replay Orchestrator.
 * Fully testable offline with injected fetchImpl.
 */
export async function runVerifierV13RetrospectiveReplay({
  env = process.env,
  fetchImpl = globalThis.fetch,
  repoRoot: root = repoRoot,
  executionDir = EXECUTION_DIR,
  tokenManifestPath = TOKEN_MANIFEST_PATH,
} = {}) {
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: auth.reason,
      detail: auth.detail,
    }
  }

  const modelResolution = resolveModelConfiguration({ env })
  if (!modelResolution.credentialAvailable) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: 'MISSING_CREDENTIAL',
      detail: 'GEMINI_API_KEY is required.',
    }
  }

  // Load candidate prompt and schema
  const promptText = await readFile(CANDIDATE_PROMPT_PATH, 'utf8')
  const schemaRaw = await readFile(CANDIDATE_SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(schemaRaw)

  // Audit provider schema keywords to ensure zero unsupported keywords
  const keywordViolations = auditProviderSchemaKeywords(schema)
  if (keywordViolations.length > 0) {
    const err = new Error(`Provider schema keyword audit failed: ${JSON.stringify(keywordViolations)}`)
    err.code = 'DISALLOWED_PROVIDER_SCHEMA_KEYWORD'
    throw err
  }

  // Load cohort manifest
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)

  // Load token manifest if present
  let tokenManifest = null
  if (existsSync(tokenManifestPath)) {
    try {
      tokenManifest = JSON.parse(await readFile(tokenManifestPath, 'utf8'))
    } catch {}
  }

  const calibratedTokensMap = new Map()
  if (tokenManifest && Array.isArray(tokenManifest.records)) {
    for (const r of tokenManifest.records) {
      if (r.candidateId) calibratedTokensMap.set(r.candidateId, r)
    }
  }

  await mkdir(executionDir, { recursive: true })

  let accumulatedCostUsd = 0
  let primaryCalls = 0
  let technicalRetries = 0
  let totalExternalCalls = 0
  let systemicInvalidCount = 0
  let stoppedReason = null
  let severeCaseOutcome = null
  let batchRetryStatus = 'ACTIVE'

  const candidatesCompleted = []
  const candidateDispositions = {}

  for (const item of cohort.records) {
    const candidateId = item.candidateId
    const tmdbId = item.tmdbId

    // Pre-dispatch reserve determination
    let nextCallCostReserve = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
    const calibrated = calibratedTokensMap.get(candidateId)
    if (calibrated && typeof calibrated.countedInputTokens === 'number') {
      nextCallCostReserve = (calibrated.countedInputTokens / 1e6 * 0.75) + (6144 / 1e6 * 3.75)
    }

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

    // Token-count requestHash verification if calibration is bound
    if (calibrated && calibrated.requestHash !== req.requestMetadata.requestHash) {
      stoppedReason = 'STOP_IF_CALIBRATED_HASH_MISMATCH'
      break
    }

    const candidateDir = path.join(executionDir, candidateId)
    await mkdir(candidateDir, { recursive: true })

    let candidateRetries = 0
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
      const attemptFileName = `attempt-${attemptIndex}.json`
      const attemptFilePath = path.join(candidateDir, attemptFileName)

      let httpStatus = null
      let rawText = ''
      let fetchError = null
      let usageMetadata = null

      totalExternalCalls += 1
      if (isRetry) {
        technicalRetries += 1
        if (technicalRetries === FROZEN_CALL_LIMITS.maxTechnicalRetriesBatch) {
          batchRetryStatus = 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH'
        }
      } else {
        primaryCalls += 1
      }

      try {
        const resp = await fetchImpl(req.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify(req.body),
        })

        httpStatus = resp.status
        rawText = await resp.text()

        if (resp.ok) {
          try {
            const parsedEnvelope = JSON.parse(rawText)
            usageMetadata = parsedEnvelope?.usageMetadata ?? null
          } catch {}
        }
      } catch (err) {
        fetchError = err
      }

      // Cost calculation
      let callCostUsd = 0
      if (usageMetadata) {
        const inputTokens = usageMetadata.promptTokenCount ?? 0
        const outputTokens = usageMetadata.candidatesTokenCount ?? 0
        const thinkingTokens = usageMetadata.thinkingTokenCount ?? 0
        const costRes = calculateCallCost({ inputTokens, outputTokens, thinkingTokens })
        callCostUsd = costRes.totalCost
        accumulatedCostUsd += callCostUsd

        // Check prompt token drift if calibration was active
        if (calibrated && typeof calibrated.countedInputTokens === 'number') {
          if (inputTokens > calibrated.countedInputTokens * 1.05) {
            stoppedReason = 'STOP_IF_UNEXPECTED_PROMPT_DRIFT'
          }
        }
      } else {
        // Fallback cost accounting for failed calls without usageMetadata
        accumulatedCostUsd += 0.0025
      }

      let attemptDisposition = null
      let transportRetryable = false
      let outputRetryEligible = false

      if (fetchError || (httpStatus !== null && httpStatus !== 200)) {
        if (httpStatus === 429) {
          attemptDisposition = 'HTTP_429_RATE_LIMIT'
          transportRetryable = true
        } else if (httpStatus === 500) {
          attemptDisposition = 'HTTP_500_SERVER_ERROR'
          transportRetryable = true
        } else if (httpStatus === 503) {
          attemptDisposition = 'HTTP_503_SERVICE_UNAVAILABLE'
          transportRetryable = true
        } else if (fetchError?.code === 'ETIMEDOUT' || fetchError?.message?.includes('timeout')) {
          attemptDisposition = 'NETWORK_TIMEOUT'
          transportRetryable = true
        } else if (fetchError?.code === 'ECONNRESET' || fetchError?.message?.includes('reset')) {
          attemptDisposition = 'CONNECTION_RESET'
          transportRetryable = true
        } else {
          attemptDisposition = httpStatus ? `HTTP_${httpStatus}` : 'NETWORK_ERROR'
          transportRetryable = false
        }
      } else {
        // HTTP 200: extract verifier text
        const extractedText = extractVerifierText(rawText)
        const pipelineRes = validateVerifierV13OutputPipeline(extractedText, schema)
        attemptDisposition = pipelineRes.disposition
        outputRetryEligible = pipelineRes.outputRetryEligible
      }

      const attemptRecord = {
        attemptIndex,
        isRetry,
        httpStatus,
        attemptDisposition,
        transportRetryable,
        outputRetryEligible,
        callCostUsd,
        usageMetadata,
        rawTextLength: rawText.length,
      }

      await writeFile(attemptFilePath, JSON.stringify(attemptRecord, null, 2) + '\n', 'utf8')

      // Severe case stop check
      if (candidateId === 'scale500-tmdb-14283' && attemptDisposition === 'VALID_LOW_RISK') {
        severeCaseOutcome = 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE'
        stoppedReason = 'STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE'
        finalDisposition = attemptDisposition
        completedCandidate = true
        break
      }

      // Check if retry should be dispatched
      const retryEligible = transportRetryable || outputRetryEligible
      const canRetry = retryEligible && shouldRetryError({
        errorCode: attemptDisposition,
        candidateRetries,
        batchRetries: technicalRetries,
        totalCalls: totalExternalCalls,
      })

      if (canRetry) {
        candidateRetries += 1
      } else {
        finalDisposition = attemptDisposition
        completedCandidate = true
      }
    }

    candidateDispositions[candidateId] = finalDisposition
    candidatesCompleted.push(candidateId)

    if (finalDisposition === 'SCHEMA_INVALID' || finalDisposition === 'SEMANTICALLY_INVALID') {
      systemicInvalidCount += 1
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
    severeCaseOutcome: severeCaseOutcome ?? 'SEVERE_DEFECT_FLAGGED_OR_CONTAINED',
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

  await writeFile(path.join(executionDir, 'execution-ledger.json'), JSON.stringify(executionLedger, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    executionLedger,
  }
}
