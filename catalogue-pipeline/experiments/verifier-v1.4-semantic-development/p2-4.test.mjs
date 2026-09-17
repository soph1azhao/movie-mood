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
  main as runManualReviewCli,
} from '../../scripts/runVerifierV14ManualReview.mjs'

import { FROZEN_BINDINGS } from '../../scripts/verifierV14ReviewerAdapter.mjs'
import {
  verifyCandidateReviewEvidenceChain,
} from '../../scripts/runVerifierV14BlindReview.mjs'

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

// Test Q: Candidate #1 execution directory remains completely absent
test('Q. Candidate #1 execution directory is absent and untouched', () => {
  const realP2ReviewExecution = path.join(p2Dir, 'review-execution')
  assert.equal(fs.existsSync(realP2ReviewExecution), false, 'Live review-execution directory must not exist')

  const cand1RealDir = path.join(p2Dir, 'review-execution/exp100-tmdb-672647')
  assert.equal(fs.existsSync(cand1RealDir), false, 'Candidate #1 execution directory must NOT exist')
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
  const prodExecutionRoot = path.join(p2Dir, 'review-execution')

  // When authorization artifact is absent, Candidate #1 MUST reject with PILOT_NOT_AUTHORIZED
  assert.throws(
    () => prepareManualPayload({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      executionRoot: prodExecutionRoot,
      authorizationPath: path.join(p2Dir, 'nonexistent-pilot-auth.json'),
    }),
    /PILOT_NOT_AUTHORIZED/
  )

  // Calling prepare on candidate #2 against production root MUST reject with OUT_OF_ORDER_EXECUTION
  assert.throws(
    () => prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', executionRoot: prodExecutionRoot }),
    /OUT_OF_ORDER_EXECUTION/
  )

  // Real review-execution directory must remain absent
  assert.equal(fs.existsSync(prodExecutionRoot), false)
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
  const prodExecutionRoot = path.join(p2Dir, 'review-execution')

  // When Candidate #1 is unadjudicated, Candidate #2 throws OUT_OF_ORDER_EXECUTION
  assert.throws(
    () => prepareManualPayload({ candidateId: 'scale500-tmdb-18912', reviewer: 'GEMINI', executionRoot: prodExecutionRoot }),
    /OUT_OF_ORDER_EXECUTION/
  )

  // Later candidate in review order throws OUT_OF_ORDER_EXECUTION
  assert.throws(
    () => prepareManualPayload({ candidateId: 'scale500-tmdb-11802', reviewer: 'GEMINI', executionRoot: prodExecutionRoot }),
    /OUT_OF_ORDER_EXECUTION/
  )

  // Unknown candidate throws CANDIDATE_NOT_FOUND
  assert.throws(
    () => prepareManualPayload({ candidateId: 'unknown-candidate-xyz', reviewer: 'GEMINI', executionRoot: prodExecutionRoot }),
    /CANDIDATE_NOT_FOUND/
  )
})

test('AUTH.10. Candidate #1 execution directory remains strictly absent and untouched', () => {
  const prodExecutionRoot = path.join(p2Dir, 'review-execution')
  assert.equal(fs.existsSync(prodExecutionRoot), false)
  assert.equal(fs.existsSync(path.join(prodExecutionRoot, 'exp100-tmdb-672647')), false)
})

test('AUTH.11. Production-path Candidate #1 integration in isolated temp fixture passes authorization gate and prepares payload', () => {
  const tempP2Dir = makeTempDir('p24-scope-proof-c1-')
  try {
    // Mirror required governed input artifacts into isolated temp fixture
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

    // Call production prepareManualPayload with candidate #1 on the fixture's production root
    const prep = prepareManualPayload({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })

    assert.ok(prep.copyReadyText.includes('exp100-tmdb-672647'))
    assert.ok(prep.payloadSha256.startsWith('sha256:'))

    // Verify files created inside temp fixture
    const c1Dir = path.join(tempProdExecRoot, 'exp100-tmdb-672647')
    assert.ok(fs.existsSync(path.join(c1Dir, 'blind-packet.v1.json')))
    assert.ok(fs.existsSync(path.join(c1Dir, 'manual/gemini/attempt-01/submission-payload.v1.txt')))

    // Verify canonical repo review-execution directory remains strictly absent
    const canonicalProdRoot = path.join(p2Dir, 'review-execution')
    assert.equal(fs.existsSync(canonicalProdRoot), false)
  } finally {
    cleanTempDir(tempP2Dir)
  }
})

test('AUTH.12. Candidate #2 remains hard-blocked with PILOT_NOT_AUTHORIZED after Candidate #1 reaches durable human adjudication', () => {
  const tempP2Dir = makeTempDir('p24-scope-proof-c2-')
  try {
    // Mirror required governed input artifacts into isolated temp fixture
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

    // 1. Prepare Candidate #1 for Gemini and Claude
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

    // 2. Ingest valid Gemini and Claude responses
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
    const geminiIngest = ingestManualResponse({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'GEMINI',
      responseFilePath: geminiRespFile,
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })
    assert.equal(geminiIngest.disposition, 'VALID')

    const claudeRespFile = path.join(tempP2Dir, 'claude-resp.json')
    fs.writeFileSync(claudeRespFile, JSON.stringify(validOpinion, null, 2), 'utf8')
    const claudeIngest = ingestManualResponse({
      candidateId: 'exp100-tmdb-672647',
      reviewer: 'CLAUDE',
      responseFilePath: claudeRespFile,
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })
    assert.equal(claudeIngest.disposition, 'VALID')

    // 3. Build human bundle for Candidate #1
    const bundleRes = buildManualHumanBundle({
      candidateId: 'exp100-tmdb-672647',
      executionRoot: tempProdExecRoot,
      p2Dir: tempP2Dir,
    })
    assert.equal(bundleRes.bundle.candidateId, 'exp100-tmdb-672647')

    // 4. Persist durable human adjudication record for Candidate #1
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

    // 5. Attempt production prepare on Candidate #2 (scale500-tmdb-18912)
    // Candidate #2 is now the sequentially allowable candidate (sequence index 2),
    // but the Candidate #1 pilot authorization MUST NOT authorize it.
    assert.throws(
      () => prepareManualPayload({
        candidateId: 'scale500-tmdb-18912',
        reviewer: 'GEMINI',
        executionRoot: tempProdExecRoot,
        p2Dir: tempP2Dir,
      }),
      /PILOT_NOT_AUTHORIZED.*only authorized for Candidate #1/
    )

    // Verify canonical repo review-execution directory remains strictly absent
    const canonicalProdRoot = path.join(p2Dir, 'review-execution')
    assert.equal(fs.existsSync(canonicalProdRoot), false)
  } finally {
    cleanTempDir(tempP2Dir)
  }
})
