import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import {
  EXPERIMENT_DIR,
  PROTOCOL_PATH,
  COHORT_PATH,
  FROZEN_BINDINGS,
  FROZEN_MODEL_CONFIG,
  FROZEN_CALL_LIMITS,
  EXPECTED_COHORT_CANDIDATE_IDS,
  VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY,
  VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN,
  TECHNICAL_OUTCOMES,
  CANDIDATE_STATES,
  sha256Bytes,
  isValidTokenCount,
  resolveUsageTokenCounts,
  calculateCallCost,
  checkPreDispatchAffordability,
  verifyExecutionAuthorization,
  resolveModelConfiguration,
  verifyFrozenBindings,
  loadAndVerifyCohort,
  deriveAttemptRecordFromRaw,
  validateDurableRawEvidence,
  validateDurableCandidateState,
  runAblationPreflight,
  runAblationDryRun,
  runAblationExecution,
} from './runVerifierV13LowThinkingAblation.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function createTempExecutionDir() {
  const tmpBase = path.join(os.tmpdir(), `ablation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(tmpBase, { recursive: true })
  return tmpBase
}

const VALID_ENV = {
  [VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]: VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN,
  GEMINI_API_KEY: 'test-fake-key-offline',
}

const MOCK_VALID_PAYLOAD = {
  riskLevel: 'HIGH_RISK',
  primaryRiskFactor: 'SPOILER_LEAKAGE',
  riskReasons: ['Reveals key plot twists and ending'],
  affectedFields: ['visibleEditorialCopy.synopsis'],
  recommendedDisposition: 'REJECT_TO_EDITORIAL_REPAIR',
  confidenceScore: 0.95,
}

function makeMockGeminiResponse(contentObj, { finishReason = 'STOP', thinkingTokens = 1200, outputTokens = 350, promptTokens = 3280 } = {}) {
  const text = typeof contentObj === 'string' ? contentObj : JSON.stringify(contentObj)
  return JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: 'model',
        },
        finishReason,
      },
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: outputTokens,
      thinkingTokenCount: thinkingTokens,
      totalTokenCount: promptTokens + outputTokens + thinkingTokens,
    },
  })
}

// -------------------------------------------------------------
// Tests A-D: Preflight Authorization and Credential Gates
// -------------------------------------------------------------

test('A. preflight missing authorization: PREFLIGHT_BLOCKED / AUTHORIZATION_REQUIRED / zero network', async () => {
  const res = await runAblationPreflight({ env: {} })
  assert.equal(res.ok, false)
  assert.equal(res.status, 'PREFLIGHT_BLOCKED')
  assert.equal(res.reason, 'AUTHORIZATION_REQUIRED')
  assert.equal(res.networkCallsAttempted, 0)
  assert.equal(res.authorizationConfigured, undefined)
})

test('B. preflight incorrect authorization: PREFLIGHT_BLOCKED / AUTHORIZATION_INVALID / zero network', async () => {
  const res = await runAblationPreflight({
    env: {
      [VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]: 'WRONG_UNAUTHORIZED_TOKEN',
      GEMINI_API_KEY: 'test-key',
    },
  })
  assert.equal(res.ok, false)
  assert.equal(res.status, 'PREFLIGHT_BLOCKED')
  assert.equal(res.reason, 'AUTHORIZATION_INVALID')
  assert.equal(res.networkCallsAttempted, 0)
})

test('C. preflight correct authorization but missing credential: PREFLIGHT_BLOCKED / CREDENTIAL_UNAVAILABLE / zero network', async () => {
  const res = await runAblationPreflight({
    env: {
      [VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]: VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN,
      // GEMINI_API_KEY omitted
    },
  })
  assert.equal(res.ok, false)
  assert.equal(res.status, 'PREFLIGHT_BLOCKED')
  assert.equal(res.reason, 'CREDENTIAL_UNAVAILABLE')
  assert.equal(res.networkCallsAttempted, 0)
})

test('D. preflight correct authorization + injected/mock credential: PREFLIGHT_PASSED / zero network', async () => {
  const res = await runAblationPreflight({ env: VALID_ENV })
  assert.equal(res.ok, true)
  assert.equal(res.status, 'PREFLIGHT_PASSED')
  assert.equal(res.networkCallsAttempted, 0)
  assert.equal(res.totalCandidates, 4)
  assert.equal(res.authorizationConfigured, true)
  assert.equal(res.credentialAvailable, true)
  assert.equal(res.costArithmetic.affordabilityVerified, true)
})

// -------------------------------------------------------------
// Tests E-G: Run Fails Before Execution Artifact Creation
// -------------------------------------------------------------

test('E. run missing authorization halts with 0 calls and 0 execution artifacts', async () => {
  const tmpDir = path.join(os.tmpdir(), `run-test-noauth-${Date.now()}`)
  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: {},
    fetchImpl: mockFetch,
    executionDir: tmpDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'BLOCKED')
  assert.equal(res.reason, 'AUTHORIZATION_REQUIRED')
  assert.equal(res.networkCallsAttempted, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(fs.existsSync(tmpDir), false) // Directory was NOT created
})

test('F. run invalid authorization halts with 0 calls and 0 execution artifacts', async () => {
  const tmpDir = path.join(os.tmpdir(), `run-test-badauth-${Date.now()}`)
  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: {
      [VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]: 'INVALID_TOKEN',
      GEMINI_API_KEY: 'test-key',
    },
    fetchImpl: mockFetch,
    executionDir: tmpDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'BLOCKED')
  assert.equal(res.reason, 'AUTHORIZATION_INVALID')
  assert.equal(res.networkCallsAttempted, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(fs.existsSync(tmpDir), false) // Directory was NOT created
})

test('G. run missing credential halts with 0 calls and 0 execution artifacts', async () => {
  const tmpDir = path.join(os.tmpdir(), `run-test-nocred-${Date.now()}`)
  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: {
      [VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_KEY]: VERIFIER_LOW_THINKING_ABLATION_AUTHORIZATION_TOKEN,
      // No GEMINI_API_KEY
    },
    fetchImpl: mockFetch,
    executionDir: tmpDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'BLOCKED')
  assert.equal(res.reason, 'CREDENTIAL_UNAVAILABLE')
  assert.equal(res.networkCallsAttempted, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(fs.existsSync(tmpDir), false) // Directory was NOT created
})

// -------------------------------------------------------------
// Dry-run Structural Validation & Readiness Distinction
// -------------------------------------------------------------

test('Dry-run distinguishes structural request validity from live readiness', async () => {
  const resNoAuth = await runAblationDryRun({ env: {} })
  assert.equal(resNoAuth.ok, true)
  assert.equal(resNoAuth.status, 'DRY_RUN_PASSED')
  assert.equal(resNoAuth.authorizationConfigured, false)
  assert.equal(resNoAuth.credentialAvailable, false)
  assert.equal(resNoAuth.liveExecutionReady, false)
  assert.equal(resNoAuth.dispatchesAttempted, 0)
  assert.equal(resNoAuth.networkCallsAttempted, 0)
  assert.equal(resNoAuth.accumulatedReservedCostUsd, 0.1044)

  const resWithAuth = await runAblationDryRun({ env: VALID_ENV })
  assert.equal(resWithAuth.ok, true)
  assert.equal(resWithAuth.status, 'DRY_RUN_PASSED')
  assert.equal(resWithAuth.authorizationConfigured, true)
  assert.equal(resWithAuth.credentialAvailable, true)
  assert.equal(resWithAuth.liveExecutionReady, true)

  const execDir = path.join(EXPERIMENT_DIR, 'execution')
  assert.equal(fs.existsSync(execDir), false)
})

// -------------------------------------------------------------
// R0.2 Execution-Accounting and Inconsistent-Evidence Tests (1-8)
// -------------------------------------------------------------

test('R0.2-1. Raw-only recovery: 1 pre-existing raw, 3 mocked new dispatches -> final confirmed/total calls = 4, new calls = 3', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: candId0,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCandidates = []
  const mockFetch = async (url) => {
    dispatchCandidates.push(url)
    return {
      status: 200,
      text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD),
    }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchCandidates.length, 3)
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.totalExternalCalls, 4)
  assert.equal(res.newExternalCallsThisInvocation, 3)
  assert.equal(res.executionLedger.confirmedExternalCalls, 4)
  assert.equal(res.executionLedger.totalExternalCalls, 4)
  assert.equal(res.executionLedger.newExternalCallsThisInvocation, 3)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-2. Fully completed rerun: 1st invocation makes 4 calls, 2nd makes 0 calls, 2nd final ledger reports 4 cumulative calls', async () => {
  const tmpExecDir = createTempExecutionDir()

  let run1Calls = 0
  const mockFetch1 = async () => {
    run1Calls += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res1 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch1,
    executionDir: tmpExecDir,
  })
  assert.equal(res1.ok, true)
  assert.equal(run1Calls, 4)
  assert.equal(res1.confirmedExternalCalls, 4)
  assert.equal(res1.newExternalCallsThisInvocation, 4)

  let run2Calls = 0
  const mockFetch2 = async () => {
    run2Calls += 1
    throw new Error('fetch should not be called on completed rerun')
  }

  const res2 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch2,
    executionDir: tmpExecDir,
  })
  assert.equal(res2.ok, true)
  assert.equal(run2Calls, 0)
  assert.equal(res2.confirmedExternalCalls, 4)
  assert.equal(res2.totalExternalCalls, 4)
  assert.equal(res2.newExternalCallsThisInvocation, 0)
  assert.equal(res2.executionLedger.confirmedExternalCalls, 4)
  assert.equal(res2.executionLedger.totalExternalCalls, 4)
  assert.equal(res2.executionLedger.newExternalCallsThisInvocation, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-3. Partial completed resume: two candidates already completed with raw+derived+state, second invocation sends exactly two calls', async () => {
  const tmpExecDir = createTempExecutionDir()

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })

  for (let i = 0; i < 2; i += 1) {
    const c = cohortRes.candidateChecks[i]
    const candDir = path.join(tmpExecDir, c.candidateId)
    fs.mkdirSync(candDir, { recursive: true })

    const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
    const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
    fs.writeFileSync(
      path.join(candDir, 'attempt-1.raw.json'),
      JSON.stringify({
        candidateId: c.candidateId,
        attemptIndex: 1,
        requestHash: c.requestHash,
        httpStatus: 200,
        rawResponse: rawPayload,
        rawResponseSha256: rawSha256,
        transportError: null,
      }),
      'utf8'
    )
    const { attemptRecord } = deriveAttemptRecordFromRaw({
      candidateId: c.candidateId,
      attemptIndex: 1,
      requestHash: c.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      schema,
    })
    fs.writeFileSync(path.join(candDir, 'attempt-1.json'), JSON.stringify(attemptRecord, null, 2), 'utf8')
    fs.writeFileSync(
      path.join(candDir, 'candidate-state.json'),
      JSON.stringify({
        candidateId: c.candidateId,
        state: CANDIDATE_STATES.COMPLETED,
        attemptCount: 1,
        requestHash: c.requestHash,
        technicalOutcome: attemptRecord.technicalOutcome,
        technicalSerializationSuccess: true,
        callCostUsd: attemptRecord.callCostUsd,
      }),
      'utf8'
    )
  }

  let invocationDispatches = []
  const mockFetch = async (url) => {
    invocationDispatches.push(url)
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(invocationDispatches.length, 2)
  assert.equal(res.newExternalCallsThisInvocation, 2)
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.totalExternalCalls, 4)
  assert.equal(res.executionLedger.confirmedExternalCalls, 4)
  assert.equal(res.executionLedger.newExternalCallsThisInvocation, 2)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-4. Derived exists without raw: HALT INCONSISTENT_EXECUTION_EVIDENCE, zero dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.json'),
    JSON.stringify({ candidateId: candId0, attemptIndex: 1 }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-5. State COMPLETED + derived but raw missing: HALT INCONSISTENT_EXECUTION_EVIDENCE, zero dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({ candidateId: candId0, state: CANDIDATE_STATES.COMPLETED }),
    'utf8'
  )
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.json'),
    JSON.stringify({ candidateId: candId0, attemptIndex: 1 }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-6. State COMPLETED + raw but derived missing: HALT INCONSISTENT_EXECUTION_EVIDENCE, zero dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({ candidateId: candId0, state: CANDIDATE_STATES.COMPLETED }),
    'utf8'
  )
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({ candidateId: candId0, attemptIndex: 1, rawResponse: '{}' }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-7. raw + derived with missing/incomplete state: must never redispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })

  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )
  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawPayload,
    rawResponseSha256: rawSha256,
    schema,
  })
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(attemptRecord, null, 2), 'utf8')

  let dispatchedCandidates = []
  const mockFetch = async (url) => {
    dispatchedCandidates.push(url)
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchedCandidates.length, 3)
  assert.equal(res.newExternalCallsThisInvocation, 3)
  assert.equal(res.confirmedExternalCalls, 4)

  const recoveredState0 = JSON.parse(fs.readFileSync(path.join(candDir0, 'candidate-state.json'), 'utf8'))
  assert.equal(recoveredState0.state, CANDIDATE_STATES.COMPLETED)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R0.2-8. Call-cap check uses cumulative confirmed historical calls', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })

  for (let i = 0; i < 4; i += 1) {
    const c = cohortRes.candidateChecks[i]
    const candDir = path.join(tmpExecDir, c.candidateId)
    fs.mkdirSync(candDir, { recursive: true })
    const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
    const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
    fs.writeFileSync(
      path.join(candDir, 'attempt-1.raw.json'),
      JSON.stringify({
        candidateId: c.candidateId,
        attemptIndex: 1,
        requestHash: c.requestHash,
        httpStatus: 200,
        rawResponse: rawPayload,
        rawResponseSha256: rawSha256,
      }),
      'utf8'
    )
  }

  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(fetchCalls, 0)
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.newExternalCallsThisInvocation, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

// -------------------------------------------------------------
// Existing Harness Guarantees & Integrity Tests
// -------------------------------------------------------------

test('Harness: Exact 4 candidate order matches expected sequence', async () => {
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))

  const res = await loadAndVerifyCohort({ promptText, schema })
  const actualIds = res.cohort.records.map((r) => r.candidateId)
  assert.deepEqual(actualIds, EXPECTED_COHORT_CANDIDATE_IDS)
})

test('Harness: RequestHash parity for all 4 cohort candidates', async () => {
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))

  const res = await loadAndVerifyCohort({ promptText, schema })
  for (let i = 0; i < 4; i += 1) {
    const record = res.cohort.records[i]
    const check = res.candidateChecks[i]
    assert.equal(check.requestHash, record.ablationLowRequestHash)
    assert.ok(check.requestHash.startsWith('sha256:'))
  }
})

test('Harness: Low-thinking request configuration preserves exact parameters', async () => {
  assert.equal(FROZEN_MODEL_CONFIG.provider, 'google-gemini-developer-api')
  assert.equal(FROZEN_MODEL_CONFIG.modelId, 'gemini-3.8-flash')
  assert.equal(FROZEN_MODEL_CONFIG.thinkingLevel, 'low')
  assert.equal(FROZEN_MODEL_CONFIG.maxOutputTokens, 6144)
  assert.equal(FROZEN_MODEL_CONFIG.temperature, 0.0)
  assert.equal(FROZEN_MODEL_CONFIG.timeoutMs, 30000)

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const res = await loadAndVerifyCohort({ promptText, schema })

  for (const c of res.candidateChecks) {
    const genConfig = c.request.body.generationConfig
    assert.equal(genConfig.thinkingConfig.thinkingLevel, 'low')
    assert.equal(genConfig.maxOutputTokens, 6144)
    assert.equal(genConfig.temperature, 0)
    assert.equal(genConfig.responseMimeType, 'application/json')
  }
})

test('Harness: No retries possible: failure consumes candidate single call and halts attempt cycle', async () => {
  const tmpExecDir = createTempExecutionDir()
  let dispatchCount = 0

  const mockFetch = async () => {
    dispatchCount += 1
    return {
      status: 500,
      text: async () => 'Internal Server Error',
    }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchCount, 4) // exactly 1 dispatch per candidate, zero retries
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.newExternalCallsThisInvocation, 4)

  for (const cId of EXPECTED_COHORT_CANDIDATE_IDS) {
    const candDir = path.join(tmpExecDir, cId)
    assert.equal(fs.existsSync(path.join(candDir, 'attempt-1.raw.json')), true)
    assert.equal(fs.existsSync(path.join(candDir, 'attempt-1.json')), true)
    assert.equal(fs.existsSync(path.join(candDir, 'attempt-2.raw.json')), false)
    assert.equal(fs.existsSync(path.join(candDir, 'attempt-2.json')), false)

    const derived = JSON.parse(fs.readFileSync(path.join(candDir, 'attempt-1.json'), 'utf8'))
    assert.equal(derived.technicalOutcome, TECHNICAL_OUTCOMES.TECHNICAL_TRANSPORT_FAILURE)
    assert.equal(derived.technicalSerializationSuccess, false)
  }

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Harness: Call cap of 4 calls strictly enforced', () => {
  assert.equal(FROZEN_CALL_LIMITS.plannedPrimaryCalls, 4)
  assert.equal(FROZEN_CALL_LIMITS.maxRetries, 0)
  assert.equal(FROZEN_CALL_LIMITS.maxTotalCalls, 4)
})

test('Harness: Cost reserve and ceiling enforcement', () => {
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.124000 }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.104400 }), true)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0 }), true)
})

test('Harness: Raw response is persisted before derived attempt and candidate completion', async () => {
  const tmpExecDir = createTempExecutionDir()
  const operations = []

  const mockFetch = async () => {
    operations.push('NETWORK_DISPATCH')
    return {
      status: 200,
      text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD),
    }
  }

  await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  const candDir = path.join(tmpExecDir, EXPECTED_COHORT_CANDIDATE_IDS[0])
  const rawFile = path.join(candDir, 'attempt-1.raw.json')
  const derivedFile = path.join(candDir, 'attempt-1.json')
  const stateFile = path.join(candDir, 'candidate-state.json')

  assert.equal(fs.existsSync(rawFile), true)
  assert.equal(fs.existsSync(derivedFile), true)
  assert.equal(fs.existsSync(stateFile), true)

  const rawStat = fs.statSync(rawFile)
  const derivedStat = fs.statSync(derivedFile)
  assert.ok(rawStat.mtimeMs <= derivedStat.mtimeMs)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Harness: Raw-only crash recovery derives attempt-1 without redispatch', async () => {
  const tmpExecDir = createTempExecutionDir()

  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: candId0,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCandidates = []
  const mockFetch = async (url) => {
    dispatchCandidates.push(url)
    return {
      status: 200,
      text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD),
    }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchCandidates.length, 3)
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.newExternalCallsThisInvocation, 3)

  const derived0 = JSON.parse(fs.readFileSync(path.join(candDir0, 'attempt-1.json'), 'utf8'))
  assert.equal(derived0.technicalOutcome, TECHNICAL_OUTCOMES.SERIALIZATION_SUCCESS)
  assert.equal(derived0.technicalSerializationSuccess, true)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Harness: Ambiguous DISPATCH_STARTED without raw evidence halts execution', async () => {
  const tmpExecDir = createTempExecutionDir()

  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({
      candidateId: candId0,
      state: CANDIDATE_STATES.DISPATCH_STARTED,
      attemptCount: 1,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'AMBIGUOUS_DISPATCH_STATE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  const updatedState = JSON.parse(fs.readFileSync(path.join(candDir0, 'candidate-state.json'), 'utf8'))
  assert.equal(updatedState.state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Harness: Completed candidate skips dispatch on rerun', async () => {
  const tmpExecDir = createTempExecutionDir()

  let firstRunDispatches = 0
  const mockFetch = async () => {
    firstRunDispatches += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(firstRunDispatches, 4)

  let secondRunDispatches = 0
  const secondMockFetch = async () => {
    secondRunDispatches += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const secondRes = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: secondMockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(secondRes.ok, true)
  assert.equal(secondRunDispatches, 0)
  assert.equal(secondRes.confirmedExternalCalls, 4)
  assert.equal(secondRes.newExternalCallsThisInvocation, 0)
  assert.equal(secondRes.executionLedger.completedCandidates, 4)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Harness: Attempt-2 indexing is strictly forbidden by derivation contract', () => {
  assert.throws(
    () => {
      deriveAttemptRecordFromRaw({
        candidateId: 'test',
        attemptIndex: 2,
        requestHash: 'sha256:test',
        schema: {},
      })
    },
    { code: 'ATTEMPT_INDEX_FORBIDDEN' }
  )
})

test('Harness: MAX_TOKENS response classified as MAX_TOKENS_TRUNCATION and technicalSerializationSuccess=false', () => {
  const rawMaxTokens = makeMockGeminiResponse('{"incomplete": true, "text": "ab', { finishReason: 'MAX_TOKENS' })
  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test',
    httpStatus: 200,
    rawResponse: rawMaxTokens,
    schema: {},
  })

  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.MAX_TOKENS_TRUNCATION)
  assert.equal(technicalSerializationSuccess, false)
  assert.equal(attemptRecord.technicalSerializationSuccess, false)
  assert.equal(attemptRecord.finishReason, 'MAX_TOKENS')
  assert.equal(attemptRecord.observationalDisposition, 'MALFORMED_MAX_TOKENS')
})

test('Harness: Parseable JSON with schema errors counts as SERIALIZATION_SUCCESS', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const invalidSchemaJson = { someRandomField: 'not in schema' }
  const rawResponse = makeMockGeminiResponse(invalidSchemaJson, { finishReason: 'STOP' })

  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test',
    httpStatus: 200,
    rawResponse,
    schema,
  })

  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.SERIALIZATION_SUCCESS)
  assert.equal(technicalSerializationSuccess, true)
  assert.equal(attemptRecord.technicalSerializationSuccess, true)
  assert.equal(attemptRecord.schemaValidation.valid, false)
  assert.equal(attemptRecord.observationalDisposition, 'SCHEMA_INVALID')
})

test('Harness: Parseable JSON with semantic validation failure counts as SERIALIZATION_SUCCESS', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const semanticInvalidPayload = {
    riskLevel: 'UNKNOWN_RISK_LEVEL',
    primaryRiskFactor: 'UNKNOWN',
    riskReasons: ['bad'],
    affectedFields: ['none'],
    recommendedDisposition: 'REJECT',
    confidenceScore: 0.5,
  }
  const rawResponse = makeMockGeminiResponse(semanticInvalidPayload, { finishReason: 'STOP' })

  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test',
    httpStatus: 200,
    rawResponse,
    schema,
  })

  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.SERIALIZATION_SUCCESS)
  assert.equal(technicalSerializationSuccess, true)
  assert.equal(attemptRecord.technicalSerializationSuccess, true)
})

test('Harness: Malformed response with finishReason=STOP classified as MALFORMED_NON_MAX_TOKENS', () => {
  const malformedStop = makeMockGeminiResponse('{not-json-content', { finishReason: 'STOP' })
  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test',
    httpStatus: 200,
    rawResponse: malformedStop,
    schema: {},
  })

  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.MALFORMED_NON_MAX_TOKENS)
  assert.equal(technicalSerializationSuccess, false)
  assert.equal(attemptRecord.technicalSerializationSuccess, false)
  assert.equal(attemptRecord.observationalDisposition, 'MALFORMED_JSON_STRING')
})

test('Harness: Transport / network failure classified as TECHNICAL_TRANSPORT_FAILURE', () => {
  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test',
    httpStatus: 503,
    rawResponse: 'Service Unavailable',
    transportError: { message: 'HTTP 503', code: 'HTTP_503_SERVICE_UNAVAILABLE' },
    schema: {},
  })

  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.TECHNICAL_TRANSPORT_FAILURE)
  assert.equal(technicalSerializationSuccess, false)
  assert.equal(attemptRecord.technicalSerializationSuccess, false)
  assert.equal(attemptRecord.observationalDisposition, 'TECHNICAL_TRANSPORT_FAILURE')
})

test('Harness: Prospective holdout access strictly forbidden', async () => {
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const res = await loadAndVerifyCohort({ promptText, schema })

  for (const c of res.cohort.records) {
    assert.equal(c.sourceRiskInputPath.includes('holdout'), false)
    assert.equal(c.candidateId.includes('holdout'), false)
  }
})

// -------------------------------------------------------------
// R0.3 Verification & Edge Case Tests (A through S)
// -------------------------------------------------------------

test('A. AMBIGUOUS_DISPATCH_STATE survives repeated restarts with 0 dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  // Candidate initially crashes after DISPATCH_STARTED
  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({
      candidateId: candId0,
      state: CANDIDATE_STATES.DISPATCH_STARTED,
      attemptCount: 1,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  // First restart transitions to AMBIGUOUS_DISPATCH_STATE and halts
  const res1 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res1.ok, false)
  assert.equal(res1.status, 'HALTED')
  assert.equal(res1.reason, 'AMBIGUOUS_DISPATCH_STATE')
  assert.equal(res1.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  const stateAfter1 = JSON.parse(fs.readFileSync(path.join(candDir0, 'candidate-state.json'), 'utf8'))
  assert.equal(stateAfter1.state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)

  // Second restart still halts with AMBIGUOUS_DISPATCH_STATE and 0 dispatches
  const res2 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res2.ok, false)
  assert.equal(res2.status, 'HALTED')
  assert.equal(res2.reason, 'AMBIGUOUS_DISPATCH_STATE')
  assert.equal(res2.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  // Third restart still halts with AMBIGUOUS_DISPATCH_STATE and 0 dispatches
  const res3 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res3.ok, false)
  assert.equal(res3.status, 'HALTED')
  assert.equal(res3.reason, 'AMBIGUOUS_DISPATCH_STATE')
  assert.equal(res3.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('B. malformed candidate-state.json -> structured INCONSISTENT_EXECUTION_EVIDENCE / 0 dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(path.join(candDir0, 'candidate-state.json'), '{ invalid json truncated...', 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('C. unknown state enum -> halt / 0 dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({
      candidateId: candId0,
      state: 'UNKNOWN_STATE_XYZ',
      attemptCount: 1,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('D. raw JSON malformed -> structured halt / 0 dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(path.join(candDir0, 'attempt-1.raw.json'), '{ corrupted raw json...', 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('E. raw candidateId mismatch -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: 'wrong-candidate-id',
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('F. raw requestHash mismatch -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: candId0,
      attemptIndex: 1,
      requestHash: 'sha256:mismatched-request-hash',
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('G. raw attemptIndex != 1 -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha256 = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: candId0,
      attemptIndex: 2,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha256,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('H. rawResponse SHA mismatch -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: candId0,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: 'sha256:fake-hash-that-does-not-match',
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('I. empty string response: rawResponse = "", exact SHA = e3b0c442..., remains distinguishable from null body', () => {
  const emptyStrSha = sha256Bytes(Buffer.from('', 'utf8'))
  assert.equal(emptyStrSha, 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')

  const valRes = validateDurableRawEvidence({
    rawContent: {
      candidateId: 'test-cand',
      attemptIndex: 1,
      requestHash: 'sha256:test-hash',
      httpStatus: 200,
      rawResponse: '',
      rawResponseSha256: emptyStrSha,
      transportError: null,
    },
    expectedCandidateId: 'test-cand',
    expectedRequestHash: 'sha256:test-hash',
  })
  assert.equal(valRes.ok, true)

  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: '',
    rawResponseSha256: emptyStrSha,
    schema: {},
  })
  assert.equal(technicalSerializationSuccess, false)
  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.MALFORMED_NON_MAX_TOKENS)
  assert.equal(attemptRecord.rawResponseSha256, emptyStrSha)
  assert.equal(attemptRecord.rawTextLength, 0)
})

test('J. null transport body: rawResponse = null, rawResponseSha256 = null', () => {
  const valRes = validateDurableRawEvidence({
    rawContent: {
      candidateId: 'test-cand',
      attemptIndex: 1,
      requestHash: 'sha256:test-hash',
      httpStatus: null,
      rawResponse: null,
      rawResponseSha256: null,
      transportError: { message: 'Network failed', code: 'ECONNREFUSED' },
    },
    expectedCandidateId: 'test-cand',
    expectedRequestHash: 'sha256:test-hash',
  })
  assert.equal(valRes.ok, true)

  const { attemptRecord, technicalSerializationSuccess } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: null,
    rawResponse: null,
    rawResponseSha256: null,
    transportError: { message: 'Network failed', code: 'ECONNREFUSED' },
    schema: {},
  })
  assert.equal(technicalSerializationSuccess, false)
  assert.equal(attemptRecord.technicalOutcome, TECHNICAL_OUTCOMES.TECHNICAL_TRANSPORT_FAILURE)
  assert.equal(attemptRecord.rawResponseSha256, null)
  assert.equal(attemptRecord.rawTextLength, 0)
})

test('K. persisted derived technicalSerializationSuccess tampered -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  // Raw is a MAX_TOKENS truncation
  const rawTruncated = makeMockGeminiResponse('{"part": "truncated', { finishReason: 'MAX_TOKENS' })
  const rawSha = sha256Bytes(Buffer.from(rawTruncated, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawTruncated,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawTruncated,
    rawResponseSha256: rawSha,
    schema,
  })

  // Tamper: claim serializationSuccess = true
  const tamperedDerived = { ...attemptRecord, technicalSerializationSuccess: true }
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(tamperedDerived, null, 2), 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, c0.candidateId)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('L. persisted derived technicalOutcome tampered -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawTruncated = makeMockGeminiResponse('{"part": "truncated', { finishReason: 'MAX_TOKENS' })
  const rawSha = sha256Bytes(Buffer.from(rawTruncated, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawTruncated,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawTruncated,
    rawResponseSha256: rawSha,
    schema,
  })

  // Tamper: change outcome to SERIALIZATION_SUCCESS
  const tamperedDerived = { ...attemptRecord, technicalOutcome: TECHNICAL_OUTCOMES.SERIALIZATION_SUCCESS }
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(tamperedDerived, null, 2), 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, c0.candidateId)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('M. persisted derived callCostUsd = 0 but raw usage implies >0 -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawPayload,
    rawResponseSha256: rawSha,
    schema,
  })

  // Tamper: cost set to 0
  const tamperedDerived = { ...attemptRecord, callCostUsd: 0 }
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(tamperedDerived, null, 2), 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, c0.candidateId)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('N. persisted derived usageMetadata mismatch -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawPayload,
    rawResponseSha256: rawSha,
    schema,
  })

  // Tamper: usageMetadata mismatch
  const tamperedDerived = { ...attemptRecord, usageMetadata: { promptTokenCount: 99999 } }
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(tamperedDerived, null, 2), 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, c0.candidateId)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('O. COMPLETED state fields disagree with raw-derived truth -> halt', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
  const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: c0.candidateId,
    attemptIndex: 1,
    requestHash: c0.requestHash,
    httpStatus: 200,
    rawResponse: rawPayload,
    rawResponseSha256: rawSha,
    schema,
  })
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(attemptRecord, null, 2), 'utf8')

  // State claims incorrect technicalOutcome
  fs.writeFileSync(
    path.join(candDir0, 'candidate-state.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      state: CANDIDATE_STATES.COMPLETED,
      attemptCount: 1,
      requestHash: c0.requestHash,
      technicalOutcome: 'INCORRECT_OUTCOME',
      technicalSerializationSuccess: attemptRecord.technicalSerializationSuccess,
      callCostUsd: attemptRecord.callCostUsd,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, c0.candidateId)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('P. raw-only recovery with missing usageMetadata uses conservative reserve and does not dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  // Raw response with 500 error and NO usage metadata
  const rawPayload = 'Internal Server Error 500'
  const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 500,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchCount, 3) // Dispatches only the other 3
  assert.equal(res.confirmedExternalCalls, 4)
  assert.equal(res.newExternalCallsThisInvocation, 3)

  const derived0 = JSON.parse(fs.readFileSync(path.join(candDir0, 'attempt-1.json'), 'utf8'))
  assert.equal(derived0.callCostUsd, FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('Q. restart cost reconstruction cannot decrease historical accumulated cost', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })

  // Complete 2 candidates
  for (let i = 0; i < 2; i += 1) {
    const c = cohortRes.candidateChecks[i]
    const candDir = path.join(tmpExecDir, c.candidateId)
    fs.mkdirSync(candDir, { recursive: true })
    const rawPayload = makeMockGeminiResponse(MOCK_VALID_PAYLOAD)
    const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))
    fs.writeFileSync(
      path.join(candDir, 'attempt-1.raw.json'),
      JSON.stringify({
        candidateId: c.candidateId,
        attemptIndex: 1,
        requestHash: c.requestHash,
        httpStatus: 200,
        rawResponse: rawPayload,
        rawResponseSha256: rawSha,
        transportError: null,
      }),
      'utf8'
    )
    const { attemptRecord } = deriveAttemptRecordFromRaw({
      candidateId: c.candidateId,
      attemptIndex: 1,
      requestHash: c.requestHash,
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      schema,
    })
    fs.writeFileSync(path.join(candDir, 'attempt-1.json'), JSON.stringify(attemptRecord, null, 2), 'utf8')
  }

  // First run resumes and dispatches remaining 2
  const mockFetch = async () => ({ status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) })
  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res.ok, true)
  const cost1 = res.accumulatedCostUsd

  // Tamper: try to zero out candidate 0 derived cost on disk
  const candDir0 = path.join(tmpExecDir, cohortRes.candidateChecks[0].candidateId)
  const d0 = JSON.parse(fs.readFileSync(path.join(candDir0, 'attempt-1.json'), 'utf8'))
  d0.callCostUsd = 0
  fs.writeFileSync(path.join(candDir0, 'attempt-1.json'), JSON.stringify(d0, null, 2), 'utf8')

  // Rerun must HALT on tampered cost rather than reducing accumulated cost!
  const res2 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res2.ok, false)
  assert.equal(res2.status, 'HALTED')
  assert.equal(res2.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('R. unexpected attempt-2 artifact -> halt / 0 dispatch', async () => {
  const tmpExecDir = createTempExecutionDir()
  const candId0 = EXPECTED_COHORT_CANDIDATE_IDS[0]
  const candDir0 = path.join(tmpExecDir, candId0)
  fs.mkdirSync(candDir0, { recursive: true })

  fs.writeFileSync(path.join(candDir0, 'attempt-2.raw.json'), '{}', 'utf8')

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => '' }
  }

  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'HALTED')
  assert.equal(res.reason, 'INCONSISTENT_EXECUTION_EVIDENCE')
  assert.equal(res.candidateId, candId0)
  assert.equal(dispatchCount, 0)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

test('S. clean completed 4-candidate rerun: new dispatch = 0, confirmed calls = 4, cumulative cost reconstructed exactly from raw', async () => {
  const tmpExecDir = createTempExecutionDir()

  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  const res1 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })
  assert.equal(res1.ok, true)
  assert.equal(fetchCount, 4)
  assert.equal(res1.confirmedExternalCalls, 4)
  assert.equal(res1.newExternalCallsThisInvocation, 4)
  assert.equal(res1.executionLedger.completedCandidates, 4)

  const res2 = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: async () => { throw new Error('Fetch should not be called!') },
    executionDir: tmpExecDir,
  })
  assert.equal(res2.ok, true)
  assert.equal(res2.confirmedExternalCalls, 4)
  assert.equal(res2.newExternalCallsThisInvocation, 0)
  assert.equal(res2.totalExternalCalls, 4)
  assert.equal(res2.accumulatedCostUsd, res1.accumulatedCostUsd)
  assert.equal(res2.executionLedger.completedCandidates, 4)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})

// -------------------------------------------------------------
// R0.4: Token-Count Validation, Cost Safety & Adversarial Tests
// -------------------------------------------------------------

test('R0.4-1. isValidTokenCount helper rejects negative, float, NaN, Infinity, strings, objects', () => {
  assert.equal(isValidTokenCount(0), true)
  assert.equal(isValidTokenCount(1), true)
  assert.equal(isValidTokenCount(3280), true)
  assert.equal(isValidTokenCount(1000000), true)

  // Rejections
  assert.equal(isValidTokenCount(-1), false)
  assert.equal(isValidTokenCount(-1000000), false)
  assert.equal(isValidTokenCount(NaN), false)
  assert.equal(isValidTokenCount(Infinity), false)
  assert.equal(isValidTokenCount(-Infinity), false)
  assert.equal(isValidTokenCount(10.5), false)
  assert.equal(isValidTokenCount('100'), false)
  assert.equal(isValidTokenCount(''), false)
  assert.equal(isValidTokenCount('bad'), false)
  assert.equal(isValidTokenCount(null), false)
  assert.equal(isValidTokenCount(undefined), false)
  assert.equal(isValidTokenCount({}), false)
  assert.equal(isValidTokenCount([]), false)
})

test('R0.4-2. Adversarial usageMetadata cases A through L fall back to conservative reserve', () => {
  const schema = {}
  const cases = [
    { label: 'A. promptTokenCount = -1', usage: { promptTokenCount: -1, candidatesTokenCount: 100 } },
    { label: 'B. candidatesTokenCount = -1', usage: { promptTokenCount: 100, candidatesTokenCount: -1 } },
    { label: 'C. thinkingTokenCount = -1', usage: { promptTokenCount: 100, candidatesTokenCount: 100, thinkingTokenCount: -1 } },
    { label: 'D. thoughtsTokenCount = -1', usage: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: -1 } },
    { label: 'E. promptTokenCount = NaN', usage: { promptTokenCount: NaN, candidatesTokenCount: 100 } },
    { label: 'F. promptTokenCount = Infinity', usage: { promptTokenCount: Infinity, candidatesTokenCount: 100 } },
    { label: 'G. candidatesTokenCount = "100"', usage: { promptTokenCount: 100, candidatesTokenCount: '100' } },
    { label: 'H. thinkingTokenCount = "bad"', usage: { promptTokenCount: 100, candidatesTokenCount: 100, thinkingTokenCount: 'bad' } },
    { label: 'I. promptTokenCount = 10.5', usage: { promptTokenCount: 10.5, candidatesTokenCount: 100 } },
    { label: 'J. candidatesTokenCount = null', usage: { promptTokenCount: 100, candidatesTokenCount: null } },
    { label: 'K. usageMetadata = {}', usage: {} },
    { label: 'L. usageMetadata absent', usage: null },
  ]

  for (const c of cases) {
    const rawPayload = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
      ...(c.usage ? { usageMetadata: c.usage } : {}),
    })
    const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))

    const { attemptRecord } = deriveAttemptRecordFromRaw({
      candidateId: 'test-cand',
      attemptIndex: 1,
      requestHash: 'sha256:test-hash',
      httpStatus: 200,
      rawResponse: rawPayload,
      rawResponseSha256: rawSha,
      schema,
    })

    assert.equal(
      attemptRecord.callCostUsd,
      FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
      `Case ${c.label} must use conservative reserve`
    )
    assert.ok(
      Number.isFinite(attemptRecord.callCostUsd) && attemptRecord.callCostUsd >= 0,
      `Case ${c.label} must produce non-negative finite cost`
    )
  }
})

test('R0.4-3. Conflicting thinkingTokenCount and thoughtsTokenCount falls back to reserve', () => {
  const schema = {}
  const rawPayload = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thinkingTokenCount: 500,
      thoughtsTokenCount: 800, // Contradictory!
    },
  })
  const rawSha = sha256Bytes(Buffer.from(rawPayload, 'utf8'))

  const { attemptRecord } = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: rawPayload,
    rawResponseSha256: rawSha,
    schema,
  })

  assert.equal(attemptRecord.callCostUsd, FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd)
})

test('R0.4-4. Valid usageMetadata preserves exact cost arithmetic', () => {
  const schema = {}

  // 1. Exact prompt + candidates + thinkingTokenCount
  const rawPayload1 = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: 3280,
      candidatesTokenCount: 350,
      thinkingTokenCount: 1200,
    },
  })
  const res1 = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: rawPayload1,
    rawResponseSha256: sha256Bytes(Buffer.from(rawPayload1, 'utf8')),
    schema,
  })
  const expectedCost1 = (3280 / 1e6) * 0.75 + ((350 + 1200) / 1e6) * 3.75
  assert.equal(Math.abs(res1.attemptRecord.callCostUsd - expectedCost1) < 1e-9, true)

  // 2. Exact prompt + candidates + thoughtsTokenCount
  const rawPayload2 = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: 2000,
      candidatesTokenCount: 400,
      thoughtsTokenCount: 600,
    },
  })
  const res2 = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: rawPayload2,
    rawResponseSha256: sha256Bytes(Buffer.from(rawPayload2, 'utf8')),
    schema,
  })
  const expectedCost2 = (2000 / 1e6) * 0.75 + ((400 + 600) / 1e6) * 3.75
  assert.equal(Math.abs(res2.attemptRecord.callCostUsd - expectedCost2) < 1e-9, true)

  // 3. Exact prompt + candidates with both thinking fields matching
  const rawPayload3 = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: 2000,
      candidatesTokenCount: 400,
      thinkingTokenCount: 600,
      thoughtsTokenCount: 600,
    },
  })
  const res3 = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: rawPayload3,
    rawResponseSha256: sha256Bytes(Buffer.from(rawPayload3, 'utf8')),
    schema,
  })
  assert.equal(Math.abs(res3.attemptRecord.callCostUsd - expectedCost2) < 1e-9, true)

  // 4. Exact prompt + candidates without any thinking fields (thinkingTokens = 0)
  const rawPayload4 = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: 4000,
      candidatesTokenCount: 800,
    },
  })
  const res4 = deriveAttemptRecordFromRaw({
    candidateId: 'test-cand',
    attemptIndex: 1,
    requestHash: 'sha256:test-hash',
    httpStatus: 200,
    rawResponse: rawPayload4,
    rawResponseSha256: sha256Bytes(Buffer.from(rawPayload4, 'utf8')),
    schema,
  })
  const expectedCost4 = (4000 / 1e6) * 0.75 + (800 / 1e6) * 3.75
  assert.equal(Math.abs(res4.attemptRecord.callCostUsd - expectedCost4) < 1e-9, true)
})

test('R0.4-5. Hardened checkPreDispatchAffordability rejects NaN, negative, Infinity, strings', () => {
  // Invalid accumulatedCost
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: -0.01 }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: -100 }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: NaN }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: Infinity }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: -Infinity }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: '0' }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: null }), false)

  // Invalid nextCallEstimate
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0, nextCallEstimate: -0.01 }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0, nextCallEstimate: NaN }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0, nextCallEstimate: Infinity }), false)

  // Invalid costCeiling
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0, costCeiling: -1 }), false)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0, costCeiling: NaN }), false)

  // Valid boundary values
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.123900, nextCallEstimate: 0.026100, costCeiling: 0.150000 }), true)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.123901, nextCallEstimate: 0.026100, costCeiling: 0.150000 }), false)
})

test('R0.4-6. Regression: Auditor attack with negative tokens cannot produce negative cost or reduce accumulated cost', async () => {
  const tmpExecDir = createTempExecutionDir()
  const promptText = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md'), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json'), 'utf8'))
  const cohortRes = await loadAndVerifyCohort({ promptText, schema })
  const c0 = cohortRes.candidateChecks[0]
  const candDir0 = path.join(tmpExecDir, c0.candidateId)
  fs.mkdirSync(candDir0, { recursive: true })

  // Adversarial raw payload with promptTokenCount = -1000000
  const adversarialRaw = JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    usageMetadata: {
      promptTokenCount: -1000000,
      candidatesTokenCount: 0,
    },
  })
  const rawSha = sha256Bytes(Buffer.from(adversarialRaw, 'utf8'))
  fs.writeFileSync(
    path.join(candDir0, 'attempt-1.raw.json'),
    JSON.stringify({
      candidateId: c0.candidateId,
      attemptIndex: 1,
      requestHash: c0.requestHash,
      httpStatus: 200,
      rawResponse: adversarialRaw,
      rawResponseSha256: rawSha,
      transportError: null,
    }),
    'utf8'
  )

  let dispatchCount = 0
  const mockFetch = async () => {
    dispatchCount += 1
    return { status: 200, text: async () => makeMockGeminiResponse(MOCK_VALID_PAYLOAD) }
  }

  // Execution must succeed and use conservative reserve for candidate 0, NOT -0.75 USD
  const res = await runAblationExecution({
    env: VALID_ENV,
    fetchImpl: mockFetch,
    executionDir: tmpExecDir,
  })

  assert.equal(res.ok, true)
  assert.equal(dispatchCount, 3)

  const derived0 = JSON.parse(fs.readFileSync(path.join(candDir0, 'attempt-1.json'), 'utf8'))
  assert.equal(derived0.callCostUsd, FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd)
  assert.notEqual(derived0.callCostUsd, -0.75)

  // Accumulated cost must be positive and include reserve
  assert.ok(res.accumulatedCostUsd > 0)
  assert.ok(res.accumulatedCostUsd >= FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd)

  fs.rmSync(tmpExecDir, { recursive: true, force: true })
})
