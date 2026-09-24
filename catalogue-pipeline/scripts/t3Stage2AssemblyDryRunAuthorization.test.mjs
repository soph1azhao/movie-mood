import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { AUTHORIZATION_PATH, buildStage2Authorization, DRY_RUN_ROOT, validateDryRunOutputPath, validateStage2Authorization, writeStage2Authorization } from './t3Stage2AssemblyDryRunAuthorization.mjs'
import { hashArtifact } from './validatePromotionContract.mjs'

test('freezes exactly the 139 final human-accepted identities and isolates excluded routes', () => {
  const authorization = buildStage2Authorization()
  assert.equal(validateStage2Authorization(authorization), true)
  assert.equal(authorization.candidateIds.length, 139)
  assert.ok(authorization.candidateIds.includes('scale500-tmdb-9299'))
  for (const id of ['scale500-tmdb-12104', 'scale500-tmdb-26691', 'scale500-tmdb-10442', 'exp100-tmdb-1156593']) assert.ok(!authorization.candidateIds.includes(id))
})

test('forbids semantic mutation, providers, runtime writing, and promotion', () => {
  const authorization = buildStage2Authorization()
  for (const [field, value, code] of [
    ['semanticMutationAllowed', true, /NONPROMOTION_GUARD_INVALID/],
    ['providerCallsAuthorized', 1, /NONPROMOTION_GUARD_INVALID/],
    ['runtimeWriteAllowed', true, /NONPROMOTION_GUARD_INVALID/],
    ['promotionAllowed', true, /NONPROMOTION_GUARD_INVALID/],
  ]) assert.throws(() => validateStage2Authorization({ ...authorization, authorization: { ...authorization.authorization, [field]: value } }), code)
})

test('requires all contract bindings and restricts dry-run output paths', () => {
  const authorization = buildStage2Authorization()
  assert.throws(() => validateStage2Authorization({ ...authorization, bindings: { ...authorization.bindings, productionSchema: { ...authorization.bindings.productionSchema, rawFileHash: 'wrong' } } }), /BINDING_INVALID/)
  assert.throws(() => validateStage2Authorization({ ...authorization, candidateIds: [...authorization.candidateIds.slice(1), 'foreign-candidate'] }), /POPULATION_INVALID/)
  assert.equal(validateDryRunOutputPath(DRY_RUN_ROOT), true)
  assert.equal(validateDryRunOutputPath(`${DRY_RUN_ROOT}/fixtures/result.json`), true)
  assert.equal(validateDryRunOutputPath('src/data/tmdbMovies.json'), false)
})

test('persisted authorization is immutable and replay is rejected', () => {
  const authorization = JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8'))
  assert.equal(validateStage2Authorization(authorization), true)
  assert.match(hashArtifact(authorization), /^sha256:[0-9a-f]{64}$/)
  assert.throws(() => writeStage2Authorization(), /REPLAY_REJECTED/)
  assert.equal(path.basename(AUTHORIZATION_PATH), 't3-stage-2-production-assembly-dry-run-authorization.v1.json')
})
