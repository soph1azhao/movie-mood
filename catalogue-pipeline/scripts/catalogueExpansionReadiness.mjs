import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { buildReviewQueue } from './buildReviewQueue.mjs'
import { validateCandidateBatch, validateMovieFacts } from './validateBatch.mjs'

export const EXPANSION_BATCH_ID = 'expansion-100-v1'
export const EXPANSION_SCHEMA_VERSION = 'catalogue-expansion-readiness.v1'
export const SELECTION_POLICY_VERSION = 'production-diversity-round-robin.v1'
export const DECADE_QUOTAS = Object.freeze({ '1980s': 20, '1990s': 20, '2000s': 20, '2010s': 20, '2020s': 20 })
export const BAND_QUOTAS = Object.freeze({ mainstream: 7, familiar: 7, discovery: 6 })

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function rawStableHash(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

function withSha256(value) {
  return `sha256:${rawStableHash(value)}`
}

function releaseYear(movie) {
  const value = Number.parseInt(String(movie.release_date ?? '').slice(0, 4), 10)
  return Number.isInteger(value) ? value : null
}

export function decadeFor(year) {
  return `${Math.floor(year / 10) * 10}s`
}

export function popularityBand(movie) {
  if (movie.vote_count >= 1000) return 'mainstream'
  if (movie.vote_count >= 500) return 'familiar'
  return 'discovery'
}

function compareCandidates(first, second) {
  return second.vote_count - first.vote_count || second.vote_average - first.vote_average || first.id - second.id
}

function roundRobin(groups, count, seed, { rankGroupsByBestCandidate = false, maximumGroups = Infinity } = {}) {
  let ordered = [...groups.entries()]
    .map(([key, values]) => [key, [...values].sort(compareCandidates)])
    .sort(([firstKey, firstValues], [secondKey, secondValues]) => rankGroupsByBestCandidate
      ? compareCandidates(firstValues[0], secondValues[0]) || String(firstKey).localeCompare(String(secondKey))
      : String(firstKey).localeCompare(String(secondKey)))
    .slice(0, maximumGroups)
  const offset = Number.parseInt(rawStableHash(seed).slice(0, 8), 16) % ordered.length
  ordered = [...ordered.slice(offset), ...ordered.slice(0, offset)]
  const selected = []
  while (selected.length < count && ordered.some(([, values]) => values.length > 0)) {
    for (const [, values] of ordered) {
      if (values.length === 0) continue
      selected.push(values.shift())
      if (selected.length === count) break
    }
  }
  return selected
}

function selectEnglish(candidates, count, seed) {
  const byGenre = new Map()
  for (const candidate of candidates) {
    const genre = candidate.genre_ids?.[0] ?? 0
    if (!byGenre.has(genre)) byGenre.set(genre, [])
    byGenre.get(genre).push(candidate)
  }
  return roundRobin(byGenre, count, seed)
}

function selectNonEnglish(candidates, count, seed) {
  const byLanguage = new Map()
  for (const candidate of candidates) {
    if (!byLanguage.has(candidate.original_language)) byLanguage.set(candidate.original_language, [])
    byLanguage.get(candidate.original_language).push(candidate)
  }
  return roundRobin(byLanguage, count, seed, { rankGroupsByBestCandidate: true, maximumGroups: 8 })
}

function selectBucket(candidates, count, seed) {
  const englishCount = Math.ceil(count / 2)
  const nonEnglishCount = count - englishCount
  const english = selectEnglish(candidates.filter((candidate) => candidate.original_language === 'en'), englishCount, `${seed}:english`)
  const nonEnglish = selectNonEnglish(candidates.filter((candidate) => candidate.original_language !== 'en'), nonEnglishCount, `${seed}:non-english`)
  if (english.length !== englishCount || nonEnglish.length !== nonEnglishCount) throw new Error('Discovery pool cannot satisfy the frozen production diversity allocation.')
  return english.flatMap((candidate, index) => nonEnglish[index] ? [candidate, nonEnglish[index]] : [candidate])
}

export function collectDiscoveryPool(sourceSnapshot, existingMappings = mappings) {
  const existingIds = new Set(existingMappings.map((entry) => entry.tmdbId))
  const byTmdbId = new Map()
  for (const corpusEntry of sourceSnapshot.rawResponseCorpus ?? []) {
    for (const movie of corpusEntry.response?.results ?? []) {
      const current = byTmdbId.get(movie.id)
      if (!current || compareCandidates(movie, current) < 0) byTmdbId.set(movie.id, { ...movie, sourceCellIds: [corpusEntry.cellId] })
      else if (!current.sourceCellIds.includes(corpusEntry.cellId)) current.sourceCellIds.push(corpusEntry.cellId)
    }
  }
  return [...byTmdbId.values()].filter((movie) => {
    const year = releaseYear(movie)
    return !existingIds.has(movie.id) && movie.adult !== true && movie.softcore !== true && Boolean(movie.poster_path) &&
      typeof movie.overview === 'string' && movie.overview.trim().length >= 30 && Number.isInteger(year) &&
      Object.hasOwn(DECADE_QUOTAS, decadeFor(year)) && movie.vote_count >= 200
  })
}

export function createExpansionCandidateManifest({ sourceSnapshot, existingMappings = mappings, factualStatusByTmdbId = new Map() }) {
  const pool = collectDiscoveryPool(sourceSnapshot, existingMappings)
  const selected = []
  for (const [decade, decadeCount] of Object.entries(DECADE_QUOTAS)) {
    let selectedForDecade = 0
    for (const [band, count] of Object.entries(BAND_QUOTAS)) {
      const bucket = pool.filter((movie) => decadeFor(releaseYear(movie)) === decade && popularityBand(movie) === band)
      const choices = selectBucket(bucket, count, `${decade}:${band}`)
      choices.forEach((movie, bucketIndex) => selected.push({ movie, decade, band, bucketIndex }))
      selectedForDecade += choices.length
    }
    if (selectedForDecade !== decadeCount) throw new Error(`Selection failed for ${decade}: ${selectedForDecade}/${decadeCount}.`)
  }

  const sourceSnapshotHash = sourceSnapshot.sourceSnapshotHash ?? withSha256(sourceSnapshot)
  const candidates = selected.map(({ movie, decade, band, bucketIndex }, selectionIndex) => ({
    candidateId: `exp100-tmdb-${movie.id}`,
    tmdbId: movie.id,
    title: movie.title,
    year: releaseYear(movie),
    sourceTags: ['tmdb-discover-offline-snapshot', decade, band, movie.original_language === 'en' ? 'english-language' : 'non-english-language'],
    inclusionRationale: `Fills the ${decade} / ${band} production-diversity allocation using deterministic language and genre rotation.`,
    knownRisks: [],
    sourceRankingProvenance: {
      source: 'frozen-local-tmdb-discover-response-corpus',
      sourceSnapshotHash,
      sourceCellIds: [...movie.sourceCellIds].sort(),
      selectionPolicyVersion: SELECTION_POLICY_VERSION,
      selectionIndex,
      bucketIndex,
      originalLanguage: movie.original_language,
      primaryGenreId: movie.genre_ids?.[0] ?? null,
      voteCount: movie.vote_count,
      voteAverage: movie.vote_average,
      popularity: movie.popularity,
    },
    factualSnapshotStatus: factualStatusByTmdbId.get(movie.id) ?? 'PENDING',
    duplicateExistingCatalogueStatus: 'NOT_PRESENT',
  }))
  const body = {
    batchId: EXPANSION_BATCH_ID,
    schemaVersion: 'candidate.v1',
    artifactSchemaVersion: 'catalogue-expansion-candidate-manifest.v1',
    sourcePolicy: {
      description: 'Production-oriented 100-film cohort: 20 per decade, fixed familiarity bands, balanced English/non-English selection, and deterministic genre/language rotation.',
      licensingNotes: ['TMDB discovery metadata and identifiers are used for maintainer-side catalogue preparation.'],
      selectionPolicyVersion: SELECTION_POLICY_VERSION,
      decadeQuotas: DECADE_QUOTAS,
      familiarityBandQuotasPerDecade: BAND_QUOTAS,
      minimumVoteCount: 200,
      existingProductionTmdbIdsExcluded: true,
      overviewAndPosterRequiredAtSelection: true,
    },
    sourceSnapshotHash,
    candidates,
  }
  const validation = validateCandidateBatch(body)
  if (!validation.ok || candidates.length !== 100) throw new Error(`Generated candidate manifest is invalid: ${JSON.stringify(validation.hardFailures)}`)
  return { ...body, candidateManifestHash: withSha256(body) }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function buildCostProjection(pilotManifest, scales = [25, 50, 100, 250, 1000]) {
  const completedStates = Object.values(pilotManifest.states ?? {}).filter((state) => state.status === 'COMPLETED' && state.providerUsageMetadata)
  const observed = {
    completedFilms: pilotManifest.counts?.completed ?? completedStates.length,
    successfulProviderRequests: pilotManifest.usage?.successfulModelRequests ?? 0,
    retries: pilotManifest.usage?.retries ?? 0,
    inputTokens: pilotManifest.usage?.inputTokens ?? 0,
    outputTokens: pilotManifest.usage?.outputTokens ?? 0,
    thinkingTokens: pilotManifest.usage?.thinkingTokens ?? 0,
    terminalFailures: pilotManifest.counts?.failedTerminal ?? 0,
  }
  const fields = { inputTokens: 'promptTokenCount', outputTokens: 'candidatesTokenCount', thinkingTokens: 'thoughtsTokenCount', totalTokens: 'totalTokenCount' }
  const perFilm = {}
  for (const [outputField, sourceField] of Object.entries(fields)) {
    const values = completedStates.map((state) => state.providerUsageMetadata[sourceField]).filter(Number.isFinite)
    const observedTotal = outputField === 'totalTokens' ? values.reduce((sum, value) => sum + value, 0) : observed[outputField]
    perFilm[outputField] = { average: observedTotal / observed.completedFilms, median: median(values), min: Math.min(...values), max: Math.max(...values) }
  }
  return {
    baselineRunId: pilotManifest.runId,
    provider: pilotManifest.providerId,
    model: pilotManifest.modelId,
    observed,
    perCompletedFilm: perFilm,
    reliability: {
      requestsPerCompletedFilm: observed.successfulProviderRequests / observed.completedFilms,
      observedRetryFractionOfRequests: observed.retries / observed.successfulProviderRequests,
      observedRetriesPerCompletedFilm: observed.retries / observed.completedFilms,
      observedTerminalFailureFraction: observed.terminalFailures / observed.completedFilms,
      interpretation: 'Descriptive planning evidence from 12 completed films; not a precise 1,000-film reliability estimate.',
    },
    projections: Object.fromEntries(scales.map((count) => [String(count), {
      films: count,
      inputTokens: Math.round(perFilm.inputTokens.average * count),
      outputTokens: Math.round(perFilm.outputTokens.average * count),
      thinkingTokens: Math.round(perFilm.thinkingTokens.average * count),
      totalTokens: Math.round(perFilm.totalTokens.average * count),
      providerRequests: Math.ceil((observed.successfulProviderRequests / observed.completedFilms) * count),
      retries: Math.round((observed.retries / observed.completedFilms) * count),
    }])),
    dollarProjection: { calculated: false, reason: 'Token projections are kept independent from changeable provider pricing.' },
  }
}

function aggregateBy(records, keyFn) {
  const result = {}
  for (const record of records) {
    const key = keyFn(record) || 'unknown'
    result[key] ??= { total: 0, automaticallyReady: 0, needsTargetedReview: 0, blocked: 0 }
    result[key].total += 1
    if (record.readiness === 'AUTOMATICALLY_READY') result[key].automaticallyReady += 1
    else if (record.readiness === 'NEEDS_TARGETED_REVIEW') result[key].needsTargetedReview += 1
    else result[key].blocked += 1
  }
  return result
}

export function buildExpansionReadiness({ manifest, factsArtifact, pilotManifest }) {
  const factsByTmdbId = new Map((factsArtifact.facts ?? []).map((facts) => [facts.tmdbId, facts]))
  const packets = []
  const records = []
  for (const candidate of manifest.candidates) {
    const facts = factsByTmdbId.get(candidate.tmdbId)
    const factualValidation = facts ? validateMovieFacts(facts) : { ok: false, hardFailures: [{ severity: 'hard_fail', code: 'MISSING_FACTUAL_SNAPSHOT', field: 'facts', message: 'No TMDB factual snapshot exists.' }], reviewFlags: [] }
    let packet = null
    let groundingFlags = []
    if (facts && factualValidation.ok) ({ packet, reviewFlags: groundingFlags } = buildEvidencePacket({ candidateId: candidate.candidateId, facts, tmdbOverview: facts.overview, keywordAssessment: { useful: false, selected: [] } }))
    const reviewFlags = [...(factualValidation.reviewFlags ?? []), ...groundingFlags]
    const hardFailures = factualValidation.hardFailures ?? []
    const readiness = hardFailures.length > 0 ? 'BLOCKED' : reviewFlags.length > 0 ? 'NEEDS_TARGETED_REVIEW' : 'AUTOMATICALLY_READY'
    if (packet) packets.push(packet)
    records.push({
      candidateId: candidate.candidateId,
      tmdbId: candidate.tmdbId,
      title: facts?.title ?? candidate.title,
      decade: decadeFor(candidate.year),
      primaryGenre: facts?.genres?.[0] ?? 'unknown',
      originalLanguage: candidate.sourceRankingProvenance.originalLanguage,
      languageGroup: candidate.sourceRankingProvenance.originalLanguage === 'en' ? 'English' : 'Non-English',
      popularityBand: candidate.sourceRankingProvenance ? candidate.sourceTags.find((tag) => Object.hasOwn(BAND_QUOTAS, tag)) : 'unknown',
      factualSnapshotStatus: hardFailures.length === 0 ? 'COMPLETE' : 'BLOCKED',
      evidencePacketStatus: packet ? 'COMPLETE' : 'BLOCKED',
      hasUsableOverview: Boolean(packet?.facts.overview),
      availableTmdbKeywordCount: facts?.keywords?.length ?? 0,
      includedKeywordCount: packet?.facts.keywords.length ?? 0,
      keywordSelectionPolicy: 'overview-first-no-automatic-keywords.v1',
      groundingSources: packet?.sourceProvenance.map((source) => source.source) ?? [],
      insufficientGrounding: groundingFlags.some((flag) => flag.code === 'INSUFFICIENT_GROUNDING'),
      evidencePacketHash: packet?.inputHash ?? null,
      reviewFlags,
      hardFailures,
      readiness,
    })
  }
  const reviewQueue = buildReviewQueue({
    batchId: manifest.batchId,
    candidates: records.map((record) => ({ ...record, validationResults: [{ hardFailures: record.hardFailures, reviewFlags: record.reviewFlags }], facts: factsByTmdbId.get(record.tmdbId) ?? null })),
  })
  const counts = {
    totalCandidates: records.length,
    factualSnapshotComplete: records.filter((record) => record.factualSnapshotStatus === 'COMPLETE').length,
    evidencePacketComplete: records.filter((record) => record.evidencePacketStatus === 'COMPLETE').length,
    usableOverview: records.filter((record) => record.hasUsableOverview).length,
    usableKeywords: records.filter((record) => record.includedKeywordCount > 0).length,
    insufficientGrounding: records.filter((record) => record.insufficientGrounding).length,
    duplicateOrExcluded: manifest.candidates.filter((candidate) => candidate.duplicateExistingCatalogueStatus !== 'NOT_PRESENT').length,
    automaticallyReady: records.filter((record) => record.readiness === 'AUTOMATICALLY_READY').length,
    needsTargetedReview: records.filter((record) => record.readiness === 'NEEDS_TARGETED_REVIEW').length,
    hardBlocked: records.filter((record) => record.readiness === 'BLOCKED').length,
  }
  const rates = Object.fromEntries(['factualSnapshotComplete', 'evidencePacketComplete', 'usableOverview', 'usableKeywords', 'insufficientGrounding', 'automaticallyReady', 'needsTargetedReview', 'hardBlocked'].map((key) => [key, counts[key] / counts.totalCandidates]))
  const decision = counts.hardBlocked === 0 && counts.automaticallyReady >= 95 ? 'READY_FOR_50' : counts.hardBlocked <= 2 && counts.automaticallyReady >= 80 ? 'READY_FOR_25' : counts.insufficientGrounding > 20 ? 'NEEDS_GROUNDING_REDESIGN' : 'NEEDS_CANDIDATE_PIPELINE_REDESIGN'
  const reportBody = {
    schemaVersion: EXPANSION_SCHEMA_VERSION,
    batchId: manifest.batchId,
    candidateManifestHash: manifest.candidateManifestHash,
    factualSnapshotHash: withSha256(factsArtifact),
    evidencePolicy: { mode: 'overview-first', version: 'overview-first-no-automatic-keywords.v1', automaticKeywordUse: false },
    counts,
    rates,
    breakdowns: {
      decade: aggregateBy(records, (record) => record.decade),
      primaryGenre: aggregateBy(records, (record) => record.primaryGenre),
      languageGroup: aggregateBy(records, (record) => record.languageGroup),
      originalLanguage: aggregateBy(records, (record) => record.originalLanguage),
      popularityBand: aggregateBy(records, (record) => record.popularityBand),
    },
    records,
    costProjection: buildCostProjection(pilotManifest),
    scaleDecision: decision,
  }
  return { packets, reviewQueue, report: { ...reportBody, reportHash: withSha256(reportBody) } }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function writeReadinessArtifacts({ outputRoot, manifest, factsArtifact, pilotManifest }) {
  const result = buildExpansionReadiness({ manifest, factsArtifact, pilotManifest })
  const finalManifestBody = { ...manifest, candidates: manifest.candidates.map((candidate) => ({ ...candidate, factualSnapshotStatus: result.report.records.find((record) => record.tmdbId === candidate.tmdbId).factualSnapshotStatus })) }
  delete finalManifestBody.candidateManifestHash
  const finalManifest = { ...finalManifestBody, candidateManifestHash: withSha256(finalManifestBody) }
  result.report.candidateManifestHash = finalManifest.candidateManifestHash
  const reportWithoutHash = { ...result.report }; delete reportWithoutHash.reportHash
  result.report.reportHash = withSha256(reportWithoutHash)
  await writeJson(resolve(outputRoot, 'candidate-manifest.json'), finalManifest)
  await writeJson(resolve(outputRoot, 'factual-snapshot.json'), factsArtifact)
  for (const packet of result.packets) await writeJson(resolve(outputRoot, 'evidence-packets', `${packet.candidateId}.json`), packet)
  await writeJson(resolve(outputRoot, 'review-queue.v1.json'), result.reviewQueue)
  await writeJson(resolve(outputRoot, 'expansion-readiness-report.v1.json'), result.report)
  return { ...result, manifest: finalManifest }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'select' && args.length === 2) {
    const manifest = createExpansionCandidateManifest({ sourceSnapshot: await readJson(resolve(args[0])) })
    await writeJson(resolve(args[1]), manifest)
    console.log(`Selected ${manifest.candidates.length} candidates: ${manifest.candidateManifestHash}`)
    return
  }
  if (command === 'build' && args.length === 4) {
    const [manifestPath, factsPath, pilotPath, outputRoot] = args
    const result = await writeReadinessArtifacts({ outputRoot: resolve(outputRoot), manifest: await readJson(resolve(manifestPath)), factsArtifact: await readJson(resolve(factsPath)), pilotManifest: await readJson(resolve(pilotPath)) })
    console.log(`${result.report.scaleDecision}: ${result.report.counts.automaticallyReady} ready, ${result.report.counts.needsTargetedReview} review, ${result.report.counts.hardBlocked} blocked`)
    return
  }
  throw new Error('Usage: catalogueExpansionReadiness.mjs select <source-snapshot.json> <candidate-manifest.json> | build <candidate-manifest.json> <facts.json> <pilot-manifest.json> <output-directory>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
