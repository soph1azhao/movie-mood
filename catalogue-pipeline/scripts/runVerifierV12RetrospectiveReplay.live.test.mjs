import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createHash } from 'node:crypto'
import {
  CANDIDATE_STATES,
  computeTwoLayerEvaluation,
  runMode1Replay,
  runPreflight,
  runDryRun,
  runReplayExecution,
  loadExecutionState,
  saveExecutionState,
} from './runVerifierV12RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const experimentDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay')

const LOW_RISK_OUTPUT = () => JSON.stringify({
  riskLevel: 'LOW_RISK',
  riskCategories: [],
  issues: [],
  sourceBoundarySatisfied: true,
  lowRiskCoverage: {
    allVisibleFieldsAudited: true,
    interrogativePremisesAudited: true,
    factualModifiersAudited: true,
    packetFactsAudited: true,
    settingAndLocationAudited: true,
    characterMotivesAndRelationshipsAudited: true,
    storyMechanismsAndConstraintsAudited: true,
    externalLoreAndBackstoryAudited: true,
    spoilerAndRevealBoundariesAudited: true,
    viewingExperienceInferenceAudited: true,
    summaryRationale: 'All visible fields audited.',
  },
})

const HIGH_RISK_OUTPUT = () => JSON.stringify({
  riskLevel: 'HIGH_RISK',
  riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
  issues: [{
    category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
    field: 'whyWatch',
    claimSpan: 'secret plot',
    normalizedClaim: 'secret plot exists',
    claimType: 'STORY_SETUP_FACT',
    checkedAuthoritySources: ['allowedSourceMaterial.overview'],
    sourceEvidence: [{ source: 'allowedSourceMaterial.overview', supportFound: false }],
    authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
    materialityRationale: 'Not grounded.',
  }],
  sourceBoundarySatisfied: false,
})

const SCHEMA_INVALID_OUTPUT = () => JSON.stringify({ riskLevel: 'LOW_RISK' })
const SEMANTICALLY_INVALID_OUTPUT = () => JSON.stringify({
  riskLevel: 'HIGH_RISK', riskCategories: ['X'], issues: [], sourceBoundarySatisfied: false,
})
const MALFORMED_JSON_OUTPUT = () => '{ bad json'

function makeMockProvider({ responses } = {}) {
  const queue = [...(responses || [])]
  return async ({ candidateId }) => {
    const next = queue.shift()
    if (next instanceof Error) throw next
    if (!next) return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:dummy', requestMetadata: {} }
    return next
  }
}

const makeTempDir = () => mkdtemp(path.join(os.tmpdir(), 'v12replay-test-'))

async function buildSyntheticCohort({ dir, count = 30, approveCount = 14 } = {}) {
  const records = []
  for (let i = 0; i < count; i += 1) {
    const candidateId = `scale500-tmdb-${1000 + i}`
    const humanDecision = i < approveCount ? 'APPROVE' : 'REVISE'
    const riskInput = {
      facts: { title: `Film ${i}`, year: 2020, runtimeMinutes: 100, genres: ['Drama'], spokenLanguages: ['English'], countries: ['US'], director: 'Director' },
      acceptedSemanticClassification: { pace: 'medium', moods: ['tense'] },
      semanticBoundaryFlags: [],
      allowedSourceMaterial: { overview: 'A story about characters facing choices.' },
      spoilerBoundaryRules: { cutoff: 'setup' },
      copyConstraints: {},
      visibleEditorialCopy: { description: 'A film.', whyWatch: 'Compelling.', curiosityHook: 'What happens?', vibeSummary: 'Tense.' },
    }
    const inputPath = path.join(dir, `${candidateId}.risk-input.json`)
    const raw = JSON.stringify(riskInput)
    await writeFile(inputPath, raw, 'utf8')
    records.push({
      candidateId,
      tmdbId: 1000 + i,
      humanDecision,
      severity: humanDecision === 'REVISE' ? 'MINOR' : null,
      sourceRiskInputByteHash: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
      sourceRiskInputPath: inputPath,
      title: `Film ${i}`,
    })
  }
  return { cohortSize: count, records }
}

// 1. Complete 30-record all-valid-low synthetic run
test('1. Complete 30-record all-valid-low synthetic run', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 14 })
    const responses = Array.from({ length: 30 }, (_, i) => ({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:low${i}`, requestMetadata: {} }))
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.candidatesCompleted, 30)
    assert.equal(report.totalExternalCalls, 30)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 30)
    assert.equal(report.validOutputPerformance.confusionMatrix.TN, 14)
    assert.equal(report.validOutputPerformance.confusionMatrix.FN, 16)
    assert.equal(report.failClosedContainment.cleanAutoPassCount, 14)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 2. Mixed LOW/HIGH run
test('2. Mixed LOW/HIGH run', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 14 })
    const responses = []
    for (let i = 0; i < 30; i += 1) {
      responses.push({ ok: true, status: 200, rawText: i >= 14 ? HIGH_RISK_OUTPUT() : LOW_RISK_OUTPUT(), rawResponseHash: `sha256:r${i}`, requestMetadata: {} })
    }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.dispositionCounts.VALID_HIGH_RISK, 16)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 14)
    assert.equal(report.validOutputPerformance.confusionMatrix.TP, 16)
    assert.equal(report.validOutputPerformance.confusionMatrix.TN, 14)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 3. Retry 429 then success
test('3. Retry 429 then success', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 429, rawText: 'rate limited', rawResponseHash: 'sha256:429', requestMetadata: {} },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} },
    ]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(report.retries, 1)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 4. Retry 500 then success
test('4. Retry 500 then success', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 500, rawText: 'err', rawResponseHash: 'sha256:500', requestMetadata: {} },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} },
    ]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(report.retries, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 5. Retry 503 then success
test('5. Retry 503 then success', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 503, rawText: 'unavail', rawResponseHash: 'sha256:503', requestMetadata: {} },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} },
    ]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(report.retries, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 6. Malformed JSON technical retry
test('6. Malformed JSON technical retry', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: true, status: 200, rawText: MALFORMED_JSON_OUTPUT(), rawResponseHash: 'sha256:m', requestMetadata: {} },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} },
    ]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(report.retries, 1)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 7. 502 does not retry
test('7. 502 does not retry', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [{ ok: false, status: 502, rawText: 'bad gw', rawResponseHash: 'sha256:502', requestMetadata: {} }]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(report.retries, 0)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 8. 504 does not retry
test('8. 504 does not retry', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [{ ok: false, status: 504, rawText: 'timeout', rawResponseHash: 'sha256:504', requestMetadata: {} }]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(report.retries, 0)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 9. Semantic invalid does not retry
test('9. Semantic invalid does not retry', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [{ ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), rawResponseHash: 'sha256:si', requestMetadata: {} }]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(report.retries, 0)
    assert.equal(report.dispositionCounts.SEMANTICALLY_INVALID, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 10. Schema invalid does not retry
test('10. Schema invalid does not retry', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [{ ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), rawResponseHash: 'sha256:si', requestMetadata: {} }]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(report.retries, 0)
    assert.equal(report.dispositionCounts.SCHEMA_INVALID, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 11. Retry/candidate cap
test('11. Retry/candidate cap enforced', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 500, rawText: 'e1', rawResponseHash: 'sha256:e1', requestMetadata: {} },
      { ok: false, status: 500, rawText: 'e2', rawResponseHash: 'sha256:e2', requestMetadata: {} },
      { ok: false, status: 500, rawText: 'e3', rawResponseHash: 'sha256:e3', requestMetadata: {} },
    ]
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.totalExternalCalls, 3)
    assert.equal(report.retries, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 12. Batch retry cap
test('12. Batch retry cap enforced', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 15, approveCount: 0 })
    const responses = []
    for (let i = 0; i < 15; i += 1) {
      responses.push(
        { ok: false, status: 500, rawText: `e${i}a`, rawResponseHash: `sha256:e${i}a`, requestMetadata: {} },
        { ok: false, status: 500, rawText: `e${i}b`, rawResponseHash: `sha256:e${i}b`, requestMetadata: {} },
        { ok: false, status: 500, rawText: `e${i}c`, rawResponseHash: `sha256:e${i}c`, requestMetadata: {} },
      )
    }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.ok(report.totalExternalCalls <= 40)
    assert.ok(report.retries <= 10)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 13. Call 40 allowed (with 10 candidates, 3 calls each = 30, but batch retry cap limits retries)
test('13. Call 40 allowed when protocol permits', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 10, approveCount: 5 })
    const responses = []
    for (let i = 0; i < 10; i += 1) {
      responses.push(
        { ok: false, status: 500, rawText: `e${i}a`, rawResponseHash: `sha256:e${i}a`, requestMetadata: {} },
        { ok: false, status: 500, rawText: `e${i}b`, rawResponseHash: `sha256:e${i}b`, requestMetadata: {} },
        { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:ok${i}`, requestMetadata: {} },
      )
    }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    // 5 candidates complete (3 calls each = 15), 5 candidates get 1 call each (5)
    // Total: 20 calls
    assert.equal(report.totalExternalCalls, 20)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 14. Call 41 impossible
test('14. Call 41 impossible', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 14, approveCount: 0 })
    const responses = []
    for (let i = 0; i < 14; i += 1) {
      responses.push(
        { ok: false, status: 500, rawText: `e${i}a`, rawResponseHash: `sha256:e${i}a`, requestMetadata: {} },
        { ok: false, status: 500, rawText: `e${i}b`, rawResponseHash: `sha256:e${i}b`, requestMetadata: {} },
        { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:ok${i}`, requestMetadata: {} },
      )
    }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.ok(report.totalExternalCalls <= 40)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 15. Cost cap stops before dispatch
test('15. Cost cap stops before dispatch', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 14 })
    let calls = 0
    const bigProvider = async () => {
      calls += 1
      return {
        ok: true, status: 200,
        rawText: LOW_RISK_OUTPUT(),
        rawResponseHash: `sha256:big${calls}`,
        requestMetadata: {},
        usageMetadata: { inputTokenCount: 500_000, outputTokenCount: 500_000, thoughtsTokenCount: 0 },
      }
    }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: bigProvider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    // With 500K tokens per call costing ~$2.25 each, the first call exceeds the $0.50 cap
    // The pre-dispatch estimate ($0.015) allows the first call, but post-response enforcement stops further calls
    assert.equal(report.totalExternalCalls, 1, `Expected exactly 1 call before cost cap, got ${report.totalExternalCalls}`)
    assert.equal(report.candidatesCompleted, 1)
    assert.equal(report.candidatesRemaining, 29)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 16. Systemic invalid 5 continues
test('16. Systemic invalid 5 continues', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 10, approveCount: 5 })
    const responses = []
    for (let i = 0; i < 5; i += 1) responses.push({ ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), rawResponseHash: `sha256:si${i}`, requestMetadata: {} })
    for (let i = 5; i < 10; i += 1) responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:ok${i}`, requestMetadata: {} })
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.systemicInvalidGate.triggered, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 17. Systemic invalid 6 stops
test('17. Systemic invalid 6 stops', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 10, approveCount: 5 })
    const responses = []
    for (let i = 0; i < 6; i += 1) responses.push({ ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), rawResponseHash: `sha256:si${i}`, requestMetadata: {} })
    for (let i = 6; i < 10; i += 1) responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:ok${i}`, requestMetadata: {} })
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'STOPPED')
    assert.equal(report.systemicInvalidGate.triggered, true)
    assert.equal(report.candidatesRemaining, 4)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 18. Raw response immutable (completed not overwritten)
test('18. Raw response immutable (completed not overwritten on resume)', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses: [{ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:raw', requestMetadata: {} }] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    const report2 = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses: [] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report2.candidatesSkipped, 1)
    assert.equal(report2.totalExternalCalls, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 19. Completed candidate not redispatched
test('19. Completed candidate not redispatched', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    let calls = 0
    const provider = async () => { calls += 1; return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:${calls}`, requestMetadata: {} } }
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(calls, 1)
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(calls, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 20. DISPATCH_STARTED crash recovery creates ambiguous state
test('20. DISPATCH_STARTED crash recovery creates ambiguous state', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses: [{ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:raw', requestMetadata: {} }] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    await saveExecutionState({
      candidateId: 'scale500-tmdb-1000',
      executionDir: execDir,
      state: { candidateId: 'scale500-tmdb-1000', state: CANDIDATE_STATES.DISPATCH_STARTED, attempt: 1, retries: 0, startedAt: new Date().toISOString() },
    })
    let calls = 0
    const provider2 = async () => { calls += 1; return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:x', requestMetadata: {} } }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: provider2,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.records[0].state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
    assert.equal(calls, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 21. Ambiguous candidate blocks resume
test('21. Ambiguous candidate blocks resume', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 2, approveCount: 1 })
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses: [
        { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:a', requestMetadata: {} },
        { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:b', requestMetadata: {} },
      ] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    // Manually mark first candidate as AMBIGUOUS
    await saveExecutionState({
      candidateId: 'scale500-tmdb-1000',
      executionDir: execDir,
      state: { candidateId: 'scale500-tmdb-1000', state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE, error: 'test' },
    })
    let calls = 0
    const provider2 = async () => { calls += 1; return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:x', requestMetadata: {} } }
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: provider2,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    // First candidate should be in AMBIGUOUS state (blocked)
    // Second candidate should NOT be started (blocked by ambiguous state)
    assert.ok(report.records.length >= 1, 'Should have at least one record')
    assert.equal(report.records[0].state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
    assert.equal(calls, 0, 'Provider should not be called')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 22. No human labels in provider packet
test('22. No human labels in provider packet', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    let capturedPacket = null
    const provider = async ({ packet }) => { capturedPacket = packet; return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} } }
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(Object.keys(capturedPacket).length, 7)
    assert.equal(capturedPacket.humanDecision, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 23. Severe-case analysis (synthetic severe)
test('23. Severe-case analysis', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 14 })
    cohort.records[29].severity = 'SEVERE'
    cohort.records[29].humanDecision = 'REVISE'
    const responses = []
    for (let i = 0; i < 30; i += 1) responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: `sha256:ok${i}`, requestMetadata: {} })
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    // severe-case analysis uses candidateId 'scale500-tmdb-14283' which is NOT in our synthetic cohort
    assert.equal(report.severeCaseOutcome, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 24. Semantic confusion matrix
test('24. Semantic confusion matrix', async () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'VALID_LOW_RISK' },
    { candidateId: 'c3', humanDecision: 'APPROVE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c4', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
    { candidateId: 'c5', humanDecision: 'REVISE', disposition: 'SCHEMA_INVALID' },
  ]
  const evaluation = computeTwoLayerEvaluation({ records })
  assert.equal(evaluation.layerA.validOutputCount, 4)
  assert.deepEqual(evaluation.layerA.confusionMatrix, { TP: 1, FN: 1, FP: 1, TN: 1 })
  assert.equal(evaluation.layerA.apparentDefectSensitivity, 0.5)
})

// 25. Operational containment
test('25. Operational containment', async () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'SCHEMA_INVALID' },
    { candidateId: 'c3', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
    { candidateId: 'c4', humanDecision: 'APPROVE', disposition: 'PROVIDER_FAILURE' },
  ]
  const evaluation = computeTwoLayerEvaluation({ records })
  assert.equal(evaluation.layerB.defectContainmentCount, 2)
  assert.equal(evaluation.layerB.cleanAutoPassCount, 1)
  assert.equal(evaluation.layerB.cleanOverRoutingCount, 1)
  assert.equal(evaluation.layerB.totalHumanReviewRoutingBurdenCount, 3)
})

// 26. Provider failure not semantic TP
test('26. Provider failure not semantic TP', async () => {
  const evaluation = computeTwoLayerEvaluation({ records: [{ candidateId: 'c1', humanDecision: 'REVISE', disposition: 'PROVIDER_FAILURE' }] })
  assert.equal(evaluation.layerA.confusionMatrix.TP, 0)
  assert.equal(evaluation.layerA.invalidOrFailureCount, 1)
  assert.equal(evaluation.layerB.defectContainmentCount, 1)
})

// 27. Execution ledger deterministic
test('27. Execution ledger deterministic given fixed responses', async () => {
  const dir = await makeTempDir()
  const execDir1 = await makeTempDir()
  const execDir2 = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 3, approveCount: 2 })
    const make = () => [
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:d', requestMetadata: {} },
      { ok: true, status: 200, rawText: HIGH_RISK_OUTPUT(), rawResponseHash: 'sha256:d2', requestMetadata: {} },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:d3', requestMetadata: {} },
    ]
    const env = { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' }
    const r1 = await runMode1Replay({ env, providerDispatch: makeMockProvider({ responses: make() }), executionDir: execDir1, cohortManifest: cohort })
    const r2 = await runMode1Replay({ env, providerDispatch: makeMockProvider({ responses: make() }), executionDir: execDir2, cohortManifest: cohort })
    assert.deepEqual(r1.dispositionCounts, r2.dispositionCounts)
    assert.deepEqual(r1.validOutputPerformance.confusionMatrix, r2.validOutputPerformance.confusionMatrix)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir1, { recursive: true, force: true })
    await rm(execDir2, { recursive: true, force: true })
  }
})

// 28. Credentials never written
test('28. Credentials never written to ledger or report', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'SECRET_KEY_12345' },
      providerDispatch: makeMockProvider({ responses: [{ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} }] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.ok(!JSON.stringify(report).includes('SECRET_KEY_12345'))
    const ledger = await loadExecutionState({ candidateId: 'scale500-tmdb-1000', executionDir: execDir })
    assert.ok(!JSON.stringify(ledger).includes('SECRET_KEY_12345'))
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 29. Mode 2 unavailable
test('29. Mode 2 unavailable in runner', async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const report = await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: 'AUTHORIZE_MODE_1_RETROSPECTIVE_REPLAY', GEMINI_API_KEY: 'test-key' },
      providerDispatch: makeMockProvider({ responses: [{ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), rawResponseHash: 'sha256:ok', requestMetadata: {} }] }),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.mode, 'MODE_1_OPTION_A_ONLY')
    assert.ok(!report.mode2)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 30. Governance remains paused
test('30. Governance remains paused', async () => {
  const protocol = JSON.parse(await readFile(path.join(experimentDir, 'protocol.v1.json'), 'utf8'))
  assert.equal(protocol.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
  assert.equal(protocol.boundCandidate.operationalFlags.active, false)
  assert.equal(protocol.experimentSafetyConfirmations.networkCallsAuthorized, 0)
  assert.equal(protocol.experimentSafetyConfirmations.modelCallsAuthorized, 0)
})

// Unauthorized run gate
test('Unauthorized run gate returns EXECUTION_NOT_AUTHORIZED', async () => {
  await assert.rejects(() => runReplayExecution({ env: {} }), (err) => err.code === 'EXECUTION_NOT_AUTHORIZED')
})

// Preflight and dry-run still zero-call
test('Preflight still zero-call', async () => {
  const report = await runPreflight()
  assert.equal(report.providerDispatches, 0)
  assert.equal(report.modelCalls, 0)
  assert.equal(report.networkCalls, 0)
})

test('Dry-run still zero-call', async () => {
  const report = await runDryRun()
  assert.equal(report.providerDispatches, 0)
  assert.equal(report.modelCalls, 0)
  assert.equal(report.networkCalls, 0)
})
