import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import {
  TMDB_FACTS_SCHEMA_VERSION,
  TMDB_REQUEST_VERSION,
  fetchTmdbMovie,
  normalizePipelineTmdbFacts,
  redactSecret,
  stableHash,
} from '../adapters/tmdbProvider.ts'
import { validateCandidateBatch, validateMovieFacts, summarizeValidation } from './validateBatch.mjs'

const defaultCacheRoot = resolve('catalogue-pipeline/cache/tmdb', TMDB_REQUEST_VERSION)
const defaultOutputRoot = resolve('catalogue-pipeline/generated/tmdbFacts')

export class TmdbEnrichmentError extends Error {
  constructor(message, { code = 'TMDB_ENRICHMENT_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'TmdbEnrichmentError'
    this.code = code
    this.details = details
  }
}

async function pathExists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJsonIfChanged(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  let previous = null

  try {
    previous = await readFile(path, 'utf8')
  } catch {
    previous = null
  }

  if (previous === serialized) {
    return false
  }

  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`

  try {
    await writeFile(tempPath, serialized)
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }

  return true
}

function assertNoCandidateCollisions(batch, existingMappings = mappings) {
  const mappedTmdbIds = new Map()
  for (const mapping of existingMappings) {
    if (Number.isInteger(mapping.tmdbId)) {
      mappedTmdbIds.set(mapping.tmdbId, mapping.id)
    }
  }

  const collisions = []
  for (const candidate of batch.candidates ?? []) {
    if (mappedTmdbIds.has(candidate.tmdbId)) {
      collisions.push({
        candidateId: candidate.candidateId,
        tmdbId: candidate.tmdbId,
        existingMovieId: mappedTmdbIds.get(candidate.tmdbId),
      })
    }
  }

  if (collisions.length > 0) {
    throw new TmdbEnrichmentError('Candidate batch collides with existing production TMDB mappings.', {
      code: 'PRODUCTION_TMDB_COLLISION',
      details: { collisions },
    })
  }
}

function cachePathFor(cacheRoot, tmdbId) {
  return resolve(cacheRoot, `${tmdbId}.json`)
}

async function readOrFetchTmdbResponse({
  tmdbId,
  token,
  cacheRoot = defaultCacheRoot,
  fetchFn,
  delayFn,
  readJsonFile = readJson,
  writeJsonFile = writeJsonIfChanged,
  fileExists = pathExists,
  maxAttempts,
}) {
  const cachePath = cachePathFor(cacheRoot, tmdbId)

  if (await fileExists(cachePath)) {
    return {
      response: await readJsonFile(cachePath),
      cacheHit: true,
      cachePath,
    }
  }

  const response = await fetchTmdbMovie({ tmdbId, token, fetchFn, delayFn, maxAttempts })
  await writeJsonFile(cachePath, {
    requestVersion: TMDB_REQUEST_VERSION,
    tmdbId,
    response,
  })

  return { response, cacheHit: false, cachePath }
}

export async function enrichTmdbCandidates({
  batch,
  token,
  existingMappings = mappings,
  cacheRoot = defaultCacheRoot,
  outputPath,
  fetchedAt = new Date().toISOString(),
  fetchFn,
  delayFn,
  readJsonFile = readJson,
  writeJsonFile = writeJsonIfChanged,
  fileExists = pathExists,
  maxAttempts = 3,
}) {
  const validation = validateCandidateBatch(batch)
  if (!validation.ok) {
    throw new TmdbEnrichmentError('Candidate batch failed validation.', {
      code: 'INVALID_CANDIDATE_BATCH',
      details: validation,
    })
  }

  assertNoCandidateCollisions(batch, existingMappings)

  const cacheEvents = []
  const facts = []

  for (const candidate of batch.candidates) {
    const { response: cachedPayload, cacheHit, cachePath } = await readOrFetchTmdbResponse({
      tmdbId: candidate.tmdbId,
      token,
      cacheRoot,
      fetchFn,
      delayFn,
      readJsonFile,
      writeJsonFile,
      fileExists,
      maxAttempts,
    })
    const response = cachedPayload?.response ?? cachedPayload
    const normalizedFacts = normalizePipelineTmdbFacts(response, candidate.tmdbId, { fetchedAt })
    facts.push({
      candidateId: candidate.candidateId,
      candidateTitle: candidate.title,
      candidateYear: candidate.year,
      ...normalizedFacts,
    })
    cacheEvents.push({ tmdbId: candidate.tmdbId, cacheHit, cachePath })
  }

  const factsValidation = summarizeValidation(facts.map((item) => validateMovieFacts(item)))
  const artifact = {
    schemaVersion: TMDB_FACTS_SCHEMA_VERSION,
    batchId: batch.batchId,
    requestVersion: TMDB_REQUEST_VERSION,
    generatedAt: fetchedAt,
    cacheKey: stableHash({
      schemaVersion: TMDB_FACTS_SCHEMA_VERSION,
      requestVersion: TMDB_REQUEST_VERSION,
      batchId: batch.batchId,
      tmdbIds: batch.candidates.map((candidate) => candidate.tmdbId),
      factsHashes: facts.map((item) => item.factsHash),
    }),
    facts,
    validation: factsValidation,
  }

  const targetPath = outputPath ?? resolve(defaultOutputRoot, `${batch.batchId}.json`)
  const wroteArtifact = await writeJsonFile(targetPath, artifact)

  return {
    artifact,
    outputPath: targetPath,
    wroteArtifact,
    fetchCount: cacheEvents.filter((event) => !event.cacheHit).length,
    cacheHits: cacheEvents.filter((event) => event.cacheHit).length,
    cacheEvents,
  }
}

function getToken(env = process.env) {
  const token = env.TMDB_READ_ACCESS_TOKEN
  if (!token) {
    throw new TmdbEnrichmentError('TMDB_READ_ACCESS_TOKEN is missing.', { code: 'MISSING_TMDB_TOKEN' })
  }
  return token
}

async function main() {
  const candidatePath = process.argv[2]
  if (!candidatePath) {
    throw new TmdbEnrichmentError('Usage: node catalogue-pipeline/scripts/enrichTmdb.mjs <candidate-batch.json>', {
      code: 'MISSING_CANDIDATE_PATH',
    })
  }

  const token = getToken()
  const batch = await readJson(resolve(candidatePath))
  const result = await enrichTmdbCandidates({ batch, token })
  console.log(`TMDB facts ${result.wroteArtifact ? 'written' : 'unchanged'}: ${result.outputPath}`)
  console.log(`Fetches: ${result.fetchCount}; cache hits: ${result.cacheHits}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redactSecret(error.message, process.env.TMDB_READ_ACCESS_TOKEN))
    process.exitCode = 1
  })
}
