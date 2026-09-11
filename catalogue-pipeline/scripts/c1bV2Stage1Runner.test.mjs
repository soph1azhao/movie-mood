import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OPERATIONALLY_INCONCLUSIVE,
  canonicalize,
  recoverWal,
} from './c1bV2Stage0.mjs'
import {
  STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED,
  STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE,
  STAGE1_PROTOCOL_ID,
  STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT,
  STAGE1_STRATA,
  buildExclusionManifest,
} from './c1bV2Stage1.mjs'
import {
  STAGE1_COMPLETE,
  assembleRepositoryExclusions,
  buildUniverseRequestIdentity,
  createTmdbDiscoverTransport,
  parseTmdbDiscoverWireResponse,
  runStage1Recruitment,
} from './c1bV2Stage1Runner.mjs'

const directories = []
async function tempOutput() {
  const root = await mkdtemp(join(tmpdir(), 'c1b-v2-stage1c-'))
  directories.push(root)
  return join(root, 'live-output')
}
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const contracts = JSON.parse(await readFile(new URL('../calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.contracts.json', import.meta.url), 'utf8'))
const contract = contracts.contracts.find(({ id }) => id === 'stage1-recruitment-contract.v2')
const invocationId = 'synthetic-stage1-live'
const timestamp = '2026-09-11T12:00:00.000Z'

function movieFor(stratum, index, overrides = {}) {
  const year = stratum.releaseDateGte.slice(0, 4)
  const baseId = 2_000_000 + STAGE1_STRATA.indexOf(stratum) * 10_000 + index
  return { id: baseId, title: `Synthetic ${stratum.id} ${index}`, original_title: `Synthetic ${stratum.id} ${index}`, release_date: `${year}-06-15`, vote_count: 500, vote_average: 7, original_language: 'en', genre_ids: [18], overview: 'Synthetic fixture.', popularity: 1, adult: false, video: false, ...overrides }
}

function successfulPayloads({ totalPages = 2, extraPerStratum = 0 } = {}) {
  const payloads = new Map()
  for (const stratum of STAGE1_STRATA) {
    const movies = Array.from({ length: stratum.quota + extraPerStratum }, (_, index) => movieFor(stratum, index + 1))
    payloads.set(`${stratum.id}:1`, { page: 1, total_pages: totalPages, total_results: movies.length, results: movies })
    for (let page = 2; page <= totalPages; page++) payloads.set(`${stratum.id}:${page}`, { page, total_pages: totalPages, total_results: movies.length, results: [] })
  }
  return payloads
}

function fakeTransport(payloads, { throwOn = null } = {}) {
  const calls = []
  return {
    calls,
    automaticRetries: false,
    maxAttempts: 1,
    async dispatch(request) {
      calls.push(request)
      if (throwOn === `${request.stratumId}:${request.page}`) throw new Error('synthetic transport ambiguity')
      const payload = payloads.get(`${request.stratumId}:${request.page}`)
      if (!payload) return { ok: true, status: 200, body: JSON.stringify({ page: request.page, total_pages: 1, total_results: 0, results: [] }) }
      return { ok: true, status: 200, body: JSON.stringify(payload) }
    },
  }
}

function exclusions(entries = []) {
  const manifest = buildExclusionManifest({ protocolId: STAGE1_PROTOCOL_ID, sources: [{ sourceName: 'synthetic', entries }] })
  return { manifest, provenance: { inventoryVersion: 1, protocolId: STAGE1_PROTOCOL_ID, exclusionManifestHash: manifest.exclusionManifestHash, sources: [{ sourcePath: 'synthetic', sourceCategory: 'synthetic', records: entries }] } }
}

async function runSynthetic({ payloads = successfulPayloads(), exclusionEntries = [], transport = fakeTransport(payloads), outputDir = null, onStep = () => {}, controlledResume = false } = {}) {
  outputDir ??= await tempOutput()
  const { manifest, provenance } = exclusions(exclusionEntries)
  return { result: await runStage1Recruitment({ contract, exclusionManifest: manifest, exclusionProvenance: provenance, outputDir, transport, invocationId, timestamp, onStep, controlledResume }), transport, outputDir }
}

describe('C1b-V2 Stage 1C transport and identity', () => {
  it('uses one exact GET with no retry, no region, and no token in URL or request identity', async () => {
    const calls = []; const token = 'synthetic-secret-token'
    const transport = createTmdbDiscoverTransport({ token, fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 200, text: async () => JSON.stringify({ page: 1, total_pages: 1, total_results: 0, results: [] }) }
    } })
    const request = { endpoint: '/discover/movie', stratumId: '1980-1989', page: 1, params: { include_adult: false, include_video: false, language: 'en-US', page: 1, 'primary_release_date.gte': '1980-01-01', 'primary_release_date.lte': '1989-12-31', sort_by: 'primary_release_date.asc', 'vote_count.gte': 200, 'vote_count.lte': 2000 } }
    const wire = await transport.dispatch(request)
    expect(parseTmdbDiscoverWireResponse(wire)).toMatchObject({ page: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('GET')
    expect(calls[0].url).not.toContain('region')
    expect(calls[0].url).not.toContain(token)
    expect(transport).toMatchObject({ automaticRetries: false, maxAttempts: 1 })
    const identity = buildUniverseRequestIdentity({ request, invocationId, timestamp })
    expect(identity).toMatchObject({ stage: 1, requestScope: 'universe', requestPurpose: 'tmdb-discover-movie-stage1-recruitment', scopeId: 'stage1:1980-1989:page:1', candidateId: null, arm: null, drawIndex: null })
    expect(canonicalize(identity)).not.toContain(token)
  })

  it('assembles and verifies the repository-backed exclusion union without metadata conflicts', async () => {
    const { manifest, provenance } = await assembleRepositoryExclusions({ root: process.cwd() })
    expect(manifest.exclusions).toHaveLength(150)
    expect(manifest.exclusionManifestHash).toBe('sha256:4c7564fb6bf7affe25aef26d986810176866026163b31c29498f06dbeeb1ebe1')
    expect(provenance.sources.map(({ sourceCategory }) => sourceCategory)).toEqual(expect.arrayContaining(['c1b-v1-superseded-stage1-registry', 'c1b-v1-corrected-stage1-registry', 'c1b-v1-human-gold', 'c1b-v1-wikipedia-exposure', 'c1b-v1-operational-incident', 'phase5-exposure-ledger', 'identity-masked-semantic-probes']))
    expect(provenance.sources.every(({ records }) => records.every(({ tmdbId, reason, provenance: source }) => Number.isInteger(tmdbId) && reason && source))).toBe(true)
  })
})

describe('C1b-V2 Stage 1C page gate, WAL, freeze, and selection', () => {
  it('requests page 1 only and blocks before page 2 when the first stratum exceeds 50 pages', async () => {
    const payloads = successfulPayloads({ totalPages: 2 })
    payloads.set('1980-1989:1', { page: 1, total_pages: 51, total_results: 1001, results: [] })
    const { result, transport } = await runSynthetic({ payloads })
    expect(result).toMatchObject({ status: STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED, blockedStratum: '1980-1989', totalPages: 51, dispatchedRequests: 1 })
    expect(transport.calls.map(({ page }) => page)).toEqual([1])
  })

  it('gates all five page-1 responses before fetching every planned remaining page and produces 180', async () => {
    const steps = []
    const { result, transport, outputDir } = await runSynthetic({ onStep: (step) => steps.push(step) })
    expect(result.status).toBe(STAGE1_COMPLETE)
    expect(result.selection.candidates).toHaveLength(180)
    expect(transport.calls).toHaveLength(10)
    expect(transport.calls.slice(0, 5).map(({ page }) => page)).toEqual([1, 1, 1, 1, 1])
    expect(transport.calls.slice(5).map(({ page }) => page)).toEqual([2, 2, 2, 2, 2])
    expect(steps.findIndex(({ type }) => type === 'page1-gate-complete')).toBeLessThan(steps.findIndex(({ type, page }) => type === 'page-complete' && page === 2))
    const wal = await recoverWal(join(outputDir, 'execution.wal'))
    expect(wal.records.filter(({ lifecycle }) => lifecycle === 'INTENT')).toHaveLength(10)
    expect(wal.records.every(({ requestScope }) => requestScope === 'universe')).toBe(true)
  })

  it('does not stop early when page 1 already contains every quota candidate', async () => {
    const { result, transport } = await runSynthetic({ payloads: successfulPayloads({ totalPages: 3 }) })
    expect(result.status).toBe(STAGE1_COMPLETE)
    expect(transport.calls).toHaveLength(15)
    expect(transport.calls.filter(({ page }) => page === 3).length).toBe(5)
  })

  it('persists the source snapshot before any downstream selection step', async () => {
    const steps = []; const { result } = await runSynthetic({ onStep: (step) => steps.push(step) })
    expect(result.status).toBe(STAGE1_COMPLETE)
    const frozen = steps.findIndex(({ type }) => type === 'source-snapshot-persisted')
    const downstream = steps.findIndex(({ type }) => type === 'post-freeze-selection-start')
    expect(frozen).toBeGreaterThanOrEqual(0); expect(frozen).toBeLessThan(downstream)
  })

  it('blocks an incomplete or logically mismatched corpus', async () => {
    const payloads = successfulPayloads()
    payloads.set('1980-1989:2', { page: 1, total_pages: 2, total_results: 24, results: [] })
    const { result } = await runSynthetic({ payloads })
    expect(result).toMatchObject({ status: OPERATIONALLY_INCONCLUSIVE, reason: 'INCOMPLETE_DISCOVERY_CORPUS' })
  })

  it('freezes raw records before rejecting a conflicting duplicate', async () => {
    const payloads = successfulPayloads()
    const first = payloads.get('1980-1989:1').results[0]
    payloads.get('1980-1989:2').results.push({ ...first, title: 'Conflicting title' })
    const { result, outputDir } = await runSynthetic({ payloads })
    expect(result.status).toBe(STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT)
    expect(result.sourceSnapshotHash).toMatch(/^sha256:/u)
    expect(JSON.parse(await readFile(join(outputDir, 'source-snapshot.json'), 'utf8')).sourceSnapshotHash).toBe(result.sourceSnapshotHash)
  })

  it('blocks an insufficient stratum without quota borrowing or replenishment', async () => {
    const payloads = successfulPayloads()
    payloads.get('1990-1999:1').results.pop()
    const { result } = await runSynthetic({ payloads })
    expect(result).toMatchObject({ status: STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE, details: { stratumId: '1990-1999', available: 23, quota: 24 } })
  })

  it('uses the exact frozen exclusion manifest during selection', async () => {
    const payloads = successfulPayloads({ extraPerStratum: 1 })
    const excludedMovie = payloads.get('1980-1989:1').results[0]
    const entry = { tmdbId: excludedMovie.id, canonicalId: 'synthetic-excluded', title: excludedMovie.title, reason: 'prior-exposure', provenance: 'synthetic' }
    const { result } = await runSynthetic({ payloads, exclusionEntries: [entry] })
    expect(result.status).toBe(STAGE1_COMPLETE)
    expect(result.selection.exclusionManifestHash).toBe(exclusions([entry]).manifest.exclusionManifestHash)
    expect(result.selection.candidates.some(({ tmdbId }) => tmdbId === excludedMovie.id)).toBe(false)
    expect(result.summary.strata[0]).toMatchObject({ excluded: 1, eligibleNonExcluded: 24, selected: 24 })
  })
})

describe('C1b-V2 Stage 1C ambiguity, replay, and artifact safety', () => {
  it('stops the whole run as UNKNOWN_IN_FLIGHT and controlled resume never redispatches', async () => {
    const payloads = successfulPayloads(); const transport = fakeTransport(payloads, { throwOn: '1980-1989:1' }); const outputDir = await tempOutput()
    const first = await runSynthetic({ payloads, transport, outputDir })
    expect(first.result).toMatchObject({ status: OPERATIONALLY_INCONCLUSIVE, reason: 'AMBIGUOUS_TRANSPORT_FAILURE', dispatchedRequests: 1 })
    const second = await runSynthetic({ payloads, transport, outputDir, controlledResume: true })
    expect(second.result).toMatchObject({ status: OPERATIONALLY_INCONCLUSIVE, reason: 'UNKNOWN_IN_FLIGHT', dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(1)
  })

  it('replays a completed WAL without duplicate transport calls or artifact mutation', async () => {
    const payloads = successfulPayloads(); const transport = fakeTransport(payloads); const outputDir = await tempOutput()
    const first = await runSynthetic({ payloads, transport, outputDir })
    expect(first.result.status).toBe(STAGE1_COMPLETE); expect(transport.calls).toHaveLength(10)
    const snapshotBefore = await readFile(join(outputDir, 'source-snapshot.json'), 'utf8')
    const second = await runSynthetic({ payloads, transport, outputDir, controlledResume: true })
    expect(second.result).toMatchObject({ status: STAGE1_COMPLETE, dispatchedRequests: 0, sourceSnapshotHash: first.result.sourceSnapshotHash })
    expect(transport.calls).toHaveLength(10)
    expect(await readFile(join(outputDir, 'source-snapshot.json'), 'utf8')).toBe(snapshotBefore)
  })

  it('writes no credential into WAL or durable artifacts', async () => {
    const secret = 'never-persist-this-token'; const payloads = successfulPayloads()
    const base = fakeTransport(payloads)
    const transport = createTmdbDiscoverTransport({ token: secret, fetchImpl: async (url) => {
      const parsed = new URL(url); const page = Number(parsed.searchParams.get('page')); const gte = parsed.searchParams.get('primary_release_date.gte')
      const stratum = STAGE1_STRATA.find(({ releaseDateGte }) => releaseDateGte === gte)
      const payload = payloads.get(`${stratum.id}:${page}`)
      base.calls.push({ stratumId: stratum.id, page })
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
    } })
    const outputDir = await tempOutput(); const { manifest, provenance } = exclusions()
    const result = await runStage1Recruitment({ contract, exclusionManifest: manifest, exclusionProvenance: provenance, outputDir, transport, invocationId, timestamp })
    expect(result.status).toBe(STAGE1_COMPLETE)
    for (const name of await readdir(outputDir)) {
      const path = join(outputDir, name)
      const content = await readFile(path, 'utf8')
      expect(content).not.toContain(secret)
    }
  })
})
