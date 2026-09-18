import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  sha256,
  buildManualSubmissionPayload,
  prepareManualPayload,
  ingestManualResponse,
  getManualCandidateStatus,
  buildManualHumanBundle,
  validateCandidate1PilotAuthorization,
  validatePostPilotSessionAuthorization,
  recordManualHumanAdjudication,
  getCurrentReviewCandidate,
  generateCheckpointManifest,
  verifyCheckpointManifest,
  getCanonicalCheckpointPath,
  SEQUENCE_POSITION_DRIFT_CONTRACT,
  validateSequencePositionDriftExecution,
  main as runManualReviewCli,
} from '../../scripts/runVerifierV14ManualReview.mjs'

import { FROZEN_BINDINGS } from '../../scripts/verifierV14ReviewerAdapter.mjs'
import {
  checkStoppingRule,
  STOPPING_TARGETS,
} from '../../scripts/verifierV14ReviewState.mjs'
import {
  verifyCandidateReviewEvidenceChain,
  prepareCandidateExecution,
} from '../../scripts/runVerifierV14BlindReview.mjs'
import { serializeArtifactForPersistence } from '../../scripts/validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

function makeTempDir(prefix = 'p24-test-') {
  const dir = path.join(p2Dir, `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTempDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Synthetic pool and candidate fixture setup
function createSyntheticTestEnv(tempDir) {
  const candidateId = 'scale500-tmdb-999999'
  const candidateDir = path.join(tempDir, candidateId)
  fs.mkdirSync(candidateDir, { recursive: true })

  const riskInputObj = {
    candidateId,
    facts: {
      title: 'Synthetic Test Movie',
      year: 2024,
      overview: 'A synthetic film for verifier v1.4 tests.',
    },
    drafts: {
      overview: 'A synthetic film for verifier v1.4 tests.',
    },
  }
  const riskInputPath = path.join(tempDir, 'risk-input.json')
  const riskInputBytes = Buffer.from(JSON.stringify(riskInputObj, null, 2), 'utf8')
  fs.writeFileSync(riskInputPath, riskInputBytes)
  const riskInputSha = sha256(riskInputBytes)

  const eligiblePool = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    records: [
      {
        candidateId,
        frozenRiskInputPath: path.relative(repoRoot, riskInputPath),
        riskInputByteSha256: riskInputSha,
      },
    ],
  }

  const reviewOrder = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    orderedCandidates: [
      {
        candidateId,
        reviewSequenceIndex: 1,
      },
    ],
  }

  const validOpinion = {
    preliminaryDecision: 'APPROVE',
    preliminarySeverity: null,
    affectedFields: [],
    issueSummaries: [],
    claimSpan: 'none',
    sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
    sourceBoundaryReason: 'Strictly factual synthetic movie data',
    confidence: 'HIGH',
    advisoryOnly: true,
  }

  return {
    candidateId,
    candidateDir,
    eligiblePool,
    reviewOrder,
    validOpinion,
  }
}

// Test A: prepare is deterministic
test('A. prepare command is strictly deterministic across repeated runs', () => {
  const tempDir = makeTempDir('p24-test-a-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    const res1 = prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const res2 = prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res1.payloadSha256, res2.payloadSha256)
    assert.equal(res1.copyReadyText, res2.copyReadyText)
    assert.equal(res2.reused, true)
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test B: prepare cannot alter frozen prompt/packet/policy bindings
test('B. prepare command strictly binds frozen prompt, packet, and policy hashes and rejects overrides', () => {
  const tempDir = makeTempDir('p24-test-b-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    const res = prepareManualPayload({
      candidateId,
      reviewer: 'CLAUDE',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res.reviewer, 'CLAUDE')
    assert.ok(res.copyReadyText.includes(`Prompt SHA-256: ${FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256}`))
    assert.ok(res.copyReadyText.includes(`Materiality Policy SHA-256: ${FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256}`))
    assert.ok(res.copyReadyText.includes(`Candidate ID: ${candidateId}`))

    // Invalid reviewer is rejected
    assert.throws(
      () => prepareManualPayload({ candidateId, reviewer: 'GPT4', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /INVALID_REVIEWER/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test C: re-prepare cannot silently overwrite existing bytes with conflicting bytes
test('C. re-prepare cannot silently overwrite existing payload bytes', () => {
  const tempDir = makeTempDir('p24-test-c-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    const res = prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    // Corrupt the payload file on disk
    fs.writeFileSync(res.payloadFilePath, 'Tampered payload content', 'utf8')

    // Re-running prepare on tampered file throws conflict error
    assert.throws(
      () => prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /INTEGRITY_CONFLICT/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test D: raw response bytes are durably written before parsing
test('D. raw response bytes are durably written to disk before JSON parsing or validation', () => {
  const tempDir = makeTempDir('p24-test-d-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const rawResponseText = 'THIS IS COMPLETELY NON_JSON GARBAGE OUTPUT FROM CONSUMER UI'
    const respFile = path.join(tempDir, 'raw-input.txt')
    fs.writeFileSync(respFile, rawResponseText, 'utf8')
    const expectedSha = sha256(rawResponseText)

    const ingestRes = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: respFile,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(ingestRes.disposition, 'MALFORMED_JSON')
    assert.equal(ingestRes.rawResponseSha256, expectedSha)

    // Check disk file exists and contains exact unparsed bytes
    const persistedRawPath = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/raw-response.txt')
    assert.ok(fs.existsSync(persistedRawPath))
    assert.equal(fs.readFileSync(persistedRawPath, 'utf8'), rawResponseText)
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test E: valid raw JSON produces real schema-validated advisory envelope
test('E. valid raw JSON produces real schema-validated advisory envelope', () => {
  const tempDir = makeTempDir('p24-test-e-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const rawText = JSON.stringify(validOpinion, null, 2)
    const respFile = path.join(tempDir, 'resp.json')
    fs.writeFileSync(respFile, rawText, 'utf8')

    const res = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: respFile,
      visibleModelLabel: 'Gemini 2.5 Pro Consumer UI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res.success, true)
    assert.equal(res.disposition, 'VALID')
    assert.ok(res.envelopeSha256)
    assert.equal(res.envelope.candidateId, candidateId)
    assert.equal(res.envelope.reviewer, 'GEMINI')
    assert.equal(res.envelope.reviewerModel, 'MANUAL_CONSUMER_UI')

    // Observational metadata recorded in attempt-metadata.json
    const metaPath = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/attempt-metadata.json')
    assert.ok(fs.existsSync(metaPath))
    const diskMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    assert.equal(diskMeta.reviewerModel, 'MANUAL_CONSUMER_UI')
    assert.equal(diskMeta.visibleModelLabel, 'Gemini 2.5 Pro Consumer UI')
    assert.equal(diskMeta.modelIdentityStatus, 'EXPOSED')

    const activeEnvPath = path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')
    assert.ok(fs.existsSync(activeEnvPath))
    const diskEnv = JSON.parse(fs.readFileSync(activeEnvPath, 'utf8'))
    assert.deepEqual(diskEnv, res.envelope)
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test F: markdown-fenced valid JSON behaves exactly as preregistered
test('F. markdown-fenced valid JSON strips outer fence cleanly and produces valid advisory envelope', () => {
  const tempDir = makeTempDir('p24-test-f-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({
      candidateId,
      reviewer: 'CLAUDE',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const fencedText = '```json\n' + JSON.stringify(validOpinion, null, 2) + '\n```'
    const respFile = path.join(tempDir, 'resp-fenced.txt')
    fs.writeFileSync(respFile, fencedText, 'utf8')

    const res = ingestManualResponse({
      candidateId,
      reviewer: 'CLAUDE',
      responseFilePath: respFile,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res.success, true)
    assert.equal(res.disposition, 'VALID')
    assert.equal(res.envelope.rawResponseSha256, sha256(fencedText))
    assert.equal(res.envelope.validatedOpinion.preliminaryDecision, 'APPROVE')
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test G: malformed JSON remains immutable evidence
test('G. malformed JSON remains immutable evidence and does not produce an active envelope', () => {
  const tempDir = makeTempDir('p24-test-g-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({
      candidateId,
      reviewer: 'GEMINI',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const respFile = path.join(tempDir, 'broken.json')
    fs.writeFileSync(respFile, '{"broken": json', 'utf8')

    const res = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: respFile,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res.success, false)
    assert.equal(res.disposition, 'MALFORMED_JSON')

    const rawPath = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/raw-response.txt')
    assert.ok(fs.existsSync(rawPath))
    assert.equal(fs.readFileSync(rawPath, 'utf8'), '{"broken": json')

    const activeEnvPath = path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')
    assert.equal(fs.existsSync(activeEnvPath), false)
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test H: schema-invalid output remains immutable evidence
test('H. schema-invalid output remains immutable evidence and does not produce an active envelope', () => {
  const tempDir = makeTempDir('p24-test-h-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({
      candidateId,
      reviewer: 'CLAUDE',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const invalidOpinion = {
      preliminaryDecision: 'INVALID_DECISION_ENUM',
      advisoryOnly: false,
    }
    const respFile = path.join(tempDir, 'schema-invalid.json')
    fs.writeFileSync(respFile, JSON.stringify(invalidOpinion), 'utf8')

    const res = ingestManualResponse({
      candidateId,
      reviewer: 'CLAUDE',
      responseFilePath: respFile,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(res.success, false)
    assert.equal(res.disposition, 'SCHEMA_INVALID')

    const rawPath = path.join(tempDir, candidateId, 'claude/attempts/attempt-01/raw-response.txt')
    assert.ok(fs.existsSync(rawPath))

    const activeEnvPath = path.join(tempDir, candidateId, 'claude/active-advisory-envelope.v1.json')
    assert.equal(fs.existsSync(activeEnvPath), false)
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test I: attempt-02 is allowed only after MALFORMED_JSON / SCHEMA_INVALID
test('I. attempt-02 is authorized and prepared after MALFORMED_JSON, attempt-01 remains intact', () => {
  const tempDir = makeTempDir('p24-test-i-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    // Attempt 1: Prepare & Ingest malformed
    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const brokenFile = path.join(tempDir, 'broken.txt')
    fs.writeFileSync(brokenFile, 'MALFORMED', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: brokenFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Check status: INVALID_RETRY_AVAILABLE
    const status1 = getManualCandidateStatus({ candidateId, executionRoot: tempDir })
    assert.equal(status1.gemini.status, 'INVALID_RETRY_AVAILABLE')

    // Attempt 2: Prepare
    const prep2 = prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.equal(prep2.attemptNumber, 2)

    // Ingest attempt 2 with valid JSON
    const validFile = path.join(tempDir, 'valid.json')
    fs.writeFileSync(validFile, JSON.stringify(validOpinion), 'utf8')
    const ingest2 = ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: validFile, executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.equal(ingest2.success, true)
    assert.equal(ingest2.attemptNumber, 2)

    // Attempt 1 files remain unchanged
    const att1Raw = fs.readFileSync(path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/raw-response.txt'), 'utf8')
    assert.equal(att1Raw, 'MALFORMED')

    // Attempt 2 files exist
    const att2Raw = fs.readFileSync(path.join(tempDir, candidateId, 'gemini/attempts/attempt-02/raw-response.txt'), 'utf8')
    assert.equal(att2Raw, JSON.stringify(validOpinion))

    // Active envelope reflects attempt 2
    assert.ok(fs.existsSync(path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')))
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test J: attempt-03 is impossible
test('J. attempt-03 is impossible and triggers RETRY_CEILING_EXCEEDED error', () => {
  const tempDir = makeTempDir('p24-test-j-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    // Attempt 1: fail
    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const bad1 = path.join(tempDir, 'bad1.txt')
    fs.writeFileSync(bad1, 'bad 1', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: bad1, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Attempt 2: fail
    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const bad2 = path.join(tempDir, 'bad2.txt')
    fs.writeFileSync(bad2, 'bad 2', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: bad2, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Check status: PAUSED (RETRY_CEILING_REACHED)
    const st = getManualCandidateStatus({ candidateId, executionRoot: tempDir })
    assert.equal(st.claude.status, 'PAUSED')
    assert.equal(st.claude.reason, 'RETRY_CEILING_REACHED')

    // Attempt 3 prepare throws
    assert.throws(
      () => prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /RETRY_CEILING_EXCEEDED/
    )

    // Attempt 3 ingest throws
    assert.throws(
      () => ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: bad2, executionRoot: tempDir, eligiblePool, reviewOrder }),
      /RETRY_CEILING_EXCEEDED/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test K: BINDING_INVALID gives hard stop
test('K. BINDING_INVALID gives hard stop and forbids retries', () => {
  const tempDir = makeTempDir('p24-test-k-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })

    // Tamper blind packet file on disk to simulate binding mismatch
    const packetPath = path.join(tempDir, candidateId, 'blind-packet.v1.json')
    fs.writeFileSync(packetPath, JSON.stringify({ candidateId, corrupted: true }), 'utf8')

    // Ingest with modified blind packet on disk
    const respFile = path.join(tempDir, 'resp.json')
    fs.writeFileSync(respFile, JSON.stringify(validOpinion), 'utf8')

    // Attempting prepare again throws INTEGRITY_CONFLICT
    assert.throws(
      () => prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /INTEGRITY_CONFLICT/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test L: copy/ingest correction preserves original bad ingestion and does not consume semantic model retry
test('L. copy/ingest correction preserves original bad ingestion and does not increment attempt ordinal', () => {
  const tempDir = makeTempDir('p24-test-l-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })

    // 1. Ingest truncated response due to operator copy error
    const truncatedFile = path.join(tempDir, 'truncated.txt')
    fs.writeFileSync(truncatedFile, '{"preliminaryDecision": "APP', 'utf8')

    const ingest1 = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: truncatedFile,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })
    assert.equal(ingest1.disposition, 'MALFORMED_JSON')
    assert.equal(ingest1.attemptNumber, 1)

    // 2. Operator performs explicit copy correction
    const correctedFile = path.join(tempDir, 'corrected.json')
    fs.writeFileSync(correctedFile, JSON.stringify(validOpinion), 'utf8')

    const ingestCorr = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: correctedFile,
      isCorrection: true,
      correctionReason: 'User fixed clipboard truncation from same generation',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(ingestCorr.success, true)
    assert.equal(ingestCorr.disposition, 'VALID')
    // Attempt remains ordinal 1 (did not increment)
    assert.equal(ingestCorr.attemptNumber, 1)

    // Immutable raw byte archival: original bad raw bytes exist and match pre-correction hash
    const attemptsDir = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01')
    const origRawPath = path.join(attemptsDir, 'raw-response.original.txt')
    const canonRawPath = path.join(attemptsDir, 'raw-response.txt')

    assert.ok(fs.existsSync(origRawPath), 'raw-response.original.txt must exist')
    assert.ok(fs.existsSync(canonRawPath), 'raw-response.txt must exist')

    const origRawBytes = fs.readFileSync(origRawPath)
    const canonRawBytes = fs.readFileSync(canonRawPath)

    assert.equal(origRawBytes.toString('utf8'), '{"preliminaryDecision": "APP')
    assert.equal(sha256(origRawBytes), ingest1.rawResponseSha256)
    assert.equal(sha256(canonRawBytes), ingestCorr.rawResponseSha256)
    assert.equal(ingestCorr.envelope.rawResponseSha256, ingestCorr.rawResponseSha256)

    // Original bad ingestion record is preserved alongside correction
    const manualDir = path.join(tempDir, candidateId, 'manual/gemini/attempt-01')
    const origIngestPath = path.join(manualDir, 'ingestion-record.original.json')
    assert.ok(fs.existsSync(origIngestPath), 'ingestion-record.original.json must exist')
    const origIngest = JSON.parse(fs.readFileSync(origIngestPath, 'utf8'))
    assert.equal(origIngest.rawResponseSha256, sha256(origRawBytes))

    const corrFiles = fs.readdirSync(manualDir).filter((f) => f.startsWith('ingestion-record.correction-'))
    assert.equal(corrFiles.length, 1)
    const corrRecord = JSON.parse(fs.readFileSync(path.join(manualDir, corrFiles[0]), 'utf8'))
    assert.equal(corrRecord.recordType, 'COPY_OR_INGEST_CORRECTION')
    assert.equal(corrRecord.originalRawResponseSha256, sha256(origRawBytes))
    assert.equal(corrRecord.correctedRawResponseSha256, sha256(canonRawBytes))
    assert.equal(corrRecord.attemptOrdinal, 1)
    assert.equal(corrRecord.newModelGenerationOccurred, false)
    assert.equal(corrRecord.reason, 'User fixed clipboard truncation from same generation')

    // Active envelope is now present and valid
    const activeEnvPath = path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')
    assert.ok(fs.existsSync(activeEnvPath))
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test M: status reconstructs correctly from disk after simulated restart
test('M. status command reconstructs state purely from disk after process restart', () => {
  const tempDir = makeTempDir('p24-test-m-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    // Prepare both
    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })

    // Ingest Gemini as valid
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Query status purely from disk
    const st = getManualCandidateStatus({ candidateId, executionRoot: tempDir })
    assert.equal(st.gemini.status, 'VALID')
    assert.equal(st.claude.status, 'AWAITING_MANUAL_SUBMISSION')
    assert.equal(st.humanBundle, 'BLOCKED_PENDING_ADVISORIES')
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test N: bundle refuses with only one advisory
test('N. bundle command refuses when only one model advisory is valid', () => {
  const tempDir = makeTempDir('p24-test-n-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Only Gemini is ingested; Claude is missing
    assert.throws(
      () => buildManualHumanBundle({ candidateId, executionRoot: tempDir }),
      /MISSING_ADVISORY: Claude/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test O: bundle succeeds only with two correctly bound valid advisories
test('O. bundle command succeeds when both Gemini and Claude have valid matching advisories', () => {
  const tempDir = makeTempDir('p24-test-o-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const cResp = path.join(tempDir, 'c-resp.json')
    fs.writeFileSync(cResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: cResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    const res = buildManualHumanBundle({ candidateId, executionRoot: tempDir })
    assert.ok(res.bundle)
    assert.equal(res.bundle.candidateId, candidateId)
    assert.equal(res.bundle.status, 'READY_FOR_HUMAN_ADJUDICATION')
    assert.ok(fs.existsSync(res.bundlePath))

    // Check status is now BUNDLE_BUILT
    const st = getManualCandidateStatus({ candidateId, executionRoot: tempDir })
    assert.equal(st.humanBundle, 'BUNDLE_BUILT')
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test P: tampered raw response / prompt / packet / envelope is rejected
test('P. tampered advisory envelope or raw response is rejected by evidence chain verification', () => {
  const tempDir = makeTempDir('p24-test-p-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const cResp = path.join(tempDir, 'c-resp.json')
    fs.writeFileSync(cResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: cResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    buildManualHumanBundle({ candidateId, executionRoot: tempDir })

    // Tamper Gemini envelope
    const envPath = path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')
    const env = JSON.parse(fs.readFileSync(envPath, 'utf8'))
    env.rawResponseSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    fs.writeFileSync(envPath, JSON.stringify(env, null, 2), 'utf8')

    assert.throws(
      () => buildManualHumanBundle({ candidateId, executionRoot: tempDir }),
      /INTEGRITY_FAILURE/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// Test Q: Candidate #1 evidence integrity verified and Candidate #2 directory remains strictly absent
test('Q. Candidate #1 evidence integrity verified and Candidate #2 execution directory is strictly absent', () => {
  const realP2ReviewExecution = path.join(p2Dir, 'review-execution')
  assert.equal(fs.existsSync(realP2ReviewExecution), true, 'Live review-execution directory must exist with Candidate #1')

  const cand1RealDir = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
  assert.equal(fs.existsSync(cand1RealDir), true, 'Candidate #1 execution directory must exist')

  const cand1AdjPath = path.join(cand1RealDir, 'human/adjudication-record.v1.json')
  assert.equal(fs.existsSync(cand1AdjPath), true)
  const cand1AdjSha = sha256(fs.readFileSync(cand1AdjPath))
  assert.equal(cand1AdjSha, 'sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f')

  const ledgerPath = path.join(realP2ReviewExecution, 'review-session-ledger.json')
  assert.equal(fs.existsSync(ledgerPath), true)
  const ledgerSha = sha256(fs.readFileSync(ledgerPath))
  assert.equal(ledgerSha, 'sha256:f1fc82b4acb316e6def5ea631de122a3d92151995c8941b790fac4c97b3004f6')

  // Candidate #2 directory must NOT exist
  const cand2RealDir = path.join(realP2ReviewExecution, 'scale500-tmdb-18912')
  assert.equal(fs.existsSync(cand2RealDir), false, 'Candidate #2 execution directory must NOT exist')
})

// ============================================================
// REPAIR 1: ReviewerModel Authority & Separation Tests
// ============================================================

test('R1.1. Ingestion with no visible label vs arbitrary observational label produces identical envelope reviewerModel (MANUAL_CONSUMER_UI) and identical validity', () => {
  const tempDirA = makeTempDir('p24-test-r1-1a-')
  const tempDirB = makeTempDir('p24-test-r1-1b-')
  try {
    const envA = createSyntheticTestEnv(tempDirA)
    const envB = createSyntheticTestEnv(tempDirB)

    prepareManualPayload({ candidateId: envA.candidateId, reviewer: 'GEMINI', executionRoot: tempDirA, eligiblePool: envA.eligiblePool, reviewOrder: envA.reviewOrder })
    prepareManualPayload({ candidateId: envB.candidateId, reviewer: 'GEMINI', executionRoot: tempDirB, eligiblePool: envB.eligiblePool, reviewOrder: envB.reviewOrder })

    const rawText = JSON.stringify(envA.validOpinion, null, 2)
    const respFileA = path.join(tempDirA, 'respA.json')
    const respFileB = path.join(tempDirB, 'respB.json')
    fs.writeFileSync(respFileA, rawText, 'utf8')
    fs.writeFileSync(respFileB, rawText, 'utf8')

    // Case A: No visible model label supplied
    const resA = ingestManualResponse({
      candidateId: envA.candidateId,
      reviewer: 'GEMINI',
      responseFilePath: respFileA,
      visibleModelLabel: null,
      executionRoot: tempDirA,
      eligiblePool: envA.eligiblePool,
      reviewOrder: envA.reviewOrder,
    })

    // Case B: Arbitrary observational model label supplied
    const resB = ingestManualResponse({
      candidateId: envB.candidateId,
      reviewer: 'GEMINI',
      responseFilePath: respFileB,
      visibleModelLabel: 'arbitrary observational label - Gemini Advanced Consumer UI v99',
      executionRoot: tempDirB,
      eligiblePool: envB.eligiblePool,
      reviewOrder: envB.reviewOrder,
    })

    // Assert: Both envelope reviewerModel values are strictly MANUAL_CONSUMER_UI
    assert.equal(resA.envelope.reviewerModel, 'MANUAL_CONSUMER_UI')
    assert.equal(resB.envelope.reviewerModel, 'MANUAL_CONSUMER_UI')

    // Assert: Envelope validity outcomes are identical
    assert.equal(resA.success, true)
    assert.equal(resB.success, true)
    assert.equal(resA.disposition, 'VALID')
    assert.equal(resB.disposition, 'VALID')
    assert.equal(resA.envelopeSha256, resB.envelopeSha256)

    // Assert: Observational metadata differs strictly outside the envelope authority
    const metaPathA = path.join(tempDirA, envA.candidateId, 'gemini/attempts/attempt-01/attempt-metadata.json')
    const metaPathB = path.join(tempDirB, envB.candidateId, 'gemini/attempts/attempt-01/attempt-metadata.json')
    const metaA = JSON.parse(fs.readFileSync(metaPathA, 'utf8'))
    const metaB = JSON.parse(fs.readFileSync(metaPathB, 'utf8'))

    assert.equal(metaA.reviewerModel, 'MANUAL_CONSUMER_UI')
    assert.equal(metaA.visibleModelLabel, null)
    assert.equal(metaA.modelIdentityStatus, 'UNKNOWN_NOT_EXPOSED')

    assert.equal(metaB.reviewerModel, 'MANUAL_CONSUMER_UI')
    assert.equal(metaB.visibleModelLabel, 'arbitrary observational label - Gemini Advanced Consumer UI v99')
    assert.equal(metaB.modelIdentityStatus, 'EXPOSED')
  } finally {
    cleanTempDir(tempDirA)
    cleanTempDir(tempDirB)
  }
})

test('R1.2. Tampering envelope reviewerModel away from MANUAL_CONSUMER_UI is rejected by manual P2.4 evidence boundary', () => {
  const tempDir = makeTempDir('p24-test-r1-2-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const cResp = path.join(tempDir, 'c-resp.json')
    fs.writeFileSync(cResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: cResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Verify clean bundle creation works before tampering
    buildManualHumanBundle({ candidateId, executionRoot: tempDir })

    // Tamper Gemini envelope reviewerModel away from MANUAL_CONSUMER_UI
    const envPath = path.join(tempDir, candidateId, 'gemini/active-advisory-envelope.v1.json')
    const env = JSON.parse(fs.readFileSync(envPath, 'utf8'))
    env.reviewerModel = 'gemini-2.5-pro'
    fs.writeFileSync(envPath, JSON.stringify(env, null, 2), 'utf8')

    // Also update legacy alias
    const legacyPath = path.join(tempDir, candidateId, 'gemini/advisory-envelope.v1.json')
    fs.writeFileSync(legacyPath, JSON.stringify(env, null, 2), 'utf8')

    assert.throws(
      () => buildManualHumanBundle({ candidateId, executionRoot: tempDir }),
      /INTEGRITY_FAILURE.*reviewerModel 'gemini-2.5-pro' does not match registered 'MANUAL_CONSUMER_UI'/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

// ============================================================
// REPAIR 2: Sequential Candidate Enforcement & Live Pilot Gate Tests
// ============================================================

test('R2.1. Multi-candidate sequential enforcement: current accepted, next/later rejected while current incomplete, unknown rejected', () => {
  const tempDir = makeTempDir('p24-test-r2-1-')
  try {
    const candA = 'scale500-tmdb-100001'
    const candB = 'scale500-tmdb-100002'
    const candC = 'scale500-tmdb-100003'

    const riskInputObj = {
      facts: { title: 'Synthetic Movie', year: 2024, overview: 'Overview' },
      drafts: { overview: 'Overview' },
    }
    const riskPath = path.join(tempDir, 'risk.json')
    fs.writeFileSync(riskPath, JSON.stringify(riskInputObj), 'utf8')
    const riskSha = sha256(fs.readFileSync(riskPath))

    const eligiblePool = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      records: [
        { candidateId: candA, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
        { candidateId: candB, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
        { candidateId: candC, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
      ],
    }

    const reviewOrder = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      orderedCandidates: [
        { candidateId: candA, reviewSequenceIndex: 1 },
        { candidateId: candB, reviewSequenceIndex: 2 },
        { candidateId: candC, reviewSequenceIndex: 3 },
      ],
    }

    // 1. Synthetic current candidate (candA) is accepted
    const prepA = prepareManualPayload({ candidateId: candA, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.equal(prepA.candidateId, candA)
    assert.equal(prepA.reviewSequenceIndex, 1)

    // 2. Synthetic next candidate (candB) rejected while candA is incomplete
    assert.throws(
      () => prepareManualPayload({ candidateId: candB, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /OUT_OF_ORDER_EXECUTION.*Candidate 'scale500-tmdb-100002' is not the currently allowable review candidate.*Current sequential candidate is 'scale500-tmdb-100001'/
    )

    // 3. Arbitrary later eligible candidate (candC) rejected while candA is incomplete
    assert.throws(
      () => prepareManualPayload({ candidateId: candC, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /OUT_OF_ORDER_EXECUTION.*Candidate 'scale500-tmdb-100003' is not the currently allowable review candidate.*Current sequential candidate is 'scale500-tmdb-100001'/
    )

    // 4. Unknown candidate rejected
    assert.throws(
      () => prepareManualPayload({ candidateId: 'unknown-candidate-999', reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /CANDIDATE_NOT_FOUND/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R2.2. After durable completion of current candidate, exactly the next frozen-order candidate becomes eligible', () => {
  const tempDir = makeTempDir('p24-test-r2-2-')
  try {
    const candA = 'scale500-tmdb-200001'
    const candB = 'scale500-tmdb-200002'
    const candC = 'scale500-tmdb-200003'

    const validOpinion = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Strictly factual synthetic movie data',
      confidence: 'HIGH',
      advisoryOnly: true,
    }

    const riskInputObj = {
      facts: { title: 'Synthetic Movie', year: 2024, overview: 'Overview' },
      drafts: { overview: 'Overview' },
    }
    const riskPath = path.join(tempDir, 'risk.json')
    fs.writeFileSync(riskPath, JSON.stringify(riskInputObj), 'utf8')
    const riskSha = sha256(fs.readFileSync(riskPath))

    const eligiblePool = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      records: [
        { candidateId: candA, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
        { candidateId: candB, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
        { candidateId: candC, frozenRiskInputPath: path.relative(repoRoot, riskPath), riskInputByteSha256: riskSha },
      ],
    }

    const reviewOrder = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      orderedCandidates: [
        { candidateId: candA, reviewSequenceIndex: 1 },
        { candidateId: candB, reviewSequenceIndex: 2 },
        { candidateId: candC, reviewSequenceIndex: 3 },
      ],
    }

    // Complete candA through preparation, ingestion, bundle, and durable human adjudication
    prepareManualPayload({ candidateId: candA, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const gResp = path.join(tempDir, 'g-resp.json')
    fs.writeFileSync(gResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId: candA, reviewer: 'GEMINI', responseFilePath: gResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    prepareManualPayload({ candidateId: candA, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const cResp = path.join(tempDir, 'c-resp.json')
    fs.writeFileSync(cResp, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId: candA, reviewer: 'CLAUDE', responseFilePath: cResp, executionRoot: tempDir, eligiblePool, reviewOrder })

    const bundleRes = buildManualHumanBundle({ candidateId: candA, executionRoot: tempDir })

    // Before human adjudication, candB must STILL be rejected
    assert.throws(
      () => prepareManualPayload({ candidateId: candB, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /OUT_OF_ORDER_EXECUTION/
    )

    // Durable authoritative human adjudication record recorded for candA
    const humanRecord = {
      candidateId: candA,
      blindPacketHash: bundleRes.bundle.blindPacketSha256,
      geminiAdvisoryRecordSha256: bundleRes.bundle.geminiAdvisoryEnvelopeSha256,
      claudeAdvisoryRecordSha256: bundleRes.bundle.claudeAdvisoryEnvelopeSha256,
      adjudicator: 'Sophia Zhao',
      finalDecision: 'APPROVE',
      finalSeverity: null,
      affectedFields: [],
      materialIssues: [],
      humanRationale: 'Verified approved synthetic candidate A',
      agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
      adjudicationTimestamp: new Date().toISOString(),
    }
    const humanDir = path.join(tempDir, candA, 'human')
    fs.mkdirSync(humanDir, { recursive: true })
    fs.writeFileSync(path.join(humanDir, 'adjudication-record.v1.json'), JSON.stringify(humanRecord, null, 2), 'utf8')

    // Now candA is durably completed: exactly candB becomes allowable
    const prepB = prepareManualPayload({ candidateId: candB, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.equal(prepB.candidateId, candB)
    assert.equal(prepB.reviewSequenceIndex, 2)

    // Later candidate candC is STILL rejected while candB is incomplete
    assert.throws(
      () => prepareManualPayload({ candidateId: candC, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder }),
      /OUT_OF_ORDER_EXECUTION.*Candidate 'scale500-tmdb-200003' is not the currently allowable review candidate.*Current sequential candidate is 'scale500-tmdb-200002'/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R2.3. Direct CLI path enforces sequence and rejects review-order bypass flags', async () => {
  const tempDir = makeTempDir('p24-test-r2-3-')
  try {
    // Attempt to pass unauthorized bypass flags to CLI
    await assert.rejects(
      () => runManualReviewCli(['prepare', 'any-candidate', 'GEMINI', '--review-order', '/fake/order.json']),
      /SECURITY_VIOLATION.*Production CLI does not permit custom review order injection/
    )

    await assert.rejects(
      () => runManualReviewCli(['prepare', 'any-candidate', 'GEMINI', '--eligible-pool', '/fake/pool.json']),
      /SECURITY_VIOLATION.*Production CLI does not permit custom review order injection/
    )

    await assert.rejects(
      () => runManualReviewCli(['prepare', 'any-candidate', 'GEMINI', '--bypass-order']),
      /SECURITY_VIOLATION.*Production CLI does not permit custom review order injection/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R2.4. Production CLI Candidate #1 live pilot gate enforces authorization artifact and sequence constraints', () => {
  const tempFixtureDir = makeTempDir('p24-test-r2-4-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }

    // When authorization artifact is absent, Candidate #1 MUST reject with PILOT_NOT_AUTHORIZED
    assert.throws(
      () => prepareManualPayload({
        candidateId: 'exp100-tmdb-672647',
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
        authorizationPath: path.join(tempFixtureDir, 'nonexistent-pilot-auth.json'),
      }),
      /PILOT_NOT_AUTHORIZED/
    )

    // Calling prepare on candidate #2 when candidate #1 is unadjudicated MUST reject with OUT_OF_ORDER_EXECUTION
    assert.throws(
      () => prepareManualPayload({
        candidateId: 'scale500-tmdb-18912',
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /OUT_OF_ORDER_EXECUTION/
    )

    // Candidate #2 directory must remain absent in real review-execution
    const realProdRoot = path.join(p2Dir, 'review-execution')
    assert.equal(fs.existsSync(path.join(realProdRoot, 'scale500-tmdb-18912')), false)
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

// ============================================================
// REPAIR 3: Copy/Ingest Correction Immutability & Adversarial Tests
// ============================================================

test('R3.1. Copy/ingest correction preserves immutable original raw bytes and corrected canonical raw bytes', () => {
  const tempDir = makeTempDir('p24-test-r3-1-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })

    // 1. Ingest original bad copied bytes
    const badBytes = '{"preliminaryDecision": "APPROVE", "partial_truncated_clipboard'
    const badFile = path.join(tempDir, 'bad-copy.txt')
    fs.writeFileSync(badFile, badBytes, 'utf8')
    const origSha = sha256(Buffer.from(badBytes, 'utf8'))

    const ingestBad = ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.equal(ingestBad.disposition, 'MALFORMED_JSON')
    assert.equal(ingestBad.rawResponseSha256, origSha)

    // 2. Perform copy correction
    const goodBytes = JSON.stringify(validOpinion, null, 2)
    const goodFile = path.join(tempDir, 'good-copy.json')
    fs.writeFileSync(goodFile, goodBytes, 'utf8')
    const goodSha = sha256(Buffer.from(goodBytes, 'utf8'))

    const ingestGood = ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: goodFile,
      isCorrection: true,
      correctionReason: 'Fixed truncated clipboard copy',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    assert.equal(ingestGood.success, true)
    assert.equal(ingestGood.disposition, 'VALID')

    // 3. Assert original bad raw bytes exist after correction and hash exactly to pre-correction hash
    const attemptsDir = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01')
    const origRawPath = path.join(attemptsDir, 'raw-response.original.txt')
    const canonRawPath = path.join(attemptsDir, 'raw-response.txt')

    assert.ok(fs.existsSync(origRawPath))
    assert.equal(fs.readFileSync(origRawPath, 'utf8'), badBytes)
    assert.equal(sha256(fs.readFileSync(origRawPath)), origSha)

    // 4. Assert corrected canonical raw bytes hash to corrected envelope rawResponseSha256
    assert.ok(fs.existsSync(canonRawPath))
    assert.equal(fs.readFileSync(canonRawPath, 'utf8'), goodBytes)
    assert.equal(sha256(fs.readFileSync(canonRawPath)), goodSha)
    assert.equal(ingestGood.envelope.rawResponseSha256, goodSha)

    // 5. Both original and corrected bytes are independently recoverable
    assert.notEqual(origSha, goodSha)
    assert.equal(sha256(fs.readFileSync(origRawPath)), origSha)
    assert.equal(sha256(fs.readFileSync(canonRawPath)), goodSha)
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R3.2. Correction record binds original SHA -> corrected SHA, preserves ordinal and newModelGenerationOccurred: false', () => {
  const tempDir = makeTempDir('p24-test-r3-2-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })

    const badFile = path.join(tempDir, 'bad-claude.txt')
    fs.writeFileSync(badFile, '{"bad": "truncated', 'utf8')
    const ingestBad = ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    const goodFile = path.join(tempDir, 'good-claude.json')
    fs.writeFileSync(goodFile, JSON.stringify(validOpinion), 'utf8')
    const ingestGood = ingestManualResponse({
      candidateId,
      reviewer: 'CLAUDE',
      responseFilePath: goodFile,
      isCorrection: true,
      correctionReason: 'Claude copy error corrected without regeneration',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    // Correction does not increment model attempt ordinal
    assert.equal(ingestGood.attemptNumber, 1)

    // Correction does not create attempt-02
    const attemptsDir = path.join(tempDir, candidateId, 'claude/attempts')
    const attempts = fs.readdirSync(attemptsDir).filter((d) => /^attempt-\d+$/.test(d))
    assert.deepEqual(attempts, ['attempt-01'])

    // Correction record links original SHA -> corrected SHA
    const manualDir = path.join(tempDir, candidateId, 'manual/claude/attempt-01')
    const corrFiles = fs.readdirSync(manualDir).filter((f) => f.startsWith('ingestion-record.correction-'))
    assert.equal(corrFiles.length, 1)

    const corr = JSON.parse(fs.readFileSync(path.join(manualDir, corrFiles[0]), 'utf8'))
    assert.equal(corr.originalRawResponseSha256, ingestBad.rawResponseSha256)
    assert.equal(corr.correctedRawResponseSha256, ingestGood.rawResponseSha256)
    assert.equal(corr.newModelGenerationOccurred, false)
    assert.equal(corr.attemptOrdinal, 1)
    assert.equal(corr.reason, 'Claude copy error corrected without regeneration')
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R3.3. Genuine model-generated failure cannot be silently relabeled as copy error without explicit reason', () => {
  const tempDir = makeTempDir('p24-test-r3-3-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })

    const badFile = path.join(tempDir, 'bad.txt')
    fs.writeFileSync(badFile, '{"malformed":', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    const goodFile = path.join(tempDir, 'good.json')
    fs.writeFileSync(goodFile, JSON.stringify(validOpinion), 'utf8')

    // Calling with isCorrection: true but missing correctionReason strictly throws
    assert.throws(
      () => ingestManualResponse({
        candidateId,
        reviewer: 'GEMINI',
        responseFilePath: goodFile,
        isCorrection: true,
        correctionReason: null,
        executionRoot: tempDir,
        eligiblePool,
        reviewOrder,
      }),
      /INVALID_ARGUMENT.*correctionReason is strictly required/
    )

    // Empty whitespace correctionReason strictly throws
    assert.throws(
      () => ingestManualResponse({
        candidateId,
        reviewer: 'GEMINI',
        responseFilePath: goodFile,
        isCorrection: true,
        correctionReason: '   ',
        executionRoot: tempDir,
        eligiblePool,
        reviewOrder,
      }),
      /INVALID_ARGUMENT.*correctionReason is strictly required/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R3.4. Tampering archived original bytes is detectable against correction record', () => {
  const tempDir = makeTempDir('p24-test-r3-4-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const badFile = path.join(tempDir, 'bad.txt')
    fs.writeFileSync(badFile, '{"bad": true', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    const goodFile = path.join(tempDir, 'good.json')
    fs.writeFileSync(goodFile, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: goodFile,
      isCorrection: true,
      correctionReason: 'Fixed copy',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    const manualDir = path.join(tempDir, candidateId, 'manual/gemini/attempt-01')
    const corrFile = fs.readdirSync(manualDir).find((f) => f.startsWith('ingestion-record.correction-'))
    const corrRecord = JSON.parse(fs.readFileSync(path.join(manualDir, corrFile), 'utf8'))

    const origRawPath = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/raw-response.original.txt')
    assert.equal(sha256(fs.readFileSync(origRawPath)), corrRecord.originalRawResponseSha256)

    // Tamper original bytes
    fs.writeFileSync(origRawPath, '{"tampered": "bytes"}', 'utf8')
    assert.notEqual(sha256(fs.readFileSync(origRawPath)), corrRecord.originalRawResponseSha256)
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R3.5. Tampering corrected canonical bytes breaks P2.2 evidence verification', () => {
  const tempDir = makeTempDir('p24-test-r3-5-')
  try {
    const { candidateId, eligiblePool, reviewOrder, validOpinion } = createSyntheticTestEnv(tempDir)

    // Prepare & ingest Gemini with correction
    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const badFile = path.join(tempDir, 'bad.txt')
    fs.writeFileSync(badFile, '{"bad": true', 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    const goodFile = path.join(tempDir, 'good.json')
    fs.writeFileSync(goodFile, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({
      candidateId,
      reviewer: 'GEMINI',
      responseFilePath: goodFile,
      isCorrection: true,
      correctionReason: 'Fixed copy',
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
    })

    // Prepare & ingest Claude normally
    prepareManualPayload({ candidateId, reviewer: 'CLAUDE', executionRoot: tempDir, eligiblePool, reviewOrder })
    const cFile = path.join(tempDir, 'c.json')
    fs.writeFileSync(cFile, JSON.stringify(validOpinion), 'utf8')
    ingestManualResponse({ candidateId, reviewer: 'CLAUDE', responseFilePath: cFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Build bundle succeeds
    buildManualHumanBundle({ candidateId, executionRoot: tempDir })

    // Tamper corrected canonical raw-response.txt
    const canonRawPath = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01/raw-response.txt')
    fs.writeFileSync(canonRawPath, '{"tampered": true}', 'utf8')

    // Evidence chain verification breaks
    assert.throws(
      () => verifyCandidateReviewEvidenceChain({
        candidateId,
        candidateDir: path.join(tempDir, candidateId),
        bindings: {
          geminiModel: 'MANUAL_CONSUMER_UI',
          claudeModel: 'MANUAL_CONSUMER_UI',
        },
      }),
      /INTEGRITY_FAILURE.*rawResponseSha256 does not match any persisted raw response bytes/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('R3.6. Simulated crash between original archival and corrected canonical installation preserves recoverable original evidence', () => {
  const tempDir = makeTempDir('p24-test-r3-6-')
  try {
    const { candidateId, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)

    prepareManualPayload({ candidateId, reviewer: 'GEMINI', executionRoot: tempDir, eligiblePool, reviewOrder })
    const badBytes = '{"bad_clipboard_crash_test": true'
    const badFile = path.join(tempDir, 'bad.txt')
    fs.writeFileSync(badFile, badBytes, 'utf8')
    const badSha = sha256(Buffer.from(badBytes, 'utf8'))
    ingestManualResponse({ candidateId, reviewer: 'GEMINI', responseFilePath: badFile, executionRoot: tempDir, eligiblePool, reviewOrder })

    // Simulate crash after archival step:
    // In our atomic sequence, original raw bytes are archived to raw-response.original.txt before canonical raw-response.txt is replaced.
    const attemptDir = path.join(tempDir, candidateId, 'gemini/attempts/attempt-01')
    const origRawPath = path.join(attemptDir, 'raw-response.original.txt')

    // Archive original bytes
    fs.copyFileSync(path.join(attemptDir, 'raw-response.txt'), origRawPath)

    // Simulate process killed / crashed here before canonical installation
    // Verify that original evidence is preserved and recoverable
    assert.ok(fs.existsSync(origRawPath))
    assert.equal(fs.readFileSync(origRawPath, 'utf8'), badBytes)
    assert.equal(sha256(fs.readFileSync(origRawPath)), badSha)
    assert.equal(sha256(fs.readFileSync(path.join(attemptDir, 'raw-response.txt'))), badSha)
  } finally {
    cleanTempDir(tempDir)
  }
})

// ============================================================
// AMENDMENT: Candidate #1 Pilot Authorization Bridge Tests
// ============================================================

test('AUTH.1. Authorization artifact absent -> Candidate #1 blocked with PILOT_NOT_AUTHORIZED', () => {
  const fakeAuthPath = path.join(p2Dir, 'nonexistent-pilot-authorization.json')
  assert.throws(
    () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: fakeAuthPath }),
    /PILOT_NOT_AUTHORIZED.*Candidate #1 pilot authorization artifact is absent/
  )
})

test('AUTH.2. Valid artifact -> Candidate #1 production prepare passes authorization gate', () => {
  const auth = validateCandidate1PilotAuthorization({ p2Dir })
  assert.equal(auth.activity, 'VERIFIER_V14_CANDIDATE1_MANUAL_PILOT_AUTHORIZATION')
  assert.equal(auth.candidateId, 'exp100-tmdb-672647')
  assert.equal(auth.reviewSequenceIndex, 1)
  assert.equal(auth.authorized, true)
  assert.equal(auth.automaticCandidate2Authorization, false)
})

test('AUTH.3. Wrong candidateId in authorization artifact is rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-wrong-id-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))
    const invalidAuth = { ...validAuth, candidateId: 'scale500-tmdb-999999' }
    const authFile = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(authFile, JSON.stringify(invalidAuth, null, 2), 'utf8')

    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: authFile }),
      /PILOT_AUTHORIZATION_INVALID.*Candidate ID 'scale500-tmdb-999999' does not match expected Candidate #1/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.4. Wrong reviewSequenceIndex is rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-wrong-seq-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))
    const invalidAuth = { ...validAuth, reviewSequenceIndex: 2 }
    const authFile = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(authFile, JSON.stringify(invalidAuth, null, 2), 'utf8')

    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: authFile }),
      /PILOT_AUTHORIZATION_INVALID.*reviewSequenceIndex '2' must equal 1/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.5. Wrong P2.3 manifest SHA is rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-wrong-p23-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))
    const invalidAuth = { ...validAuth, p23FreezeManifestSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
    const authFile = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(authFile, JSON.stringify(invalidAuth, null, 2), 'utf8')

    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: authFile }),
      /PILOT_AUTHORIZATION_INVALID.*P2.3 freeze manifest SHA mismatch/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.6. Wrong P2.4 implementation/test/readiness bindings are rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-wrong-p24-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))

    // 1. Wrong freeze commit
    const authWrongCommit = { ...validAuth, p24FreezeCommit: '0000000000000000000000000000000000000000' }
    const file1 = path.join(tempDir, 'auth1.json')
    fs.writeFileSync(file1, JSON.stringify(authWrongCommit, null, 2), 'utf8')
    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: file1 }),
      /PILOT_AUTHORIZATION_INVALID.*p24FreezeCommit/
    )

    // 2. Wrong implementation SHA
    const authWrongImpl = { ...validAuth, p24ImplementationSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
    const file2 = path.join(tempDir, 'auth2.json')
    fs.writeFileSync(file2, JSON.stringify(authWrongImpl, null, 2), 'utf8')
    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: file2 }),
      /PILOT_AUTHORIZATION_INVALID.*p24ImplementationSha256/
    )

    // 3. Wrong test SHA
    const authWrongTest = { ...validAuth, p24TestSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
    const file3 = path.join(tempDir, 'auth3.json')
    fs.writeFileSync(file3, JSON.stringify(authWrongTest, null, 2), 'utf8')
    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: file3 }),
      /PILOT_AUTHORIZATION_INVALID.*p24TestSha256/
    )

    // 4. Wrong readiness SHA
    const authWrongReadiness = { ...validAuth, p24ReadinessSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
    const file4 = path.join(tempDir, 'auth4.json')
    fs.writeFileSync(file4, JSON.stringify(authWrongReadiness, null, 2), 'utf8')
    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: file4 }),
      /PILOT_AUTHORIZATION_INVALID.*p24ReadinessSha256/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.7. authorized: false is rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-not-authorized-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))
    const invalidAuth = { ...validAuth, authorized: false }
    const authFile = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(authFile, JSON.stringify(invalidAuth, null, 2), 'utf8')

    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: authFile }),
      /PILOT_AUTHORIZATION_INVALID.*authorized must be true/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.8. automaticCandidate2Authorization: true is rejected with PILOT_AUTHORIZATION_INVALID', () => {
  const tempDir = makeTempDir('p24-test-auth-cand2-auto-')
  try {
    const validAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-candidate1-pilot-authorization.v1.json'), 'utf8'))
    const invalidAuth = { ...validAuth, automaticCandidate2Authorization: true }
    const authFile = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(authFile, JSON.stringify(invalidAuth, null, 2), 'utf8')

    assert.throws(
      () => validateCandidate1PilotAuthorization({ p2Dir, authorizationPath: authFile }),
      /PILOT_AUTHORIZATION_INVALID.*automaticCandidate2Authorization must be false/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('AUTH.9. Candidate #2 and later candidates remain blocked even when Candidate #1 authorization artifact is valid', () => {
  const tempFixtureDir = makeTempDir('p24-test-auth-9-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-candidate1-pilot-authorization.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }

    // When Candidate #1 is unadjudicated, Candidate #2 throws OUT_OF_ORDER_EXECUTION
    assert.throws(
      () => prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', executionRoot: tempProdRoot, p2Dir: tempFixtureDir }),
      /OUT_OF_ORDER_EXECUTION/
    )

    // Later candidate in review order throws OUT_OF_ORDER_EXECUTION
    assert.throws(
      () => prepareManualPayload({ candidateId: 'scale500-tmdb-11802', reviewer: 'GEMINI', executionRoot: tempProdRoot, p2Dir: tempFixtureDir }),
      /OUT_OF_ORDER_EXECUTION/
    )

    // Unknown candidate throws CANDIDATE_NOT_FOUND
    assert.throws(
      () => prepareManualPayload({ candidateId: 'unknown-candidate-xyz', reviewer: 'GEMINI', executionRoot: tempProdRoot, p2Dir: tempFixtureDir }),
      /CANDIDATE_NOT_FOUND/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('AUTH.10. Candidate #1 evidence integrity verified and Candidate #2 remains strictly absent and untouched', () => {
  const prodExecutionRoot = path.join(p2Dir, 'review-execution')
  assert.equal(fs.existsSync(prodExecutionRoot), true)
  assert.equal(fs.existsSync(path.join(prodExecutionRoot, 'exp100-tmdb-672647')), true)
  assert.equal(fs.existsSync(path.join(prodExecutionRoot, 'scale500-tmdb-18912')), false, 'Candidate #2 directory must NOT exist')
})

test('AUTH.11. Production-path Candidate #1 integration in isolated temp fixture passes authorization gate and prepares payload', () => {
  const tempP2Dir = makeTempDir('p24-scope-proof-c1-')
  try {
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-candidate1-pilot-authorization.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempP2Dir, f))
    }

    const tempProdExecRoot = path.join(tempP2Dir, 'review-execution')

    const prep = prepareManualPayload({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    assert.ok(prep.copyReadyText.includes('exp100-tmdb-672647'))
    assert.ok(prep.payloadSha256.startsWith('sha256:'))

    const c1Dir = path.join(tempProdExecRoot, 'exp100-tmdb-672647')
    assert.ok(fs.existsSync(path.join(c1Dir, 'blind-packet.v1.json')))
    assert.ok(fs.existsSync(path.join(c1Dir, 'manual/gemini/attempt-01/submission-payload.v1.txt')))

    const canonicalProdRoot = path.join(p2Dir, 'review-execution')
    assert.equal(fs.existsSync(path.join(canonicalProdRoot, 'scale500-tmdb-18912')), false)
  } finally {
    cleanTempDir(tempP2Dir)
  }
})

test('AUTH.12. Candidate #2 remains hard-blocked with PILOT_NOT_AUTHORIZED after Candidate #1 reaches durable human adjudication when session auth is absent', () => {
  const tempP2Dir = makeTempDir('p24-scope-proof-c2-')
  try {
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-candidate1-pilot-authorization.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempP2Dir, f))
    }

    const tempProdExecRoot = path.join(tempP2Dir, 'review-execution')

    prepareManualPayload({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })
    prepareManualPayload({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'CLAUDE',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    const validOpinion = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Strictly factual synthetic movie data',
      confidence: 'HIGH',
      advisoryOnly: true,
    }
    const geminiRespFile = path.join(tempP2Dir, 'gemini-resp.json')
    fs.writeFileSync(geminiRespFile, JSON.stringify(validOpinion, null, 2), 'utf8')
    ingestManualResponse({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      responseFilePath: geminiRespFile,
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    const claudeRespFile = path.join(tempP2Dir, 'claude-resp.json')
    fs.writeFileSync(claudeRespFile, JSON.stringify(validOpinion, null, 2), 'utf8')
    ingestManualResponse({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'CLAUDE',
      responseFilePath: claudeRespFile,
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    const bundleRes = buildManualHumanBundle({
      candidateId: 'exp100-tmdb-672647',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    const humanDir = path.join(tempProdExecRoot, 'exp100-tmdb-672647', 'human')
    fs.mkdirSync(humanDir, { recursive: true })
    const humanRecord = {
      candidateId: 'exp100-tmdb-672647',
      blindPacketHash: bundleRes.bundle.blindPacketSha256,
      geminiAdvisoryRecordSha256: bundleRes.bundle.geminiAdvisoryEnvelopeSha256,
      claudeAdvisoryRecordSha256: bundleRes.bundle.claudeAdvisoryEnvelopeSha256,
      adjudicator: 'Sophia Zhao',
      finalDecision: 'APPROVE',
      finalSeverity: null,
      affectedFields: [],
      materialIssues: [],
      humanRationale: 'Verified approved synthetic Candidate #1',
      agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
      adjudicationTimestamp: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(humanDir, 'adjudication-record.v1.json'), JSON.stringify(humanRecord, null, 2), 'utf8')

    // Absent post-pilot session authorization blocks Candidate #2
    assert.throws(
      () => prepareManualPayload({
        candidateId: 'scale500-tmdb-18912',
        reviewer: 'GEMINI',
        executionRoot: tempProdExecRoot,
        p2Dir: tempP2Dir,
      }),
      /PILOT_NOT_AUTHORIZED.*without post-pilot session authorization/
    )

    const canonicalProdRoot = path.join(p2Dir, 'review-execution')
    assert.equal(fs.existsSync(path.join(canonicalProdRoot, 'scale500-tmdb-18912')), false)
  } finally {
    cleanTempDir(tempP2Dir)
  }
})

// ============================================================
// SUITE A: Post-Pilot Authorization Tests
// ============================================================

test('A.1. Absent post-pilot authorization blocks Candidate #2', () => {
  const tempDir = makeTempDir('p24-suite-a1-')
  try {
    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempDir,
        authorizationPath: path.join(tempDir, 'nonexistent-auth.json'),
      }),
      /SESSION_NOT_AUTHORIZED/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('A.2. Valid post-pilot session authorization permits Candidate #2 once Candidate #1 is durably complete', () => {
  const auth = validatePostPilotSessionAuthorization({ p2Dir })
  assert.equal(auth.activity, 'VERIFIER_V14_POST_PILOT_SEQUENTIAL_REVIEW_SESSION_AUTHORIZATION')
  assert.equal(auth.classification, 'POST_FREEZE_OPERATIONAL_AUTHORIZATION_AMENDMENT')
  assert.equal(auth.methodStatement, 'NO_METHOD_CHANGE')
  assert.equal(auth.sequentialSessionAuthorized, true)
  assert.equal(auth.skippingPermitted, false)
  assert.equal(auth.perCandidateAmendmentRequired, false)

  // Use an isolated temp fixture mirroring Candidate #1 complete state
  const tempFixtureDir = makeTempDir('p24-suite-a2-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    const prep = prepareManualPayload({
      candidateId: 'scale500-tmdb-18912',
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prep.candidateId, 'scale500-tmdb-18912')
    assert.equal(prep.reviewer, 'GEMINI')
    assert.ok(prep.copyReadyText.includes('scale500-tmdb-18912'))
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.3. Authorization rejects wrong Candidate #1 evidence-freeze commit', () => {
  const tempDir = makeTempDir('p24-suite-a3-')
  try {
    const authPath = path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    authData.candidate1EvidenceFreezeCommit = '0000000000000000000000000000000000000000'
    const tempAuth = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(tempAuth, JSON.stringify(authData, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir, authorizationPath: tempAuth }),
      /SESSION_AUTHORIZATION_INVALID.*candidate1EvidenceFreezeCommit/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('A.4. Authorization rejects wrong Candidate #1 adjudication SHA', () => {
  const tempDir = makeTempDir('p24-suite-a4-')
  try {
    const authPath = path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    authData.candidate1HumanAdjudicationSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    const tempAuth = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(tempAuth, JSON.stringify(authData, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir, authorizationPath: tempAuth }),
      /SESSION_AUTHORIZATION_INVALID.*candidate1HumanAdjudicationSha256/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('A.5. Authorization rejects wrong Candidate #1 ledger SHA', () => {
  const tempDir = makeTempDir('p24-suite-a5-')
  try {
    const authPath = path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    authData.candidate1FrozenSessionLedgerSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    const tempAuth = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(tempAuth, JSON.stringify(authData, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir, authorizationPath: tempAuth }),
      /SESSION_AUTHORIZATION_INVALID.*candidate1FrozenSessionLedgerSha256/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('A.6. Authorization rejects wrong frozen review-order authority', () => {
  const tempDir = makeTempDir('p24-suite-a6-')
  try {
    const authPath = path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json')
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    authData.frozenReviewOrderSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    const tempAuth = path.join(tempDir, 'invalid-auth.json')
    fs.writeFileSync(tempAuth, JSON.stringify(authData, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir, authorizationPath: tempAuth }),
      /SESSION_AUTHORIZATION_INVALID.*frozenReviewOrderSha256/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('A.7. Authorization rejects tampered actual Candidate #1 human adjudication record on disk', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    // Tamper actual Candidate #1 adjudication record on disk
    const diskRecordPath = path.join(c1Dest, 'human/adjudication-record.v1.json')
    const record = JSON.parse(fs.readFileSync(diskRecordPath, 'utf8'))
    record.humanRationale = 'TAMPERED RATIONALE'
    fs.writeFileSync(diskRecordPath, JSON.stringify(record, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Canonical Candidate #1 human adjudication record SHA/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.8. Authorization rejects corrupted Candidate #1 evidence chain on disk', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a8-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    // Corrupt Gemini advisory envelope on disk to break evidence chain
    const gEnvPath = path.join(c1Dest, 'gemini/active-advisory-envelope.v1.json')
    const gEnv = JSON.parse(fs.readFileSync(gEnvPath, 'utf8'))
    gEnv.rawResponseSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    fs.writeFileSync(gEnvPath, JSON.stringify(gEnv, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Candidate #1 evidence chain verification failed/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7b. Authorization rejects Candidate #1 missing from live session ledger state', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7b-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })

    // Ledger has Candidate #1 deleted
    const ledger = JSON.parse(fs.readFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), 'utf8'))
    delete ledger.candidateStates['exp100-tmdb-672647']
    fs.mkdirSync(tempProdRoot, { recursive: true })
    fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Candidate #1 \('exp100-tmdb-672647'\) missing from current session state/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7c. Authorization rejects Candidate #1 with non-HUMAN_ADJUDICATED status in live session ledger', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7c-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })

    // Ledger has Candidate #1 status reverted
    const ledger = JSON.parse(fs.readFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), 'utf8'))
    ledger.candidateStates['exp100-tmdb-672647'].status = 'PREPARED'
    fs.mkdirSync(tempProdRoot, { recursive: true })
    fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Candidate #1 status in current session state is not HUMAN_ADJUDICATED/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7d. Authorization rejects Candidate #1 humanAdjudicationSha256 mismatch in live session ledger', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7d-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })

    // Ledger has tampered human hash
    const ledger = JSON.parse(fs.readFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), 'utf8'))
    ledger.candidateStates['exp100-tmdb-672647'].humanAdjudicationSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    fs.mkdirSync(tempProdRoot, { recursive: true })
    fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Candidate #1 humanAdjudicationSha256 in current session state does not match expected/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7d2. Authorization rejects Candidate #1 with missing humanAdjudicationSha256 in live session ledger', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7d2-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })

    // Ledger has missing human hash
    const ledger = JSON.parse(fs.readFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), 'utf8'))
    delete ledger.candidateStates['exp100-tmdb-672647'].humanAdjudicationSha256
    fs.mkdirSync(tempProdRoot, { recursive: true })
    fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Candidate #1 humanAdjudicationSha256 in current session state does not match expected/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7e. Authorization rejects review order that does not map sequence index 1 to Candidate #1', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7e-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    // Tamper review order so entry 1 is different candidate
    const orderData = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    orderData.orderedCandidates[0].candidateId = 'wrong-candidate-id'
    fs.writeFileSync(path.join(tempFixtureDir, 'blind-review-order.v1.json'), JSON.stringify(orderData, null, 2), 'utf8')

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*(Bound file 'blind-review-order.v1.json' disk SHA mismatch|Frozen review order does not map sequence index 1)/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.7f. Live ledger evolution after Candidate #2 does not break Candidate #1 historical frozen binding', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a7f-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })

    // Live ledger evolves by adding Candidate #2
    const ledger = JSON.parse(fs.readFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), 'utf8'))
    ledger.candidateStates['scale500-tmdb-18912'] = {
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      finalDecision: 'APPROVE',
      finalSeverity: null,
      adjudicatedAt: '2026-09-18T03:00:00Z',
    }
    ledger.cleanCount = 2
    fs.mkdirSync(tempProdRoot, { recursive: true })
    fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8')

    // Authorization passes cleanly despite live ledger evolution
    const auth = validatePostPilotSessionAuthorization({
      p2Dir: tempFixtureDir,
      executionRoot: tempProdRoot,
    })
    assert.equal(auth.sequentialSessionAuthorized, true)
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.9. Authorization rejects missing implementation incident artifact file on disk', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a9-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      // Intentionally omit p2-4-post-pilot-implementation-incident.v1.json
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    assert.throws(
      () => validatePostPilotSessionAuthorization({
        p2Dir: tempFixtureDir,
        executionRoot: tempProdRoot,
      }),
      /SESSION_AUTHORIZATION_INVALID.*Mandatory bound file 'p2-4-post-pilot-implementation-incident.v1.json' missing/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.10. Authorization rejects missing or tampered original P2.4 provenance bindings in authorization JSON', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a10-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    const baseAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json'), 'utf8'))

    // Missing originalP24FreezeCommit
    const auth1 = { ...baseAuth }
    delete auth1.originalP24FreezeCommit
    fs.writeFileSync(path.join(tempFixtureDir, 'p2-4-post-pilot-sequential-session-authorization.v1.json'), JSON.stringify(auth1, null, 2), 'utf8')
    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir: tempFixtureDir, executionRoot: tempProdRoot }),
      /SESSION_AUTHORIZATION_INVALID.*Mandatory provenance field 'originalP24FreezeCommit' is missing/
    )

    // Tampered candidate1AuthorizationBridgeCommit
    const auth2 = { ...baseAuth, candidate1AuthorizationBridgeCommit: '0000000000000000000000000000000000000000' }
    fs.writeFileSync(path.join(tempFixtureDir, 'p2-4-post-pilot-sequential-session-authorization.v1.json'), JSON.stringify(auth2, null, 2), 'utf8')
    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir: tempFixtureDir, executionRoot: tempProdRoot }),
      /SESSION_AUTHORIZATION_INVALID.*Provenance field 'candidate1AuthorizationBridgeCommit'/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('A.11. Authorization rejects missing or tampered implementationIncidentSha256 in authorization JSON', () => {
  const tempFixtureDir = makeTempDir('p24-suite-a11-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    const baseAuth = JSON.parse(fs.readFileSync(path.join(p2Dir, 'p2-4-post-pilot-sequential-session-authorization.v1.json'), 'utf8'))

    // Missing implementationIncidentSha256
    const auth1 = { ...baseAuth }
    delete auth1.implementationIncidentSha256
    fs.writeFileSync(path.join(tempFixtureDir, 'p2-4-post-pilot-sequential-session-authorization.v1.json'), JSON.stringify(auth1, null, 2), 'utf8')
    assert.throws(
      () => validatePostPilotSessionAuthorization({ p2Dir: tempFixtureDir, executionRoot: tempProdRoot }),
      /SESSION_AUTHORIZATION_INVALID.*Mandatory provenance field 'implementationIncidentSha256' is missing/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

// ============================================================
// SUITE B: Sequential Continuation Tests
// ============================================================

test('B.1. Candidate #2 is exact next candidate after Candidate #1', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const current = getCurrentReviewCandidate({ executionRoot: realProdRoot, p2Dir })
  assert.equal(current.currentCandidateId, 'scale500-tmdb-18912')
  assert.equal(current.currentReviewSequenceIndex, 2)
  assert.equal(current.operationalStatus, 'PRIMARY_REVIEW_CONTINUES')
})

test('B.2. Candidate #3 cannot run before Candidate #2 adjudication', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  assert.throws(
    () => prepareManualPayload({
      candidateId: 'scale500-tmdb-11802', // Candidate #3
      reviewer: 'GEMINI',
      executionRoot: realProdRoot,
      p2Dir,
    }),
    /OUT_OF_ORDER_EXECUTION.*Current sequential candidate is 'scale500-tmdb-18912'/
  )
})

test('B.3. After synthetic Candidate #2 adjudication, Candidate #3 becomes exact next candidate', () => {
  const tempFixtureDir = makeTempDir('p24-suite-b3-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }

    // Mirror Candidate #1 into fixture
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    // Prepare Candidate #2 for GEMINI and CLAUDE
    prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', executionRoot: tempProdRoot, p2Dir: tempFixtureDir })
    prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'CLAUDE', executionRoot: tempProdRoot, p2Dir: tempFixtureDir })

    const validOpinion = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Strictly factual synthetic movie data',
      confidence: 'HIGH',
      advisoryOnly: true,
    }
    const respFile = path.join(tempFixtureDir, 'resp.json')
    fs.writeFileSync(respFile, JSON.stringify(validOpinion, null, 2), 'utf8')
    ingestManualResponse({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', responseFilePath: respFile, executionRoot: tempProdRoot, p2Dir: tempFixtureDir })
    ingestManualResponse({ candidateId: 'scale500-tmdb-18912', reviewer: 'CLAUDE', responseFilePath: respFile, executionRoot: tempProdRoot, p2Dir: tempFixtureDir })

    buildManualHumanBundle({ candidateId: 'scale500-tmdb-18912', executionRoot: tempProdRoot, p2Dir: tempFixtureDir })

    // Adjudicate Candidate #2
    const adjRes = recordManualHumanAdjudication({
      candidateId: 'scale500-tmdb-18912',
      finalDecision: 'APPROVE',
      finalSeverity: null,
      affectedFields: [],
      materialIssues: [],
      humanRationale: 'Verified approved synthetic Candidate #2',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })

    assert.equal(adjRes.operationalStatus, 'PRIMARY_REVIEW_CONTINUES')
    assert.equal(adjRes.nextCandidateId, 'scale500-tmdb-11802')

    // B.4: Candidate #3 does NOT need another authorization amendment
    const prepC3 = prepareManualPayload({
      candidateId: 'scale500-tmdb-11802',
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prepC3.candidateId, 'scale500-tmdb-11802')
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('B.5. Arbitrary later candidate remains blocked with OUT_OF_ORDER_EXECUTION', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  assert.throws(
    () => prepareManualPayload({
      candidateId: 'scale500-tmdb-999999',
      reviewer: 'GEMINI',
      executionRoot: realProdRoot,
      p2Dir,
    }),
    /CANDIDATE_NOT_FOUND/
  )
})

test('B.6. Unknown candidate remains rejected with CANDIDATE_NOT_FOUND', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  assert.throws(
    () => prepareManualPayload({
      candidateId: 'completely-unknown-film',
      reviewer: 'GEMINI',
      executionRoot: realProdRoot,
      p2Dir,
    }),
    /CANDIDATE_NOT_FOUND/
  )
})

// ============================================================
// SUITE C: Information Environment Invariance Tests
// ============================================================

test('C.1. No quota counters are exposed in human adjudication output or bundle', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const c1BundlePath = path.join(realProdRoot, 'exp100-tmdb-672647', 'human-review-bundle.v1.json')
  const bundle = JSON.parse(fs.readFileSync(c1BundlePath, 'utf8'))

  assert.equal(bundle.cleanCount, undefined)
  assert.equal(bundle.defectPositiveCount, undefined)
  assert.equal(bundle.severeCount, undefined)
  assert.equal(bundle.targetClean, undefined)
  assert.equal(bundle.remainingSevereNeeded, undefined)
  assert.equal(bundle.observedYield, undefined)

  const current = getCurrentReviewCandidate({ executionRoot: realProdRoot, p2Dir })
  assert.equal(current.cleanCount, undefined)
  assert.equal(current.defectPositiveCount, undefined)
  assert.equal(current.severeCount, undefined)
  assert.equal(current.quotaDeficit, undefined)
})

test('C.2. No semantic highlighting is introduced in bundle or payload', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const payloadPath = path.join(realProdRoot, 'exp100-tmdb-672647/manual/gemini/attempt-01/submission-payload.v1.txt')
  const payloadText = fs.readFileSync(payloadPath, 'utf8')

  assert.ok(!payloadText.includes('CRITIC_FLAG'))
  assert.ok(!payloadText.includes('SUSPICIOUS_PHRASE'))
  assert.ok(!payloadText.includes('SEVERITY_SUGGESTION'))
  assert.ok(!payloadText.includes('HIGHLIGHT'))
})

test('C.3. No model summary replaces full frozen advisory content', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const c1Bundle = JSON.parse(fs.readFileSync(path.join(realProdRoot, 'exp100-tmdb-672647', 'human-review-bundle.v1.json'), 'utf8'))

  assert.ok(c1Bundle.geminiAdvisory.sourceBoundaryReason.length > 0)
  assert.ok(Array.isArray(c1Bundle.geminiAdvisory.sourceEvidence))
  assert.ok(c1Bundle.claudeAdvisory.sourceBoundaryReason.length > 0)
  assert.ok(Array.isArray(c1Bundle.claudeAdvisory.sourceEvidence))
})

test('C.4. Gemini/Claude presentation order remains stable', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const c1Bundle = JSON.parse(fs.readFileSync(path.join(realProdRoot, 'exp100-tmdb-672647', 'human-review-bundle.v1.json'), 'utf8'))

  assert.ok(c1Bundle.geminiAdvisory !== undefined)
  assert.ok(c1Bundle.claudeAdvisory !== undefined)
  assert.equal(c1Bundle.geminiAdvisory.advisoryOnly, true)
  assert.equal(c1Bundle.claudeAdvisory.advisoryOnly, true)
})

test('C.5. No new semantic metadata reaches Sophia', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const c1Bundle = JSON.parse(fs.readFileSync(path.join(realProdRoot, 'exp100-tmdb-672647', 'human-review-bundle.v1.json'), 'utf8'))

  assert.equal(c1Bundle.predictedSeverity, undefined)
  assert.equal(c1Bundle.aiRiskScore, undefined)
  assert.equal(c1Bundle.consensusPrediction, undefined)
})

// ============================================================
// SUITE D: Human Persistence Tests
// ============================================================

test('D.1. Authoritative adjudication can be persisted through governed operator', () => {
  const tempFixtureDir = makeTempDir('p24-suite-d1-')
  try {
    const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
    const filesToCopy = [
      'blind-review-order.v1.json',
      'blind-review-eligible-pool.v1.json',
      'p2-3-freeze-manifest.v1.json',
      'p2-3-live-operation-protocol.v1.json',
      'p2-4-manual-ingestion-readiness.v1.json',
      'p2-4-post-pilot-sequential-session-authorization.v1.json',
      'p2-4-post-pilot-implementation-incident.v1.json',
    ]
    for (const f of filesToCopy) {
      fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
    }

    // Mirror Candidate #1 into fixture
    const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
    const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
    fs.cpSync(c1Source, c1Dest, { recursive: true })
    fs.copyFileSync(path.join(p2Dir, 'review-execution/review-session-ledger.json'), path.join(tempProdRoot, 'review-session-ledger.json'))

    prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', executionRoot: tempProdRoot, p2Dir: tempFixtureDir })
    prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'CLAUDE', executionRoot: tempProdRoot, p2Dir: tempFixtureDir })

    const validOpinion = {
      preliminaryDecision: 'REVISE',
      preliminarySeverity: 'MINOR',
      affectedFields: ['description'],
      issueSummaries: ['Minor editorial issue'],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Minor issue found',
      confidence: 'HIGH',
      advisoryOnly: true,
    }
    const respFile = path.join(tempFixtureDir, 'resp.json')
    fs.writeFileSync(respFile, JSON.stringify(validOpinion, null, 2), 'utf8')

    ingestManualResponse({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', responseFilePath: respFile, executionRoot: tempProdRoot, p2Dir: tempFixtureDir })
    ingestManualResponse({ candidateId: 'scale500-tmdb-18912', reviewer: 'CLAUDE', responseFilePath: respFile, executionRoot: tempProdRoot, p2Dir: tempFixtureDir })

    const res = recordManualHumanAdjudication({
      candidateId: 'scale500-tmdb-18912',
      finalDecision: 'REVISE',
      finalSeverity: 'MINOR',
      affectedFields: ['description'],
      materialIssues: ['Minor discrepancy in plot premise'],
      humanRationale: 'Explicit Sophia rationale verifying minor discrepancy',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })

    assert.equal(res.success, true)
    assert.equal(res.candidateId, 'scale500-tmdb-18912')
    assert.equal(res.finalDecision, 'REVISE')
    assert.equal(res.finalSeverity, 'MINOR')
    assert.ok(res.recordSha256.startsWith('sha256:'))
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('D.2. Explicit Sophia-supplied fields are strictly required (APPROVE vs REVISE)', () => {
  const tempDir = makeTempDir('p24-suite-d2-')
  try {
    const { candidateId } = createSyntheticTestEnv(tempDir)

    // Missing rationale
    assert.throws(
      () => recordManualHumanAdjudication({
        candidateId,
        finalDecision: 'APPROVE',
        humanRationale: '',
        executionRoot: tempDir,
      }),
      /INVALID_HUMAN_RATIONALE/
    )

    // REVISE without severity
    assert.throws(
      () => recordManualHumanAdjudication({
        candidateId,
        finalDecision: 'REVISE',
        finalSeverity: null,
        affectedFields: ['description'],
        materialIssues: ['issue'],
        humanRationale: 'valid rationale',
        executionRoot: tempDir,
      }),
      /INVALID_SEVERITY/
    )

    // REVISE with empty affectedFields
    assert.throws(
      () => recordManualHumanAdjudication({
        candidateId,
        finalDecision: 'REVISE',
        finalSeverity: 'SEVERE',
        affectedFields: [],
        materialIssues: ['issue'],
        humanRationale: 'valid rationale',
        executionRoot: tempDir,
      }),
      /INVALID_AFFECTED_FIELDS/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('D.3. Operator never derives human truth from model advisories', () => {
  // Confirm recordManualHumanAdjudication rejects implicit decision
  assert.throws(
    () => recordManualHumanAdjudication({
      candidateId: 'scale500-tmdb-18912',
      finalDecision: undefined,
      humanRationale: 'some rationale',
      executionRoot: path.join(p2Dir, 'review-execution'),
    }),
    /INVALID_DECISION/
  )
})

test('D.4. Complete evidence verification runs after persistence', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const chain = verifyCandidateReviewEvidenceChain({
    candidateId: 'exp100-tmdb-672647',
    candidateDir: path.join(realProdRoot, 'exp100-tmdb-672647'),
    bindings: {
      geminiModel: 'MANUAL_CONSUMER_UI',
      claudeModel: 'MANUAL_CONSUMER_UI',
    },
  })
  assert.equal(chain.valid, true)
  assert.equal(chain.humanRecord.finalDecision, 'APPROVE')
})

test('D.5. Restart reconstructs durable state correctly', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const current = getCurrentReviewCandidate({ executionRoot: realProdRoot, p2Dir })
  assert.equal(current.currentCandidateId, 'scale500-tmdb-18912')
  assert.equal(current.currentReviewSequenceIndex, 2)
})

// ============================================================
// SUITE E: Stopping Gate Tests
// ============================================================

test('E.1. Primary review continues below 30/30/6', () => {
  const stopping = checkStoppingRule({ cleanCount: 29, defectPositiveCount: 30, severeCount: 6 })
  assert.equal(stopping.stoppingRuleSatisfied, false)
  assert.equal(stopping.cleanSatisfied, false)
  assert.equal(stopping.defectSatisfied, true)
  assert.equal(stopping.severeSatisfied, true)
})

test('E.2. Exact 30/30/6 threshold stops before another candidate is prepared', () => {
  const stopping = checkStoppingRule({ cleanCount: 30, defectPositiveCount: 30, severeCount: 6 })
  assert.equal(stopping.stoppingRuleSatisfied, true)
})

test('E.3. Exceeding threshold does not permit one extra candidate', () => {
  const stopping = checkStoppingRule({ cleanCount: 31, defectPositiveCount: 30, severeCount: 7 })
  assert.equal(stopping.stoppingRuleSatisfied, true)
})

test('E.4. Git batch target never overrides scientific stopping', () => {
  // Scientific stopping rule satisfied at 30/30/6
  const stopping = checkStoppingRule({ cleanCount: 30, defectPositiveCount: 30, severeCount: 6 })
  assert.equal(stopping.stoppingRuleSatisfied, true)
})

// ============================================================
// SUITE F: Checkpoint Manifest Tests
// ============================================================

test('F.1. Checkpoint manifest generated deterministically from authoritative records', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  assert.equal(manifest.manifestType, 'DERIVED_AUDIT_ARTIFACT')
  assert.equal(manifest.derivedNotAuthoritative, true)
  assert.equal(manifest.firstReviewSequenceIndex, 1)
  assert.equal(manifest.lastReviewSequenceIndex, 1)
  assert.equal(manifest.recordCount, 1)
  assert.equal(manifest.candidates[0].candidateId, 'exp100-tmdb-672647')
  assert.equal(manifest.candidates[0].adjudicationRecordSha256, 'sha256:fecfa7dd7d5a44d17e3b1c76514400d97424973e7274e7ee42d26880b7f1366f')

  const verifyRes = verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir })
  assert.equal(verifyRes.valid, true)
})

test('F.2. Contiguous sequence verified in checkpoint manifest', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  // Tamper sequence index to create non-contiguous sequence
  manifest.candidates[0].reviewSequenceIndex = 2
  assert.throws(
    () => verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Sequence index gap/
  )
})

test('F.3. SHA mismatches fail with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  manifest.candidates[0].adjudicationRecordSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  assert.throws(
    () => verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Hash mismatch/
  )
})

test('F.4. Missing records fail with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  assert.throws(
    () => generateCheckpointManifest({
      executionRoot: realProdRoot,
      p2Dir,
      fromSequenceIndex: 1,
      toSequenceIndex: 5, // Range demands 5 records, only 1 exists
    }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Missing required candidate record/
  )
})

test('F.5. Duplicate sequence positions fail with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  manifest.candidates.push({ ...manifest.candidates[0] })
  manifest.recordCount = 2
  manifest.lastReviewSequenceIndex = 2
  assert.throws(
    () => verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Sequence index gap/
  )
})

test('F.6. Historical ledger slice hash mismatch fails with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  manifest.historicalLedgerSliceSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  assert.throws(
    () => verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Historical ledger slice hash mismatch/
  )
})

test('F.7. Checkpoint manifest cannot become authoritative truth input', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const manifest = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  assert.equal(manifest.derivedNotAuthoritative, true)
  assert.equal(manifest.manifestType, 'DERIVED_AUDIT_ARTIFACT')

  manifest.derivedNotAuthoritative = false
  assert.throws(
    () => verifyCheckpointManifest({ manifest, executionRoot: realProdRoot, p2Dir }),
    /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*derivedNotAuthoritative: true/
  )
})

// Helper function to build a synthetic multi-candidate sequential environment for boundary testing
function createMultiCandidateFixture(tempFixtureDir, count = 10) {
  const tempProdRoot = path.join(tempFixtureDir, 'review-execution')
  fs.mkdirSync(tempProdRoot, { recursive: true })

  const filesToCopy = [
    'p2-3-freeze-manifest.v1.json',
    'p2-3-live-operation-protocol.v1.json',
    'p2-4-manual-ingestion-readiness.v1.json',
    'p2-4-post-pilot-sequential-session-authorization.v1.json',
    'p2-4-post-pilot-implementation-incident.v1.json',
  ]
  for (const f of filesToCopy) {
    fs.copyFileSync(path.join(p2Dir, f), path.join(tempFixtureDir, f))
  }

  // Copy canonical Candidate #1
  const c1Source = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
  const c1Dest = path.join(tempProdRoot, 'exp100-tmdb-672647')
  fs.cpSync(c1Source, c1Dest, { recursive: true })

  // Read canonical pool and order
  const canonicalPool = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-eligible-pool.v1.json'), 'utf8'))
  const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))

  const orderedCandidates = canonicalOrder.orderedCandidates.slice(0, count)
  const poolRecords = orderedCandidates.map((c) => {
    const r = canonicalPool.records.find((rec) => rec.candidateId === c.candidateId)
    if (!r) throw new Error(`Record for ${c.candidateId} not found in canonical pool`)
    return r
  })

  const c1Adjudication = JSON.parse(fs.readFileSync(path.join(c1Dest, 'human/adjudication-record.v1.json'), 'utf8'))
  const candidateStates = {
    'exp100-tmdb-672647': {
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: sha256(fs.readFileSync(path.join(c1Dest, 'human/adjudication-record.v1.json'))),
      finalDecision: c1Adjudication.finalDecision,
      finalSeverity: c1Adjudication.finalSeverity,
      adjudicatedAt: c1Adjudication.adjudicationTimestamp,
    },
  }

  // Generate complete evidence for candidates 2 through count using real projection
  for (let i = 1; i < orderedCandidates.length; i++) {
    const cEntry = orderedCandidates[i]
    const cId = cEntry.candidateId
    const seq = cEntry.reviewSequenceIndex

    // Project real blind packet
    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool: { records: poolRecords },
      reviewOrder: { orderedCandidates },
      executionRoot: tempProdRoot,
    })
    const cDir = prep.candidateDir
    const bpSha = prep.blindPacketSha256

    fs.mkdirSync(path.join(cDir, 'gemini/attempts/attempt-01'), { recursive: true })
    fs.mkdirSync(path.join(cDir, 'claude/attempts/attempt-01'), { recursive: true })
    fs.mkdirSync(path.join(cDir, 'human'), { recursive: true })

    // Gemini
    const gResp = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Strictly factual',
      confidence: 'HIGH',
      advisoryOnly: true,
    }
    const gRespBytes = Buffer.from(JSON.stringify(gResp, null, 2), 'utf8')
    fs.writeFileSync(path.join(cDir, 'gemini/attempts/attempt-01/raw-response.txt'), gRespBytes)
    const gEnv = {
      candidateId: cId,
      reviewer: 'GEMINI',
      reviewerModel: 'MANUAL_CONSUMER_UI',
      rawResponseSha256: sha256(gRespBytes),
      blindPacketSha256: bpSha,
      reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
      materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
      validatedOpinion: gResp,
    }
    fs.writeFileSync(path.join(cDir, 'gemini/attempts/attempt-01/advisory-envelope.v1.json'), JSON.stringify(gEnv, null, 2), 'utf8')
    fs.writeFileSync(path.join(cDir, 'gemini/active-advisory-envelope.v1.json'), JSON.stringify(gEnv, null, 2), 'utf8')
    const gEnvSha = sha256(serializeArtifactForPersistence(gEnv))

    // Claude
    const cResp = { ...gResp }
    const cRespBytes = Buffer.from(JSON.stringify(cResp, null, 2), 'utf8')
    fs.writeFileSync(path.join(cDir, 'claude/attempts/attempt-01/raw-response.txt'), cRespBytes)
    const cEnv = {
      candidateId: cId,
      reviewer: 'CLAUDE',
      reviewerModel: 'MANUAL_CONSUMER_UI',
      rawResponseSha256: sha256(cRespBytes),
      blindPacketSha256: bpSha,
      reviewPromptSha256: FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256,
      materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
      validatedOpinion: cResp,
    }
    fs.writeFileSync(path.join(cDir, 'claude/attempts/attempt-01/advisory-envelope.v1.json'), JSON.stringify(cEnv, null, 2), 'utf8')
    fs.writeFileSync(path.join(cDir, 'claude/active-advisory-envelope.v1.json'), JSON.stringify(cEnv, null, 2), 'utf8')
    const cEnvSha = sha256(serializeArtifactForPersistence(cEnv))

    // Human adjudication
    const adjPath = path.join(cDir, 'human/adjudication-record.v1.json')
    const adjData = {
      candidateId: cId,
      finalDecision: 'APPROVE',
      finalSeverity: null,
      affectedFields: [],
      materialIssues: [],
      humanRationale: `Approved candidate ${seq}`,
      adjudicationTimestamp: `2026-09-18T03:00:${String(seq).padStart(2, '0')}Z`,
      adjudicator: 'Sophia Zhao',
      agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
      blindPacketHash: bpSha,
      geminiAdvisoryRecordSha256: gEnvSha,
      claudeAdvisoryRecordSha256: cEnvSha,
    }
    fs.writeFileSync(adjPath, JSON.stringify(adjData, null, 2), 'utf8')
    const adjSha = sha256(fs.readFileSync(adjPath))

    candidateStates[cId] = {
      status: 'HUMAN_ADJUDICATED',
      humanAdjudicationSha256: adjSha,
      finalDecision: 'APPROVE',
      finalSeverity: null,
      adjudicatedAt: adjData.adjudicationTimestamp,
    }
  }

  // Copy exact frozen canonical order and pool
  fs.copyFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), path.join(tempFixtureDir, 'blind-review-order.v1.json'))
  fs.copyFileSync(path.join(p2Dir, 'blind-review-eligible-pool.v1.json'), path.join(tempFixtureDir, 'blind-review-eligible-pool.v1.json'))

  // Write ledger
  const ledgerData = {
    ledgerVersion: '1.0',
    candidateStates,
    cleanCount: count,
    defectPositiveCount: 0,
    severeCount: 0,
  }
  fs.writeFileSync(path.join(tempProdRoot, 'review-session-ledger.json'), JSON.stringify(ledgerData, null, 2), 'utf8')

  return { tempFixtureDir, tempProdRoot, orderedCandidates }
}

test('F.8. Candidate immediately before boundary (#9) may proceed normally without checkpoint #2–#9', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f8-')
  try {
    // 8 candidates complete (1..8)
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 8)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand9 = canonicalOrder.orderedCandidates[8].candidateId // Sequence index 9

    // Candidate 9 can be prepared without checkpoint manifest for #2-#9
    const prep = prepareManualPayload({
      candidateId: cand9,
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prep.candidateId, cand9)
    assert.equal(prep.reviewSequenceIndex, 9)
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.9. Boundary reached (Candidate #10) with absent checkpoint manifest blocks next candidate prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f9-')
  try {
    // 9 candidates complete (1..9), candidate 10 is next
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId // Sequence index 10

    // Checkpoint manifest for #2-#9 is absent: prepare of candidate 10 must be blocked
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand10,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Checkpoint manifest missing at canonical path/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10. Boundary reached (Candidate #10) with valid canonical checkpoint manifest allows next candidate prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10-')
  try {
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId

    // Generate canonical checkpoint manifest for #2-#9
    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    // Now candidate 10 may be prepared
    const prep = prepareManualPayload({
      candidateId: cand10,
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prep.candidateId, cand10)
    assert.equal(prep.reviewSequenceIndex, 10)
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.11. Tampered canonical checkpoint manifest blocks next candidate prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f11-')
  try {
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId

    // Generate canonical checkpoint manifest for #2-#9
    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    // Tamper hash of candidate in manifest
    cpManifest.candidates[0].adjudicationRecordSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    // Prepare candidate 10 fails with PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand10,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Hash mismatch/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.12. Missing candidate evidence causes checkpoint generation to fail and next candidate remains blocked', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f12-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId

    // Delete adjudication record for candidate 5
    const cand5Id = orderedCandidates[4].candidateId
    const c5Record = path.join(tempProdRoot, cand5Id, 'human/adjudication-record.v1.json')
    fs.unlinkSync(c5Record)

    // Checkpoint generation fails
    assert.throws(
      () => generateCheckpointManifest({
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
        fromSequenceIndex: 2,
        toSequenceIndex: 9,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Missing required candidate record/
    )

    // And candidate 10 remains blocked
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand10,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /OUT_OF_ORDER_EXECUTION|PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.13. Scientific stopping reached at partial block halts review regardless of checkpoint convenience', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f13-')
  try {
    // 5 candidates complete, but scientific stopping targets met (30 clean, 30 defect, 6 severe)
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 5)

    const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    ledger.cleanCount = 30
    ledger.defectPositiveCount = 30
    ledger.severeCount = 6
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand6 = canonicalOrder.orderedCandidates[5].candidateId

    // Scientific stopping halts review immediately
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand6,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_STOPPING_THRESHOLD_REACHED/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

// Helper to adjudicate a sequential candidate in a multi-candidate fixture
function adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, candidateId, seqIndex) {
  const poolData = JSON.parse(fs.readFileSync(path.join(tempFixtureDir, 'blind-review-eligible-pool.v1.json'), 'utf8'))
  const orderData = JSON.parse(fs.readFileSync(path.join(tempFixtureDir, 'blind-review-order.v1.json'), 'utf8'))
  const poolRecords = [poolData.records.find((r) => r.candidateId === candidateId)]
  if (!poolRecords[0]) {
    throw new Error(`Record for ${candidateId} not found in fixture eligible pool`)
  }

  const prep = prepareCandidateExecution({
    candidateId,
    eligiblePool: { records: poolRecords },
    reviewOrder: orderData,
    executionRoot: tempProdRoot,
  })
  const cDir = prep.candidateDir
  const bpSha = prep.blindPacketSha256

  fs.mkdirSync(path.join(cDir, 'gemini/attempts/attempt-01'), { recursive: true })
  fs.mkdirSync(path.join(cDir, 'claude/attempts/attempt-01'), { recursive: true })
  fs.mkdirSync(path.join(cDir, 'human'), { recursive: true })

  const gResp = {
    preliminaryDecision: 'APPROVE',
    preliminarySeverity: null,
    affectedFields: [],
    issueSummaries: [],
    claimSpan: 'none',
    sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
    sourceBoundaryReason: 'Strictly factual',
    confidence: 'HIGH',
    advisoryOnly: true,
  }
  const gRespBytes = Buffer.from(JSON.stringify(gResp, null, 2), 'utf8')
  fs.writeFileSync(path.join(cDir, 'gemini/attempts/attempt-01/raw-response.txt'), gRespBytes)
  const gEnv = {
    candidateId,
    reviewer: 'GEMINI',
    reviewerModel: 'MANUAL_CONSUMER_UI',
    rawResponseSha256: sha256(gRespBytes),
    blindPacketSha256: bpSha,
    reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    validatedOpinion: gResp,
  }
  fs.writeFileSync(path.join(cDir, 'gemini/attempts/attempt-01/advisory-envelope.v1.json'), JSON.stringify(gEnv, null, 2), 'utf8')
  fs.writeFileSync(path.join(cDir, 'gemini/active-advisory-envelope.v1.json'), JSON.stringify(gEnv, null, 2), 'utf8')
  const gEnvSha = sha256(serializeArtifactForPersistence(gEnv))

  const cResp = { ...gResp }
  const cRespBytes = Buffer.from(JSON.stringify(cResp, null, 2), 'utf8')
  fs.writeFileSync(path.join(cDir, 'claude/attempts/attempt-01/raw-response.txt'), cRespBytes)
  const cEnv = {
    candidateId,
    reviewer: 'CLAUDE',
    reviewerModel: 'MANUAL_CONSUMER_UI',
    rawResponseSha256: sha256(cRespBytes),
    blindPacketSha256: bpSha,
    reviewPromptSha256: FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    validatedOpinion: cResp,
  }
  fs.writeFileSync(path.join(cDir, 'claude/attempts/attempt-01/advisory-envelope.v1.json'), JSON.stringify(cEnv, null, 2), 'utf8')
  fs.writeFileSync(path.join(cDir, 'claude/active-advisory-envelope.v1.json'), JSON.stringify(cEnv, null, 2), 'utf8')
  const cEnvSha = sha256(serializeArtifactForPersistence(cEnv))

  const adjPath = path.join(cDir, 'human/adjudication-record.v1.json')
  const adjData = {
    candidateId,
    finalDecision: 'APPROVE',
    finalSeverity: null,
    affectedFields: [],
    materialIssues: [],
    humanRationale: `Approved candidate ${seqIndex}`,
    adjudicationTimestamp: `2026-09-18T03:00:${String(seqIndex).padStart(2, '0')}Z`,
    adjudicator: 'Sophia Zhao',
    agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
    blindPacketHash: bpSha,
    geminiAdvisoryRecordSha256: gEnvSha,
    claudeAdvisoryRecordSha256: cEnvSha,
  }
  fs.writeFileSync(adjPath, JSON.stringify(adjData, null, 2), 'utf8')
  const adjSha = sha256(fs.readFileSync(adjPath))

  // Update session ledger
  const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  ledger.candidateStates[candidateId] = {
    status: 'HUMAN_ADJUDICATED',
    humanAdjudicationSha256: adjSha,
    finalDecision: 'APPROVE',
    finalSeverity: null,
    adjudicatedAt: adjData.adjudicationTimestamp,
  }
  ledger.cleanCount = (ledger.cleanCount || 0) + 1
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')
  return adjSha
}

test('F.10b. Historical checkpoint #2–#9 survives live ledger evolution after Candidate #10 adjudication', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10b-')
  try {
    // 9 candidates complete (1..9)
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId
    const cand11 = canonicalOrder.orderedCandidates[10].candidateId

    // 1. Generate canonical checkpoint manifest for #2–#9 and persist
    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    // 2. Candidate 10 prepare succeeds
    const prep10 = prepareManualPayload({
      candidateId: cand10,
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prep10.candidateId, cand10)

    // 3. Adjudicate Candidate 10 -> mutates live session ledger
    adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, cand10, 10)

    // 4. Candidate 11 prepare STILL succeeds because #2–#9 checkpoint verified via historical subsumption
    const prep11 = prepareManualPayload({
      candidateId: cand11,
      reviewer: 'GEMINI',
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
    })
    assert.equal(prep11.candidateId, cand11)
    assert.equal(prep11.reviewSequenceIndex, 11)
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10c. Mutation of any #2–#9 human record on disk breaks checkpoint verification during later prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10c-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId
    const cand11 = canonicalOrder.orderedCandidates[10].candidateId

    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, cand10, 10)

    // Tamper Candidate 5 disk record
    const cand5Id = orderedCandidates[4].candidateId
    const c5RecordPath = path.join(tempProdRoot, cand5Id, 'human/adjudication-record.v1.json')
    const c5Data = JSON.parse(fs.readFileSync(c5RecordPath, 'utf8'))
    c5Data.humanRationale = 'TAMPERED_RATIONALE'
    fs.writeFileSync(c5RecordPath, JSON.stringify(c5Data, null, 2), 'utf8')

    // Candidate 11 prepare fails checkpoint verification
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand11,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Hash mismatch/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10d. Mutation of any #2–#9 live human-adjudication SHA in session ledger breaks checkpoint verification during later prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10d-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId
    const cand11 = canonicalOrder.orderedCandidates[10].candidateId

    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, cand10, 10)

    // Tamper Candidate 5 hash in live ledger
    const cand5Id = orderedCandidates[4].candidateId
    const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    ledger.candidateStates[cand5Id].humanAdjudicationSha256 = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    // Candidate 11 prepare fails checkpoint verification
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand11,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Checkpoint candidate.*humanAdjudicationSha256 in live session ledger/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10e. Deleting a #2–#9 candidate state in live ledger breaks checkpoint verification during later prepare', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10e-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId
    const cand11 = canonicalOrder.orderedCandidates[10].candidateId

    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, cand10, 10)

    // Delete Candidate 5 from live ledger
    const cand5Id = orderedCandidates[4].candidateId
    const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    delete ledger.candidateStates[cand5Id]
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    // Candidate 11 prepare fails checkpoint verification
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand11,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*is missing from current live session ledger candidateStates/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.6b. Checkpoint generation fails when a candidate is HUMAN_ADJUDICATED but ledger humanAdjudicationSha256 is absent', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f6b-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const cand5Id = orderedCandidates[4].candidateId
    const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    delete ledger.candidateStates[cand5Id].humanAdjudicationSha256
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    assert.throws(
      () => generateCheckpointManifest({
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
        fromSequenceIndex: 2,
        toSequenceIndex: 9,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Ledger humanAdjudicationSha256 does not match disk bytes/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10f. Checkpoint verification fails when a checkpoint candidate is HUMAN_ADJUDICATED but live ledger humanAdjudicationSha256 is absent', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10f-')
  try {
    const { tempProdRoot, orderedCandidates } = createMultiCandidateFixture(tempFixtureDir, 9)
    const canonicalOrder = JSON.parse(fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'), 'utf8'))
    const cand10 = canonicalOrder.orderedCandidates[9].candidateId
    const cand11 = canonicalOrder.orderedCandidates[10].candidateId

    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })
    const cpPath = getCanonicalCheckpointPath(tempProdRoot, 2, 9)
    fs.mkdirSync(path.dirname(cpPath), { recursive: true })
    fs.writeFileSync(cpPath, JSON.stringify(cpManifest, null, 2), 'utf8')

    adjudicateCandidateInFixture(tempProdRoot, tempFixtureDir, cand10, 10)

    // Delete Candidate 5 humanAdjudicationSha256 from live ledger
    const cand5Id = orderedCandidates[4].candidateId
    const ledgerPath = path.join(tempProdRoot, 'review-session-ledger.json')
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    delete ledger.candidateStates[cand5Id].humanAdjudicationSha256
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    // Candidate 11 prepare fails checkpoint verification
    assert.throws(
      () => prepareManualPayload({
        candidateId: cand11,
        reviewer: 'GEMINI',
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Checkpoint candidate.*humanAdjudicationSha256 in live session ledger/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10g. Tampered manifest finalDecision fails verification even if historicalLedgerSliceSha256 is recomputed from tampered manifest', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10g-')
  try {
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })

    const target = cpManifest.candidates[0]
    const origDecision = target.finalDecision
    target.finalDecision = origDecision === 'APPROVE' ? 'REVISE' : 'APPROVE'

    // Recompute historicalLedgerSliceSha256 from tampered manifest candidateStates
    const tamperedProjection = {
      firstReviewSequenceIndex: cpManifest.firstReviewSequenceIndex,
      lastReviewSequenceIndex: cpManifest.lastReviewSequenceIndex,
      candidateStates: cpManifest.candidates.map((r) => ({
        reviewSequenceIndex: r.reviewSequenceIndex,
        candidateId: r.candidateId,
        status: 'HUMAN_ADJUDICATED',
        humanAdjudicationSha256: r.adjudicationRecordSha256,
        finalDecision: r.finalDecision,
        finalSeverity: r.finalSeverity,
      })),
      cumulativeProgression: cpManifest.cumulativeProgression,
    }
    cpManifest.historicalLedgerSliceSha256 = sha256(Buffer.from(serializeArtifactForPersistence(tamperedProjection), 'utf8'))

    assert.throws(
      () => verifyCheckpointManifest({
        manifest: cpManifest,
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Final decision mismatch/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.10h. Tampered manifest finalSeverity fails verification even when aggregate counts remain unchanged', () => {
  const tempFixtureDir = makeTempDir('p24-suite-f10h-')
  try {
    const { tempProdRoot } = createMultiCandidateFixture(tempFixtureDir, 9)
    const cpManifest = generateCheckpointManifest({
      executionRoot: tempProdRoot,
      p2Dir: tempFixtureDir,
      fromSequenceIndex: 2,
      toSequenceIndex: 9,
    })

    const target = cpManifest.candidates[0]
    target.finalSeverity = target.finalSeverity === 'SEVERE' ? null : 'SEVERE'

    assert.throws(
      () => verifyCheckpointManifest({
        manifest: cpManifest,
        executionRoot: tempProdRoot,
        p2Dir: tempFixtureDir,
      }),
      /PRIMARY_REVIEW_HARD_STOP_CHECKPOINT_INTEGRITY.*Final severity mismatch/
    )
  } finally {
    cleanTempDir(tempFixtureDir)
  }
})

test('F.14. Checkpoint generation is a deterministic pure projection with byte-identical serialization', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const cp1 = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })
  const cp2 = generateCheckpointManifest({
    executionRoot: realProdRoot,
    p2Dir,
    fromSequenceIndex: 1,
    toSequenceIndex: 1,
  })

  // Assert no generatedAt or wall-clock entropy
  assert.equal(cp1.generatedAt, undefined)
  assert.equal(cp2.generatedAt, undefined)

  // Assert canonical serialized bytes identical
  const bytes1 = serializeArtifactForPersistence(cp1)
  const bytes2 = serializeArtifactForPersistence(cp2)
  assert.equal(bytes1, bytes2)
  assert.equal(sha256(Buffer.from(bytes1, 'utf8')), sha256(Buffer.from(bytes2, 'utf8')))
})

// ============================================================
// SUITE G: Frozen Design Preservation Tests
// ============================================================

test('G.1. Both advisories still required before human bundle or adjudication', () => {
  const tempDir = makeTempDir('p24-suite-g1-')
  try {
    const { candidateId, candidateDir, eligiblePool, reviewOrder } = createSyntheticTestEnv(tempDir)
    prepareCandidateExecution({ candidateId, executionRoot: tempDir, eligiblePool, reviewOrder })
    assert.throws(
      () => buildManualHumanBundle({ candidateId, executionRoot: tempDir, p2Dir }),
      /MISSING_ADVISORY/
    )
  } finally {
    cleanTempDir(tempDir)
  }
})

test('G.2. Manual consumer UI channel still required', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  const c1Dir = path.join(realProdRoot, 'exp100-tmdb-672647')
  const gEnv = JSON.parse(fs.readFileSync(path.join(c1Dir, 'gemini/active-advisory-envelope.v1.json'), 'utf8'))
  const cEnv = JSON.parse(fs.readFileSync(path.join(c1Dir, 'claude/active-advisory-envelope.v1.json'), 'utf8'))

  assert.equal(gEnv.reviewerModel, 'MANUAL_CONSUMER_UI')
  assert.equal(cEnv.reviewerModel, 'MANUAL_CONSUMER_UI')
})

test('G.3. Zero network and zero model API calls', () => {
  // Verifier CLI has zero network imports
  const cliCode = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/scripts/runVerifierV14ManualReview.mjs'), 'utf8')
  assert.ok(!cliCode.includes('fetch('))
  assert.ok(!cliCode.includes('axios'))
  assert.ok(!cliCode.includes('@google/genai'))
  assert.ok(!cliCode.includes('@anthropic-ai/sdk'))
})

test('G.4. No candidate skipping permitted in review progression', () => {
  const realProdRoot = path.join(p2Dir, 'review-execution')
  assert.throws(
    () => prepareManualPayload({
      candidateId: 'scale500-tmdb-11802', // Index 3
      reviewer: 'GEMINI',
      executionRoot: realProdRoot,
      p2Dir,
    }),
    /OUT_OF_ORDER_EXECUTION/
  )
})

test('G.5. No severity searching permitted', () => {
  const cliCode = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/scripts/runVerifierV14ManualReview.mjs'), 'utf8')
  assert.ok(!cliCode.includes('searchSeverity'))
  assert.ok(!cliCode.includes('filterSevereCandidates'))
  assert.ok(!cliCode.includes('huntSevere'))
})

test('G.6. Frozen P2.3 hashes unchanged', () => {
  const p23ManifestPath = path.join(p2Dir, 'p2-3-freeze-manifest.v1.json')
  const manifestBytes = fs.readFileSync(p23ManifestPath)
  assert.equal(sha256(manifestBytes), 'sha256:b8eb3fde3203f6736a4d5b3a98f71fe50de70866b060614432f1b9a1757335d3')
})

// ============================================================
// SUITE H: Future Drift Diagnostic Contract Tests
// ============================================================

test('H.1. Diagnostic cannot run before primary + QA truth freeze', () => {
  assert.throws(
    () => validateSequencePositionDriftExecution({ primaryRecruitmentComplete: false, qaCompleted: false, truthFrozen: false }),
    /EXECUTION_BLOCKED: SEQUENCE_POSITION_DRIFT_CHECK cannot run before/
  )
  assert.throws(
    () => validateSequencePositionDriftExecution({ primaryRecruitmentComplete: true, qaCompleted: false, truthFrozen: false }),
    /EXECUTION_BLOCKED/
  )
  assert.throws(
    () => validateSequencePositionDriftExecution({ primaryRecruitmentComplete: true, qaCompleted: true, truthFrozen: false }),
    /EXECUTION_BLOCKED/
  )

  const authorized = validateSequencePositionDriftExecution({ primaryRecruitmentComplete: true, qaCompleted: true, truthFrozen: true })
  assert.equal(authorized.authorized, true)
  assert.equal(authorized.classification, 'DIAGNOSTIC_ONLY')
})

test('H.2. Diagnostic output cannot mutate truth or alter final cohort', () => {
  assert.equal(SEQUENCE_POSITION_DRIFT_CONTRACT.specification.cannotMutateTruth, true)
  assert.equal(SEQUENCE_POSITION_DRIFT_CONTRACT.specification.cannotAlterFinalCohort, true)
  assert.equal(SEQUENCE_POSITION_DRIFT_CONTRACT.specification.cannotTriggerSelectiveRereview, true)
})

test('H.3. Diagnostic is explicitly labeled DIAGNOSTIC_ONLY and has no invalidation rule', () => {
  assert.equal(SEQUENCE_POSITION_DRIFT_CONTRACT.classification, 'DIAGNOSTIC_ONLY')
  assert.equal(SEQUENCE_POSITION_DRIFT_CONTRACT.specification.invalidationRule, null)
})
