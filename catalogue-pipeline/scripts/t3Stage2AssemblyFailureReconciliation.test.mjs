import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildFailureReconciliation, RECONCILIATION_PATH, validateFailureReconciliation, writeFailureReconciliation } from './t3Stage2AssemblyFailureReconciliation.mjs'

test('reconciles exactly 139 shared non-semantic local-poster prerequisite failures', () => {
  const artifact = buildFailureReconciliation()
  assert.equal(validateFailureReconciliation(artifact), true)
  assert.equal(artifact.affectedPopulation, 139)
  assert.equal(artifact.assetInventory.frozenTmdbPosterPathPresent, 139)
  assert.equal(artifact.assetInventory.matchingLocalPosterAssets, 0)
  assert.equal(artifact.assetInventory.matchingPaletteArtifacts, 0)
  assert.equal(artifact.semanticStatusUnchanged, true)
  assert.equal(artifact.promotionEligibilityRemainsZero, true)
})

test('preserves no-provider and non-runtime guards and rejects replay', () => {
  const artifact = JSON.parse(fs.readFileSync(RECONCILIATION_PATH, 'utf8'))
  assert.equal(validateFailureReconciliation(artifact), true)
  assert.equal(artifact.providerCallsAuthorized, 0); assert.equal(artifact.runtimeWriteAllowed, false); assert.equal(artifact.promotionAllowed, false)
  assert.equal(artifact.nextLawfulRoute.code, 'BOUNDED_T3_POSTER_ASSET_ACQUISITION_AUTHORIZATION')
  assert.throws(() => writeFailureReconciliation(), /REPLAY_REJECTED/)
})
