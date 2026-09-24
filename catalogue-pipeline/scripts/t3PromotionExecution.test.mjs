import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { PROMOTED_PRODUCTION_ROOT, validatePromotionExecutionOutputPath, promoteFixtureRecords } from './t3PromotionExecution.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't3-promotion-'))
  const source = path.join(root, 'source.json'); const payload = { schemaVersion: 'production-record.v2', candidateId: 'fixture-1', tmdbId: 1, curatedMovie: {}, facts: {}, provenance: {} }
  const envelope = { schemaVersion: 't3-stage-2-successor-dry-run-record.v1', candidateId: 'fixture-1', tmdbId: 1, status: 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION', reasons: [], productionRecord: payload }
  const bytes = Buffer.from(serializeArtifactForPersistence(envelope)); fs.writeFileSync(source, bytes)
  return { root, source, envelope, payload, expectedHash: hashBytes(bytes), outputRoot: path.join(root, 'promoted') }
}

test('fixture promotion preserves canonical production-record bytes and supports exact no-op reuse', () => {
  const f = fixture(); const item = { sourcePath: f.source, expectedHash: f.expectedHash }
  const first = promoteFixtureRecords({ items: [item], outputRoot: f.outputRoot })
  const target = path.join(f.outputRoot, 'records', 'fixture-1.json')
  assert.equal(first[0].result, 'PROMOTED_PRODUCTION_RECORD')
  assert.deepEqual({ promoted: first.filter((record) => record.result === 'PROMOTED_PRODUCTION_RECORD').length, reused: first.filter((record) => record.result === 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD').length }, { promoted: 1, reused: 0 })
  assert.deepEqual(fs.readFileSync(target), Buffer.from(serializeArtifactForPersistence(f.payload)))
  const second = promoteFixtureRecords({ items: [item], outputRoot: f.outputRoot })
  assert.equal(second[0].result, 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD')
  assert.deepEqual({ promoted: second.filter((record) => record.result === 'PROMOTED_PRODUCTION_RECORD').length, reused: second.filter((record) => record.result === 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD').length }, { promoted: 0, reused: 1 })
  assert.deepEqual(fs.readFileSync(target), Buffer.from(serializeArtifactForPersistence(f.payload)))
})

test('fixture promotion fails closed for source, identity, duplicate, and target conflicts', () => {
  const f = fixture(); const item = { sourcePath: f.source, expectedHash: f.expectedHash }
  assert.throws(() => promoteFixtureRecords({ items: [{ ...item, expectedHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }], outputRoot: f.outputRoot }), /SOURCE_HASH_INVALID/)
  const changed = { ...f.envelope, tmdbId: 2 }; fs.writeFileSync(f.source, serializeArtifactForPersistence(changed))
  assert.throws(() => promoteFixtureRecords({ items: [item], outputRoot: f.outputRoot }), /SOURCE_HASH_INVALID/)
  fs.writeFileSync(f.source, serializeArtifactForPersistence(f.envelope)); const duplicate = { ...item }
  assert.throws(() => promoteFixtureRecords({ items: [item, duplicate], outputRoot: f.outputRoot }), /DUPLICATE/)
  fs.mkdirSync(path.join(f.outputRoot, 'records'), { recursive: true }); fs.writeFileSync(path.join(f.outputRoot, 'records', 'fixture-1.json'), 'conflict')
  assert.throws(() => promoteFixtureRecords({ items: [item], outputRoot: f.outputRoot }), /CONFLICTING_TARGET_EXISTS/)
})

test('output policy excludes dry run and runtime paths and executor has no network or regeneration surface', () => {
  assert.equal(validatePromotionExecutionOutputPath(`${PROMOTED_PRODUCTION_ROOT}/records/x.json`), true)
  assert.equal(validatePromotionExecutionOutputPath('src/data/curatedMovies.json'), false)
  assert.equal(validatePromotionExecutionOutputPath('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3/stage-2-production-assembly-dry-run-v2/records/x.json'), false)
  const source = fs.readFileSync(new URL('./t3PromotionExecution.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'paletteFromPoster', 'resolveTmdbPosterUrl', 'src/data/curatedMovies', 'public/']) assert.equal(source.includes(forbidden), false, forbidden)
})
