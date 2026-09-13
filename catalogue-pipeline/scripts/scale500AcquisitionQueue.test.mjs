import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACQUISITION_TARGET, CALIBRATION_EXCLUSION_PATHS, CELL_PRIMARY_QUOTAS, CELL_QUOTAS, RESERVE_FACTOR, SCALE_500_BATCH_ID, Scale500QueueError, buildScale500AcquisitionQueue, cellPrimaryQuota, derivePilotCalibrationIds, loadAndBuildScale500AcquisitionQueue } from './scale500AcquisitionQueue.mjs'

const readJson = (path) => readFile(resolve(path), 'utf8').then(JSON.parse)

// ---- Fixtures ----

function makeMovie(id, opts = {}) {
  const year = opts.year ?? 1990
  const lang = opts.lang ?? 'en'
  const genre = opts.genre ?? 18
  return {
    id,
    title: `Movie ${id}`,
    release_date: `${year}-01-01`,
    original_language: lang,
    genre_ids: [genre],
    vote_count: opts.vote_count ?? 500,
    vote_average: opts.vote_average ?? 7.0,
    poster_path: `/poster${id}.jpg`,
    adult: false,
    overview: 'A sufficiently long overview text for eligibility testing.',
  }
}

function makeSnapshot(movies) {
  return {
    sourceSnapshotHash: 'sha256:fixture-snapshot',
    rawResponseCorpus: [{ cellId: 'fixture', response: { results: movies } }],
  }
}

function makeExpansionManifest(tmdbIds = []) {
  return {
    candidateManifestHash: 'sha256:fixture-expansion',
    candidates: tmdbIds.map((id) => ({ candidateId: `exp100-tmdb-${id}`, tmdbId: id })),
  }
}

function makeProductionMappings(tmdbIds = []) {
  return tmdbIds.map((id) => ({ tmdbId: id, id: `movie-${id}` }))
}

// Build a minimal valid pool: for each decade, language, band, enough films to fill primary + reserve cells
function buildMinimalPool() {
  const decades = ['1980s', '1990s', '2000s', '2010s', '2020s']
  const yearByDecade = { '1980s': 1985, '1990s': 1995, '2000s': 2005, '2010s': 2015, '2020s': 2021 }
  const bandsVoteCount = { mainstream: 2000, familiar: 700, discovery: 300 }
  const bands = Object.keys(CELL_QUOTAS)
  const langsValues = ['en', 'fr']
  const movies = []
  let id = 1000

  const maxPrimary = Math.max(...Object.values(CELL_QUOTAS))
  const maxReserve = Math.ceil(maxPrimary * 0.5)
  const totalPerCell = maxPrimary + maxReserve + 5

  for (const decade of decades) {
    for (const band of bands) {
      for (const lang of langsValues) {
        for (let i = 0; i < totalPerCell; i++) {
          movies.push(makeMovie(id++, { year: yearByDecade[decade], lang, genre: 18, vote_count: bandsVoteCount[band] + i }))
        }
      }
    }
  }
  return movies
}

describe('buildScale500AcquisitionQueue', () => {
  it('is deterministic: two calls with the same inputs produce the identical queue', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const first = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const second = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    expect(first.queueHash).toBe(second.queueHash)
    expect(first.queue.map((e) => e.tmdbId)).toEqual(second.queue.map((e) => e.tmdbId))
  })

  it('excludes all Expansion-100 members from the queue', () => {
    const movies = buildMinimalPool()
    const expansion100Movie = makeMovie(9999, { year: 1990, lang: 'en', genre: 28, vote_count: 3000 })
    movies.push(expansion100Movie)
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([9999])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const tmdbIds = new Set(queue.queue.map((e) => e.tmdbId))
    expect(tmdbIds.has(9999)).toBe(false)
  })

  it('excludes existing production catalogue members from the queue', () => {
    const movies = buildMinimalPool()
    const prodMovie = makeMovie(8888, { year: 1990, lang: 'en', genre: 28, vote_count: 3000 })
    movies.push(prodMovie)
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([8888])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const tmdbIds = new Set(queue.queue.map((e) => e.tmdbId))
    expect(tmdbIds.has(8888)).toBe(false)
  })

  it('excludes pilotCalibrationIds from the queue', () => {
    const movies = buildMinimalPool()
    const pilotMovie = makeMovie(7777, { year: 1990, lang: 'en', genre: 18, vote_count: 800 })
    movies.push(pilotMovie)
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings, pilotCalibrationIds: new Set([7777]) })
    const tmdbIds = new Set(queue.queue.map((e) => e.tmdbId))
    expect(tmdbIds.has(7777)).toBe(false)
  })

  it('[REGRESSION] assigns reserveTier inside each cell, not by global rank', () => {
    // Primary/reserve must be determined per-cell, not by selectionRank < ACQUISITION_TARGET.
    // This test verifies that for a single decade×band×language cell,
    // the first primaryPerCell entries are primary and the next reservePerCell are reserve,
    // regardless of total queue size.
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })

    // For each cell, count primary vs reserve
    const byCell = new Map()
    for (const entry of queue.queue) {
      if (!byCell.has(entry.cellKey)) byCell.set(entry.cellKey, { primary: 0, reserve: 0 })
      byCell.get(entry.cellKey)[entry.reserveTier]++
    }

    // Every cell must have exactly cellPrimaryQuota primary
    for (const [cellKey, counts] of byCell) {
      const [decade, langKey, band] = cellKey.split(':')
      const expectedPrimary = cellPrimaryQuota(decade, langKey, band)
      expect(counts.primary).toBe(expectedPrimary)
    }

    // Total primary count must equal ACQUISITION_TARGET
    const totalPrimary = queue.queue.filter((e) => e.reserveTier === 'primary').length
    expect(totalPrimary).toBe(ACQUISITION_TARGET)
  })

  it('[REGRESSION] all primaries appear before all reserves in the ordered queue', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const primaryRanks = queue.queue.filter((e) => e.reserveTier === 'primary').map((e) => e.selectionRank)
    const reserveRanks = queue.queue.filter((e) => e.reserveTier === 'reserve').map((e) => e.selectionRank)
    const maxPrimaryRank = Math.max(...primaryRanks)
    const minReserveRank = Math.min(...reserveRanks)
    expect(maxPrimaryRank).toBeLessThan(minReserveRank)
  })

  it('[REGRESSION] primary set has exactly the required per-decade composition', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const primary = queue.queue.filter((e) => e.reserveTier === 'primary')
    // Each decade must have exactly 80 primary (2 lang groups × (14+14+12) per band)
    for (const decade of ['1980s', '1990s', '2000s', '2010s', '2020s']) {
      const count = primary.filter((e) => e.decade === decade).length
      expect(count).toBe(80)
    }
  })

  it('[REGRESSION] primary set has exactly 200 English and 200 Non-English', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const primary = queue.queue.filter((e) => e.reserveTier === 'primary')
    expect(primary.filter((e) => e.languageGroup === 'English').length).toBe(200)
    expect(primary.filter((e) => e.languageGroup === 'Non-English').length).toBe(200)
  })

  it('[REGRESSION] primary set has exactly 140 mainstream, 140 familiar, 120 discovery', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const primary = queue.queue.filter((e) => e.reserveTier === 'primary')
    expect(primary.filter((e) => e.band === 'mainstream').length).toBe(140) // 5 decades × 2 langs × 14
    expect(primary.filter((e) => e.band === 'familiar').length).toBe(140)
    expect(primary.filter((e) => e.band === 'discovery').length).toBe(120)  // 5 decades × 2 langs × 12
  })

  it('[REGRESSION] each queue entry includes cellKey for same-cell reserve replacement', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    for (const entry of queue.queue) {
      expect(typeof entry.cellKey).toBe('string')
      expect(entry.cellKey.split(':').length).toBe(3) // decade:langKey:band
    }
  })

  it('marks exactly ACQUISITION_TARGET primary entries', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const primary = queue.queue.filter((e) => e.reserveTier === 'primary')
    const reserve = queue.queue.filter((e) => e.reserveTier === 'reserve')
    expect(primary.length).toBe(ACQUISITION_TARGET)
    expect(reserve.length).toBeGreaterThan(0)
    expect(reserve.length).toBe(queue.composition.reserveCandidates)
  })

  it('has no duplicate TMDB IDs in the queue', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    const ids = queue.queue.map((e) => e.tmdbId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports correct schema metadata', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    expect(queue.batchId).toBe(SCALE_500_BATCH_ID)
    expect(queue.acquisitionTarget).toBe(ACQUISITION_TARGET)
    expect(queue.reserveFactor).toBe(RESERVE_FACTOR)
    expect(queue.queueHash).toMatch(/^sha256:/)
  })

  it('reports per-exclusion-set counts in primaryExclusions', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([1, 2, 3])
    const mappings = makeProductionMappings([10, 11])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings, pilotCalibrationIds: new Set([100, 101]) })
    expect(queue.primaryExclusions.productionCatalogueIds).toBe(2)
    expect(queue.primaryExclusions.expansion100Members).toBe(3)
    expect(queue.primaryExclusions.pilotCalibrationIds).toBe(2)
  })

  it('composition reports nested primary breakdown', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    expect(queue.composition.decadeDistribution.primary).toBeDefined()
    expect(queue.composition.languageDistribution.primary).toBeDefined()
    expect(queue.composition.familiarityDistribution.primary).toBeDefined()
  })

  it('fails on missing sourceSnapshotHash', () => {
    expect(() => buildScale500AcquisitionQueue({ sourceSnapshot: {}, expansionManifest: makeExpansionManifest([]) })).toThrow(Scale500QueueError)
  })

  it('fails on missing candidateManifestHash', () => {
    expect(() => buildScale500AcquisitionQueue({ sourceSnapshot: { sourceSnapshotHash: 'x' }, expansionManifest: { candidates: [] } })).toThrow(Scale500QueueError)
  })

  it('assigns sequential selectionRank starting from 0', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    queue.queue.forEach((entry, idx) => expect(entry.selectionRank).toBe(idx))
  })

  it('each queue entry has required fields including cellKey', () => {
    const movies = buildMinimalPool()
    const snapshot = makeSnapshot(movies)
    const expansion = makeExpansionManifest([])
    const mappings = makeProductionMappings([])
    const queue = buildScale500AcquisitionQueue({ sourceSnapshot: snapshot, expansionManifest: expansion, existingMappings: mappings })
    for (const entry of queue.queue.slice(0, 5)) {
      expect(entry.candidateId).toMatch(/^scale500-tmdb-\d+$/)
      expect(typeof entry.tmdbId).toBe('number')
      expect(['primary', 'reserve']).toContain(entry.reserveTier)
      expect(['English', 'Non-English']).toContain(entry.languageGroup)
      expect(['mainstream', 'familiar', 'discovery']).toContain(entry.band)
      expect(typeof entry.cellKey).toBe('string')
    }
  })
})

describe('derivePilotCalibrationIds', () => {
  it('derives union from all four sources', () => {
    const { ids, breakdown } = derivePilotCalibrationIds({
      semanticPilotManifest: { candidates: [{ tmdbId: 1 }, { tmdbId: 2 }] },
      phase5aCalibrationFacts: { facts: [{ tmdbId: 3 }] },
      prospectiveHoldouts: { records: [{ tmdbId: 4 }] },
      c1bV3CandidateRegistry: { candidates: [{ id: 5 }] },
    })
    expect(ids.size).toBe(5)
    expect(ids.has(1)).toBe(true)
    expect(ids.has(3)).toBe(true)
    expect(ids.has(5)).toBe(true)
    expect(breakdown.union).toBe(5)
    expect(breakdown.semanticPilot).toBe(2)
    expect(breakdown.phase5aCalibration).toBe(1)
    expect(breakdown.prospectiveHoldouts).toBe(1)
    expect(breakdown.c1bV3CandidateRegistry).toBe(1)
  })

  it('handles overlapping IDs across sources (union deduplicated)', () => {
    const { ids, breakdown } = derivePilotCalibrationIds({
      semanticPilotManifest: { candidates: [{ tmdbId: 10 }] },
      phase5aCalibrationFacts: { facts: [{ tmdbId: 10 }, { tmdbId: 11 }] }, // tmdbId:10 duplicated
      prospectiveHoldouts: { records: [] },
      c1bV3CandidateRegistry: { candidates: [] },
    })
    expect(ids.size).toBe(2) // 10 and 11
    expect(breakdown.union).toBe(2)
    expect(breakdown.semanticPilot).toBe(1) // per-source count, not deduplicated
    expect(breakdown.phase5aCalibration).toBe(2)
  })

  it('handles missing or empty sources gracefully', () => {
    const { ids, breakdown } = derivePilotCalibrationIds({})
    expect(ids.size).toBe(0)
    expect(breakdown.union).toBe(0)
  })
})

describe('Scale-500 acquisition queue — live offline snapshot integration', () => {
  it('loads real offline snapshot and builds a queue with correct structure', async () => {
    const queue = await loadAndBuildScale500AcquisitionQueue()
    expect(queue.composition.primaryCandidates).toBe(ACQUISITION_TARGET)
    expect(queue.composition.reserveCandidates).toBeGreaterThan(0)
    expect(queue.composition.totalQueued).toBeGreaterThan(ACQUISITION_TARGET)
    // Calibration exclusion breakdown must be present and non-zero
    expect(queue.primaryExclusions.pilotCalibrationBreakdown).toBeDefined()
    expect(queue.primaryExclusions.pilotCalibrationIds).toBeGreaterThan(0)
    // All Expansion-100 members should be excluded
    const expansion = await readJson('catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/candidate-manifest.json')
    const expansionIds = new Set(expansion.candidates.map((c) => c.tmdbId))
    for (const entry of queue.queue) {
      expect(expansionIds.has(entry.tmdbId)).toBe(false)
    }
    // Per-cell primary quota satisfied
    const byCell = new Map()
    for (const entry of queue.queue) {
      if (!byCell.has(entry.cellKey)) byCell.set(entry.cellKey, { primary: 0, reserve: 0 })
      byCell.get(entry.cellKey)[entry.reserveTier]++
    }
    for (const [cellKey, counts] of byCell) {
      const [decade, langKey, band] = cellKey.split(':')
      expect(counts.primary).toBe(cellPrimaryQuota(decade, langKey, band))
    }
  })

  it('queue is deterministic against the real offline snapshot', async () => {
    const first = await loadAndBuildScale500AcquisitionQueue()
    const second = await loadAndBuildScale500AcquisitionQueue()
    expect(first.queueHash).toBe(second.queueHash)
  })
})
