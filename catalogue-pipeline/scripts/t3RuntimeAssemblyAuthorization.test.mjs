import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildRuntimeAssemblyPlan, RUNTIME_TARGETS, validateRuntimeAssemblyPlan, validateRuntimeTargetPath } from './t3RuntimeAssemblyAuthorization.mjs'

test('runtime plan preserves the baseline and deterministically adds exactly 139 promoted records', () => {
  const plan = buildRuntimeAssemblyPlan()
  assert.equal(validateRuntimeAssemblyPlan(plan), true)
  assert.equal(plan.baseline.count, 41)
  assert.equal(plan.projections.length, 139)
  assert.equal(plan.expectedFinalCount, 180)
  assert.deepEqual(plan.overlaps, { exactExisting: 0, deterministicUpdates: 0, conflicts: 0 })
})

test('runtime projection preserves promoted semantic, factual, palette, and identity fields', () => {
  const plan = buildRuntimeAssemblyPlan(); const first = plan.projections[0]
  assert.equal(first.curatedMovie.id, first.runtimeId)
  assert.equal(first.curatedMovie.tmdbId, first.tmdbId)
  assert.equal(first.facts.tmdbId, first.tmdbId)
  assert.equal(first.curatedMovie.palette.length, 2)
  assert.equal(typeof first.curatedMovie.description, 'string')
  assert.equal(typeof first.facts.posterPath, 'string')
})

test('runtime target policy is exact and plan validation rejects duplicate or colliding projections', () => {
  const plan = buildRuntimeAssemblyPlan()
  assert.deepEqual(plan.outputTargets, RUNTIME_TARGETS)
  assert.equal(validateRuntimeTargetPath('src/data/curatedMovies.ts'), true)
  assert.equal(validateRuntimeTargetPath('src/data/movies.ts'), false)
  assert.throws(() => validateRuntimeAssemblyPlan({ ...plan, projections: [plan.projections[0], ...plan.projections.slice(1, -1), plan.projections[0]] }), /DUPLICATE_IDENTITY/)
})

test('authorization planning performs no runtime write, poster acquisition, palette generation, or network work', () => {
  const before = Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, fs.readFileSync(target)]))
  buildRuntimeAssemblyPlan()
  for (const target of RUNTIME_TARGETS) assert.deepEqual(fs.readFileSync(target), before[target])
  const source = fs.readFileSync(new URL('./t3RuntimeAssemblyAuthorization.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'paletteFromPoster', 'resolveTmdbPosterUrl', 'writeFileSync', 'src/data/curatedMovies.ts.tmp']) assert.equal(source.includes(forbidden), false, forbidden)
})
