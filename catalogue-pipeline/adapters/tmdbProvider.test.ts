import { describe, expect, it, vi } from 'vitest'
import { enrichTmdbCandidates, TmdbEnrichmentError } from '../scripts/enrichTmdb.mjs'
import {
  buildTmdbMovieUrl,
  fetchTmdbMovie,
  normalizePipelineTmdbFacts,
  redactSecret,
} from './tmdbProvider.ts'

const tmdbResponse = {
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-31',
  runtime: 136,
  overview: 'A computer hacker learns that reality is not what it seems.',
  poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
  production_countries: [{ name: 'United States of America' }],
  spoken_languages: [{ english_name: 'English' }],
  genres: [{ name: 'Action' }, { name: 'Science Fiction' }],
  credits: {
    crew: [{ job: 'Director', name: 'Lana Wachowski' }, { job: 'Director', name: 'Lilly Wachowski' }],
  },
  keywords: {
    keywords: [{ name: 'artificial reality' }, { name: 'dystopia' }, { name: 'artificial reality' }],
  },
}

const candidateBatch = {
  schemaVersion: 'candidate.v1',
  batchId: 'pilot-001',
  sourcePolicy: {
    description: 'Maintainer-selected TMDB candidates for an offline pipeline test.',
    licensingNotes: [],
  },
  candidates: [{
    candidateId: 'matrix-1999',
    title: 'The Matrix',
    year: 1999,
    tmdbId: 603,
    sourceTags: ['catalogue-scale-test'],
    inclusionRationale: 'Known film used only for deterministic pipeline validation.',
  }],
}

function jsonResponse(body: unknown, { status = 200, headers = new Headers() } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  } as Response
}

function createMemoryJsonStore() {
  const files = new Map<string, unknown>()
  const writes: Array<{ path: string; value: unknown }> = []

  return {
    files,
    writes,
    readJsonFile: async (path: string) => files.get(path),
    writeJsonFile: async (path: string, value: unknown) => {
      const next = JSON.stringify(value, null, 2)
      const previous = files.has(path) ? JSON.stringify(files.get(path), null, 2) : null
      if (previous === next) return false
      files.set(path, value)
      writes.push({ path, value })
      return true
    },
    fileExists: async (path: string) => files.has(path),
  }
}

describe('TMDB offline provider', () => {
  it('requests credits and keywords for pipeline evidence materialization', () => {
    const url = new URL(buildTmdbMovieUrl(603))

    expect(url.searchParams.get('append_to_response')).toBe('credits,keywords')
  })

  it('normalizes TMDB responses into pipeline facts while separating poster availability', () => {
    const facts = normalizePipelineTmdbFacts(tmdbResponse, 603, { fetchedAt: '2026-08-31T00:00:00.000Z' })

    expect(facts).toMatchObject({
      schemaVersion: 'tmdb-facts.v1',
      requestVersion: 'tmdb-movie-details.v2',
      tmdbId: 603,
      title: 'The Matrix',
      year: 1999,
      director: 'Lana Wachowski & Lilly Wachowski',
      overview: 'A computer hacker learns that reality is not what it seems.',
      keywords: ['artificial reality', 'dystopia'],
      posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      posterAvailability: {
        available: true,
        path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
        imageUrl: 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      },
      dataQualityFlags: [],
    })
    expect(facts.factsHash).toHaveLength(64)
  })

  it('retries transient TMDB failures with bounded attempts', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(tmdbResponse))
    const delayFn = vi.fn()

    const response = await fetchTmdbMovie({ tmdbId: 603, token: 'secret-token', fetchFn, delayFn, maxAttempts: 3 })

    expect(response).toEqual(tmdbResponse)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledWith(250)
  })

  it('respects Retry-After for 429 responses', async () => {
    const headers = new Headers({ 'retry-after': '2' })
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers }))
      .mockResolvedValueOnce(jsonResponse(tmdbResponse))
    const delayFn = vi.fn()

    await fetchTmdbMovie({ tmdbId: 603, token: 'secret-token', fetchFn, delayFn, maxAttempts: 2 })

    expect(delayFn).toHaveBeenCalledWith(2000)
  })

  it('redacts TMDB credentials from thrown network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom secret-token boom'))

    await expect(fetchTmdbMovie({
      tmdbId: 603,
      token: 'secret-token',
      fetchFn,
      delayFn: async () => {},
      maxAttempts: 1,
    })).rejects.toThrow('boom [redacted] boom')
    expect(redactSecret('secret-token', 'secret-token')).toBe('[redacted]')
  })

  it('stops when candidates collide with existing production TMDB mappings', async () => {
    await expect(enrichTmdbCandidates({
      batch: candidateBatch,
      token: 'secret-token',
      existingMappings: [{ id: 'the-matrix', tmdbId: 603 }],
      fetchFn: vi.fn(),
    })).rejects.toMatchObject({
      code: 'PRODUCTION_TMDB_COLLISION',
      details: {
        collisions: [{ candidateId: 'matrix-1999', tmdbId: 603, existingMovieId: 'the-matrix' }],
      },
    } satisfies Partial<TmdbEnrichmentError>)
  })

  it('allows production TMDB collisions only for explicit calibration workflows', async () => {
    const store = createMemoryJsonStore()
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(tmdbResponse))

    const result = await enrichTmdbCandidates({
      batch: candidateBatch,
      token: 'secret-token',
      existingMappings: [{ id: 'the-matrix', tmdbId: 603 }],
      allowProductionCollisions: true,
      cacheRoot: '/tmp/movie-mood-tmdb-cache',
      outputPath: '/tmp/movie-mood-tmdb-output/pilot-001.json',
      fetchedAt: '2026-08-31T00:00:00.000Z',
      fetchFn,
      readJsonFile: store.readJsonFile,
      writeJsonFile: store.writeJsonFile,
      fileExists: store.fileExists,
    })

    expect(result.fetchCount).toBe(1)
    expect(result.artifact.facts[0].overview).toContain('computer hacker')
  })

  it('is idempotent on unchanged cache and artifact reruns', async () => {
    const store = createMemoryJsonStore()
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(tmdbResponse))
    const options = {
      batch: candidateBatch,
      token: 'secret-token',
      existingMappings: [],
      cacheRoot: '/tmp/movie-mood-tmdb-cache',
      outputPath: '/tmp/movie-mood-tmdb-output/pilot-001.json',
      fetchedAt: '2026-08-31T00:00:00.000Z',
      fetchFn,
      delayFn: async () => {},
      readJsonFile: store.readJsonFile,
      writeJsonFile: store.writeJsonFile,
      fileExists: store.fileExists,
    }

    const first = await enrichTmdbCandidates(options)
    const second = await enrichTmdbCandidates(options)

    expect(first.fetchCount).toBe(1)
    expect(first.wroteArtifact).toBe(true)
    expect(second.fetchCount).toBe(0)
    expect(second.cacheHits).toBe(1)
    expect(second.wroteArtifact).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(second.artifact).toEqual(first.artifact)
  })
})
