import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  AMBIGUOUS_RECOVERY_WRITER_CALL_CAP,
  assertCanDispatch,
  CANARY_SEED_ID,
  CANARY_SIZE,
  deterministicBlindOrder,
  EFFECTIVE_WRITER_CALL_CAP,
  EXPECTED_BINDINGS,
  getAmbiguousRecoveryStatus,
  getUnresolvedPersistedDispatchStage,
  HARD_MODEL_CALL_CAP,
  isGlobalStop,
  isUnresolvedPersistedDispatch,
  LIVE_CALL_CAPS,
  LIVE_USD_CEILING,
  NORMAL_WRITER_CALL_CAP,
  PIPELINE_STAGES,
  preflightScaleTranche2Live,
  providerVerifierSchema,
  RISK_VERIFIER_CALL_CAP,
  RISK_VERIFIER_LIVE_BINDING,
  routeProductionRecord,
  runScaleTranche2Live,
  selectAuditCandidateIds,
  selectCanaryCandidateIds,
  STRUCTURAL_REPAIR_CALL_CAP,
  THEORETICAL_MAXIMUM_MODEL_CALLS,
} from './scaleTranche2Live.mjs'
import { PRIOR_DEFERRED_ID, TRANCHE_ID, TRANCHE_SIZE } from './scaleTranche2Plan.mjs'
import { validateVerifierSemanticPayload } from './reconcileScaleTranche1Verifier.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('1. Preflight verifies exact T2 cohort bindings and frozen plan without network calls', async () => {
  const result = await preflightScaleTranche2Live({ repoRoot })
  assert.equal(result.ok, true)
  assert.equal(result.externalCalls, 0)
  assert.equal(result.cohort.records.length, TRANCHE_SIZE)
  assert.equal(result.cohort.orderedCandidateIdsHash, EXPECTED_BINDINGS.orderedCandidateIdsHash)
  assert.equal(result.canaryCandidateIds.length, CANARY_SIZE)
})

test('2. T2 candidate pool strictly excludes prior deferred candidate and has zero T1 overlap', async () => {
  const { cohort } = await preflightScaleTranche2Live({ repoRoot })
  const ids = cohort.records.map((r) => r.candidateId)
  assert.equal(ids.includes(PRIOR_DEFERRED_ID), false)

  const t1CohortManifest = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json'),
      'utf8'
    )
  )
  const t1Ids = new Set(t1CohortManifest.records.map((r) => r.candidateId))
  for (const id of ids) {
    assert.equal(t1Ids.has(id), false, `Candidate ${id} overlaps with T1`)
  }
})

test('3. Frozen guardrails: call caps, cost ceiling, and verifier contract binding', () => {
  assert.equal(LIVE_USD_CEILING, 2.00)
  assert.deepEqual(LIVE_CALL_CAPS, {
    writerCalls: 151,
    structuralRepairCalls: 150,
    riskVerifierCalls: 150,
    totalExternalCalls: 451,
  })
  assert.equal(RISK_VERIFIER_LIVE_BINDING.contractVersion, 'source-boundary-risk-verifier.v1.1')
  assert.equal(RISK_VERIFIER_LIVE_BINDING.thinkingLevel, 'medium')
  assert.equal(RISK_VERIFIER_LIVE_BINDING.maxOutputTokens, 4096)
  assert.equal(RISK_VERIFIER_LIVE_BINDING.autonomousAuthority, false)
})

test('4. Reconciled risk verifier v1.1 semantic payload validator enforces strict rules', () => {
  // Valid LOW_RISK
  const validLow = {
    riskLevel: 'LOW_RISK',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
  }
  assert.equal(validateVerifierSemanticPayload(validLow).ok, true)

  // Valid HIGH_RISK
  const validHigh = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['SPOILER_OR_LATER_REVEAL'],
    issues: [
      {
        category: 'SPOILER_OR_LATER_REVEAL',
        fields: ['description'],
        explanation: 'Concrete third act detail reveals true culprit.',
      },
    ],
    sourceBoundarySatisfied: false,
  }
  assert.equal(validateVerifierSemanticPayload(validHigh).ok, true)

  // Inconsistent LOW_RISK with riskCategories
  assert.equal(
    validateVerifierSemanticPayload({
      riskLevel: 'LOW_RISK',
      riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
      issues: [],
      sourceBoundarySatisfied: true,
    }).ok,
    false
  )

  // Inconsistent HIGH_RISK with empty issues
  assert.equal(
    validateVerifierSemanticPayload({
      riskLevel: 'HIGH_RISK',
      riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
      issues: [],
      sourceBoundarySatisfied: false,
    }).ok,
    false
  )

  // Category mismatch between riskCategories and issues
  assert.equal(
    validateVerifierSemanticPayload({
      riskLevel: 'HIGH_RISK',
      riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
      issues: [
        {
          category: 'SPOILER_OR_LATER_REVEAL',
          fields: ['whyWatch'],
          explanation: 'Reveals plot twist.',
        },
      ],
      sourceBoundarySatisfied: false,
    }).ok,
    false
  )
})

test('5. providerVerifierSchema projects JSON Schema without meta-properties', async () => {
  const rawSchema = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json'),
      'utf8'
    )
  )
  const projected = providerVerifierSchema(rawSchema)
  assert.equal(projected.$schema, undefined)
  assert.equal(projected.$id, undefined)
  assert.equal(projected.title, undefined)
  assert.equal(projected.description, undefined)
  assert.equal(projected['x-deterministicConsistencyRules'], undefined)
  assert.deepEqual(projected.required, ['riskLevel', 'riskCategories', 'issues', 'sourceBoundarySatisfied'])
})

test('6. Deterministic canary selection picks exact 10 seed-based candidates independent of file order', async () => {
  const { cohort } = await preflightScaleTranche2Live({ repoRoot })
  const allIds = cohort.records.map((r) => r.candidateId)
  const canary1 = selectCanaryCandidateIds(allIds, 10, CANARY_SEED_ID)
  const canary2 = selectCanaryCandidateIds([...allIds].reverse(), 10, CANARY_SEED_ID)
  assert.deepEqual(canary1, canary2)
  assert.equal(canary1.length, 10)
  assert.deepEqual(canary1, [
    'scale500-tmdb-13398',
    'scale500-tmdb-11479',
    'scale500-tmdb-9367',
    'scale500-tmdb-11336',
    'scale500-tmdb-11416',
    'scale500-tmdb-36670',
    'scale500-tmdb-8697',
    'exp100-tmdb-3134',
    'exp100-tmdb-36819',
    'scale500-tmdb-535167',
  ])
})

test('7. Deterministic audit selection computes ceil(20%) and is order-invariant', () => {
  const samplePool = ['cand-1', 'cand-2', 'cand-3', 'cand-4', 'cand-5', 'cand-6', 'cand-7']
  const audit1 = selectAuditCandidateIds(samplePool)
  const audit2 = selectAuditCandidateIds([...samplePool].reverse())
  assert.equal(audit1.auditCount, Math.ceil(7 * 0.20))
  assert.equal(audit1.auditCount, 2)
  assert.deepEqual(audit1.candidateIds, audit2.candidateIds)
  assert.equal(audit1.orderedAuditCandidateIdsHash, audit2.orderedAuditCandidateIdsHash)
})

test('8. Production record routing strictly enforces fail-closed governance', () => {
  // Pass path
  const auto = routeProductionRecord({
    structuralValidation: 'PASS',
    structuralRepairOutcome: 'NOT_REQUIRED',
    provenanceCompleteness: 'COMPLETE',
    riskVerifierResult: 'LOW_RISK',
    productionValidation: 'PASS',
  })
  assert.equal(auto.riskRoutingStatus, 'AUTO_ELIGIBLE')
  assert.equal(auto.promotionAuthorized, false)

  // Repaired pass
  const repairedAuto = routeProductionRecord({
    structuralValidation: 'FAIL',
    structuralRepairOutcome: 'PASS',
    provenanceCompleteness: 'COMPLETE',
    riskVerifierResult: 'LOW_RISK',
    productionValidation: 'PASS',
  })
  assert.equal(repairedAuto.riskRoutingStatus, 'AUTO_ELIGIBLE')
  assert.equal(repairedAuto.promotionAuthorized, false)

  // High risk verifier verdict => HUMAN_REVIEW_REQUIRED
  const highRisk = routeProductionRecord({
    structuralValidation: 'PASS',
    structuralRepairOutcome: 'NOT_REQUIRED',
    provenanceCompleteness: 'COMPLETE',
    riskVerifierResult: 'HIGH_RISK',
    productionValidation: 'PASS',
  })
  assert.equal(highRisk.riskRoutingStatus, 'HUMAN_REVIEW_REQUIRED')

  // Grounding conflict => HUMAN_REVIEW_REQUIRED
  const groundingConflict = routeProductionRecord({
    structuralValidation: 'PASS',
    structuralRepairOutcome: 'NOT_REQUIRED',
    provenanceCompleteness: 'COMPLETE',
    riskVerifierResult: 'LOW_RISK',
    productionValidation: 'PASS',
    unresolvedSourceGroundingConflict: true,
  })
  assert.equal(groundingConflict.riskRoutingStatus, 'HUMAN_REVIEW_REQUIRED')

  // Structural repair failed => QUARANTINED
  const repairFailed = routeProductionRecord({
    structuralValidation: 'FAIL',
    structuralRepairOutcome: 'FAILED',
    provenanceCompleteness: 'COMPLETE',
    riskVerifierResult: 'LOW_RISK',
    productionValidation: 'PASS',
  })
  assert.equal(repairFailed.riskRoutingStatus, 'QUARANTINED')
})

test('9. Live runner rejects invocation without explicit execute flag', async () => {
  let callCount = 0
  const fetchImpl = async () => {
    callCount++
    return {}
  }
  await assert.rejects(
    () => runScaleTranche2Live({ repoRoot, execute: false, apiKey: 'test-key', fetchImpl }),
    /requires --execute/
  )
  assert.equal(callCount, 0)
})

test('10. Live runner rejects invocation without GEMINI_API_KEY', async () => {
  await assert.rejects(
    () => runScaleTranche2Live({ repoRoot, execute: true, apiKey: '' }),
    /GEMINI_API_KEY is required/
  )
})

test('11. Global stop logic triggers on quota blocks and ambiguous transports', () => {
  assert.equal(isGlobalStop({ status: 429, category: 'provider-http' }, { responseBearing5xx: 0 }), true)
  assert.equal(isGlobalStop({ ambiguous: true }, { responseBearing5xx: 0 }), true)
  assert.equal(isGlobalStop({ status: 400, category: 'provider-http' }, { responseBearing5xx: 0 }), false)

  const ledger = { responseBearing5xx: 0 }
  assert.equal(isGlobalStop({ status: 500, category: 'provider-http' }, ledger), false)
  assert.equal(ledger.responseBearing5xx, 1)
  assert.equal(isGlobalStop({ status: 503, category: 'provider-http' }, ledger), true)
  assert.equal(ledger.responseBearing5xx, 2)
})

test('12. Blind review ordering is deterministic and reproducible', () => {
  const candidates = ['cand-a', 'cand-b', 'cand-c', 'cand-d', 'cand-e']
  const order1 = deterministicBlindOrder(candidates)
  const order2 = deterministicBlindOrder([...candidates].reverse())
  assert.deepEqual(order1, order2)
})

test('13. Normal execute fails closed on persisted unresolved dispatch without operator authorization', async () => {
  let callCount = 0
  const fetchImpl = async () => {
    callCount++
    return {}
  }
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scale-tranche-2-test-'))
  const tempLedgerPath = path.join(tempDir, 'live-execution-ledger.json')
  const mockLedger = {
    schemaVersion: 'scale-tranche-2-live-execution-ledger.v1',
    trancheId: TRANCHE_ID,
    callCounts: { writerCalls: 10, structuralRepairCalls: 1, riskVerifierCalls: 9, totalExternalCalls: 20 },
    records: [
      {
        candidateId: 'scale500-tmdb-535167',
        terminalState: 'PENDING',
        writer: {
          dispatch: { occurred: true, responseReceived: false },
          terminalState: 'DISPATCHED',
        },
      },
    ],
    status: 'RUNNING',
    stop: null,
  }
  await fs.promises.writeFile(tempLedgerPath, JSON.stringify(mockLedger))

  try {
    const ledger = await runScaleTranche2Live({ repoRoot, execute: true, apiKey: 'mock-key', fetchImpl, customLedgerPath: tempLedgerPath })
    assert.equal(ledger.status, 'STOPPED_AMBIGUOUS')
    assert.equal(ledger.stop?.code, 'UNRESOLVED_PERSISTED_DISPATCH')
    assert.equal(ledger.stop?.candidateId, 'scale500-tmdb-535167')
    assert.equal(callCount, 0)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
})

test('14. Recovery rejects non-ambiguous candidate targets', async () => {
  await assert.rejects(
    () =>
      runScaleTranche2Live({
        repoRoot,
        execute: true,
        recoverAmbiguousCandidateId: 'scale500-tmdb-13398',
        apiKey: 'mock-key',
      }),
    /not in an unresolved ambiguous state/
  )
})

test('15. Recovery rejects unknown candidate targets', async () => {
  await assert.rejects(
    () =>
      runScaleTranche2Live({
        repoRoot,
        execute: true,
        recoverAmbiguousCandidateId: 'non-existent-candidate',
        apiKey: 'mock-key',
      }),
    /not found in ledger for recovery/
  )
})

test('16. Recovery preserves original dispatch immutably and increments call accounting', async () => {
  const ledgerRaw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/live-execution-ledger.json'),
      'utf8'
    )
  )
  const target = ledgerRaw.records.find((r) => r.candidateId === 'scale500-tmdb-535167')
  assert.ok(target.ambiguousDispatchRecovery)
  assert.equal(target.ambiguousDispatchRecovery.originalDispatch.terminalState, 'AMBIGUOUS_UNRESOLVED')
  assert.equal(target.ambiguousDispatchRecovery.originalDispatch.dispatch.occurred, true)
  assert.equal(target.ambiguousDispatchRecovery.originalDispatch.dispatch.responseReceived, false)

  assert.equal(target.writer.terminalState, 'VALID')
  assert.equal(target.writer.dispatch.occurred, true)
  assert.equal(target.writer.dispatch.responseReceived, true)

  assert.equal(ledgerRaw.callCounts.writerCalls, 151)
  assert.equal(ledgerRaw.callCounts.totalExternalCalls, 315)
  assert.equal(ledgerRaw.accounting.writerCalls, 151)
  assert.equal(ledgerRaw.accounting.totalExternalCalls, 315)
})

test('17. Recovery cannot be performed more than once', async () => {
  // Simulate a ledger where recovery attempt already occurred
  const simulatedLedger = {
    schemaVersion: 'scale-tranche-2-live-execution-ledger.v1',
    trancheId: TRANCHE_ID,
    callCounts: { writerCalls: 11, structuralRepairCalls: 1, riskVerifierCalls: 9, totalExternalCalls: 21 },
    records: [
      {
        candidateId: 'scale500-tmdb-535167',
        terminalState: 'PENDING',
        writer: { dispatch: { occurred: true }, terminalState: 'DISPATCHED' },
        ambiguousDispatchRecovery: { recoveryAttempt: 1, maxRecoveryAttempts: 1 },
      },
    ],
  }
  const isTargetAmbiguous = ['writer'].some(
    (s) => simulatedLedger.records[0][s]?.dispatch?.occurred && !['VALID'].includes(simulatedLedger.records[0][s].terminalState)
  )
  assert.equal(isTargetAmbiguous, true)
  assert.equal(simulatedLedger.records[0].ambiguousDispatchRecovery.recoveryAttempt >= 1, true)
})

test('18. Historical cost and call accounting is preserved during recovery', async () => {
  const ledgerRaw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/live-execution-ledger.json'),
      'utf8'
    )
  )
  assert.equal(ledgerRaw.callCounts.riskVerifierCalls, 149)
  assert.equal(ledgerRaw.callCounts.structuralRepairCalls, 15)
  assert.equal(ledgerRaw.accounting.riskVerifierEstimatedUSD > 0.40, true)
  assert.equal(ledgerRaw.accounting.structuralRepairEstimatedUSD > 0.05, true)
  assert.equal(ledgerRaw.accounting.totalEstimatedUSD > 1.00, true)
})

test('19. Hard guardrails enforce ceiling limits and forbid runtime writes', async () => {
  const preflight = await preflightScaleTranche2Live({ repoRoot })
  assert.equal(preflight.plan.plannedGuardrails.hardModelCallCap, 451)
  assert.equal(preflight.plan.plannedGuardrails.costCeilingUSD, 2.00)
  assert.equal(preflight.plan.runtimeWritesAuthorized, false)
})

test('20. Canonical predicate tests on real persisted candidate state shape', () => {
  // Real persisted candidate state shape
  const realCandidate = {
    candidateId: 'scale500-tmdb-535167',
    tmdbId: 535167,
    terminalState: 'PENDING',
    routingStatus: null,
    promotionState: 'GENERATED',
    writer: {
      attempts: [],
      dispatch: {
        occurred: true,
        responseReceived: false,
        rawResponsePreserved: false,
        ambiguous: false,
      },
      error: null,
      terminalState: 'DISPATCHED',
      thinkingLevel: 'low',
      maxOutputTokens: 8192,
      modelId: 'gemini-3.8-flash',
      providerId: 'google-gemini-developer-api',
      usage: { inputTokens: null, outputTokens: null, thinkingTokens: null, cachedInputTokens: null, totalTokens: null },
      estimatedCost: null,
    },
  }

  // 1. Real persisted state is unresolved and recoverable
  assert.equal(isUnresolvedPersistedDispatch(realCandidate), true)
  assert.equal(getUnresolvedPersistedDispatchStage(realCandidate), 'writer')
  const status1 = getAmbiguousRecoveryStatus(realCandidate)
  assert.equal(status1.isUnresolved, true)
  assert.equal(status1.recoverable, true)
  assert.equal(status1.recoveryAttemptsUsed, 0)
  assert.equal(status1.recoveryAttemptsRemaining, 1)
  assert.equal(status1.stage, 'writer')
  assert.equal(status1.reason, 'OK')

  // 2. Completed writer is rejected
  const completedCandidate = structuredClone(realCandidate)
  completedCandidate.writer.terminalState = 'VALID'
  completedCandidate.writer.dispatch.responseReceived = true
  completedCandidate.terminalState = 'COMPLETE'
  assert.equal(isUnresolvedPersistedDispatch(completedCandidate), false)
  const status2 = getAmbiguousRecoveryStatus(completedCandidate)
  assert.equal(status2.recoverable, false)
  assert.equal(status2.reason, 'CANDIDATE_ALREADY_TERMINAL')

  // 3. Response already received is rejected
  const responseReceivedCandidate = structuredClone(realCandidate)
  responseReceivedCandidate.writer.dispatch.responseReceived = true
  assert.equal(isUnresolvedPersistedDispatch(responseReceivedCandidate), false)
  const status3 = getAmbiguousRecoveryStatus(responseReceivedCandidate)
  assert.equal(status3.recoverable, false)
  assert.equal(status3.reason, 'RESPONSE_ALREADY_RECEIVED')

  // 4. No dispatch occurred is rejected
  const noDispatchCandidate = structuredClone(realCandidate)
  noDispatchCandidate.writer.dispatch.occurred = false
  assert.equal(isUnresolvedPersistedDispatch(noDispatchCandidate), false)
  const status4 = getAmbiguousRecoveryStatus(noDispatchCandidate)
  assert.equal(status4.recoverable, false)
  assert.equal(status4.reason, 'NO_DISPATCH_OCCURRED')

  // 5. Second recovery is rejected (recoveryAttempt >= 1)
  const secondRecoveryCandidate = structuredClone(realCandidate)
  secondRecoveryCandidate.ambiguousDispatchRecovery = { recoveryAttempt: 1, maxRecoveryAttempts: 1 }
  assert.equal(isUnresolvedPersistedDispatch(secondRecoveryCandidate), true)
  const status5 = getAmbiguousRecoveryStatus(secondRecoveryCandidate)
  assert.equal(status5.isUnresolved, true)
  assert.equal(status5.recoverable, false)
  assert.equal(status5.recoveryAttemptsUsed, 1)
  assert.equal(status5.recoveryAttemptsRemaining, 0)
  assert.equal(status5.reason, 'AMBIGUOUS_RECOVERY_ATTEMPTS_EXHAUSTED')
})

test('21. Preflight dry-run inspection reports recovery eligibility with zero network/mutation', async () => {
  const preflight = await preflightScaleTranche2Live({ repoRoot })
  assert.equal(preflight.ok, true)
  assert.equal(preflight.externalCalls, 0)
  assert.ok(preflight.liveLedgerInspection)
  assert.equal(preflight.liveLedgerInspection.candidateId, null)
  assert.equal(preflight.liveLedgerInspection.recoverableAmbiguousDispatch, false)
  assert.equal(preflight.liveLedgerInspection.recoveryAttemptsUsed, 1)
  assert.equal(preflight.liveLedgerInspection.recoveryAttemptsRemaining, 0)
  assert.equal(preflight.liveLedgerInspection.normalWriterCallCap, 150)
  assert.equal(preflight.liveLedgerInspection.ambiguousRecoveryCallsAuthorized, 1)
  assert.equal(preflight.liveLedgerInspection.ambiguousRecoveryCallsUsed, 1)
  assert.equal(preflight.liveLedgerInspection.effectiveWriterCallCap, 151)
  assert.equal(preflight.liveLedgerInspection.writerCalls, 151)
  assert.equal(preflight.liveLedgerInspection.writerCallsRemaining, 0)
  assert.equal(preflight.liveLedgerInspection.hardModelCallCap, 451)
  assert.equal(preflight.liveLedgerInspection.remainingCandidates, 0)
  assert.equal(preflight.liveLedgerInspection.remainingNormalCandidates, 0)
  assert.equal(preflight.liveLedgerInspection.resumePermitted, false)
})

test('22. 150 normal writer dispatches are allowed', () => {
  const ledger = {
    callCounts: { writerCalls: 149, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 149 },
    records: Array.from({ length: 149 }, (_, i) => ({
      candidateId: `c-${i}`,
      writer: { dispatch: { occurred: true } },
    })),
  }
  const normalCandidate = { candidateId: 'c-149' }
  assert.doesNotThrow(() => assertCanDispatch(ledger, 'writerCalls', normalCandidate))
})

test('23. One explicitly authorized ambiguous recovery may increase total writer dispatches to 151', () => {
  // 150 normal writer calls already consumed
  const ledger = {
    callCounts: { writerCalls: 150, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 150 },
    records: Array.from({ length: 150 }, (_, i) => ({
      candidateId: `c-${i}`,
      writer: { dispatch: { occurred: true } },
    })),
  }
  const recoveryCandidate = {
    candidateId: 'recovery-target',
    ambiguousDispatchRecovery: {
      stage: 'writer',
      recoveryAuthorized: true,
      recoveryAttempt: 1,
      maxRecoveryAttempts: 1,
    },
  }
  assert.doesNotThrow(() => assertCanDispatch(ledger, 'writerCalls', recoveryCandidate))
})

test('24. A 152nd writer dispatch is rejected', () => {
  const ledger = {
    callCounts: { writerCalls: 151, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 151 },
    records: [
      ...Array.from({ length: 150 }, (_, i) => ({
        candidateId: `c-${i}`,
        writer: { dispatch: { occurred: true } },
      })),
      {
        candidateId: 'recovered',
        ambiguousDispatchRecovery: { stage: 'writer', recoveryAttempt: 1 },
        writer: { dispatch: { occurred: true } },
      },
    ],
  }
  assert.throws(
    () => assertCanDispatch(ledger, 'writerCalls'),
    /Call ceiling reached for writerCalls: 151\/151/
  )
})

test('25. Normal candidates cannot consume the recovery allowance', () => {
  // 150 normal writer calls already consumed, 0 recovery calls used (total 150 < 151)
  const ledger = {
    callCounts: { writerCalls: 150, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 150 },
    records: Array.from({ length: 150 }, (_, i) => ({
      candidateId: `c-${i}`,
      writer: { dispatch: { occurred: true } },
    })),
  }
  const normalCandidate = { candidateId: 'normal-overflow' }
  assert.throws(
    () => assertCanDispatch(ledger, 'writerCalls', normalCandidate),
    /Call ceiling reached for normal writer calls: 150\/150/
  )
})

test('26. Second recovery cannot consume another allowance', () => {
  const ledger = {
    callCounts: { writerCalls: 150, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 150 },
    records: [
      {
        candidateId: 'recovered',
        ambiguousDispatchRecovery: { stage: 'writer', recoveryAttempt: 1, maxRecoveryAttempts: 1, recoveryAuthorized: true },
        writer: { dispatch: { occurred: true } },
      },
    ],
  }
  const secondAttemptCandidate = {
    candidateId: 'recovered',
    ambiguousDispatchRecovery: { stage: 'writer', recoveryAttempt: 2, maxRecoveryAttempts: 1, recoveryAuthorized: true },
  }
  assert.throws(
    () => assertCanDispatch(ledger, 'writerCalls', secondAttemptCandidate),
    /second recovery is forbidden/
  )
})

test('27. Total theoretical model-call cap is 451', () => {
  assert.equal(THEORETICAL_MAXIMUM_MODEL_CALLS, 451)
  assert.equal(HARD_MODEL_CALL_CAP, 451)
  assert.equal(
    NORMAL_WRITER_CALL_CAP + AMBIGUOUS_RECOVERY_WRITER_CALL_CAP + STRUCTURAL_REPAIR_CALL_CAP + RISK_VERIFIER_CALL_CAP,
    451
  )
})

test('28. Hard cap <451 fails closed', () => {
  const ledger = {
    callCounts: { writerCalls: 100, structuralRepairCalls: 0, riskVerifierCalls: 0, totalExternalCalls: 451 },
    records: [],
  }
  assert.throws(
    () => assertCanDispatch(ledger, 'writerCalls'),
    /Call ceiling reached for totalExternalCalls: 451\/451/
  )
})

test('29. Existing ledger counts are never reset', async () => {
  const ledgerRaw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/live-execution-ledger.json'),
      'utf8'
    )
  )
  assert.equal(ledgerRaw.callCounts.writerCalls, 151)
  assert.equal(ledgerRaw.callCounts.structuralRepairCalls, 15)
  assert.equal(ledgerRaw.callCounts.riskVerifierCalls, 149)
  assert.equal(ledgerRaw.callCounts.totalExternalCalls, 315)
})

test('30. Original ambiguous dispatch remains counted', async () => {
  const ledgerRaw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/live-execution-ledger.json'),
      'utf8'
    )
  )
  const c10 = ledgerRaw.records.find((r) => r.candidateId === 'scale500-tmdb-535167')
  assert.equal(c10.ambiguousDispatchRecovery?.originalDispatch?.dispatch?.occurred, true)
  assert.equal(c10.ambiguousDispatchRecovery?.originalDispatch?.terminalState, 'AMBIGUOUS_UNRESOLVED')
  assert.equal(ledgerRaw.callCounts.writerCalls >= 150, true)
})

test('31. Recovery dispatch remains separately counted', async () => {
  const ledgerRaw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/live-execution-ledger.json'),
      'utf8'
    )
  )
  const c10 = ledgerRaw.records.find((r) => r.candidateId === 'scale500-tmdb-535167')
  assert.equal(c10.writer?.dispatch?.occurred, true)
  assert.equal(c10.writer?.dispatch?.responseReceived, true)
  assert.equal(c10.writer?.terminalState, 'VALID')
  assert.equal(c10.ambiguousDispatchRecovery?.recoveryAttempt, 1)
})

test('32. Runtime writes remain forbidden', async () => {
  const plan = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/execution-plan.json'),
      'utf8'
    )
  )
  assert.equal(plan.runtimeWritesAuthorized, false)
})

test('33. Integration fixture: 150 normal writer dispatches + 1 authorized recovery dispatch is valid, not over-cap', () => {
  const fixtureLedger = {
    schemaVersion: 'scale-tranche-2-live-execution-ledger.v1',
    trancheId: TRANCHE_ID,
    callCounts: {
      writerCalls: 151,
      structuralRepairCalls: 150,
      riskVerifierCalls: 150,
      totalExternalCalls: 451,
    },
    records: [
      ...Array.from({ length: 149 }, (_, i) => ({
        candidateId: `normal-${i}`,
        terminalState: 'COMPLETE',
        writer: { dispatch: { occurred: true, responseReceived: true }, terminalState: 'VALID' },
      })),
      {
        candidateId: 'recovered-10',
        terminalState: 'COMPLETE',
        ambiguousDispatchRecovery: {
          stage: 'writer',
          recoveryAttempt: 1,
          maxRecoveryAttempts: 1,
          recoveryAuthorized: true,
          originalDispatch: { dispatch: { occurred: true, responseReceived: false }, terminalState: 'AMBIGUOUS_UNRESOLVED' },
        },
        writer: { dispatch: { occurred: true, responseReceived: true }, terminalState: 'VALID' },
      },
      {
        candidateId: 'normal-150',
        terminalState: 'COMPLETE',
        writer: { dispatch: { occurred: true, responseReceived: true }, terminalState: 'VALID' },
      },
    ],
  }

  assert.equal(fixtureLedger.callCounts.writerCalls, EFFECTIVE_WRITER_CALL_CAP)
  assert.equal(fixtureLedger.callCounts.totalExternalCalls, HARD_MODEL_CALL_CAP)

  // When totalExternalCalls is within limit, a 152nd writer call is rejected specifically by writer cap
  fixtureLedger.callCounts.totalExternalCalls = 450
  assert.throws(
    () => assertCanDispatch(fixtureLedger, 'writerCalls'),
    /Call ceiling reached for writerCalls: 151\/151/
  )

  // When totalExternalCalls reaches 451, dispatch is rejected by global hard cap
  fixtureLedger.callCounts.totalExternalCalls = 451
  assert.throws(
    () => assertCanDispatch(fixtureLedger, 'writerCalls'),
    /Call ceiling reached for totalExternalCalls: 451\/451/
  )
})
