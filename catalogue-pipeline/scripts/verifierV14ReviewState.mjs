import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateJsonSchema } from './jsonSchemaValidator.mjs'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { verifyCandidateReviewEvidenceChain } from './runVerifierV14BlindReview.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')
const ledgerSchemaPath = path.join(p2Dir, 'review-session-ledger.schema.v1.json')

export const CANDIDATE_STATES = Object.freeze([
  'PENDING',
  'PACKET_FROZEN',
  'GEMINI_PENDING',
  'GEMINI_VALID',
  'GEMINI_INVALID',
  'CLAUDE_PENDING',
  'CLAUDE_VALID',
  'CLAUDE_INVALID',
  'REVIEW_PAUSED_PENDING_ADVISORY',
  'READY_FOR_HUMAN_ADJUDICATION',
  'HUMAN_ADJUDICATION_PENDING',
  'HUMAN_ADJUDICATED',
  'QA_PENDING',
  'COMPLETE',
])

export const CANDIDATE_STATE_SET = Object.freeze(new Set(CANDIDATE_STATES))

export const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: new Set(['PACKET_FROZEN']),
  PACKET_FROZEN: new Set(['GEMINI_PENDING', 'CLAUDE_PENDING', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  GEMINI_PENDING: new Set(['GEMINI_VALID', 'GEMINI_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  GEMINI_INVALID: new Set(['GEMINI_PENDING', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  GEMINI_VALID: new Set(['CLAUDE_PENDING', 'READY_FOR_HUMAN_ADJUDICATION', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  CLAUDE_PENDING: new Set(['CLAUDE_VALID', 'CLAUDE_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  CLAUDE_INVALID: new Set(['CLAUDE_PENDING', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  CLAUDE_VALID: new Set(['GEMINI_PENDING', 'READY_FOR_HUMAN_ADJUDICATION', 'REVIEW_PAUSED_PENDING_ADVISORY']),
  REVIEW_PAUSED_PENDING_ADVISORY: new Set([
    'PACKET_FROZEN',
    'GEMINI_PENDING',
    'CLAUDE_PENDING',
    'READY_FOR_HUMAN_ADJUDICATION',
  ]),
  READY_FOR_HUMAN_ADJUDICATION: new Set(['HUMAN_ADJUDICATION_PENDING', 'HUMAN_ADJUDICATED']),
  HUMAN_ADJUDICATION_PENDING: new Set(['HUMAN_ADJUDICATED', 'READY_FOR_HUMAN_ADJUDICATION']),
  HUMAN_ADJUDICATED: new Set(['QA_PENDING', 'COMPLETE']),
  QA_PENDING: new Set(['COMPLETE']),
  COMPLETE: new Set([]),
})

export function assertValidTransition(fromState, toState) {
  if (!CANDIDATE_STATE_SET.has(fromState)) {
    throw new Error(`INVALID_STATE: Unknown fromState '${fromState}'`)
  }
  if (!CANDIDATE_STATE_SET.has(toState)) {
    throw new Error(`INVALID_STATE: Unknown toState '${toState}'`)
  }
  if (fromState === toState) return
  const allowed = ALLOWED_TRANSITIONS[fromState]
  if (!allowed || !allowed.has(toState)) {
    throw new Error(`INVALID_STATE_TRANSITION: Transition from '${fromState}' to '${toState}' is not allowed`)
  }
}

export const STOPPING_TARGETS = Object.freeze({
  TARGET_CLEAN: 30,
  TARGET_DEFECT_POSITIVE: 30,
  MIN_SEVERE_DEFECT_POSITIVE: 6,
  TOTAL_ELIGIBLE_POOL: 184,
})

export const AUTHORITATIVE_HUMAN_ADJUDICATOR = 'Sophia Zhao'

export function sha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

export function checkStoppingRule({ cleanCount = 0, defectPositiveCount = 0, severeCount = 0 } = {}) {
  const cleanSatisfied = cleanCount >= STOPPING_TARGETS.TARGET_CLEAN
  const defectSatisfied = defectPositiveCount >= STOPPING_TARGETS.TARGET_DEFECT_POSITIVE
  const severeSatisfied = severeCount >= STOPPING_TARGETS.MIN_SEVERE_DEFECT_POSITIVE
  const stoppingRuleSatisfied = cleanSatisfied && defectSatisfied && severeSatisfied

  return {
    stoppingRuleSatisfied,
    cleanSatisfied,
    defectSatisfied,
    severeSatisfied,
    cleanCount,
    defectPositiveCount,
    severeCount,
  }
}

/**
 * Derives the single canonical agreementPattern enum from model preliminary decisions and Sophia's decision.
 */
export function deriveAgreementPattern({ geminiDecision, claudeDecision, humanDecision }) {
  if (!['APPROVE', 'REVISE'].includes(geminiDecision)) {
    throw new Error(`INVALID_DECISION: Invalid Gemini decision '${geminiDecision}'`)
  }
  if (!['APPROVE', 'REVISE'].includes(claudeDecision)) {
    throw new Error(`INVALID_DECISION: Invalid Claude decision '${claudeDecision}'`)
  }
  if (!['APPROVE', 'REVISE'].includes(humanDecision)) {
    throw new Error(`INVALID_DECISION: Invalid Human decision '${humanDecision}'`)
  }

  const geminiAgrees = geminiDecision === humanDecision
  const claudeAgrees = claudeDecision === humanDecision

  if (geminiAgrees && claudeAgrees) {
    return 'BOTH_AI_AGREE_WITH_HUMAN'
  }
  if (!geminiAgrees && !claudeAgrees) {
    return 'BOTH_AI_DISAGREE_WITH_HUMAN'
  }
  if (geminiAgrees && !claudeAgrees) {
    return 'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI'
  }
  if (!geminiAgrees && claudeAgrees) {
    return 'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE'
  }

  return 'OTHER'
}

/**
 * Normalizes and validates claimed agreement pattern, rejecting inconsistencies and mapping historical aliases.
 */
export function normalizeAgreementPattern(claimedPattern, { geminiDecision, claudeDecision, humanDecision }) {
  const canonical = deriveAgreementPattern({ geminiDecision, claudeDecision, humanDecision })
  if (claimedPattern === canonical) {
    return canonical
  }
  // Normalize permitted schema aliases to canonical stored enum
  if (claimedPattern === 'GEMINI_ONLY_AGREES' && canonical === 'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI') {
    return canonical
  }
  if (claimedPattern === 'CLAUDE_ONLY_AGREES' && canonical === 'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE') {
    return canonical
  }

  throw new Error(
    `AGREEMENT_PATTERN_MISMATCH: Claimed '${claimedPattern}' is inconsistent with canonical '${canonical}'`
  )
}

/**
 * Validates that a claimed agreementPattern matches the derived pattern or a registered alias.
 */
export function validateAgreementPattern({ geminiDecision, claudeDecision, humanDecision, claimedPattern }) {
  try {
    normalizeAgreementPattern(claimedPattern, { geminiDecision, claudeDecision, humanDecision })
    return true
  } catch {
    return false
  }
}

/**
 * Atomic write helper for text/raw files using temporary file and atomic rename.
 */
export function atomicWriteText(targetPath, text, { overwrite = false } = {}) {
  const dir = path.dirname(targetPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const textBuf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8')
  const textSha = sha256(textBuf)

  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath)
    const existingSha = sha256(existing)
    if (existingSha === textSha) {
      return { bytes: existing, sha256: existingSha, reused: true }
    }
    if (!overwrite) {
      throw new Error(`INTEGRITY_CONFLICT: Existing file at ${targetPath} differs from new content`)
    }
  }

  const tempPath = path.join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tempPath, textBuf)
  fs.renameSync(tempPath, targetPath)
  return {
    bytes: textBuf,
    sha256: textSha,
    reused: false,
  }
}

/**
 * Atomic write helper using temporary file and atomic rename.
 */
export function atomicWriteJson(targetPath, data, { overwrite = false } = {}) {
  const dir = path.dirname(targetPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const serialized = serializeArtifactForPersistence(data)
  const serializedBuf = Buffer.from(serialized, 'utf8')
  const serializedSha = sha256(serializedBuf)

  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath)
    const existingSha = sha256(existing)
    if (existingSha === serializedSha) {
      return { bytes: existing, sha256: existingSha, reused: true }
    }
    if (!overwrite) {
      throw new Error(`INTEGRITY_CONFLICT: Existing artifact at ${targetPath} differs from new content`)
    }
  }

  const tempPath = path.join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tempPath, serialized, 'utf8')
  fs.renameSync(tempPath, targetPath)
  return {
    bytes: serializedBuf,
    sha256: serializedSha,
    reused: false,
  }
}

/**
 * Validates a review session ledger against its JSON schema.
 */
export function validateReviewSessionLedger(ledger) {
  const schema = JSON.parse(fs.readFileSync(ledgerSchemaPath, 'utf8'))
  const res = validateJsonSchema(ledger, schema)
  if (!res.valid) {
    throw new Error(`INVALID_SESSION_LEDGER_SCHEMA: ${res.errors.join('; ')}`)
  }
  return true
}

/**
 * Creates an initial review session ledger.
 */
export function createReviewSessionLedger({
  p21FreezeManifestSha256,
  reviewOrderSha256,
  totalEligiblePoolCount = STOPPING_TARGETS.TOTAL_ELIGIBLE_POOL,
  activity = 'VERIFIER_V14_BLIND_HUMAN_REVIEW_SESSION',
  classification = 'RETROSPECTIVE_SEMANTIC_DEVELOPMENT_REVIEW_INFRASTRUCTURE',
} = {}) {
  if (!p21FreezeManifestSha256 || !p21FreezeManifestSha256.startsWith('sha256:')) {
    throw new Error('INVALID_ARGUMENT: Valid p21FreezeManifestSha256 is required')
  }
  if (!reviewOrderSha256 || !reviewOrderSha256.startsWith('sha256:')) {
    throw new Error('INVALID_ARGUMENT: Valid reviewOrderSha256 is required')
  }

  const ledger = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'review-session-ledger.v1',
    activity,
    classification,
    p21FreezeManifestSha256,
    reviewOrderSha256,
    currentReviewSequenceIndex: 1, // 1-based sequence index
    currentReviewArrayIndex: 0, // 0-based array index
    totalEligiblePoolCount,
    completedCount: 0,
    cleanCount: 0,
    defectPositiveCount: 0,
    severeCount: 0,
    stoppingRuleSatisfied: false,
    exhaustedPool: false,
    candidateStates: {},
  }

  validateReviewSessionLedger(ledger)
  return ledger
}

/**
 * Loads a persisted review session ledger from disk and validates its integrity.
 */
export function loadReviewSessionLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`FILE_NOT_FOUND: Ledger file not found at ${ledgerPath}`)
  }
  const raw = fs.readFileSync(ledgerPath, 'utf8')
  const ledger = JSON.parse(raw)
  validateReviewSessionLedger(ledger)
  return ledger
}

/**
 * Persists review session ledger atomically to disk after validating schema.
 */
export function persistReviewSessionLedger(ledgerPath, ledger) {
  validateReviewSessionLedger(ledger)
  return atomicWriteJson(ledgerPath, ledger, { overwrite: true })
}

/**
 * Reconciles the review session ledger by scanning execution directories on disk.
 * Idempotently computes aggregates and reconstructs state transitions without duplicating progress.
 */
export function reconcileReviewSessionFromDisk({
  executionRoot,
  eligiblePool,
  reviewOrder,
  p21FreezeManifestSha256,
  reviewOrderSha256,
  ledgerPath = null,
  materialityPolicySha256 = null,
  bindings = {},
}) {
  if (materialityPolicySha256 !== null && materialityPolicySha256 !== 'sha256:21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c') {
    throw new Error('POLICY_AUTHORITY_VIOLATION: Caller cannot override frozen materiality policy SHA')
  }

  const orderList = reviewOrder.orderedCandidates || reviewOrder.order || []
  let ledger

  if (ledgerPath && fs.existsSync(ledgerPath)) {
    ledger = loadReviewSessionLedger(ledgerPath)
  } else {
    ledger = createReviewSessionLedger({
      p21FreezeManifestSha256,
      reviewOrderSha256,
      totalEligiblePoolCount: orderList.length,
    })
  }

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
      // Must verify full authoritative evidence chain before counting human record
      const chain = verifyCandidateReviewEvidenceChain({
        candidateId: cId,
        candidateDir,
        bindings: {
          geminiModel: bindings.geminiModel,
          claudeModel: bindings.claudeModel,
        },
      })
      const humanRecord = chain.humanRecord
      const humanSha = sha256(serializeArtifactForPersistence(humanRecord))

      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'HUMAN_ADJUDICATED',
        blindPacketSha256: humanRecord.blindPacketHash,
        geminiAdvisoryRecordSha256: humanRecord.geminiAdvisoryRecordSha256,
        claudeAdvisoryRecordSha256: humanRecord.claudeAdvisoryRecordSha256,
        humanAdjudicationSha256: humanSha,
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
      const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'READY_FOR_HUMAN_ADJUDICATION',
        blindPacketSha256: bundle.blindPacketSha256,
        geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
        claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
      }
      break
    } else if (fs.existsSync(geminiPath) && fs.existsSync(claudePath)) {
      const geminiEnv = JSON.parse(fs.readFileSync(geminiPath, 'utf8'))
      const claudeEnv = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'READY_FOR_HUMAN_ADJUDICATION',
        blindPacketSha256: geminiEnv.blindPacketSha256,
        geminiAdvisoryRecordSha256: sha256(serializeArtifactForPersistence(geminiEnv)),
        claudeAdvisoryRecordSha256: sha256(serializeArtifactForPersistence(claudeEnv)),
      }
      break
    } else if (fs.existsSync(geminiPath)) {
      const geminiEnv = JSON.parse(fs.readFileSync(geminiPath, 'utf8'))
      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'GEMINI_VALID',
        blindPacketSha256: geminiEnv.blindPacketSha256,
        geminiAdvisoryRecordSha256: sha256(serializeArtifactForPersistence(geminiEnv)),
      }
      break
    } else if (fs.existsSync(claudePath)) {
      const claudeEnv = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'CLAUDE_VALID',
        blindPacketSha256: claudeEnv.blindPacketSha256,
        claudeAdvisoryRecordSha256: sha256(serializeArtifactForPersistence(claudeEnv)),
      }
      break
    } else if (fs.existsSync(packetPath)) {
      const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'))
      ledger.candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'PACKET_FROZEN',
        blindPacketSha256: sha256(serializeArtifactForPersistence(packet)),
      }
      break
    } else {
      break
    }
  }

  ledger.completedCount = completedCount
  ledger.cleanCount = cleanCount
  ledger.defectPositiveCount = defectPositiveCount
  ledger.severeCount = severeCount
  ledger.currentReviewSequenceIndex = nextSeqIndex
  ledger.currentReviewArrayIndex = nextArrIndex

  const stopping = checkStoppingRule(ledger)
  ledger.stoppingRuleSatisfied = stopping.stoppingRuleSatisfied
  ledger.exhaustedPool = completedCount >= orderList.length && !stopping.stoppingRuleSatisfied

  if (ledgerPath) {
    persistReviewSessionLedger(ledgerPath, ledger)
  }

  return ledger
}

/**
 * Deterministically retrieves the next review candidate from the frozen review order.
 */
export function getNextReviewCandidate({ ledger, reviewOrder } = {}) {
  if (!ledger || typeof ledger !== 'object') throw new Error('INVALID_ARGUMENT: ledger is required')
  const orderList = Array.isArray(reviewOrder?.orderedCandidates)
    ? reviewOrder.orderedCandidates
    : Array.isArray(reviewOrder?.order)
    ? reviewOrder.order
    : null
  if (!orderList) throw new Error('INVALID_ARGUMENT: reviewOrder must contain orderedCandidates or order array')

  const stopping = checkStoppingRule(ledger)
  if (stopping.stoppingRuleSatisfied) {
    return {
      candidate: null,
      sequenceIndex: ledger.currentReviewSequenceIndex,
      arrayIndex: ledger.currentReviewArrayIndex,
      stoppingRuleSatisfied: true,
      exhaustedPool: false,
      status: 'STOPPING_RULE_SATISFIED',
    }
  }

  for (let idx = 0; idx < orderList.length; idx++) {
    const entry = orderList[idx]
    const candidateId = entry.candidateId
    const seqIndex = entry.reviewSequenceIndex || (idx + 1)
    const state = ledger.candidateStates[candidateId]

    const isResolved = state && (state.status === 'HUMAN_ADJUDICATED' || state.status === 'COMPLETE')

    if (!isResolved) {
      if (state && state.status === 'REVIEW_PAUSED_PENDING_ADVISORY') {
        return {
          candidate: entry,
          sequenceIndex: seqIndex,
          arrayIndex: idx,
          stoppingRuleSatisfied: false,
          exhaustedPool: false,
          paused: true,
          status: 'REVIEW_PAUSED_PENDING_ADVISORY',
        }
      }

      const expectedArrayIndex = ledger.currentReviewArrayIndex !== undefined
        ? ledger.currentReviewArrayIndex
        : (ledger.currentReviewSequenceIndex - 1)

      if (idx !== expectedArrayIndex) {
        throw new Error(
          `OUT_OF_ORDER_SELECTION: Earliest unadjudicated candidate is array index ${idx} / sequence ${seqIndex} (${candidateId}), ` +
          `but ledger expects array index ${expectedArrayIndex} / sequence ${ledger.currentReviewSequenceIndex}`
        )
      }

      return {
        candidate: entry,
        sequenceIndex: seqIndex,
        arrayIndex: idx,
        stoppingRuleSatisfied: false,
        exhaustedPool: false,
        paused: false,
        status: state ? state.status : 'PENDING',
      }
    }
  }

  return {
    candidate: null,
    sequenceIndex: orderList.length + 1,
    arrayIndex: orderList.length,
    stoppingRuleSatisfied: false,
    exhaustedPool: true,
    status: 'VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT',
  }
}

/**
 * Updates the review session ledger with a validated authoritative human adjudication.
 */
export function updateLedgerWithHumanAdjudication({
  ledger,
  candidateId,
  reviewSequenceIndex,
  humanAdjudication,
  humanAdjudicationSha256,
  blindPacketSha256,
  geminiAdvisoryRecordSha256,
  claudeAdvisoryRecordSha256,
}) {
  if (humanAdjudication.adjudicator !== AUTHORITATIVE_HUMAN_ADJUDICATOR) {
    throw new Error(`UNAUTHORIZED_ADJUDICATOR: Adjudicator must be '${AUTHORITATIVE_HUMAN_ADJUDICATOR}', got '${humanAdjudication.adjudicator}'`)
  }
  if (humanAdjudication.candidateId !== candidateId) {
    throw new Error(`CANDIDATE_MISMATCH: Adjudication candidateId '${humanAdjudication.candidateId}' does not match expected '${candidateId}'`)
  }
  if (humanAdjudication.blindPacketHash !== blindPacketSha256) {
    throw new Error('BLIND_PACKET_HASH_MISMATCH: Adjudication blindPacketHash does not match canonical packet SHA')
  }
  if (humanAdjudication.geminiAdvisoryRecordSha256 !== geminiAdvisoryRecordSha256) {
    throw new Error('GEMINI_HASH_MISMATCH: geminiAdvisoryRecordSha256 does not match envelope SHA')
  }
  if (humanAdjudication.claudeAdvisoryRecordSha256 !== claudeAdvisoryRecordSha256) {
    throw new Error('CLAUDE_HASH_MISMATCH: claudeAdvisoryRecordSha256 does not match envelope SHA')
  }

  const existingState = ledger.candidateStates[candidateId]
  if (existingState && (existingState.status === 'HUMAN_ADJUDICATED' || existingState.status === 'COMPLETE')) {
    throw new Error(`DUPLICATE_ADJUDICATION: Candidate '${candidateId}' has already been adjudicated. Modification requires adjudication-correction-protocol.`)
  }

  const fromState = existingState ? existingState.status : 'READY_FOR_HUMAN_ADJUDICATION'
  assertValidTransition(fromState, 'HUMAN_ADJUDICATED')

  ledger.candidateStates[candidateId] = {
    candidateId,
    reviewSequenceIndex,
    status: 'HUMAN_ADJUDICATED',
    blindPacketSha256,
    geminiAdvisoryRecordSha256,
    claudeAdvisoryRecordSha256,
    humanAdjudicationSha256,
    finalDecision: humanAdjudication.finalDecision,
    finalSeverity: humanAdjudication.finalSeverity || null,
  }

  ledger.completedCount++
  if (humanAdjudication.finalDecision === 'APPROVE') {
    ledger.cleanCount++
  } else if (humanAdjudication.finalDecision === 'REVISE') {
    ledger.defectPositiveCount++
    if (humanAdjudication.finalSeverity === 'SEVERE') {
      ledger.severeCount++
    }
  }

  const stopping = checkStoppingRule(ledger)
  ledger.stoppingRuleSatisfied = stopping.stoppingRuleSatisfied
  ledger.currentReviewSequenceIndex = reviewSequenceIndex + 1
  ledger.currentReviewArrayIndex = reviewSequenceIndex

  validateReviewSessionLedger(ledger)
  return ledger
}
