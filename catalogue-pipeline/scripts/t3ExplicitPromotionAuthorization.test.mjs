import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { PROMOTION_AUTHORIZATION_PATH, validateExplicitPromotionAuthorization, validatePromotionOutputPath } from './t3ExplicitPromotionAuthorization.mjs'

const read = () => JSON.parse(fs.readFileSync(PROMOTION_AUTHORIZATION_PATH, 'utf8'))
const invalid = (mutate, code) => {
  const authorization = read(); mutate(authorization)
  assert.throws(() => validateExplicitPromotionAuthorization(authorization), new RegExp(code))
}

test('frozen promotion authorization is exact, non-mutating, non-runtime, and non-executable', () => {
  const authorization = read()
  assert.equal(validateExplicitPromotionAuthorization(authorization), true)
  assert.equal(validatePromotionOutputPath(authorization.outputRoot), true)
  assert.equal(validatePromotionOutputPath('src/data/curatedMovies.json'), false)
  assert.equal(authorization.promotionExecutionAuthorized, false)
})

test('authorization rejects foreign, excluded, duplicate, and non-PASS population states', () => {
  invalid((x) => { x.candidateIds[0] = 'foreign-candidate' }, 'POPULATION_INVALID')
  invalid((x) => { x.candidateIds[0] = 'scale500-tmdb-12104' }, 'POPULATION_INVALID')
  invalid((x) => { x.candidateIds[1] = x.candidateIds[0] }, 'POPULATION_INVALID')
  invalid((x) => { x.productionRecords.pop() }, 'RECORD_SET_INVALID')
})

test('authorization rejects mutation, provenance, runtime, network, provider, release, and deployment drift', () => {
  invalid((x) => { x.semanticMutationAllowed = true }, 'MUTATION_SCOPE_INVALID')
  invalid((x) => { x.factualMutationAllowed = true }, 'MUTATION_SCOPE_INVALID')
  invalid((x) => { x.paletteRegenerationAllowed = true }, 'MUTATION_SCOPE_INVALID')
  invalid((x) => { x.posterSubstitutionAllowed = true }, 'MUTATION_SCOPE_INVALID')
  invalid((x) => { x.runtimeWriteAllowed = true }, 'SCOPE_INVALID')
  invalid((x) => { x.networkCallsAuthorized = 1 }, 'EXTERNAL_SCOPE_INVALID')
  invalid((x) => { x.providerCallsAuthorized = 1 }, 'EXTERNAL_SCOPE_INVALID')
  invalid((x) => { x.releaseAllowed = true }, 'EXTERNAL_SCOPE_INVALID')
  invalid((x) => { x.deploymentAllowed = true }, 'EXTERNAL_SCOPE_INVALID')
  invalid((x) => { x.productionRecords[0].artifactHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, 'RECORD_HASH_INVALID')
})

test('authorization validates every successor record without changing historical artifacts', () => {
  const root = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
  const historical = `${root}/stage-2-production-assembly-dry-run-v1/t3-stage-2-production-assembly-dry-run-manifest.v1.json`
  const before = fs.readFileSync(historical)
  assert.equal(validateExplicitPromotionAuthorization(read()), true)
  assert.deepEqual(fs.readFileSync(historical), before)
})
