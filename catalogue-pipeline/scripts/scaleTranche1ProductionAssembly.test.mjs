import assert from 'node:assert/strict'
import test from 'node:test'

import { hashArtifact, hashBytes, validatePaletteArtifact } from './validatePromotionContract.mjs'
import { validatePromotionAuthorizationV2, validatePromotionAuthorizationV2Freshness, GOVERNANCE_ARTIFACT_HASH_V2, GOVERNANCE_VERSION_V2 } from './validatePromotionAuthorizationV2.mjs'
import { extractPaletteFromRgba, paletteFromPoster, resolveTmdbPosterUrl, rgbDistance, MIN_COLOR_DISTANCE } from './paletteAlgorithmV1.mjs'
import { assignStableLocalIds, chooseCanary, loadFinalEditorialArtifact, preflight, resolveFinalEditorialBinding } from './scaleTranche1ProductionAssembly.mjs'
import { validateProductionRecordV2 } from './validateProductionRecordV2.mjs'

function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] }

test('poster cohort preflight binds accepted checkpoint and excludes deferred candidate', async () => {
  const state = await preflight()
  assert.equal(state.records.length, 99)
  assert.equal(state.records.filter((r) => r.fact.posterPath).length, 99)
  assert.equal(new Set(state.records.map((r) => r.candidateId)).size, 99)
  assert.equal(new Set(state.records.map((r) => r.tmdbId)).size, 99)
  assert.equal(state.records.some((r) => r.candidateId === 'exp100-tmdb-1156593'), false)
  assert.equal(chooseCanary(state.records).length, 8)
})

test('final editorial resolver uses 6 repaired artifacts and 93 unrepaired routing artifacts with fresh hashes', async () => {
  const state = await preflight()
  let repaired = 0
  let unrepaired = 0
  for (const record of state.records) {
    const binding = resolveFinalEditorialBinding(record, state.context)
    const loaded = await loadFinalEditorialArtifact(record, state.context)
    assert.equal(loaded.actualHash, record.eligibility.finalEditorialArtifactHash)
    if (binding.source === 'TARGETED_REPAIR') {
      repaired += 1
      const routing = state.context.routing.records.find((entry) => entry.candidateId === record.candidateId)
      assert.notEqual(binding.path, routing.finalEditorialArtifactPath)
    } else unrepaired += 1
  }
  assert.equal(repaired, 6)
  assert.equal(unrepaired, 93)
})

test('poster URL derivation matches the frozen runtime w500 convention', () => {
  assert.equal(resolveTmdbPosterUrl('/poster.jpg'), 'https://image.tmdb.org/t/p/w500/poster.jpg')
})

test('raw-byte hash hashes bytes rather than URL or JSON', () => {
  const bytes = Buffer.from([0, 1, 2, 255])
  assert.equal(hashBytes(bytes), 'sha256:3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56')
  assert.notEqual(hashBytes(bytes), hashArtifact([...bytes]))
})

test('palette algorithm is deterministic for synthetic RGBA and preserves neutral posters', () => {
  const data = Buffer.alloc(8 * 8 * 4)
  for (let i = 0; i < 64; i += 1) { const value = i < 32 ? 40 : 200; data.set([value, value, value, 255], i * 4) }
  const image = { width: 8, height: 8, data }
  const one = extractPaletteFromRgba(image); const two = extractPaletteFromRgba(image)
  assert.deepEqual(one, two)
  assert.ok(rgbDistance(rgb(one[0]), rgb(one[1])) >= MIN_COLOR_DISTANCE)
  assert.ok(one.every((color) => /^#[0-9a-f]{6}$/.test(color)))
  assert.ok(one.every((color) => color.slice(1, 3) === color.slice(3, 5) && color.slice(3, 5) === color.slice(5, 7)))
})

test('poster decoder handles JPEG and WebP deterministically', async () => {
  const sharp = (await import('sharp')).default

  const raw = Buffer.alloc(12 * 8 * 4)

  for (let i = 0; i < 96; i += 1) {
    raw.set(
      i < 48
        ? [12, 40, 80, 255]
        : [220, 160, 48, 255],
      i * 4,
    )
  }

  const jpegBytes = await sharp(raw, {
    raw: { width: 12, height: 8, channels: 4 },
  }).jpeg().toBuffer()

  const webpBytes = await sharp(raw, {
    raw: { width: 12, height: 8, channels: 4 },
  }).webp().toBuffer()

  assert.deepEqual(
    await paletteFromPoster(jpegBytes),
    await paletteFromPoster(jpegBytes),
  )

  assert.deepEqual(
    await paletteFromPoster(webpBytes),
    await paletteFromPoster(webpBytes),
  )
})

test('palette v1 schema validator accepts complete deterministic artifact', () => {
  const artifact = { schemaVersion: 'palette-artifact.v1', candidateId: 'candidate', tmdbId: 1, palette: ['#102030', '#d0c0a0'], method: 'poster-algorithm', sourcePosterIdentity: { posterPath: '/p.jpg' }, sourcePosterHash: hashBytes(Buffer.from('jpeg')), algorithmVersion: 'palette-algorithm.v1', override: null }
  assert.equal(validatePaletteArtifact(artifact).ok, true)
})

test('stable local IDs reuse V5 helper behavior and disambiguate only collisions', () => {
  const assigned = new Map(assignStableLocalIds([{ candidateId: 'a', tmdbId: 10, title: 'Amélie', year: 2001 }, { candidateId: 'b', tmdbId: 11, title: 'Amelie', year: 2001 }, { candidateId: 'c', tmdbId: 12, title: 'Other', year: 2002 }], new Set(['other-2002'])))
  assert.equal(assigned.get('a'), 'amelie-2001-10')
  assert.equal(assigned.get('b'), 'amelie-2001-11')
  assert.equal(assigned.get('c'), 'other-2002-12')
})

function productionFixture() {
  const promotionCandidate = { schemaVersion: 'promotion-candidate.v1', candidateId: 'candidate', tmdbId: 1 }
  const semanticArtifact = {
    schemaVersion: 'semantic-output.v1',

    movie: {
      candidateId: 'candidate',
      tmdbId: 1,
    },

    classification: {
      moods: ['thoughtful'],
      situations: ['alone'],
      filterLanguages: ['English'],
      pace: 'medium',
      emotionalWeight: 'moderate',
      attentionDemand: 'engaged',
      discoveryStyle: 'different',
    },
  }
  const evidencePacket = {}
  const factsRecord = { candidateId: 'candidate', tmdbId: 1, title: 'Movie', year: 2000, director: 'Director', countries: ['US'], spokenLanguages: ['English'], genres: ['Drama'], runtimeMinutes: 100, posterPath: '/p.jpg' }
  const finalEditorialArtifact = { schemaVersion: 'editorial-artifact.v1.1', candidateId: 'candidate', tmdbId: 1, output: { copy: { description: 'A'.repeat(80), whyWatch: 'B'.repeat(60), curiosityHook: 'C'.repeat(50), vibeSummary: 'D'.repeat(45) } } }
  const paletteArtifact = { schemaVersion: 'palette-artifact.v1', candidateId: 'candidate', tmdbId: 1, palette: ['#102030', '#d0c0a0'], method: 'poster-algorithm', sourcePosterIdentity: { posterPath: '/p.jpg' }, sourcePosterHash: hashBytes(Buffer.from('jpeg')), algorithmVersion: 'palette-algorithm.v1', override: null }
  const record = { schemaVersion: 'production-record.v2', candidateId: 'candidate', tmdbId: 1, curatedMovie: { id: 'movie-2000', tmdbId: 1, ...semanticArtifact.classification, ...finalEditorialArtifact.output.copy, palette: paletteArtifact.palette }, facts: { tmdbId: 1, title: 'Movie', year: 2000, director: 'Director', countries: ['US'], spokenLanguages: ['English'], genres: ['Drama'], runtimeMinutes: 100, posterPath: '/p.jpg' }, provenance: { promotionCandidateHash: hashArtifact(promotionCandidate), semanticArtifactHash: hashArtifact(semanticArtifact), evidencePacketHash: hashArtifact(evidencePacket), factsRecordHash: hashArtifact(factsRecord), finalEditorialArtifactHash: hashArtifact(finalEditorialArtifact), paletteArtifactHash: hashArtifact(paletteArtifact) } }
  const bound = { promotionCandidate, semanticArtifact, evidencePacket, factsRecord, finalEditorialArtifact, paletteArtifact }
  return { record, bound }
}

test('production-record v2 validator accepts complete fresh record without universal critic or review', () => {
  const { record, bound } = productionFixture()
  assert.equal(validateProductionRecordV2(record, bound).ok, true)
})

test('production-record v2 accepts targeted-repair final editorial artifact shape', () => {
  const { record, bound } = productionFixture()

  const repaired = {
    schemaVersion: 'editorial-human-directed-repair-artifact.v1',
    candidateId: 'candidate',
    tmdbId: 1,
    copy: {
      description: 'A'.repeat(80),
      whyWatch: 'B'.repeat(60),
      curiosityHook: 'C'.repeat(50),
      vibeSummary: 'D'.repeat(45),
    },
    bindings: {
      originalFinalEditorialArtifact: hashArtifact('original'),
      completedHumanDecision: hashArtifact('decision'),
      materialityPolicy: hashArtifact('policy'),
    },
    sourceHashes: {
      semanticArtifact: hashArtifact(bound.semanticArtifact),
      evidencePacket: hashArtifact(bound.evidencePacket),
      factsRecord: hashArtifact(bound.factsRecord),
    },
  }

  bound.finalEditorialArtifact = repaired

  record.provenance.finalEditorialArtifactHash =
    hashArtifact(repaired)

  assert.equal(
    validateProductionRecordV2(record, bound).ok,
    true,
  )
})

for (const [field, value] of [
  ['moods', ['funny']],
  ['situations', ['friends']],
  ['filterLanguages', ['French']],
  ['pace', 'fast'],
  ['emotionalWeight', 'heavy'],
  ['attentionDemand', 'immersive'],
  ['discoveryStyle', 'adventurous'],
]) {
  test(`production-record v2 rejects stale semantic field ${field}`, () => {
    const { record, bound } = productionFixture()
    record.curatedMovie[field] = value
    const result = validateProductionRecordV2(record, bound)
    assert.equal(result.ok, false)
    assert.ok(result.hardFailures.some((failure) => failure.code === 'SEMANTIC_FIELD_MISMATCH' && failure.field === `curatedMovie.${field}`))
  })
}

for (const [field, value] of [
  ['title', 'Other'], ['year', 2001], ['director', 'Other Director'], ['countries', ['CA']], ['spokenLanguages', ['French']], ['genres', ['Comedy']], ['runtimeMinutes', 101], ['posterPath', '/other.jpg'],
]) {
  test(`production-record v2 rejects stale factual field ${field}`, () => {
    const { record, bound } = productionFixture()
    record.facts[field] = value
    const result = validateProductionRecordV2(record, bound)
    assert.equal(result.ok, false)
    assert.ok(result.hardFailures.some((failure) => failure.code === 'FACTS_FIELD_MISMATCH' && failure.field === `facts.${field}`))
  })
}

test('production-record v2 rejects promotion-candidate identity mismatches', () => {
  for (const mutation of [{ candidateId: 'other' }, { tmdbId: 2 }]) {
    const { record, bound } = productionFixture()
    bound.promotionCandidate = { ...bound.promotionCandidate, ...mutation }
    record.provenance.promotionCandidateHash = hashArtifact(bound.promotionCandidate)
    const result = validateProductionRecordV2(record, bound)
    assert.equal(result.ok, false)
    assert.ok(result.hardFailures.some((failure) => failure.code === 'PROMOTION_CANDIDATE_IDENTITY_MISMATCH'))
  }
})

test('production-record v2 binds optional critic provenance when present', () => {
  const { record, bound } = productionFixture()
  record.provenance.criticArtifactHash = hashArtifact({ critic: 'claimed' })
  let result = validateProductionRecordV2(record, bound)
  assert.equal(result.ok, false)
  assert.ok(result.hardFailures.some((failure) => failure.code === 'MISSING_BOUND_CRITIC_ARTIFACT'))

  bound.criticArtifact = { critic: 'actual' }
  result = validateProductionRecordV2(record, bound)
  assert.equal(result.ok, false)
  assert.ok(result.hardFailures.some((failure) => failure.code === 'STALE_PROVENANCE_HASH' && failure.field === 'provenance.criticArtifactHash'))

  record.provenance.criticArtifactHash = hashArtifact(bound.criticArtifact)
  assert.equal(validateProductionRecordV2(record, bound).ok, true)
})

test('production-record v2 rejects unknown root and provenance fields', () => {
  const { record, bound } = productionFixture()
  record.unexpected = true
  record.provenance.unexpected = 'x'
  const result = validateProductionRecordV2(record, bound)
  assert.equal(result.ok, false)
  assert.equal(result.hardFailures.filter((failure) => failure.code === 'UNKNOWN_FIELD').length, 2)
})

test('authorization assembly requires both state and freshness', () => {
  const hashes = { governanceArtifact: GOVERNANCE_ARTIFACT_HASH_V2, promotionCandidate: hashArtifact('candidate'), finalEditorialArtifact: hashArtifact('editorial'), riskLayerArtifact: hashArtifact('risk'), productionRecord: hashArtifact('record') }
  const authorization = { schemaVersion: 'promotion-authorization.v2', candidateId: 'candidate', tmdbId: 1, governanceVersion: GOVERNANCE_VERSION_V2, validationStatus: 'PASS', structuralValidationStatus: 'PASS', provenanceStatus: 'COMPLETE', finalEditorialArtifactStatus: 'VALID', riskRoutingStatus: 'AUTO_ELIGIBLE', riskLayer: { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false }, humanReviewStatus: 'NOT_REQUIRED', auditStatus: 'NOT_SAMPLED', editorialClosureStatus: 'CLEARED', productionValidationStatus: 'PASS', promotionDisposition: 'ELIGIBLE', authorizationMode: 'RISK_BASED_AUTO_ELIGIBLE', humanApproval: null, trancheGate: { severeAuditMissCount: 0, pauseCurrentTranche: false }, sourceHashes: hashes }
  assert.equal(validatePromotionAuthorizationV2(authorization).ok, true)
  assert.equal(validatePromotionAuthorizationV2Freshness(authorization, hashes).ok, true)
  assert.equal(validatePromotionAuthorizationV2Freshness(authorization, { ...hashes, productionRecord: hashArtifact('stale') }).ok, false)
})
