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
  checkStoppingRule,
  STOPPING_TARGETS,
  AUTHORITATIVE_HUMAN_ADJUDICATOR,
  loadReviewSessionLedger,
  reconcileReviewSessionFromDisk,
  deriveAgreementPattern,
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
  recordHumanAdjudication,
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

export function validateCandidate1PilotAuthorization({ p2Dir = defaultP2Dir, authorizationPath } = {}) {
  const authFile = authorizationPath || path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json')
  if (!fs.existsSync(authFile)) {
    throw new Error(`PILOT_NOT_AUTHORIZED: Candidate #1 pilot authorization artifact is absent (${authFile})`)
  }

  let authData
  try {
    authData = JSON.parse(fs.readFileSync(authFile, 'utf8'))
  } catch (err) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: Failed to parse authorization JSON: ${err.message}`)
  }

  if (authData.activity !== 'VERIFIER_V14_CANDIDATE1_MANUAL_PILOT_AUTHORIZATION') {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: Invalid activity '${authData.activity}'`)
  }
  if (authData.candidateId !== 'exp100-tmdb-672647') {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: Candidate ID '${authData.candidateId}' does not match expected Candidate #1 'exp100-tmdb-672647'`)
  }
  if (authData.reviewSequenceIndex !== 1) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: reviewSequenceIndex '${authData.reviewSequenceIndex}' must equal 1`)
  }
  if (authData.authorized !== true) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: authorized must be true (got ${authData.authorized})`)
  }
  if (authData.automaticCandidate2Authorization !== false) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: automaticCandidate2Authorization must be false (got ${authData.automaticCandidate2Authorization})`)
  }

  const p23ManifestPath = path.join(p2Dir, 'p2-3-freeze-manifest.v1.json')
  if (!fs.existsSync(p23ManifestPath)) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: P2.3 freeze manifest not found at ${p23ManifestPath}`)
  }
  const actualP23Sha = sha256(fs.readFileSync(p23ManifestPath))
  const expectedP23Sha = 'sha256:b8eb3fde3203f6736a4d5b3a98f71fe50de70866b060614432f1b9a1757335d3'
  if (authData.p23FreezeManifestSha256 !== expectedP23Sha || actualP23Sha !== expectedP23Sha) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: P2.3 freeze manifest SHA mismatch`)
  }

  const expectedP24FreezeCommit = '9d73c3f2f25cf6c0a04b003f04186e2016084096'
  if (authData.p24FreezeCommit !== expectedP24FreezeCommit) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: p24FreezeCommit '${authData.p24FreezeCommit}' does not match '${expectedP24FreezeCommit}'`)
  }

  const expectedP24ImplSha = 'sha256:d43772907784ab2188745b49ac6f913278b9d3f8e028d8ab651f67d336d7a17f'
  if (authData.p24ImplementationSha256 !== expectedP24ImplSha) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: p24ImplementationSha256 mismatch`)
  }

  const expectedP24TestSha = 'sha256:34f0d298cb3b2cc1c16b187cbc209ee36b27d1c72fd826450f3d454b040248fa'
  if (authData.p24TestSha256 !== expectedP24TestSha) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: p24TestSha256 mismatch`)
  }

  const readinessPath = path.join(p2Dir, 'p2-4-manual-ingestion-readiness.v1.json')
  if (!fs.existsSync(readinessPath)) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: P2.4 readiness artifact not found at ${readinessPath}`)
  }
  const actualReadinessSha = sha256(fs.readFileSync(readinessPath))
  const expectedReadinessSha = 'sha256:513838228cd9bc47e3f41788dd12f023ceef3be4222c00003a4543d9f2a9ea54'
  if (authData.p24ReadinessSha256 !== expectedReadinessSha || actualReadinessSha !== expectedReadinessSha) {
    throw new Error(`PILOT_AUTHORIZATION_INVALID: p24ReadinessSha256 mismatch`)
  }

  return authData
}

export function validatePostPilotSessionAuthorization({ p2Dir = defaultP2Dir, authorizationPath, executionRoot = null } = {}) {
  const authFile = authorizationPath || path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
  if (!fs.existsSync(authFile)) {
    throw new Error(`SESSION_NOT_AUTHORIZED: Post-pilot sequential review session authorization artifact is absent (${authFile})`)
  }

  let authData
  try {
    authData = JSON.parse(fs.readFileSync(authFile, 'utf8'))
  } catch (err) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Failed to parse session authorization JSON: ${err.message}`)
  }

  if (authData.activity !== 'VERIFIER_V14_POST_PILOT_SEQUENTIAL_REVIEW_SESSION_AUTHORIZATION') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Invalid activity '${authData.activity}'`)
  }
  if (authData.classification !== 'POST_FREEZE_OPERATIONAL_AUTHORIZATION_AMENDMENT') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Invalid classification '${authData.classification}'`)
  }
  if (authData.methodStatement !== 'NO_METHOD_CHANGE') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Invalid methodStatement '${authData.methodStatement}'`)
  }
  if (authData.sequentialSessionAuthorized !== true) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: sequentialSessionAuthorized must be true (got ${authData.sequentialSessionAuthorized})`)
  }
  if (authData.skippingPermitted !== false) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: skippingPermitted must be false (got ${authData.skippingPermitted})`)
  }
  if (authData.perCandidateAmendmentRequired !== false) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: perCandidateAmendmentRequired must be false (got ${authData.perCandidateAmendmentRequired})`)
  }

  // 1. Mandatory provenance bindings validation (fail-closed)
  const requiredProvenanceBindings = [
    { field: 'p23FreezeManifestSha256', expected: 'sha256:b8eb3fde3203f6736a4d5b3a98f71fe50de70866b060614432f1b9a1757335d3' },
    { field: 'originalP24FreezeCommit', expected: '9d73c3f2f25cf6c0a04b003f04186e2016084096' },
    { field: 'originalP24ImplementationSha256', expected: 'sha256:d43772907784ab2188745b49ac6f913278b9d3f8e028d8ab651f67d336d7a17f' },
    { field: 'originalP24TestSha256', expected: 'sha256:34f0d298cb3b2cc1c16b187cbc209ee36b27d1c72fd826450f3d454b040248fa' },
    { field: 'originalP24ReadinessSha256', expected: 'sha256:513838228cd9bc47e3f41788dd12f023ceef3be4222c00003a4543d9f2a9ea54' },
    { field: 'candidate1AuthorizationBridgeCommit', expected: '3f885ff3ea904eb8522ffa4c9ba48a729aba8752' },
    { field: 'candidate1EvidenceFreezeCommit', expected: '675e521334f582b70658312eb4496df64e4d189e' },
    { field: 'candidate1HumanAdjudicationSha256', expected: 'sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f' },
    { field: 'candidate1FrozenSessionLedgerSha256', expected: 'sha256:f1fc82b4acb316e6def5ea631de122a3d92151995c8941b790fac4c97b3004f6' },
    { field: 'frozenReviewOrderSha256', expected: 'sha256:758c9775e7e3171c68a50313c2720d4b8f696e6467f9801f12332391dc6213ed' },
    { field: 'frozenEligiblePoolSha256', expected: 'sha256:74c76d0b359125449173a4348e1dfdd737f886ddb2cb86d8af593a31aeab29b8' },
    { field: 'implementationIncidentSha256', expected: 'sha256:656a68da879a1462b0aa05d4d86501a0bf5f99df5cc2e61c030be9a6a5ee8d69' },
  ]

  for (const { field, expected } of requiredProvenanceBindings) {
    if (authData[field] === undefined || authData[field] === null) {
      throw new Error(`SESSION_AUTHORIZATION_INVALID: Mandatory provenance field '${field}' is missing`)
    }
    if (authData[field] !== expected) {
      throw new Error(`SESSION_AUTHORIZATION_INVALID: Provenance field '${field}' '${authData[field]}' does not match expected '${expected}'`)
    }
  }

  // 2. Mandatory bound disk files verification (fail-closed)
  const requiredBoundFiles = [
    { file: 'p2-3-freeze-manifest.v1.json', expectedSha: 'sha256:b8eb3fde3203f6736a4d5b3a98f71fe50de70866b060614432f1b9a1757335d3' },
    { file: 'p2-4-manual-ingestion-readiness.v1.json', expectedSha: 'sha256:513838228cd9bc47e3f41788dd12f023ceef3be4222c00003a4543d9f2a9ea54' },
    { file: 'blind-review-order.v1.json', expectedSha: 'sha256:758c9775e7e3171c68a50313c2720d4b8f696e6467f9801f12332391dc6213ed' },
    { file: 'blind-review-eligible-pool.v1.json', expectedSha: 'sha256:74c76d0b359125449173a4348e1dfdd737f886ddb2cb86d8af593a31aeab29b8' },
    { file: 'p2-4-post-pilot-implementation-incident.v1.json', expectedSha: 'sha256:656a68da879a1462b0aa05d4d86501a0bf5f99df5cc2e61c030be9a6a5ee8d69' },
  ]

  for (const { file, expectedSha } of requiredBoundFiles) {
    const filePath = path.join(p2Dir, file)
    if (!fs.existsSync(filePath)) {
      throw new Error(`SESSION_AUTHORIZATION_INVALID: Mandatory bound file '${file}' missing at ${filePath}`)
    }
    const actualSha = sha256(fs.readFileSync(filePath))
    if (actualSha !== expectedSha) {
      throw new Error(`SESSION_AUTHORIZATION_INVALID: Bound file '${file}' disk SHA mismatch (got '${actualSha}', expected '${expectedSha}')`)
    }
  }

  // 3. Frozen review order must map reviewSequenceIndex 1 to Candidate #1
  const reviewOrderPath = path.join(p2Dir, 'blind-review-order.v1.json')
  const reviewOrderData = JSON.parse(fs.readFileSync(reviewOrderPath, 'utf8'))
  const orderedCandidates = reviewOrderData.orderedCandidates || reviewOrderData.order || []
  const firstOrderEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === 1) || orderedCandidates[0]
  if (!firstOrderEntry || firstOrderEntry.candidateId !== 'exp100-tmdb-672647' || (firstOrderEntry.reviewSequenceIndex && firstOrderEntry.reviewSequenceIndex !== 1)) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Frozen review order does not map sequence index 1 to 'exp100-tmdb-672647'`)
  }

  // 4. CURRENT LIVE EVIDENCE VALIDATION: Re-establish actual Candidate #1 completion evidence against canonical disk bytes
  const targetExecutionRoot = executionRoot || path.join(p2Dir, 'review-execution')
  const c1Dir = path.join(targetExecutionRoot, 'exp100-tmdb-672647')
  const c1HumanRecordPath = path.join(c1Dir, 'human/adjudication-record.v1.json')

  if (!fs.existsSync(c1HumanRecordPath)) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Canonical Candidate #1 human adjudication record missing at ${c1HumanRecordPath}`)
  }

  const c1HumanBytes = fs.readFileSync(c1HumanRecordPath)
  const actualC1AdjSha = sha256(c1HumanBytes)
  if (actualC1AdjSha !== 'sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Canonical Candidate #1 human adjudication record SHA ${actualC1AdjSha} does not match expected sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f`)
  }

  // Verify complete cryptographic evidence chain for Candidate #1
  try {
    const chain = verifyCandidateReviewEvidenceChain({
      candidateId: 'exp100-tmdb-672647',
      candidateDir: c1Dir,
      bindings: {
        geminiModel: 'MANUAL_CONSUMER_UI',
        claudeModel: 'MANUAL_CONSUMER_UI',
      },
    })
    if (!chain.valid) {
      throw new Error('Evidence chain marked invalid')
    }
  } catch (err) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 evidence chain verification failed: ${err.message}`)
  }

  // Verify Candidate #1 human adjudication record decision and ID
  const c1Record = JSON.parse(c1HumanBytes.toString('utf8'))
  if (c1Record.finalDecision !== 'APPROVE') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 decision must be APPROVE, got ${c1Record.finalDecision}`)
  }
  if (c1Record.candidateId !== 'exp100-tmdb-672647') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 candidateId mismatch: ${c1Record.candidateId}`)
  }

  // 5. CURRENT LIVE SESSION STATE VALIDATION: Verify Candidate #1 within live session ledger
  const actualLedgerPath = path.join(targetExecutionRoot, 'review-session-ledger.json')
  let liveCandidate1State = null
  if (fs.existsSync(actualLedgerPath)) {
    try {
      const liveLedger = JSON.parse(fs.readFileSync(actualLedgerPath, 'utf8'))
      liveCandidate1State = liveLedger.candidateStates?.['exp100-tmdb-672647'] || null
    } catch (err) {
      throw new Error(`SESSION_AUTHORIZATION_INVALID: Failed to parse live session ledger: ${err.message}`)
    }
  } else {
    // If ledger file is not yet persisted on disk, state reconstructs from canonical disk directory
    liveCandidate1State = {
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: actualC1AdjSha,
    }
  }

  if (!liveCandidate1State) {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 ('exp100-tmdb-672647') missing from current session state`)
  }
  if (liveCandidate1State.status !== 'HUMAN_ADJUDICATED') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 status in current session state is not HUMAN_ADJUDICATED (got '${liveCandidate1State.status}')`)
  }
  if (!liveCandidate1State.humanAdjudicationSha256 || liveCandidate1State.humanAdjudicationSha256 !== 'sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f') {
    throw new Error(`SESSION_AUTHORIZATION_INVALID: Candidate #1 humanAdjudicationSha256 in current session state does not match expected (${liveCandidate1State.humanAdjudicationSha256})`)
  }

  return authData
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
  authorizationPath = null,
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
        if (humanRecord.finalSeverity === 'SEVERE' || humanRecord.finalSeverity === 'SEVERE_DEFECT') {
          severeCount++
        }
      }
      nextSeqIndex = seqIndex + 1
      nextArrIndex = i + 1
    } else if (fs.existsSync(bundlePath)) {
      candidateStates[cId] = {
        candidateId: cId,
        reviewSequenceIndex: seqIndex,
        status: 'HUMAN_BUNDLE_PREPARED',
      }
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

  const actualLedgerPath = path.join(executionRoot, 'review-session-ledger.json')
  let ledgerCleanCount = cleanCount
  let ledgerDefectCount = defectPositiveCount
  let ledgerSevereCount = severeCount
  if (fs.existsSync(actualLedgerPath)) {
    try {
      const diskLedger = JSON.parse(fs.readFileSync(actualLedgerPath, 'utf8'))
      if (typeof diskLedger.cleanCount === 'number') ledgerCleanCount = Math.max(ledgerCleanCount, diskLedger.cleanCount)
      if (typeof diskLedger.defectPositiveCount === 'number') ledgerDefectCount = Math.max(ledgerDefectCount, diskLedger.defectPositiveCount)
      if (typeof diskLedger.severeCount === 'number') ledgerSevereCount = Math.max(ledgerSevereCount, diskLedger.severeCount)
    } catch {
      // ignore
    }
  }

  const ledger = {
    currentReviewSequenceIndex: nextSeqIndex,
    currentReviewArrayIndex: nextArrIndex,
    candidateStates,
    completedCount,
    cleanCount: ledgerCleanCount,
    defectPositiveCount: ledgerDefectCount,
    severeCount: ledgerSevereCount,
  }

  const stoppingCheck = checkStoppingRule({ cleanCount: ledgerCleanCount, defectPositiveCount: ledgerDefectCount, severeCount: ledgerSevereCount })
  if (stoppingCheck.stoppingRuleSatisfied) {
    throw new Error(
      'PRIMARY_STOPPING_THRESHOLD_REACHED: Scientific stopping rule satisfied (CLEAN >= 30, DEFECT >= 30, SEVERE >= 6). ' +
      'Primary review recruitment is complete. No additional primary candidate may be prepared.'
    )
  }

  const selection = getNextReviewCandidate({ ledger, reviewOrder: orderData })
  if (selection.stoppingRuleSatisfied) {
    throw new Error(
      'PRIMARY_STOPPING_THRESHOLD_REACHED: Scientific stopping rule satisfied (CLEAN >= 30, DEFECT >= 30, SEVERE >= 6). ' +
      'Primary review recruitment is complete. No additional primary candidate may be prepared.'
    )
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

  // Live pilot / post-pilot authorization gate on production root (or when authorizationPath is supplied)
  const defaultExecutionRoot = path.join(p2Dir, 'review-execution')
  const isProdRoot = path.resolve(executionRoot) === path.resolve(defaultExecutionRoot)

  if (isProdRoot || authorizationPath) {
    if (candidateId === 'exp100-tmdb-672647') {
      validateCandidate1PilotAuthorization({ p2Dir, authorizationPath })
    } else {
      const sessionAuthFile = authorizationPath || path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
      if (!fs.existsSync(sessionAuthFile)) {
        throw new Error(
          `PILOT_NOT_AUTHORIZED: Candidate execution on production root is only authorized for Candidate #1 without post-pilot session authorization. Candidate '${candidateId}' is not authorized.`
        )
      }
      validatePostPilotSessionAuthorization({ p2Dir, authorizationPath: sessionAuthFile, executionRoot })

      // Advancement requires durable authoritative human adjudication of Candidate #1
      const c1Dir = path.join(executionRoot, 'exp100-tmdb-672647')
      const c1HumanPath = path.join(c1Dir, 'human/adjudication-record.v1.json')
      if (!fs.existsSync(c1HumanPath)) {
        throw new Error(
          `SEQUENTIAL_ORDER_VIOLATION: Candidate #1 (exp100-tmdb-672647) must reach durable human adjudication before Candidate #${orderEntry.reviewSequenceIndex || selection.sequenceIndex} (${candidateId}) may be prepared`
        )
      }
    }
  }

  const reviewSequenceIndex = orderEntry.reviewSequenceIndex || selection.sequenceIndex

  // Deterministic Checkpoint Boundary Enforcement
  // Candidate #1 is standalone pilot. Post-pilot cadence is blocks of 8 (#2-#9, #10-#17, etc.)
  // Before candidate at sequence index > 9 can be prepared, prior blocks must have verified canonical checkpoints.
  enforceCheckpointBoundary({
    targetSequenceIndex: reviewSequenceIndex,
    executionRoot,
    p2Dir,
  })

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
 * Command 5: Record authoritative manual human adjudication.
 * Sophia Zhao explicitly supplies human decision fields; zero inference from AI advisories.
 * Automatically verifies complete evidence chain and recomputes stopping status internally.
 */
export function recordManualHumanAdjudication({
  candidateId,
  finalDecision,
  finalSeverity = null,
  affectedFields = [],
  materialIssues = [],
  humanRationale,
  executionRoot,
  p2Dir = defaultP2Dir,
  ledgerPath = null,
  reviewOrder = null,
  eligiblePool = null,
}) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('INVALID_ARGUMENT: candidateId is required')
  }
  if (!executionRoot) {
    throw new Error('INVALID_ARGUMENT: executionRoot is required')
  }
  if (finalDecision !== 'APPROVE' && finalDecision !== 'REVISE') {
    throw new Error(`INVALID_DECISION: finalDecision must be 'APPROVE' or 'REVISE', got '${finalDecision}'`)
  }

  let normalizedSeverity = null
  let normalizedAffectedFields = []
  let normalizedMaterialIssues = []

  if (finalDecision === 'APPROVE') {
    if (finalSeverity !== null && finalSeverity !== undefined) {
      throw new Error(`INVALID_DECISION_FIELDS: finalSeverity must be null for APPROVE, got '${finalSeverity}'`)
    }
    if (affectedFields && affectedFields.length > 0) {
      throw new Error(`INVALID_DECISION_FIELDS: affectedFields must be empty for APPROVE`)
    }
    if (materialIssues && materialIssues.length > 0) {
      throw new Error(`INVALID_DECISION_FIELDS: materialIssues must be empty for APPROVE`)
    }
  } else if (finalDecision === 'REVISE') {
    if (finalSeverity !== 'MINOR' && finalSeverity !== 'SEVERE') {
      throw new Error(`INVALID_SEVERITY: finalSeverity must be 'MINOR' or 'SEVERE' for REVISE, got '${finalSeverity}'`)
    }
    normalizedSeverity = finalSeverity

    if (!Array.isArray(affectedFields) || affectedFields.length === 0) {
      throw new Error('INVALID_AFFECTED_FIELDS: affectedFields must be a non-empty array for REVISE')
    }
    const validFieldNames = new Set(['description', 'whyWatch', 'curiosityHook', 'vibeSummary'])
    for (const f of affectedFields) {
      if (!validFieldNames.has(f)) {
        throw new Error(`INVALID_AFFECTED_FIELD: '${f}' is not an allowed field in [description, whyWatch, curiosityHook, vibeSummary]`)
      }
    }
    normalizedAffectedFields = affectedFields

    if (!Array.isArray(materialIssues) || materialIssues.length === 0) {
      throw new Error('INVALID_MATERIAL_ISSUES: materialIssues must be a non-empty array for REVISE')
    }
    for (const issue of materialIssues) {
      if (typeof issue !== 'string' || !issue.trim()) {
        throw new Error('INVALID_MATERIAL_ISSUE: Material issues must be non-empty strings')
      }
    }
    normalizedMaterialIssues = materialIssues
  }

  if (!humanRationale || typeof humanRationale !== 'string' || !humanRationale.trim()) {
    throw new Error('INVALID_HUMAN_RATIONALE: Explicit non-empty humanRationale from Sophia Zhao is strictly required')
  }

  const candidateDir = path.join(executionRoot, candidateId)
  if (!fs.existsSync(candidateDir)) {
    throw new Error(`CANDIDATE_NOT_INITIALIZED: Directory not found: ${candidateDir}`)
  }

  // Load existing bundle or build it if missing
  const bundlePath = path.join(candidateDir, 'human-review-bundle.v1.json')
  let bundle
  if (fs.existsSync(bundlePath)) {
    bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  } else {
    const bundleRes = buildManualHumanBundle({ candidateId, executionRoot, p2Dir })
    bundle = bundleRes.bundle
  }

  // Load review order to get reviewSequenceIndex
  const orderPath = path.join(p2Dir, 'blind-review-order.v1.json')
  const orderData = reviewOrder || JSON.parse(fs.readFileSync(orderPath, 'utf8'))
  const orderedCandidates = orderData.orderedCandidates || orderData.order || []
  const orderEntry = orderedCandidates.find((c) => c.candidateId === candidateId)
  const reviewSequenceIndex = orderEntry?.reviewSequenceIndex || 1

  // Load or reconcile session ledger
  const actualLedgerPath = ledgerPath || path.join(executionRoot, 'review-session-ledger.json')
  let currentLedger
  if (fs.existsSync(actualLedgerPath)) {
    currentLedger = loadReviewSessionLedger(actualLedgerPath)
  } else {
    const poolPath = path.join(p2Dir, 'blind-review-eligible-pool.v1.json')
    const poolData = eligiblePool || (fs.existsSync(poolPath) ? JSON.parse(fs.readFileSync(poolPath, 'utf8')) : { records: [] })
    const manifestPath = path.join(p2Dir, 'p2-1-freeze-manifest.v1.json')
    const manifestBytes = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : Buffer.from('')
    const p21ManifestSha256 = sha256(manifestBytes)
    const orderSha256 = fs.existsSync(orderPath) ? sha256(fs.readFileSync(orderPath)) : sha256(JSON.stringify(orderData))

    currentLedger = reconcileReviewSessionFromDisk({
      executionRoot,
      eligiblePool: poolData,
      reviewOrder: orderData,
      p21FreezeManifestSha256: p21ManifestSha256,
      reviewOrderSha256: orderSha256,
      ledgerPath: actualLedgerPath,
      bindings: {
        geminiModel: 'MANUAL_CONSUMER_UI',
        claudeModel: 'MANUAL_CONSUMER_UI',
      },
    })
  }

  const recordRes = recordHumanAdjudication({
    candidateId,
    candidateDir,
    reviewSequenceIndex,
    bundle,
    adjudicationData: {
      candidateId,
      blindPacketHash: bundle.blindPacketSha256,
      geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
      claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
      adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
      finalDecision,
      finalSeverity: normalizedSeverity,
      affectedFields: normalizedAffectedFields,
      materialIssues: normalizedMaterialIssues,
      humanRationale: humanRationale.trim(),
      agreementPattern: deriveAgreementPattern({
        geminiDecision: bundle.geminiAdvisory.preliminaryDecision,
        claudeDecision: bundle.claudeAdvisory.preliminaryDecision,
        humanDecision: finalDecision,
      }),
      adjudicationTimestamp: new Date().toISOString(),
    },
    ledger: currentLedger,
    ledgerPath: actualLedgerPath,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    geminiModel: 'MANUAL_CONSUMER_UI',
    claudeModel: 'MANUAL_CONSUMER_UI',
  })

  // Evaluate stopping rule internally
  const updatedLedger = recordRes.updatedLedger
  const cleanCount = updatedLedger.cleanCount || 0
  const defectPositiveCount = updatedLedger.defectPositiveCount || 0
  const severeCount = updatedLedger.severeCount || 0
  const stopping = checkStoppingRule({ cleanCount, defectPositiveCount, severeCount })
  const operationalStatus = stopping.stoppingRuleSatisfied
    ? 'PRIMARY_STOPPING_THRESHOLD_REACHED'
    : 'PRIMARY_REVIEW_CONTINUES'

  let nextCandidateId = null
  if (operationalStatus === 'PRIMARY_REVIEW_CONTINUES') {
    const nextSelection = getNextReviewCandidate({ ledger: updatedLedger, reviewOrder: orderData })
    if (!nextSelection.stoppingRuleSatisfied && nextSelection.candidate) {
      nextCandidateId = nextSelection.candidate.candidateId
    }
  }

  return {
    success: true,
    candidateId,
    reviewSequenceIndex,
    finalDecision,
    finalSeverity: normalizedSeverity,
    recordPath: recordRes.recordPath,
    recordSha256: recordRes.recordSha256,
    operationalStatus,
    nextCandidateId,
  }
}

/**
 * Command 6: Get current sequential candidate.
 * Derives current candidate without exposing live quota counters.
 */
export function getCurrentReviewCandidate({
  executionRoot,
  p2Dir = defaultP2Dir,
  reviewOrder = null,
} = {}) {
  const orderData = reviewOrder || JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
  const orderedCandidates = orderData.orderedCandidates || orderData.order || []

  let completedCount = 0
  let cleanCount = 0
  let defectPositiveCount = 0
  let severeCount = 0
  let nextSeqIndex = 1

  for (let i = 0; i < orderedCandidates.length; i++) {
    const entry = orderedCandidates[i]
    const cId = entry.candidateId
    const seqIndex = entry.reviewSequenceIndex || (i + 1)
    const candidateDir = path.join(executionRoot, cId)
    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')

    if (fs.existsSync(humanRecordPath)) {
      const humanRecord = JSON.parse(fs.readFileSync(humanRecordPath, 'utf8'))
      completedCount++
      if (humanRecord.finalDecision === 'APPROVE') {
        cleanCount++
      } else if (humanRecord.finalDecision === 'REVISE') {
        defectPositiveCount++
        if (humanRecord.finalSeverity === 'SEVERE' || humanRecord.finalSeverity === 'SEVERE_DEFECT') {
          severeCount++
        }
      }
      nextSeqIndex = seqIndex + 1
    } else {
      break
    }
  }

  const stopping = checkStoppingRule({ cleanCount, defectPositiveCount, severeCount })
  const operationalStatus = stopping.stoppingRuleSatisfied
    ? 'PRIMARY_STOPPING_THRESHOLD_REACHED'
    : 'PRIMARY_REVIEW_CONTINUES'

  const currentEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === nextSeqIndex)

  return {
    operationalStatus,
    currentCandidateId: currentEntry ? currentEntry.candidateId : null,
    currentReviewSequenceIndex: nextSeqIndex,
    stoppingRuleSatisfied: stopping.stoppingRuleSatisfied,
  }
}

/**
 * Invariant: CHECKPOINT_MANIFEST_IS_DERIVED_NOT_AUTHORITATIVE
 * Invariant: CHECKPOINT_MANIFEST_FAILURE_HARD_STOPS_PRIMARY_REVIEW
 *
 * Canonical checkpoint manifest path helper.
 */
export function getCanonicalCheckpointPath(executionRoot, fromIndex, toIndex) {
  const padFrom = String(fromIndex).padStart(4, '0')
  const padTo = String(toIndex).padStart(4, '0')
  return path.join(executionRoot, 'checkpoints', `checkpoint-seq-${padFrom}-to-${padTo}.v1.json`)
}

/**
 * Returns required post-pilot checkpoint blocks that must be completed and verified
 * before candidate at sequenceIndex may be prepared.
 * Post-pilot operational cadence: blocks of 8 newly completed candidates (#2–#9, #10–#17, #18–#25, ...)
 */
export function getRequiredCheckpointBlocks(targetSequenceIndex) {
  const blocks = []
  let from = 2
  let to = 9
  while (targetSequenceIndex > to) {
    blocks.push({ fromSequenceIndex: from, toSequenceIndex: to })
    from += 8
    to += 8
  }
  return blocks
}

/**
 * Verifies that all required checkpoint boundaries preceding targetSequenceIndex have
 * verified canonical checkpoint manifests persisted on disk.
 * Throws PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY fail-closed if any checkpoint is missing or invalid.
 */
export function enforceCheckpointBoundary({ targetSequenceIndex, executionRoot, p2Dir = defaultP2Dir }) {
  const requiredBlocks = getRequiredCheckpointBlocks(targetSequenceIndex)
  for (const block of requiredBlocks) {
    const cpPath = getCanonicalCheckpointPath(executionRoot, block.fromSequenceIndex, block.toSequenceIndex)
    if (!fs.existsSync(cpPath)) {
      throw new Error(
        `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint manifest missing at canonical path ${cpPath} ` +
        `for completed block [${block.fromSequenceIndex}..${block.toSequenceIndex}]. Next candidate at sequence index ${targetSequenceIndex} cannot be prepared.`
      )
    }
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(cpPath, 'utf8'))
    } catch (err) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint manifest at ${cpPath} is malformed JSON: ${err.message}`)
    }
    verifyCheckpointManifest({ manifest, executionRoot, p2Dir })
  }
}

/**
 * Invariant: CHECKPOINT_MANIFEST_IS_DERIVED_NOT_AUTHORITATIVE
 * Invariant: CHECKPOINT_MANIFEST_FAILURE_HARD_STOPS_PRIMARY_REVIEW
 *
 * Deterministic derived checkpoint manifest generator.
 * Reconstructed exclusively from authoritative per-candidate human adjudication records,
 * verified evidence chains, frozen review order, and authoritative session ledger.
 */
export function generateCheckpointManifest({
  executionRoot,
  p2Dir = defaultP2Dir,
  fromSequenceIndex = 1,
  toSequenceIndex = null,
  previousCheckpointCommit = null,
  ledgerPath = null,
} = {}) {
  if (!executionRoot || !fs.existsSync(executionRoot)) {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: executionRoot is missing or absent')
  }
  const orderPath = path.join(p2Dir, 'blind-review-order.v1.json')
  if (!fs.existsSync(orderPath)) {
    throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Review order file missing at ${orderPath}`)
  }
  const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'))
  const orderedCandidates = orderData.orderedCandidates || orderData.order || []

  const actualLedgerPath = ledgerPath || path.join(executionRoot, 'review-session-ledger.json')
  if (!fs.existsSync(actualLedgerPath)) {
    throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Session ledger missing at ${actualLedgerPath}`)
  }
  const ledgerRaw = fs.readFileSync(actualLedgerPath, 'utf8')
  const ledger = JSON.parse(ledgerRaw)

  const maxIndex = toSequenceIndex !== null ? toSequenceIndex : orderedCandidates.length
  const candidateRecords = []

  for (let idx = fromSequenceIndex; idx <= maxIndex; idx++) {
    const orderEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === idx)
    if (!orderEntry) {
      if (toSequenceIndex !== null) {
        throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Sequence index ${idx} not found in review order`)
      }
      break
    }
    const cId = orderEntry.candidateId
    const candidateDir = path.join(executionRoot, cId)
    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')

    if (!fs.existsSync(humanRecordPath)) {
      if (toSequenceIndex !== null) {
        throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Missing required candidate record for ${cId} at sequence index ${idx}`)
      }
      break
    }

    try {
      verifyCandidateReviewEvidenceChain({
        candidateId: cId,
        candidateDir,
        bindings: {
          geminiModel: 'MANUAL_CONSUMER_UI',
          claudeModel: 'MANUAL_CONSUMER_UI',
        },
      })
    } catch (err) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Evidence chain verification failed for ${cId}: ${err.message}`)
    }

    const humanRecordBytes = fs.readFileSync(humanRecordPath)
    const adjudicationRecordSha256 = sha256(humanRecordBytes)
    const humanRecord = JSON.parse(humanRecordBytes.toString('utf8'))

    if (!humanRecord.adjudicationTimestamp) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Adjudication timestamp missing for ${cId}`)
    }

    const ledgerState = ledger.candidateStates?.[cId]
    if (!ledgerState || ledgerState.status !== 'HUMAN_ADJUDICATED') {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Ledger does not reflect HUMAN_ADJUDICATED state for ${cId}`)
    }
    if (!ledgerState.humanAdjudicationSha256 || ledgerState.humanAdjudicationSha256 !== adjudicationRecordSha256) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Ledger humanAdjudicationSha256 does not match disk bytes for ${cId}`)
    }

    candidateRecords.push({
      reviewSequenceIndex: idx,
      candidateId: cId,
      adjudicationTimestamp: humanRecord.adjudicationTimestamp,
      adjudicationRecordSha256,
      finalDecision: humanRecord.finalDecision,
      finalSeverity: humanRecord.finalSeverity || null,
    })
  }

  if (candidateRecords.length === 0) {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Zero completed candidate records found in specified range')
  }

  // Reconstruct cumulative progression through checkpoint boundary
  const boundarySequenceIndex = candidateRecords[candidateRecords.length - 1].reviewSequenceIndex
  let cumulativeCompleted = 0
  let cumulativeClean = 0
  let cumulativeDefect = 0
  let cumulativeSevere = 0

  for (let idx = 1; idx <= boundarySequenceIndex; idx++) {
    const orderEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === idx)
    if (!orderEntry) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Sequence index ${idx} not found in review order during cumulative progression calculation`)
    }
    const cId = orderEntry.candidateId
    const candidateDir = path.join(executionRoot, cId)
    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')
    if (!fs.existsSync(humanRecordPath)) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Missing required candidate record for ${cId} at sequence index ${idx}`)
    }
    const rec = JSON.parse(fs.readFileSync(humanRecordPath, 'utf8'))
    cumulativeCompleted++
    if (rec.finalDecision === 'APPROVE') {
      cumulativeClean++
    } else if (rec.finalDecision === 'REVISE') {
      cumulativeDefect++
      if (rec.finalSeverity === 'SEVERE' || rec.finalSeverity === 'SEVERE_DEFECT') {
        cumulativeSevere++
      }
    }
  }

  const cumulativeProgression = {
    throughSequenceIndex: boundarySequenceIndex,
    completedCount: cumulativeCompleted,
    cleanCount: cumulativeClean,
    defectPositiveCount: cumulativeDefect,
    severeCount: cumulativeSevere,
  }

  // Pure deterministic historical projection
  const projection = {
    firstReviewSequenceIndex: candidateRecords[0].reviewSequenceIndex,
    lastReviewSequenceIndex: boundarySequenceIndex,
    candidateStates: candidateRecords.map((r) => ({
      reviewSequenceIndex: r.reviewSequenceIndex,
      candidateId: r.candidateId,
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: r.adjudicationRecordSha256,
      finalDecision: r.finalDecision,
      finalSeverity: r.finalSeverity,
    })),
    cumulativeProgression,
  }

  const projectionSerialized = serializeArtifactForPersistence(projection)
  const historicalLedgerSliceSha256 = sha256(Buffer.from(projectionSerialized, 'utf8'))

  const manifest = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    manifestType: 'DERIVED_AUDIT_ARTIFACT',
    activity: 'VERIFIER_V14_EVIDENCE_CHECKPOINT_MANIFEST',
    classification: 'RETROSPECTIVE_SEMANTIC_DEVELOPMENT_CHECKPOINT',
    derivedNotAuthoritative: true,
    schemaVersion: 'verifier-v1.4-checkpoint-manifest.v1',
    firstReviewSequenceIndex: candidateRecords[0].reviewSequenceIndex,
    lastReviewSequenceIndex: boundarySequenceIndex,
    recordCount: candidateRecords.length,
    cumulativeProgression,
    historicalLedgerSliceSha256,
    previousCheckpointCommit: previousCheckpointCommit || null,
    candidates: candidateRecords,
  }

  return manifest
}

/**
 * Validates a derived checkpoint manifest against immutable disk state.
 * Uses historical subsumption verification: asserts immutable historical state
 * without requiring identity with future evolving live ledger files.
 * Fails closed with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY on any mismatch.
 */
export function verifyCheckpointManifest({
  manifest,
  executionRoot,
  p2Dir = defaultP2Dir,
  ledgerPath = null,
} = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Manifest object is required')
  }
  if (manifest.manifestType !== 'DERIVED_AUDIT_ARTIFACT' || manifest.derivedNotAuthoritative !== true) {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Manifest must declare manifestType: DERIVED_AUDIT_ARTIFACT and derivedNotAuthoritative: true')
  }
  if (!Array.isArray(manifest.candidates) || manifest.candidates.length !== manifest.recordCount) {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Manifest candidates count does not match recordCount')
  }
  if (!manifest.historicalLedgerSliceSha256 || typeof manifest.historicalLedgerSliceSha256 !== 'string') {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Manifest missing historicalLedgerSliceSha256')
  }
  if (!manifest.cumulativeProgression || typeof manifest.cumulativeProgression !== 'object') {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Manifest missing cumulativeProgression')
  }

  const orderPath = path.join(p2Dir, 'blind-review-order.v1.json')
  const orderData = JSON.parse(fs.readFileSync(orderPath, 'utf8'))
  const orderedCandidates = orderData.orderedCandidates || orderData.order || []

  const expectedCount = manifest.lastReviewSequenceIndex - manifest.firstReviewSequenceIndex + 1
  if (manifest.recordCount !== expectedCount) {
    throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Non-contiguous sequence range [${manifest.firstReviewSequenceIndex}, ${manifest.lastReviewSequenceIndex}] for recordCount ${manifest.recordCount}`)
  }

  const seenSeq = new Set()
  const seenCandidates = new Set()
  const verifiedProjectionCandidates = []

  for (let i = 0; i < manifest.candidates.length; i++) {
    const entry = manifest.candidates[i]
    const expectedSeq = manifest.firstReviewSequenceIndex + i
    if (entry.reviewSequenceIndex !== expectedSeq) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Sequence index gap or disorder at position ${i}: expected ${expectedSeq}, got ${entry.reviewSequenceIndex}`)
    }
    if (seenSeq.has(entry.reviewSequenceIndex)) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Duplicate reviewSequenceIndex ${entry.reviewSequenceIndex}`)
    }
    seenSeq.add(entry.reviewSequenceIndex)

    if (seenCandidates.has(entry.candidateId)) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Duplicate candidateId ${entry.candidateId}`)
    }
    seenCandidates.add(entry.candidateId)

    const orderEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === entry.reviewSequenceIndex)
    if (!orderEntry || orderEntry.candidateId !== entry.candidateId) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Candidate ${entry.candidateId} at sequence ${entry.reviewSequenceIndex} does not match frozen review order`)
    }

    const candidateDir = path.join(executionRoot, entry.candidateId)
    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')
    if (!fs.existsSync(humanRecordPath)) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Missing adjudication record file for ${entry.candidateId}`)
    }

    const actualBytes = fs.readFileSync(humanRecordPath)
    const actualSha = sha256(actualBytes)
    if (actualSha !== entry.adjudicationRecordSha256) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Hash mismatch for ${entry.candidateId}: disk ${actualSha} vs manifest ${entry.adjudicationRecordSha256}`)
    }

    const humanRecord = JSON.parse(actualBytes.toString('utf8'))
    if (!humanRecord.adjudicationTimestamp || humanRecord.adjudicationTimestamp !== entry.adjudicationTimestamp) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Timestamp mismatch for ${entry.candidateId}`)
    }

    const normalizedSeverity = humanRecord.finalSeverity || null
    if (entry.finalDecision !== humanRecord.finalDecision) {
      throw new Error(
        `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Final decision mismatch for ${entry.candidateId}: ` +
        `manifest '${entry.finalDecision}' vs authoritative disk record '${humanRecord.finalDecision}'`
      )
    }
    if (entry.finalSeverity !== normalizedSeverity) {
      throw new Error(
        `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Final severity mismatch for ${entry.candidateId}: ` +
        `manifest '${entry.finalSeverity}' vs authoritative disk record '${normalizedSeverity}'`
      )
    }

    try {
      verifyCandidateReviewEvidenceChain({
        candidateId: entry.candidateId,
        candidateDir,
        bindings: {
          geminiModel: 'MANUAL_CONSUMER_UI',
          claudeModel: 'MANUAL_CONSUMER_UI',
        },
      })
    } catch (err) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Evidence chain invalid for ${entry.candidateId}: ${err.message}`)
    }

    verifiedProjectionCandidates.push({
      reviewSequenceIndex: orderEntry.reviewSequenceIndex,
      candidateId: orderEntry.candidateId,
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: actualSha,
      finalDecision: humanRecord.finalDecision,
      finalSeverity: normalizedSeverity,
    })
  }

  // 2. Reconstruct deterministic cumulative progression through checkpoint boundary
  let cumulativeCompleted = 0
  let cumulativeClean = 0
  let cumulativeDefect = 0
  let cumulativeSevere = 0

  for (let idx = 1; idx <= manifest.lastReviewSequenceIndex; idx++) {
    const orderEntry = orderedCandidates.find((c) => (c.reviewSequenceIndex || 0) === idx)
    if (!orderEntry) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Sequence index ${idx} not found in review order during cumulative progression verification`)
    }
    const cId = orderEntry.candidateId
    const candidateDir = path.join(executionRoot, cId)
    const humanRecordPath = path.join(candidateDir, 'human/adjudication-record.v1.json')
    if (!fs.existsSync(humanRecordPath)) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Missing required candidate record for ${cId} at sequence index ${idx}`)
    }
    const rec = JSON.parse(fs.readFileSync(humanRecordPath, 'utf8'))
    cumulativeCompleted++
    if (rec.finalDecision === 'APPROVE') {
      cumulativeClean++
    } else if (rec.finalDecision === 'REVISE') {
      cumulativeDefect++
      if (rec.finalSeverity === 'SEVERE' || rec.finalSeverity === 'SEVERE_DEFECT') {
        cumulativeSevere++
      }
    }
  }

  const expectedCumulative = {
    throughSequenceIndex: manifest.lastReviewSequenceIndex,
    completedCount: cumulativeCompleted,
    cleanCount: cumulativeClean,
    defectPositiveCount: cumulativeDefect,
    severeCount: cumulativeSevere,
  }

  if (
    manifest.cumulativeProgression.throughSequenceIndex !== expectedCumulative.throughSequenceIndex ||
    manifest.cumulativeProgression.completedCount !== expectedCumulative.completedCount ||
    manifest.cumulativeProgression.cleanCount !== expectedCumulative.cleanCount ||
    manifest.cumulativeProgression.defectPositiveCount !== expectedCumulative.defectPositiveCount ||
    manifest.cumulativeProgression.severeCount !== expectedCumulative.severeCount
  ) {
    throw new Error('PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint cumulative progression does not match reconstructed disk truth')
  }

  // 3. Verify deterministic historical projection hash
  const expectedProjection = {
    firstReviewSequenceIndex: manifest.firstReviewSequenceIndex,
    lastReviewSequenceIndex: manifest.lastReviewSequenceIndex,
    candidateStates: verifiedProjectionCandidates,
    cumulativeProgression: expectedCumulative,
  }
  const serializedExpected = serializeArtifactForPersistence(expectedProjection)
  const expectedProjectionSha = sha256(Buffer.from(serializedExpected, 'utf8'))

  if (expectedProjectionSha !== manifest.historicalLedgerSliceSha256) {
    throw new Error(
      `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Historical ledger slice hash mismatch: ` +
      `expected ${expectedProjectionSha}, got ${manifest.historicalLedgerSliceSha256}`
    )
  }

  // 4. Historical Subsumption: Verify current live session ledger still subsumes all checkpointed candidate states
  const actualLedgerPath = ledgerPath || path.join(executionRoot, 'review-session-ledger.json')
  if (fs.existsSync(actualLedgerPath)) {
    let liveLedger
    try {
      liveLedger = JSON.parse(fs.readFileSync(actualLedgerPath, 'utf8'))
    } catch (err) {
      throw new Error(`PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Failed to parse live session ledger: ${err.message}`)
    }
    for (const entry of manifest.candidates) {
      const liveState = liveLedger.candidateStates?.[entry.candidateId]
      if (!liveState) {
        throw new Error(
          `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint candidate ${entry.candidateId} (sequence index ${entry.reviewSequenceIndex}) ` +
          `is missing from current live session ledger candidateStates`
        )
      }
      if (liveState.status !== 'HUMAN_ADJUDICATED') {
        throw new Error(
          `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint candidate ${entry.candidateId} status in live session ledger ` +
          `is '${liveState.status}' (expected 'HUMAN_ADJUDICATED')`
        )
      }
      if (!liveState.humanAdjudicationSha256 || liveState.humanAdjudicationSha256 !== entry.adjudicationRecordSha256) {
        throw new Error(
          `PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY: Checkpoint candidate ${entry.candidateId} humanAdjudicationSha256 in live session ledger ` +
          `(${liveState.humanAdjudicationSha256}) does not match checkpoint record hash (${entry.adjudicationRecordSha256})`
        )
      }
    }
  }

  return {
    valid: true,
    firstReviewSequenceIndex: manifest.firstReviewSequenceIndex,
    lastReviewSequenceIndex: manifest.lastReviewSequenceIndex,
    recordCount: manifest.recordCount,
    historicalLedgerSliceSha256: manifest.historicalLedgerSliceSha256,
  }
}

/**
 * Registered Future Diagnostic: SEQUENCE_POSITION_DRIFT_CHECK
 * Post-truth final QA diagnostic only. Explicitly labeled DIAGNOSTIC_ONLY.
 * Cannot execute before primary recruitment, QA, and truth freeze are complete.
 * Cannot invalidate study, mutate truth, or alter final cohort.
 */
export const SEQUENCE_POSITION_DRIFT_CONTRACT = Object.freeze({
  activity: 'SEQUENCE_POSITION_DRIFT_CHECK',
  classification: 'DIAGNOSTIC_ONLY',
  prerequisites: Object.freeze({
    primaryRecruitmentComplete: true,
    preregisteredQaComplete: true,
    authoritativeTruthFrozen: true,
  }),
  specification: Object.freeze({
    outcome: 'I(finalSeverity == SEVERE)',
    predictor: 'centered reviewSequenceIndex',
    reportedMetrics: Object.freeze([
      'severeProportionByReviewPositionQuartile',
      'logisticRegressionSlope',
      'confidenceInterval95',
      'twoSidedPValue',
      'totalSevereCount',
    ]),
    invalidationRule: null,
    cannotMutateTruth: true,
    cannotAlterFinalCohort: true,
    cannotTriggerSelectiveRereview: true,
  }),
})

export function validateSequencePositionDriftExecution({
  primaryRecruitmentComplete = false,
  qaCompleted = false,
  truthFrozen = false,
} = {}) {
  if (!primaryRecruitmentComplete || !qaCompleted || !truthFrozen) {
    throw new Error(
      'EXECUTION_BLOCKED: SEQUENCE_POSITION_DRIFT_CHECK cannot run before primary recruitment has stopped, preregistered QA has completed, and authoritative truth is frozen.'
    )
  }
  return {
    authorized: true,
    classification: 'DIAGNOSTIC_ONLY',
    contract: SEQUENCE_POSITION_DRIFT_CONTRACT,
  }
}

/**
 * CLI Main Dispatcher
 */
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args

  if (!command || command === '--help' || command === '-h') {
    console.log(`Movie Mood V8.2 — Verifier v1.4 Manual Preliminary Advisory Review Operator Tool

Commands:
  current [--execution-root <path>]
  next    [--execution-root <path>]
  prepare <candidateId> <GEMINI|CLAUDE> [--execution-root <path>]
  ingest  <candidateId> <GEMINI|CLAUDE> <responseFile> [--visible-model-label <label>] [--correction-for-ingest-error] [--correction-reason <reason>] [--execution-root <path>]
  status  <candidateId> [--execution-root <path>]
  bundle  <candidateId> [--execution-root <path>]
  adjudicate <candidateId> --decision <APPROVE|REVISE> [--severity <MINOR|SEVERE>] [--fields <f1,f2>] [--issues <i1,i2>] --rationale <text> [--execution-root <path>]
  checkpoint [--output <path>] [--from <seq>] [--to <seq>] [--execution-root <path>]
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

  if (command === 'current' || command === 'next') {
    const res = getCurrentReviewCandidate({ executionRoot, p2Dir: defaultP2Dir })
    console.log(`Operational Status: ${res.operationalStatus}`)
    if (res.currentCandidateId) {
      console.log(`Current Sequential Candidate: ${res.currentCandidateId} (Sequence Index ${res.currentReviewSequenceIndex})`)
    } else {
      console.log('No current candidate available.')
    }
    return
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

  if (command === 'adjudicate') {
    const candidateId = rest[0]
    const decision = getArg('--decision')?.toUpperCase()
    const severity = getArg('--severity')?.toUpperCase() || null
    const fieldsArg = getArg('--fields')
    const issuesArg = getArg('--issues')
    const rationale = getArg('--rationale')
    const rationaleFile = getArg('--rationale-file')
    const adjudicationFile = getArg('--adjudication-file')

    let fields = []
    if (fieldsArg) {
      fields = fieldsArg.split(',').map((f) => f.trim()).filter(Boolean)
    }
    let issues = []
    if (issuesArg) {
      issues = issuesArg.split(',').map((i) => i.trim()).filter(Boolean)
    }

    let finalDecision = decision
    let finalSeverity = severity
    let finalRationale = rationale

    if (rationaleFile && fs.existsSync(rationaleFile)) {
      finalRationale = fs.readFileSync(rationaleFile, 'utf8').trim()
    }

    if (adjudicationFile && fs.existsSync(adjudicationFile)) {
      const data = JSON.parse(fs.readFileSync(adjudicationFile, 'utf8'))
      if (data.finalDecision) finalDecision = data.finalDecision
      if (data.finalSeverity !== undefined) finalSeverity = data.finalSeverity
      if (data.affectedFields) fields = data.affectedFields
      if (data.materialIssues) issues = data.materialIssues
      if (data.humanRationale) finalRationale = data.humanRationale
    }

    if (!candidateId || !finalDecision) {
      console.error('Usage: adjudicate <candidateId> --decision <APPROVE|REVISE> [--severity <MINOR|SEVERE>] [--fields <field1,field2>] [--issues <issue1,issue2>] --rationale <text>')
      process.exit(1)
    }

    const res = recordManualHumanAdjudication({
      candidateId,
      finalDecision,
      finalSeverity,
      affectedFields: fields,
      materialIssues: issues,
      humanRationale: finalRationale,
      executionRoot,
      p2Dir: defaultP2Dir,
    })

    console.log(`HUMAN ADJUDICATION PERSISTED: ${res.candidateId}`)
    console.log(`Decision: ${res.finalDecision}${res.finalSeverity ? ` (${res.finalSeverity})` : ''}`)
    console.log(`Adjudication Record SHA-256: ${res.recordSha256}`)
    console.log(`Operational Status: ${res.operationalStatus}`)
    if (res.nextCandidateId) {
      console.log(`Next Sequential Candidate: ${res.nextCandidateId}`)
    }
    return
  }

  if (command === 'checkpoint') {
    const fromIndex = getArg('--from') ? parseInt(getArg('--from'), 10) : 1
    const toIndex = getArg('--to') ? parseInt(getArg('--to'), 10) : null
    let outputFile = getArg('--output')
    if (!outputFile && toIndex !== null) {
      outputFile = getCanonicalCheckpointPath(executionRoot, fromIndex, toIndex)
    }
    const manifest = generateCheckpointManifest({
      executionRoot,
      p2Dir: defaultP2Dir,
      fromSequenceIndex: fromIndex,
      toSequenceIndex: toIndex,
    })
    const verifyRes = verifyCheckpointManifest({ manifest, executionRoot, p2Dir: defaultP2Dir })
    console.log(`CHECKPOINT MANIFEST VERIFIED: ${verifyRes.recordCount} candidates [${verifyRes.firstReviewSequenceIndex} - ${verifyRes.lastReviewSequenceIndex}]`)
    if (outputFile) {
      atomicWriteJson(outputFile, manifest, { overwrite: true })
      console.log(`Written to: ${outputFile}`)
    } else {
      console.log(JSON.stringify(manifest, null, 2))
    }
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
