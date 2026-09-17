import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateJsonSchema } from './jsonSchemaValidator.mjs'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { atomicWriteJson } from './verifierV14ReviewState.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

const opinionSchemaPath = path.join(p2Dir, 'preliminary-advisory-review.schema.v1.json')
const envelopeSchemaPath = path.join(p2Dir, 'preliminary-advisory-record.schema.v1.json')

export const FORBIDDEN_ADAPTER_KEYS = Object.freeze(new Set([
  'otherReviewerOutput',
  'geminiOutput',
  'claudeOutput',
  'quota',
  'cleanCount',
  'defectCount',
  'defectPositiveCount',
  'severeCount',
  'candidateVerifierOutput',
  'priorDecision',
  'priorHumanDecision',
  'targetN',
  'futureCandidates',
]))

export const ALLOWED_OPERATIONAL_METADATA_KEYS = Object.freeze(new Set([
  'provider',
  'model',
  'statusCategory',
  'promptTokens',
  'completionTokens',
  'inputTokens',
  'outputTokens',
  'thinkingTokens',
  'reasoningTokens',
  'finishReason',
  'retryOrdinal',
  'callCostUsd',
  'latencyMs',
  'mock',
]))

export function sha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * Positive whitelist filter for persisted operational metadata.
 * Strictly removes any non-whitelisted keys, nested provider objects, secrets, headers, and credentials.
 */
export function filterOperationalMetadata(rawMeta = {}) {
  if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) return {}
  const filtered = {}
  for (const [k, v] of Object.entries(rawMeta)) {
    if (ALLOWED_OPERATIONAL_METADATA_KEYS.has(k)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
        // Double-check no bearer tokens or secret key formats in strings
        if (typeof v === 'string' && (v.startsWith('AIza') || v.startsWith('sk-') || v.includes('Bearer '))) {
          continue
        }
        filtered[k] = v
      }
    }
  }
  return filtered
}

export const sanitizeTransportMetadata = filterOperationalMetadata


/**
 * Validates adapter options for reviewer independence.
 * Throws immediately if any forbidden cross-talk or quota information is injected.
 */
export function enforceReviewerIndependence(options = {}) {
  for (const key of Object.keys(options)) {
    if (FORBIDDEN_ADAPTER_KEYS.has(key)) {
      throw new Error(`INDEPENDENCE_VIOLATION: Forbidden field '${key}' provided to isolated reviewer request`)
    }
  }
}

export const FROZEN_BINDINGS = Object.freeze({
  GEMINI_PROMPT_PATH: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/review-prompts/verifier-v14-gemini-preliminary.v1.md',
  GEMINI_PROMPT_SHA256: 'sha256:e822b0eef3c9d0b0ece2365aa884593cd3de2eefafd50a3aa3ef2b77cf0847a5',
  CLAUDE_PROMPT_PATH: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/review-prompts/verifier-v14-claude-preliminary.v1.md',
  CLAUDE_PROMPT_SHA256: 'sha256:de665f3e3157ccbbf896d6af2ae86e7c7e83fc2501e1be069ba50613d4d70628',
  MATERIALITY_POLICY_PATH: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-materiality-policy.v1.json',
  MATERIALITY_POLICY_SHA256: 'sha256:21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c',
})

/**
 * Loads the exact frozen preliminary review prompt from disk and verifies its cryptographic hash.
 */
export function loadGovernedReviewerPrompt(reviewer) {
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }
  const relPath = reviewer === 'GEMINI' ? FROZEN_BINDINGS.GEMINI_PROMPT_PATH : FROZEN_BINDINGS.CLAUDE_PROMPT_PATH
  const expectedSha = reviewer === 'GEMINI' ? FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 : FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256
  const absPath = path.join(repoRoot, relPath)
  if (!fs.existsSync(absPath)) {
    throw new Error(`FILE_NOT_FOUND: Governed prompt missing at ${relPath}`)
  }
  const promptBytes = fs.readFileSync(absPath)
  const actualSha = sha256(promptBytes)
  if (actualSha !== expectedSha) {
    throw new Error(`PROMPT_HASH_MISMATCH: Prompt for ${reviewer} SHA-256 '${actualSha}' does not match frozen binding '${expectedSha}'`)
  }
  return {
    promptText: promptBytes.toString('utf8'),
    promptSha256: actualSha,
  }
}

/**
 * Loads the exact frozen human review materiality policy from disk and verifies its cryptographic hash.
 */
export function loadGovernedMaterialityPolicy(policyPath = null) {
  const relPath = policyPath || FROZEN_BINDINGS.MATERIALITY_POLICY_PATH
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath)
  if (!fs.existsSync(absPath)) {
    throw new Error(`FILE_NOT_FOUND: Governed materiality policy missing at ${relPath}`)
  }
  const policyBytes = fs.readFileSync(absPath)
  const actualSha = sha256(policyBytes)
  if (actualSha !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error(
      `MATERIALITY_POLICY_HASH_MISMATCH: Materiality policy SHA-256 '${actualSha}' does not match frozen binding '${FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256}'`
    )
  }
  return {
    policyBytes,
    policySha256: actualSha,
  }
}

/**
 * Verifies that the exact sent prompt text and materiality policy file match their registered frozen SHA-256 bindings.
 * Fails closed on any mismatch, non-frozen hash substitution, or missing policy file.
 */
export function verifyPromptAndPolicyHashes({
  reviewer = null,
  promptText,
  registeredPromptSha256 = null,
  materialityPolicyPath = null,
  registeredMaterialityPolicySha256 = null,
} = {}) {
  if (!promptText || typeof promptText !== 'string') {
    throw new Error('INVALID_PROMPT: Non-empty promptText required')
  }

  // 1. Validate prompt against frozen authority
  let expectedPromptSha = null
  if (reviewer) {
    if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
      throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
    }
    expectedPromptSha = reviewer === 'GEMINI' ? FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 : FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256
  }

  // If registeredPromptSha256 was supplied by caller, verify it matches frozen authority
  if (registeredPromptSha256) {
    if (expectedPromptSha && registeredPromptSha256 !== expectedPromptSha) {
      throw new Error(
        `PROMPT_AUTHORITY_VIOLATION: Caller-supplied prompt SHA '${registeredPromptSha256}' does not match frozen authority '${expectedPromptSha}'`
      )
    }
    if (!expectedPromptSha && registeredPromptSha256 !== FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 && registeredPromptSha256 !== FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256) {
      throw new Error(
        `PROMPT_AUTHORITY_VIOLATION: Caller-supplied prompt SHA '${registeredPromptSha256}' does not match any frozen prompt authority`
      )
    }
  }

  const actualPromptSha = sha256(promptText)
  if (expectedPromptSha) {
    if (actualPromptSha !== expectedPromptSha) {
      throw new Error(
        `PROMPT_HASH_MISMATCH: Sent prompt SHA-256 '${actualPromptSha}' does not match frozen authority '${expectedPromptSha}'`
      )
    }
  } else {
    if (actualPromptSha !== FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 && actualPromptSha !== FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256) {
      throw new Error(
        `PROMPT_HASH_MISMATCH: Sent prompt SHA-256 '${actualPromptSha}' does not match any frozen prompt authority`
      )
    }
  }

  // 2. Validate materiality policy against frozen authority
  if (registeredMaterialityPolicySha256 && registeredMaterialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error(
      `POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy SHA '${registeredMaterialityPolicySha256}' does not match frozen authority '${FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256}'`
    )
  }

  const policyPath = materialityPolicyPath
    ? (path.isAbsolute(materialityPolicyPath) ? materialityPolicyPath : path.join(repoRoot, materialityPolicyPath))
    : path.join(repoRoot, FROZEN_BINDINGS.MATERIALITY_POLICY_PATH)

  if (!fs.existsSync(policyPath)) {
    throw new Error(`FILE_NOT_FOUND: Materiality policy file missing at ${policyPath}`)
  }
  const policyBytes = fs.readFileSync(policyPath)
  const actualPolicySha = sha256(policyBytes)
  if (actualPolicySha !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error(
      `MATERIALITY_POLICY_HASH_MISMATCH: Disk policy SHA-256 '${actualPolicySha}' does not match frozen authority '${FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256}'`
    )
  }

  return true
}


/**
 * Projects an isolated, strictly filtered request payload for a reviewer.
 */
export function createIsolatedReviewerRequest({
  reviewer,
  reviewerModel,
  promptText = null,
  blindPacketBytes,
  options = {},
}) {
  enforceReviewerIndependence(options)

  if (!['GEMINI', 'CLAUDE'].includes(reviewer)) {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }
  if (!reviewerModel || typeof reviewerModel !== 'string' || !reviewerModel.trim()) {
    throw new Error('INVALID_REVIEWER_MODEL: Non-empty reviewerModel is required (no default model permitted)')
  }

  const resolvedPromptText = promptText || loadGovernedReviewerPrompt(reviewer).promptText
  if (typeof resolvedPromptText !== 'string' || !resolvedPromptText) {
    throw new Error('INVALID_PROMPT: Non-empty promptText is required')
  }

  const expectedSha = reviewer === 'GEMINI' ? FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 : FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256
  const actualPromptSha = sha256(resolvedPromptText)
  if (actualPromptSha !== expectedSha) {
    throw new Error(`PROMPT_AUTHORITY_VIOLATION: Sent prompt SHA-256 '${actualPromptSha}' does not match frozen authority '${expectedSha}' for ${reviewer}`)
  }

  if (!blindPacketBytes) {
    throw new Error('INVALID_PACKET: Non-empty blindPacketBytes is required')
  }

  const packetBuf = Buffer.isBuffer(blindPacketBytes) ? blindPacketBytes : Buffer.from(blindPacketBytes, 'utf8')
  const packetJson = packetBuf.toString('utf8')
  const packetSha = sha256(packetBuf)

  return Object.freeze({
    reviewer,
    reviewerModel,
    promptText: resolvedPromptText,
    blindPacketJson: packetJson,
    blindPacketSha256: packetSha,
  })
}

/**
 * Validates raw model advisory response and constructs the cryptographically bound persisted envelope.
 */
export function validateAndBuildAdvisoryEnvelope({
  rawResponseText,
  reviewer,
  reviewerModel,
  candidateId,
  blindPacketSha256,
  reviewPromptSha256,
  materialityPolicySha256,
}) {
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }
  const expectedPromptSha = reviewer === 'GEMINI' ? FROZEN_BINDINGS.GEMINI_PROMPT_SHA256 : FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256
  if (reviewPromptSha256 && reviewPromptSha256 !== expectedPromptSha) {
    throw new Error(`PROMPT_AUTHORITY_VIOLATION: Advisory envelope reviewPromptSha256 '${reviewPromptSha256}' does not match frozen authority '${expectedPromptSha}'`)
  }
  if (materialityPolicySha256 && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error(`POLICY_AUTHORITY_VIOLATION: Advisory envelope materialityPolicySha256 '${materialityPolicySha256}' does not match frozen authority '${FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256}'`)
  }

  if (typeof rawResponseText !== 'string' || !rawResponseText.trim()) {
    throw new Error('MALFORMED_ADVISORY_RESPONSE: Empty or non-string response text')
  }

  const rawBytes = Buffer.from(rawResponseText, 'utf8')
  const rawSha = sha256(rawBytes)

  let parsedOpinion
  try {
    const trimmed = rawResponseText.trim()
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : trimmed
    parsedOpinion = JSON.parse(jsonStr)
  } catch (err) {
    const parseError = new Error(`MALFORMED_ADVISORY_JSON: Failed to parse model output: ${err.message}`)
    parseError.code = 'MALFORMED_ADVISORY_JSON'
    parseError.rawResponseSha256 = rawSha
    throw parseError
  }

  const opinionSchema = JSON.parse(fs.readFileSync(opinionSchemaPath, 'utf8'))
  const opinionValidation = validateJsonSchema(parsedOpinion, opinionSchema)
  if (!opinionValidation.valid) {
    const schemaError = new Error(`SCHEMA_INVALID_ADVISORY_OPINION: ${opinionValidation.errors.join('; ')}`)
    schemaError.code = 'SCHEMA_INVALID_ADVISORY_OPINION'
    schemaError.rawResponseSha256 = rawSha
    schemaError.validationErrors = opinionValidation.errors
    throw schemaError
  }

  if (parsedOpinion.advisoryOnly !== true) {
    throw new Error('ADVISORY_ONLY_VIOLATION: preliminary advisory must declare advisoryOnly: true')
  }

  const envelope = {
    candidateId,
    blindPacketSha256,
    reviewer,
    reviewerModel,
    reviewPromptSha256: expectedPromptSha,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    rawResponseSha256: rawSha,
    validatedOpinion: parsedOpinion,
  }

  const envelopeSchema = JSON.parse(fs.readFileSync(envelopeSchemaPath, 'utf8'))
  const envelopeValidation = validateJsonSchema(envelope, envelopeSchema)
  if (!envelopeValidation.valid) {
    throw new Error(`SCHEMA_INVALID_ADVISORY_ENVELOPE: ${envelopeValidation.errors.join('; ')}`)
  }

  const envelopeJson = serializeArtifactForPersistence(envelope)
  const envelopeSha256 = sha256(envelopeJson)

  return {
    envelope,
    envelopeJson,
    envelopeSha256,
    rawResponseSha256: rawSha,
  }
}

/**
 * Generic provider-neutral review caller using transportHandler.
 */
export async function reviewBlindPacket({
  reviewer,
  reviewerModel,
  promptText = null,
  blindPacketBytes,
  transportHandler,
  options = {},
}) {
  const resolvedPromptText = promptText || loadGovernedReviewerPrompt(reviewer).promptText
  const isolatedRequest = createIsolatedReviewerRequest({
    reviewer,
    reviewerModel,
    promptText: resolvedPromptText,
    blindPacketBytes,
    options,
  })

  if (typeof transportHandler !== 'function') {
    throw new Error('INVALID_TRANSPORT_HANDLER: transportHandler function required')
  }

  const result = await transportHandler({ isolatedRequest })
  const filteredMeta = filterOperationalMetadata(result.metadata)

  return {
    reviewer,
    reviewerModel,
    blindPacketSha256: isolatedRequest.blindPacketSha256,
    rawResponseBytes: Buffer.from(result.rawResponseText || '', 'utf8'),
    rawResponseSha256: sha256(result.rawResponseText || ''),
    rawResponseText: result.rawResponseText,
    transportMetadata: filteredMeta,
  }
}

/**
 * Deterministic Mock Gemini Reviewer for test execution.
 */
export function createMockGeminiReviewer({
  model = 'mock-gemini-v1',
  cannedOpinion = null,
  failMode = null,
  latencyMs = 0,
} = {}) {
  return async function mockGeminiTransport({ isolatedRequest }) {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
    }

    if (failMode === 'UNAVAILABLE') {
      const err = new Error('PROVIDER_UNAVAILABLE: Gemini mock service unavailable')
      err.code = 'PROVIDER_UNAVAILABLE'
      throw err
    }
    if (failMode === 'MALFORMED_JSON') {
      return {
        rawResponseText: '{"preliminaryDecision": "APPROVE", malformed...',
        metadata: { model, provider: 'google', mock: true },
      }
    }
    if (failMode === 'SCHEMA_INVALID') {
      return {
        rawResponseText: JSON.stringify({
          preliminaryDecision: 'APPROVE',
          preliminarySeverity: 'MINOR',
          affectedFields: [],
          issueSummaries: [],
          claimSpan: 'none',
          sourceEvidence: [],
          sourceBoundaryReason: 'Test invalid',
          confidence: 'HIGH',
          advisoryOnly: true,
        }),
        metadata: { model, provider: 'google', mock: true },
      }
    }

    const opinion = cannedOpinion || {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'no material defect observed',
      sourceEvidence: [
        {
          source: 'facts.overview',
          supportFound: true,
          notes: 'Supported by mock premise',
        },
      ],
      sourceBoundaryReason: 'Candidate copy stays within verified factual boundary.',
      confidence: 'HIGH',
      advisoryOnly: true,
      uncertaintyNotes: null,
    }

    return {
      rawResponseText: JSON.stringify(opinion, null, 2),
      metadata: { model, provider: 'google', mock: true, promptTokens: 450, completionTokens: 120 },
    }
  }
}

/**
 * Deterministic Mock Claude Reviewer for test execution.
 */
export function createMockClaudeReviewer({
  model = 'mock-claude-v1',
  cannedOpinion = null,
  failMode = null,
  latencyMs = 0,
} = {}) {
  return async function mockClaudeTransport({ isolatedRequest }) {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
    }

    if (failMode === 'UNAVAILABLE') {
      const err = new Error('PROVIDER_UNAVAILABLE: Claude mock service unavailable')
      err.code = 'PROVIDER_UNAVAILABLE'
      throw err
    }
    if (failMode === 'MALFORMED_JSON') {
      return {
        rawResponseText: '<<<Not JSON>>>',
        metadata: { model, provider: 'anthropic', mock: true },
      }
    }
    if (failMode === 'SCHEMA_INVALID') {
      return {
        rawResponseText: JSON.stringify({
          preliminaryDecision: 'REVISE',
          preliminarySeverity: null,
          affectedFields: ['description'],
          issueSummaries: ['Missing fact'],
          claimSpan: 'span',
          sourceEvidence: [{ source: 'facts.overview', supportFound: false }],
          sourceBoundaryReason: 'Boundary breach',
          confidence: 'HIGH',
          advisoryOnly: true,
        }),
        metadata: { model, provider: 'anthropic', mock: true },
      }
    }

    const opinion = cannedOpinion || {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'factual alignment confirmed',
      sourceEvidence: [
        {
          source: 'facts.overview',
          supportFound: true,
          notes: 'Confirmed by mock reference',
        },
      ],
      sourceBoundaryReason: 'All claims are factual and supported by source reference.',
      confidence: 'HIGH',
      advisoryOnly: true,
      uncertaintyNotes: null,
    }

    return {
      rawResponseText: JSON.stringify(opinion, null, 2),
      metadata: { model, provider: 'anthropic', mock: true, promptTokens: 440, completionTokens: 115 },
    }
  }
}
