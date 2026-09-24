import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  HISTORICAL_DRY_RUN_ROOT,
  SUCCESSOR_DRY_RUN_ROOT,
  executeSuccessorDryRun,
  assembleSuccessorRow,
  loadSuccessorRows,
  validateExactAcceptedCandidateIds,
  validateFutureExecutionAuthorization,
  validatePaletteBinding,
  validatePosterBinding,
  validateSuccessorOutputPath,
} from './t3Stage2ProductionAssemblySuccessorDryRun.mjs'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'

const candidate = { candidateId: 'fixture-t3', tmdbId: 42 }
const fact = { posterPath: '/fixture.jpg' }
const bytes = Buffer.from('fixture-poster-bytes')
const posterHash = hashBytes(bytes)
const acquisitionRecord = { candidateId: candidate.candidateId, tmdbId: 42, posterPath: fact.posterPath, status: 'POSTER_ASSET_ACQUIRED', localAssetPath: 'assets/fixture/poster', posterByteHash: posterHash }
const acquisitionResult = { ...acquisitionRecord, status: 'POSTER_ASSET_ACQUIRED' }
const algorithmHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const paletteArtifact = { schemaVersion: 'palette-artifact.v1', candidateId: candidate.candidateId, tmdbId: 42, palette: ['#112233', '#445566'], method: 'poster-algorithm', sourcePosterIdentity: { posterPath: fact.posterPath }, sourcePosterHash: posterHash, algorithmVersion: 'palette-algorithm.v1.1', override: null, t3Bindings: { paletteAlgorithmRawFileHash: algorithmHash } }
const paletteRecord = { candidateId: candidate.candidateId, tmdbId: 42, status: 'PALETTE_GENERATED', secondPassDeterminism: 'PASS', sourcePosterHash: posterHash, paletteArtifactHash: hashArtifact(paletteArtifact) }

test('successor output path is isolated from historical v1 and runtime paths', () => {
  assert.equal(validateSuccessorOutputPath(SUCCESSOR_DRY_RUN_ROOT), true)
  assert.equal(validateSuccessorOutputPath(`${SUCCESSOR_DRY_RUN_ROOT}/records/fixture.json`), true)
  assert.equal(validateSuccessorOutputPath(HISTORICAL_DRY_RUN_ROOT), false)
  assert.equal(validateSuccessorOutputPath('src/data/curatedMovies.json'), false)
})

test('the exact final accepted population is 139 and rejects foreign, excluded, quarantine, and deferred candidates', () => {
  const rows = loadSuccessorRows()
  const ids = rows.map((row) => row.candidate.candidateId)
  assert.equal(ids.length, 139)
  assert.equal(validateExactAcceptedCandidateIds(ids), true)
  for (const foreign of ['foreign-candidate', 'scale500-tmdb-12104', 'scale500-tmdb-10442', 'exp100-tmdb-1156593']) {
    assert.throws(() => validateExactAcceptedCandidateIds([...ids.slice(1), foreign]), /ACCEPTED_POPULATION_INVALID/)
  }
})

test('poster and persisted palette bindings require exact frozen identities and hashes', () => {
  assert.equal(validatePosterBinding({ candidate, fact, acquisitionRecord, acquisitionResult, posterBytes: bytes }), true)
  assert.equal(validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord, paletteArtifact, paletteAlgorithmHash: algorithmHash }), true)
  assert.throws(() => validatePosterBinding({ candidate, fact, acquisitionRecord: null, acquisitionResult, posterBytes: bytes }), /POSTER_NOT_ACQUIRED/)
  assert.throws(() => validatePosterBinding({ candidate, fact, acquisitionRecord: { ...acquisitionRecord, posterByteHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, acquisitionResult, posterBytes: bytes }), /POSTER_RESULT_MANIFEST_MISMATCH|POSTER_BYTE_HASH_MISMATCH/)
  assert.throws(() => validatePosterBinding({ candidate, fact: { posterPath: '/other.jpg' }, acquisitionRecord, acquisitionResult, posterBytes: bytes }), /POSTER_IDENTITY_OR_PATH_MISMATCH/)
  assert.throws(() => validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord: { ...paletteRecord, sourcePosterHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }, paletteArtifact, paletteAlgorithmHash: algorithmHash }), /PALETTE_POSTER_HASH_MISMATCH/)
  assert.throws(() => validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord: null, paletteArtifact, paletteAlgorithmHash: algorithmHash }), /PALETTE_NOT_GENERATED/)
  assert.throws(() => validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord, paletteArtifact: { ...paletteArtifact, t3Bindings: { paletteAlgorithmRawFileHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' } }, paletteAlgorithmHash: algorithmHash }), /PALETTE_ARTIFACT_HASH_MISMATCH|PALETTE_ALGORITHM_BINDING_MISMATCH/)
})

test('future execution requires a source-hash-bound authorization and cannot execute early', () => {
  assert.throws(() => validateFutureExecutionAuthorization({}), /EXECUTION_AUTHORIZATION_REQUIRED/)
  assert.throws(() => executeSuccessorDryRun({ authorization: {} }), /EXECUTION_AUTHORIZATION_REQUIRED/)
})

test('historical v1 artifacts stay byte-identical during successor executor validation', () => {
  const root = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
  const historical = `${root}/stage-2-production-assembly-dry-run-v1/t3-stage-2-production-assembly-dry-run-manifest.v1.json`
  const before = hashBytes(fs.readFileSync(historical)); const rows = loadSuccessorRows()
  assert.equal(JSON.parse(fs.readFileSync(historical)).aggregate.failed, 139)
  assert.equal(before, hashBytes(fs.readFileSync(historical)))
  const first = assembleSuccessorRow(rows[0]); const second = assembleSuccessorRow(rows[0])
  assert.equal(first.status, 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION')
  assert.deepEqual(first, second)
  for (const field of ['description', 'whyWatch', 'curiosityHook', 'vibeSummary']) assert.equal(first.productionRecord.curatedMovie[field], rows[0].final.copy[field])
})

test('fixture has no network, cache fallback, palette generation, runtime, or promotion dependency', () => {
  const source = fs.readFileSync(new URL('./t3Stage2ProductionAssemblySuccessorDryRun.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'paletteFromPoster', 'resolveTmdbPosterUrl', 'scale-tranche-2/production-assembly', 'src/data/curatedMovies']) assert.equal(source.includes(forbidden), false, forbidden)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3-successor-fixture-')); fs.rmSync(dir, { recursive: true, force: true })
})
