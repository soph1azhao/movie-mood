import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildScaleTranche2Artifacts,
  COHORT_SEED_ID,
  outputRoot,
  PRIOR_DEFERRED_ID,
  TRANCHE_ID,
  TRANCHE_SIZE,
} from './scaleTranche2Plan.mjs'
import { hashArtifact } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('1. Exact 400/100/99/1/300/301 candidate accounting', async () => {
  const { accounting } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const s = accounting.accountingSummary
  assert.equal(s.semanticTotal, 400)
  assert.equal(s.t1CohortTotal, 100)
  assert.equal(s.productionComplete, 99)
  assert.equal(s.deferredFromPriorTranche, 1)
  assert.equal(s.normalRemainingPool, 300)
  assert.equal(s.pilotCount, 16)
  assert.equal(s.freshCount, 284)
  assert.equal(s.totalUnresolved, 301)
  assert.equal(accounting.invariantsSatisfied, true)
})

test('2. pilot16 + fresh284 = normal remaining300', async () => {
  const { accounting } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  assert.equal(accounting.accountingSummary.pilotCount + accounting.accountingSummary.freshCount, 300)
  assert.equal(accounting.accountingSummary.normalRemainingPool, 300)
})

test('3. Deferred candidate is strictly excluded from T2 cohort', async () => {
  const { cohortManifest, executionPlan } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const selected = cohortManifest.records.map((r) => r.candidateId)
  assert.equal(selected.includes(PRIOR_DEFERRED_ID), false)
  assert.equal(executionPlan.cohort.candidateIds.includes(PRIOR_DEFERRED_ID), false)
  assert.deepEqual(cohortManifest.excludedPriorDeferredIds, [PRIOR_DEFERRED_ID])
})

test('4. Deterministic T2 selection across repeated runs', async () => {
  const run1 = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const run2 = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  assert.deepEqual(run1.cohortManifest.records, run2.cohortManifest.records)
  assert.equal(run1.hashes.cohortManifestHash, run2.hashes.cohortManifestHash)
  assert.equal(run1.hashes.executionPlanHash, run2.hashes.executionPlanHash)
})

test('5. Independence from input candidate enumeration order', async () => {
  const { cohortManifest } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const selectedOriginal = cohortManifest.records.map((r) => r.candidateId)

  // Reverse pool order and test selectCohortCandidateIds directly
  const s400Manifest = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json'), 'utf8'))
  const t1Cohort = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json'), 'utf8'))
  const t1Set = new Set(t1Cohort.records.map((r) => r.candidateId))
  const pool = Object.keys(s400Manifest.states).filter((id) => !t1Set.has(id))

  const { selectCohortCandidateIds } = await import('./scalePipeline.mjs')
  const selectedReversed = selectCohortCandidateIds({
    candidatePool: pool.slice().reverse(),
    trancheSize: TRANCHE_SIZE,
    cohortSeed: COHORT_SEED_ID,
  })

  assert.deepEqual(selectedOriginal, selectedReversed)
})

test('6. T2 contains exactly 150 unique candidate IDs and 150 unique TMDB IDs', async () => {
  const { cohortManifest } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  assert.equal(cohortManifest.records.length, 150)
  const candidateIds = cohortManifest.records.map((r) => r.candidateId)
  const tmdbIds = cohortManifest.records.map((r) => r.tmdbId)

  assert.equal(new Set(candidateIds).size, 150)
  assert.equal(new Set(tmdbIds).size, 150)
})

test('7. T2 does not overlap T1', async () => {
  const { cohortManifest } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const t1Cohort = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json'), 'utf8'))
  const t1Set = new Set(t1Cohort.records.map((r) => r.candidateId))

  for (const record of cohortManifest.records) {
    assert.equal(t1Set.has(record.candidateId), false, `Candidate ${record.candidateId} overlaps with T1`)
  }
})

test('8. T2 is a strict subset of Semantic-400', async () => {
  const { cohortManifest } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const s400Manifest = JSON.parse(await readFile(path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json'), 'utf8'))
  const s400Set = new Set(Object.keys(s400Manifest.states))

  for (const record of cohortManifest.records) {
    assert.equal(s400Set.has(record.candidateId), true, `Candidate ${record.candidateId} not in Semantic-400`)
  }
})

test('9. Pilot provenance classification preserved in cohort manifest and execution plan', async () => {
  const { cohortManifest, executionPlan, pilotReuseAudit } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const pilotAuditMap = new Map(pilotReuseAudit.records.map((r) => [r.candidateId, r]))

  let pilotCountInT2 = 0
  let freshCountInT2 = 0
  for (const record of cohortManifest.records) {
    if (record.sourceClassification === 'HISTORICAL_PILOT') {
      pilotCountInT2++
      assert.equal(record.pilotReuseClassification, pilotAuditMap.get(record.candidateId).classification)
    } else {
      freshCountInT2++
      assert.equal(record.sourceClassification, 'FRESH')
      assert.equal(record.pilotReuseClassification, null)
    }
  }

  assert.equal(pilotCountInT2, 10)
  assert.equal(freshCountInT2, 140)
  assert.equal(cohortManifest.cohortSummary.pilotSelectedCount, 10)
  assert.equal(cohortManifest.cohortSummary.freshSelectedCount, 140)

  // Execution plan accounts for all 150 writer calls needed (0 reusable pilot artifacts)
  assert.equal(executionPlan.pilotReuseAccounting.reusablePilotWriterArtifactsCount, 0)
  assert.equal(executionPlan.pilotReuseAccounting.freshWriterCallsRequiredCount, 150)
})

test('10. Source hash mutation causes fail-closed behavior', async () => {
  const { buildCohortManifest } = await import('./scalePipeline.mjs')
  // Pass mismatched trancheSize and records
  assert.throws(() => buildCohortManifest({
    trancheId: TRANCHE_ID,
    trancheSize: 150,
    cohortSeed: COHORT_SEED_ID,
    selectedCandidateIds: Array.from({ length: 150 }, (_, i) => `c-${i}`),
    records: Array.from({ length: 149 }, (_, i) => ({ candidateId: `c-${i}` })), // 149 instead of 150
  }), /records length \(149\) does not match trancheSize \(150\)/)
})

test('11. Invalid tranche size fails validation', async () => {
  const { selectCohortCandidateIds } = await import('./scalePipeline.mjs')
  const pool = Array.from({ length: 100 }, (_, i) => `c-${i}`)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: 0, cohortSeed: 's' }), /positive integer/)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: -10, cohortSeed: 's' }), /positive integer/)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: 150, cohortSeed: 's' }), /candidatePool has 100 candidates, but trancheSize is 150/)
})

test('12. Invalid audit rate fails validation', async () => {
  const { selectAuditCandidateIds } = await import('./scalePipeline.mjs')
  const pool = ['c-1', 'c-2']
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: 0, auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: 1.05, auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: '0.2', auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
})

test('13. Duplicate candidate or TMDB identity in pool fails validation', async () => {
  const { filterCandidatePool, selectCohortCandidateIds } = await import('./scalePipeline.mjs')
  assert.throws(() => filterCandidatePool({ candidatePool: ['dup-1', 'dup-1', 'c-2'] }), /duplicate candidate IDs/)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: ['dup-1', 'dup-1', 'c-2'], trancheSize: 2, cohortSeed: 's' }), /duplicate candidate IDs/)
})

test('14. Generated artifact rerun hashes are 100% identical and match persisted files', async () => {
  const outDir = outputRoot(repoRoot)
  const persistedAccounting = JSON.parse(await readFile(path.join(outDir, 'remaining-catalogue-accounting.json'), 'utf8'))
  const persistedPilotAudit = JSON.parse(await readFile(path.join(outDir, 'pilot-reuse-audit.json'), 'utf8'))
  const persistedCohort = JSON.parse(await readFile(path.join(outDir, 'cohort-manifest.json'), 'utf8'))
  const persistedPlan = JSON.parse(await readFile(path.join(outDir, 'execution-plan.json'), 'utf8'))

  const result = await buildScaleTranche2Artifacts({ repoRoot, persist: false })

  assert.equal(hashArtifact(persistedAccounting), result.hashes.remainingAccountingHash)
  assert.equal(hashArtifact(persistedPilotAudit), result.hashes.pilotReuseAuditHash)
  assert.equal(hashArtifact(persistedCohort), result.hashes.cohortManifestHash)
  assert.equal(hashArtifact(persistedPlan), result.hashes.executionPlanHash)
})

test('15. Guardrail consistency: hardModelCallCap >= theoreticalMaximumModelCalls and expectedModelCalls < theoreticalMaximumModelCalls', async () => {
  const { executionPlan } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const g = executionPlan.plannedGuardrails

  // theoreticalMaximumModelCalls = writer max + structural repair max + verifier max
  const expectedSum = g.writerCallsMaximum + g.structuralRepairCallsMaximum + g.riskVerifierCallsMaximum
  assert.equal(g.theoreticalMaximumModelCalls, expectedSum)
  assert.equal(g.theoreticalMaximumModelCalls, 451)

  // hardModelCallCap >= theoreticalMaximumModelCalls
  assert.ok(g.hardModelCallCap >= g.theoreticalMaximumModelCalls, `hardModelCallCap (${g.hardModelCallCap}) must be >= theoreticalMaximumModelCalls (${g.theoreticalMaximumModelCalls})`)

  // expectedModelCalls < theoreticalMaximumModelCalls
  assert.ok(g.expectedModelCalls < g.theoreticalMaximumModelCalls, `expectedModelCalls (${g.expectedModelCalls}) must be < theoreticalMaximumModelCalls (${g.theoreticalMaximumModelCalls})`)
  assert.equal(g.expectedModelCalls, 310)
})

test('16. Cost ceiling guardrail logic covers theoretical worst-case model calls under T1 empirical pricing', async () => {
  const { executionPlan } = await buildScaleTranche2Artifacts({ repoRoot, persist: false })
  const g = executionPlan.plannedGuardrails

  // Cost ceiling >= expected cost
  assert.ok(g.costCeilingUSD >= g.empiricalExpectedUSD, `costCeilingUSD ($${g.costCeilingUSD}) must be >= empiricalExpectedUSD ($${g.empiricalExpectedUSD})`)

  // Cost ceiling covers pessimistic theoretical cost (all 150 repairs used)
  assert.ok(g.costCeilingUSD >= g.pessimisticTheoreticalUSD, `costCeilingUSD ($${g.costCeilingUSD}) must be >= pessimisticTheoreticalUSD ($${g.pessimisticTheoreticalUSD})`)
  assert.equal(g.costCeilingUSD, 2.00)
  assert.equal(g.pessimisticTheoreticalUSD, 1.595)
})

test('17. Fail-closed behavior: hardModelCallCap below theoretical maximum throws error', async () => {
  const { buildExecutionPlan } = await import('./scalePipeline.mjs')
  const basePlanArgs = {
    trancheId: TRANCHE_ID,
    trancheSize: TRANCHE_SIZE,
    auditRate: 0.20,
    auditSeed: 'seed',
    selectedCandidateIds: Array.from({ length: 150 }, (_, i) => `c-${i}`),
    cohortManifestHash: 'sha256:dummy',
    normalWriterCallCap: 150,
    ambiguousRecoveryWriterCallCap: 1,
    writerCallsMaximum: 151,
    structuralRepairCallsMaximum: 150,
    riskVerifierCallsMaximum: 150,
  }

  // 400 is below 451 -> must throw
  assert.throws(() => buildExecutionPlan({
    ...basePlanArgs,
    hardModelCallCap: 400,
  }), /hardModelCallCap \(400\) must be at least theoreticalMaximumModelCalls \(451\)/)

  // 450 is below 451 -> must throw
  assert.throws(() => buildExecutionPlan({
    ...basePlanArgs,
    hardModelCallCap: 450,
  }), /hardModelCallCap \(450\) must be at least theoreticalMaximumModelCalls \(451\)/)

  // 451 is equal to 451 -> must succeed
  assert.doesNotThrow(() => buildExecutionPlan({
    ...basePlanArgs,
    hardModelCallCap: 451,
  }))
})

test('18. Fail-closed behavior: costCeilingUSD below empiricalExpectedUSD throws error', async () => {
  const { buildExecutionPlan } = await import('./scalePipeline.mjs')
  assert.throws(() => buildExecutionPlan({
    trancheId: TRANCHE_ID,
    trancheSize: TRANCHE_SIZE,
    auditRate: 0.20,
    auditSeed: 'seed',
    selectedCandidateIds: Array.from({ length: 150 }, (_, i) => `c-${i}`),
    cohortManifestHash: 'sha256:dummy',
    empiricalExpectedUSD: 1.074,
    maxBudgetUSD: 0.50, // lower than empiricalExpectedUSD
  }), /costCeilingUSD \(\$0.5\) must be at least empiricalExpectedUSD \(\$1.074\)/)
})
