import { existsSync } from 'node:fs'
import { readFile, mkdir, rename, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import {
  validateVerifierV13CandidatePayload,
} from './validateVerifierV13Contract.mjs'
import {
  buildVerifierV13ReplayPacket,
  buildCandidateV13GeminiRequest,
  extractVerifierText,
  validateJsonSchema,
  scanForForbiddenKeys,
} from './runVerifierV13RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const EXPERIMENT_DIR = path.join(
  repoRoot,
  'catalogue-pipeline/experiments/verifier-v1.3-low-thinking-technical-ablation'
)
export const EXECUTION_DIR = path.join(EXPERIMENT_DIR, 'execution')

export const PROTOCOL_PATH = path.join(EXPERIMENT_DIR, 'protocol.v1.json')
export const COHORT_PATH = path.join(EXPERIMENT_DIR, 'ablation-cohort.v1.json')
export const PROTOCOL_MD_PATH = path.join(EXPERIMENT_DIR, 'PROTOCOL.md')

export const CANDIDATE_PROMPT_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'
)
export const CANDIDATE_SCHEMA_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'
)
export const CANDIDATE_VALIDATOR_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/scripts/validateVerifierV13Contract.mjs'
)

export const PARENT_V13_PROTOCOL_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/protocol.v1.json'
)
export const PARENT_V13_LEDGER_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution/execution-ledger.json'
)
export const PARENT_V13_FREEZE_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution-evidence-freeze.v1.json'
)
export const PARENT_V13_RECONCILIATION_PATH = path.join(
  repoRoot,
  'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/retrospective-reconciliation.v1.json'
)

export const FROZEN_BINDINGS = Object.freeze({
  protocolByteHash: 'sha256:aa1dfcfd460ea573ae0dc7c0a8598d634a4920e431edb6f5cb37c371e3f52f89',
  cohortByteHash: 'sha256:aacdaebe5673753a7b01263a1c09cac8c83d338d7825fd1ce837e7d4cca3d163',
  candidatePromptByteHash: 'sha256:93c9a185620012609998ad8e58e4c68c9c945fd100820f2cc93c64385cdd402b',
  candidateSchemaByteHash: 'sha256:aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc',
  candidateValidatorByteHash: 'sha256:258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6',
  v13ProtocolByteHash: 'sha256:d481ed8ba04473fda7b5a39c34a5592d2faa98af06501f782d965268aed5cdf5',
  v13ExecutionLedgerByteHash: 'sha256:9a1e0098935807935d9124a148b92f5363bade6516d80f742f3e160fead76888',
  v13ExecutionEvidenceFreezeByteHash: 'sha256:8b738b05c4f35b7ff2e3d11592ef683e0b79e6f3ebf1004d9f0bf791be6d03a5',
  v13RetrospectiveReconciliationByteHash: 'sha256:553682aba547787787c65e6bfa2f7fb96e531d0d0d690f0737f08659dce1c18a',
  v13ReconciliationCommit: '196b08089e0faa02b4841a6ef4f2ebc4ed13da31',
  v13ReconciliationShortCommit: '196b080',
})

export const FROZEN_MODEL_CONFIG = Object.freeze({
  provider: 'google-gemini-developer-api',
  modelId: 'gemini-3.8-flash',
  thinkingLevel: 'low',
  maxOutputTokens: 6144,
  temperature: 0.0,
  timeoutMs: 30000,
})

export const FROZEN_CALL_LIMITS = Object.freeze({
  plannedPrimaryCalls: 4,
  maxRetries: 0,
  maxTotalCalls: 4,
  frozenNextCallCostReserveUsd: 0.026100,
  governedCostCeilingUsd: 0.150000,
  theoreticalMaxTotalCostUsd: 0.10201425,
})

export const EXPECTED_COHORT_CANDIDATE_IDS = Object.freeze([
  'scale500-tmdb-13398',
  'scale500-tmdb-1563',
  'scale500-tmdb-127533',
  'scale500-tmdb-9725',
])

export const VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY =
  'VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION'
export const VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN =
  'AUTHORIZE_V1_3_LOW_THINKING_TECHNICAL_ABLATION'

export const TECHNICAL_OUTCOMES = Object.freeze({
  SERIALIZATION_SUCCESS: 'SERIALIZATION_SUCCESS',
  MAX_TOKENS_TRUNCATION: 'MAX_TOKENS_TRUNCATION',
  MALFORMED_NON_MAX_TOKENS: 'MALFORMED_NON_MAX_TOKENS',
  TECHNICAL_TRANSPORT_FAILURE: 'TECHNICAL_TRANSPORT_FAILURE',
  AMBIGUOUS_DISPATCH_STATE: 'AMBIGUOUS_DISPATCH_STATE',
})

export const CANDIDATE_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  DISPATCH_STARTED: 'DISPATCH_STARTED',
  COMPLETED: 'COMPLETED',
  AMBIGUOUS_DISPATCH_STATE: 'AMBIGUOUS_DISPATCH_STATE',
})

export function sha256Bytes(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`
}

export function validateDurableRawEvidence({
  rawContent,
  expectedCandidateId,
  expectedRequestHash,
}) {
  let parsed = null
  if (typeof rawContent === 'string') {
    try {
      parsed = JSON.parse(rawContent)
    } catch (err) {
      return { ok: false, reason: 'RAW_FILE_INVALID_JSON', detail: `Failed to parse raw JSON: ${err.message}` }
    }
  } else if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
    parsed = rawContent
  } else {
    return { ok: false, reason: 'RAW_FILE_INVALID_STRUCTURE', detail: 'Raw evidence content is missing or invalid' }
  }

  if (parsed.candidateId !== expectedCandidateId) {
    return {
      ok: false,
      reason: 'CANDIDATE_ID_MISMATCH',
      detail: `Raw candidateId mismatch: expected ${expectedCandidateId}, got ${parsed.candidateId}`,
    }
  }

  if (parsed.attemptIndex !== 1) {
    return {
      ok: false,
      reason: 'ATTEMPT_INDEX_FORBIDDEN',
      detail: `Raw attemptIndex ${parsed.attemptIndex} is forbidden (must be 1)`,
    }
  }

  if (parsed.requestHash !== expectedRequestHash) {
    return {
      ok: false,
      reason: 'REQUEST_HASH_MISMATCH',
      detail: `Raw requestHash mismatch: expected ${expectedRequestHash}, got ${parsed.requestHash}`,
    }
  }

  if (parsed.httpStatus !== undefined && parsed.httpStatus !== null && typeof parsed.httpStatus !== 'number') {
    return {
      ok: false,
      reason: 'HTTP_STATUS_INVALID',
      detail: `Raw httpStatus must be number or null, got ${typeof parsed.httpStatus}`,
    }
  }

  if (parsed.transportError !== undefined && parsed.transportError !== null && typeof parsed.transportError !== 'object') {
    return {
      ok: false,
      reason: 'TRANSPORT_ERROR_INVALID',
      detail: `Raw transportError must be object or null, got ${typeof parsed.transportError}`,
    }
  }

  if (parsed.rawResponse !== null && typeof parsed.rawResponse !== 'string') {
    return {
      ok: false,
      reason: 'RAW_RESPONSE_TYPE_INVALID',
      detail: `Raw rawResponse must be string or null, got ${typeof parsed.rawResponse}`,
    }
  }

  if (typeof parsed.rawResponse === 'string') {
    const computedSha = sha256Bytes(Buffer.from(parsed.rawResponse, 'utf8'))
    if (parsed.rawResponseSha256 !== computedSha) {
      return {
        ok: false,
        reason: 'RAW_RESPONSE_SHA_MISMATCH',
        detail: `Raw response byte hash mismatch: expected ${computedSha}, got ${parsed.rawResponseSha256}`,
      }
    }
  } else if (parsed.rawResponse === null) {
    if (parsed.rawResponseSha256 !== null) {
      return {
        ok: false,
        reason: 'RAW_RESPONSE_SHA_MISMATCH',
        detail: `Raw response SHA must be null when rawResponse is null, got ${parsed.rawResponseSha256}`,
      }
    }
  }

  return { ok: true, rawEvidence: parsed }
}

export function validateDurableCandidateState({
  stateContent,
  expectedCandidateId,
  expectedRequestHash,
}) {
  let parsed = null
  if (typeof stateContent === 'string') {
    try {
      parsed = JSON.parse(stateContent)
    } catch (err) {
      return { ok: false, reason: 'INCONSISTENT_EXECUTION_EVIDENCE', detail: `Malformed candidate-state.json: ${err.message}` }
    }
  } else if (stateContent && typeof stateContent === 'object' && !Array.isArray(stateContent)) {
    parsed = stateContent
  } else {
    return { ok: false, reason: 'INCONSISTENT_EXECUTION_EVIDENCE', detail: 'State artifact missing or invalid' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
      detail: 'Candidate state must be a JSON object',
    }
  }

  if (!parsed.candidateId || parsed.candidateId !== expectedCandidateId) {
    return {
      ok: false,
      reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
      detail: `Candidate state candidateId mismatch: expected ${expectedCandidateId}, got ${parsed.candidateId}`,
    }
  }

  const validStates = Object.values(CANDIDATE_STATES)
  if (!validStates.includes(parsed.state)) {
    return {
      ok: false,
      reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
      detail: `Candidate state contains unknown state enum: ${parsed.state}`,
    }
  }

  if (parsed.attemptCount !== undefined && parsed.attemptCount !== 1) {
    return {
      ok: false,
      reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
      detail: `Candidate state attemptCount is invalid: expected 1, got ${parsed.attemptCount}`,
    }
  }

  if (parsed.requestHash !== undefined && parsed.requestHash !== expectedRequestHash) {
    return {
      ok: false,
      reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
      detail: `Candidate state requestHash mismatch: expected ${expectedRequestHash}, got ${parsed.requestHash}`,
    }
  }

  return { ok: true, stateRecord: parsed }
}

export async function atomicWriteJson(filePath, data, { refuseOverwrite = false } = {}) {
  if (refuseOverwrite && existsSync(filePath)) {
    const err = new Error(`Refusing to overwrite existing durable artifact: ${filePath}`)
    err.code = 'REFUSE_OVERWRITE'
    throw err
  }
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}.${randomBytes(6).toString('hex')}`
  await writeFileAtomicHelper(tmpPath, JSON.stringify(data, null, 2) + '\n')
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
  await writeFileAtomicHelper(tmpPath, content)
  await rename(tmpPath, filePath)
}

async function writeFileAtomicHelper(targetPath, data) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(targetPath, data, 'utf8')
}

export function isValidTokenCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function resolveUsageTokenCounts(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object' || Array.isArray(usageMetadata)) {
    return { valid: false, inputTokens: null, outputTokens: null, thinkingTokens: null }
  }

  const { promptTokenCount, candidatesTokenCount, thinkingTokenCount, thoughtsTokenCount } = usageMetadata

  if (!isValidTokenCount(promptTokenCount) || !isValidTokenCount(candidatesTokenCount)) {
    return { valid: false, inputTokens: null, outputTokens: null, thinkingTokens: null }
  }

  let thinkingTokens = 0
  const hasThinking = thinkingTokenCount !== undefined
  const hasThoughts = thoughtsTokenCount !== undefined

  if (hasThinking && hasThoughts) {
    if (
      !isValidTokenCount(thinkingTokenCount) ||
      !isValidTokenCount(thoughtsTokenCount) ||
      thinkingTokenCount !== thoughtsTokenCount
    ) {
      return { valid: false, inputTokens: null, outputTokens: null, thinkingTokens: null }
    }
    thinkingTokens = thinkingTokenCount
  } else if (hasThinking) {
    if (!isValidTokenCount(thinkingTokenCount)) {
      return { valid: false, inputTokens: null, outputTokens: null, thinkingTokens: null }
    }
    thinkingTokens = thinkingTokenCount
  } else if (hasThoughts) {
    if (!isValidTokenCount(thoughtsTokenCount)) {
      return { valid: false, inputTokens: null, outputTokens: null, thinkingTokens: null }
    }
    thinkingTokens = thoughtsTokenCount
  }

  return {
    valid: true,
    inputTokens: promptTokenCount,
    outputTokens: candidatesTokenCount,
    thinkingTokens,
  }
}

export function calculateCallCost({ inputTokens = 0, outputTokens = 0, thinkingTokens = 0 } = {}) {
  if (
    !isValidTokenCount(inputTokens) ||
    !isValidTokenCount(outputTokens) ||
    !isValidTokenCount(thinkingTokens)
  ) {
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    }
  }
  const inputCost = (inputTokens / 1_000_000) * 0.75
  const outputCost = ((outputTokens + thinkingTokens) / 1_000_000) * 3.75
  const totalCost = inputCost + outputCost
  return {
    inputCost,
    outputCost,
    totalCost,
  }
}

export function checkPreDispatchAffordability({
  accumulatedCost = 0,
  nextCallEstimate = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
  costCeiling = FROZEN_CALL_LIMITS.governedCostCeilingUsd,
} = {}) {
  if (
    typeof accumulatedCost !== 'number' ||
    !Number.isFinite(accumulatedCost) ||
    accumulatedCost < 0
  ) {
    return false
  }
  if (
    typeof nextCallEstimate !== 'number' ||
    !Number.isFinite(nextCallEstimate) ||
    nextCallEstimate < 0
  ) {
    return false
  }
  if (
    typeof costCeiling !== 'number' ||
    !Number.isFinite(costCeiling) ||
    costCeiling < 0
  ) {
    return false
  }
  const projected = Math.round((accumulatedCost + nextCallEstimate) * 1e6) / 1e6
  return projected <= costCeiling
}

export function verifyExecutionAuthorization({ env = process.env } = {}) {
  const val = env[VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]
  if (val === undefined || val === '') {
    return {
      authorized: false,
      reason: 'AUTHORIZATION_REQUIRED',
      detail: `Environment variable ${VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY} is required.`,
    }
  }
  if (val !== VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN) {
    return {
      authorized: false,
      reason: 'AUTHORIZATION_INVALID',
      detail: `Environment variable ${VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY} has invalid value.`,
    }
  }
  return {
    authorized: true,
    reason: null,
    detail: 'Execution authorization verified.',
  }
}

export function resolveModelConfiguration({ env = process.env } = {}) {
  const envModel = env.GEMINI_MODEL
  if (envModel !== undefined && envModel !== '' && envModel !== FROZEN_MODEL_CONFIG.modelId) {
    const err = new Error(
      `Mismatched GEMINI_MODEL env override '${envModel}'. Expected '${FROZEN_MODEL_CONFIG.modelId}'. STOP_MODEL_CONFIG_MISMATCH`
    )
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

export async function verifyFrozenBindings({
  root = repoRoot,
  protocolPath = PROTOCOL_PATH,
  cohortPath = COHORT_PATH,
} = {}) {
  const checks = [
    { name: 'protocol.v1.json', path: protocolPath, expected: FROZEN_BINDINGS.protocolByteHash },
    { name: 'ablation-cohort.v1.json', path: cohortPath, expected: FROZEN_BINDINGS.cohortByteHash },
    { name: 'candidatePrompt', path: path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), expected: FROZEN_BINDINGS.candidatePromptByteHash },
    { name: 'candidateSchema', path: path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), expected: FROZEN_BINDINGS.candidateSchemaByteHash },
    { name: 'candidateValidator', path: path.join(root, 'catalogue-pipeline/scripts/validateVerifierV13Contract.mjs'), expected: FROZEN_BINDINGS.candidateValidatorByteHash },
    { name: 'v13Protocol', path: path.join(root, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/protocol.v1.json'), expected: FROZEN_BINDINGS.v13ProtocolByteHash },
    { name: 'v13ExecutionLedger', path: path.join(root, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution/execution-ledger.json'), expected: FROZEN_BINDINGS.v13ExecutionLedgerByteHash },
    { name: 'v13ExecutionEvidenceFreeze', path: path.join(root, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution-evidence-freeze.v1.json'), expected: FROZEN_BINDINGS.v13ExecutionEvidenceFreezeByteHash },
    { name: 'v13RetrospectiveReconciliation', path: path.join(root, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/retrospective-reconciliation.v1.json'), expected: FROZEN_BINDINGS.v13RetrospectiveReconciliationByteHash },
  ]

  for (const c of checks) {
    if (!existsSync(c.path)) {
      const err = new Error(`Bound artifact missing: ${c.name} at ${c.path}`)
      err.code = 'BOUND_ARTIFACT_MISSING'
      throw err
    }
    const buf = await readFile(c.path)
    const computed = sha256Bytes(buf)
    if (computed !== c.expected) {
      const err = new Error(
        `Bound artifact byte hash mismatch for ${c.name}: expected ${c.expected}, got ${computed}`
      )
      err.code = 'BOUND_ARTIFACT_HASH_MISMATCH'
      throw err
    }
  }

  // Also verify reconciliation commit metadata in protocol
  const protocolRaw = await readFile(protocolPath, 'utf8')
  const protocolObj = JSON.parse(protocolRaw)
  const recBinding = protocolObj.boundParentEvidence?.v13RetrospectiveReconciliation
  if (!recBinding || recBinding.commit !== FROZEN_BINDINGS.v13ReconciliationCommit || recBinding.shortCommit !== FROZEN_BINDINGS.v13ReconciliationShortCommit) {
    const err = new Error('Reconciliation commit metadata mismatch in protocol.v1.json')
    err.code = 'RECONCILIATION_COMMIT_MISMATCH'
    throw err
  }

  return { ok: true, verifiedCount: checks.length }
}

export async function loadAndVerifyCohort({
  root = repoRoot,
  cohortPath = COHORT_PATH,
  promptText,
  schema,
} = {}) {
  if (!existsSync(cohortPath)) {
    const err = new Error(`Cohort manifest missing at: ${cohortPath}`)
    err.code = 'COHORT_MISSING'
    throw err
  }

  const raw = await readFile(cohortPath, 'utf8')
  const cohort = JSON.parse(raw)

  if (!Array.isArray(cohort.records) || cohort.records.length !== 4) {
    const err = new Error(`Cohort must contain exactly 4 records, found ${cohort.records?.length}`)
    err.code = 'COHORT_SIZE_MISMATCH'
    throw err
  }

  const actualIds = cohort.records.map((r) => r.candidateId)
  for (let i = 0; i < EXPECTED_COHORT_CANDIDATE_IDS.length; i += 1) {
    if (actualIds[i] !== EXPECTED_COHORT_CANDIDATE_IDS[i]) {
      const err = new Error(
        `Cohort candidate order mismatch at index ${i}: expected ${EXPECTED_COHORT_CANDIDATE_IDS[i]}, got ${actualIds[i]}`
      )
      err.code = 'COHORT_ORDER_MISMATCH'
      throw err
    }
  }

  const candidateChecks = []

  for (const item of cohort.records) {
    if (item.sourceRiskInputPath.includes('holdout') || item.candidateId.includes('holdout')) {
      const err = new Error(`Prospective holdout access forbidden: ${item.candidateId}`)
      err.code = 'PROSPECTIVE_HOLDOUT_ACCESS_FORBIDDEN'
      throw err
    }

    const fullPath = path.isAbsolute(item.sourceRiskInputPath)
      ? item.sourceRiskInputPath
      : path.join(root, item.sourceRiskInputPath)

    if (!existsSync(fullPath)) {
      const err = new Error(`Source risk input missing for ${item.candidateId} at ${fullPath}`)
      err.code = 'SOURCE_INPUT_MISSING'
      throw err
    }

    const inputBuf = await readFile(fullPath)
    const inputHash = sha256Bytes(inputBuf)
    if (inputHash !== item.sourceRiskInputByteHash) {
      const err = new Error(
        `Source risk input byte hash mismatch for ${item.candidateId}: expected ${item.sourceRiskInputByteHash}, got ${inputHash}`
      )
      err.code = 'SOURCE_INPUT_HASH_MISMATCH'
      throw err
    }

    const riskInput = JSON.parse(inputBuf.toString('utf8'))
    const packet = buildVerifierV13ReplayPacket(riskInput)
    const leakage = scanForForbiddenKeys(packet)
    if (leakage.length > 0) {
      const err = new Error(`Leakage detected for ${item.candidateId}: ${JSON.stringify(leakage)}`)
      err.code = 'INPUT_LEAKAGE_DETECTED'
      throw err
    }

    const req = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
      modelConfig: FROZEN_MODEL_CONFIG,
    })

    if (req.requestMetadata.requestHash !== item.ablationLowRequestHash) {
      const err = new Error(
        `Low requestHash mismatch for ${item.candidateId}: expected ${item.ablationLowRequestHash}, got ${req.requestMetadata.requestHash}`
      )
      err.code = 'REQUEST_HASH_MISMATCH'
      throw err
    }

    candidateChecks.push({
      candidateId: item.candidateId,
      requestHash: req.requestMetadata.requestHash,
      countedInputTokens: item.countedInputTokens,
      nextCallReserveUsd: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
      request: req,
    })
  }

  return {
    cohort,
    candidateChecks,
  }
}

/**
 * Technical Outcome Taxonomy & Observational Derivation.
 * Primary endpoint depends strictly on:
 * - provider response supplies candidate output
 * - finishReason != MAX_TOKENS
 * - candidate text is complete parseable JSON
 *
 * Schema validity and semantic validity are observational only.
 */
export function deriveAttemptRecordFromRaw({
  candidateId,
  attemptIndex = 1,
  requestHash,
  httpStatus = 200,
  rawResponse,
  rawResponseSha256,
  transportError = null,
  schema,
}) {
  if (attemptIndex !== 1) {
    const err = new Error(`Attempt index ${attemptIndex} is forbidden. Max retries is 0.`)
    err.code = 'ATTEMPT_INDEX_FORBIDDEN'
    throw err
  }

  // 1. Check for transport failure
  if (transportError || (httpStatus !== null && httpStatus !== 200)) {
    return {
      attemptRecord: {
        candidateId,
        attemptIndex: 1,
        requestHash,
        httpStatus,
        technicalOutcome: TECHNICAL_OUTCOMES.TECHNICAL_TRANSPORT_FAILURE,
        technicalSerializationSuccess: false,
        finishReason: null,
        callCostUsd: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
        usageMetadata: null,
        rawResponseSha256: rawResponseSha256 ?? null,
        rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
        extractedText: null,
        parsed: null,
        schemaValidation: { valid: false, errors: ['Transport failure occurred'] },
        semanticValidation: { ok: false, failures: ['Transport failure occurred'] },
        observationalDisposition: 'TECHNICAL_TRANSPORT_FAILURE',
        transportError: transportError ? { message: transportError.message, code: transportError.code } : null,
      },
      technicalSerializationSuccess: false,
    }
  }

  // 2. Parse provider response envelope
  let envelope = null
  if (typeof rawResponse === 'string') {
    try {
      envelope = JSON.parse(rawResponse)
    } catch {
      envelope = null
    }
  } else if (rawResponse && typeof rawResponse === 'object') {
    envelope = rawResponse
  }

  const usageMetadata = envelope?.usageMetadata ?? null
  let callCostUsd = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
  const resolvedUsage = resolveUsageTokenCounts(usageMetadata)
  if (resolvedUsage.valid) {
    const cost = calculateCallCost({
      inputTokens: resolvedUsage.inputTokens,
      outputTokens: resolvedUsage.outputTokens,
      thinkingTokens: resolvedUsage.thinkingTokens,
    })
    if (Number.isFinite(cost.totalCost) && cost.totalCost >= 0) {
      callCostUsd = cost.totalCost
    }
  }

  if (!Number.isFinite(callCostUsd) || callCostUsd < 0) {
    callCostUsd = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
  }

  if (!envelope || typeof envelope !== 'object') {
    return {
      attemptRecord: {
        candidateId,
        attemptIndex: 1,
        requestHash,
        httpStatus,
        technicalOutcome: TECHNICAL_OUTCOMES.MALFORMED_NON_MAX_TOKENS,
        technicalSerializationSuccess: false,
        finishReason: null,
        callCostUsd,
        usageMetadata,
        rawResponseSha256,
        rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
        extractedText: null,
        parsed: null,
        schemaValidation: { valid: false, errors: ['Provider response envelope is not parseable JSON'] },
        semanticValidation: { ok: false, failures: ['Provider response envelope is not parseable JSON'] },
        observationalDisposition: 'MALFORMED_JSON_STRING',
      },
      technicalSerializationSuccess: false,
    }
  }

  const candidate = envelope.candidates?.[0]
  const finishReason = candidate?.finishReason ?? null
  const extractedText = extractVerifierText(typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse))

  // 3. Classify outcome
  if (finishReason === 'MAX_TOKENS') {
    return {
      attemptRecord: {
        candidateId,
        attemptIndex: 1,
        requestHash,
        httpStatus,
        technicalOutcome: TECHNICAL_OUTCOMES.MAX_TOKENS_TRUNCATION,
        technicalSerializationSuccess: false,
        finishReason,
        callCostUsd,
        usageMetadata,
        rawResponseSha256,
        rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
        extractedText,
        parsed: null,
        schemaValidation: { valid: false, errors: ['Generation truncated due to MAX_TOKENS'] },
        semanticValidation: { ok: false, failures: ['Generation truncated due to MAX_TOKENS'] },
        observationalDisposition: 'MALFORMED_MAX_TOKENS',
      },
      technicalSerializationSuccess: false,
    }
  }

  if (!extractedText || typeof extractedText !== 'string') {
    return {
      attemptRecord: {
        candidateId,
        attemptIndex: 1,
        requestHash,
        httpStatus,
        technicalOutcome: TECHNICAL_OUTCOMES.MALFORMED_NON_MAX_TOKENS,
        technicalSerializationSuccess: false,
        finishReason,
        callCostUsd,
        usageMetadata,
        rawResponseSha256,
        rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
        extractedText: null,
        parsed: null,
        schemaValidation: { valid: false, errors: ['No text output in candidate response'] },
        semanticValidation: { ok: false, failures: ['No text output in candidate response'] },
        observationalDisposition: 'MALFORMED_JSON_STRING',
      },
      technicalSerializationSuccess: false,
    }
  }

  let parsed = null
  try {
    parsed = JSON.parse(extractedText)
  } catch (parseErr) {
    return {
      attemptRecord: {
        candidateId,
        attemptIndex: 1,
        requestHash,
        httpStatus,
        technicalOutcome: TECHNICAL_OUTCOMES.MALFORMED_NON_MAX_TOKENS,
        technicalSerializationSuccess: false,
        finishReason,
        callCostUsd,
        usageMetadata,
        rawResponseSha256,
        rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
        extractedText,
        parsed: null,
        schemaValidation: { valid: false, errors: [`JSON.parse failed: ${parseErr.message}`] },
        semanticValidation: { ok: false, failures: [`JSON.parse failed: ${parseErr.message}`] },
        observationalDisposition: 'MALFORMED_JSON_STRING',
      },
      technicalSerializationSuccess: false,
    }
  }

  // Complete parseable JSON without MAX_TOKENS reached!
  const technicalSerializationSuccess = true
  const technicalOutcome = TECHNICAL_OUTCOMES.SERIALIZATION_SUCCESS

  // Observational validations (do NOT affect technicalSerializationSuccess)
  const schemaRes = validateJsonSchema(parsed, schema)
  const semanticRes = validateVerifierV13CandidatePayload(parsed)

  let observationalDisposition = 'MALFORMED_JSON_STRING'
  if (!schemaRes.valid) {
    observationalDisposition = 'SCHEMA_INVALID'
  } else if (!semanticRes.ok) {
    observationalDisposition = 'SEMANTICALLY_INVALID'
  } else {
    observationalDisposition = parsed.riskLevel === 'HIGH_RISK' ? 'VALID_HIGH_RISK' : 'VALID_LOW_RISK'
  }

  return {
    attemptRecord: {
      candidateId,
      attemptIndex: 1,
      requestHash,
      httpStatus,
      technicalOutcome,
      technicalSerializationSuccess,
      finishReason,
      callCostUsd,
      usageMetadata,
      rawResponseSha256,
      rawTextLength: typeof rawResponse === 'string' ? rawResponse.length : 0,
      extractedText,
      parsed,
      schemaValidation: {
        valid: schemaRes.valid,
        errors: schemaRes.errors,
      },
      semanticValidation: {
        ok: semanticRes.ok,
        failures: semanticRes.failures,
      },
      observationalDisposition,
    },
    technicalSerializationSuccess,
  }
}

/**
 * Preflight Command.
 * Fails closed if authorization is missing/invalid or credential is unavailable.
 * Zero network/model calls.
 */
export async function runAblationPreflight({
  env = process.env,
  root = repoRoot,
  protocolPath = PROTOCOL_PATH,
  cohortPath = COHORT_PATH,
} = {}) {
  // 1. Authorization Gate (fails closed)
  const auth = verifyExecutionAuthorization({ env })
  if (!auth.authorized) {
    return {
      ok: false,
      status: 'PREFLIGHT_BLOCKED',
      reason: auth.reason,
      detail: auth.detail,
      networkCallsAttempted: 0,
    }
  }

  // 2. Credential Readiness Gate (fails closed without calling API)
  const modelRes = resolveModelConfiguration({ env })
  if (!modelRes.credentialAvailable) {
    return {
      ok: false,
      status: 'PREFLIGHT_BLOCKED',
      reason: 'CREDENTIAL_UNAVAILABLE',
      detail: 'Gemini credential is not available in environment (GEMINI_API_KEY required).',
      networkCallsAttempted: 0,
    }
  }

  // 3. Local Verification Checks
  const bindingsRes = await verifyFrozenBindings({ root, protocolPath, cohortPath })

  const promptText = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schemaRaw = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8')
  const schema = JSON.parse(schemaRaw)

  const cohortRes = await loadAndVerifyCohort({
    root,
    cohortPath,
    promptText,
    schema,
  })

  const costCheck = {
    perCallReserveUsd: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    callCount: 4,
    totalReserveUsd: Math.round(4 * FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd * 1e6) / 1e6,
    ceilingUsd: FROZEN_CALL_LIMITS.governedCostCeilingUsd,
    theoreticalMaxTotalCostUsd: FROZEN_CALL_LIMITS.theoreticalMaxTotalCostUsd,
    affordabilityVerified: (4 * FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd) <= FROZEN_CALL_LIMITS.governedCostCeilingUsd,
  }

  return {
    ok: true,
    status: 'PREFLIGHT_PASSED',
    totalCandidates: cohortRes.cohort.records.length,
    cohortCandidates: cohortRes.cohort.records.map((r) => r.candidateId),
    bindingsVerified: bindingsRes.ok,
    sourceInputsVerified: true,
    requestHashesVerified: true,
    modelConfig: FROZEN_MODEL_CONFIG,
    callLimits: FROZEN_CALL_LIMITS,
    costArithmetic: costCheck,
    authorizationConfigured: true,
    credentialAvailable: true,
    networkCallsAttempted: 0,
  }
}

/**
 * Dry-Run Command.
 * Zero network/model calls.
 * Zero execution artifacts.
 * Distinguishes structural request validation from live execution readiness.
 */
export async function runAblationDryRun({
  env = process.env,
  root = repoRoot,
  protocolPath = PROTOCOL_PATH,
  cohortPath = COHORT_PATH,
} = {}) {
  await verifyFrozenBindings({ root, protocolPath, cohortPath })

  const promptText = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schemaRaw = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8')
  const schema = JSON.parse(schemaRaw)

  const cohortRes = await loadAndVerifyCohort({
    root,
    cohortPath,
    promptText,
    schema,
  })

  const auth = verifyExecutionAuthorization({ env })
  const modelRes = resolveModelConfiguration({ env })

  const authorizationConfigured = auth.authorized
  const credentialAvailable = modelRes.credentialAvailable
  const liveExecutionReady = authorizationConfigured && credentialAvailable

  let accumulatedReserveUsd = 0
  const candidateChecks = []

  for (const c of cohortRes.candidateChecks) {
    const reserve = FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd
    accumulatedReserveUsd += reserve
    candidateChecks.push({
      candidateId: c.candidateId,
      requestHash: c.requestHash,
      countedInputTokens: c.countedInputTokens,
      nextCallReserveUsd: reserve,
    })
  }

  const roundedReserved = Math.round(accumulatedReserveUsd * 1e6) / 1e6

  if (roundedReserved > FROZEN_CALL_LIMITS.governedCostCeilingUsd) {
    throw new Error(`Reserved cost ${roundedReserved} exceeds ceiling ${FROZEN_CALL_LIMITS.governedCostCeilingUsd}`)
  }

  return {
    ok: true,
    status: 'DRY_RUN_PASSED',
    totalCandidates: candidateChecks.length,
    dispatchesAttempted: 0,
    networkCallsAttempted: 0,
    accumulatedReservedCostUsd: roundedReserved,
    costCeilingUsd: FROZEN_CALL_LIMITS.governedCostCeilingUsd,
    authorizationConfigured,
    credentialAvailable,
    liveExecutionReady,
    candidateChecks,
  }
}

/**
 * Execution Orchestrator.
 * Raw-first persistence, atomic state transitions, zero retries.
 * Halts before any directory/artifact creation if unauthorized or missing credentials.
 */
export async function runAblationExecution({
  env = process.env,
  fetchImpl = globalThis.fetch,
  root = repoRoot,
  executionDir = EXECUTION_DIR,
  protocolPath = PROTOCOL_PATH,
  cohortPath = COHORT_PATH,
  timeoutMs = FROZEN_MODEL_CONFIG.timeoutMs,
} = {}) {
  // 1. Authorization Gate (halts before any artifact creation)
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

  // 2. Credential Readiness Gate (halts before any artifact creation)
  const modelRes = resolveModelConfiguration({ env })
  if (!modelRes.credentialAvailable) {
    return {
      ok: false,
      status: 'BLOCKED',
      reason: 'CREDENTIAL_UNAVAILABLE',
      detail: 'Gemini credential is not available in environment (GEMINI_API_KEY required).',
      networkCallsAttempted: 0,
    }
  }

  // 3. Pre-execution Validation (halts before any artifact creation)
  await verifyFrozenBindings({ root, protocolPath, cohortPath })

  const promptText = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schemaRaw = await readFile(path.join(root, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8')
  const schema = JSON.parse(schemaRaw)

  const cohortRes = await loadAndVerifyCohort({
    root,
    cohortPath,
    promptText,
    schema,
  })

  // ONLY NOW create execution directory
  await mkdir(executionDir, { recursive: true })

  // Reconstruct confirmed historical external calls from durable attempt-1.raw.json evidence
  let confirmedExternalCalls = 0
  for (const c of cohortRes.candidateChecks) {
    const candDir = path.join(executionDir, c.candidateId)
    if (existsSync(candDir)) {
      const entries = await readdir(candDir)
      for (const entry of entries) {
        if (entry.startsWith('attempt-') && !entry.startsWith('attempt-1.')) {
          return {
            ok: false,
            status: 'HALTED',
            reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
            candidateId: c.candidateId,
            detail: `Suspicious unexpected attempt artifact found: ${entry}`,
            confirmedExternalCalls: 0,
            newExternalCallsThisInvocation: 0,
            totalExternalCalls: 0,
          }
        }
      }
    }
    const rawFile = path.join(candDir, 'attempt-1.raw.json')
    if (existsSync(rawFile)) {
      let rawBuf
      try {
        rawBuf = await readFile(rawFile, 'utf8')
      } catch (err) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Unreadable raw file: ${err.message}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation: 0,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      const rawValidation = validateDurableRawEvidence({
        rawContent: rawBuf,
        expectedCandidateId: c.candidateId,
        expectedRequestHash: c.requestHash,
      })
      if (!rawValidation.ok) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: rawValidation.detail,
          confirmedExternalCalls,
          newExternalCallsThisInvocation: 0,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      confirmedExternalCalls += 1
    }
  }

  let newExternalCallsThisInvocation = 0
  let accumulatedCostUsd = 0
  const candidateSummaries = []
  let technicalSerializationSuccessCount = 0

  for (const c of cohortRes.candidateChecks) {
    const candDir = path.join(executionDir, c.candidateId)
    const stateFile = path.join(candDir, 'candidate-state.json')
    const rawFile = path.join(candDir, 'attempt-1.raw.json')
    const derivedFile = path.join(candDir, 'attempt-1.json')

    const rawExists = existsSync(rawFile)
    const derivedExists = existsSync(derivedFile)
    const stateExists = existsSync(stateFile)

    let existingState = null
    if (stateExists) {
      let stateRaw
      try {
        stateRaw = await readFile(stateFile, 'utf8')
      } catch (err) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Unreadable candidate-state.json: ${err.message}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }

      const stateValidation = validateDurableCandidateState({
        stateContent: stateRaw,
        expectedCandidateId: c.candidateId,
        expectedRequestHash: c.requestHash,
      })
      if (!stateValidation.ok) {
        return {
          ok: false,
          status: 'HALTED',
          reason: stateValidation.reason,
          candidateId: c.candidateId,
          detail: stateValidation.detail,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      existingState = stateValidation.stateRecord
    }

    // Fail closed on impossible/inconsistent evidence states

    // Permanent Ambiguous State Halt
    if (existingState && existingState.state === CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'AMBIGUOUS_DISPATCH_STATE',
        candidateId: c.candidateId,
        detail: 'Candidate remains in AMBIGUOUS_DISPATCH_STATE from prior unconfirmed dispatch. Manual investigation required.',
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }

    // A. Derived exists without raw
    if (derivedExists && !rawExists) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
        candidateId: c.candidateId,
        detail: 'Derived attempt-1.json exists but attempt-1.raw.json is missing.',
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }

    // B. Candidate state claims COMPLETED but raw is missing
    if (existingState && existingState.state === CANDIDATE_STATES.COMPLETED && !rawExists) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
        candidateId: c.candidateId,
        detail: 'Candidate state is COMPLETED but attempt-1.raw.json is missing.',
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }

    // C. Candidate state claims COMPLETED but derived is missing
    if (existingState && existingState.state === CANDIDATE_STATES.COMPLETED && !derivedExists) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
        candidateId: c.candidateId,
        detail: 'Candidate state is COMPLETED but attempt-1.json is missing.',
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }

    // D. Candidate state is DISPATCH_STARTED and raw is missing (ambiguous crash)
    if (existingState && existingState.state === CANDIDATE_STATES.DISPATCH_STARTED && !rawExists) {
      await atomicWriteJson(stateFile, {
        candidateId: c.candidateId,
        state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
        attemptCount: 1,
        requestHash: c.requestHash,
        haltReason: 'CRASH_BEFORE_RAW_PERSISTENCE',
      })
      return {
        ok: false,
        status: 'HALTED',
        reason: 'AMBIGUOUS_DISPATCH_STATE',
        candidateId: c.candidateId,
        detail: 'Candidate state is DISPATCH_STARTED without durable raw response.',
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }

    // E. Raw exists, derived missing (state is not COMPLETED) -> recover from raw without redispatch
    if (rawExists && !derivedExists) {
      let rawBuf
      try {
        rawBuf = await readFile(rawFile, 'utf8')
      } catch (err) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Unreadable raw file: ${err.message}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      const rawValidation = validateDurableRawEvidence({
        rawContent: rawBuf,
        expectedCandidateId: c.candidateId,
        expectedRequestHash: c.requestHash,
      })
      if (!rawValidation.ok) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: rawValidation.detail,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      const rawEvidence = rawValidation.rawEvidence

      const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
        candidateId: c.candidateId,
        attemptIndex: 1,
        requestHash: c.requestHash,
        httpStatus: rawEvidence.httpStatus,
        rawResponse: rawEvidence.rawResponse,
        rawResponseSha256: rawEvidence.rawResponseSha256,
        transportError: rawEvidence.transportError,
        schema,
      })

      await atomicWriteJson(derivedFile, attemptRecord, { refuseOverwrite: true })
      await atomicWriteJson(stateFile, {
        candidateId: c.candidateId,
        state: CANDIDATE_STATES.COMPLETED,
        attemptCount: 1,
        requestHash: c.requestHash,
        technicalOutcome: attemptRecord.technicalOutcome,
        technicalSerializationSuccess,
        callCostUsd: attemptRecord.callCostUsd,
        observational: {
          schemaValid: attemptRecord.schemaValidation?.valid ?? false,
          semanticValid: attemptRecord.semanticValidation?.ok ?? false,
          disposition: attemptRecord.observationalDisposition,
        },
      })

      if (!Number.isFinite(attemptRecord.callCostUsd) || attemptRecord.callCostUsd < 0) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Invalid callCostUsd in recovered attempt: ${attemptRecord.callCostUsd}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      accumulatedCostUsd += attemptRecord.callCostUsd
      accumulatedCostUsd = Math.round(accumulatedCostUsd * 1e6) / 1e6
      if (!Number.isFinite(accumulatedCostUsd) || accumulatedCostUsd < 0) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Accumulated cost became invalid after recovery: ${accumulatedCostUsd}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      if (technicalSerializationSuccess) {
        technicalSerializationSuccessCount += 1
      }
      candidateSummaries.push({
        candidateId: c.candidateId,
        state: CANDIDATE_STATES.COMPLETED,
        technicalOutcome: attemptRecord.technicalOutcome,
        technicalSerializationSuccess,
        callCostUsd: attemptRecord.callCostUsd,
        recoveredFromRaw: true,
      })
      continue
    }

    // F. Raw exists, derived exists -> verify consistency, recover state if needed, never redispatch
    if (rawExists && derivedExists) {
      let rawBuf, derivedRaw
      try {
        rawBuf = await readFile(rawFile, 'utf8')
        derivedRaw = await readFile(derivedFile, 'utf8')
      } catch (err) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Unreadable raw or derived artifact: ${err.message}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }

      const rawValidation = validateDurableRawEvidence({
        rawContent: rawBuf,
        expectedCandidateId: c.candidateId,
        expectedRequestHash: c.requestHash,
      })
      if (!rawValidation.ok) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: rawValidation.detail,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      const rawEvidence = rawValidation.rawEvidence

      let derived
      try {
        derived = JSON.parse(derivedRaw)
      } catch (err) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Failed to parse derived JSON artifact: ${err.message}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }

      const { attemptRecord: expectedDerived, technicalSerializationSuccess: expectedSuccess } =
        deriveAttemptRecordFromRaw({
          candidateId: c.candidateId,
          attemptIndex: 1,
          requestHash: c.requestHash,
          httpStatus: rawEvidence.httpStatus,
          rawResponse: rawEvidence.rawResponse,
          rawResponseSha256: rawEvidence.rawResponseSha256,
          transportError: rawEvidence.transportError,
          schema,
        })

      const derivedMatches =
        derived.candidateId === c.candidateId &&
        derived.attemptIndex === 1 &&
        derived.requestHash === c.requestHash &&
        derived.rawResponseSha256 === expectedDerived.rawResponseSha256 &&
        derived.httpStatus === expectedDerived.httpStatus &&
        derived.finishReason === expectedDerived.finishReason &&
        derived.technicalOutcome === expectedDerived.technicalOutcome &&
        derived.technicalSerializationSuccess === expectedSuccess &&
        derived.observationalDisposition === expectedDerived.observationalDisposition &&
        Math.abs((derived.callCostUsd ?? 0) - expectedDerived.callCostUsd) < 1e-6 &&
        JSON.stringify(derived.usageMetadata) === JSON.stringify(expectedDerived.usageMetadata) &&
        JSON.stringify(derived.schemaValidation) === JSON.stringify(expectedDerived.schemaValidation) &&
        JSON.stringify(derived.semanticValidation) === JSON.stringify(expectedDerived.semanticValidation)

      if (!derivedMatches) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: 'Persisted derived attempt-1.json is inconsistent with re-derived raw evidence.',
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }

      // Check existing state consistency if present and COMPLETED
      if (existingState && existingState.state === CANDIDATE_STATES.COMPLETED) {
        const stateMatches =
          existingState.candidateId === c.candidateId &&
          existingState.attemptCount === 1 &&
          existingState.requestHash === c.requestHash &&
          existingState.technicalOutcome === expectedDerived.technicalOutcome &&
          existingState.technicalSerializationSuccess === expectedSuccess &&
          Math.abs((existingState.callCostUsd ?? 0) - expectedDerived.callCostUsd) < 1e-6

        if (!stateMatches) {
          return {
            ok: false,
            status: 'HALTED',
            reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
            candidateId: c.candidateId,
            detail: 'Candidate state is inconsistent with re-derived raw evidence.',
            confirmedExternalCalls,
            newExternalCallsThisInvocation,
            totalExternalCalls: confirmedExternalCalls,
          }
        }
      }

      // If state was missing or incomplete, mechanically recover/persist state to COMPLETED
      if (!existingState || existingState.state !== CANDIDATE_STATES.COMPLETED) {
        await atomicWriteJson(stateFile, {
          candidateId: c.candidateId,
          state: CANDIDATE_STATES.COMPLETED,
          attemptCount: 1,
          requestHash: c.requestHash,
          technicalOutcome: expectedDerived.technicalOutcome,
          technicalSerializationSuccess: expectedSuccess,
          callCostUsd: expectedDerived.callCostUsd,
          observational: {
            schemaValid: expectedDerived.schemaValidation?.valid ?? false,
            semanticValid: expectedDerived.semanticValidation?.ok ?? false,
            disposition: expectedDerived.observationalDisposition,
          },
        })
      }

      if (!Number.isFinite(expectedDerived.callCostUsd) || expectedDerived.callCostUsd < 0) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Invalid callCostUsd in existing candidate evidence: ${expectedDerived.callCostUsd}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      accumulatedCostUsd += expectedDerived.callCostUsd
      accumulatedCostUsd = Math.round(accumulatedCostUsd * 1e6) / 1e6
      if (!Number.isFinite(accumulatedCostUsd) || accumulatedCostUsd < 0) {
        return {
          ok: false,
          status: 'HALTED',
          reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
          candidateId: c.candidateId,
          detail: `Accumulated cost became invalid after reuse: ${accumulatedCostUsd}`,
          confirmedExternalCalls,
          newExternalCallsThisInvocation,
          totalExternalCalls: confirmedExternalCalls,
        }
      }
      if (expectedSuccess) {
        technicalSerializationSuccessCount += 1
      }
      candidateSummaries.push({
        candidateId: c.candidateId,
        state: CANDIDATE_STATES.COMPLETED,
        technicalOutcome: expectedDerived.technicalOutcome,
        technicalSerializationSuccess: expectedSuccess,
        callCostUsd: expectedDerived.callCostUsd,
        reusedExisting: true,
      })
      continue
    }

    // New Dispatch Required
    if (confirmedExternalCalls >= FROZEN_CALL_LIMITS.maxTotalCalls) {
      const err = new Error(
        `Cannot dispatch: confirmedExternalCalls ${confirmedExternalCalls} has reached cap ${FROZEN_CALL_LIMITS.maxTotalCalls}`
      )
      err.code = 'CALL_CAP_REACHED'
      throw err
    }

    const affordable = checkPreDispatchAffordability({
      accumulatedCost: accumulatedCostUsd,
      nextCallEstimate: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
      costCeiling: FROZEN_CALL_LIMITS.governedCostCeilingUsd,
    })

    if (!affordable) {
      const err = new Error(
        `Cannot dispatch: cost ceiling would be exceeded. Accumulated ${accumulatedCostUsd} + reserve ${FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd} > ceiling ${FROZEN_CALL_LIMITS.governedCostCeilingUsd}`
      )
      err.code = 'COST_CEILING_EXCEEDED'
      throw err
    }

    // 1. Persist DISPATCH_STARTED state durably
    await atomicWriteJson(stateFile, {
      candidateId: c.candidateId,
      state: CANDIDATE_STATES.DISPATCH_STARTED,
      attemptCount: 1,
      requestHash: c.requestHash,
      dispatchTimestamp: new Date().toISOString(),
    })

    // 2. Dispatch exactly once
    const apiKey = env.GEMINI_API_KEY
    const url = `${c.request.endpoint}?key=${encodeURIComponent(apiKey)}`
    let response = null
    let rawText = null
    let transportError = null
    let httpStatus = null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      newExternalCallsThisInvocation += 1
      confirmedExternalCalls += 1
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(c.request.body),
        signal: controller.signal,
      })
      httpStatus = response.status
      rawText = await response.text()
    } catch (netErr) {
      transportError = {
        message: netErr.name === 'AbortError' ? 'Network timeout exceeded' : netErr.message,
        code: netErr.name === 'AbortError' ? 'NETWORK_TIMEOUT' : (netErr.code || 'NETWORK_ERROR'),
      }
    } finally {
      clearTimeout(timer)
    }

    // 3. Persist raw transport/provider response durably
    const rawSha256 = typeof rawText === 'string' ? sha256Bytes(Buffer.from(rawText, 'utf8')) : null
    const rawEvidencePayload = {
      candidateId: c.candidateId,
      attemptIndex: 1,
      requestHash: c.requestHash,
      httpStatus,
      rawResponse: rawText,
      rawResponseSha256: rawSha256,
      transportError,
    }

    await atomicWriteJson(rawFile, rawEvidencePayload, { refuseOverwrite: true })

    // 4. Parse / derive attempt-1.json
    const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
      candidateId: c.candidateId,
      attemptIndex: 1,
      requestHash: c.requestHash,
      httpStatus,
      rawResponse: rawText,
      rawResponseSha256: rawSha256,
      transportError,
      schema,
    })

    await atomicWriteJson(derivedFile, attemptRecord, { refuseOverwrite: true })

    // 5. Persist completed candidate state
    await atomicWriteJson(stateFile, {
      candidateId: c.candidateId,
      state: CANDIDATE_STATES.COMPLETED,
      attemptCount: 1,
      requestHash: c.requestHash,
      technicalOutcome: attemptRecord.technicalOutcome,
      technicalSerializationSuccess,
      callCostUsd: attemptRecord.callCostUsd,
      observational: {
        schemaValid: attemptRecord.schemaValidation?.valid ?? false,
        semanticValid: attemptRecord.semanticValidation?.ok ?? false,
        disposition: attemptRecord.observationalDisposition,
      },
    })

    if (!Number.isFinite(attemptRecord.callCostUsd) || attemptRecord.callCostUsd < 0) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
        candidateId: c.candidateId,
        detail: `Invalid callCostUsd after dispatch: ${attemptRecord.callCostUsd}`,
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }
    accumulatedCostUsd += attemptRecord.callCostUsd
    accumulatedCostUsd = Math.round(accumulatedCostUsd * 1e6) / 1e6
    if (!Number.isFinite(accumulatedCostUsd) || accumulatedCostUsd < 0) {
      return {
        ok: false,
        status: 'HALTED',
        reason: 'INCONSISTENT_EXECUTION_EVIDENCE',
        candidateId: c.candidateId,
        detail: `Accumulated cost became invalid after dispatch: ${accumulatedCostUsd}`,
        confirmedExternalCalls,
        newExternalCallsThisInvocation,
        totalExternalCalls: confirmedExternalCalls,
      }
    }
    if (technicalSerializationSuccess) {
      technicalSerializationSuccessCount += 1
    }

    candidateSummaries.push({
      candidateId: c.candidateId,
      state: CANDIDATE_STATES.COMPLETED,
      technicalOutcome: attemptRecord.technicalOutcome,
      technicalSerializationSuccess,
      callCostUsd: attemptRecord.callCostUsd,
    })

    // 6. Update execution ledger after each candidate
    const runningLedger = {
      activity: 'VERIFIER_V1_3_LOW_THINKING_TECHNICAL_ABLATION',
      classification: 'TECHNICAL_DEVELOPMENT_ABLATION',
      status: candidateSummaries.length === 4 ? 'COMPLETED' : 'IN_PROGRESS',
      governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
      totalCandidates: 4,
      completedCandidates: candidateSummaries.length,
      confirmedExternalCalls,
      newExternalCallsThisInvocation,
      totalExternalCalls: confirmedExternalCalls,
      accumulatedCostUsd: Math.round(accumulatedCostUsd * 1e6) / 1e6,
      costCeilingUsd: FROZEN_CALL_LIMITS.governedCostCeilingUsd,
      primaryEndpoint: {
        metric: 'serializationSuccessRate',
        technicalSerializationSuccessCount,
        serializationSuccessRate: candidateSummaries.length > 0 ? technicalSerializationSuccessCount / candidateSummaries.length : 0,
      },
      candidateSummaries,
    }
    await atomicWriteJson(path.join(executionDir, 'execution-ledger.json'), runningLedger)
  }

  const finalLedger = {
    activity: 'VERIFIER_V1_3_LOW_THINKING_TECHNICAL_ABLATION',
    classification: 'TECHNICAL_DEVELOPMENT_ABLATION',
    status: 'COMPLETED',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    totalCandidates: 4,
    completedCandidates: 4,
    confirmedExternalCalls,
    newExternalCallsThisInvocation,
    totalExternalCalls: confirmedExternalCalls,
    accumulatedCostUsd: Math.round(accumulatedCostUsd * 1e6) / 1e6,
    costCeilingUsd: FROZEN_CALL_LIMITS.governedCostCeilingUsd,
    primaryEndpoint: {
      metric: 'serializationSuccessRate',
      technicalSerializationSuccessCount,
      serializationSuccessRate: technicalSerializationSuccessCount / 4,
    },
    candidateSummaries,
  }

  await atomicWriteJson(path.join(executionDir, 'execution-ledger.json'), finalLedger)

  return {
    ok: true,
    status: 'EXECUTION_COMPLETED',
    executionLedger: finalLedger,
    confirmedExternalCalls,
    newExternalCallsThisInvocation,
    totalExternalCalls: confirmedExternalCalls,
    accumulatedCostUsd: Math.round(accumulatedCostUsd * 1e6) / 1e6,
  }
}

/**
 * Auditable CLI Entrypoint.
 */
export async function main() {
  const subcommand = process.argv[2]
  if (!['preflight', 'dry-run', 'run'].includes(subcommand)) {
    console.error(
      'Invalid or missing CLI command. Usage: node catalogue-pipeline/scripts/runVerifierV13LowThinkingAblation.mjs <preflight|dry-run|run>'
    )
    process.exitCode = 1
    return { ok: false, status: 'INVALID_CLI_COMMAND' }
  }

  if (subcommand === 'preflight') {
    const res = await runAblationPreflight({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok ? 0 : 1
    return res
  }

  if (subcommand === 'dry-run') {
    const res = await runAblationDryRun({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok ? 0 : 1
    return res
  }

  if (subcommand === 'run') {
    const res = await runAblationExecution({ env: process.env })
    console.log(JSON.stringify(res, null, 2))
    process.exitCode = res.ok && res.executionLedger?.status === 'COMPLETED' ? 0 : 1
    return res
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`Fatal error in verifier low-thinking ablation runner: ${err.message}`)
    process.exitCode = 1
  })
}
