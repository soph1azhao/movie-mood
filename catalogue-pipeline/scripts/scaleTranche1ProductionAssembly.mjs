import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { suggestLocalId } from '../../scripts/curateCore.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence, validatePaletteArtifact, validatePromotionCandidate } from './validatePromotionContract.mjs'
import { validatePromotionAuthorizationV2, validatePromotionAuthorizationV2Freshness, GOVERNANCE_ARTIFACT_HASH_V2, GOVERNANCE_VERSION_V2 } from './validatePromotionAuthorizationV2.mjs'
import { validateProductionRecordV2 } from './validateProductionRecordV2.mjs'
import { PALETTE_ALGORITHM_VERSION, POSTER_RENDITION, MIN_COLOR_DISTANCE, resolveTmdbPosterUrl, rgbDistance, paletteFromPoster } from './paletteAlgorithmV1.mjs'
import { PALETTE_ALGORITHM_VERSION_V11, paletteFromPosterV11 } from './paletteAlgorithmV11.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TRANCHE = path.join(REPO, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1')
const OUTPUT = path.join(TRANCHE, 'production-assembly-v1')
const OUTPUT_V11 = path.join(TRANCHE, 'production-assembly-v1_1')
const CACHE = path.join(TRANCHE, 'poster-cache', POSTER_RENDITION)
const DEFERRED_ID = 'exp100-tmdb-1156593'
const CANARY_SEED = 'movie-mood-v8.2-scale-tranche-1-palette-canary-v1'
const TRANSIENT = new Set([500, 502, 503, 504])
const V11_CORRECTED_IDS = new Set([
  'exp100-tmdb-10377',
  'exp100-tmdb-122857',
  'exp100-tmdb-1989',
  'exp100-tmdb-9349',
  'scale500-tmdb-10403',
  'scale500-tmdb-20533',
  'scale500-tmdb-29702',
  'scale500-tmdb-62204',
])
const V11_NEUTRAL_CONTROL_IDS = new Set([
  'exp100-tmdb-283566',
  'scale500-tmdb-12622',
  'scale500-tmdb-9079',
])
const FIXED_HASHES = Object.freeze({
  targetedClosure: 'sha256:3d3741401098d7dcb1ce25b29414258b75f451b673e78a31e15a18182d0e1bcd',
  editorialClosure: 'sha256:cd21b590d79ac3e179537e313f25f147270638a1f8e995fd1e51b7b198699715',
  supersessionAudit: 'sha256:4f8216f2662a4dfee2815350605dcbe5bfc4d0fef0b8f646b10b786d64bf26ba',
  eligibility: 'sha256:54f522b8aa66ce00a8617fbc0e7a01afc6d3a370deab3c95fb29501dc78f1cc4',
  authorizationValidator: 'sha256:343d5ab82a10bec10d12508a77bffc98b39e599ee954d159ce0c416fc3a7d925',
  authorizationSchema: 'sha256:57df83e865b7515ea938c145c4f45f17f30603bbc0687cc03eacb7eed19c4978',
})

const HISTORICAL_V1_HASHES = Object.freeze({
  ledger: 'sha256:b792d79ceaa85f2f7705a4f6e430d46c8ee4bad9f190a3f6d9aedd672432f552',
  qa: 'sha256:ee5f24c655726e6f9e85265fd42d31424277aab99d2d76e3b8668281fe4b6381',
  assembly: 'sha256:107d695fb4246a618fa811e66386c6e9580812e29f9ff4031617df66a9bda3cf',
  comparison: 'sha256:903583f4b1e2073e16db30f6ed8bce6d205f95843fcedf83a7e32f32180b7604',
})

const V1_RUN = Object.freeze({
  algorithmVersion: PALETTE_ALGORITHM_VERSION,
  paletteFromPoster,
  output: OUTPUT,
  manifestName: 'palette-algorithm.v1.manifest.json',
  ledgerName: 'palette-generation-results.v1.json',
  qaName: 'palette-quality-report.v1.json',
  assemblyName: 'production-assembly.v1.json',
  schemaSuffix: 'v1',
  cacheOnly: false,
})

const V11_RUN = Object.freeze({
  algorithmVersion: PALETTE_ALGORITHM_VERSION_V11,
  paletteFromPoster: paletteFromPosterV11,
  output: OUTPUT_V11,
  manifestName: 'palette-algorithm.v1.1.manifest.json',
  ledgerName: 'palette-generation-results.v1.1.json',
  qaName: 'palette-quality-report.v1.1.json',
  assemblyName: 'production-assembly.v1.1.json',
  dispositionName: 'palette-qa-disposition.v1.1.json',
  schemaSuffix: 'v1.1',
  cacheOnly: true,
})

async function json(relative) { return JSON.parse(await readFile(path.join(REPO, relative), 'utf8')) }
async function rawHash(relative) { return hashBytes(await readFile(path.join(REPO, relative))) }
async function persist(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, serializeArtifactForPersistence(value)); return hashArtifact(value) }
function relative(file) { return path.relative(REPO, file) }
function key(seed, id) { return createHash('sha256').update(`${seed}|${id}`).digest('hex') }

function factFromSnapshot(snapshot, candidate) {
  const fact = snapshot.facts.find((entry) => entry.candidateId === candidate.candidateId && entry.tmdbId === candidate.tmdbId)
  if (!fact) throw new Error(`Missing bound fact: ${candidate.candidateId}`)
  return fact
}

export function chooseCanary(records) {
  return [...records].sort((a, b) => key(CANARY_SEED, a.candidateId).localeCompare(key(CANARY_SEED, b.candidateId)) || a.candidateId.localeCompare(b.candidateId)).slice(0, 8)
}

export function assignStableLocalIds(records, existingIds = new Set()) {
  const bases = records.map((record) => ({ ...record, base: suggestLocalId(record.title, record.year) }))
  const counts = new Map()
  for (const item of bases) counts.set(item.base, (counts.get(item.base) ?? 0) + 1)
  const used = new Set(existingIds)
  return bases.map((item) => {
    let id = item.base
    if (counts.get(item.base) > 1 || used.has(id)) id = `${item.base}-${item.tmdbId}`
    if (used.has(id)) throw new Error(`Unresolvable local ID collision: ${id}`)
    used.add(id)
    return [item.candidateId, id]
  })
}

export async function loadContext() {
  const files = {
    cohort: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json',
    eligibility: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/pre-palette-production-eligibility.v1.json',
    routing: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/routing-manifest.reconciled.v1.json',
    reconciliation: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/verifier-reconciliation.v1.json',
    decisions: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-decisions.completed.v1.json',
    closures: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/targeted-repair-human-closure.v1.json',
    repairs: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/targeted-editorial-repair-results.v1.json',
    audit: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/audit-manifest.reconciled.v1.json',
  }
  const loaded = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await json(file)])))
  loaded.files = files
  return loaded
}

export async function preflight() {
  const checkpoint = {
    targetedClosure: await rawHash('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/targeted-repair-human-closure.v1.json'),
    editorialClosure: await rawHash('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/editorial-closure.v1.json'),
    supersessionAudit: await rawHash('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/production-contract-supersession-audit.v1.json'),
    eligibility: await rawHash('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/pre-palette-production-eligibility.v1.json'),
    authorizationValidator: await rawHash('catalogue-pipeline/scripts/validatePromotionAuthorizationV2.mjs'),
    authorizationSchema: await rawHash('catalogue-pipeline/schemas/promotion-authorization.v2.schema.json'),
  }
  for (const [name, expected] of Object.entries(FIXED_HASHES)) if (checkpoint[name] !== expected) throw new Error(`Frozen checkpoint mismatch: ${name}`)
  const context = await loadContext()
  const clearedEligibility = context.eligibility.records.filter((record) => record.editorialDisposition === 'EDITORIALLY_CLEARED')
  const deferred = context.eligibility.records.filter((record) => record.editorialDisposition === 'DEFERRED_PROVIDER_FAILURE')
  if (clearedEligibility.length !== 99 || deferred.length !== 1 || deferred[0].candidateId !== DEFERRED_ID) throw new Error('Eligibility accounting mismatch.')
  const cohortById = new Map(context.cohort.records.map((record) => [record.candidateId, record]))
  const snapshotCache = new Map()
  const records = []
  for (const eligibility of clearedEligibility) {
    const candidate = cohortById.get(eligibility.candidateId)
    if (!candidate || candidate.tmdbId !== eligibility.tmdbId) throw new Error(`Cohort identity mismatch: ${eligibility.candidateId}`)
    const snapshotPath = candidate.sourceBindings.factsRecord.path
    if (!snapshotCache.has(snapshotPath)) snapshotCache.set(snapshotPath, await json(snapshotPath))
    const fact = factFromSnapshot(snapshotCache.get(snapshotPath), candidate)
    if (!fact.posterPath) throw new Error(`Missing posterPath: ${candidate.candidateId}`)
    if (hashArtifact(fact) !== candidate.sourceBindings.factsRecord.artifactHash) throw new Error(`Facts hash mismatch: ${candidate.candidateId}`)
    records.push({ ...candidate, eligibility, fact, posterUrl: resolveTmdbPosterUrl(fact.posterPath) })
  }
  if (new Set(records.map((r) => r.candidateId)).size !== 99 || new Set(records.map((r) => r.tmdbId)).size !== 99) throw new Error('Duplicate candidate or TMDB identity.')
  if (records.some((r) => r.candidateId === DEFERRED_ID)) throw new Error('Deferred candidate entered cleared cohort.')
  return { checkpoint, context, records }
}

async function cachedDownload(record) {
  const imagePath = path.join(CACHE, `${record.candidateId}.poster`)
  const requestPath = path.join(CACHE, `${record.candidateId}.request.json`)
  const responsePath = path.join(CACHE, `${record.candidateId}.response.json`)
  try {
    const [request, response, bytes] = await Promise.all([JSON.parse(await readFile(requestPath, 'utf8')), JSON.parse(await readFile(responsePath, 'utf8')), readFile(imagePath)])
    const expected = { candidateId: record.candidateId, tmdbId: record.tmdbId, posterPath: record.fact.posterPath, resolvedPosterUrl: record.posterUrl, rendition: POSTER_RENDITION }
    if (JSON.stringify(request) === JSON.stringify(expected) && response.httpStatus === 200 && response.rawSha256 === hashBytes(bytes)) return { bytes, response, networkCalls: 0, retries: 0 }
  } catch { }
  return null
}

async function downloadPoster(record, { cacheOnly = false } = {}) {
  const cached = await cachedDownload(record)
  if (cached) return cached
  if (cacheOnly) throw new Error(`Required cached poster is unavailable or stale: ${record.candidateId}`)
  await mkdir(CACHE, { recursive: true })
  const request = { candidateId: record.candidateId, tmdbId: record.tmdbId, posterPath: record.fact.posterPath, resolvedPosterUrl: record.posterUrl, rendition: POSTER_RENDITION }
  const requestPath = path.join(CACHE, `${record.candidateId}.request.json`)
  const responsePath = path.join(CACHE, `${record.candidateId}.response.json`)
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`)
  let networkCalls = 0
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response
    try {
      response = await fetch(record.posterUrl, {
        headers: { Accept: 'image/jpeg' },
      })
      networkCalls += 1
    } catch (error) {
      await writeFile(responsePath, `${JSON.stringify({ ...request, attempt, terminalState: 'AMBIGUOUS_TRANSPORT', error: String(error) }, null, 2)}\n`)
      throw new Error(`Ambiguous poster transport for ${record.candidateId}`)
    }
    const contentType = response.headers.get('content-type')
    const bytes = Buffer.from(await response.arrayBuffer())
    const metadata = { ...request, attempt, httpStatus: response.status, contentType, rawByteLength: bytes.length, rawSha256: hashBytes(bytes) }
    await writeFile(responsePath, `${JSON.stringify(metadata, null, 2)}\n`)
    if (response.status === 200) {
      const supportedPosterTypes = new Set([
        'image/jpeg',
        'image/webp',
      ])

      const normalizedContentType = contentType
        ?.toLowerCase()
        .split(';', 1)[0]
        .trim()

      if (!normalizedContentType || !supportedPosterTypes.has(normalizedContentType)) {
        throw new Error(
          `Unsupported poster content-type for ${record.candidateId}: ${contentType}`,
        )
      }
      await writeFile(path.join(CACHE, `${record.candidateId}.poster`), bytes)
      return { bytes, response: metadata, networkCalls, retries: attempt - 1 }
    }
    if (response.status === 429) throw new Error(`HTTP 429 for ${record.candidateId}`)
    if ([404, 410].includes(response.status)) return { bytes: null, response: metadata, networkCalls, retries: 0 }
    if (!(TRANSIENT.has(response.status) && attempt === 1)) throw new Error(`HTTP ${response.status} for ${record.candidateId}`)
  }
}

async function processPalette(record, run = V1_RUN) {
  const downloaded = await downloadPoster(record, { cacheOnly: run.cacheOnly })
  if (!downloaded.bytes) return { record, ...downloaded, terminalState: 'PALETTE_PENDING' }
  const palette = await run.paletteFromPoster(downloaded.bytes)
  const artifact = { schemaVersion: 'palette-artifact.v1', candidateId: record.candidateId, tmdbId: record.tmdbId, palette, method: 'poster-algorithm', sourcePosterIdentity: { posterPath: record.fact.posterPath }, sourcePosterHash: hashBytes(downloaded.bytes), algorithmVersion: run.algorithmVersion, override: null }
  const validation = validatePaletteArtifact(artifact)
  if (!validation.ok || palette[0] === palette[1] || rgbDistance(palette.map((color) => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]).at(0), palette.map((color) => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]).at(1)) < MIN_COLOR_DISTANCE) throw new Error(`Palette gate failed: ${record.candidateId}`)
  const artifactPath = path.join(run.output, 'palettes', run.algorithmVersion, `${record.candidateId}.json`)
  const artifactHash = await persist(artifactPath, artifact)
  return { record, ...downloaded, artifact, artifactPath: relative(artifactPath), artifactHash, terminalState: 'PALETTE_VALID' }
}

async function processBounded(records, concurrency, run = V1_RUN) {
  const output = []
  for (let i = 0; i < records.length; i += concurrency) output.push(...await Promise.all(records.slice(i, i + concurrency).map((record) => processPalette(record, run))))
  return output
}


function projectFacts(fact) {
  return { tmdbId: fact.tmdbId, title: fact.title, year: fact.year, director: fact.director, countries: fact.countries, spokenLanguages: fact.spokenLanguages, genres: fact.genres, runtimeMinutes: fact.runtimeMinutes, posterPath: fact.posterPath }
}

function finalEditorialCopy(artifact) {
  if (
    artifact?.schemaVersion === 'editorial-artifact.v1.1'
  ) {
    return artifact.output?.copy
  }

  if (
    artifact?.schemaVersion ===
    'editorial-human-directed-repair-artifact.v1'
  ) {
    return artifact.copy
  }

  return undefined
}

export function resolveFinalEditorialBinding(record, context) {
  const routing = context.routing.records.find((entry) => entry.candidateId === record.candidateId)
  if (!routing) throw new Error(`Missing routing record: ${record.candidateId}`)
  const repair = context.repairs.records.find((entry) => entry.candidateId === record.candidateId)
  if (!repair) return { path: routing.finalEditorialArtifactPath, expectedHash: record.eligibility.finalEditorialArtifactHash, source: 'ROUTING' }

  const closure = context.closures.records.find((entry) => entry.candidateId === record.candidateId)
  if (!closure || closure.closureStatus !== 'APPROVED') throw new Error(`Missing approved targeted-repair closure: ${record.candidateId}`)
  if (repair.tmdbId !== record.tmdbId || closure.tmdbId !== record.tmdbId) throw new Error(`Targeted-repair identity mismatch: ${record.candidateId}`)
  if (closure.sourceHashes?.targetedRepairArtifact !== repair.newEditorialArtifactHash) throw new Error(`Targeted-repair closure hash mismatch: ${record.candidateId}`)
  if (record.eligibility.finalEditorialArtifactHash !== repair.newEditorialArtifactHash) throw new Error(`Targeted-repair eligibility hash mismatch: ${record.candidateId}`)
  return { path: repair.newEditorialArtifactPath, expectedHash: repair.newEditorialArtifactHash, source: 'TARGETED_REPAIR' }
}

export async function loadFinalEditorialArtifact(record, context) {
  const binding = resolveFinalEditorialBinding(record, context)
  const value = await json(binding.path)
  const actualHash = hashArtifact(value)
  if (actualHash !== binding.expectedHash) throw new Error(`Final editorial hash mismatch: ${record.candidateId}`)
  return { ...binding, value, actualHash }
}

async function loadBoundRecord(record) {
  const semantic = await json(
    record.sourceBindings.semanticArtifact.path,
  )

  const evidence = await json(
    record.sourceBindings.evidencePacket.path,
  )

  const routing = record.context.routing.records.find(
    (entry) => entry.candidateId === record.candidateId,
  )

  const finalEditorial = await loadFinalEditorialArtifact(
    record,
    record.context,
  )

  const editorial = finalEditorial.value

  for (const [name, value] of [
    ['semanticArtifact', semantic],
    ['evidencePacket', evidence],
  ]) {
    if (
      hashArtifact(value) !==
      record.sourceBindings[name].artifactHash
    ) {
      throw new Error(
        `${name} hash mismatch: ${record.candidateId}`,
      )
    }
  }

  if (
    hashArtifact(editorial) !==
    record.eligibility.finalEditorialArtifactHash
  ) {
    throw new Error(
      `Final editorial hash mismatch: ${record.candidateId}`,
    )
  }

  return {
    semantic,
    evidence,
    routing,
    editorial,
  }
}

async function verifyHistoricalV1Artifacts() {
  const paths = {
    ledger: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/palette-generation-results.v1.json',
    qa: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/palette-quality-report.v1.json',
    assembly: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/production-assembly.v1.json',
    comparison: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/palette-algorithm-v1-v1_1-comparison.json',
  }

  for (const [name, artifactPath] of Object.entries(paths)) {
    if (await rawHash(artifactPath) !== HISTORICAL_V1_HASHES[name]) {
      throw new Error(`Historical v1 artifact changed: ${name}`)
    }
  }

  const ledger = await json(paths.ledger)
  for (const record of ledger.records) {
    const artifact = await json(record.paletteArtifactPath)
    if (hashArtifact(artifact) !== record.paletteArtifactHash) {
      throw new Error(`Historical v1 palette artifact changed: ${record.candidateId}`)
    }
  }

  const assembly = await json(paths.assembly)
  for (const record of assembly.records) {
    for (const [artifactPath, expectedHash, label] of [
      [record.promotionCandidatePath, record.promotionCandidateHash, 'promotion candidate'],
      [record.productionRecordPath, record.productionRecordHash, 'production record'],
      [record.authorizationPath, record.authorizationHash, 'authorization'],
    ]) {
      const artifact = await json(artifactPath)
      if (hashArtifact(artifact) !== expectedHash) {
        throw new Error(`Historical v1 ${label} changed: ${record.candidateId}`)
      }
    }
  }

  const manifest = await json(
    'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/production-assembly-v1/palette-algorithm.v1.manifest.json',
  )
  if (hashArtifact(manifest) !== assembly.sourceHashes.paletteAlgorithmManifest) {
    throw new Error('Historical v1 algorithm manifest changed.')
  }

  return ledger
}

export async function execute(run = V1_RUN) {
  const state = await preflight()
  const historicalV1Ledger = run === V11_RUN
    ? await verifyHistoricalV1Artifacts()
    : null
  const canary = chooseCanary(state.records)
  const canaryResults = await processBounded(canary, 4, run)
  if (canaryResults.length !== 8 || canaryResults.some((result) => result.terminalState !== 'PALETTE_VALID')) throw new Error('Palette canary failed.')
  for (const result of canaryResults) if (JSON.stringify(await run.paletteFromPoster(result.bytes)) !== JSON.stringify(result.artifact.palette)) throw new Error(`Canary nondeterminism: ${result.record.candidateId}`)
  const canaryIds = new Set(canary.map((record) => record.candidateId))
  const remainingResults = await processBounded(state.records.filter((record) => !canaryIds.has(record.candidateId)), 4, run)
  const paletteResults = [...canaryResults, ...remainingResults].sort((a, b) => a.record.candidateId.localeCompare(b.record.candidateId))
  if (paletteResults.length !== 99 || paletteResults.some((result) => result.terminalState !== 'PALETTE_VALID')) throw new Error('Full palette cohort did not reach 99/99.')

  if (run === V11_RUN) {
    const historicalById = new Map(
      historicalV1Ledger.records.map((record) => [record.candidateId, record]),
    )
    const changedIds = new Set()

    for (const result of paletteResults) {
      const historical = historicalById.get(result.record.candidateId)
      if (!historical) throw new Error(`Missing historical v1 palette: ${result.record.candidateId}`)
      const changed = JSON.stringify(historical.palette) !== JSON.stringify(result.artifact.palette)
      if (changed) changedIds.add(result.record.candidateId)

      if (V11_CORRECTED_IDS.has(result.record.candidateId) !== changed) {
        throw new Error(`Unexpected v1.1 palette change state: ${result.record.candidateId}`)
      }
      if (V11_NEUTRAL_CONTROL_IDS.has(result.record.candidateId) && changed) {
        throw new Error(`Neutral control changed under v1.1: ${result.record.candidateId}`)
      }
      if (JSON.stringify(await run.paletteFromPoster(result.bytes)) !== JSON.stringify(result.artifact.palette)) {
        throw new Error(`v1.1 full-cohort nondeterminism: ${result.record.candidateId}`)
      }
    }

    if (changedIds.size !== 8) throw new Error(`Expected exactly 8 v1.1 palette changes, received ${changedIds.size}`)
  }

  const runtimeMappings = await json('src/data/tmdbMovieMappings.json')
  const existingIds = new Set(runtimeMappings.map((entry) => entry.id)); const existingTmdbIds = new Set(runtimeMappings.map((entry) => entry.tmdbId))
  const idMap = new Map(assignStableLocalIds(state.records.map((record) => ({ candidateId: record.candidateId, tmdbId: record.tmdbId, title: record.fact.title, year: record.fact.year })), existingIds))
  if ([...idMap.values()].some((id) => existingIds.has(id)) || state.records.some((r) => existingTmdbIds.has(r.tmdbId))) throw new Error('Runtime identity collision.')

  const algorithmPath = path.join(REPO, run === V11_RUN ? 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs' : 'catalogue-pipeline/scripts/paletteAlgorithmV1.mjs')
  const manifest = {
    schemaVersion: `palette-generation-manifest.${run.schemaSuffix}`, algorithmVersion: run.algorithmVersion,
    decoder: {
      dependency: 'sharp',
      version: '0.35.4',
      supportedInputMediaTypes: ['image/jpeg', 'image/webp'],
    }, fixedImageRendition: POSTER_RENDITION,
    samplingResizing: 'nearest-neighbor center samples on a maximum 64x96 grid', colorSpaceQuantization: 'decoder RGBA converted to deterministic RGB channels quantized to 16-channel steps',
    colorSelectionRule: run === V11_RUN
      ? 'palette-algorithm.v1 selection plus an exact-black-white guard: when chromatic coverage >= 0.25 or best eligible chromatic score share >= 0.20, replace only the non-dominant extreme with the highest-ranked eligible chromatic bin'
      : 'most frequent quantized color plus frequency-and-distance ranked representative; canonical lowercase hex ordered by luminance',
    minimumDistinctness: { metric: 'euclidean-rgb', threshold: MIN_COLOR_DISTANCE, correction: 'farthest observed color, then source-luminance neutral pair' },
    neutralPosterBehavior: 'low-chroma sources remain neutral; no saturated fallback is introduced',
    bindings: { algorithmImplementation: hashBytes(await readFile(algorithmPath)), pnpmLock: hashBytes(await readFile(path.join(REPO, 'pnpm-lock.yaml'))), runtimePosterUrlHelper: hashBytes(await readFile(path.join(REPO, 'src/utils/tmdbImages.ts'))) },
  }
  const manifestPath = path.join(run.output, run.manifestName); await persist(manifestPath, manifest)

  const cohortHash = hashArtifact(state.context.cohort.records.map(({ candidateId, tmdbId }) => ({ candidateId, tmdbId })))
  const targetedById = new Map(state.context.closures.records.map((record) => [record.candidateId, record]))
  const decisionById = new Map(state.context.decisions.records.map((record) => [record.candidateId, record]))
  const reconciliationById = new Map(state.context.reconciliation.records.map((record) => [record.candidateId, record]))
  const productionEntries = []
  for (const paletteResult of paletteResults) {
    const base = paletteResult.record
    base.context = state.context
    const { semantic, evidence, routing, editorial } = await loadBoundRecord(base)
    const promotionCandidate = { schemaVersion: 'promotion-candidate.v1', candidateId: base.candidateId, tmdbId: base.tmdbId, cohortId: 'SCALE_TRANCHE_1', candidateCohortHash: cohortHash, sourceHashes: { semanticArtifact: hashArtifact(semantic), evidencePacket: hashArtifact(evidence), factsRecord: hashArtifact(base.fact) } }
    if (!validatePromotionCandidate(promotionCandidate).ok) throw new Error(`Invalid promotion candidate: ${base.candidateId}`)
    const promotionPath = path.join(run.output, 'promotion-candidates', `${base.candidateId}.json`); const promotionHash = await persist(promotionPath, promotionCandidate)
    const classification = semantic.classification
    const copy = finalEditorialCopy(editorial)

    if (!copy) {
      throw new Error(
        `Unsupported final editorial artifact shape: ${base.candidateId} (${editorial?.schemaVersion ?? 'missing-schema'})`,
      )
    }
    const production = {
      schemaVersion: 'production-record.v2', candidateId: base.candidateId, tmdbId: base.tmdbId,
      curatedMovie: { id: idMap.get(base.candidateId), tmdbId: base.tmdbId, moods: classification.moods, situations: classification.situations, filterLanguages: classification.filterLanguages, pace: classification.pace, emotionalWeight: classification.emotionalWeight, attentionDemand: classification.attentionDemand, discoveryStyle: classification.discoveryStyle, description: copy.description, whyWatch: copy.whyWatch, curiosityHook: copy.curiosityHook, vibeSummary: copy.vibeSummary, palette: paletteResult.artifact.palette },
      facts: projectFacts(base.fact),
      provenance: { promotionCandidateHash: promotionHash, semanticArtifactHash: hashArtifact(semantic), evidencePacketHash: hashArtifact(evidence), factsRecordHash: hashArtifact(base.fact), finalEditorialArtifactHash: hashArtifact(editorial), paletteArtifactHash: paletteResult.artifactHash },
    }
    const validation = validateProductionRecordV2(production, { existingIds, existingTmdbIds, promotionCandidate, semanticArtifact: semantic, evidencePacket: evidence, factsRecord: base.fact, finalEditorialArtifact: editorial, paletteArtifact: paletteResult.artifact })
    if (!validation.ok) throw new Error(`Invalid production record ${base.candidateId}: ${JSON.stringify(validation.hardFailures)}`)
    const productionPath = path.join(run.output, 'production-records', 'v2', `${base.candidateId}.json`); const productionHash = await persist(productionPath, production)

    const targeted = targetedById.get(base.candidateId)
    const decision = decisionById.get(base.candidateId)
    const reconciliation = reconciliationById.get(base.candidateId)
    let riskLayerArtifactHash; let riskLayer; let reviewBasis; let approvalKind; let approvalArtifactHash
    if (targeted) {
      const verifierPath = path.join(TRANCHE, `execution/scale-tranche-1/human-directed-repair-verifiers/${base.candidateId}/output.json`)
      const verifierOutput = JSON.parse(await readFile(verifierPath, 'utf8'))
      riskLayerArtifactHash = hashArtifact(verifierOutput)
      if (riskLayerArtifactHash !== targeted.sourceHashes.postRepairVerifierOutput) throw new Error(`Post-repair verifier hash mismatch: ${base.candidateId}`)
      riskLayer = { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false }
      reviewBasis = 'TARGETED_REPAIR_CLOSURE'; approvalKind = 'TARGETED_REPAIR_HUMAN_CLOSURE'; approvalArtifactHash = hashArtifact(targeted)
    } else {
      riskLayerArtifactHash = hashArtifact(reconciliation)
      if (reconciliation.reconciledValidation === 'UNAVAILABLE') riskLayer = { semanticResult: 'UNAVAILABLE', sourceBoundarySatisfied: false, unresolvedGroundingConflict: false }
      else riskLayer = { semanticResult: reconciliation.reconciledSemanticPayload.riskLevel, sourceBoundarySatisfied: reconciliation.reconciledSemanticPayload.sourceBoundarySatisfied, unresolvedGroundingConflict: reconciliation.reconciledSemanticPayload.issues?.length > 0 }
      if (decision) {
        reviewBasis = reconciliation.reconciledValidation === 'UNAVAILABLE' ? 'VERIFIER_UNAVAILABLE' : 'AUDIT_SAMPLE'
        approvalKind = 'HUMAN_REVIEW_DECISION'; approvalArtifactHash = hashArtifact(decision)
      }
    }
    const human = base.eligibility.futureAuthorizationPath === 'HUMAN_APPROVED_PATH'
    if (human && (!reviewBasis || !approvalArtifactHash)) throw new Error(`Missing human authorization evidence: ${base.candidateId}`)
    const authorization = {
      schemaVersion: 'promotion-authorization.v2', candidateId: base.candidateId, tmdbId: base.tmdbId, governanceVersion: GOVERNANCE_VERSION_V2,
      validationStatus: 'PASS', structuralValidationStatus: 'PASS', provenanceStatus: 'COMPLETE', finalEditorialArtifactStatus: 'VALID', riskRoutingStatus: base.eligibility.routingStatus,
      riskLayer, humanReviewStatus: human ? (targeted ? 'REVISED_APPROVED' : 'APPROVED') : 'NOT_REQUIRED', auditStatus: base.eligibility.auditStatus,
      editorialClosureStatus: 'CLEARED', productionValidationStatus: 'PASS', promotionDisposition: 'ELIGIBLE', authorizationMode: human ? 'HUMAN_APPROVED' : 'RISK_BASED_AUTO_ELIGIBLE',
      ...(human ? { reviewBasis, humanApproval: { approvalArtifactHash, reviewedEditorialArtifactHash: hashArtifact(editorial), approvalKind } } : { humanApproval: null }),
      trancheGate: { severeAuditMissCount: 0, pauseCurrentTranche: false },
      sourceHashes: { governanceArtifact: GOVERNANCE_ARTIFACT_HASH_V2, promotionCandidate: promotionHash, finalEditorialArtifact: hashArtifact(editorial), riskLayerArtifact: riskLayerArtifactHash, productionRecord: productionHash },
    }
    const actualHashes = { ...authorization.sourceHashes }
    const stateValidation = validatePromotionAuthorizationV2(authorization); const freshnessValidation = validatePromotionAuthorizationV2Freshness(authorization, actualHashes)
    if (!stateValidation.ok || !freshnessValidation.ok) throw new Error(`Invalid authorization ${base.candidateId}: ${JSON.stringify([...stateValidation.hardFailures, ...freshnessValidation.hardFailures])}`)
    const authorizationPath = path.join(run.output, 'promotion-authorizations', 'v2', `${base.candidateId}.json`); const authorizationHash = await persist(authorizationPath, authorization)
    productionEntries.push({ candidateId: base.candidateId, tmdbId: base.tmdbId, localId: idMap.get(base.candidateId), promotionCandidatePath: relative(promotionPath), promotionCandidateHash: promotionHash, productionRecordPath: relative(productionPath), productionRecordHash: productionHash, authorizationPath: relative(authorizationPath), authorizationHash, authorizationMode: authorization.authorizationMode, stateValid: true, freshnessValid: true })
  }

  const duplicates = new Map(); for (const result of paletteResults) { const p = result.artifact.palette.join('|'); duplicates.set(p, (duplicates.get(p) ?? 0) + 1) }
  const posterHashes = new Map(); for (const result of paletteResults) { const h = result.artifact.sourcePosterHash; posterHashes.set(h, (posterHashes.get(h) ?? 0) + 1) }
  const qa = { schemaVersion: `palette-quality-report.${run.schemaSuffix}`, cohortSize: 99, algorithmVersion: run.algorithmVersion, invalidHexCount: 0, identicalColorCount: 0, belowDistanceThresholdCount: 0, allBlackAllWhitePathologicalCount: paletteResults.filter((r) => r.artifact.palette.every((c) => ['#000000', '#ffffff'].includes(c))).length, duplicatePosterHashAnomalies: [...posterHashes.entries()].filter(([, count]) => count > 1).map(([hash, count]) => ({ hash, count })), duplicatePaletteFrequency: [...duplicates.entries()].filter(([, count]) => count > 1).map(([palette, count]) => ({ palette: palette.split('|'), count })).sort((a, b) => b.count - a.count || a.palette.join().localeCompare(b.palette.join())), suspiciousPaletteConcentration: Math.max(...duplicates.values()) > 9, algorithmDeterminism: run === V11_RUN ? 'PASS_99_OF_99' : 'PASS' }
  if (run === V11_RUN && (qa.allBlackAllWhitePathologicalCount !== 3 || qa.suspiciousPaletteConcentration)) throw new Error('v1.1 palette QA accounting mismatch.')
  const qaPath = path.join(TRANCHE, run.qaName); const qaHash = await persist(qaPath, qa)
  const networkCalls = paletteResults.reduce((sum, r) => sum + r.networkCalls, 0); const retries = paletteResults.reduce((sum, r) => sum + r.retries, 0)
  const ledger = { schemaVersion: `palette-generation-results.${run.schemaSuffix}`, trancheId: 'SCALE_TRANCHE_1', cohortSize: 99, downloadSuccess: 99, downloadFailure: 0, decodeSuccess: 99, decodeFailure: 0, paletteValid: 99, palettePending: 0, algorithmVersion: run.algorithmVersion, posterRendition: POSTER_RENDITION, canary: { selectionAlgorithm: 'sha256-lexicographic.v1', seed: CANARY_SEED, candidateIds: canary.map((r) => r.candidateId), result: 'PASS_8_OF_8' }, records: paletteResults.map((r) => ({ candidateId: r.record.candidateId, tmdbId: r.record.tmdbId, posterPath: r.record.fact.posterPath, posterHash: r.artifact.sourcePosterHash, paletteArtifactPath: r.artifactPath, paletteArtifactHash: r.artifactHash, palette: r.artifact.palette, terminalState: r.terminalState })), externalCalls: networkCalls, posterRetries: retries, modelCalls: 0, runtimeChanges: 0 }
  if (run === V11_RUN && (networkCalls !== 0 || retries !== 0)) throw new Error('v1.1 execution must be cache-only with zero retries.')
  const ledgerPath = path.join(TRANCHE, run.ledgerName); const ledgerHash = await persist(ledgerPath, ledger)
  let dispositionPath = null
  let dispositionHash = null
  if (run === V11_RUN) {
    const disposition = {
      schemaVersion: 'palette-qa-disposition.v1.1',
      trancheId: 'SCALE_TRANCHE_1',
      disposition: 'ACCEPT_PALETTE_ALGORITHM_V1_1_FOR_PRODUCTION_ASSEMBLY',
      supersession: {
        failedAlgorithmVersion: 'palette-algorithm.v1',
        failedReason: 'Exact black/white selection systematically collapsed eight colorful posters.',
        supersedingAlgorithmVersion: PALETTE_ALGORITHM_VERSION_V11,
        scope: 'future production palette generation',
        historicalV1ArtifactsImmutable: true,
      },
      validation: {
        cohortCount: 99,
        suspectedCollapsesCorrected: 8,
        legitimateNeutralControlsChanged: 0,
        collateralChanges: 0,
        invalidHexCount: qa.invalidHexCount,
        identicalColorCount: qa.identicalColorCount,
        belowDistanceThresholdCount: qa.belowDistanceThresholdCount,
        exactBlackWhiteCount: qa.allBlackAllWhitePathologicalCount,
        deterministicRerun: qa.algorithmDeterminism,
        paletteArtifactsValid: 99,
      },
      sourceHashes: {
        approvedComparison: HISTORICAL_V1_HASHES.comparison,
        historicalV1Ledger: HISTORICAL_V1_HASHES.ledger,
        historicalV1QualityReport: HISTORICAL_V1_HASHES.qa,
        historicalV1Assembly: HISTORICAL_V1_HASHES.assembly,
        v11AlgorithmManifest: hashArtifact(manifest),
        v11PaletteLedger: ledgerHash,
        v11QualityReport: qaHash,
      },
    }
    dispositionPath = path.join(TRANCHE, run.dispositionName)
    dispositionHash = await persist(dispositionPath, disposition)
  }
  const auto = productionEntries.filter((r) => r.authorizationMode === 'RISK_BASED_AUTO_ELIGIBLE').length; const human = productionEntries.length - auto
  const assembly = { schemaVersion: `production-assembly.${run.schemaSuffix}`, trancheId: 'SCALE_TRANCHE_1', trancheSize: 100, editoriallyCleared: 99, deferred: 1, deferredCandidates: [{ candidateId: DEFERRED_ID, tmdbId: 1156593, disposition: 'DEFERRED_PROVIDER_FAILURE' }], paletteValid: 99, palettePending: 0, productionRecordV2Valid: productionEntries.length, productionRecordV2Invalid: 0, authorizationAutoValid: auto, authorizationHumanValid: human, authorizationInvalid: 0, authorizationStateValid: productionEntries.filter((r) => r.stateValid).length, authorizationFreshnessValid: productionEntries.filter((r) => r.freshnessValid).length, promotionEligibleCount: productionEntries.length, runtimeWritten: false, records: productionEntries, sourceHashes: { paletteGenerationResults: ledgerHash, paletteQualityReport: qaHash, paletteAlgorithmManifest: hashArtifact(manifest), ...(dispositionHash ? { paletteQaDisposition: dispositionHash } : {}), prePaletteEligibility: FIXED_HASHES.eligibility } }
  if (auto !== 76 || human !== 23 || productionEntries.length !== 99) throw new Error(`Assembly accounting mismatch: ${auto}/${human}/${productionEntries.length}`)
  const assemblyPath = path.join(TRANCHE, run.assemblyName); const assemblyHash = await persist(assemblyPath, assembly)
  if (run === V11_RUN) await verifyHistoricalV1Artifacts()
  return { checkpoint: state.checkpoint, canaryIds: canary.map((r) => r.candidateId), networkCalls, retries, manifestPath: relative(manifestPath), manifestHash: hashArtifact(manifest), ledgerPath: relative(ledgerPath), ledgerHash, qaPath: relative(qaPath), qaHash, qa, dispositionPath: dispositionPath ? relative(dispositionPath) : null, dispositionHash, assemblyPath: relative(assemblyPath), assemblyHash, assembly }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  const result = mode === '--preflight' ? await preflight() : mode === '--execute' ? await execute(V1_RUN) : mode === '--execute-v1.1' ? await execute(V11_RUN) : (() => { throw new Error('Use --preflight, --execute, or --execute-v1.1.') })()
  console.log(JSON.stringify(mode === '--preflight' ? { checkpoint: result.checkpoint, cleared: result.records.length, posterPaths: result.records.filter((r) => r.fact.posterPath).length, duplicateCandidateIds: result.records.length - new Set(result.records.map((r) => r.candidateId)).size, duplicateTmdbIds: result.records.length - new Set(result.records.map((r) => r.tmdbId)).size, deferredExcluded: !result.records.some((r) => r.candidateId === DEFERRED_ID), canaryIds: chooseCanary(result.records).map((r) => r.candidateId) } : result, null, 2))
}
