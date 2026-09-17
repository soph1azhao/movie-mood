#!/usr/bin/env node

/**
 * Movie Mood V8.2 — Verifier v1.4 Manual Preliminary Advisory Review Operator Tool
 * Activity: VERIFIER_V14_P2_4_MANUAL_INGESTION_READINESS
 *
 * Governed entrypoint for preparing copy-ready review payloads, ingesting manual responses,
 * querying candidate review status, and constructing human review bundles.
 * Zero network, zero model APIs, deterministic and crash-resilient.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { projectBlindPacket } from './blindReviewPacket.mjs'
import { validateJsonSchema } from './jsonSchemaValidator.mjs'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import {
  atomicWriteJson,
  atomicWriteText,
  getNextReviewCandidate,
} from './verifierV14ReviewState.mjs'
import {
  FROZEN_BINDINGS,
  loadGovernedReviewerPrompt,
  loadGovernedMaterialityPolicy,
  validateAndBuildAdvisoryEnvelope,
  verifyPromptAndPolicyHashes,
} from './verifierV14ReviewerAdapter.mjs'
import {
  prepareCandidateExecution,
  createHumanReviewBundle,
  verifyCandidateReviewEvidenceChain,
} from './runVerifierV14BlindReview.mjs'

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const defaultP2Dir = path.join(defaultRepoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

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
 * Builds the deterministic copy-ready review payload.
 */
export function buildManualSubmissionPayload({
  candidateId,
  reviewer,
  reviewSequenceIndex,
  blindPacketBytes,
  blindPacketSha256,
  promptText,
  promptSha256,
  materialityPolicySha256,
}) {
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }

  const payloadHeader = [
    `# MOVIE MOOD V8.2 — PRELIMINARY ADVISORY REVIEW`,
    `Reviewer: ${reviewer}`,
    `Review Sequence Index: ${reviewSequenceIndex}`,
    `Candidate ID: ${candidateId}`,
    `Blind Packet SHA-256: ${blindPacketSha256}`,
    `Prompt SHA-256: ${promptSha256}`,
    `Materiality Policy SHA-256: ${materialityPolicySha256}`,
    `------------------------------------------------------------`,
  ].join('\n')

  const copyReadyText = `${payloadHeader}\n\n${promptText}\n\n## REVIEW PACKET\n\n${blindPacketBytes.toString('utf8')}`
  const payloadSha256 = sha256(copyReadyText)

  return {
    copyReadyText,
    payloadSha256,
  }
}

/**
 * Command 1: Prepare manual review payload.
 */
export function prepareManualPayload({
  candidateId,
  reviewer,
  executionRoot,
  eligiblePool = null,
  reviewOrder = null,
  repoRoot = defaultRepoRoot,
  p2Dir = defaultP2Dir,
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }
  if (!executionRoot) {
    throw new Error('INVALID_ARGUMENT: executionRoot is required')
  }

  // 1. Load review order and eligible pool if not passed
  const orderData = reviewOrder || JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
  const poolData = eligiblePool || JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-eligible-pool.v1.json'), 'utf8'))

  const orderedCandidates = orderData.orderedCandidates || orderData.order || []
  const orderEntry = orderedCandidates.find((c) => c.candidateId === candidateId)
  if (!orderEntry) {
    throw new Error(`CANDIDATE_NOT_FOUND: Candidate '${candidateId}' not found in review order`)
  }

  // 2. Derive the ONE currently allowable candidate from authoritative persisted review/session state + review order
  const orderList = orderedCandidates
  const candidateStates = {}
  let completedCount = 0
  let cleanCount = 0
  let defectPositiveCount = 0
  let severeCount = 0
  let nextSeqIndex = 1
  let nextArrIndex = 0

  for (let i = 0; i < orderList.length; i++) {
    const entry = orderList[i]
    const cId = entry.candidateId
    const seqIndex = entry.reviewSequenceIndex || (i + 1)
    const candidateDir = path.join(executionRoot, cId)

    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')
    const bundlePath = path.join(candidateDir, 'human-review-bundle.v1.json')
    const geminiPath = path.join(candidateDir, 'gemini/advisory-envelope.v1.json')
    const claudePath = path.join(candidateDir, 'claude/advisory-envelope.v1.json')
    const packetPath = path.join(candidateDir, 'blind-packet.v1.json')

    if (fs.existsSync(humanRecordPath)) {
      const chain = verifyCandidateReviewEvidenceChain({
        candidateId: cId,
        candidateDir,
        bindings: {
          geminiModel: 'MANUAL_CONSUMER_UI',
          claudeModel: 'MANUAL_CONSUMER_UI',
        },
      })
      const humanRecord = chain.humanRecord
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'HUMAN_ADJUDICATED',
        finalDecision: humanRecord.finalDecision,
        finalSeverity: humanRecord.finalSeverity || null,
      }
      completedCount++
      if (humanRecord.finalDecision === 'APPROVE') {
        cleanCount++
      } else if (humanRecord.finalDecision === 'REVISE') {
        defectPositiveCount++
        if (humanRecord.finalSeverity === 'SEVERE') {
          severeCount++
        }
      }
      nextSeqIndex = seqIndex + 1
      nextArrIndex = i + 1
    } else if (fs.existsSync(bundlePath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'READY_FOR_HUMAN_ADJUDICATION',
      }
      break
    } else if (fs.existsSync(geminiPath) && fs.existsSync(claudePath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'READY_FOR_HUMAN_ADJUDICATION',
      }
      break
    } else if (fs.existsSync(geminiPath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'GEMINI_VALID',
      }
      break
    } else if (fs.existsSync(claudePath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'CLAUDE_VALID',
      }
      break
    } else if (fs.existsSync(packetPath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'PACKET_FROZEN',
      }
      break
    } else {
      break
    }
  }

  const ledger = {
    currentReviewSequenceIndex: nextSeqIndex,
    currentReviewArrayIndex: nextArrIndex,
    candidateStates,
    completedCount,
    cleanCount,
    defectPositiveCount,
    severeCount,
  }

  const selection = getNextReviewCandidate({ ledger, reviewOrder: orderData })
  if (selection.stoppingRuleSatisfied) {
    throw new Error('EXECUTION_BLOCKED: Stopping rule already satisfied for review session')
  }
  if (selection.exhaustedPool || !selection.candidate) {
    throw new Error('EXECUTION_BLOCKED: Review candidate pool exhausted')
  }
  const allowedCandidateId = selection.candidate.candidateId
  if (candidateId !== allowedCandidateId) {
    throw new Error(
      `OUT_OF_ORDER_EXECUTION: Candidate '${candidateId}' is not the currently allowable review candidate. ` +
      `Current sequential candidate is '${allowedCandidateId}' (sequence index ${selection.sequenceIndex}).`
    )
  }

  // Live pilot gate: candidate #1 execution authorization check on production root
  const defaultExecutionRoot = path.join(p2Dir, 'review-execution')
  if (path.resolve(executionRoot) === path.resolve(defaultExecutionRoot)) {
    const p23Protocol = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8'))
    const readinessPath = path.join(p2Dir, 'p2-4-manual-ingestion-readiness.v1.json')
    const readiness = fs.existsSync(readinessPath) ? JSON.parse(fs.readFileSync(readinessPath, 'utf8')) : null
    const authorized = p23Protocol.candidate1ExecutionAuthorized === true || (readiness && readiness.candidate1ExecutionAuthorized === true)
    if (!authorized) {
      throw new Error(`PILOT_NOT_AUTHORIZED: Candidate #1 execution is not authorized (candidate1ExecutionAuthorized: false)`)
    }
  }

  const reviewSequenceIndex = orderEntry.reviewSequenceIndex || selection.sequenceIndex

  // 3. Prepare or reuse blind packet
  const prep = prepareCandidateExecution({
    candidateId,
    eligiblePool: poolData,
    reviewOrder: orderData,
    executionRoot,
  })

  // 3. Load governed prompt and verify hashes
  const governedPrompt = loadGovernedReviewerPrompt(reviewer)
  verifyPromptAndPolicyHashes({
    reviewer,
    promptText: governedPrompt.promptText,
    registeredPromptSha256: governedPrompt.promptSha256,
  })

  // 4. Construct deterministic copy-ready payload
  const { copyReadyText, payloadSha256 } = buildManualSubmissionPayload({
    candidateId,
    reviewer,
    reviewSequenceIndex,
    blindPacketBytes: prep.packetBytes,
    blindPacketSha256: prep.blindPacketSha256,
    promptText: governedPrompt.promptText,
    promptSha256: governedPrompt.promptSha256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
  })

  // 5. Check attempts and prepare target directory
  const candidateDir = prep.candidateDir
  const reviewerLower = reviewer.toLowerCase()
  const attemptsDir = path.join(candidateDir, reviewerLower, 'attempts')
  if (!fs.existsSync(attemptsDir)) fs.mkdirSync(attemptsDir, { recursive: true })

  // Determine current or next attempt
  const existingAttempts = fs.readdirSync(attemptsDir)
    .filter((d) => /^attempt-\d+$/.test(d))
    .sort()

  let targetAttemptNum = 1
  if (existingAttempts.length > 0) {
    const latestAttemptName = existingAttempts[existingAttempts.length - 1]
    const latestAttemptDir = path.join(attemptsDir, latestAttemptName)
    const latestValPath = path.join(latestAttemptDir, 'validation-result.json')
    const latestEnvPath = path.join(latestAttemptDir, 'advisory-envelope.v1.json')

    if (fs.existsSync(latestEnvPath)) {
      // Valid attempt already completed
      targetAttemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
    } else if (fs.existsSync(latestValPath)) {
      const val = JSON.parse(fs.readFileSync(latestValPath, 'utf8'))
      if (val.category === 'MALFORMED_JSON' || val.category === 'SCHEMA_INVALID') {
        const curNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
        if (curNum >= 2) {
          throw new Error(`RETRY_CEILING_EXCEEDED: Reviewer ${reviewer} has reached the maximum of 2 model-generated attempts for candidate ${candidateId}`)
        }
        targetAttemptNum = curNum + 1
      } else if (val.category === 'BINDING_INVALID') {
        throw new Error(`BINDING_INVALID_HARD_STOP: Reviewer ${reviewer} encountered BINDING_INVALID on attempt ${latestAttemptName}. Manual retries strictly forbidden.`)
      } else {
        targetAttemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
      }
    } else {
      targetAttemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
    }
  }

  const attemptName = `attempt-${String(targetAttemptNum).padStart(2, '0')}`
  const manualAttemptDir = path.join(candidateDir, 'manual', reviewerLower, attemptName)
  if (!fs.existsSync(manualAttemptDir)) fs.mkdirSync(manualAttemptDir, { recursive: true })

  const payloadFilePath = path.join(manualAttemptDir, 'submission-payload.v1.txt')
  const metaFilePath = path.join(manualAttemptDir, 'payload-metadata.json')

  const metadata = {
    candidateId,
    reviewer,
    reviewSequenceIndex,
    attemptNumber: targetAttemptNum,
    blindPacketSha256: prep.blindPacketSha256,
    reviewerPromptSha256: governedPrompt.promptSha256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    payloadSha256,
    createdAt: new Date().toISOString(),
  }

  // Atomic write without silent overwrite
  const writeRes = atomicWriteText(payloadFilePath, copyReadyText, { overwrite: false })
  atomicWriteJson(metaFilePath, metadata, { overwrite: true })

  return {
    candidateId,
    reviewer,
    reviewSequenceIndex,
    attemptNumber: targetAttemptNum,
    payloadFilePath,
    payloadSha256,
    copyReadyText,
    reused: writeRes.reused,
  }
}

/**
 * Command 2: Ingest raw manual response file.
 */
export function ingestManualResponse({
  candidateId,
  reviewer,
  responseFilePath,
  visibleModelLabel = null,
  isCorrection = false,
  correctionReason = null,
  executionRoot,
  eligiblePool = null,
  reviewOrder = null,
  repoRoot = defaultRepoRoot,
  p2Dir = defaultP2Dir,
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }
  if (!responseFilePath || !fs.existsSync(responseFilePath)) {
    throw new Error(`FILE_NOT_FOUND: Response file missing at ${responseFilePath}`)
  }
  if (!executionRoot) {
    throw new Error('INVALID_ARGUMENT: executionRoot is required')
  }

  const reviewerLower = reviewer.toLowerCase()
  const candidateDir = path.join(executionRoot, candidateId)
  if (!fs.existsSync(candidateDir)) {
    throw new Error(`CANDIDATE_DIR_MISSING: Candidate directory missing at ${candidateDir}. Run 'prepare' first.`)
  }

  const packetPath = path.join(candidateDir, 'blind-packet.v1.json')
  if (!fs.existsSync(packetPath)) {
    throw new Error(`PACKET_MISSING: Blind packet missing at ${packetPath}. Run 'prepare' first.`)
  }
  const blindPacketBytes = fs.readFileSync(packetPath)
  const blindPacketSha256 = sha256(blindPacketBytes)

  const governedPrompt = loadGovernedReviewerPrompt(reviewer)
  const reviewerPromptSha256 = governedPrompt.promptSha256
  const reviewPromptSha256 = reviewerPromptSha256
  const materialityPolicySha256 = FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256

  // 1. Read EXACT raw response bytes BEFORE any parsing
  const rawBytes = fs.readFileSync(responseFilePath)
  const rawResponseText = rawBytes.toString('utf8')
  const rawResponseSha256 = sha256(rawBytes)

  // 2. Identify attempt directory
  const attemptsDir = path.join(candidateDir, reviewerLower, 'attempts')
  if (!fs.existsSync(attemptsDir)) fs.mkdirSync(attemptsDir, { recursive: true })

  const existingAttempts = fs.readdirSync(attemptsDir)
    .filter((d) => /^attempt-\d+$/.test(d))
    .sort()

  let attemptNum = 1
  let targetAttemptDir = null

  if (isCorrection) {
    if (!correctionReason || typeof correctionReason !== 'string' || !correctionReason.trim()) {
      throw new Error('INVALID_ARGUMENT: correctionReason is strictly required for copy/ingest correction')
    }
    if (existingAttempts.length === 0) {
      throw new Error(`CORRECTION_INVALID: Cannot correct attempt when zero attempts exist for ${reviewer}`)
    }
    const latestAttemptName = existingAttempts[existingAttempts.length - 1]
    targetAttemptDir = path.join(attemptsDir, latestAttemptName)
    attemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
  } else {
    if (existingAttempts.length > 0) {
      const latestAttemptName = existingAttempts[existingAttempts.length - 1]
      const latestAttemptDir = path.join(attemptsDir, latestAttemptName)
      const latestValPath = path.join(latestAttemptDir, 'validation-result.json')
      const latestEnvPath = path.join(latestAttemptDir, 'advisory-envelope.v1.json')

      if (fs.existsSync(latestEnvPath)) {
        throw new Error(`ATTEMPT_ALREADY_VALID: Reviewer ${reviewer} already has a VALID active advisory in ${latestAttemptName}`)
      }

      if (fs.existsSync(latestValPath)) {
        const val = JSON.parse(fs.readFileSync(latestValPath, 'utf8'))
        if (val.category === 'MALFORMED_JSON' || val.category === 'SCHEMA_INVALID') {
          const curNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
          if (curNum >= 2) {
            throw new Error(`RETRY_CEILING_EXCEEDED: Reviewer ${reviewer} has reached maximum 2 model-generated attempts for ${candidateId}`)
          }
          attemptNum = curNum + 1
        } else if (val.category === 'BINDING_INVALID') {
          throw new Error(`BINDING_INVALID_HARD_STOP: Reviewer ${reviewer} encountered BINDING_INVALID on attempt ${latestAttemptName}. Retries strictly forbidden.`)
        } else {
          attemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
        }
      } else {
        attemptNum = parseInt(latestAttemptName.replace('attempt-', ''), 10)
      }
    }
    const nextAttemptName = `attempt-${String(attemptNum).padStart(2, '0')}`
    targetAttemptDir = path.join(attemptsDir, nextAttemptName)
    if (!fs.existsSync(targetAttemptDir)) fs.mkdirSync(targetAttemptDir, { recursive: true })
  }

  // 3. Atomically persist EXACT raw bytes
  const canonicalRawPath = path.join(targetAttemptDir, 'raw-response.txt')
  const originalRawPath = path.join(targetAttemptDir, 'raw-response.original.txt')
  const manualAttemptDir = path.join(candidateDir, 'manual', reviewerLower, `attempt-${String(attemptNum).padStart(2, '0')}`)
  if (!fs.existsSync(manualAttemptDir)) fs.mkdirSync(manualAttemptDir, { recursive: true })

  const originalIngestPath = path.join(manualAttemptDir, 'ingestion-record.v1.json')
  const archivedOriginalIngestPath = path.join(manualAttemptDir, 'ingestion-record.original.json')

  let priorRawSha256 = null
  let priorIngestRecord = null

  if (isCorrection) {
    if (!fs.existsSync(canonicalRawPath)) {
      throw new Error(`CORRECTION_INVALID: Canonical raw response missing at ${canonicalRawPath}`)
    }
    const priorRawBytes = fs.readFileSync(canonicalRawPath)
    priorRawSha256 = sha256(priorRawBytes)

    if (fs.existsSync(originalIngestPath)) {
      priorIngestRecord = JSON.parse(fs.readFileSync(originalIngestPath, 'utf8'))
      // 1. Verify current raw bytes/hash match original ingestion record
      if (priorIngestRecord.rawResponseSha256 !== priorRawSha256) {
        throw new Error(`INTEGRITY_FAILURE: Prior raw response SHA ${priorRawSha256} does not match ingestion record ${priorIngestRecord.rawResponseSha256}`)
      }
    }

    // 2. Persist immutable copy/archive of original exact raw bytes using no-clobber behavior
    if (!fs.existsSync(originalRawPath)) {
      atomicWriteText(originalRawPath, priorRawBytes.toString('utf8'), { overwrite: false })
    }
    const archivedRawSha = sha256(fs.readFileSync(originalRawPath))
    if (archivedRawSha !== priorRawSha256) {
      throw new Error('INTEGRITY_FAILURE: Archived original raw bytes do not match expected pre-correction hash')
    }

    // Archive original ingestion record if not already archived
    if (priorIngestRecord && !fs.existsSync(archivedOriginalIngestPath)) {
      atomicWriteJson(archivedOriginalIngestPath, priorIngestRecord, { overwrite: false })
    }

    // 4. Atomically install corrected canonical raw bytes
    atomicWriteText(canonicalRawPath, rawResponseText, { overwrite: true })
  } else {
    atomicWriteText(canonicalRawPath, rawResponseText, { overwrite: false })
  }

  // Operational metadata
  const modelLabel = (typeof visibleModelLabel === 'string' && visibleModelLabel.trim()) ? visibleModelLabel.trim() : null
  const modelIdentityStatus = modelLabel ? 'EXPOSED' : 'UNKNOWN_NOT_EXPOSED'
  const ingestionTimestamp = new Date().toISOString()

  const rawRecord = {
    candidateId,
    reviewer,
    channel: 'MANUAL_CONSUMER_UI',
    service: reviewer === 'GEMINI' ? 'Gemini' : 'Claude',
    reviewerModel: 'MANUAL_CONSUMER_UI',
    visibleModelLabel: modelLabel,
    modelIdentityStatus,
    submissionTimestamp: (isCorrection && priorIngestRecord?.submissionTimestamp) ? priorIngestRecord.submissionTimestamp : ingestionTimestamp,
    ingestionTimestamp,
    blindPacketSha256,
    reviewPromptSha256,
    materialityPolicySha256,
    rawResponse: rawResponseText,
    rawResponseSha256,
    attemptOrdinal: attemptNum,
    isCorrection,
    correctionReason: correctionReason ? correctionReason.trim() : null,
  }

  const metadataPath = path.join(targetAttemptDir, 'attempt-metadata.json')
  const valResultPath = path.join(targetAttemptDir, 'validation-result.json')

  // 4. Validate output
  let disposition = 'VALID'
  let validationErrors = []
  let builtEnvelope = null

  try {
    builtEnvelope = validateAndBuildAdvisoryEnvelope({
      rawResponseText,
      reviewer,
      reviewerModel: 'MANUAL_CONSUMER_UI',
      candidateId,
      blindPacketSha256,
      reviewPromptSha256,
      materialityPolicySha256,
    })
  } catch (err) {
    if (err.code === 'MALFORMED_ADVISORY_JSON') {
      disposition = 'MALFORMED_JSON'
      validationErrors = [err.message]
    } else if (err.code === 'SCHEMA_INVALID_ADVISORY_OPINION' || err.message.startsWith('SCHEMA_INVALID_')) {
      disposition = 'SCHEMA_INVALID'
      validationErrors = err.validationErrors || [err.message]
    } else if (err.message.includes('PROMPT_AUTHORITY_VIOLATION') || err.message.includes('POLICY_AUTHORITY_VIOLATION')) {
      disposition = 'BINDING_INVALID'
      validationErrors = [err.message]
    } else {
      disposition = 'SCHEMA_INVALID'
      validationErrors = [err.message]
    }
  }

  rawRecord.validation = {
    disposition,
    errors: validationErrors,
  }

  if (isCorrection) {
    const corrTimestamp = Date.now()
    const corrRecordPath = path.join(manualAttemptDir, `ingestion-record.correction-${corrTimestamp}.json`)
    const correctionRecord = {
      metadataVersion: 'v1',
      recordType: 'COPY_OR_INGEST_CORRECTION',
      timestamp: ingestionTimestamp,
      candidateId,
      reviewer,
      attemptOrdinal: attemptNum,
      newModelGenerationOccurred: false,
      reason: correctionReason.trim(),
      originalRawResponseSha256: priorRawSha256,
      correctedRawResponseSha256: rawResponseSha256,
      originalIngestionRecordSha256: priorIngestRecord ? sha256(serializeArtifactForPersistence(priorIngestRecord)) : null,
      archivedOriginalRawPath: path.relative(candidateDir, originalRawPath),
      correctedCanonicalRawPath: path.relative(candidateDir, canonicalRawPath),
      disposition,
      validationErrors,
    }
    atomicWriteJson(corrRecordPath, correctionRecord, { overwrite: false })

    rawRecord.originalRawResponseSha256 = priorRawSha256
    rawRecord.archivedOriginalRawPath = path.relative(candidateDir, originalRawPath)
    rawRecord.correctedCanonicalRawPath = path.relative(candidateDir, canonicalRawPath)
    rawRecord.newModelGenerationOccurred = false
  }

  atomicWriteJson(originalIngestPath, rawRecord, { overwrite: true })
  atomicWriteJson(metadataPath, {
    attemptNumber: attemptNum,
    timestamp: ingestionTimestamp,
    reviewer,
    reviewerModel: 'MANUAL_CONSUMER_UI',
    visibleModelLabel: modelLabel,
    modelIdentityStatus,
    promptSha256: reviewerPromptSha256,
    policySha256: materialityPolicySha256,
    packetSha256: blindPacketSha256,
    rawResponseSha256,
    status: disposition,
    isCorrection,
    correctionReason: correctionReason ? correctionReason.trim() : null,
    ...(isCorrection ? { originalRawResponseSha256: priorRawSha256, newModelGenerationOccurred: false } : {}),
  }, { overwrite: true })

  atomicWriteJson(valResultPath, {
    valid: disposition === 'VALID',
    category: disposition,
    errors: validationErrors,
  }, { overwrite: true })

  if (disposition === 'VALID') {
    const envPath = path.join(targetAttemptDir, 'advisory-envelope.v1.json')
    atomicWriteJson(envPath, builtEnvelope.envelope, { overwrite: true })

    const activeEnvPath = path.join(candidateDir, reviewerLower, 'active-advisory-envelope.v1.json')
    atomicWriteJson(activeEnvPath, builtEnvelope.envelope, { overwrite: true })

    const legacyEnvPath = path.join(candidateDir, reviewerLower, 'advisory-envelope.v1.json')
    atomicWriteJson(legacyEnvPath, builtEnvelope.envelope, { overwrite: true })

    return {
      success: true,
      disposition: 'VALID',
      candidateId,
      reviewer,
      attemptNumber: attemptNum,
      rawResponseSha256,
      envelopeSha256: builtEnvelope.envelopeSha256,
      envelope: builtEnvelope.envelope,
    }
  }

  return {
    success: false,
    disposition,
    candidateId,
    reviewer,
    attemptNumber: attemptNum,
    rawResponseSha256,
    errors: validationErrors,
  }
}

/**
 * Command 3: Status command.
 * Reconstructs state exclusively from disk evidence.
 */
export function getManualCandidateStatus({
  candidateId,
  executionRoot,
  p2Dir = defaultP2Dir,
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (!executionRoot) {
    throw new Error('INVALID_ARGUMENT: executionRoot is required')
  }

  const candidateDir = path.join(executionRoot, candidateId)
  if (!fs.existsSync(candidateDir)) {
    return {
      candidateId,
      exists: false,
      gemini: { status: 'NOT_PREPARED' },
      claude: { status: 'NOT_PREPARED' },
      humanBundle: 'BLOCKED_PENDING_ADVISORIES',
    }
  }

  function getReviewerStatus(reviewer) {
    const reviewerLower = reviewer.toLowerCase()
    const reviewerDir = path.join(candidateDir, reviewerLower)
    const attemptsDir = path.join(reviewerDir, 'attempts')
    const manualDir = path.join(candidateDir, 'manual', reviewerLower)

    const activeEnvPath = path.join(reviewerDir, 'active-advisory-envelope.v1.json')
    const legacyEnvPath = path.join(reviewerDir, 'advisory-envelope.v1.json')

    if (fs.existsSync(activeEnvPath) || fs.existsSync(legacyEnvPath)) {
      return { status: 'VALID', activeEnvelopePresent: true }
    }

    if (!fs.existsSync(manualDir) && !fs.existsSync(attemptsDir)) {
      return { status: 'NOT_PREPARED' }
    }

    // Check attempts in attemptsDir
    if (fs.existsSync(attemptsDir)) {
      const attempts = fs.readdirSync(attemptsDir)
        .filter((d) => /^attempt-\d+$/.test(d))
        .sort()

      if (attempts.length > 0) {
        const latest = attempts[attempts.length - 1]
        const latestDir = path.join(attemptsDir, latest)
        const valPath = path.join(latestDir, 'validation-result.json')
        const rawPath = path.join(latestDir, 'raw-response.txt')

        if (fs.existsSync(valPath)) {
          const val = JSON.parse(fs.readFileSync(valPath, 'utf8'))
          if (val.category === 'VALID') return { status: 'VALID' }
          if (val.category === 'MALFORMED_JSON' || val.category === 'SCHEMA_INVALID') {
            const num = parseInt(latest.replace('attempt-', ''), 10)
            if (num < 2) {
              return { status: 'INVALID_RETRY_AVAILABLE', attempt: num, category: val.category }
            } else {
              return { status: 'PAUSED', attempt: num, category: val.category, reason: 'RETRY_CEILING_REACHED' }
            }
          }
          if (val.category === 'BINDING_INVALID') {
            return { status: 'PAUSED', attempt: latest, category: 'BINDING_INVALID', reason: 'HARD_STOP' }
          }
        }

        if (fs.existsSync(rawPath)) {
          return { status: 'AWAITING_INGESTION', attempt: latest }
        }
      }
    }

    // Check manual preparation
    if (fs.existsSync(manualDir)) {
      const manAttempts = fs.readdirSync(manualDir)
        .filter((d) => /^attempt-\d+$/.test(d))
        .sort()
      if (manAttempts.length > 0) {
        const latestMan = manAttempts[manAttempts.length - 1]
        const payloadPath = path.join(manualDir, latestMan, 'submission-payload.v1.txt')
        if (fs.existsSync(payloadPath)) {
          return { status: 'AWAITING_MANUAL_SUBMISSION', attempt: latestMan }
        }
      }
    }

    return { status: 'NOT_PREPARED' }
  }

  const geminiStatus = getReviewerStatus('GEMINI')
  const claudeStatus = getReviewerStatus('CLAUDE')

  let humanBundleStatus = 'BLOCKED_PENDING_ADVISORIES'
  if (geminiStatus.status === 'VALID' && claudeStatus.status === 'VALID') {
    const bundlePath = path.join(candidateDir, 'human-review-bundle.v1.json')
    humanBundleStatus = fs.existsSync(bundlePath) ? 'BUNDLE_BUILT' : 'READY_FOR_HUMAN_BUNDLE'
  }

  return {
    candidateId,
    exists: true,
    gemini: geminiStatus,
    claude: claudeStatus,
    humanBundle: humanBundleStatus,
  }
}

/**
 * Command 4: Build human review bundle.
 */
export function buildManualHumanBundle({
  candidateId,
  executionRoot,
  repoRoot = defaultRepoRoot,
  p2Dir = defaultP2Dir,
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (!executionRoot) {
    throw new Error('INVALID_ARGUMENT: executionRoot is required')
  }

  const candidateDir = path.join(executionRoot, candidateId)
  if (!fs.existsSync(candidateDir)) {
    throw new Error(`CANDIDATE_DIR_MISSING: Candidate directory missing at ${candidateDir}`)
  }

  const packetPath = path.join(candidateDir, 'blind-packet.v1.json')
  if (!fs.existsSync(packetPath)) {
    throw new Error(`PACKET_MISSING: Blind packet missing at ${packetPath}`)
  }
  const diskPacketRaw = fs.readFileSync(packetPath, 'utf8')
  const projectedPacket = JSON.parse(diskPacketRaw)
  const blindPacketSha256 = sha256(Buffer.from(diskPacketRaw, 'utf8'))

  // Gemini active envelope
  const geminiEnvPath = fs.existsSync(path.join(candidateDir, 'gemini/active-advisory-envelope.v1.json'))
    ? path.join(candidateDir, 'gemini/active-advisory-envelope.v1.json')
    : path.join(candidateDir, 'gemini/advisory-envelope.v1.json')

  if (!fs.existsSync(geminiEnvPath)) {
    throw new Error(`MISSING_ADVISORY: Gemini valid advisory envelope missing for candidate ${candidateId}`)
  }
  const geminiEnvelope = JSON.parse(fs.readFileSync(geminiEnvPath, 'utf8'))
  const geminiEnvelopeSha256 = sha256(serializeArtifactForPersistence(geminiEnvelope))

  // Claude active envelope
  const claudeEnvPath = fs.existsSync(path.join(candidateDir, 'claude/active-advisory-envelope.v1.json'))
    ? path.join(candidateDir, 'claude/active-advisory-envelope.v1.json')
    : path.join(candidateDir, 'claude/advisory-envelope.v1.json')

  if (!fs.existsSync(claudeEnvPath)) {
    throw new Error(`MISSING_ADVISORY: Claude valid advisory envelope missing for candidate ${candidateId}`)
  }
  const claudeEnvelope = JSON.parse(fs.readFileSync(claudeEnvPath, 'utf8'))
  const claudeEnvelopeSha256 = sha256(serializeArtifactForPersistence(claudeEnvelope))

  // Validate evidence chain before creating or reusing bundle
  verifyCandidateReviewEvidenceChain({
    candidateId,
    candidateDir,
    bindings: {
      geminiModel: 'MANUAL_CONSUMER_UI',
      claudeModel: 'MANUAL_CONSUMER_UI',
    },
  })

  // Construct bundle
  const bundleResult = createHumanReviewBundle({
    candidateId,
    candidateDir,
    projectedPacket,
    blindPacketSha256,
    geminiEnvelope,
    geminiEnvelopeSha256,
    claudeEnvelope,
    claudeEnvelopeSha256,
  })

  // Re-verify full evidence chain
  verifyCandidateReviewEvidenceChain({
    candidateId,
    candidateDir,
    bindings: {
      geminiModel: 'MANUAL_CONSUMER_UI',
      claudeModel: 'MANUAL_CONSUMER_UI',
    },
  })

  return bundleResult
}

/**
 * CLI Main Dispatcher
 */
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args

  if (!command || command === '--help' || command === '-h') {
    console.log(`Movie Mood V8.2 — Verifier v1.4 Manual Preliminary Advisory Review Operator Tool

Commands:
  prepare <candidateId> <GEMINI|CLAUDE> [--execution-root <path>]
  ingest  <candidateId> <GEMINI|CLAUDE> <responseFile> [--visible-model-label <label>] [--correction-for-ingest-error] [--correction-reason <reason>] [--execution-root <path>]
  status  <candidateId> [--execution-root <path>]
  bundle  <candidateId> [--execution-root <path>]
`)
    return
  }

  function getArg(flag) {
    const idx = rest.indexOf(flag)
    if (idx !== -1 && rest[idx + 1]) {
      return rest[idx + 1]
    }
    return null
  }

  const executionRoot = getArg('--execution-root') || path.join(defaultP2Dir, 'review-execution')

  // Security check: reject any attempt to pass CLI review order bypass flags
  if (rest.includes('--review-order') || rest.includes('--eligible-pool') || rest.includes('--bypass-order')) {
    throw new Error('SECURITY_VIOLATION: Production CLI does not permit custom review order injection')
  }

  if (command === 'prepare') {
    const candidateId = rest[0]
    const reviewer = rest[1]?.toUpperCase()
    if (!candidateId || !reviewer) {
      console.error('Usage: prepare <candidateId> <GEMINI|CLAUDE>')
      process.exit(1)
    }
    const res = prepareManualPayload({ candidateId, reviewer, executionRoot })
    console.log(`PREPARED: ${res.reviewer} attempt ${res.attemptNumber} for ${res.candidateId}`)
    console.log(`Payload File: ${res.payloadFilePath}`)
    console.log(`Payload SHA-256: ${res.payloadSha256}`)
    return
  }

  if (command === 'ingest') {
    const candidateId = rest[0]
    const reviewer = rest[1]?.toUpperCase()
    const responseFilePath = rest[2]
    const visibleModelLabel = getArg('--visible-model-label')
    const isCorrection = rest.includes('--correction-for-ingest-error')
    const correctionReason = getArg('--correction-reason')

    if (!candidateId || !reviewer || !responseFilePath) {
      console.error('Usage: ingest <candidateId> <GEMINI|CLAUDE> <responseFile>')
      process.exit(1)
    }

    const res = ingestManualResponse({
      candidateId,
      reviewer,
      responseFilePath,
      visibleModelLabel,
      isCorrection,
      correctionReason,
      executionRoot,
    })

    console.log(`INGESTION DISPOSITION: ${res.disposition}`)
    console.log(`Candidate: ${res.candidateId} | Reviewer: ${res.reviewer} | Attempt: ${res.attemptNumber}`)
    console.log(`Raw Response SHA-256: ${res.rawResponseSha256}`)
    if (res.success) {
      console.log(`Advisory Envelope SHA-256: ${res.envelopeSha256}`)
    } else {
      console.error(`Errors: ${res.errors.join('; ')}`)
      process.exit(2)
    }
    return
  }

  if (command === 'status') {
    const candidateId = rest[0]
    if (!candidateId) {
      console.error('Usage: status <candidateId>')
      process.exit(1)
    }
    const res = getManualCandidateStatus({ candidateId, executionRoot })
    console.log(JSON.stringify(res, null, 2))
    return
  }

  if (command === 'bundle') {
    const candidateId = rest[0]
    if (!candidateId) {
      console.error('Usage: bundle <candidateId>')
      process.exit(1)
    }
    const res = buildManualHumanBundle({ candidateId, executionRoot })
    console.log(`BUNDLE BUILT: ${res.bundlePath}`)
    console.log(`Bundle SHA-256: ${res.bundleSha256}`)
    return
  }

  console.error(`Unknown command: ${command}`)
  process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`FATAL_ERROR: ${err.message}`)
    process.exit(1)
  })
}
