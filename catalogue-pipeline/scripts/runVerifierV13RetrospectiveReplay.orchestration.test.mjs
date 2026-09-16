import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runVerifierV13RetrospectiveReplay,
  verifyExecutionAuthorization,
  checkPreDispatchAffordability,
  VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
  FROZEN_CALL_LIMITS,
} from './runVerifierV13RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testExecutionDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-execution.tmp')

test('verifyExecutionAuthorization fails closed without authorization token', () => {
  const res = verifyExecutionAuthorization({ env: {} })
  assert.equal(res.authorized, false)
  assert.equal(res.reason, 'EXECUTION_NOT_AUTHORIZED')

  const valid = verifyExecutionAuthorization({
    env: { VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN },
  })
  assert.equal(valid.authorized, true)
})

test('runVerifierV13RetrospectiveReplay halts closed if unauthorized', async () => {
  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not call fetch')
  }

  const res = await runVerifierV13RetrospectiveReplay({
    env: {},
    fetchImpl: mockFetch,
    executionDir: testExecutionDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'BLOCKED')
  assert.equal(fetchCalled, false)
})

test('checkPreDispatchAffordability halts when budget exceeds ceiling', () => {
  // $1.08 + $0.026100 = $1.106100 > $1.10 => should be false
  const blocked = checkPreDispatchAffordability({
    accumulatedCost: 1.08,
    nextCallEstimate: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
  })
  assert.equal(blocked, false)

  // $0.50 + $0.026100 = $0.526100 <= $1.10 => should be true
  const allowed = checkPreDispatchAffordability({
    accumulatedCost: 0.50,
    nextCallEstimate: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
  })
  assert.equal(allowed, true)
})

test('Severe case scale500-tmdb-14283 LOW_RISK escape triggers immediate halt', async () => {
  const lowRiskText = JSON.stringify({
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
      summaryRationale: 'Clean.',
    },
  })

  const envelope = {
    candidates: [
      {
        content: {
          parts: [{ text: lowRiskText }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 500, thinkingTokenCount: 3500 },
  }

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(envelope),
  })

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.status, 'STOPPED')
    assert.equal(ledger.stoppedReason, 'STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE')
    assert.equal(ledger.severeCaseOutcome, 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Batch retry exhaustion (10 retries) disables retries while untouched primaries continue', async () => {
  let callCount = 0

  // First 5 candidates fail with 503 twice (consuming 10 retries = 5 primaries + 10 retries = 15 calls)
  // Subsequent candidates should continue, but cannot retry!
  const mockFetch = async () => {
    callCount += 1
    if (callCount <= 15) {
      return {
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      }
    }
    // After 10 retries exhausted, candidates return a terminal status without retry
    return {
      ok: false,
      status: 502, // 502 is terminal
      text: async () => 'Bad Gateway',
    }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.callAccounting.technicalRetries, 10, 'Technical retries must cap at 10')
    assert.equal(ledger.batchRetryStatus, 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH')
    assert.ok(ledger.candidatesCompletedCount > 5, 'Untouched primaries must continue after retries disabled')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Systemic invalid stop halts replay when cumulative invalid reaches 6', async () => {
  // Return schema-invalid payload (missing required lowRiskCoverage)
  const schemaInvalidText = JSON.stringify({
    riskLevel: 'LOW_RISK',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
    // lowRiskCoverage missing!
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: schemaInvalidText }] } }],
    usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 100, thinkingTokenCount: 1000 },
  }

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(envelope),
  })

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.status, 'STOPPED')
    assert.equal(ledger.stoppedReason, 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6')
    assert.equal(ledger.systemicInvalidCount, 6)
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})
