import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

function sha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

// ---------------------------------------------------------------------------
// REFERENCE IMPLEMENTATION OF PREREGISTERED ALGORITHMS FOR TEST VERIFICATION
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic copy-ready review payload for manual submission.
 */
export function buildCopyReadyPayload({
  candidateId,
  blindPacketBytes,
  promptText,
  reviewer,
  reviewSequenceIndex,
  materialityPolicyBytes,
}) {
  if (!candidateId || !blindPacketBytes || !promptText || !reviewer || !reviewSequenceIndex || !materialityPolicyBytes) {
    throw new Error('MISSING_PAYLOAD_BINDINGS: All payload bindings are strictly required')
  }
  if (reviewer !== 'GEMINI' && reviewer !== 'CLAUDE') {
    throw new Error(`INVALID_REVIEWER: Reviewer must be 'GEMINI' or 'CLAUDE', got '${reviewer}'`)
  }

  const blindPacketSha256 = sha256(blindPacketBytes)
  const reviewerPromptSha256 = sha256(promptText)
  const materialityPolicySha256 = sha256(materialityPolicyBytes)

  const payloadHeader = [
    `# MOVIE MOOD V8.2 — PRELIMINARY ADVISORY REVIEW`,
    `Reviewer: ${reviewer}`,
    `Review Sequence Index: ${reviewSequenceIndex}`,
    `Candidate ID: ${candidateId}`,
    `Blind Packet SHA-256: ${blindPacketSha256}`,
    `Prompt SHA-256: ${reviewerPromptSha256}`,
    `Materiality Policy SHA-256: ${materialityPolicySha256}`,
    `------------------------------------------------------------`,
  ].join('\n')

  const copyReadyText = `${payloadHeader}\n\n${promptText}\n\n## REVIEW PACKET\n\n${blindPacketBytes.toString('utf8')}`
  const payloadSha256 = sha256(copyReadyText)

  return {
    candidateId,
    reviewer,
    reviewSequenceIndex,
    blindPacketSha256,
    reviewerPromptSha256,
    materialityPolicySha256,
    copyReadyText,
    payloadSha256,
  }
}

/**
 * Simulates raw response ingestion with immutable raw persistence before validation.
 */
export function simulateRawResponseIngestion({
  candidateId,
  reviewer,
  rawResponseText,
  visibleModelLabel = null,
  attemptOrdinal = 1,
  submissionTimestamp = new Date().toISOString(),
  ingestionTimestamp = new Date().toISOString(),
  blindPacketSha256,
  reviewPromptSha256,
  materialityPolicySha256,
}) {
  if (!rawResponseText || typeof rawResponseText !== 'string') {
    throw new Error('INVALID_RAW_RESPONSE: Raw response text is required')
  }

  // Step 1: Raw bytes and hash computed BEFORE any parsing, trimming, or cleanup
  const rawBytes = Buffer.from(rawResponseText, 'utf8')
  const rawResponseSha256 = sha256(rawBytes)

  const rawRecord = {
    candidateId,
    reviewer,
    channel: 'MANUAL_CONSUMER_UI',
    service: reviewer === 'GEMINI' ? 'Gemini' : 'Claude',
    visibleModelLabel: visibleModelLabel || null,
    modelIdentityStatus: visibleModelLabel ? 'EXPOSED' : 'UNKNOWN_NOT_EXPOSED',
    submissionTimestamp,
    ingestionTimestamp,
    blindPacketSha256,
    reviewPromptSha256,
    materialityPolicySha256,
    rawResponse: rawResponseText,
    rawResponseSha256,
    attemptOrdinal,
  }

  // Step 2: Attempt parsing after raw record is created
  let parsedOpinion = null
  let validationResult = { valid: false, error: null }

  try {
    const trimmed = rawResponseText.trim()
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : trimmed
    parsedOpinion = JSON.parse(jsonStr)
    validationResult = { valid: true, error: null }
  } catch (err) {
    validationResult = { valid: false, error: 'MALFORMED_JSON', message: err.message }
  }

  return {
    rawRecord,
    parsedOpinion,
    validationResult,
  }
}

/**
 * Deterministic Final Evaluation Cohort Construction (Exact N=60)
 */
export function constructFinalEvaluationCohort(completedRecords) {
  const cleanRecords = completedRecords.filter((r) => r.correctedDecision === 'APPROVE')
  const defectRecords = completedRecords.filter((r) => r.correctedDecision === 'REVISE')
  const severeDefectRecords = defectRecords.filter((r) => r.correctedSeverity === 'SEVERE')

  if (cleanRecords.length < 30) {
    throw new Error(`INSUFFICIENT_CLEAN_RECORDS: Need at least 30, got ${cleanRecords.length}`)
  }
  if (defectRecords.length < 30) {
    throw new Error(`INSUFFICIENT_DEFECT_RECORDS: Need at least 30, got ${defectRecords.length}`)
  }
  if (severeDefectRecords.length < 6) {
    throw new Error(`INSUFFICIENT_SEVERE_RECORDS: Need at least 6 severe defect cases, got ${severeDefectRecords.length}`)
  }

  const selectedClean = cleanRecords
    .slice()
    .sort((a, b) => a.reviewSequenceIndex - b.reviewSequenceIndex)
    .slice(0, 30)

  const sortedDefect = defectRecords
    .slice()
    .sort((a, b) => a.reviewSequenceIndex - b.reviewSequenceIndex)

  const baseDefect30 = sortedDefect.slice(0, 30)
  const severeInBase = baseDefect30.filter((r) => r.correctedSeverity === 'SEVERE')

  let selectedDefect
  if (severeInBase.length >= 6) {
    selectedDefect = baseDefect30
  } else {
    const neededSevere = 6 - severeInBase.length
    const subsequentSevere = sortedDefect.slice(30).filter((r) => r.correctedSeverity === 'SEVERE')

    if (subsequentSevere.length < neededSevere) {
      throw new Error(
        `STRATIFICATION_EXHAUSTION: Needed ${neededSevere} additional severe defect records, but only found ${subsequentSevere.length} in remaining pool`
      )
    }

    const severeToAdd = subsequentSevere.slice(0, neededSevere)
    const nonSevereInBase = baseDefect30.filter((r) => r.correctedSeverity !== 'SEVERE')
    const toReplace = new Set(
      nonSevereInBase.slice(-neededSevere).map((r) => r.candidateId)
    )

    selectedDefect = baseDefect30
      .filter((r) => !toReplace.has(r.candidateId))
      .concat(severeToAdd)
      .sort((a, b) => a.reviewSequenceIndex - b.reviewSequenceIndex)
  }

  const finalRecords = [...selectedClean, ...selectedDefect].sort(
    (a, b) => a.reviewSequenceIndex - b.reviewSequenceIndex
  )

  const severeFinalCount = selectedDefect.filter((r) => r.correctedSeverity === 'SEVERE').length

  return {
    strategy: 'PREREGISTERED_SEVERITY_STRATIFIED_FINAL_EVALUATION_COHORT_CONSTRUCTION',
    totalCohortN: finalRecords.length,
    cleanCount: selectedClean.length,
    defectPositiveCount: selectedDefect.length,
    severeDefectPositiveCount: severeFinalCount,
    cohortRecords: finalRecords,
    selectedCleanIds: selectedClean.map((r) => r.candidateId),
    selectedDefectIds: selectedDefect.map((r) => r.candidateId),
  }
}

/**
 * Deterministic Second-Review QA Selection & Expansion Algorithm
 */
export function selectQaCandidates({
  completedAdjudications,
  previouslyAuditedQaIds = new Set(),
  seedSha256Hex,
}) {
  const severe = completedAdjudications
    .filter((r) => r.finalSeverity === 'SEVERE')
    .map((r) => r.candidateId)

  const nonSevere = completedAdjudications
    .filter((r) => r.finalSeverity !== 'SEVERE')

  const targetNonSevereCount = Math.ceil(0.25 * nonSevere.length)

  const rankedNonSevere = nonSevere.map((candidate) => {
    const hash = crypto
      .createHash('sha256')
      .update(seedSha256Hex + '\n' + candidate.candidateId)
      .digest('hex')
    return {
      candidateId: candidate.candidateId,
      rankScore: hash,
    }
  })

  rankedNonSevere.sort((a, b) => {
    const cmp = a.rankScore.localeCompare(b.rankScore)
    return cmp !== 0 ? cmp : a.candidateId.localeCompare(b.candidateId)
  })

  const selectedNonSevere = new Set()
  for (const item of rankedNonSevere) {
    if (previouslyAuditedQaIds.has(item.candidateId)) {
      selectedNonSevere.add(item.candidateId)
    }
  }

  for (const item of rankedNonSevere) {
    if (selectedNonSevere.size >= targetNonSevereCount) break
    selectedNonSevere.add(item.candidateId)
  }

  const allQaIds = new Set([...severe, ...selectedNonSevere])

  return {
    totalQaCount: allQaIds.size,
    severeCount: severe.length,
    nonSevereCount: selectedNonSevere.size,
    targetNonSevereCount,
    allQaCandidateIds: Array.from(allQaIds),
    selectedNonSevereCandidateIds: Array.from(selectedNonSevere),
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE: MECHANICAL VALIDATION OF P2.3 MANUAL ADVISORY INGESTION
// ---------------------------------------------------------------------------

test('1. P2.3 Manual Advisory Protocol artifact exists and declares READY_FOR_FREEZE', () => {
  const protocolPath = path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json')
  assert.ok(fs.existsSync(protocolPath), 'p2-3-live-operation-protocol.v1.json must exist')
  const content = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(content.schemaVersion, 'p2-3-live-operation-protocol.v1')
  assert.equal(content.activity, 'VERIFIER_V14_P2_3_MANUAL_ADVISORY_INGESTION_REGISTRATION')
  assert.equal(content.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
  assert.equal(content.p23PreregistrationStatus, 'READY_FOR_FREEZE')
  assert.equal(content.candidate1ExecutionAuthorized, false)
})

test('2. No API endpoint, token, pricing, or credential env fields remain in P2.3 protocol', () => {
  const protocolText = fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  assert.ok(!protocolText.includes('ANTHROPIC_API_KEY'), 'ANTHROPIC_API_KEY must be deleted')
  assert.ok(!protocolText.includes('GEMINI_API_KEY'), 'GEMINI_API_KEY must be deleted')
  assert.ok(!protocolText.includes('endpointBaseUrl'), 'endpointBaseUrl must be deleted')
  assert.ok(!protocolText.includes('HTTP_TRANSIENT_FAILURE'), 'HTTP_TRANSIENT_FAILURE must be deleted')
  assert.ok(!protocolText.includes('TRANSPORT_TIMEOUT'), 'TRANSPORT_TIMEOUT must be deleted')
  assert.ok(!protocolText.includes('AMBIGUOUS_REMOTE_EXECUTION'), 'AMBIGUOUS_REMOTE_EXECUTION must be deleted')
  assert.ok(!protocolText.includes('studyWideModelCallCeiling'), 'Automated call ceiling must be deleted')
})

test('3. Gemini and Claude channels are registered as MANUAL_CONSUMER_UI with UNKNOWN_NOT_EXPOSED model fallback', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const gemini = protocol.manualAdvisoryChannels.gemini
  const claude = protocol.manualAdvisoryChannels.claude

  assert.equal(gemini.channel, 'MANUAL_CONSUMER_UI')
  assert.equal(gemini.service, 'Gemini')
  assert.equal(gemini.fallbackModelIdentity, 'UNKNOWN_NOT_EXPOSED')
  assert.equal(gemini.advisoryRole, 'PRELIMINARY_ADVISORY_ONLY')

  assert.equal(claude.channel, 'MANUAL_CONSUMER_UI')
  assert.equal(claude.service, 'Claude')
  assert.equal(claude.accountTier, 'FREE')
  assert.equal(claude.fallbackModelIdentity, 'UNKNOWN_NOT_EXPOSED')
  assert.equal(claude.advisoryRole, 'PRELIMINARY_ADVISORY_ONLY')
})

test('4. Deterministic copy-ready review payload cryptographically binds packet, prompt, and policy', () => {
  const candidateId = 'exp100-tmdb-672647'
  const mockPacket = Buffer.from(JSON.stringify({ candidateId, facts: { overview: 'A classic film.' } }))
  const promptText = 'FROZEN PRELIMINARY PROMPT TEXT'
  const policyBytes = Buffer.from('A_PRIME_PRODUCTION_MATERIALITY_V1_BYTES')

  const payload = buildCopyReadyPayload({
    candidateId,
    blindPacketBytes: mockPacket,
    promptText,
    reviewer: 'GEMINI',
    reviewSequenceIndex: 1,
    materialityPolicyBytes: policyBytes,
  })

  assert.equal(payload.candidateId, candidateId)
  assert.equal(payload.reviewer, 'GEMINI')
  assert.equal(payload.reviewSequenceIndex, 1)
  assert.equal(payload.blindPacketSha256, sha256(mockPacket))
  assert.equal(payload.reviewerPromptSha256, sha256(promptText))
  assert.equal(payload.materialityPolicySha256, sha256(policyBytes))

  // Altering one character in prompt text changes the payload hash
  const alteredPayload = buildCopyReadyPayload({
    candidateId,
    blindPacketBytes: mockPacket,
    promptText: promptText + '!',
    reviewer: 'GEMINI',
    reviewSequenceIndex: 1,
    materialityPolicyBytes: policyBytes,
  })
  assert.notEqual(payload.payloadSha256, alteredPayload.payloadSha256)
  assert.notEqual(payload.reviewerPromptSha256, alteredPayload.reviewerPromptSha256)
})

test('5. Raw manual response persistence precedes validation without premature normalization', () => {
  const rawTextWithWhitespace = '   \n```json\n{"preliminaryDecision": "APPROVE", "advisoryOnly": true}\n```\n   '
  const candidateId = 'exp100-tmdb-672647'
  const packetSha = sha256('packet')
  const promptSha = sha256('prompt')
  const policySha = sha256('policy')

  const ingested = simulateRawResponseIngestion({
    candidateId,
    reviewer: 'CLAUDE',
    rawResponseText: rawTextWithWhitespace,
    blindPacketSha256: packetSha,
    reviewPromptSha256: promptSha,
    materialityPolicySha256: policySha,
  })

  // Raw response stores exact un-trimmed bytes
  assert.equal(ingested.rawRecord.rawResponse, rawTextWithWhitespace)
  assert.equal(ingested.rawRecord.rawResponseSha256, sha256(rawTextWithWhitespace))
  assert.equal(ingested.rawRecord.modelIdentityStatus, 'UNKNOWN_NOT_EXPOSED')
  assert.equal(ingested.validationResult.valid, true)
})

test('6. Manual retry policy allows max 2 model attempts for MALFORMED_JSON / SCHEMA_INVALID and 0 for BINDING_INVALID', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const rp = protocol.manualRetryPolicy
  assert.equal(rp.maxModelGeneratedAttemptsPerReviewerPerCandidate, 2)
  assert.equal(rp.categories.MALFORMED_JSON.retryAllowed, true)
  assert.equal(rp.categories.MALFORMED_JSON.maxAdditionalModelGeneratedAttempts, 1)
  assert.equal(rp.categories.SCHEMA_INVALID.retryAllowed, true)
  assert.equal(rp.categories.SCHEMA_INVALID.maxAdditionalModelGeneratedAttempts, 1)
  assert.equal(rp.categories.BINDING_INVALID.retryAllowed, false)
  assert.equal(rp.categories.BINDING_INVALID.action, 'HARD_STOP')
  assert.equal(rp.categories.SERVICE_UNAVAILABLE_OR_RATE_LIMITED.retryAllowed, false)
  assert.equal(rp.categories.SERVICE_UNAVAILABLE_OR_RATE_LIMITED.action, 'PAUSE')
})

test('7. USER_COPY_OR_INGEST_ERROR is distinguished from model semantic failure', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const cp = protocol.copyOrIngestErrorPolicy
  assert.equal(cp.category, 'USER_COPY_OR_INGEST_ERROR')
  assert.ok(cp.remedyRule.includes('without consuming the model semantic retry allowance'))
  assert.ok(cp.antiAbuseRule.includes('Must NOT be used to excuse malformed JSON'))
})

test('8. BOTH_PRELIMINARY_ADVISORIES_REQUIRED_BEFORE_PRIMARY_HUMAN_ADJUDICATION is preserved', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const bar = protocol.bothAdvisoriesRequiredPolicy
  assert.equal(bar.rule, 'BOTH_PRELIMINARY_ADVISORIES_REQUIRED_BEFORE_PRIMARY_HUMAN_ADJUDICATION')
  assert.equal(bar.pauseStatus, 'REVIEW_PAUSED_PENDING_ADVISORY')
  assert.equal(bar.singleAdvisoryAdjudicationForbidden, true)
})

test('9. All referenced P1, P2.1, and P2.2 cryptographic hashes match actual disk bytes', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const b = protocol.frozenLineageBindings

  const p1Prompt = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md'))
  assert.equal(sha256(p1Prompt), b.p1PromptSha256)

  const p1Protocol = fs.readFileSync(path.join(p2Dir, 'protocol.v1.json'))
  assert.equal(sha256(p1Protocol), b.p1ProtocolSha256)

  const p21Manifest = fs.readFileSync(path.join(p2Dir, 'p2-1-freeze-manifest.v1.json'))
  assert.equal(sha256(p21Manifest), b.p21FreezeManifestSha256)

  const p21Order = fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'))
  assert.equal(sha256(p21Order), b.p21ReviewOrderSha256)

  const p21Protocol = fs.readFileSync(path.join(p2Dir, 'p2-1-protocol.v1.json'))
  assert.equal(sha256(p21Protocol), b.p21ProtocolSha256)

  const p22Manifest = fs.readFileSync(path.join(p2Dir, 'p2-2-freeze-manifest.v1.json'))
  assert.equal(sha256(p22Manifest), b.p22FreezeManifestSha256)
  assert.equal(
    sha256(p22Manifest),
    'sha256:2e6112da08f8e4db880cb546447b86bf0be9f4cd36ec31ac5d937e646b158070'
  )

  const p22Protocol = fs.readFileSync(path.join(p2Dir, 'p2-2-protocol.v1.json'))
  assert.equal(sha256(p22Protocol), b.p22ProtocolSha256)

  const geminiPrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-gemini-preliminary.v1.md'))
  assert.equal(sha256(geminiPrompt), b.geminiPromptSha256)

  const claudePrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-claude-preliminary.v1.md'))
  assert.equal(sha256(claudePrompt), b.claudePromptSha256)

  const materialityPolicy = fs.readFileSync(
    path.join(
      repoRoot,
      'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-materiality-policy.v1.json'
    )
  )
  assert.equal(sha256(materialityPolicy), b.materialityPolicySha256)
})

test('10. Exact provisional stopping thresholds are registered as CLEAN >= 30, DEFECT >= 30, SEVERE >= 6', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const sc = protocol.provisionalStoppingAndQaContinuation.stoppingCriteria
  assert.equal(sc.minClean, 30)
  assert.equal(sc.minDefectPositive, 30)
  assert.equal(sc.minSevereDefectPositive, 6)
})

test('11. Deterministic final cohort algorithm produces exact N=60 without cherry-picking', () => {
  const mockPool = []
  let seq = 1

  for (let i = 1; i <= 40; i++) {
    mockPool.push({
      candidateId: `clean-${i}`,
      reviewSequenceIndex: seq++,
      correctedDecision: 'APPROVE',
      correctedSeverity: null,
    })
  }

  for (let i = 1; i <= 40; i++) {
    const isSevere = [5, 10, 15, 20, 25, 30, 35, 40].includes(i)
    mockPool.push({
      candidateId: `defect-${i}`,
      reviewSequenceIndex: seq++,
      correctedDecision: 'REVISE',
      correctedSeverity: isSevere ? 'SEVERE' : 'MINOR',
    })
  }

  const cohort = constructFinalEvaluationCohort(mockPool)
  assert.equal(cohort.totalCohortN, 60)
  assert.equal(cohort.cleanCount, 30)
  assert.equal(cohort.defectPositiveCount, 30)
  assert.ok(cohort.severeDefectPositiveCount >= 6)
  assert.equal(cohort.selectedCleanIds[0], 'clean-1')
  assert.equal(cohort.selectedCleanIds[29], 'clean-30')
  assert.equal(cohort.selectedDefectIds[0], 'defect-1')
  assert.equal(cohort.selectedDefectIds[29], 'defect-30')
})

test('12. Deterministic final cohort algorithm handles severe shortfall via preregistered stratification', () => {
  const mockPool = []
  let seq = 1

  for (let i = 1; i <= 35; i++) {
    mockPool.push({
      candidateId: `clean-${i}`,
      reviewSequenceIndex: seq++,
      correctedDecision: 'APPROVE',
      correctedSeverity: null,
    })
  }

  for (let i = 1; i <= 35; i++) {
    const isSevere = [10, 20, 31, 32, 33, 34].includes(i)
    mockPool.push({
      candidateId: `defect-${i}`,
      reviewSequenceIndex: seq++,
      correctedDecision: 'REVISE',
      correctedSeverity: isSevere ? 'SEVERE' : 'MINOR',
    })
  }

  const cohort = constructFinalEvaluationCohort(mockPool)
  assert.equal(cohort.totalCohortN, 60)
  assert.equal(cohort.cleanCount, 30)
  assert.equal(cohort.defectPositiveCount, 30)
  assert.equal(cohort.severeDefectPositiveCount, 6)

  assert.ok(!cohort.selectedDefectIds.includes('defect-30'))
  assert.ok(!cohort.selectedDefectIds.includes('defect-29'))
  assert.ok(!cohort.selectedDefectIds.includes('defect-28'))
  assert.ok(!cohort.selectedDefectIds.includes('defect-27'))
  assert.ok(cohort.selectedDefectIds.includes('defect-31'))
  assert.ok(cohort.selectedDefectIds.includes('defect-32'))
  assert.ok(cohort.selectedDefectIds.includes('defect-33'))
  assert.ok(cohort.selectedDefectIds.includes('defect-34'))
})

test('13. Deterministic QA expansion retains previously audited records and expands predictably', () => {
  const seedHex = 'b20227e977b450a8639dfa1890b2031db543ee0ff4dc3359721c338295e3ab16'

  const poolRound1 = []
  for (let i = 1; i <= 6; i++) {
    poolRound1.push({ candidateId: `cand-severe-${i}`, finalSeverity: 'SEVERE' })
  }
  for (let i = 1; i <= 59; i++) {
    poolRound1.push({ candidateId: `cand-nonsevere-${i}`, finalSeverity: 'MINOR' })
  }

  const qaRound1 = selectQaCandidates({
    completedAdjudications: poolRound1,
    previouslyAuditedQaIds: new Set(),
    seedSha256Hex: seedHex,
  })

  assert.equal(qaRound1.severeCount, 6)
  assert.equal(qaRound1.targetNonSevereCount, Math.ceil(0.25 * 59))
  assert.equal(qaRound1.nonSevereCount, 15)
  assert.equal(qaRound1.totalQaCount, 21)

  const poolRound2 = [...poolRound1]
  poolRound2.push({ candidateId: 'cand-severe-7', finalSeverity: 'SEVERE' })
  for (let i = 60; i <= 73; i++) {
    poolRound2.push({ candidateId: `cand-nonsevere-${i}`, finalSeverity: 'MINOR' })
  }

  const qaRound2 = selectQaCandidates({
    completedAdjudications: poolRound2,
    previouslyAuditedQaIds: new Set(qaRound1.selectedNonSevereCandidateIds),
    seedSha256Hex: seedHex,
  })

  assert.equal(qaRound2.severeCount, 7)
  assert.equal(qaRound2.targetNonSevereCount, Math.ceil(0.25 * 73))
  assert.equal(qaRound2.nonSevereCount, 19)

  for (const prevId of qaRound1.selectedNonSevereCandidateIds) {
    assert.ok(
      qaRound2.selectedNonSevereCandidateIds.includes(prevId),
      `Previously audited candidate ${prevId} must remain in QA set`
    )
  }
})

test('14. Candidate #1 pilot strictly matches frozen review order entry 1 with 17 explicit manual steps', () => {
  const protocol = JSON.parse(
    fs.readFileSync(path.join(p2Dir, 'p2-3-live-operation-protocol.v1.json'), 'utf8')
  )
  const orderDoc = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
  const firstOrderEntry = orderDoc.orderedCandidates[0]

  assert.equal(firstOrderEntry.reviewSequenceIndex, 1)
  assert.equal(firstOrderEntry.candidateId, protocol.candidate1PilotProtocol.candidateId)
  assert.equal(protocol.candidate1PilotProtocol.candidateId, 'exp100-tmdb-672647')
  assert.equal(protocol.candidate1PilotProtocol.automaticContinuationToCandidate2Forbidden, true)
  assert.equal(protocol.candidate1PilotProtocol.candidate1IsRealGroundTruth, true)
  assert.equal(protocol.candidate1PilotProtocol.executionSteps.length, 17)
})

test('15. P2.2 frozen files remain unmodified', () => {
  const p22ManifestPath = path.join(p2Dir, 'p2-2-freeze-manifest.v1.json')
  const p22ManifestSha = sha256(fs.readFileSync(p22ManifestPath))
  assert.equal(
    p22ManifestSha,
    'sha256:2e6112da08f8e4db880cb546447b86bf0be9f4cd36ec31ac5d937e646b158070'
  )

  const p22ProtocolSha = sha256(fs.readFileSync(path.join(p2Dir, 'p2-2-protocol.v1.json')))
  assert.equal(
    p22ProtocolSha,
    'sha256:ae9a2e24b64819f21f12fb3bf70ceeaeec6175c66bd9cf6b6605255d1416818b'
  )
})
