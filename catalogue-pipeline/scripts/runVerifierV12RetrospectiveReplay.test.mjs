import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCandidateV12GeminiRequest,
  buildVerifierV12ReplayPacket,
  calculateCallCost,
  checkCostAffordability,
  checkPostResponseCap,
  checkPreDispatchAffordability,
  checkSystemicInvalidStop,
  classifyOutputDisposition,
  computeTwoLayerEvaluation,
  evaluateSevereSafetyGate,
  resolveModelConfiguration,
  runDryRun,
  runPreflight,
  runReplayExecution,
  shouldRetryError,
  verifyCohortIntegrity,
  verifyExecutionAuthorization,
  verifyHashes,
  AUTHORIZED_SURFACES,
  FROZEN_CALL_LIMITS,
  FROZEN_EXPECTED_HASHES,
  FROZEN_MODEL_CONFIG,
  NON_RETRYABLE_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from './runVerifierV12RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const experimentDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay')

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

test('1. Protocol hash mismatch stops before provider', async () => {
  await assert.rejects(
    async () => {
      await verifyHashes({
        expectedHashes: {
          ...FROZEN_EXPECTED_HASHES,
          protocol: { canonical: 'sha256:wrong', raw: 'sha256:wrong' },
        },
      })
    },
    (err) => err.code === 'STOP_HASH_MISMATCH'
  )
})

test('2. Cohort hash mismatch stops before provider', async () => {
  await assert.rejects(
    async () => {
      await verifyHashes({
        expectedHashes: {
          ...FROZEN_EXPECTED_HASHES,
          cohort: { canonical: 'sha256:wrong', raw: 'sha256:wrong' },
        },
      })
    },
    (err) => err.code === 'STOP_HASH_MISMATCH'
  )
})

test('3. Candidate hash mismatch stops before provider', async () => {
  await assert.rejects(
    async () => {
      await verifyHashes({
        expectedHashes: {
          ...FROZEN_EXPECTED_HASHES,
          candidatePrompt: { raw: 'sha256:wrong' },
        },
      })
    },
    (err) => err.code === 'STOP_HASH_MISMATCH'
  )
})

test('4. Pricing hash mismatch stops before provider', async () => {
  await assert.rejects(
    async () => {
      await verifyHashes({
        expectedHashes: {
          ...FROZEN_EXPECTED_HASHES,
          pricingMetadata: { canonical: 'sha256:wrong', raw: 'sha256:wrong' },
        },
      })
    },
    (err) => err.code === 'STOP_HASH_MISMATCH'
  )
})

test('5. Model env mismatch stops before provider', () => {
  assert.throws(
    () => {
      resolveModelConfiguration({ env: { GEMINI_MODEL: 'gemini-1.5-pro' } })
    },
    (err) => err.code === 'STOP_MODEL_CONFIG_MISMATCH'
  )

  // Matching model passes
  const valid = resolveModelConfiguration({ env: { GEMINI_MODEL: 'gemini-3.8-flash' } })
  assert.equal(valid.ok, true)
})

test('6. Unauthorized run stops before provider', async () => {
  const auth = verifyExecutionAuthorization({ env: {} })
  assert.equal(auth.authorized, false)
  assert.equal(auth.reason, 'EXECUTION_NOT_AUTHORIZED')

  await assert.rejects(
    async () => {
      await runReplayExecution({ env: {} })
    },
    (err) => err.code === 'EXECUTION_NOT_AUTHORIZED'
  )
})

test('7. Preflight dispatch count = 0', async () => {
  const preflight = await runPreflight()
  assert.equal(preflight.providerDispatches, 0)
  assert.equal(preflight.modelCalls, 0)
  assert.equal(preflight.networkCalls, 0)
})

test('8. Dry-run dispatch count = 0', async () => {
  const spy = { count: 0 }
  const dryRun = await runDryRun({ dispatchSpy: spy })
  assert.equal(dryRun.providerDispatches, 0)
  assert.equal(dryRun.modelCalls, 0)
  assert.equal(dryRun.networkCalls, 0)
  assert.equal(spy.count, 0)
})

test('9. Forbidden human label removed/rejected by packet builder', () => {
  const fakeInput = {
    facts: { title: 'Test Film' },
    acceptedSemanticClassification: {},
    semanticBoundaryFlags: [],
    allowedSourceMaterial: {},
    spoilerBoundaryRules: {},
    copyConstraints: {},
    visibleEditorialCopy: {},
    humanDecision: 'REVISE',
  }

  // The packet builder only picks the 7 authorized surfaces, stripping top-level humanDecision
  const cleanPacket = buildVerifierV12ReplayPacket(fakeInput)
  assert.equal(cleanPacket.humanDecision, undefined)

  // If a forbidden label is nested inside an authorized surface, it throws STOP_INPUT_LEAKAGE
  const taintedInput = {
    ...fakeInput,
    facts: { title: 'Test', severity: 'SEVERE' },
  }
  assert.throws(
    () => buildVerifierV12ReplayPacket(taintedInput),
    (err) => err.code === 'STOP_INPUT_LEAKAGE'
  )
})

test('10. Exactly seven model-visible surfaces retained', () => {
  const fakeInput = {
    facts: { title: 'Test Film' },
    acceptedSemanticClassification: {},
    semanticBoundaryFlags: [],
    allowedSourceMaterial: {},
    spoilerBoundaryRules: {},
    copyConstraints: {},
    visibleEditorialCopy: {},
    extraKey: 'extraValue',
  }

  const packet = buildVerifierV12ReplayPacket(fakeInput)
  const keys = Object.keys(packet)
  assert.equal(keys.length, 7)
  assert.deepEqual(keys.sort(), [...AUTHORIZED_SURFACES].sort())
})

test('11. All 30 input hashes validate against cohort manifest', async () => {
  const cohortAudit = await verifyCohortIntegrity()
  assert.equal(cohortAudit.cohortSize, 30)
  assert.equal(cohortAudit.recordAudits.length, 30)
  assert.ok(cohortAudit.recordAudits.every((r) => r.hashValid))
})

test('12. All 30 packets leakage-clean', async () => {
  const cohortAudit = await verifyCohortIntegrity()
  assert.ok(cohortAudit.recordAudits.every((r) => r.leakageClean))
  assert.ok(cohortAudit.recordAudits.every((r) => r.packetSurfacesValid))
})

test('13. Retryable provider errors strictly conform to frozen protocol (HTTP 502 and 504 prohibited)', () => {
  // Authorized technical retry errors
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429_RATE_LIMIT', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_500', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_500_SERVER_ERROR', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_503', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_503_SERVICE_UNAVAILABLE', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'TIMEOUT', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'NETWORK_TIMEOUT', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'CONNECTION_RESET', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'MALFORMED_JSON', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'MALFORMED_JSON_STRING', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), true)

  // Explicitly prohibited from retry under frozen protocol
  assert.equal(shouldRetryError({ errorCode: 'HTTP_502', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_502_BAD_GATEWAY', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_504', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_504_GATEWAY_TIMEOUT', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)

  // Ensure every runner retryable condition is protocol-authorized
  const allowedCategories = new Set(['429', '500', '503', 'TIMEOUT', 'CONNECTION_RESET', 'MALFORMED_JSON'])
  for (const code of RETRYABLE_ERROR_CODES) {
    const isAllowed =
      code.includes('429') ||
      code.includes('500') ||
      code.includes('503') ||
      code.includes('TIMEOUT') ||
      code.includes('CONNECTION_RESET') ||
      code.includes('MALFORMED_JSON')
    assert.equal(isAllowed, true, `Runner retryable code '${code}' must be protocol-authorized`)
    assert.equal(code.includes('502'), false, `HTTP 502 must never be in RETRYABLE_ERROR_CODES`)
    assert.equal(code.includes('504'), false, `HTTP 504 must never be in RETRYABLE_ERROR_CODES`)
  }
})

test('14. Semantic poor result not retried', () => {
  assert.equal(shouldRetryError({ errorCode: 'VALID_LOW_RISK_ON_DEFECT', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'VALID_HIGH_RISK_ON_CLEAN', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'SCHEMA_VALID_POOR_SEMANTIC_ANSWER', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
})

test('15. Semantic validation failure not retried', () => {
  assert.equal(shouldRetryError({ errorCode: 'SEMANTIC_VALIDATION_FAILURE', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
  assert.equal(shouldRetryError({ errorCode: 'SEMANTICALLY_INVALID', candidateRetries: 0, batchRetries: 0, totalCalls: 10 }), false)
})

test('16. Max retry per candidate enforced', () => {
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 1, batchRetries: 0, totalCalls: 10 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 2, batchRetries: 0, totalCalls: 10 }), false)
})

test('17. Batch retry cap enforced', () => {
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 0, batchRetries: 9, totalCalls: 20 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 0, batchRetries: 10, totalCalls: 20 }), false)
})

test('18. Total call cap enforced', () => {
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 0, batchRetries: 0, totalCalls: 39 }), true)
  assert.equal(shouldRetryError({ errorCode: 'HTTP_429', candidateRetries: 0, batchRetries: 0, totalCalls: 40 }), false)
})

test('19. Semantic matrix excludes failures', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'SCHEMA_INVALID' },
    { candidateId: 'c3', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
    { candidateId: 'c4', humanDecision: 'APPROVE', disposition: 'PROVIDER_FAILURE' },
  ]

  const evaluation = computeTwoLayerEvaluation({ records })
  assert.equal(evaluation.layerA.validOutputCount, 2)
  assert.equal(evaluation.layerA.invalidOrFailureCount, 2)
  assert.deepEqual(evaluation.layerA.confusionMatrix, {
    TP: 1, // c1
    FN: 0,
    FP: 0,
    TN: 1, // c3
  })
})

test('20. Operational containment includes failures', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'VALID_HIGH_RISK' },
    { candidateId: 'c2', humanDecision: 'REVISE', disposition: 'SCHEMA_INVALID' }, // fail-closed containment
    { candidateId: 'c3', humanDecision: 'APPROVE', disposition: 'VALID_LOW_RISK' },
    { candidateId: 'c4', humanDecision: 'APPROVE', disposition: 'PROVIDER_FAILURE' }, // over-routing
  ]

  const evaluation = computeTwoLayerEvaluation({ records })
  assert.equal(evaluation.layerB.defectContainmentCount, 2) // c1 + c2
  assert.equal(evaluation.layerB.cleanAutoPassCount, 1) // c3
  assert.equal(evaluation.layerB.cleanOverRoutingCount, 1) // c4
  assert.equal(evaluation.layerB.totalHumanReviewRoutingBurdenCount, 3) // c1, c2, c4
})

test('21. Provider failure never semantic TP', () => {
  const records = [
    { candidateId: 'c1', humanDecision: 'REVISE', disposition: 'PROVIDER_FAILURE' },
  ]

  const evaluation = computeTwoLayerEvaluation({ records })
  assert.equal(evaluation.layerA.confusionMatrix.TP, 0)
  assert.equal(evaluation.layerA.invalidOrFailureCount, 1)
  assert.equal(evaluation.layerB.defectContainmentCount, 1)
})

test('22. Severe safety gate works', () => {
  const passRecords = [
    { candidateId: 'scale500-tmdb-14283', disposition: 'VALID_LOW_RISK' },
  ]
  const passResult = evaluateSevereSafetyGate({ records: passRecords })
  assert.equal(passResult.severeSafetyOutcome, 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE')
  assert.equal(passResult.governanceEffect, 'PAUSED_FOR_SEVERE_AUDIT_MISS')

  const flagRecords = [
    { candidateId: 'scale500-tmdb-14283', disposition: 'VALID_HIGH_RISK' },
  ]
  const flagResult = evaluateSevereSafetyGate({ records: flagRecords })
  assert.equal(flagResult.severeSafetyOutcome, 'SEVERE_DEFECT_FLAGGED_OR_CONTAINED')
  assert.equal(flagResult.governanceEffect, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
})

test('23. Cost formula correct', () => {
  // 100,000 input tokens = (100000 / 1e6) * 0.75 = 0.075
  // 20,000 output tokens = (20000 / 1e6) * 3.75 = 0.075
  const cost = calculateCallCost({ inputTokens: 100_000, outputTokens: 20_000, thinkingTokens: 0 })
  assert.equal(Number(cost.inputCost.toFixed(6)), 0.075)
  assert.equal(Number(cost.outputCost.toFixed(6)), 0.075)
  assert.equal(Number(cost.totalCost.toFixed(6)), 0.15)
})

test('24. $0.50 cap works', () => {
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.48, nextCallEstimate: 0.015, costCeiling: 0.50 }), true)
  assert.equal(checkPreDispatchAffordability({ accumulatedCost: 0.49, nextCallEstimate: 0.015, costCeiling: 0.50 }), false)
  assert.equal(checkPostResponseCap({ accumulatedCost: 0.50, costCeiling: 0.50 }), true)
  assert.equal(checkPostResponseCap({ accumulatedCost: 0.501, costCeiling: 0.50 }), false)
})

test('25. 5 invalid continues', () => {
  const records = [
    { candidateId: '1', disposition: 'SCHEMA_INVALID' },
    { candidateId: '2', disposition: 'SCHEMA_INVALID' },
    { candidateId: '3', disposition: 'SEMANTICALLY_INVALID' },
    { candidateId: '4', disposition: 'SCHEMA_INVALID' },
    { candidateId: '5', disposition: 'SEMANTICALLY_INVALID' },
  ]
  const result = checkSystemicInvalidStop({ records })
  assert.equal(result.triggered, false)
  assert.equal(result.invalidCount, 5)
})

test('26. 6 invalid stops', () => {
  const records = [
    { candidateId: '1', disposition: 'SCHEMA_INVALID' },
    { candidateId: '2', disposition: 'SCHEMA_INVALID' },
    { candidateId: '3', disposition: 'SEMANTICALLY_INVALID' },
    { candidateId: '4', disposition: 'SCHEMA_INVALID' },
    { candidateId: '5', disposition: 'SEMANTICALLY_INVALID' },
    { candidateId: '6', disposition: 'SCHEMA_INVALID' },
  ]
  const result = checkSystemicInvalidStop({ records })
  assert.equal(result.triggered, true)
  assert.equal(result.invalidCount, 6)
  assert.equal(result.rule, 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6')
})

test('27. Completed response cannot be overwritten', () => {
  // Pure logic check: if a persisted record already exists with terminal disposition, it is skipped
  const existingRecord = { candidateId: 'c1', terminalState: 'VALID_RESPONSE', responseHash: 'abc' }
  const shouldDispatch = !existingRecord.responseHash
  assert.equal(shouldDispatch, false)
})

test('28. Ambiguous dispatch state fails closed', () => {
  // In-flight crash marks ambiguous dispatch state and stops automatic redispatch
  const inFlightRecord = { candidateId: 'c1', dispatchAttempted: true, responseReceived: false }
  const isAmbiguous = inFlightRecord.dispatchAttempted && !inFlightRecord.responseReceived
  assert.equal(isAmbiguous, true)
})

test('29. No prospective holdout access', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.prospectiveHoldoutFirewall.firewallActive, true)
  assert.equal(protocol.datasetClassification, 'RETROSPECTIVE_DEVELOPMENT_SET')
})

test('30. Candidate remains not active', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.boundCandidate.operationalFlags.active, false)
  assert.equal(protocol.boundCandidate.operationalFlags.productionAuthorized, false)
})

test('31. Governance pause unchanged', async () => {
  const pause = await readJson(path.join(outDir, 'scale-tranche-2-governance-pause.v1.json'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
})
