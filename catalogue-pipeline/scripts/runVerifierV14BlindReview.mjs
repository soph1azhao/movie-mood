import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectBlindPacket } from './blindReviewPacket.mjs'
import { validateJsonSchema } from './jsonSchemaValidator.mjs'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import {
  AUTHORITATIVE_HUMAN_ADJUDICATOR,
  atomicWriteJson,
  atomicWriteText,
  assertValidTransition,
  deriveAgreementPattern,
  getNextReviewCandidate,
  normalizeAgreementPattern,
  persistReviewSessionLedger,
  updateLedgerWithHumanAdjudication,
  validateReviewSessionLedger,
} from './verifierV14ReviewState.mjs'
import {
  FROZEN_BINDINGS,
  loadGovernedReviewerPrompt,
  loadGovernedMaterialityPolicy,
  reviewBlindPacket,
  validateAndBuildAdvisoryEnvelope,
  verifyPromptAndPolicyHashes,
} from './verifierV14ReviewerAdapter.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

const packetSchemaPath = path.join(p2Dir, 'blind-human-review-packet.schema.v1.json')
const humanRecordSchemaPath = path.join(p2Dir, 'human-adjudication-record.schema.v1.json')
const bundleSchemaPath = path.join(p2Dir, 'human-review-bundle.schema.v1.json')
const envelopeSchemaPath = path.join(p2Dir, 'preliminary-advisory-record.schema.v1.json')
const opinionSchemaPath = path.join(p2Dir, 'preliminary-advisory-review.schema.v1.json')

export function sha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

export function isDeepEqual(a, b) {
  try {
    return serializeArtifactForPersistence(a) === serializeArtifactForPersistence(b)
  } catch {
    return false
  }
}

/**
 * Step 1: Prepares candidate execution directory and projects the canonical blind packet.
 * Reuses existing valid packet without clobbering; throws on conflict.
 */
export function prepareCandidateExecution({
  candidateId,
  eligiblePool,
  reviewOrder,
  executionRoot,
}) {
  if (!candidateId) throw new Error('INVALID_ARGUMENT: candidateId required')
  if (!eligiblePool || !Array.isArray(eligiblePool.records)) {
    throw new Error('INVALID_ARGUMENT: valid eligiblePool required')
  }

  const candidateRecord = eligiblePool.records.find((r) => r.candidateId === candidateId)
  if (!candidateRecord) {
    throw new Error(`ELIGIBILITY_ERROR: Candidate '${candidateId}' not found in eligible pool`)
  }

  const absRiskInputPath = path.join(repoRoot, candidateRecord.frozenRiskInputPath)
  if (!fs.existsSync(absRiskInputPath)) {
    throw new Error(`FILE_NOT_FOUND: Frozen risk input missing at ${candidateRecord.frozenRiskInputPath}`)
  }
  const riskInputBytes = fs.readFileSync(absRiskInputPath)
  const actualRiskInputSha = sha256(riskInputBytes)
  if (actualRiskInputSha !== candidateRecord.riskInputByteSha256) {
    throw new Error(
      `RISK_INPUT_HASH_MISMATCH: Frozen risk input hash mismatch for ${candidateId}. ` +
      `Expected ${candidateRecord.riskInputByteSha256}, got ${actualRiskInputSha}`
    )
  }

  const rawRiskInput = JSON.parse(riskInputBytes.toString('utf8'))
  const projectedPacket = projectBlindPacket(rawRiskInput, candidateId)

  const packetSchema = JSON.parse(fs.readFileSync(packetSchemaPath, 'utf8'))
  const validation = validateJsonSchema(projectedPacket, packetSchema)
  if (!validation.valid) {
    throw new Error(`PACKET_SCHEMA_INVALID: ${validation.errors.join('; ')}`)
  }

  const candidateDir = path.join(executionRoot, candidateId)
  const packetPath = path.join(candidateDir, 'blind-packet.v1.json')

  if (fs.existsSync(packetPath)) {
    const existingRaw = fs.readFileSync(packetPath, 'utf8')
    const existing = JSON.parse(existingRaw)
    if (isDeepEqual(existing, projectedPacket)) {
      return {
        candidateId,
        candidateDir,
        projectedPacket: existing,
        packetBytes: Buffer.from(existingRaw, 'utf8'),
        blindPacketSha256: sha256(existingRaw),
        packetPath,
        reused: true,
      }
    }
    throw new Error(`INTEGRITY_CONFLICT: Existing blind packet on disk differs from canonical projection for '${candidateId}'`)
  }

  const { bytes: packetBytes, sha256: packetSha } = atomicWriteJson(packetPath, projectedPacket)

  return {
    candidateId,
    candidateDir,
    projectedPacket,
    packetBytes,
    blindPacketSha256: packetSha,
    packetPath,
    reused: false,
  }
}

/**
 * Resolves an existing valid advisory attempt or executes a new versioned attempt.
 * Persists attempts immutably in attempts/attempt-XXX/.
 */
export async function resolveOrExecuteReviewerAttempt({
  reviewer,
  reviewerModel,
  candidateId,
  candidateDir,
  packetBytes,
  blindPacketSha256,
  transportHandler,
  reviewerPromptText,
  reviewerPromptSha256,
  materialityPolicySha256,
}) {
  if (reviewerPromptText !== undefined || reviewerPromptSha256 !== undefined) {
    throw new Error('PROMPT_AUTHORITY_VIOLATION: Caller-supplied prompt overrides are strictly forbidden in governed review execution')
  }
  if (materialityPolicySha256 !== undefined && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy overrides are strictly forbidden in governed review execution')
  }

  if (!reviewerModel || typeof reviewerModel !== 'string' || !reviewerModel.trim()) {
    throw new Error(`INVALID_REVIEWER_MODEL: Non-empty reviewerModel required for ${reviewer}`)
  }

  const governedPrompt = loadGovernedReviewerPrompt(reviewer)
  const promptText = governedPrompt.promptText
  const promptSha = governedPrompt.promptSha256
  const policySha = FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256

  // Verify prompt and policy hashes against disk
  verifyPromptAndPolicyHashes({
    reviewer,
    promptText,
    registeredPromptSha256: promptSha,
  })

  const reviewerDir = path.join(candidateDir, reviewer.toLowerCase())
  const attemptsDir = path.join(reviewerDir, 'attempts')
  if (!fs.existsSync(attemptsDir)) fs.mkdirSync(attemptsDir, { recursive: true })

  const envelopeSchema = JSON.parse(fs.readFileSync(envelopeSchemaPath, 'utf8'))
  const opinionSchema = JSON.parse(fs.readFileSync(opinionSchemaPath, 'utf8'))

  // 1. Check existing attempts
  const existingAttempts = fs.readdirSync(attemptsDir)
    .filter((d) => /^attempt-\d+$/.test(d))
    .sort()

  for (const attName of existingAttempts) {
    const attDir = path.join(attemptsDir, attName)
    const envPath = path.join(attDir, 'advisory-envelope.v1.json')
    const rawPath = path.join(attDir, 'raw-response.txt')

    if (fs.existsSync(envPath) && fs.existsSync(rawPath)) {
      try {
        const env = JSON.parse(fs.readFileSync(envPath, 'utf8'))
        const raw = fs.readFileSync(rawPath, 'utf8')
        const rawSha = sha256(raw)

        if (
          env.candidateId === candidateId &&
          env.reviewer === reviewer &&
          env.reviewerModel === reviewerModel &&
          env.blindPacketSha256 === blindPacketSha256 &&
          env.reviewPromptSha256 === promptSha &&
          env.materialityPolicySha256 === policySha &&
          env.rawResponseSha256 === rawSha &&
          validateJsonSchema(env, envelopeSchema).valid &&
          validateJsonSchema(env.validatedOpinion, opinionSchema).valid
        ) {
          const envelopeSha = sha256(serializeArtifactForPersistence(env))
          const activeEnvPath = path.join(reviewerDir, 'active-advisory-envelope.v1.json')
          atomicWriteJson(activeEnvPath, env)
          const legacyEnvPath = path.join(reviewerDir, 'advisory-envelope.v1.json')
          atomicWriteJson(legacyEnvPath, env)
          return {
            success: true,
            envelope: env,
            envelopeSha256: envelopeSha,
            attemptNumber: parseInt(attName.replace('attempt-', ''), 10),
            attemptDir: attDir,
            reused: true,
          }
        }
      } catch {
        // Continue scanning
      }
    }
  }

  // 2. No valid attempt exists -> execute a new attempt
  if (typeof transportHandler !== 'function') {
    throw new Error(`MISSING_REVIEWER: Reviewer handler function required for ${reviewer}`)
  }

  const nextAttemptNum = existingAttempts.length + 1
  const nextAttemptName = `attempt-${String(nextAttemptNum).padStart(3, '0')}`
  const nextAttemptDir = path.join(attemptsDir, nextAttemptName)
  fs.mkdirSync(nextAttemptDir, { recursive: true })

  const rawPath = path.join(nextAttemptDir, 'raw-response.txt')
  const metadataPath = path.join(nextAttemptDir, 'attempt-metadata.json')
  const valResultPath = path.join(nextAttemptDir, 'validation-result.json')

  let rawResponseText = null
  let transportMetadata = {}

  try {
    const raw = await reviewBlindPacket({
      reviewer,
      reviewerModel,
      promptText,
      blindPacketBytes: packetBytes,
      transportHandler,
    })
    rawResponseText = raw.rawResponseText
    transportMetadata = raw.transportMetadata || {}
  } catch (err) {
    atomicWriteJson(metadataPath, {
      attemptNumber: nextAttemptNum,
      timestamp: new Date().toISOString(),
      reviewer,
      reviewerModel,
      promptSha256: promptSha,
      policySha256: policySha,
      packetSha256: blindPacketSha256,
      status: 'PROVIDER_UNAVAILABLE',
      error: err.message,
    })
    atomicWriteJson(valResultPath, {
      valid: false,
      category: 'PROVIDER_UNAVAILABLE',
      errors: [err.message],
    })
    return {
      success: false,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      failedReviewer: reviewer,
      failureCategory: 'PROVIDER_UNAVAILABLE',
      error: err.message,
      attemptNumber: nextAttemptNum,
      attemptDir: nextAttemptDir,
    }
  }

  // Persist raw response atomically in attempt directory
  atomicWriteText(rawPath, rawResponseText)

  let builtEnvelope = null
  try {
    builtEnvelope = validateAndBuildAdvisoryEnvelope({
      rawResponseText,
      reviewer,
      reviewerModel,
      candidateId,
      blindPacketSha256,
      reviewPromptSha256: promptSha,
      materialityPolicySha256: policySha,
    })
  } catch (err) {
    const failureCategory = err.code === 'MALFORMED_ADVISORY_JSON' ? 'MALFORMED_JSON' : 'SCHEMA_INVALID'
    atomicWriteJson(metadataPath, {
      attemptNumber: nextAttemptNum,
      timestamp: new Date().toISOString(),
      reviewer,
      reviewerModel,
      promptSha256: promptSha,
      policySha256: policySha,
      packetSha256: blindPacketSha256,
      transportMetadata,
      status: failureCategory,
      error: err.message,
    })
    atomicWriteJson(valResultPath, {
      valid: false,
      category: failureCategory,
      errors: err.validationErrors || [err.message],
    })
    return {
      success: false,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      failedReviewer: reviewer,
      failureCategory,
      error: err.message,
      attemptNumber: nextAttemptNum,
      attemptDir: nextAttemptDir,
    }
  }

  // Valid advisory! Persist attempt envelope and active envelope
  const envPath = path.join(nextAttemptDir, 'advisory-envelope.v1.json')
  const { sha256: envelopeSha } = atomicWriteJson(envPath, builtEnvelope.envelope)
  const activeEnvPath = path.join(reviewerDir, 'active-advisory-envelope.v1.json')
  atomicWriteJson(activeEnvPath, builtEnvelope.envelope, { overwrite: true })
  const legacyEnvPath = path.join(reviewerDir, 'advisory-envelope.v1.json')
  atomicWriteJson(legacyEnvPath, builtEnvelope.envelope, { overwrite: true })

  atomicWriteJson(metadataPath, {
    attemptNumber: nextAttemptNum,
    timestamp: new Date().toISOString(),
    reviewer,
    reviewerModel,
    promptSha256: promptSha,
    policySha256: policySha,
    packetSha256: blindPacketSha256,
    transportMetadata,
    status: 'VALID',
    envelopeSha256: envelopeSha,
  })
  atomicWriteJson(valResultPath, {
    valid: true,
    category: 'VALID',
    errors: [],
  })

  return {
    success: true,
    envelope: builtEnvelope.envelope,
    envelopeSha256: envelopeSha,
    attemptNumber: nextAttemptNum,
    attemptDir: nextAttemptDir,
    reused: false,
  }
}

/**
 * Step 2: Collects model advisories from Gemini and Claude with versioned attempt tracking.
 */
export async function collectModelAdvisories({
  candidateId,
  candidateDir,
  packetBytes,
  blindPacketSha256,
  geminiReviewer,
  claudeReviewer,
  geminiModel,
  claudeModel,
  geminiPromptText,
  claudePromptText,
  geminiPromptSha256,
  claudePromptSha256,
  materialityPolicySha256,
}) {
  if (geminiPromptText !== undefined || claudePromptText !== undefined || geminiPromptSha256 !== undefined || claudePromptSha256 !== undefined) {
    throw new Error('PROMPT_AUTHORITY_VIOLATION: Caller-supplied prompt overrides are strictly forbidden in governed review execution')
  }
  if (materialityPolicySha256 !== undefined && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy overrides are strictly forbidden in governed review execution')
  }

  if (!geminiModel || typeof geminiModel !== 'string' || !geminiModel.trim()) {
    throw new Error('INVALID_REVIEWER_MODEL: Explicit non-empty geminiModel required')
  }
  if (!claudeModel || typeof claudeModel !== 'string' || !claudeModel.trim()) {
    throw new Error('INVALID_REVIEWER_MODEL: Explicit non-empty claudeModel required')
  }

  // 1. Gemini attempt
  const geminiRes = await resolveOrExecuteReviewerAttempt({
    reviewer: 'GEMINI',
    reviewerModel: geminiModel,
    candidateId,
    candidateDir,
    packetBytes,
    blindPacketSha256,
    transportHandler: geminiReviewer,
  })

  if (!geminiRes.success) {
    return {
      success: false,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      failedReviewer: 'GEMINI',
      failureCategory: geminiRes.failureCategory,
      error: geminiRes.error,
      geminiEnvelope: null,
      claudeEnvelope: null,
    }
  }

  // 2. Claude attempt
  const claudeRes = await resolveOrExecuteReviewerAttempt({
    reviewer: 'CLAUDE',
    reviewerModel: claudeModel,
    candidateId,
    candidateDir,
    packetBytes,
    blindPacketSha256,
    transportHandler: claudeReviewer,
  })

  if (!claudeRes.success) {
    return {
      success: false,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      failedReviewer: 'CLAUDE',
      failureCategory: claudeRes.failureCategory,
      error: claudeRes.error,
      geminiEnvelope: geminiRes.envelope,
      geminiEnvelopeSha256: geminiRes.envelopeSha256,
      claudeEnvelope: null,
    }
  }

  return {
    success: true,
    geminiEnvelope: geminiRes.envelope,
    geminiEnvelopeSha256: geminiRes.envelopeSha256,
    claudeEnvelope: claudeRes.envelope,
    claudeEnvelopeSha256: claudeRes.envelopeSha256,
  }
}

/**
 * Step 3: Constructs the deterministic human review bundle for Sophia Zhao.
 */
export function createHumanReviewBundle({
  candidateId,
  candidateDir,
  projectedPacket,
  blindPacketSha256,
  geminiEnvelope,
  geminiEnvelopeSha256,
  claudeEnvelope,
  claudeEnvelopeSha256,
  materialityPolicySha256,
}) {
  if (materialityPolicySha256 !== undefined && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy overrides are strictly forbidden in governed review execution')
  }
  const policySha = FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256

  if (geminiEnvelope.blindPacketSha256 !== blindPacketSha256) {
    throw new Error('PACKET_HASH_MISMATCH: Gemini envelope blindPacketSha256 mismatch')
  }
  if (claudeEnvelope.blindPacketSha256 !== blindPacketSha256) {
    throw new Error('PACKET_HASH_MISMATCH: Claude envelope blindPacketSha256 mismatch')
  }
  if (geminiEnvelope.candidateId !== candidateId || claudeEnvelope.candidateId !== candidateId) {
    throw new Error('CANDIDATE_ID_MISMATCH: Advisory envelope candidateId does not match bundle candidateId')
  }
  if (geminiEnvelope.reviewPromptSha256 !== FROZEN_BINDINGS.GEMINI_PROMPT_SHA256) {
    throw new Error('PROMPT_HASH_MISMATCH: Gemini envelope reviewPromptSha256 does not match frozen authority')
  }
  if (claudeEnvelope.reviewPromptSha256 !== FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256) {
    throw new Error('PROMPT_HASH_MISMATCH: Claude envelope reviewPromptSha256 does not match frozen authority')
  }
  if (geminiEnvelope.materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('MATERIALITY_POLICY_HASH_MISMATCH: Gemini envelope materialityPolicySha256 does not match frozen authority')
  }
  if (claudeEnvelope.materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('MATERIALITY_POLICY_HASH_MISMATCH: Claude envelope materialityPolicySha256 does not match frozen authority')
  }

  if (geminiEnvelope.blindPacketSha256 !== blindPacketSha256) {
    throw new Error('PACKET_HASH_MISMATCH: Gemini envelope blindPacketSha256 mismatch')
  }
  if (claudeEnvelope.blindPacketSha256 !== blindPacketSha256) {
    throw new Error('PACKET_HASH_MISMATCH: Claude envelope blindPacketSha256 mismatch')
  }
  if (geminiEnvelope.candidateId !== candidateId || claudeEnvelope.candidateId !== candidateId) {
    throw new Error('CANDIDATE_ID_MISMATCH: Advisory envelope candidateId does not match bundle candidateId')
  }

  const bundle = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'human-review-bundle.v1',
    status: 'READY_FOR_HUMAN_ADJUDICATION',
    candidateId,
    blindPacketSha256,
    geminiAdvisoryEnvelopeSha256: geminiEnvelopeSha256,
    claudeAdvisoryEnvelopeSha256: claudeEnvelopeSha256,
    materialityPolicySha256: policySha,
    blindPacket: projectedPacket,
    geminiAdvisory: geminiEnvelope.validatedOpinion,
    claudeAdvisory: claudeEnvelope.validatedOpinion,
    validationStatus: {
      geminiValidated: true,
      claudeValidated: true,
      packetHashMatched: true,
    },
  }

  const bundleSchema = JSON.parse(fs.readFileSync(bundleSchemaPath, 'utf8'))
  const validation = validateJsonSchema(bundle, bundleSchema)
  if (!validation.valid) {
    throw new Error(`BUNDLE_SCHEMA_INVALID: ${validation.errors.join('; ')}`)
  }

  const bundlePath = path.join(candidateDir, 'human-review-bundle.v1.json')

  if (fs.existsSync(bundlePath)) {
    const existingRaw = fs.readFileSync(bundlePath, 'utf8')
    const existing = JSON.parse(existingRaw)
    if (
      existing.candidateId === candidateId &&
      existing.blindPacketSha256 === blindPacketSha256 &&
      existing.geminiAdvisoryEnvelopeSha256 === geminiEnvelopeSha256 &&
      existing.claudeAdvisoryEnvelopeSha256 === claudeEnvelopeSha256 &&
      isDeepEqual(existing.blindPacket, projectedPacket) &&
      isDeepEqual(existing.geminiAdvisory, geminiEnvelope.validatedOpinion) &&
      isDeepEqual(existing.claudeAdvisory, claudeEnvelope.validatedOpinion)
    ) {
      return {
        bundle: existing,
        bundleSha256: sha256(existingRaw),
        bundlePath,
        reused: true,
      }
    }
    throw new Error(`INTEGRITY_CONFLICT: Existing bundle differs from newly constructed bundle for '${candidateId}'`)
  }

  const { sha256: bundleSha256 } = atomicWriteJson(bundlePath, bundle)

  return {
    bundle,
    bundleSha256,
    bundlePath,
    reused: false,
  }
}

/**
 * Authoritative shared artifact-chain verifier.
 * Validates full disk evidence chain before presentation, acceptance, resume, or reconciliation.
 */
export function verifyCandidateReviewEvidenceChain({
  candidateId,
  candidateDir,
  bindings = {},
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (!candidateDir || !fs.existsSync(candidateDir)) {
    throw new Error(`INTEGRITY_FAILURE: candidate directory missing at ${candidateDir}`)
  }

  const packetSchema = JSON.parse(fs.readFileSync(packetSchemaPath, 'utf8'))
  const envelopeSchema = JSON.parse(fs.readFileSync(envelopeSchemaPath, 'utf8'))
  const opinionSchema = JSON.parse(fs.readFileSync(opinionSchemaPath, 'utf8'))
  const bundleSchema = JSON.parse(fs.readFileSync(bundleSchemaPath, 'utf8'))
  const humanRecordSchema = JSON.parse(fs.readFileSync(humanRecordSchemaPath, 'utf8'))

  // Caller bindings cannot override frozen prompt or policy hashes
  if (bindings.geminiPromptSha256 !== undefined && bindings.geminiPromptSha256 !== FROZEN_BINDINGS.GEMINI_PROMPT_SHA256) {
    throw new Error('AUTHORITY_VIOLATION: Caller bindings cannot override frozen Gemini prompt SHA')
  }
  if (bindings.claudePromptSha256 !== undefined && bindings.claudePromptSha256 !== FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256) {
    throw new Error('AUTHORITY_VIOLATION: Caller bindings cannot override frozen Claude prompt SHA')
  }
  if (bindings.materialityPolicySha256 !== undefined && bindings.materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('AUTHORITY_VIOLATION: Caller bindings cannot override frozen materiality policy SHA')
  }

  const expectedPolicySha = FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256
  const expectedGeminiPromptSha = FROZEN_BINDINGS.GEMINI_PROMPT_SHA256
  const expectedClaudePromptSha = FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256

  // Verify disk materiality policy exists and matches frozen hash
  const policyPath = path.join(repoRoot, FROZEN_BINDINGS.MATERIALITY_POLICY_PATH)
  if (!fs.existsSync(policyPath)) {
    throw new Error(`INTEGRITY_FAILURE: Governed materiality policy missing at ${policyPath}`)
  }
  const policyBytes = fs.readFileSync(policyPath)
  if (sha256(policyBytes) !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('INTEGRITY_FAILURE: Disk materiality policy hash does not match frozen authority')
  }

  // 1. Blind Packet
  const packetPath = path.join(candidateDir, 'blind-packet.v1.json')
  if (!fs.existsSync(packetPath)) {
    throw new Error(`INTEGRITY_FAILURE: Blind packet file missing at ${packetPath}`)
  }
  const diskPacketRaw = fs.readFileSync(packetPath, 'utf8')
  const diskPacketBytes = Buffer.from(diskPacketRaw, 'utf8')
  const diskPacketSha = sha256(diskPacketBytes)
  const diskPacket = JSON.parse(diskPacketRaw)

  const packetVal = validateJsonSchema(diskPacket, packetSchema)
  if (!packetVal.valid) {
    throw new Error(`INTEGRITY_FAILURE: Blind packet schema invalid: ${packetVal.errors.join('; ')}`)
  }
  if (diskPacket.candidateId !== candidateId) {
    throw new Error(`INTEGRITY_FAILURE: Blind packet candidateId '${diskPacket.candidateId}' mismatch for '${candidateId}'`)
  }

  // 2. Gemini Active Advisory Envelope
  const geminiEnvPath = fs.existsSync(path.join(candidateDir, 'gemini/active-advisory-envelope.v1.json'))
    ? path.join(candidateDir, 'gemini/active-advisory-envelope.v1.json')
    : path.join(candidateDir, 'gemini/advisory-envelope.v1.json')

  if (!fs.existsSync(geminiEnvPath)) {
    throw new Error(`INTEGRITY_FAILURE: Gemini advisory envelope missing at ${geminiEnvPath}`)
  }
  const geminiEnv = JSON.parse(fs.readFileSync(geminiEnvPath, 'utf8'))
  const geminiEnvSha = sha256(serializeArtifactForPersistence(geminiEnv))

  const gEnvVal = validateJsonSchema(geminiEnv, envelopeSchema)
  if (!gEnvVal.valid) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope schema invalid: ${gEnvVal.errors.join('; ')}`)
  }
  if (geminiEnv.candidateId !== candidateId) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope candidateId '${geminiEnv.candidateId}' mismatch for '${candidateId}'`)
  }
  if (geminiEnv.reviewer !== 'GEMINI') {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope reviewer '${geminiEnv.reviewer}' is not 'GEMINI'`)
  }
  if (bindings.geminiModel && geminiEnv.reviewerModel !== bindings.geminiModel) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope reviewerModel '${geminiEnv.reviewerModel}' does not match registered '${bindings.geminiModel}'`)
  }
  if (geminiEnv.blindPacketSha256 !== diskPacketSha) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope blindPacketSha256 does not match disk blind packet SHA`)
  }
  if (geminiEnv.reviewPromptSha256 !== expectedGeminiPromptSha) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope reviewPromptSha256 does not match frozen prompt SHA`)
  }
  if (geminiEnv.materialityPolicySha256 !== expectedPolicySha) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope materialityPolicySha256 does not match frozen policy SHA`)
  }

  // Verify raw response hash against disk attempt
  let gRawMatched = false
  const gAttemptsDir = path.join(candidateDir, 'gemini/attempts')
  if (fs.existsSync(gAttemptsDir)) {
    const atts = fs.readdirSync(gAttemptsDir)
    for (const a of atts) {
      const rPath = path.join(gAttemptsDir, a, 'raw-response.txt')
      if (fs.existsSync(rPath)) {
        if (sha256(fs.readFileSync(rPath, 'utf8')) === geminiEnv.rawResponseSha256) {
          gRawMatched = true
          break
        }
      }
    }
  }
  if (!gRawMatched && fs.existsSync(path.join(candidateDir, 'gemini/raw-response.v1.txt'))) {
    if (sha256(fs.readFileSync(path.join(candidateDir, 'gemini/raw-response.v1.txt'), 'utf8')) === geminiEnv.rawResponseSha256) {
      gRawMatched = true
    }
  }
  if (!gRawMatched) {
    throw new Error(`INTEGRITY_FAILURE: Gemini envelope rawResponseSha256 does not match any persisted raw response bytes on disk`)
  }

  const gOpVal = validateJsonSchema(geminiEnv.validatedOpinion, opinionSchema)
  if (!gOpVal.valid) {
    throw new Error(`INTEGRITY_FAILURE: Gemini validatedOpinion schema invalid: ${gOpVal.errors.join('; ')}`)
  }

  // 3. Claude Active Advisory Envelope
  const claudeEnvPath = fs.existsSync(path.join(candidateDir, 'claude/active-advisory-envelope.v1.json'))
    ? path.join(candidateDir, 'claude/active-advisory-envelope.v1.json')
    : path.join(candidateDir, 'claude/advisory-envelope.v1.json')

  if (!fs.existsSync(claudeEnvPath)) {
    throw new Error(`INTEGRITY_FAILURE: Claude advisory envelope missing at ${claudeEnvPath}`)
  }
  const claudeEnv = JSON.parse(fs.readFileSync(claudeEnvPath, 'utf8'))
  const claudeEnvSha = sha256(serializeArtifactForPersistence(claudeEnv))

  const cEnvVal = validateJsonSchema(claudeEnv, envelopeSchema)
  if (!cEnvVal.valid) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope schema invalid: ${cEnvVal.errors.join('; ')}`)
  }
  if (claudeEnv.candidateId !== candidateId) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope candidateId '${claudeEnv.candidateId}' mismatch for '${candidateId}'`)
  }
  if (claudeEnv.reviewer !== 'CLAUDE') {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope reviewer '${claudeEnv.reviewer}' is not 'CLAUDE'`)
  }
  if (bindings.claudeModel && claudeEnv.reviewerModel !== bindings.claudeModel) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope reviewerModel '${claudeEnv.reviewerModel}' does not match registered '${bindings.claudeModel}'`)
  }
  if (claudeEnv.blindPacketSha256 !== diskPacketSha) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope blindPacketSha256 does not match disk blind packet SHA`)
  }
  if (claudeEnv.reviewPromptSha256 !== expectedClaudePromptSha) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope reviewPromptSha256 does not match frozen prompt SHA`)
  }
  if (claudeEnv.materialityPolicySha256 !== expectedPolicySha) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope materialityPolicySha256 does not match frozen policy SHA`)
  }

  let cRawMatched = false
  const cAttemptsDir = path.join(candidateDir, 'claude/attempts')
  if (fs.existsSync(cAttemptsDir)) {
    const atts = fs.readdirSync(cAttemptsDir)
    for (const a of atts) {
      const rPath = path.join(cAttemptsDir, a, 'raw-response.txt')
      if (fs.existsSync(rPath)) {
        if (sha256(fs.readFileSync(rPath, 'utf8')) === claudeEnv.rawResponseSha256) {
          cRawMatched = true
          break
        }
      }
    }
  }
  if (!cRawMatched && fs.existsSync(path.join(candidateDir, 'claude/raw-response.v1.txt'))) {
    if (sha256(fs.readFileSync(path.join(candidateDir, 'claude/raw-response.v1.txt'), 'utf8')) === claudeEnv.rawResponseSha256) {
      cRawMatched = true
    }
  }
  if (!cRawMatched) {
    throw new Error(`INTEGRITY_FAILURE: Claude envelope rawResponseSha256 does not match any persisted raw response bytes on disk`)
  }

  const cOpVal = validateJsonSchema(claudeEnv.validatedOpinion, opinionSchema)
  if (!cOpVal.valid) {
    throw new Error(`INTEGRITY_FAILURE: Claude validatedOpinion schema invalid: ${cOpVal.errors.join('; ')}`)
  }

  // 4. Human Review Bundle (if present)
  let bundle = null
  const bundlePath = path.join(candidateDir, 'human-review-bundle.v1.json')
  if (fs.existsSync(bundlePath)) {
    bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
    const bundleVal = validateJsonSchema(bundle, bundleSchema)
    if (!bundleVal.valid) {
      throw new Error(`INTEGRITY_FAILURE: Human review bundle schema invalid: ${bundleVal.errors.join('; ')}`)
    }
    if (bundle.candidateId !== candidateId) {
      throw new Error(`INTEGRITY_FAILURE: Bundle candidateId '${bundle.candidateId}' mismatch for '${candidateId}'`)
    }
    if (bundle.blindPacketSha256 !== diskPacketSha) {
      throw new Error(`INTEGRITY_FAILURE: Bundle blindPacketSha256 does not match disk packet SHA`)
    }
    if (bundle.geminiAdvisoryEnvelopeSha256 !== geminiEnvSha) {
      throw new Error(`INTEGRITY_FAILURE: Bundle geminiAdvisoryEnvelopeSha256 does not match disk Gemini envelope SHA`)
    }
    if (bundle.claudeAdvisoryEnvelopeSha256 !== claudeEnvSha) {
      throw new Error(`INTEGRITY_FAILURE: Bundle claudeAdvisoryEnvelopeSha256 does not match disk Claude envelope SHA`)
    }
    if (bundle.materialityPolicySha256 !== expectedPolicySha) {
      throw new Error(`INTEGRITY_FAILURE: Bundle materialityPolicySha256 does not match frozen policy SHA`)
    }

    // Exact packet body comparison (Requirement 7)
    if (!isDeepEqual(bundle.blindPacket, diskPacket)) {
      throw new Error(`INTEGRITY_FAILURE: Bundle embedded blindPacket differs from authoritative disk blind packet content`)
    }
    if (!isDeepEqual(bundle.geminiAdvisory, geminiEnv.validatedOpinion)) {
      throw new Error(`INTEGRITY_FAILURE: Bundle embedded geminiAdvisory differs from authoritative Gemini envelope opinion`)
    }
    if (!isDeepEqual(bundle.claudeAdvisory, claudeEnv.validatedOpinion)) {
      throw new Error(`INTEGRITY_FAILURE: Bundle embedded claudeAdvisory differs from authoritative Claude envelope opinion`)
    }
  }

  // 5. Human Adjudication Record (if present)
  let humanRecord = null
  const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')
  if (fs.existsSync(humanRecordPath)) {
    humanRecord = JSON.parse(fs.readFileSync(humanRecordPath, 'utf8'))
    const hVal = validateJsonSchema(humanRecord, humanRecordSchema)
    if (!hVal.valid) {
      throw new Error(`INTEGRITY_FAILURE: Human adjudication record schema invalid: ${hVal.errors.join('; ')}`)
    }
    if (humanRecord.candidateId !== candidateId) {
      throw new Error(`INTEGRITY_FAILURE: Human record candidateId '${humanRecord.candidateId}' mismatch for '${candidateId}'`)
    }
    if (humanRecord.adjudicator !== AUTHORITATIVE_HUMAN_ADJUDICATOR) {
      throw new Error(`INTEGRITY_FAILURE: Human record adjudicator '${humanRecord.adjudicator}' is not '${AUTHORITATIVE_HUMAN_ADJUDICATOR}'`)
    }
    if (humanRecord.blindPacketHash !== diskPacketSha) {
      throw new Error(`INTEGRITY_FAILURE: Human record blindPacketHash does not match disk packet SHA`)
    }
    if (humanRecord.geminiAdvisoryRecordSha256 !== geminiEnvSha) {
      throw new Error(`INTEGRITY_FAILURE: Human record geminiAdvisoryRecordSha256 does not match disk Gemini envelope SHA`)
    }
    if (humanRecord.claudeAdvisoryRecordSha256 !== claudeEnvSha) {
      throw new Error(`INTEGRITY_FAILURE: Human record claudeAdvisoryRecordSha256 does not match disk Claude envelope SHA`)
    }

    const canonicalPattern = deriveAgreementPattern({
      geminiDecision: geminiEnv.validatedOpinion.preliminaryDecision,
      claudeDecision: claudeEnv.validatedOpinion.preliminaryDecision,
      humanDecision: humanRecord.finalDecision,
    })

    const normalizedPattern = normalizeAgreementPattern(humanRecord.agreementPattern, {
      geminiDecision: geminiEnv.validatedOpinion.preliminaryDecision,
      claudeDecision: claudeEnv.validatedOpinion.preliminaryDecision,
      humanDecision: humanRecord.finalDecision,
    })

    if (normalizedPattern !== canonicalPattern) {
      throw new Error(`INTEGRITY_FAILURE: Human record agreement pattern '${humanRecord.agreementPattern}' is invalid`)
    }
  }

  return {
    valid: true,
    diskPacket,
    diskPacketSha,
    geminiEnvelope: geminiEnv,
    geminiEnvelopeSha: geminiEnvSha,
    claudeEnvelope: claudeEnv,
    claudeEnvelopeSha: claudeEnvSha,
    bundle,
    humanRecord,
  }
}

export const verifyHumanReviewBundleIntegrity = verifyCandidateReviewEvidenceChain

/**
 * Step 4: Ingests and validates Sophia Zhao's authoritative human adjudication.
 */
export function recordHumanAdjudication({
  candidateId,
  candidateDir,
  reviewSequenceIndex,
  bundle,
  adjudicationData,
  ledger,
  ledgerPath = null,
  materialityPolicySha256,
  geminiModel = null,
  claudeModel = null,
}) {
  if (materialityPolicySha256 !== undefined && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy overrides are strictly forbidden in governed review execution')
  }

  if (adjudicationData.adjudicator !== AUTHORITATIVE_HUMAN_ADJUDICATOR) {
    throw new Error(`UNAUTHORIZED_ADJUDICATOR: Adjudicator must be '${AUTHORITATIVE_HUMAN_ADJUDICATOR}', got '${adjudicationData.adjudicator}'`)
  }
  if (adjudicationData.candidateId !== candidateId) {
    throw new Error(`CANDIDATE_ID_MISMATCH: Adjudication candidateId does not match expected '${candidateId}'`)
  }
  if (adjudicationData.blindPacketHash !== bundle.blindPacketSha256) {
    throw new Error('BLIND_PACKET_HASH_MISMATCH: Adjudication blindPacketHash does not match bundle')
  }
  if (adjudicationData.geminiAdvisoryRecordSha256 !== bundle.geminiAdvisoryEnvelopeSha256) {
    throw new Error('GEMINI_ENVELOPE_HASH_MISMATCH: geminiAdvisoryRecordSha256 does not match bundle')
  }
  if (adjudicationData.claudeAdvisoryRecordSha256 !== bundle.claudeAdvisoryEnvelopeSha256) {
    throw new Error('CLAUDE_ENVELOPE_HASH_MISMATCH: claudeAdvisoryRecordSha256 does not match bundle')
  }

  // Mechanically normalize agreementPattern using canonical derived enum
  const canonicalPattern = normalizeAgreementPattern(adjudicationData.agreementPattern, {
    geminiDecision: bundle.geminiAdvisory.preliminaryDecision,
    claudeDecision: bundle.claudeAdvisory.preliminaryDecision,
    humanDecision: adjudicationData.finalDecision,
  })

  const fullRecord = {
    candidateId,
    blindPacketHash: bundle.blindPacketSha256,
    geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
    claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
    adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
    finalDecision: adjudicationData.finalDecision,
    finalSeverity: adjudicationData.finalSeverity || null,
    affectedFields: adjudicationData.affectedFields || [],
    materialIssues: adjudicationData.materialIssues || [],
    humanRationale: adjudicationData.humanRationale,
    agreementPattern: canonicalPattern,
    adjudicationTimestamp: adjudicationData.adjudicationTimestamp || new Date().toISOString(),
  }

  const humanRecordSchema = JSON.parse(fs.readFileSync(humanRecordSchemaPath, 'utf8'))
  const validation = validateJsonSchema(fullRecord, humanRecordSchema)
  if (!validation.valid) {
    throw new Error(`HUMAN_ADJUDICATION_SCHEMA_INVALID: ${validation.errors.join('; ')}`)
  }

  const humanDir = path.join(candidateDir, 'human')
  const recordPath = path.join(humanDir, 'adjudication-record.v1.json')

  // Check no-clobber / reuse
  if (fs.existsSync(recordPath)) {
    const existingRaw = fs.readFileSync(recordPath, 'utf8')
    const existing = JSON.parse(existingRaw)
    const existingSha = sha256(serializeArtifactForPersistence(existing))
    const newSha = sha256(serializeArtifactForPersistence(fullRecord))

    if (existingSha === newSha) {
      return {
        record: existing,
        recordSha256: existingSha,
        recordPath,
        updatedLedger: ledger,
        reused: true,
      }
    }
    throw new Error(`DUPLICATE_ADJUDICATION: Adjudication record already exists and differs at ${recordPath}`)
  }

  const { sha256: recordSha } = atomicWriteJson(recordPath, fullRecord)

  // Verify the entire artifact chain
  verifyCandidateReviewEvidenceChain({
    candidateId,
    candidateDir,
    bindings: {
      geminiModel,
      claudeModel,
    },
  })

  const updatedLedger = updateLedgerWithHumanAdjudication({
    ledger,
    candidateId,
    reviewSequenceIndex,
    humanAdjudication: fullRecord,
    humanAdjudicationSha256: recordSha,
    blindPacketSha256: bundle.blindPacketSha256,
    geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
    claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
  })

  if (ledgerPath) {
    persistReviewSessionLedger(ledgerPath, updatedLedger)
  }

  return {
    record: fullRecord,
    recordSha256: recordSha,
    recordPath,
    updatedLedger,
    reused: false,
  }
}

/**
 * Master end-to-end candidate review orchestrator for one candidate in sequence.
 * Fully state-aware, crash-resilient, and resumable.
 */
export async function executeCandidateReviewWorkflow({
  candidateId,
  executionRoot,
  eligiblePool,
  reviewOrder,
  ledger,
  ledgerPath = null,
  geminiReviewer,
  claudeReviewer,
  geminiModel,
  claudeModel,
  geminiPromptText,
  claudePromptText,
  geminiPromptSha256,
  claudePromptSha256,
  materialityPolicySha256,
  humanAdjudicatorCallback = null,
}) {
  if (geminiPromptText !== undefined || claudePromptText !== undefined || geminiPromptSha256 !== undefined || claudePromptSha256 !== undefined) {
    throw new Error('PROMPT_AUTHORITY_VIOLATION: Caller-supplied prompt overrides are strictly forbidden in governed review execution')
  }
  if (materialityPolicySha256 !== undefined && materialityPolicySha256 !== FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256) {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller-supplied materiality policy overrides are strictly forbidden in governed review execution')
  }

  if (!geminiModel || typeof geminiModel !== 'string' || !geminiModel.trim()) {
    throw new Error('INVALID_REVIEWER_MODEL: Explicit non-empty geminiModel required')
  }
  if (!claudeModel || typeof claudeModel !== 'string' || !claudeModel.trim()) {
    throw new Error('INVALID_REVIEWER_MODEL: Explicit non-empty claudeModel required')
  }

  const candidateDir = path.join(executionRoot, candidateId)
  const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')

  // Check if candidate is already adjudicated on disk -> verify full chain and reconcile
  if (fs.existsSync(humanRecordPath)) {
    const chain = verifyCandidateReviewEvidenceChain({
      candidateId,
      candidateDir,
      bindings: {
        geminiModel,
        claudeModel,
      },
    })

    const existingRecord = chain.humanRecord
    const recordSha = sha256(serializeArtifactForPersistence(existingRecord))

    const orderList = reviewOrder.orderedCandidates || reviewOrder.order || []
    const entry = orderList.find((e) => e.candidateId === candidateId)
    const seqIndex = entry ? (entry.reviewSequenceIndex || 1) : 1

    if (!ledger.candidateStates[candidateId] || ledger.candidateStates[candidateId].status !== 'HUMAN_ADJUDICATED') {
      updateLedgerWithHumanAdjudication({
        ledger,
        candidateId,
        reviewSequenceIndex: seqIndex,
        humanAdjudication: existingRecord,
        humanAdjudicationSha256: recordSha,
        blindPacketSha256: existingRecord.blindPacketHash,
        geminiAdvisoryRecordSha256: existingRecord.geminiAdvisoryRecordSha256,
        claudeAdvisoryRecordSha256: existingRecord.claudeAdvisoryRecordSha256,
      })
      if (ledgerPath) {
        persistReviewSessionLedger(ledgerPath, ledger)
      }
    }

    return {
      status: 'HUMAN_ADJUDICATED',
      candidateId,
      record: existingRecord,
      recordSha256: recordSha,
      ledger,
      resumed: true,
    }
  }

  // Determine candidate from sequence
  const selection = getNextReviewCandidate({ ledger, reviewOrder })
  if (selection.stoppingRuleSatisfied) {
    return { status: 'STOPPING_RULE_SATISFIED', ledger }
  }
  if (selection.exhaustedPool) {
    return { status: 'VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT', ledger }
  }
  if (selection.paused && selection.candidate.candidateId !== candidateId) {
    return { status: 'REVIEW_PAUSED_PENDING_ADVISORY', pausedCandidateId: selection.candidate.candidateId, ledger }
  }

  if (selection.candidate.candidateId !== candidateId) {
    throw new Error(
      `OUT_OF_ORDER_EXECUTION: Requested candidate '${candidateId}', ` +
      `but expected candidate in sequence is '${selection.candidate.candidateId}' (sequence ${selection.sequenceIndex})`
    )
  }

  // Step 1: Prepare blind packet
  const prep = prepareCandidateExecution({
    candidateId,
    eligiblePool,
    reviewOrder,
    executionRoot,
  })

  // State Transition: PENDING -> PACKET_FROZEN
  const prevState = ledger.candidateStates[candidateId]?.status || 'PENDING'
  if (prevState === 'PENDING') {
    assertValidTransition('PENDING', 'PACKET_FROZEN')
    ledger.candidateStates[candidateId] = {
      candidateId,
      reviewSequenceIndex: selection.sequenceIndex,
      status: 'PACKET_FROZEN',
      blindPacketSha256: prep.blindPacketSha256,
    }
    if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)
  }

  // Step 2: Collect Gemini Advisory
  let geminiEnvelope = null
  let geminiEnvelopeSha256 = null

  // Transition to GEMINI_PENDING
  const curStateG = ledger.candidateStates[candidateId]?.status || 'PACKET_FROZEN'
  if (curStateG === 'PACKET_FROZEN' || curStateG === 'REVIEW_PAUSED_PENDING_ADVISORY') {
    assertValidTransition(curStateG, 'GEMINI_PENDING')
    ledger.candidateStates[candidateId] = {
      ...ledger.candidateStates[candidateId],
      status: 'GEMINI_PENDING',
    }
    if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)
  }

  const geminiRes = await resolveOrExecuteReviewerAttempt({
    reviewer: 'GEMINI',
    reviewerModel: geminiModel,
    candidateId,
    candidateDir,
    packetBytes: prep.packetBytes,
    blindPacketSha256: prep.blindPacketSha256,
    transportHandler: geminiReviewer,
  })

  if (!geminiRes.success) {
    assertValidTransition('GEMINI_PENDING', 'GEMINI_INVALID')
    assertValidTransition('GEMINI_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY')
    ledger.candidateStates[candidateId] = {
      candidateId,
      reviewSequenceIndex: selection.sequenceIndex,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      blindPacketSha256: prep.blindPacketSha256,
      failedReviewer: 'GEMINI',
      failureCategory: geminiRes.failureCategory,
      error: geminiRes.error,
    }
    if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

    return {
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      candidateId,
      failedReviewer: 'GEMINI',
      failureCategory: geminiRes.failureCategory,
      error: geminiRes.error,
      ledger,
    }
  }

  geminiEnvelope = geminiRes.envelope
  geminiEnvelopeSha256 = geminiRes.envelopeSha256

  // Transition to GEMINI_VALID
  assertValidTransition('GEMINI_PENDING', 'GEMINI_VALID')
  ledger.candidateStates[candidateId] = {
    ...ledger.candidateStates[candidateId],
    status: 'GEMINI_VALID',
    geminiAdvisoryRecordSha256: geminiEnvelopeSha256,
  }
  if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

  // Step 3: Collect Claude Advisory
  assertValidTransition('GEMINI_VALID', 'CLAUDE_PENDING')
  ledger.candidateStates[candidateId] = {
    ...ledger.candidateStates[candidateId],
    status: 'CLAUDE_PENDING',
  }
  if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

  const claudeRes = await resolveOrExecuteReviewerAttempt({
    reviewer: 'CLAUDE',
    reviewerModel: claudeModel,
    candidateId,
    candidateDir,
    packetBytes: prep.packetBytes,
    blindPacketSha256: prep.blindPacketSha256,
    transportHandler: claudeReviewer,
  })

  if (!claudeRes.success) {
    assertValidTransition('CLAUDE_PENDING', 'CLAUDE_INVALID')
    assertValidTransition('CLAUDE_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY')
    ledger.candidateStates[candidateId] = {
      candidateId,
      reviewSequenceIndex: selection.sequenceIndex,
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      blindPacketSha256: prep.blindPacketSha256,
      geminiAdvisoryRecordSha256: geminiEnvelopeSha256,
      failedReviewer: 'CLAUDE',
      failureCategory: claudeRes.failureCategory,
      error: claudeRes.error,
    }
    if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

    return {
      status: 'REVIEW_PAUSED_PENDING_ADVISORY',
      candidateId,
      failedReviewer: 'CLAUDE',
      failureCategory: claudeRes.failureCategory,
      error: claudeRes.error,
      ledger,
    }
  }

  const claudeEnvelope = claudeRes.envelope
  const claudeEnvelopeSha256 = claudeRes.envelopeSha256

  assertValidTransition('CLAUDE_PENDING', 'CLAUDE_VALID')
  ledger.candidateStates[candidateId] = {
    ...ledger.candidateStates[candidateId],
    status: 'CLAUDE_VALID',
    claudeAdvisoryRecordSha256: claudeEnvelopeSha256,
  }
  if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

  // Step 4: Create Human Review Bundle
  const bundleResult = createHumanReviewBundle({
    candidateId,
    candidateDir,
    projectedPacket: prep.projectedPacket,
    blindPacketSha256: prep.blindPacketSha256,
    geminiEnvelope,
    geminiEnvelopeSha256,
    claudeEnvelope,
    claudeEnvelopeSha256,
  })

  assertValidTransition('CLAUDE_VALID', 'READY_FOR_HUMAN_ADJUDICATION')
  ledger.candidateStates[candidateId] = {
    candidateId,
    reviewSequenceIndex: selection.sequenceIndex,
    status: 'READY_FOR_HUMAN_ADJUDICATION',
    blindPacketSha256: prep.blindPacketSha256,
    geminiAdvisoryRecordSha256: geminiEnvelopeSha256,
    claudeAdvisoryRecordSha256: claudeEnvelopeSha256,
  }
  if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

  // Verify evidence chain before human presentation
  verifyCandidateReviewEvidenceChain({
    candidateId,
    candidateDir,
    bindings: {
      geminiModel,
      claudeModel,
    },
  })

  // If no human callback provided, return bundle
  if (!humanAdjudicatorCallback) {
    return {
      status: 'READY_FOR_HUMAN_ADJUDICATION',
      candidateId,
      bundle: bundleResult.bundle,
      bundleSha256: bundleResult.bundleSha256,
      ledger,
    }
  }

  // Step 5: Authoritative Human Adjudication
  assertValidTransition('READY_FOR_HUMAN_ADJUDICATION', 'HUMAN_ADJUDICATION_PENDING')
  ledger.candidateStates[candidateId] = {
    ...ledger.candidateStates[candidateId],
    status: 'HUMAN_ADJUDICATION_PENDING',
  }
  if (ledgerPath) persistReviewSessionLedger(ledgerPath, ledger)

  const adjudicationData = await humanAdjudicatorCallback(bundleResult.bundle)

  const humanResult = recordHumanAdjudication({
    candidateId,
    candidateDir,
    reviewSequenceIndex: selection.sequenceIndex,
    bundle: bundleResult.bundle,
    adjudicationData,
    ledger,
    ledgerPath,
    materialityPolicySha256,
    geminiModel,
    claudeModel,
  })

  return {
    status: 'HUMAN_ADJUDICATED',
    candidateId,
    record: humanResult.record,
    recordSha256: humanResult.recordSha256,
    ledger: humanResult.updatedLedger,
    bundle: bundleResult.bundle,
  }
}

export const resumeCandidateReviewWorkflow = executeCandidateReviewWorkflow
