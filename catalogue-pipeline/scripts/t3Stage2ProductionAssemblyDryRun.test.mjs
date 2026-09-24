import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildExecutionAuthorization, EXECUTION_AUTHORIZATION_PATH, validateExecutionAuthorization } from './t3Stage2ProductionAssemblyDryRun.mjs'
import { hashArtifact } from './validatePromotionContract.mjs'

test('execution authorization binds exactly the accepted 139 and preserves all non-promotion guards', () => {
  const authorization = buildExecutionAuthorization()
  assert.equal(validateExecutionAuthorization(authorization), true)
  assert.equal(authorization.executionPopulation, 139)
  assert.equal(authorization.candidateIds.length, 139)
  for (const id of ['scale500-tmdb-12104', 'scale500-tmdb-26691', 'scale500-tmdb-10442', 'exp100-tmdb-1156593']) assert.ok(!authorization.candidateIds.includes(id))
  assert.equal(authorization.providerCallsAuthorized, 0); assert.equal(authorization.semanticMutationAllowed, false); assert.equal(authorization.runtimeWriteAllowed, false); assert.equal(authorization.promotionAllowed, false)
})

test('rejects executor/schema binding drift and forbidden execution scope', () => {
  const authorization = buildExecutionAuthorization()
  assert.throws(() => validateExecutionAuthorization({ ...authorization, bindings: { ...authorization.bindings, executor: { ...authorization.bindings.executor, rawFileHash: 'sha256:0'.padEnd(71, '0') } } }), /BINDING_DRIFT/)
  assert.throws(() => validateExecutionAuthorization({ ...authorization, promotionAllowed: true }), /SCOPE_INVALID/)
  assert.throws(() => validateExecutionAuthorization({ ...authorization, candidateIds: [...authorization.candidateIds.slice(1), 'foreign-candidate'] }), /POPULATION_INVALID/)
})

test('persisted execution authorization is immutable and has no promotion implication', () => {
  const authorization = JSON.parse(fs.readFileSync(EXECUTION_AUTHORIZATION_PATH, 'utf8'))
  assert.equal(validateExecutionAuthorization(authorization), true)
  assert.match(hashArtifact(authorization), /^sha256:[0-9a-f]{64}$/)
  assert.equal(authorization.executionCompleted, false)
})

test('completed dry run is deterministic, non-promoting, and records every local-poster failure', () => {
  const root = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3/stage-2-production-assembly-dry-run-v1'
  const manifest = JSON.parse(fs.readFileSync(`${root}/t3-stage-2-production-assembly-dry-run-manifest.v1.json`, 'utf8'))
  const ledger = JSON.parse(fs.readFileSync(`${root}/t3-stage-2-readiness-ledger.v1.json`, 'utf8'))
  assert.equal(manifest.population, 139); assert.equal(manifest.aggregate.failed, 139); assert.equal(manifest.aggregate.passed, 0); assert.equal(manifest.aggregate.determinism, 'PASS')
  assert.equal(ledger.promotionAuthorizationEligible, 0); assert.equal(ledger.promotionAuthorized, false); assert.equal(ledger.runtimeAssemblyAuthorized, false)
  assert.equal(manifest.records.length, 139); assert.equal(new Set(manifest.records.map((record) => record.candidateId)).size, 139)
  for (const record of manifest.records) {
    const artifact = JSON.parse(fs.readFileSync(record.artifactPath, 'utf8'))
    assert.equal(record.status, 'STAGE_2_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY')
    assert.equal(record.artifactHash, hashArtifact(artifact))
    assert.deepEqual(artifact.reasons.map((reason) => reason.code), ['LOCAL_POSTER_ASSET_UNAVAILABLE'])
    assert.equal(artifact.productionRecord, null)
  }
})
