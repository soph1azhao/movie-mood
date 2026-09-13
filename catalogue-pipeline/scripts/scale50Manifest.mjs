import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stableHash } from '../adapters/tmdbProvider.ts'

export const SCALE_50_BATCH_ID = 'scale-50-v1'
export const SOURCE_BATCH_ID = 'expansion-100-v1'
export const SOURCE_MANIFEST_HASH = 'sha256:ec6238081a234a67fc249676b27c9c7a6dca4135d03a525a22950b43a622b61e'
export const SOURCE_READINESS_REPORT_HASH = 'sha256:25f441bd3376dce0a41d7ecb2f4c295f1d73385944c03c4cf4b5efdc5cfaa023'
export const SELECTION_RULE_VERSION = 'scale-50-stratified-genre-rotation.v1'
export const DECADES = Object.freeze(['1980s', '1990s', '2000s', '2010s', '2020s'])
export const FAMILIARITY = Object.freeze(['mainstream', 'familiar', 'discovery'])

const familiarityQuotas = Object.freeze({
  '1980s': { mainstream: 4, familiar: 3, discovery: 3 },
  '1990s': { mainstream: 3, familiar: 4, discovery: 3 },
  '2000s': { mainstream: 4, familiar: 3, discovery: 3 },
  '2010s': { mainstream: 3, familiar: 4, discovery: 3 },
  '2020s': { mainstream: 4, familiar: 3, discovery: 3 },
})
const englishQuotas = Object.freeze({ mainstream: 2, familiar: 2, discovery: 1 })

export class Scale50ManifestError extends Error {
  constructor(message, { code = 'SCALE_50_MANIFEST_ERROR', details = {} } = {}) { super(message); this.name = 'Scale50ManifestError'; this.code = code; this.details = details }
}

function fail(message, code, details = {}) { throw new Scale50ManifestError(message, { code, details }) }
function decadeFor(year) { return `${Math.floor(year / 10) * 10}s` }
function familiarityFor(candidate) { return candidate.sourceTags?.find((value) => FAMILIARITY.includes(value)) }
function candidateOrder(left, right) {
  return left.sourceRankingProvenance.primaryGenreId - right.sourceRankingProvenance.primaryGenreId
    || left.sourceRankingProvenance.selectionIndex - right.sourceRankingProvenance.selectionIndex
    || left.tmdbId - right.tmdbId
}
function roundRobinGenres(candidates, count) {
  const groups = new Map()
  for (const candidate of [...candidates].sort(candidateOrder)) {
    const genre = candidate.sourceRankingProvenance.primaryGenreId
    const group = groups.get(genre) ?? []; group.push(candidate); groups.set(genre, group)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group)
  const selected = []
  while (selected.length < count && orderedGroups.some((group) => group.length)) {
    for (const group of orderedGroups) if (group.length && selected.length < count) selected.push(group.shift())
  }
  if (selected.length !== count) fail('The frozen 100-film cohort cannot satisfy a Scale-50 cell quota.', 'UNSATISFIABLE_SCALE_50_QUOTA', { requested: count, available: candidates.length })
  return selected
}

function countBy(values, key) { const result = {}; for (const value of values) { const label = key(value); result[label] = (result[label] ?? 0) + 1 } return result }

export function buildScale50Manifest(sourceManifest, readinessReport) {
  if (sourceManifest?.batchId !== SOURCE_BATCH_ID || sourceManifest?.candidateManifestHash !== SOURCE_MANIFEST_HASH) fail('Frozen expansion-100-v1 identity mismatch.', 'SOURCE_MANIFEST_IDENTITY_MISMATCH')
  if (readinessReport?.batchId !== SOURCE_BATCH_ID || readinessReport?.candidateManifestHash !== SOURCE_MANIFEST_HASH) fail('Frozen readiness-report identity mismatch.', 'SOURCE_READINESS_IDENTITY_MISMATCH')
  const { reportHash, ...readinessBody } = readinessReport
  if (reportHash !== SOURCE_READINESS_REPORT_HASH || `sha256:${stableHash(readinessBody)}` !== reportHash) fail('Frozen readiness-report hash mismatch.', 'SOURCE_READINESS_HASH_MISMATCH')
  if (!Array.isArray(sourceManifest.candidates) || sourceManifest.candidates.length !== 100) fail('Source manifest must contain exactly 100 candidates.', 'SOURCE_CANDIDATE_COUNT_MISMATCH')
  const readiness = new Map((readinessReport.records ?? []).map((record) => [record.candidateId, record]))
  const selected = []
  for (const decade of DECADES) {
    for (const familiarity of FAMILIARITY) {
      const quota = familiarityQuotas[decade][familiarity]
      const english = englishQuotas[familiarity]
      const pool = sourceManifest.candidates.filter((candidate) => decadeFor(candidate.year) === decade && familiarityFor(candidate) === familiarity)
      selected.push(...roundRobinGenres(pool.filter((candidate) => candidate.sourceRankingProvenance.originalLanguage === 'en'), english))
      selected.push(...roundRobinGenres(pool.filter((candidate) => candidate.sourceRankingProvenance.originalLanguage !== 'en'), quota - english))
    }
  }
  const candidates = selected.map((candidate, selectionIndex) => {
    const record = readiness.get(candidate.candidateId)
    if (!record || record.tmdbId !== candidate.tmdbId || record.factualSnapshotStatus !== 'COMPLETE' || record.evidencePacketStatus !== 'COMPLETE' || record.readiness !== 'AUTOMATICALLY_READY' || typeof record.evidencePacketHash !== 'string') fail('Selected candidate is not bound to complete frozen evidence.', 'SELECTED_EVIDENCE_NOT_READY', { candidateId: candidate.candidateId })
    if (candidate.factualSnapshotStatus !== 'COMPLETE' || candidate.duplicateExistingCatalogueStatus !== 'NOT_PRESENT') fail('Selected candidate violates frozen factual or duplicate constraints.', 'SELECTED_CANDIDATE_NOT_ELIGIBLE', { candidateId: candidate.candidateId })
    return {
      selectionIndex, candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, title: candidate.title, year: candidate.year,
      decade: record.decade, originalLanguage: record.originalLanguage, languageBucket: record.languageGroup,
      familiarityBucket: record.popularityBand, primaryGenre: record.primaryGenre, evidencePacketHash: record.evidencePacketHash,
    }
  })
  const composition = {
    decades: countBy(candidates, (candidate) => candidate.decade),
    languageBuckets: countBy(candidates, (candidate) => candidate.languageBucket),
    familiarityBuckets: countBy(candidates, (candidate) => candidate.familiarityBucket),
    originalLanguages: countBy(candidates, (candidate) => candidate.originalLanguage),
    primaryGenres: countBy(candidates, (candidate) => candidate.primaryGenre),
  }
  if (candidates.length !== 50 || new Set(candidates.map(({ candidateId }) => candidateId)).size !== 50 || new Set(candidates.map(({ tmdbId }) => tmdbId)).size !== 50) fail('Scale-50 must contain exactly 50 unique candidates.', 'INVALID_SCALE_50_UNIQUENESS')
  if (DECADES.some((decade) => composition.decades[decade] !== 10)) fail('Scale-50 decade quotas were not met.', 'INVALID_SCALE_50_DECADE_COMPOSITION', composition.decades)
  if (composition.languageBuckets.English !== 25 || composition.languageBuckets['Non-English'] !== 25) fail('Scale-50 language target was not met.', 'INVALID_SCALE_50_LANGUAGE_COMPOSITION', composition.languageBuckets)
  const body = {
    batchId: SCALE_50_BATCH_ID, artifactSchemaVersion: 'catalogue-scale-manifest.v1', sourceBatchId: SOURCE_BATCH_ID,
    sourceCandidateManifestHash: SOURCE_MANIFEST_HASH, selectionRuleVersion: SELECTION_RULE_VERSION,
    selectionRule: { hardDecadeQuota: 10, englishPerDecade: 5, nonEnglishPerDecade: 5, familiarityQuotasByDecade: familiarityQuotas, withinCellRanking: ['primaryGenreId ascending (genre rotation)', 'source selectionIndex ascending', 'TMDB ID ascending'] },
    composition, candidates,
  }
  return { ...body, scaleManifestHash: `sha256:${stableHash(body)}` }
}

async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }

export async function loadAndBuildScale50({ pipelineRoot = resolve('catalogue-pipeline') } = {}) {
  const sourceRoot = resolve(pipelineRoot, 'generated/catalogue-expansion', SOURCE_BATCH_ID)
  const [manifest, report] = await Promise.all([readFile(resolve(sourceRoot, 'candidate-manifest.json'), 'utf8').then(JSON.parse), readFile(resolve(sourceRoot, 'expansion-readiness-report.v1.json'), 'utf8').then(JSON.parse)])
  return buildScale50Manifest(manifest, report)
}

async function main() {
  const manifest = await loadAndBuildScale50()
  if (process.argv.includes('--write-frozen-manifest')) await writeJson(resolve('catalogue-pipeline/generated/catalogue-expansion', SCALE_50_BATCH_ID, 'candidate-manifest.json'), manifest)
  console.log(JSON.stringify(manifest, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
