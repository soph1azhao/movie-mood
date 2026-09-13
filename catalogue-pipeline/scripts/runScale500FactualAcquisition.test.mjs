import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  ACQUISITION_AUTHORIZATION_FLAG,
  ACQUISITION_STATES,
  ACQUISITION_TARGET,
  buildAcquisitionPreflight,
  launchScale500FactualAcquisition,
  runScale500FactualAcquisition,
} from './runScale500FactualAcquisition.mjs'
import { ACQUISITION_QUEUE_SCHEMA_VERSION, SCALE_500_BATCH_ID } from './scale500AcquisitionQueue.mjs'
import { stableHash } from '../adapters/tmdbProvider.ts'

// ---- Helpers ----

async function makeRoot(suffix = '') {
  const root = await mkdtemp(join(tmpdir(), `scale500-acquisition-${suffix}-`))
  return root
}

function mockQueueEntry(overrides = {}) {
  const id = overrides.tmdbId ?? 1001
  return {
    candidateId: `scale500-tmdb-${id}`,
    tmdbId: id,
    title: `Film ${id}`,
    year: 1995,
    decade: '1990s',
    band: 'mainstream',
    languageGroup: 'English',
    originalLanguage: 'en',
    primaryGenreId: 18,
    selectionRank: overrides.selectionRank ?? 0,
    reserveTier: overrides.reserveTier ?? 'primary',
    ...overrides,
  }
}

function buildMockQueue(entries, overrides = {}) {
  const body = {
    schemaVersion: ACQUISITION_QUEUE_SCHEMA_VERSION,
    batchId: SCALE_500_BATCH_ID,
    acquisitionTarget: ACQUISITION_TARGET,
    reserveFactor: 1.5,
    sourceSnapshotHash: 'sha256:fixture',
    expansionManifestHash: 'sha256:fixture-expansion',
    primaryExclusions: { productionCatalogueIds: 0, expansion100Members: 0, pilotCalibrationIds: 0 },
    composition: {
      totalQueued: entries.length,
      primaryCandidates: entries.filter((e) => e.reserveTier === 'primary').length,
      reserveCandidates: entries.filter((e) => e.reserveTier === 'reserve').length,
      decadeDistribution: {},
      languageDistribution: { English: entries.length, 'Non-English': 0 },
      familiarityDistribution: {},
    },
    queue: entries,
    ...overrides,
  }
  return { ...body, queueHash: `sha256:${stableHash(body)}` }
}

function validTmdbResponse(tmdbId) {
  return {
    id: tmdbId,
    title: `Film ${tmdbId}`,
    release_date: '1995-06-15',
    original_language: 'en',
    runtime: 120,
    genres: [{ id: 18, name: 'Drama' }],
    production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    spoken_languages: [{ iso_639_1: 'en', name: 'English' }],
    poster_path: `/poster${tmdbId}.jpg`,
    overview: 'A compelling film with a suitably long overview for production use.',
    credits: { crew: [{ job: 'Director', name: 'Director Name', department: 'Directing' }] },
    keywords: { keywords: [{ id: 1, name: 'drama' }] },
    vote_count: 1000,
    vote_average: 7.5,
    adult: false,
  }
}

function okTmdbFetch(tmdbId) {
  return async () => ({ ok: true, status: 200, json: async () => validTmdbResponse(tmdbId), headers: { get: () => null } })
}

function failTmdbFetch(statusCode = 500) {
  return async () => ({ ok: false, status: statusCode, json: async () => ({ status_message: 'Error' }), headers: { get: () => null } })
}

async function writeQueue(root, queue) {
  const queuePath = resolve(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-queue.json')
  await mkdir(resolve(queuePath, '..'), { recursive: true })
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`)
  return queuePath
}

async function writeState(root, state) {
  const statePath = resolve(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json')
  await mkdir(resolve(statePath, '..'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return statePath
}

// ---- Tests ----

describe('buildAcquisitionPreflight', () => {
  it('reports zero ready when no state exists', async () => {
    const root = await makeRoot('preflight-zero')
    try {
      const entry = mockQueueEntry({ tmdbId: 1001 })
      const queue = buildMockQueue([entry])
      await writeQueue(root, queue)
      const preflight = await buildAcquisitionPreflight({ root })
      expect(preflight.readyCount).toBe(0)
      expect(preflight.targetMet).toBe(false)
      expect(preflight.executionAuthorized).toBe(false)
      expect(preflight.totalQueued).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reports correct ready count from persisted state', async () => {
    const root = await makeRoot('preflight-state')
    try {
      const entries = [1, 2, 3].map((n) => mockQueueEntry({ tmdbId: n, selectionRank: n - 1 }))
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      await writeState(root, {
        schemaVersion: 'scale-500-acquisition-state.v1',
        queueHash: queue.queueHash,
        acquisitionTarget: ACQUISITION_TARGET,
        candidates: {
          'scale500-tmdb-1': { candidateId: 'scale500-tmdb-1', tmdbId: 1, status: ACQUISITION_STATES.evidenceComplete },
          'scale500-tmdb-2': { candidateId: 'scale500-tmdb-2', tmdbId: 2, status: ACQUISITION_STATES.factualFailed },
          'scale500-tmdb-3': { candidateId: 'scale500-tmdb-3', tmdbId: 3, status: ACQUISITION_STATES.pending },
        },
      })
      const preflight = await buildAcquisitionPreflight({ root })
      expect(preflight.readyCount).toBe(1)
      expect(preflight.remainingToTarget).toBe(ACQUISITION_TARGET - 1)
      expect(preflight.targetMet).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails if queue file is missing', async () => {
    const root = await makeRoot('preflight-missing')
    try {
      await expect(buildAcquisitionPreflight({ root })).rejects.toMatchObject({ code: 'QUEUE_NOT_FOUND' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('runScale500FactualAcquisition', () => {
  it('requires TMDB token', async () => {
    const root = await makeRoot('missing-token')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      await expect(runScale500FactualAcquisition({ root, token: '', maxFreshCandidates: 1, maxHttpRequests: 1 })).rejects.toMatchObject({ code: 'MISSING_TMDB_TOKEN' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('requires integer caps', async () => {
    const root = await makeRoot('invalid-caps')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      await expect(runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: -1, maxHttpRequests: 5 })).rejects.toMatchObject({ code: 'INVALID_BUDGET' })
      await expect(runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 5, maxHttpRequests: 1.5 })).rejects.toMatchObject({ code: 'INVALID_BUDGET' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('processes a candidate in queue order and marks EVIDENCE_COMPLETE for valid films', async () => {
    const root = await makeRoot('success')
    try {
      const entries = [1001, 1002].map((id, i) => mockQueueEntry({ tmdbId: id, selectionRank: i }))
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      let fetchCount = 0
      const fetchFn = vi.fn().mockImplementation(() => {
        fetchCount++
        const id = fetchCount === 1 ? 1001 : 1002
        return okTmdbFetch(id)()
      })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 2, maxHttpRequests: 5, fetchFn })
      expect(result.readyCount).toBe(2)
      expect(result.freshStartedThisRun).toBe(2)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('marks HTTP_FAILED when TMDB request fails — does not count toward 400', async () => {
    const root = await makeRoot('http-failed')
    try {
      const entries = [mockQueueEntry({ tmdbId: 2001 })]
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 10, fetchFn })
      expect(result.readyCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('marks FACTUAL_FAILED when validateMovieFacts fails — does not count toward 400', async () => {
    const root = await makeRoot('factual-failed')
    try {
      const entries = [mockQueueEntry({ tmdbId: 3001 })]
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      // Return a response with missing director — which causes factual validation to fail
      const badResponse = { ...validTmdbResponse(3001), credits: { crew: [] }, runtime: null }
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => badResponse, headers: { get: () => null } })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 3, fetchFn })
      expect(result.readyCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('marks EVIDENCE_FAILED when overview is too short — does not count toward 400', async () => {
    const root = await makeRoot('evidence-failed')
    try {
      const entries = [mockQueueEntry({ tmdbId: 4001 })]
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      const shortOverviewResponse = { ...validTmdbResponse(4001), overview: 'Short.' }
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => shortOverviewResponse, headers: { get: () => null } })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 3, fetchFn })
      expect(result.readyCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('skips EVIDENCE_COMPLETE candidates on resume — no re-fetch', async () => {
    const root = await makeRoot('resume-skip')
    try {
      const entry = mockQueueEntry({ tmdbId: 5001 })
      const queue = buildMockQueue([entry])
      await writeQueue(root, queue)
      await writeState(root, {
        schemaVersion: 'scale-500-acquisition-state.v1',
        queueHash: queue.queueHash,
        acquisitionTarget: ACQUISITION_TARGET,
        candidates: {
          'scale500-tmdb-5001': { candidateId: 'scale500-tmdb-5001', tmdbId: 5001, status: ACQUISITION_STATES.evidenceComplete, evidencePacketHash: 'sha256:prior', events: [] },
        },
      })
      const fetchFn = vi.fn()
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 5, maxHttpRequests: 5, fetchFn })
      expect(fetchFn).not.toHaveBeenCalled()
      expect(result.readyCount).toBe(1) // still counts the prior ready
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails closed from FETCHING to UNCERTAIN on resume without re-fetching', async () => {
    const root = await makeRoot('fetching-resume')
    try {
      const entry = mockQueueEntry({ tmdbId: 6001 })
      const queue = buildMockQueue([entry])
      await writeQueue(root, queue)
      await writeState(root, {
        schemaVersion: 'scale-500-acquisition-state.v1',
        queueHash: queue.queueHash,
        acquisitionTarget: ACQUISITION_TARGET,
        candidates: {
          'scale500-tmdb-6001': { candidateId: 'scale500-tmdb-6001', tmdbId: 6001, status: ACQUISITION_STATES.fetching, events: [] },
        },
      })
      // Use maxFreshCandidates=0 so it won't re-fetch
      const fetchFn = vi.fn()
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 0, maxHttpRequests: 5, fetchFn })
      // Read state to verify the ambiguous dispatch is preserved and never requeued.
      const statePath = resolve(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json')
      const state = JSON.parse(await readFile(statePath, 'utf8'))
      expect(state.candidates['scale500-tmdb-6001'].status).toBe(ACQUISITION_STATES.uncertain)
      expect(fetchFn).not.toHaveBeenCalled()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('respects maxFreshCandidates budget', async () => {
    const root = await makeRoot('fresh-cap')
    try {
      const entries = [1, 2, 3].map((n) => mockQueueEntry({ tmdbId: n, selectionRank: n - 1 }))
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      // Return correct tmdbId per request (extracted from URL)
      const fetchFn = vi.fn().mockImplementation((url) => {
        const match = url.match(/movie\/?(\d+)/)
        const id = match ? Number(match[1]) : 1
        return okTmdbFetch(id)()
      })
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 2, maxHttpRequests: 10, fetchFn })
      expect(fetchFn).toHaveBeenCalledTimes(2) // only 2 fresh allowed
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('respects maxHttpRequests budget', async () => {
    const root = await makeRoot('http-cap')
    try {
      // Use the same tmdbId for all entries to avoid ID mismatch in mock
      const entries = [1, 1, 1].map((n, i) => mockQueueEntry({ tmdbId: n + i * 1000, selectionRank: i }))
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      const fetchFn = vi.fn().mockImplementation((url) => {
        const match = url.match(/movie\/(\d+)/)
        const id = match ? Number(match[1]) : 1
        return okTmdbFetch(id)()
      })
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 10, maxHttpRequests: 1, fetchFn })
      expect(fetchFn).toHaveBeenCalledTimes(1) // 1 HTTP budget
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('counts the adapter HTTP cap exactly with no hidden retry', async () => {
    const root = await makeRoot('exact-http-cap')
    try {
      await writeQueue(root, buildMockQueue([mockQueueEntry({ tmdbId: 77 })]))
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 1, fetchFn, delayFn: async () => {} })
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(result.invocationHttpRequests).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('preserves an unknown transport outcome as uncertain and never redispatches it', async () => {
    const root = await makeRoot('unknown-transport')
    try {
      await writeQueue(root, buildMockQueue([mockQueueEntry({ tmdbId: 79 })]))
      const fetchFn = vi.fn().mockRejectedValue(new Error('socket outcome unknown'))
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 1, fetchFn })
      const statePath = resolve(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json')
      let state = JSON.parse(await readFile(statePath, 'utf8'))
      expect(state.candidates['scale500-tmdb-79'].status).toBe(ACQUISITION_STATES.uncertain)
      fetchFn.mockClear()
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 1, fetchFn })
      expect(fetchFn).not.toHaveBeenCalled()
      state = JSON.parse(await readFile(statePath, 'utf8'))
      expect(state.candidates['scale500-tmdb-79'].events.map((event) => event.type)).toEqual(['HTTP_DISPATCH', 'UNCERTAIN'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('resolves a cache hit before the dispatch boundary', async () => {
    const root = await makeRoot('cache-before-dispatch')
    try {
      await writeQueue(root, buildMockQueue([mockQueueEntry({ tmdbId: 78 })]))
      const cache = resolve(root, 'catalogue-pipeline/cache/tmdb/tmdb-movie-details.v2/78.json')
      await mkdir(resolve(cache, '..'), { recursive: true })
      await writeFile(cache, JSON.stringify({ response: validTmdbResponse(78) }))
      const fetchFn = vi.fn()
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 1, maxHttpRequests: 1, fetchFn })
      expect(fetchFn).not.toHaveBeenCalled()
      expect(result.invocationHttpRequests).toBe(0)
      const state = JSON.parse(await readFile(resolve(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json'), 'utf8'))
      expect(state.candidates['scale500-tmdb-78'].events.some((event) => event.type === 'HTTP_DISPATCH')).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('stops automatically when ACQUISITION_TARGET is reached', async () => {
    // Build a queue with ACQUISITION_TARGET+5 entries; pre-populate (TARGET-1) as EVIDENCE_COMPLETE;
    // only 1 new fetch needed to reach target
    const root = await makeRoot('auto-stop')
    try {
      const priorReadyIds = Array.from({ length: ACQUISITION_TARGET - 1 }, (_, i) => 9000 + i)
      const nextId = 8999
      const reserveId = 8888
      const entries = [
        ...priorReadyIds.map((id, i) => mockQueueEntry({ tmdbId: id, selectionRank: i })),
        mockQueueEntry({ tmdbId: nextId, selectionRank: ACQUISITION_TARGET - 1, reserveTier: 'primary' }),
        mockQueueEntry({ tmdbId: reserveId, selectionRank: ACQUISITION_TARGET, reserveTier: 'reserve' }),
      ]
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      const priorCandidates = Object.fromEntries(priorReadyIds.map((id) => [`scale500-tmdb-${id}`, { candidateId: `scale500-tmdb-${id}`, tmdbId: id, status: ACQUISITION_STATES.evidenceComplete, events: [] }]))
      await writeState(root, { schemaVersion: 'scale-500-acquisition-state.v1', queueHash: queue.queueHash, acquisitionTarget: ACQUISITION_TARGET, candidates: priorCandidates })
      let fetchCount = 0
      const fetchFn = vi.fn().mockImplementation(() => { fetchCount++; return okTmdbFetch(nextId)() })
      const result = await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 50, maxHttpRequests: 50, fetchFn })
      expect(result.readyCount).toBe(ACQUISITION_TARGET)
      expect(result.targetMet).toBe(true)
      // Reserve candidate should NOT have been fetched
      expect(fetchFn).toHaveBeenCalledTimes(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('processes candidates in queue selectionRank order', async () => {
    const root = await makeRoot('queue-order')
    try {
      // Create entries in reverse rank order in the array — runner should still process by rank
      const entries = [3, 1, 2].map((rank) => mockQueueEntry({ tmdbId: 7000 + rank, selectionRank: rank - 1 }))
      // Sort to maintain rank order in queue (the builder already does this, simulate it)
      entries.sort((a, b) => a.selectionRank - b.selectionRank)
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)
      const order = []
      const fetchFn = vi.fn().mockImplementation((url) => {
        const match = url.match(/movie\/(\d+)/)
        if (match) order.push(Number(match[1]))
        return okTmdbFetch(Number(match?.[1] ?? 0))()
      })
      await runScale500FactualAcquisition({ root, token: 'tok', maxFreshCandidates: 3, maxHttpRequests: 5, fetchFn })
      expect(order).toEqual([7001, 7002, 7003]) // rank 0, 1, 2
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('[REGRESSION] replaces a failed primary with a reserve candidate from the same composition cell', async () => {
    const root = await makeRoot('same-cell-reserve')
    try {
      // Cell A: '1990s:en:mainstream' -> primary 8001, reserve 8002
      // Cell B: '2000s:en:mainstream' -> primary 8003, reserve 8004
      const entryA1 = mockQueueEntry({ tmdbId: 8001, cellKey: '1990s:en:mainstream', reserveTier: 'primary', selectionRank: 0 })
      const entryB1 = mockQueueEntry({ tmdbId: 8003, cellKey: '2000s:en:mainstream', reserveTier: 'primary', selectionRank: 1 })
      const entryA2 = mockQueueEntry({ tmdbId: 8002, cellKey: '1990s:en:mainstream', reserveTier: 'reserve', selectionRank: 2 })
      const entryB2 = mockQueueEntry({ tmdbId: 8004, cellKey: '2000s:en:mainstream', reserveTier: 'reserve', selectionRank: 3 })
      const queue = buildMockQueue([entryA1, entryB1, entryA2, entryB2])
      await writeQueue(root, queue)

      // 8001 fails HTTP, 8003 succeeds, 8002 (reserve for cell A) succeeds, 8004 (reserve for cell B) should be SKIPPED
      const fetchFn = vi.fn(async (url) => {
        if (url.includes('/8001')) return { ok: false, status: 500, json: async () => ({}) }
        if (url.includes('/8003')) return okTmdbFetch(8003)()
        if (url.includes('/8002')) return okTmdbFetch(8002)()
        if (url.includes('/8004')) return okTmdbFetch(8004)()
        return { ok: false, status: 404 }
      })

      const result = await runScale500FactualAcquisition({
        root,
        token: 'tok',
        maxFreshCandidates: 10,
        maxHttpRequests: 10,
        fetchFn,
        delayFn: async () => {},
      })

      // 8001 was attempted (and failed)
      // 8003 was attempted (and succeeded)
      // 8002 was attempted (reserve for cell A succeeded)
      // 8004 must NEVER have been fetched because cell B already met its quota
      const fetchedUrls = fetchFn.mock.calls.map(([url]) => url)
      expect(fetchedUrls.some((u) => u.includes('/8001'))).toBe(true)
      expect(fetchedUrls.some((u) => u.includes('/8003'))).toBe(true)
      expect(fetchedUrls.some((u) => u.includes('/8002'))).toBe(true)
      expect(fetchedUrls.some((u) => u.includes('/8004'))).toBe(false)

      const state = JSON.parse(await readFile(join(root, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json'), 'utf8'))
      expect(state.candidates['scale500-tmdb-8001'].status).toBe(ACQUISITION_STATES.httpFailed)
      expect(state.candidates['scale500-tmdb-8003'].status).toBe(ACQUISITION_STATES.evidenceComplete)
      expect(state.candidates['scale500-tmdb-8002'].status).toBe(ACQUISITION_STATES.evidenceComplete)
      expect(state.candidates['scale500-tmdb-8004']).toBeUndefined()
      expect(result.readyCount).toBe(2)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('[REGRESSION] never uses a reserve from cell B to substitute for an unmet primary in cell A', async () => {
    const root = await makeRoot('no-cross-cell-substitution')
    try {
      // Cell A has primary 9001, but NO reserves
      // Cell B has primary 9002 and reserve 9003
      const entryA1 = mockQueueEntry({ tmdbId: 9001, cellKey: '1990s:en:mainstream', reserveTier: 'primary', selectionRank: 0 })
      const entryB1 = mockQueueEntry({ tmdbId: 9002, cellKey: '2000s:en:mainstream', reserveTier: 'primary', selectionRank: 1 })
      const entryB2 = mockQueueEntry({ tmdbId: 9003, cellKey: '2000s:en:mainstream', reserveTier: 'reserve', selectionRank: 2 })
      const queue = buildMockQueue([entryA1, entryB1, entryB2])
      await writeQueue(root, queue)

      // 9001 fails, 9002 succeeds
      const fetchFn = vi.fn(async (url) => {
        if (url.includes('/9001')) return { ok: false, status: 500, json: async () => ({}) }
        if (url.includes('/9002')) return okTmdbFetch(9002)()
        if (url.includes('/9003')) return okTmdbFetch(9003)()
        return { ok: false, status: 404 }
      })

      const result = await runScale500FactualAcquisition({
        root,
        token: 'tok',
        maxFreshCandidates: 10,
        maxHttpRequests: 10,
        fetchFn,
        delayFn: async () => {},
      })

      // 9003 (reserve for Cell B) must NOT be fetched to replace 9001 (Cell A)
      const fetchedUrls = fetchFn.mock.calls.map(([url]) => url)
      expect(fetchedUrls.some((u) => u.includes('/9003'))).toBe(false)
      expect(result.readyCount).toBe(1) // only 9002 is ready
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('supports staged checkpoints with targetReadyCount without refetching completed records', async () => {
    const root = await makeRoot('staged-checkpoints')
    try {
      const entries = [
        mockQueueEntry({ tmdbId: 101, selectionRank: 0 }),
        mockQueueEntry({ tmdbId: 102, selectionRank: 1 }),
        mockQueueEntry({ tmdbId: 103, selectionRank: 2 }),
      ]
      const queue = buildMockQueue(entries)
      await writeQueue(root, queue)

      const fetchFn = vi.fn(async (url) => {
        const id = Number(url.match(/movie\/(\d+)/)?.[1] ?? 0)
        return okTmdbFetch(id)()
      })

      // Stage 1: acquire up to targetReadyCount = 2
      const first = await runScale500FactualAcquisition({
        root,
        token: 'tok',
        maxFreshCandidates: 10,
        maxHttpRequests: 10,
        targetReadyCount: 2,
        fetchFn,
      })
      expect(first.readyCount).toBe(2)
      expect(first.targetMet).toBe(true)
      expect(fetchFn).toHaveBeenCalledTimes(2)

      // Stage 2: acquire up to targetReadyCount = 3 (should only fetch 103)
      fetchFn.mockClear()
      const second = await runScale500FactualAcquisition({
        root,
        token: 'tok',
        maxFreshCandidates: 10,
        maxHttpRequests: 10,
        targetReadyCount: 3,
        fetchFn,
      })
      expect(second.readyCount).toBe(3)
      expect(second.targetMet).toBe(true)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(fetchFn.mock.calls[0][0]).toContain('/103')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('launchScale500FactualAcquisition', () => {
  it('returns executionAuthorized=false without the authorization flag', async () => {
    const root = await makeRoot('launch-no-auth')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      const result = await launchScale500FactualAcquisition([], { root })
      expect(result.executionAuthorized).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reports --ready-count without executing', async () => {
    const root = await makeRoot('launch-ready-count')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      const result = await launchScale500FactualAcquisition(['--ready-count'], { root })
      expect(result.executionAuthorized).toBe(false)
      expect(result.preflight.readyCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects invalid caps even with authorization flag', async () => {
    const root = await makeRoot('launch-bad-caps')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      await expect(launchScale500FactualAcquisition([ACQUISITION_AUTHORIZATION_FLAG, '--max-fresh-candidates', 'abc', '--max-http-requests', '10'], { root, env: { TMDB_READ_ACCESS_TOKEN: 'tok' } })).rejects.toMatchObject({ code: 'INVALID_BUDGET' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('performs zero external calls without the authorization flag', async () => {
    const root = await makeRoot('launch-zero-http')
    try {
      const queue = buildMockQueue([mockQueueEntry({ tmdbId: 1 })])
      await writeQueue(root, queue)
      const fetchFn = vi.fn()
      const result = await launchScale500FactualAcquisition([], { root, fetchFn })
      expect(fetchFn).not.toHaveBeenCalled()
      expect(result.executionAuthorized).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
