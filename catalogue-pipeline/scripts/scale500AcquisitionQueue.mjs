import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { collectDiscoveryPool, decadeFor, popularityBand } from './catalogueExpansionReadiness.mjs'

export const SCALE_500_BATCH_ID = 'scale-500-v1'
export const ACQUISITION_QUEUE_SCHEMA_VERSION = 'scale-500-acquisition-queue.v1'
export const ACQUISITION_TARGET = 400
export const RESERVE_FACTOR = 1.5 // 600 total for 400 target

// Per-cell quotas (English or Non-English per decade) for 500-film composition.
// Expansion-100 fills 20/decade (7 mainstream + 7 familiar + 6 discovery per lang group).
// New needed per decade: 80 (28 mainstream + 28 familiar + 24 discovery).
// Per cell (decade x language x band): 14 mainstream, 14 familiar, 12 discovery (primary).
// Reserve per cell: ceil(primary * 0.5).
export const CELL_QUOTAS = Object.freeze({ mainstream: 14, familiar: 14, discovery: 12 })
export const CELL_PRIMARY_QUOTAS = Object.freeze({
  // 1980s balances mainstream scarcity in non-English (only 8 eligible exist)
  // while maintaining exactly 80 / decade (28 mainstream, 28 familiar, 24 discovery)
  // and exactly 40 English / 40 Non-English.
  '1980s:en:mainstream': 20,
  '1980s:en:familiar': 11,
  '1980s:en:discovery': 9,
  '1980s:non-en:mainstream': 8,
  '1980s:non-en:familiar': 17,
  '1980s:non-en:discovery': 15,
})

export function cellPrimaryQuota(decade, langKey, band) {
  const key = `${decade}:${langKey}:${band}`
  return CELL_PRIMARY_QUOTAS[key] ?? CELL_QUOTAS[band]
}

const RESERVE_PER_PRIMARY = 0.5

// Authoritative pilot/calibration exclusion sources (mirrors scale500ExpansionFeasibility.mjs)
export const CALIBRATION_EXCLUSION_PATHS = Object.freeze({
  semanticPilotManifest: 'catalogue-pipeline/generated/semantic/batches/v8-1-semantic-pilot-001/manifest.json',
  phase5aCalibrationFacts: 'catalogue-pipeline/generated/tmdbFacts/phase-5a-calibration.json',
  prospectiveHoldouts: 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json',
  c1bV3CandidateRegistry: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/candidate-registry.json',
})

export class Scale500QueueError extends Error {
  constructor(message, { code = 'SCALE_500_QUEUE_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'Scale500QueueError'
    this.code = code
    this.details = details
  }
}
const fail = (message, code, details = {}) => { throw new Scale500QueueError(message, { code, details }) }

function releaseYear(movie) {
  const value = Number.parseInt(String(movie.release_date ?? '').slice(0, 4), 10)
  return Number.isInteger(value) ? value : null
}

/**
 * Select primaryCount + reserveCount movies from pool using deterministic genre rotation.
 * Returns entries tagged with { movie, reserveTier }.
 * IMPORTANT: reserveTier is assigned HERE inside the cell — not by global rank.
 */
function selectWithReserve(pool, primaryCount, reserveCount) {
  if (pool.length === 0) return []
  const byGenre = new Map()
  for (const movie of pool) {
    const genre = movie.genre_ids?.[0] ?? 0
    if (!byGenre.has(genre)) byGenre.set(genre, [])
    byGenre.get(genre).push(movie)
  }
  // Sort within each genre group by popularity (desc), then TMDB ID (asc) — deterministic
  for (const [, group] of byGenre) {
    group.sort((a, b) => b.vote_count - a.vote_count || b.vote_average - a.vote_average || a.id - b.id)
  }
  // Rotate across genres in ascending genre ID order
  const groups = [...byGenre.entries()].sort(([a], [b]) => a - b).map(([, g]) => g)
  const totalNeeded = primaryCount + reserveCount
  const selected = []
  while (selected.length < totalNeeded && groups.some((g) => g.length > 0)) {
    for (const group of groups) {
      if (group.length > 0 && selected.length < totalNeeded) selected.push(group.shift())
    }
  }
  // Tag: first primaryCount are primary, remainder are reserve
  return selected.map((movie, cellRank) => ({
    movie,
    reserveTier: cellRank < primaryCount ? 'primary' : 'reserve',
  }))
}

/**
 * Derive the pilot/calibration exclusion set from the four authoritative sources,
 * exactly mirroring scale500ExpansionFeasibility.mjs deriveScale500Feasibility().
 *
 * Sources:
 *   semanticPilotManifest.candidates[].tmdbId
 *   phase5aCalibrationFacts.facts[].tmdbId
 *   prospectiveHoldouts.records[].tmdbId
 *   c1bV3CandidateRegistry.candidates[].id
 */
export function derivePilotCalibrationIds({ semanticPilotManifest, phase5aCalibrationFacts, prospectiveHoldouts, c1bV3CandidateRegistry }) {
  const pilotIds = new Set((semanticPilotManifest?.candidates ?? []).map((e) => e.tmdbId))
  const phase5aIds = new Set((phase5aCalibrationFacts?.facts ?? []).map((e) => e.tmdbId))
  const holdoutIds = new Set((prospectiveHoldouts?.records ?? []).map((e) => e.tmdbId))
  const c1bIds = new Set((c1bV3CandidateRegistry?.candidates ?? []).map((e) => e.id))
  const union = new Set([...pilotIds, ...phase5aIds, ...holdoutIds, ...c1bIds])
  return {
    ids: union,
    breakdown: {
      semanticPilot: pilotIds.size,
      phase5aCalibration: phase5aIds.size,
      prospectiveHoldouts: holdoutIds.size,
      c1bV3CandidateRegistry: c1bIds.size,
      union: union.size,
    },
  }
}

/**
 * Build the deterministic Scale-500 acquisition queue.
 *
 * Primary/reserve status is assigned inside each cell (decade x language x familiarity),
 * not by global rank. This guarantees the primary set has exactly the required
 * per-decade / per-language / per-familiarity composition.
 *
 * Reserve candidates replace failed primaries only within the SAME composition cell.
 * The runner selects reserves from the same cell in selectionRank order after all
 * primaries in that cell have been attempted.
 *
 * @param {{ sourceSnapshot, expansionManifest, existingMappings?, pilotCalibrationIds?, pilotCalibrationBreakdown? }}
 */
export function buildScale500AcquisitionQueue({
  sourceSnapshot,
  expansionManifest,
  existingMappings = mappings,
  pilotCalibrationIds = new Set(),
  pilotCalibrationBreakdown = null,
}) {
  if (!sourceSnapshot?.sourceSnapshotHash) fail('sourceSnapshot must have a sourceSnapshotHash.', 'INVALID_SOURCE_SNAPSHOT')
  if (!expansionManifest?.candidateManifestHash || !Array.isArray(expansionManifest.candidates)) {
    fail('expansionManifest must have candidateManifestHash and candidates.', 'INVALID_EXPANSION_MANIFEST')
  }

  const expansion100Ids = new Set(expansionManifest.candidates.map((c) => c.tmdbId))
  const productionIds = new Set(existingMappings.map((e) => e.tmdbId).filter(Number.isInteger))
  const combinedExclusionIds = new Set([...productionIds, ...expansion100Ids, ...pilotCalibrationIds])

  const basePool = collectDiscoveryPool(sourceSnapshot, existingMappings)
  const eligiblePool = basePool.filter((movie) => !combinedExclusionIds.has(movie.id))

  if (eligiblePool.length < ACQUISITION_TARGET) {
    fail(`Eligible pool (${eligiblePool.length}) is smaller than acquisition target (${ACQUISITION_TARGET}).`, 'INSUFFICIENT_POOL')
  }

  const decades = ['1980s', '1990s', '2000s', '2010s', '2020s']
  const bands = Object.keys(CELL_QUOTAS) // ['mainstream', 'familiar', 'discovery']
  const langGroups = [{ key: 'en', label: 'English' }, { key: 'non-en', label: 'Non-English' }]

  // Collect per-cell entries with reserveTier assigned inside cell
  const cellEntries = [] // { movie, decade, band, languageGroup, reserveTier, cellKey }

  for (const decade of decades) {
    for (const band of bands) {
      for (const { key: langKey, label: languageGroup } of langGroups) {
        const primaryPerCell = cellPrimaryQuota(decade, langKey, band)
        const reservePerCell = Math.ceil(primaryPerCell * RESERVE_PER_PRIMARY)
        const pool = eligiblePool.filter((movie) => {
          const year = releaseYear(movie)
          if (!Number.isInteger(year)) return false
          if (decadeFor(year) !== decade) return false
          if (popularityBand(movie) !== band) return false
          return langKey === 'en' ? movie.original_language === 'en' : movie.original_language !== 'en'
        })
        const cellKey = `${decade}:${langKey}:${band}`
        const picks = selectWithReserve(pool, primaryPerCell, reservePerCell)
        for (const { movie, reserveTier } of picks) {
          cellEntries.push({ movie, decade, band, languageGroup, reserveTier, cellKey })
        }
      }
    }
  }

  // Build the ordered queue: primaries first (in cell-iteration order), then reserves
  // Within each tier, the order follows the cell-iteration ordering above.
  // selectionRank is the sequential position in this final list.
  const primaries = cellEntries.filter((e) => e.reserveTier === 'primary')
  const reserves = cellEntries.filter((e) => e.reserveTier === 'reserve')
  const ordered = [...primaries, ...reserves]

  const queue = ordered.map(({ movie, decade, band, languageGroup, reserveTier, cellKey }, selectionRank) => ({
    candidateId: `scale500-tmdb-${movie.id}`,
    tmdbId: movie.id,
    title: movie.title,
    year: releaseYear(movie),
    decade,
    band,
    languageGroup,
    originalLanguage: movie.original_language,
    primaryGenreId: movie.genre_ids?.[0] ?? null,
    voteCount: movie.vote_count,
    voteAverage: movie.vote_average,
    selectionRank,
    reserveTier,
    cellKey, // identifies the composition cell for same-cell reserve replacement
  }))

  const uniqueIds = new Set(queue.map((e) => e.tmdbId))
  if (uniqueIds.size !== queue.length) fail('Acquisition queue contains duplicate TMDB IDs.', 'DUPLICATE_TMDB_IDS')
  for (const entry of queue) {
    if (expansion100Ids.has(entry.tmdbId)) fail('Expansion-100 member leaked into acquisition queue.', 'EXPANSION_100_LEAK', { tmdbId: entry.tmdbId })
    if (pilotCalibrationIds.has(entry.tmdbId)) fail('Calibration/pilot member leaked into acquisition queue.', 'CALIBRATION_LEAK', { tmdbId: entry.tmdbId })
    if (productionIds.has(entry.tmdbId)) fail('Production catalogue member leaked into acquisition queue.', 'PRODUCTION_LEAK', { tmdbId: entry.tmdbId })
  }

  // Verify composition: primary set must exactly satisfy cell quotas
  const primarySet = queue.filter((e) => e.reserveTier === 'primary')
  const expectedPrimary = decades.length * bands.length * langGroups.length * 0 // computed below
  const primaryByCell = new Map()
  for (const entry of primarySet) {
    const key = entry.cellKey
    primaryByCell.set(key, (primaryByCell.get(key) ?? 0) + 1)
  }
  for (const decade of decades) {
    for (const band of bands) {
      for (const { key: langKey } of langGroups) {
        const cellKey = `${decade}:${langKey}:${band}`
        const actual = primaryByCell.get(cellKey) ?? 0
        const expected = cellPrimaryQuota(decade, langKey, band)
        if (actual !== expected) {
          fail(`Cell quota not satisfied: ${cellKey} has ${actual} primary, expected ${expected}.`, 'CELL_QUOTA_MISMATCH', { cellKey, actual, expected })
        }
      }
    }
  }

  const body = {
    schemaVersion: ACQUISITION_QUEUE_SCHEMA_VERSION,
    batchId: SCALE_500_BATCH_ID,
    acquisitionTarget: ACQUISITION_TARGET,
    reserveFactor: RESERVE_FACTOR,
    sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash,
    expansionManifestHash: expansionManifest.candidateManifestHash,
    primaryExclusions: {
      productionCatalogueIds: productionIds.size,
      expansion100Members: expansion100Ids.size,
      pilotCalibrationIds: pilotCalibrationIds.size,
      pilotCalibrationBreakdown: pilotCalibrationBreakdown ?? null,
    },
    composition: {
      totalQueued: queue.length,
      primaryCandidates: primarySet.length,
      reserveCandidates: queue.length - primarySet.length,
      decadeDistribution: {
        primary: Object.fromEntries(decades.map((d) => [d, primarySet.filter((e) => e.decade === d).length])),
        all: Object.fromEntries(decades.map((d) => [d, queue.filter((e) => e.decade === d).length])),
      },
      languageDistribution: {
        primary: { English: primarySet.filter((e) => e.languageGroup === 'English').length, 'Non-English': primarySet.filter((e) => e.languageGroup === 'Non-English').length },
        all: { English: queue.filter((e) => e.languageGroup === 'English').length, 'Non-English': queue.filter((e) => e.languageGroup === 'Non-English').length },
      },
      familiarityDistribution: {
        primary: Object.fromEntries(bands.map((b) => [b, primarySet.filter((e) => e.band === b).length])),
        all: Object.fromEntries(bands.map((b) => [b, queue.filter((e) => e.band === b).length])),
      },
    },
    reserveReplacement: 'Reserve candidates replace failed primaries only within the same composition cell (identified by cellKey). The runner selects reserves from the same cell in selectionRank order after all primaries in that cell have been attempted.',
    queue,
  }
  return { ...body, queueHash: `sha256:${stableHash(body)}` }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  try { await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`); await rename(tmp, path) }
  catch (error) { await rm(tmp, { force: true }); throw error }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

export const DEFAULT_QUEUE_PATHS = Object.freeze({
  sourceSnapshot: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/source-snapshot.json',
  expansionManifest: 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/candidate-manifest.json',
  queueOutput: 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-queue.json',
})

/**
 * Load all required inputs and build the acquisition queue, wiring in the
 * authoritative pilot/calibration exclusions from the four canonical sources.
 */
export async function loadAndBuildScale500AcquisitionQueue({ root = process.cwd() } = {}) {
  const [sourceSnapshot, expansionManifest, semanticPilotManifest, phase5aCalibrationFacts, prospectiveHoldouts, c1bV3CandidateRegistry] = await Promise.all([
    readJson(resolve(root, DEFAULT_QUEUE_PATHS.sourceSnapshot)),
    readJson(resolve(root, DEFAULT_QUEUE_PATHS.expansionManifest)),
    readJson(resolve(root, CALIBRATION_EXCLUSION_PATHS.semanticPilotManifest)),
    readJson(resolve(root, CALIBRATION_EXCLUSION_PATHS.phase5aCalibrationFacts)),
    readJson(resolve(root, CALIBRATION_EXCLUSION_PATHS.prospectiveHoldouts)),
    readJson(resolve(root, CALIBRATION_EXCLUSION_PATHS.c1bV3CandidateRegistry)),
  ])
  const { ids: pilotCalibrationIds, breakdown: pilotCalibrationBreakdown } = derivePilotCalibrationIds({ semanticPilotManifest, phase5aCalibrationFacts, prospectiveHoldouts, c1bV3CandidateRegistry })
  return buildScale500AcquisitionQueue({ sourceSnapshot, expansionManifest, pilotCalibrationIds, pilotCalibrationBreakdown })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadAndBuildScale500AcquisitionQueue().then(async (queue) => {
    const outputPath = resolve(DEFAULT_QUEUE_PATHS.queueOutput)
    if (process.argv.includes('--write')) await writeJson(outputPath, queue)
    console.log(JSON.stringify({
      queueHash: queue.queueHash,
      primaryExclusions: queue.primaryExclusions,
      composition: queue.composition,
    }, null, 2))
  }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
