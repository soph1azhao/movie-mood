import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createHash } from 'node:crypto'
import {
  CANDIDATE_STATES,
  computeTwoLayerEvaluation,
  computeSeverityBreakdown,
  analyzeIssueConcordance,
  evaluateSevereSafetyGate,
  checkSystemicInvalidStop,
  reconstructExecutionCounters,
  runMode1Replay,
  runPreflight,
  runDryRun,
  runReplayExecution,
  requestMode2Execution,
  calculateCallCost,
  checkPreDispatchAffordability,
  checkPostResponseCap,
  executeSingleCandidateAttempt,
  inspectCandidateResumeState,
  getCandidateExecutionPaths,
  formatAttemptArtifactName,
  classifyOutputDisposition,
  extractVerifierText,
  validateJsonSchema,
  FROZEN_CALL_LIMITS,
  FROZEN_EXPECTED_HASHES,
  FROZEN_HISTORICAL_NEXT_CALL_COST_ESTIMATE_USD,
  VERIFIER_V12_REPLAY_AUTHORIZATION_TOKEN,
} from './runVerifierV12RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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
    summaryRationale: 'All visible fields audited against source boundary.',
  },
})

const HIGH_RISK_OUTPUT = (field = 'whyWatch') => JSON.stringify({
  riskLevel: 'HIGH_RISK',
  riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
  issues: [{
    category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
    field,
    claimSpan: 'secret plot twist',
    normalizedClaim: 'film contains a secret plot twist',
    claimType: 'STORY_SETUP_FACT',
    checkedAuthoritySources: ['allowedSourceMaterial.overview'],
    sourceEvidence: [{ source: 'allowedSourceMaterial.overview', supportFound: false }],
    authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
    materialityRationale: 'Not grounded in allowed source material.',
  }],
  sourceBoundarySatisfied: false,
})

const SCHEMA_INVALID_OUTPUT = () => JSON.stringify({ riskLevel: 'LOW_RISK' })
const SEMANTICALLY_INVALID_OUTPUT = () => JSON.stringify({
  riskLevel: 'HIGH_RISK',
  riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
  issues: [
    {
      category: 'MATERIAL_FACTUAL_CONFLICT',
      field: 'description',
      claimSpan: 'runtime of 120 minutes',
      normalizedClaim: 'Runtime is 120m',
      claimType: 'QUANTITATIVE_CLAIM',
      checkedAuthoritySources: ['facts.runtimeMinutes'],
      sourceEvidence: [{ source: 'facts.runtimeMinutes', supportFound: false }],
      authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
      materialityRationale: 'Directly contradicts authority.',
    },
  ],
  sourceBoundarySatisfied: false,
})
const MALFORMED_JSON_OUTPUT = () => '{ "riskLevel": "LOW_RISK", incomplete...'

function makeMockProvider({ responses, maxCalls = null } = {}) {
  const queue = [...(responses || [])]
  let callCount = 0
  const dispatchFn = async (packet) => {
    callCount += 1
    if (maxCalls !== null && callCount > maxCalls) {
      throw new Error(`BOUNDED_CALL_LIMIT_EXCEEDED: Mock provider exceeded maximum allowed calls (${maxCalls}). Possible infinite loop.`)
    }
    const next = queue.shift()
    if (next instanceof Error) {
      throw next
    }
    if (!next) {
      if (maxCalls !== null) {
        throw new Error(`MOCK_PROVIDER_EXHAUSTED: No response configured for call ${callCount}`)
      }
      return {
        ok: true,
        status: 200,
        rawText: LOW_RISK_OUTPUT(),
        transportOutcome: 'SUCCESS',
        transportCategory: 'HTTP_200',
        retryable: false,
        usageMetadata: {
          promptTokenCount: 900,
          candidatesTokenCount: 150,
          thoughtsTokenCount: 500,
          totalTokenCount: 1550,
        },
      }
    }
    return next
  }
  dispatchFn.getCallCount = () => callCount
  return dispatchFn
}

const makeTempDir = () => mkdtemp(path.join(os.tmpdir(), 'v12replay-orch-test-'))

async function buildSyntheticCohort({ dir, count = 30, approveCount = 14, severeCandidateId = null } = {}) {
  const records = []
  for (let i = 0; i < count; i += 1) {
    const candidateId = severeCandidateId && i === 0
      ? severeCandidateId
      : `scale500-tmdb-${1000 + i}`
    const humanDecision = i < approveCount ? 'APPROVE' : 'REVISE'
    const isSevere = candidateId === 'scale500-tmdb-14283' || candidateId === severeCandidateId
    const severity = humanDecision === 'REVISE' ? (isSevere ? 'SEVERE' : 'MINOR') : 'NONE'
    const riskInput = {
      facts: { title: `Film ${i}`, year: 2020, runtimeMinutes: 100, genres: ['Drama'], spokenLanguages: ['English'], countries: ['US'], director: 'Director' },
      acceptedSemanticClassification: { pace: 'medium', moods: ['tense'] },
      semanticBoundaryFlags: [],
      allowedSourceMaterial: { overview: 'A story about characters facing difficult choices.' },
      spoilerBoundaryRules: { cutoff: 'setup' },
      copyConstraints: {},
      visibleEditorialCopy: { description: 'A film description.', whyWatch: 'Compelling narrative.', curiosityHook: 'What happens next?', vibeSummary: 'Tense.' },
    }
    const inputPath = path.join(dir, `${candidateId}.risk-input.json`)
    const raw = JSON.stringify(riskInput)
    await writeFile(inputPath, raw, 'utf8')
    records.push({
      candidateId,
      tmdbId: 1000 + i,
      humanDecision,
      severity,
      effectiveAffectedFields: humanDecision === 'REVISE' ? ['whyWatch'] : [],
      sourceRiskInputByteHash: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
      sourceRiskInputPath: inputPath,
      title: `Film ${i}`,
    })
  }
  return { cohortSize: count, records }
}

const defaultAuthEnv = {
  VERIFIER_V12_REPLAY_AUTHORIZATION: VERIFIER_V12_REPLAY_AUTHORIZATION_TOKEN,
  GEMINI_API_KEY: 'test-fake-key',
}

// 1. All 30 candidates valid LOW -> 30 primaries, 0 retries
test('1. All 30 candidates valid LOW -> 30 primaries, 0 retries', { timeout: 10000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 14 })
    const responses = Array.from({ length: 30 }, () => ({
      ok: true,
      status: 200,
      rawText: LOW_RISK_OUTPUT(),
      transportOutcome: 'SUCCESS',
      transportCategory: 'HTTP_200',
      retryable: false,
    }))
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.primaryCalls, 30)
    assert.equal(report.technicalRetries, 0)
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
test('2. Mixed LOW/HIGH run', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 4, approveCount: 2 })
    const responses = [
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: HIGH_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: HIGH_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 2)
    assert.equal(report.dispositionCounts.VALID_HIGH_RISK, 2)
    assert.equal(report.validOutputPerformance.confusionMatrix.TN, 1)
    assert.equal(report.validOutputPerformance.confusionMatrix.FP, 1)
    assert.equal(report.validOutputPerformance.confusionMatrix.TP, 1)
    assert.equal(report.validOutputPerformance.confusionMatrix.FN, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 3. 429 then success
test('3. 429 then success -> 1 primary + 1 retry', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 429, rawText: 'Rate limited', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_429', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 2 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(provider.getCallCount(), 2)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 4. 500 then success
test('4. 500 then success', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 500, rawText: 'Internal Error', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 2 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(provider.getCallCount(), 2)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 5. 503 then success
test('5. 503 then success', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 503, rawText: 'Service Unavailable', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_503', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 2 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(provider.getCallCount(), 2)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 6. Network timeout then success
test('6. Network timeout then success', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: null, rawText: '', transportOutcome: 'NETWORK_ERROR', transportCategory: 'NETWORK_TIMEOUT', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 7. Connection reset then success
test('7. Connection reset then success', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: null, rawText: '', transportOutcome: 'NETWORK_ERROR', transportCategory: 'CONNECTION_RESET', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 8. Malformed JSON then success
test('8. Malformed JSON then success', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: true, status: 200, rawText: MALFORMED_JSON_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 2 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 1)
    assert.equal(report.totalExternalCalls, 2)
    assert.equal(provider.getCallCount(), 2)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 9. Malformed JSON exhausts retry allowance -> terminal MALFORMED_JSON
test('9. Malformed JSON exhausts retry allowance -> terminal MALFORMED_JSON', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: true, status: 200, rawText: MALFORMED_JSON_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: MALFORMED_JSON_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: MALFORMED_JSON_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 3 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 2)
    assert.equal(report.totalExternalCalls, 3)
    assert.equal(provider.getCallCount(), 3)
    assert.equal(report.dispositionCounts.MALFORMED_JSON, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 10. 502 no retry
test('10. 502 no retry -> terminal PROVIDER_FAILURE', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 502, rawText: 'Bad Gateway', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_502', retryable: false },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 11. 504 no retry
test('11. 504 no retry -> terminal PROVIDER_FAILURE', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 504, rawText: 'Gateway Timeout', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_504', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 12. SCHEMA_INVALID no retry
test('12. SCHEMA_INVALID no retry', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.dispositionCounts.SCHEMA_INVALID, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 13. SEMANTICALLY_INVALID no retry
test('13. SEMANTICALLY_INVALID no retry', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.dispositionCounts.SEMANTICALLY_INVALID, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 14. Candidate max 2 retries
test('14. Candidate max 2 retries (total 3 attempts max per candidate)', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: 500, rawText: 'err1', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true },
      { ok: false, status: 500, rawText: 'err2', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true },
      { ok: false, status: 500, rawText: 'err3', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 3 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 2)
    assert.equal(report.totalExternalCalls, 3)
    assert.equal(provider.getCallCount(), 3)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 15 & 16. Batch 10 retries cap and 11th retry blocked
test('15 & 16. Batch 10 retries cap and 11th retry blocked', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    // 6 candidates: first 5 each do 1 primary + 2 retries = 10 retries consumed
    // 6th candidate fails attempt 1 -> cannot retry because batch cap (10) reached!
    const cohort = await buildSyntheticCohort({ dir, count: 6, approveCount: 3 })
    const responses = []
    for (let i = 0; i < 5; i += 1) {
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
    }
    // Candidate 6 primary failure:
    responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })

    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.technicalRetries, 10)
    assert.equal(report.primaryCalls, 6)
    assert.equal(report.totalExternalCalls, 16)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 6)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 17. Remaining candidate primary still allowed after retry cap
test('17. Remaining candidate primary still allowed after retry cap is consumed', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    // 5 candidates fail twice (10 retries), candidate 6 succeeds on primary
    const cohort = await buildSyntheticCohort({ dir, count: 6, approveCount: 3 })
    const responses = []
    for (let i = 0; i < 5; i += 1) {
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
    }
    // Candidate 6 primary succeeds:
    responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false })

    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.technicalRetries, 10)
    assert.equal(report.primaryCalls, 6)
    assert.equal(report.totalExternalCalls, 16)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 18. 30 primary + 10 retries = call 40 permitted
test('18. 30 primary + 10 retries = call 40 permitted', { timeout: 10000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 30, approveCount: 15 })
    const responses = []
    // 5 candidates retry twice (10 retries): 5 * 3 = 15 calls
    for (let i = 0; i < 5; i += 1) {
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: false, status: 500, rawText: 'e', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true })
      responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false })
    }
    // Remaining 25 candidates succeed on primary: 25 calls -> total 40 calls
    for (let i = 0; i < 25; i += 1) {
      responses.push({ ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false })
    }

    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      costCeiling: 10.0, // avoid cost ceiling stopping
    })
    assert.equal(report.primaryCalls, 30)
    assert.equal(report.technicalRetries, 10)
    assert.equal(report.totalExternalCalls, 40)
    assert.equal(report.candidatesCompleted, 30)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 19. Call 41 impossible
test('19. Call 41 impossible', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    // Set maxTheoreticalCalls = 5 to test boundary
    const cohort = await buildSyntheticCohort({ dir, count: 10, approveCount: 5 })
    const responses = Array.from({ length: 10 }, () => ({
      ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false,
    }))
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      maxTheoreticalCalls: 5,
    })
    assert.equal(report.totalExternalCalls, 5)
    assert.equal(report.stoppingRule, 'STOP_IF_CALLS_EXCEED_CAP')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 20. Cost gate stops pre-dispatch
test('20. Cost gate stops pre-dispatch when accumulatedCost + nextCallEstimate > costCeiling', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 5, approveCount: 2 })
    const provider = makeMockProvider()
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      costCeiling: 0.010, // less than nextCallEstimate (0.01515675)
    })
    assert.equal(report.totalExternalCalls, 0)
    assert.equal(report.stoppingRule, 'STOP_IF_COST_EXCEEDS_CEILING')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 21. Post-response unexpected cost crossing stops future calls
test('21. Post-response unexpected cost crossing stops future calls', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 5, approveCount: 2 })
    // First call returns massive token usage that breaches ceiling
    const responses = [
      {
        ok: true,
        status: 200,
        rawText: LOW_RISK_OUTPUT(),
        transportOutcome: 'SUCCESS',
        transportCategory: 'HTTP_200',
        retryable: false,
        usageMetadata: {
          promptTokenCount: 1_000_000, // $0.75
          candidatesTokenCount: 0,
          thoughtsTokenCount: 0,
        },
      },
      {
        ok: true,
        status: 200,
        rawText: LOW_RISK_OUTPUT(),
        transportOutcome: 'SUCCESS',
        transportCategory: 'HTTP_200',
        retryable: false,
      },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      costCeiling: 0.50,
    })
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(report.stoppingRule, 'STOP_IF_COST_EXCEEDS_CEILING')
    assert.equal(report.candidatesCompleted, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 22. Systemic invalid 5 continues
test('22. Systemic invalid 5 continues', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 6, approveCount: 3 })
    const responses = [
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      systemicInvalidThreshold: 6,
    })
    assert.equal(report.systemicInvalidCount, 5)
    assert.equal(report.candidatesCompleted, 6)
    assert.equal(report.status, 'COMPLETE')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 23. Systemic invalid 6 stops
test('23. Systemic invalid 6 stops before candidate 7', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 7, approveCount: 3 })
    const responses = [
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SCHEMA_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: SEMANTICALLY_INVALID_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
      systemicInvalidThreshold: 6,
    })
    assert.equal(report.systemicInvalidCount, 6)
    assert.equal(report.candidatesCompleted, 6)
    assert.equal(report.stoppingRule, 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 24. Completed candidate resume no dispatch
test('24. Completed candidate resume does not redispatch', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 2, approveCount: 1 })
    const responses1 = [
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    // Run candidate 1 only:
    const cohort1 = { cohortSize: 1, records: [cohort.records[0]] }
    await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: makeMockProvider({ responses: responses1 }),
      executionDir: execDir,
      cohortManifest: cohort1,
    })

    // Resume with full cohort: candidate 1 is COMPLETED, should not dispatch
    const responses2 = [
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider2 = makeMockProvider({ responses: responses2 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider2,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.candidatesCompleted, 2)
    assert.equal(provider2.getCallCount(), 1) // only candidate 2 was dispatched
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 25. RESPONSE_PERSISTED valid body resumes interpretation without dispatch
test('25. RESPONSE_PERSISTED valid body resumes interpretation without dispatch', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const record = cohort.records[0]
    const { candidateDir, attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir: execDir, candidateId: record.candidateId })
    await mkdir(attemptsDir, { recursive: true })

    const attemptRaw = LOW_RISK_OUTPUT()
    const attemptHash = `sha256:${createHash('sha256').update(attemptRaw).digest('hex')}`
    await writeFile(path.join(attemptsDir, 'attempt-001.raw.json'), attemptRaw, 'utf8')

    const ledger = {
      candidateId: record.candidateId,
      state: CANDIDATE_STATES.RESPONSE_PERSISTED,
      currentAttempt: 1,
      attempts: [{
        attemptNumber: 1,
        state: CANDIDATE_STATES.RESPONSE_PERSISTED,
        artifactPath: 'attempts/attempt-001.raw.json',
        rawResponseHash: attemptHash,
        status: 200,
        ok: true,
        transportOutcome: 'SUCCESS',
        transportCategory: 'HTTP_200',
        retryable: false,
      }],
    }
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    const provider = makeMockProvider({ responses: [] })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(provider.getCallCount(), 0) // zero dispatches
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 26. RESPONSE_PERSISTED retryable 500 may create next attempt if budgets allow
test('26. RESPONSE_PERSISTED retryable 500 resumes and creates next attempt if budgets allow', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const record = cohort.records[0]
    const { candidateDir, attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir: execDir, candidateId: record.candidateId })
    await mkdir(attemptsDir, { recursive: true })

    const attemptRaw = 'Internal Error'
    const attemptHash = `sha256:${createHash('sha256').update(attemptRaw).digest('hex')}`
    await writeFile(path.join(attemptsDir, 'attempt-001.raw.json'), attemptRaw, 'utf8')

    const ledger = {
      candidateId: record.candidateId,
      state: CANDIDATE_STATES.RESPONSE_PERSISTED,
      currentAttempt: 1,
      attempts: [{
        attemptNumber: 1,
        state: CANDIDATE_STATES.RESPONSE_PERSISTED,
        artifactPath: 'attempts/attempt-001.raw.json',
        rawResponseHash: attemptHash,
        status: 500,
        ok: false,
        transportOutcome: 'HTTP_ERROR',
        transportCategory: 'HTTP_500',
        retryable: true,
      }],
    }
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    const provider = makeMockProvider({
      responses: [
        { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
      ],
    })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(provider.getCallCount(), 1) // created attempt 2
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 27. Ambiguous candidate blocks replay
test('27. Ambiguous candidate blocks replay', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const record = cohort.records[0]
    const { candidateDir, attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir: execDir, candidateId: record.candidateId })
    await mkdir(candidateDir, { recursive: true })

    const ledger = {
      candidateId: record.candidateId,
      state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
      ambiguous: true,
      ambiguousReason: 'Crash uncertainty',
    }
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    await assert.rejects(
      async () => {
        await runMode1Replay({
          env: defaultAuthEnv,
          providerDispatch: makeMockProvider(),
          executionDir: execDir,
          cohortManifest: cohort,
        })
      },
      (err) => err.code === 'AMBIGUOUS_DISPATCH_STATE'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 28. Persisted counter reconstruction after restart
test('28. Persisted counter reconstruction after restart', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 2, approveCount: 1 })
    const responses = [
      { ok: false, status: 500, rawText: 'err', transportOutcome: 'HTTP_ERROR', transportCategory: 'HTTP_500', retryable: true },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: makeMockProvider({ responses }),
      executionDir: execDir,
      cohortManifest: { cohortSize: 1, records: [cohort.records[0]] },
    })

    const reconstructed = await reconstructExecutionCounters({ executionDir: execDir })
    assert.equal(reconstructed.primaryCalls, 1)
    assert.equal(reconstructed.technicalRetries, 1)
    assert.equal(reconstructed.totalExternalCalls, 2)
    assert.equal(reconstructed.terminalDispositionCounts.VALID_LOW_RISK, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 29. Ledger/artifact disagreement fails closed
test('29. Ledger/artifact disagreement fails closed', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const record = cohort.records[0]
    const { candidateDir, attemptsDir, ledgerPath } = getCandidateExecutionPaths({ executionDir: execDir, candidateId: record.candidateId })
    await mkdir(attemptsDir, { recursive: true })

    await writeFile(path.join(attemptsDir, 'attempt-001.raw.json'), 'tampered content', 'utf8')
    const ledger = {
      candidateId: record.candidateId,
      state: CANDIDATE_STATES.COMPLETED,
      attempts: [{
        attemptNumber: 1,
        artifactPath: 'attempts/attempt-001.raw.json',
        rawResponseHash: 'sha256:different_hash',
      }],
    }
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')

    await assert.rejects(
      async () => {
        await reconstructExecutionCounters({ executionDir: execDir })
      },
      (err) => err.code === 'PERSISTED_ARTIFACT_HASH_MISMATCH'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 30. Semantic matrix excludes invalid/failure
test('30. Semantic matrix excludes invalid/failure', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'PROVIDER_FAILURE' },
    { candidateId: 'c3', humanDecision: 'REVISE', disposition: 'SCHEMA_INVALID' },
    { candidateId: 'c4', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
  ]
  const { layerA, layerB } = computeTwoLayerEvaluation({ records })
  assert.equal(layerA.validOutputCount, 2)
  assert.equal(layerA.invalidOrFailureCount, 2)
  assert.equal(layerA.confusionMatrix.TP, 1)
  assert.equal(layerA.confusionMatrix.FN, 0)
  assert.equal(layerA.confusionMatrix.TN, 1)
  assert.equal(layerA.confusionMatrix.FP, 0)
})

// 31. Provider failure never semantic TP
test('31. Provider failure never counts as semantic TP', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'PROVIDER_FAILURE' },
  ]
  const { layerA } = computeTwoLayerEvaluation({ records })
  assert.equal(layerA.confusionMatrix.TP, 0)
})

// 32. Operational layer fail-closes invalid/failure
test('32. Operational layer fail-closes invalid/failure', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'PROVIDER_FAILURE' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'MALFORMED_JSON' },
    { candidateId: 'c3', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
  ]
  const { layerB } = computeTwoLayerEvaluation({ records })
  assert.equal(layerB.defectiveContained, 2)
  assert.equal(layerB.cleanAutoPassed, 1)
  assert.equal(layerB.totalHumanReviewRoutingBurden, 2)
})

// 33. Severe case LOW triggers known severe failure marker
test('33. Severe case LOW triggers KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE', () => {
  const records = [
    { candidateId: 'scale500-tmdb-14283', disposition: 'VALID_LOW_RISK' },
  ]
  const res = evaluateSevereSafetyGate({ records })
  assert.equal(res.severeSafetyOutcome, 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE')
  assert.equal(res.governanceEffect, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
})

// 34. Severe case HIGH reports categorical caught outcome
test('34. Severe case HIGH reports SEVERE_DEFECT_FLAGGED_OR_CONTAINED', () => {
  const records = [
    { candidateId: 'scale500-tmdb-14283', disposition: 'VALID_HIGH_RISK' },
  ]
  const res = evaluateSevereSafetyGate({ records })
  assert.equal(res.severeSafetyOutcome, 'SEVERE_DEFECT_FLAGGED_OR_CONTAINED')
})

// 35. No human labels in provider packet
test('35. No human labels in provider packet', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 0 })
    let capturedPacket = null
    const provider = async (packet) => {
      capturedPacket = packet
      return { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false }
    }
    await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.ok(capturedPacket)
    assert.equal(capturedPacket.humanDecision, undefined)
    assert.equal(capturedPacket.severity, undefined)
    assert.equal(capturedPacket.affectedFields, undefined)
    assert.equal(capturedPacket.effectiveAffectedFields, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 36. Credentials absent from all persisted artifacts
test('36. Credentials absent from all persisted artifacts', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const secretKey = 'super-secret-api-key-never-persist'
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    await runMode1Replay({
      env: { VERIFIER_V12_REPLAY_AUTHORIZATION: VERIFIER_V12_REPLAY_AUTHORIZATION_TOKEN, GEMINI_API_KEY: secretKey },
      providerDispatch: makeMockProvider(),
      executionDir: execDir,
      cohortManifest: cohort,
    })

    const ledgerText = await readFile(path.join(execDir, 'execution-ledger.json'), 'utf8')
    const reportText = await readFile(path.join(execDir, 'final-report.json'), 'utf8')
    assert.ok(!ledgerText.includes(secretKey))
    assert.ok(!reportText.includes(secretKey))
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 37. Mode 2 unavailable
test('37. Mode 2 is strictly unavailable', () => {
  assert.throws(
    () => requestMode2Execution(),
    (err) => err.code === 'MODE_2_UNAVAILABLE'
  )
})

// 38. Governance remains paused
test('38. Governance remains PAUSED_FOR_SEVERE_AUDIT_MISS', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: makeMockProvider(),
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 39. Realistic Gemini generateContent envelope handling
test('39. Realistic Gemini generateContent envelope: immutably persisted, verifier text extracted, usage extracted, LOW/HIGH classified', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 2, approveCount: 1 })
    const envelopeLow = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: LOW_RISK_OUTPUT() }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 880,
        candidatesTokenCount: 140,
        thoughtsTokenCount: 420,
        totalTokenCount: 1440,
      },
      modelVersion: 'gemini-3.8-flash',
    })
    const envelopeHigh = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: HIGH_RISK_OUTPUT() }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 910,
        candidatesTokenCount: 180,
        thoughtsTokenCount: 510,
        totalTokenCount: 1600,
      },
      modelVersion: 'gemini-3.8-flash',
    })

    const responses = [
      { ok: true, status: 200, rawText: envelopeLow, transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false, usageMetadata: { promptTokenCount: 880, candidatesTokenCount: 140, thoughtsTokenCount: 420 } },
      { ok: true, status: 200, rawText: envelopeHigh, transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false, usageMetadata: { promptTokenCount: 910, candidatesTokenCount: 180, thoughtsTokenCount: 510 } },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 2 })

    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })

    assert.equal(report.status, 'COMPLETE')
    assert.equal(report.primaryCalls, 2)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.dispositionCounts.VALID_LOW_RISK, 1)
    assert.equal(report.dispositionCounts.VALID_HIGH_RISK, 1)

    // Verify attempt artifact on disk is the raw, unstripped Gemini envelope
    const rawDiskContent0 = await readFile(path.join(execDir, cohort.records[0].candidateId, 'attempts/attempt-001.raw.json'), 'utf8')
    assert.ok(rawDiskContent0.includes('gemini-3.8-flash'))
    assert.ok(rawDiskContent0.includes('candidates'))
    assert.ok(rawDiskContent0.includes('usageMetadata'))

    const rawDiskContent1 = await readFile(path.join(execDir, cohort.records[1].candidateId, 'attempts/attempt-001.raw.json'), 'utf8')
    assert.ok(rawDiskContent1.includes('gemini-3.8-flash'))
    assert.ok(rawDiskContent1.includes('candidates'))

    // Verify usageMetadata was correctly accumulated
    assert.equal(report.tokens.inputTokens, 880 + 910)
    assert.equal(report.tokens.outputTokens, 140 + 180)
    assert.equal(report.tokens.thinkingTokens, 420 + 510)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 40. Generic unknown NETWORK_ERROR is non-retryable
test('40. Generic unknown NETWORK_ERROR is non-retryable -> 1 primary call, 0 retries, terminal PROVIDER_FAILURE', { timeout: 5000 }, async () => {
  const dir = await makeTempDir()
  const execDir = await makeTempDir()
  try {
    const cohort = await buildSyntheticCohort({ dir, count: 1, approveCount: 1 })
    const responses = [
      { ok: false, status: null, rawText: '', transportOutcome: 'NETWORK_ERROR', transportCategory: 'NETWORK_ERROR', retryable: false, error: { message: 'Connection refused', code: 'ECONNREFUSED' } },
      { ok: true, status: 200, rawText: LOW_RISK_OUTPUT(), transportOutcome: 'SUCCESS', transportCategory: 'HTTP_200', retryable: false },
    ]
    const provider = makeMockProvider({ responses, maxCalls: 1 })
    const report = await runMode1Replay({
      env: defaultAuthEnv,
      providerDispatch: provider,
      executionDir: execDir,
      cohortManifest: cohort,
    })
    assert.equal(report.primaryCalls, 1)
    assert.equal(report.technicalRetries, 0)
    assert.equal(report.totalExternalCalls, 1)
    assert.equal(provider.getCallCount(), 1)
    assert.equal(report.dispositionCounts.PROVIDER_FAILURE, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(execDir, { recursive: true, force: true })
  }
})

// 41. Full schema validation: invalid enum
test('41. Full schema validation: invalid enum is SCHEMA_INVALID and does NOT run semantic validator', async () => {
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))
  let semanticValidatorCalled = false
  const spySemanticValidator = () => {
    semanticValidatorCalled = true
    return { ok: true }
  }

  const payloadWithInvalidEnum = {
    riskLevel: 'INVALID_RISK_LEVEL_ENUM',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
  }

  const res = classifyOutputDisposition({
    rawText: JSON.stringify(payloadWithInvalidEnum),
    schema,
    semanticValidator: spySemanticValidator,
  })

  assert.equal(res.disposition, 'SCHEMA_INVALID')
  assert.equal(semanticValidatorCalled, false, 'Semantic validator must NOT run when schema validation fails')
})

// 42. Full schema validation: nested required-field failure
test('42. Full schema validation: nested required-field missing is SCHEMA_INVALID and does NOT run semantic validator', async () => {
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))
  let semanticValidatorCalled = false
  const spySemanticValidator = () => {
    semanticValidatorCalled = true
    return { ok: true }
  }

  // Issue missing required "claimSpan"
  const payloadWithMissingNestedRequired = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        // claimSpan missing!
        normalizedClaim: 'film is 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
  }

  const res = classifyOutputDisposition({
    rawText: JSON.stringify(payloadWithMissingNestedRequired),
    schema,
    semanticValidator: spySemanticValidator,
  })

  assert.equal(res.disposition, 'SCHEMA_INVALID')
  assert.equal(semanticValidatorCalled, false, 'Semantic validator must NOT run when schema validation fails')
})

// 43. Full schema validation: invalid issues[] item
test('43. Full schema validation: invalid issues[] item type is SCHEMA_INVALID and does NOT run semantic validator', async () => {
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))
  let semanticValidatorCalled = false
  const spySemanticValidator = () => {
    semanticValidatorCalled = true
    return { ok: true }
  }

  const payloadWithInvalidItem = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: ['string_not_an_object'],
    sourceBoundarySatisfied: false,
  }

  const res = classifyOutputDisposition({
    rawText: JSON.stringify(payloadWithInvalidItem),
    schema,
    semanticValidator: spySemanticValidator,
  })

  assert.equal(res.disposition, 'SCHEMA_INVALID')
  assert.equal(semanticValidatorCalled, false, 'Semantic validator must NOT run when schema validation fails')
})

// 44. Full schema validation: prohibited additional property
test('44. Full schema validation: prohibited additional property is SCHEMA_INVALID and does NOT run semantic validator', async () => {
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))
  let semanticValidatorCalled = false
  const spySemanticValidator = () => {
    semanticValidatorCalled = true
    return { ok: true }
  }

  const payloadWithExtraProp = {
    riskLevel: 'LOW_RISK',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
    unauthorizedAdditionalProperty: 'should be rejected by schema',
  }

  const res = classifyOutputDisposition({
    rawText: JSON.stringify(payloadWithExtraProp),
    schema,
    semanticValidator: spySemanticValidator,
  })

  assert.equal(res.disposition, 'SCHEMA_INVALID')
  assert.equal(semanticValidatorCalled, false, 'Semantic validator must NOT run when schema validation fails')
})

// 45. Canonical extractVerifierText handling
test('45. Canonical extractVerifierText: handles Gemini envelope, direct JSON, malformed text, and empty envelope safely', () => {
  // 1. Direct JSON string
  const directJson = '{"riskLevel":"LOW_RISK"}'
  assert.equal(extractVerifierText(directJson), directJson)

  // 2. Gemini envelope with parts text
  const envelope = JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"riskLevel":"HIGH_RISK"}' }] } }],
  })
  assert.equal(extractVerifierText(envelope), '{"riskLevel":"HIGH_RISK"}')

  // 3. Malformed JSON string (not valid JSON)
  const malformed = '{"riskLevel": broken...'
  assert.equal(extractVerifierText(malformed), malformed)

  // 4. Gemini envelope without parts
  const emptyEnvelope = JSON.stringify({
    candidates: [{ content: { parts: [] } }],
  })
  assert.equal(extractVerifierText(emptyEnvelope), null)

  // 5. Empty or whitespace
  assert.equal(extractVerifierText(''), null)
  assert.equal(extractVerifierText('   '), null)
  assert.equal(extractVerifierText(null), null)
})

// 46. Frozen schema conditional contract regression tests (A through J)
test('46. Frozen schema conditional contract regression tests (A through J)', async () => {
  const schema = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json'), 'utf8'))

  // A. LOW_RISK + non-empty riskCategories -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = {
      ...JSON.parse(LOW_RISK_OUTPUT()),
      riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
    }
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'A: LOW_RISK + non-empty riskCategories must fail schema')
    assert.equal(spyCalled, false, 'A: semanticValidator must NOT be invoked after schema failure')
  }

  // B. LOW_RISK + non-empty issues -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = {
      ...JSON.parse(LOW_RISK_OUTPUT()),
      issues: JSON.parse(HIGH_RISK_OUTPUT()).issues,
    }
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'B: LOW_RISK + non-empty issues must fail schema')
    assert.equal(spyCalled, false, 'B: semanticValidator must NOT be invoked after schema failure')
  }

  // C. LOW_RISK + any lowRiskCoverage const flag false -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = JSON.parse(LOW_RISK_OUTPUT())
    payload.lowRiskCoverage.allVisibleFieldsAudited = false
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'C: lowRiskCoverage const flag false must fail schema')
    assert.equal(spyCalled, false, 'C: semanticValidator must NOT be invoked after schema failure')
  }

  // D. HIGH_RISK + empty riskCategories -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = {
      ...JSON.parse(HIGH_RISK_OUTPUT()),
      riskCategories: [],
    }
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'D: HIGH_RISK + empty riskCategories must fail schema')
    assert.equal(spyCalled, false, 'D: semanticValidator must NOT be invoked after schema failure')
  }

  // E. HIGH_RISK + empty issues -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = {
      ...JSON.parse(HIGH_RISK_OUTPUT()),
      issues: [],
    }
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'E: HIGH_RISK + empty issues must fail schema')
    assert.equal(spyCalled, false, 'E: semanticValidator must NOT be invoked after schema failure')
  }

  // F. issue.checkedAuthoritySources = [] -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = JSON.parse(HIGH_RISK_OUTPUT())
    payload.issues[0].checkedAuthoritySources = []
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'F: issue.checkedAuthoritySources = [] must fail schema')
    assert.equal(spyCalled, false, 'F: semanticValidator must NOT be invoked after schema failure')
  }

  // G. issue.sourceEvidence = [] -> SCHEMA_INVALID
  {
    let spyCalled = false
    const spy = () => { spyCalled = true; return { ok: true } }
    const payload = JSON.parse(HIGH_RISK_OUTPUT())
    payload.issues[0].sourceEvidence = []
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema, semanticValidator: spy })
    assert.equal(res.disposition, 'SCHEMA_INVALID', 'G: issue.sourceEvidence = [] must fail schema')
    assert.equal(spyCalled, false, 'G: semanticValidator must NOT be invoked after schema failure')
  }

  // H. valid LOW_RISK fixture still passes schema + semantic validation
  {
    const payload = JSON.parse(LOW_RISK_OUTPUT())
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema })
    assert.equal(res.disposition, 'VALID_LOW_RISK', 'H: valid LOW_RISK must produce VALID_LOW_RISK')
    assert.equal(res.isValid, true)
  }

  // I. valid HIGH_RISK fixture still passes schema + semantic validation
  {
    const payload = JSON.parse(HIGH_RISK_OUTPUT())
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema })
    assert.equal(res.disposition, 'VALID_HIGH_RISK', 'I: valid HIGH_RISK must produce VALID_HIGH_RISK')
    assert.equal(res.isValid, true)
  }

  // J. HIGH_RISK must not incorrectly trigger LOW_RISK `then` constraints
  {
    const payload = JSON.parse(HIGH_RISK_OUTPUT())
    assert.equal(payload.lowRiskCoverage, undefined, 'J: HIGH_RISK payload does not have lowRiskCoverage')
    const res = classifyOutputDisposition({ rawText: JSON.stringify(payload), schema })
    assert.equal(res.disposition, 'VALID_HIGH_RISK', 'J: HIGH_RISK must not trigger LOW_RISK then constraints')
    assert.equal(res.isValid, true)
  }
})
