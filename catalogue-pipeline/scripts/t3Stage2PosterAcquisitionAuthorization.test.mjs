import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { AUTHORIZATION_PATH, buildPosterAcquisitionGovernance, MANIFEST_PATH, OUTPUT_ROOT, validatePosterAcquisitionGovernance, writePosterAcquisitionGovernance } from './t3Stage2PosterAcquisitionAuthorization.mjs'

test('freezes the exact accepted 139 and excludes non-accepted routes', () => {
  const value = buildPosterAcquisitionGovernance(); assert.equal(validatePosterAcquisitionGovernance(value), true)
  assert.equal(value.authorization.candidateIds.length, 139)
  for (const id of ['scale500-tmdb-12104', 'scale500-tmdb-26691', 'scale500-tmdb-10442', 'exp100-tmdb-1156593']) assert.ok(!value.authorization.candidateIds.includes(id))
})

test('forbids substitution, model providers, runtime, promotion, palettes, and direct executor use', () => {
  const value = buildPosterAcquisitionGovernance(); const { authorization } = value
  assert.deepEqual(authorization.externalSystem.forbidden.includes('TMDB_DATA_API'), true); assert.equal(authorization.paletteGenerationAuthorized, false); assert.equal(authorization.futureExecutor.executorAuthorized, false)
  for (const field of ['providerCallsAuthorized', 'runtimeWriteAllowed', 'promotionAllowed']) assert.equal(authorization[field], field === 'providerCallsAuthorized' ? 0 : false)
  assert.equal(authorization.outputPolicy.outputRoot, OUTPUT_ROOT); assert.equal(authorization.retryPolicy.attemptLimitPerCandidate, 2); assert.equal(authorization.cachePolicy.conflictingCachedBytes, 'REJECT_FAIL_CLOSED')
})

test('persisted governance is immutable and replay is rejected', () => {
  const authorization = JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8')); const candidateManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.equal(validatePosterAcquisitionGovernance({ authorization, candidateManifest }), true)
  assert.throws(() => writePosterAcquisitionGovernance(), /REPLAY_REJECTED/)
})
