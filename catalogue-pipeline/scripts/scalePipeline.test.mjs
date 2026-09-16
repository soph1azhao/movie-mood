import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  computeAuthoritativeAccounting,
  computeCandidateIdKey,
  filterCandidatePool,
  hashCandidateSet,
  loadAndValidateAuthoritativeCandidatePool,
  selectAuditCandidateIds,
  selectCohortCandidateIds,
  VALID_SEMANTIC_STATES,
} from './scalePipeline.mjs'

test('computeCandidateIdKey produces deterministic sha256 hex keys', () => {
  const k1 = computeCandidateIdKey('seed-a', 'cand-1')
  const k2 = computeCandidateIdKey('seed-a', 'cand-1')
  const k3 = computeCandidateIdKey('seed-a', 'cand-2')
  assert.equal(k1, k2)
  assert.notEqual(k1, k3)
  assert.equal(k1.length, 64)
  assert.throws(() => computeCandidateIdKey('', 'cand-1'), /seedId must be a non-empty string/)
  assert.throws(() => computeCandidateIdKey('seed-a', null), /candidateId must be a non-empty string/)
})

test('hashCandidateSet produces deterministic sha256 hash independent of initial array ordering', () => {
  const ids1 = ['c-02', 'c-01', 'c-03']
  const ids2 = ['c-03', 'c-02', 'c-01']
  assert.equal(hashCandidateSet(ids1), hashCandidateSet(ids2))
  assert.match(hashCandidateSet(ids1), /^sha256:[0-9a-f]{64}$/)
  assert.throws(() => hashCandidateSet('not-an-array'), /candidateIds must be an array/)
})

test('loadAndValidateAuthoritativeCandidatePool accepts valid 400 set and rejects invalid counts or statuses', () => {
  const importedCandidates = Array.from({ length: 300 }, (_, i) => ({ candidateId: `c-${i}`, tmdbId: i }))
  const newCandidates = Array.from({ length: 100 }, (_, i) => ({ candidateId: `c-${i + 300}`, tmdbId: i + 300 }))
  const states = {}
  for (let i = 0; i < 400; i++) {
    states[`c-${i}`] = { status: 'IMPORTED_VALID' }
  }

  const { candidateIds, entries } = loadAndValidateAuthoritativeCandidatePool({
    semanticCohort: { importedCandidates, newCandidates },
    semanticManifest: { candidateCount: 400, states },
  })
  assert.equal(candidateIds.length, 400)
  assert.equal(entries.length, 400)

  // Non-valid status throws
  const badStates = { ...states, 'c-0': { status: 'INVALID_STATUS' } }
  assert.throws(() => loadAndValidateAuthoritativeCandidatePool({
    semanticCohort: { importedCandidates, newCandidates },
    semanticManifest: { candidateCount: 400, states: badStates },
  }), /invalid or missing semantic state/)

  // Count mismatch throws
  assert.throws(() => loadAndValidateAuthoritativeCandidatePool({
    semanticCohort: { importedCandidates: importedCandidates.slice(1), newCandidates },
    semanticManifest: { candidateCount: 400, states },
  }), /Semantic-400 count mismatch/)
})

test('computeAuthoritativeAccounting enforces exact 400/100/99/1/300/301 accounting and mathematical invariants', () => {
  const s400Ids = Array.from({ length: 400 }, (_, i) => `c-${String(i).padStart(3, '0')}`)
  const states = Object.fromEntries(s400Ids.map((id) => [id, { status: 'IMPORTED_VALID' }]))

  // T1: 100 candidates (c-000 through c-099)
  const t1CohortRecords = s400Ids.slice(0, 100).map((candidateId, idx) => ({ candidateId, tmdbId: idx }))
  // 99 complete, 1 deferred
  const t1CompleteRecords = t1CohortRecords.slice(0, 99)
  const t1DeferredCandidates = [t1CohortRecords[99]]

  // Pilot 16: c-100 through c-115 (in the remaining 300)
  const pilotPackets = s400Ids.slice(100, 116).map((candidateId, idx) => ({ candidateId, tmdbId: 100 + idx }))

  const accounting = computeAuthoritativeAccounting({
    semanticManifest: { states },
    t1CohortManifest: { records: t1CohortRecords },
    t1ProductionAssembly: { records: t1CompleteRecords, deferredCandidates: t1DeferredCandidates },
    pilotManifest: { packets: pilotPackets },
  })

  // Test 1: exact counts
  assert.equal(accounting.semanticTotal, 400)
  assert.equal(accounting.t1CohortTotal, 100)
  assert.equal(accounting.productionComplete, 99)
  assert.equal(accounting.deferredFromPriorTranche, 1)
  assert.equal(accounting.normalRemainingPool, 300)
  assert.equal(accounting.pilotCount, 16)
  assert.equal(accounting.freshCount, 284)
  assert.equal(accounting.totalUnresolved, 301)
  assert.equal(accounting.invariantsSatisfied, true)

  // Test 2: pilot16 + fresh284 = normal remaining300
  assert.equal(accounting.pilotCount + accounting.freshCount, accounting.normalRemainingPool)

  // Fail-closed on corrupted counts or overlaps
  assert.throws(() => computeAuthoritativeAccounting({
    semanticManifest: { states },
    t1CohortManifest: { records: t1CohortRecords.slice(0, 99) }, // 99 instead of 100
    t1ProductionAssembly: { records: t1CompleteRecords, deferredCandidates: t1DeferredCandidates },
    pilotManifest: { packets: pilotPackets },
  }), /Expected exactly 100 candidates in T1 cohort/)
})

test('filterCandidatePool subtracts excluded candidate IDs and detects duplicates', () => {
  const pool = ['c-1', 'c-2', 'c-3', 'c-4']
  const filtered = filterCandidatePool({ candidatePool: pool, excludedCandidateIds: ['c-2', 'c-4'] })
  assert.deepEqual(filtered, ['c-1', 'c-3'])

  assert.throws(() => filterCandidatePool({ candidatePool: ['c-1', 'c-1', 'c-2'] }), /duplicate candidate IDs/)
})

test('selectCohortCandidateIds is deterministic and independent of input enumeration order', () => {
  const candidatePool = Array.from({ length: 50 }, (_, i) => `cand-${String(i).padStart(2, '0')}`)
  const seed = 'test-cohort-seed-v1'

  const selected1 = selectCohortCandidateIds({ candidatePool, trancheSize: 20, cohortSeed: seed })
  const selected2 = selectCohortCandidateIds({ candidatePool: candidatePool.slice().reverse(), trancheSize: 20, cohortSeed: seed })
  const selected3 = selectCohortCandidateIds({ candidatePool: candidatePool.slice().sort(), trancheSize: 20, cohortSeed: seed })

  assert.deepEqual(selected1, selected2)
  assert.deepEqual(selected1, selected3)
  assert.equal(selected1.length, 20)
  assert.equal(new Set(selected1).size, 20)
})

test('selectCohortCandidateIds validates trancheSize and pool constraints', () => {
  const pool = ['c-1', 'c-2', 'c-3']
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: 0, cohortSeed: 's' }), /positive integer/)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: 5, cohortSeed: 's' }), /candidatePool has 3 candidates, but trancheSize is 5/)
  assert.throws(() => selectCohortCandidateIds({ candidatePool: pool, trancheSize: 2, cohortSeed: '' }), /non-empty string/)
})

test('selectAuditCandidateIds validates auditRate and selects deterministic sample', () => {
  const pool = Array.from({ length: 100 }, (_, i) => `c-${i}`)
  const res = selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: 0.20, auditSeed: 'test-audit-seed' })

  assert.equal(res.auditCount, 20)
  assert.equal(res.candidateIds.length, 20)
  assert.equal(new Set(res.candidateIds).size, 20)
  assert.equal(res.eligiblePoolCount, 100)

  // Re-run is identical
  const res2 = selectAuditCandidateIds({ autoEligibleCandidateIds: pool.slice().reverse(), auditRate: 0.20, auditSeed: 'test-audit-seed' })
  assert.deepEqual(res.candidateIds, res2.candidateIds)
  assert.equal(res.orderedAuditCandidateIdsHash, res2.orderedAuditCandidateIdsHash)

  // Invalid auditRate
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: 0, auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: 1.5, auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
  assert.throws(() => selectAuditCandidateIds({ autoEligibleCandidateIds: pool, auditRate: -0.1, auditSeed: 's' }), /auditRate must be a number in \(0, 1\]/)
})
