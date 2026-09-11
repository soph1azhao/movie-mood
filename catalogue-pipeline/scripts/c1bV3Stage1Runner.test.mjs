import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WAL_GENESIS_HASH, acquireRunLock, canonicalize, classifyAttempt, createWalRecord, recoverWal } from './c1bV2Stage0.mjs'
import {
  V3_PROTOCOL_ID,
  V3_STATUSES,
  buildAnnualPageRequest,
  buildPaginationPlan,
  buildV3ExclusionManifest,
  evaluatePage1Gate,
  loadRegisteredV3Spec,
} from './c1bV3Stage1.mjs'
import {
  V3_STAGE1_MIN_DISPATCH_INTERVAL_MS,
  V3_STAGE1_PRELIVE_FAILED,
  V3_STAGE1_RUNNER_VERSION,
  buildV3UniverseRequestIdentity,
  computeV3RequestHash,
  runV3Stage1Recruitment,
  v3Stage1ArtifactPaths,
} from './c1bV3Stage1Runner.mjs'

const roots = []
const invocationId = 'synthetic-v3-stage1b'
const timestamp = '2026-09-11T12:00:00.000Z'
const frozen = await loadRegisteredV3Spec()
const quotas = new Map([['1980-1989', 24], ['1990-1999', 24], ['2000-2009', 33], ['2010-2019', 45], ['2020-2024', 54]])

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (path) => {
    const { rm } = await import('node:fs/promises')
    await rm(path, { recursive: true, force: true })
  }))
})

async function tempArtifacts() {
  const root = await mkdtemp(join(tmpdir(), 'c1b-v3-stage1b-'))
  roots.push(root)
  return join(root, 'artifacts')
}

function syntheticMovie(cell, index) {
  return {
    id: 3_000_000 + (cell.year - 1980) * 10_000 + index,
    title: `Synthetic ${cell.year} ${index}`,
    original_title: `Synthetic ${cell.year} ${index}`,
    release_date: `${cell.year}-06-15`,
    vote_count: 500,
    vote_average: 7,
    original_language: 'en',
    genre_ids: [18],
    overview: 'Complete synthetic provider record.',
    popularity: 1,
    adult: false,
    video: false,
  }
}

function payloads({ page2Cells = ['year-1980', 'year-1990', 'year-2000', 'year-2010', 'year-2020'] } = {}) {
  const result = new Map()
  for (const cell of frozen.cells) {
    const isAnchor = cell.year % 10 === 0
    const movies = isAnchor ? Array.from({ length: quotas.get(cell.parentStratumId) }, (_, index) => syntheticMovie(cell, index + 1)) : []
    const totalPages = movies.length ? (page2Cells.includes(cell.cellId) ? 2 : 1) : 0
    result.set(`${cell.cellId}:1`, { page: 1, total_pages: totalPages, total_results: movies.length, results: movies })
    if (totalPages === 2) result.set(`${cell.cellId}:2`, { page: 2, total_pages: 2, total_results: movies.length, results: [] })
  }
  return result
}

function fakeClock(initial = 0) {
  let now = initial
  const sleeps = []
  return { now: () => now, advance: (ms) => { now += ms }, sleeps, sleep: async (ms) => { sleeps.push(ms); now += ms } }
}

function fakeTransport(source, { clock, advance = 250, throwOn, mutate } = {}) {
  const calls = []
  let active = 0
  let maxActive = 0
  return {
    calls,
    get maxActive() { return maxActive },
    async dispatch(request) {
      calls.push(request)
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (throwOn === `${request.cellId}:${request.page}`) throw new Error('synthetic post-entry failure')
        const original = structuredClone(source.get(`${request.cellId}:${request.page}`))
        const response = mutate ? mutate(original, request) : original
        if (!response) throw new Error('missing synthetic payload')
        clock?.advance(advance)
        return { ok: true, status: 200, body: JSON.stringify(response) }
      } finally { active-- }
    },
  }
}

function exclusions(entries = []) {
  return buildV3ExclusionManifest({ sources: [{ sourceName: 'synthetic', entries }] })
}

function paginationPlanFor(firstCellPages = 2) {
  return buildPaginationPlan(frozen, frozen.cells.map((cell) => evaluatePage1Gate(
    buildAnnualPageRequest(frozen, cell.cellId, 1),
    { page: 1, total_pages: cell.cellId === 'year-1980' ? firstCellPages : 0, total_results: 0, results: [] }
  )))
}

function completedAttempt(identity) {
  const intent = createWalRecord({ lifecycle: 'INTENT', identity, payload: null, seq: 0, prevRecordHash: WAL_GENESIS_HASH })
  const response = createWalRecord({ lifecycle: 'RESPONSE', identity, payload: { response: { ok: true, status: 200, body: '{"page":1,"results":[],"total_pages":0,"total_results":0}' } }, seq: 1, prevRecordHash: intent.canonicalRecordHash })
  const terminal = createWalRecord({ lifecycle: 'TERMINAL', identity, payload: { disposition: 'COMPLETED', output: { page: 1, results: [], total_pages: 0, total_results: 0 } }, seq: 2, prevRecordHash: response.canonicalRecordHash })
  return [intent, response, terminal]
}

async function prepareControlledResume({ identity, plan }) {
  const artifactDir = await tempArtifacts()
  await mkdir(artifactDir)
  const paths = v3Stage1ArtifactPaths(artifactDir)
  const manifest = exclusions()
  await acquireRunLock(paths.lock, { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId, timestamp, runnerVersion: V3_STAGE1_RUNNER_VERSION, exclusionManifestHash: manifest.exclusionManifestHash })
  await writeFile(paths.wal, `${completedAttempt(identity).map(canonicalize).join('\n')}\n`)
  if (plan) await writeFile(paths.plan, canonicalize({ protocolId: V3_PROTOCOL_ID, stage: 1, contractRef: 'stage1-recruitment-contract.v3', paginationPlan: plan }))
  return { artifactDir, manifest }
}

async function runSynthetic(options = {}) {
  const artifactDir = options.artifactDir ?? await tempArtifacts()
  const source = options.source ?? payloads()
  const clock = options.clock ?? fakeClock()
  const transport = options.transport ?? fakeTransport(source, { clock })
  const result = await runV3Stage1Recruitment({
    root: process.cwd(), artifactDir, transport, exclusionManifest: options.exclusionManifest ?? exclusions(),
    controlledResume: options.controlledResume ?? false, invocationId, timestamp,
    monotonicNow: clock.now, sleep: options.sleep ?? clock.sleep, loadSpec: options.loadSpec,
    beforeDispatch: options.beforeDispatch, onWalStep: options.onWalStep,
    onArtifactStep: options.onArtifactStep, onEvent: options.onEvent,
  })
  return { result, artifactDir, source, clock, transport }
}

async function pathExists(path) { return stat(path).then(() => true, () => false) }

describe('C1b-V3 Stage 1B pre-live gate, identity, and lock', () => {
  it('performs no network activity on import', async () => {
    const prior = globalThis.fetch
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    vi.resetModules()
    try { await import('./c1bV3Stage1Runner.mjs') } finally { globalThis.fetch = prior }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed before directory, WAL, or dispatch when registered verification fails', async () => {
    const artifactDir = await tempArtifacts()
    const transport = fakeTransport(payloads())
    const { result } = await runSynthetic({ artifactDir, transport, loadSpec: async () => { throw new Error('tamper') } })
    expect(result).toMatchObject({ status: V3_STAGE1_PRELIVE_FAILED, dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(0)
    expect(await pathExists(artifactDir)).toBe(false)
  })

  it('blocks an existing RUN_LOCK and preserves it', async () => {
    const artifactDir = await tempArtifacts()
    await mkdir(artifactDir)
    const paths = v3Stage1ArtifactPaths(artifactDir)
    await acquireRunLock(paths.lock, { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId: 'other', timestamp, runnerVersion: V3_STAGE1_RUNNER_VERSION, exclusionManifestHash: exclusions().exclusionManifestHash })
    const { result, transport } = await runSynthetic({ artifactDir })
    expect(result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_LOCK_HELD', dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(0)
    expect(await pathExists(paths.lock)).toBe(true)
  })

  it('binds exact serialized provider request and complete Stage-0 universe identity', () => {
    const request = buildAnnualPageRequest(frozen, 'year-1980', 1)
    const identity = buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase: 'page1' })
    expect(identity).toMatchObject({ studyId: V3_PROTOCOL_ID, invocationId, stage: 1, requestScope: 'universe', requestPurpose: 'page1-gate', attemptOrdinal: 0, timestamp, scopeId: 'stage1:year-1980:page:1', candidateId: null, arm: null, drawIndex: null })
    expect(identity.attemptId).toBe(`${invocationId}:stage1:year-1980:page:1:page1-gate:attempt:0`)
    expect(computeV3RequestHash(frozen, request, { phase: 'page1' })).toBe(identity.requestHash)
    const reordered = structuredClone(request)
    reordered.params = Object.fromEntries(Object.entries(reordered.params).reverse())
    expect(computeV3RequestHash(frozen, reordered, { phase: 'page1' })).toBe(identity.requestHash)
    expect(computeV3RequestHash(frozen, buildAnnualPageRequest(frozen, 'year-1981', 1), { phase: 'page1' })).not.toBe(identity.requestHash)
    const gates = frozen.cells.map((cell) => evaluatePage1Gate(
      buildAnnualPageRequest(frozen, cell.cellId, 1),
      { page: 1, total_pages: cell.cellId === 'year-1980' ? 2 : 0, total_results: 0, results: [] }
    ))
    const paginationPlan = buildPaginationPlan(frozen, gates)
    const page2 = buildAnnualPageRequest(frozen, 'year-1980', 2, { phase: 'page2', paginationPlan })
    const page2Identity = buildV3UniverseRequestIdentity({ frozen, request: page2, invocationId, timestamp, phase: 'page2', paginationPlan })
    expect(page2Identity.requestPurpose).toBe('page2-enumeration')
    expect(page2Identity.requestHash).not.toBe(identity.requestHash)
  })

  it('binds exclusionManifestHash in RUN_LOCK and rejects a different valid manifest on resume', async () => {
    const manifestA = exclusions()
    const manifestB = exclusions([{ id: 9_999_999, reason: 'different-valid-manifest' }])
    const first = await runSynthetic({ exclusionManifest: manifestA, onEvent: (event) => {
      if (event.type === 'pagination-plan-persisted') throw new Error('safe synthetic stop before page 2')
    } })
    expect(first.result).toMatchObject({ status: V3_STATUSES.inconclusive, dispatchedRequests: 45 })
    const firstPaths = v3Stage1ArtifactPaths(first.artifactDir)
    const lock = JSON.parse(await readFile(firstPaths.lock, 'utf8'))
    expect(lock.exclusionManifestHash).toBe(manifestA.exclusionManifestHash)
    expect(JSON.parse(await readFile(firstPaths.metadata, 'utf8')).exclusionManifestHash).toBe(manifestA.exclusionManifestHash)

    const mismatchedTransport = fakeTransport(payloads())
    const mismatched = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, exclusionManifest: manifestB, transport: mismatchedTransport })
    expect(mismatched.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_CONTEXT_MISMATCH', dispatchedRequests: 0 })
    expect(mismatchedTransport.calls).toHaveLength(0)

    const matchingTransport = fakeTransport(payloads())
    const matching = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, exclusionManifest: manifestA, transport: matchingTransport })
    expect(matching.result.status).toBe(V3_STATUSES.complete)
    expect(matchingTransport.calls.map(({ page }) => page)).toEqual([2, 2, 2, 2, 2])
  })
})

describe('C1b-V3 Stage 1B phases, gates, plan, and pacing', () => {
  it('dispatches all 45 page-1 cells in ascending order before exact frozen phase 2', async () => {
    const events = []
    const { result, transport, artifactDir } = await runSynthetic({ onEvent: (event) => events.push(event) })
    expect(result.status).toBe(V3_STATUSES.complete)
    expect(transport.calls.slice(0, 45).map(({ cellId, page }) => `${cellId}:${page}`)).toEqual(frozen.cells.map(({ cellId }) => `${cellId}:1`))
    expect(transport.calls.slice(45).map(({ cellId, page }) => `${cellId}:${page}`)).toEqual(['year-1980:2', 'year-1990:2', 'year-2000:2', 'year-2010:2', 'year-2020:2'])
    const gate = events.findIndex(({ type }) => type === 'page1-gate-complete')
    const plan = events.findIndex(({ type }) => type === 'pagination-plan-persisted')
    const page2 = events.findIndex(({ type, request }) => type === 'dispatch-start' && request.page === 2)
    expect(gate).toBeLessThan(plan)
    expect(plan).toBeLessThan(page2)
    expect(result.maxConcurrency).toBe(1)
    expect(transport.maxActive).toBe(1)
    const wal = await recoverWal(v3Stage1ArtifactPaths(artifactDir).wal)
    const intents = wal.records.filter(({ lifecycle }) => lifecycle === 'INTENT')
    expect(intents).toHaveLength(50)
    expect(intents.slice(0, 45).every(({ requestScope, requestPurpose, candidateId, arm, drawIndex }) => requestScope === 'universe' && requestPurpose === 'page1-gate' && candidateId === null && arm === null && drawIndex === null)).toBe(true)
    expect(intents.slice(45).every(({ requestPurpose }) => requestPurpose === 'page2-enumeration')).toBe(true)
  })

  it('stops immediately on annual budget and invalid empty-cell gates', async () => {
    const over = payloads()
    over.set('year-1983:1', { page: 1, total_pages: 51, total_results: 1001, results: [] })
    let run = await runSynthetic({ source: over })
    expect(run.result).toMatchObject({ status: V3_STATUSES.budget, blockedCell: 'year-1983', dispatchedRequests: 4 })
    expect(run.transport.calls.every(({ page }) => page === 1)).toBe(true)

    const invalid = payloads()
    invalid.set('year-1980:1', { page: 1, total_pages: 0, total_results: 1, results: [syntheticMovie(frozen.cells[0], 1)] })
    run = await runSynthetic({ source: invalid })
    expect(run.result).toMatchObject({ status: V3_STATUSES.empty, dispatchedRequests: 1 })
    expect(await pathExists(v3Stage1ArtifactPaths(run.artifactDir).registry)).toBe(false)
  })

  it('treats malformed and HTTP provider responses as OI with no retry', async () => {
    const source = payloads()
    const clock = fakeClock()
    const transport = fakeTransport(source, { clock, mutate: (value, request) => request.cellId === 'year-1980' ? { page: 1 } : value })
    let run = await runSynthetic({ source, clock, transport })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'INVALID_DISCOVERY_PAYLOAD', dispatchedRequests: 1 })
    expect(transport.calls).toHaveLength(1)
    expect(await pathExists(v3Stage1ArtifactPaths(run.artifactDir).registry)).toBe(false)

    const httpCalls = []
    run = await runSynthetic({ transport: { async dispatch(request) { httpCalls.push(request); return { ok: false, status: 503, body: '{}' } } } })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'TMDB_HTTP_FAILURE', dispatchedRequests: 1 })
    expect(httpCalls).toHaveLength(1)
  })

  it('fails plan persistence before any page-2 dispatch and rejects persisted tamper on replay', async () => {
    let injected = false
    const first = await runSynthetic({ onArtifactStep: (step, path) => {
      if (!injected && path.endsWith('pagination-plan.json') && step === 'artifact-temp-fsync-complete') { injected = true; throw new Error('synthetic rename boundary') }
    } })
    expect(first.result).toMatchObject({ status: V3_STATUSES.inconclusive, dispatchedRequests: 45 })
    expect(first.transport.calls.every(({ page }) => page === 1)).toBe(true)

    const secondDir = await tempArtifacts()
    const events = []
    const stopAtPage2 = await runSynthetic({ artifactDir: secondDir, beforeDispatch: async (request) => {
      if (request.page === 2) throw new Error('pre-dispatch stop')
      return request
    }, onEvent: (event) => events.push(event) })
    expect(stopAtPage2.result.dispatchedRequests).toBe(45)
    const paths = v3Stage1ArtifactPaths(secondDir)
    const stored = JSON.parse(await readFile(paths.plan, 'utf8'))
    stored.paginationPlan.entries[0].total_results++
    await writeFile(paths.plan, JSON.stringify(stored))
    const resumedTransport = fakeTransport(payloads())
    const resumed = await runSynthetic({ artifactDir: secondDir, controlledResume: true, transport: resumedTransport })
    expect(resumed.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_CONTEXT_MISMATCH', dispatchedRequests: 0 })
    expect(resumedTransport.calls).toHaveLength(0)
  })

  it('enforces 249/250 ms dispatch-start boundaries with no first-dispatch delay', async () => {
    const source = payloads({ page2Cells: [] })
    let clock = fakeClock()
    let transport = fakeTransport(source, { clock, advance: 249 })
    let run = await runSynthetic({ source, clock, transport })
    expect(run.result.status).toBe(V3_STATUSES.complete)
    expect(clock.sleeps[0]).toBe(1)
    expect(clock.sleeps.every((value) => value === 1)).toBe(true)

    clock = fakeClock()
    transport = fakeTransport(source, { clock, advance: 250 })
    run = await runSynthetic({ source, clock, transport })
    expect(run.result.status).toBe(V3_STATUSES.complete)
    expect(clock.sleeps).toEqual([])
    expect(V3_STAGE1_MIN_DISPATCH_INTERVAL_MS).toBe(250)
  })

  it('rechecks monotonic time when sleep advances less than requested', async () => {
    const source = payloads({ page2Cells: [] })
    const clock = fakeClock()
    const requestedSleeps = []
    const starts = []
    const transport = fakeTransport(source, { clock, advance: 0 })
    const run = await runSynthetic({
      source, clock, transport,
      sleep: async (requested) => {
        requestedSleeps.push(requested)
        clock.advance(Math.min(100, requested))
      },
      onEvent: (event) => { if (event.type === 'dispatch-start') starts.push(event.startedAt) },
    })
    expect(run.result.status).toBe(V3_STATUSES.complete)
    expect(requestedSleeps.slice(0, 3)).toEqual([250, 150, 50])
    expect(starts.slice(1).every((value, index) => value - starts[index] >= 250)).toBe(true)
  })

  it('reports frozen pagination drift without adding dynamic pages', async () => {
    for (const field of ['total_pages', 'total_results']) {
      const source = payloads({ page2Cells: ['year-1980'] })
      source.get('year-1980:2')[field]++
      const { result, transport } = await runSynthetic({ source })
      expect(result).toMatchObject({ status: V3_STATUSES.drift, blockedCell: 'year-1980', page: 2 })
      expect(transport.calls.at(-1)).toMatchObject({ cellId: 'year-1980', page: 2 })
      expect(transport.calls).toHaveLength(46)
    }
  })
})

describe('C1b-V3 Stage 1B WAL recovery and lifecycle faults', () => {
  it('ignores a replacement returned by beforeDispatch and sends the original frozen request', async () => {
    const source = payloads({ page2Cells: [] })
    const clock = fakeClock()
    const transport = fakeTransport(source, { clock })
    const run = await runSynthetic({ source, clock, transport, beforeDispatch: async (request) => ({ ...request, page: 99, params: { ...request.params, page: 99, region: 'US' } }) })
    expect(run.result.status).toBe(V3_STATUSES.complete)
    expect(transport.calls[0]).toEqual(buildAnnualPageRequest(frozen, 'year-1980', 1))
    expect(transport.calls.some(({ page, params }) => page === 99 || Object.hasOwn(params, 'region'))).toBe(false)
  })

  it('records provably-not-dispatched pre-dispatch failure with zero transport calls', async () => {
    const run = await runSynthetic({ beforeDispatch: async () => { throw new Error('synthetic pre-dispatch failure') } })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'PROVABLY_NOT_DISPATCHED', dispatchedRequests: 0 })
    expect(run.transport.calls).toHaveLength(0)
    const wal = await recoverWal(v3Stage1ArtifactPaths(run.artifactDir).wal)
    const attempt = classifyAttempt(wal.records, wal.records[0].attemptId)
    expect(attempt.status).toBe('PROVABLY_NOT_DISPATCHED')
  })

  it('keeps INTENT fsync failure before dispatch and blocks replay without redispatch', async () => {
    let fired = false
    const first = await runSynthetic({ onWalStep: (step) => {
      if (!fired && step === 'intent-fsync-start') { fired = true; throw new Error('intent fsync') }
    } })
    expect(first.result).toMatchObject({ status: V3_STATUSES.inconclusive, dispatchedRequests: 0 })
    const resumedTransport = fakeTransport(payloads())
    const second = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, transport: resumedTransport })
    expect(second.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'UNKNOWN_IN_FLIGHT', dispatchedRequests: 0 })
    expect(resumedTransport.calls).toHaveLength(0)
  })

  it('classifies a post-entry throw as UNKNOWN_IN_FLIGHT and never redispatches', async () => {
    const source = payloads()
    const firstTransport = fakeTransport(source, { throwOn: 'year-1980:1' })
    const first = await runSynthetic({ source, transport: firstTransport })
    expect(first.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'UNKNOWN_IN_FLIGHT', dispatchedRequests: 1 })
    const resumedTransport = fakeTransport(source)
    const second = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, source, transport: resumedTransport })
    expect(second.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'UNKNOWN_IN_FLIGHT', dispatchedRequests: 0 })
    expect(resumedTransport.calls).toHaveLength(0)
  })

  it('recovers durable RESPONSE and incomplete TERMINAL without redispatch', async () => {
    for (const failedStep of ['response-fsync-start', 'terminal-fsync-start']) {
      let fired = false
      const first = await runSynthetic({ onWalStep: (step) => {
        if (!fired && step === failedStep) { fired = true; throw new Error(failedStep) }
      } })
      expect(first.result).toMatchObject({ status: V3_STATUSES.inconclusive, dispatchedRequests: 1 })
      const resumedTransport = fakeTransport(payloads())
      const second = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, transport: resumedTransport })
      expect(second.result.status).toBe(V3_STATUSES.complete)
      expect(second.result.dispatchedRequests).toBe(49)
      expect(resumedTransport.calls).toHaveLength(49)
    }
  })

  it('replays a completely durable run with zero transport dispatches', async () => {
    const first = await runSynthetic()
    expect(first.result.status).toBe(V3_STATUSES.complete)
    const resumedTransport = fakeTransport(payloads())
    const second = await runSynthetic({ artifactDir: first.artifactDir, controlledResume: true, transport: resumedTransport })
    expect(second.result).toMatchObject({ status: V3_STATUSES.complete, dispatchedRequests: 0 })
    expect(resumedTransport.calls).toHaveLength(0)
    expect(second.result.sourceSnapshotHash).toBe(first.result.sourceSnapshotHash)
    expect(second.clock.sleeps).toEqual([])
  })

  it('fails closed on WAL corruption and torn trailing frames with zero dispatch', async () => {
    for (const walText of ['not-json\n', '{"lifecycle":"INTENT"']) {
      const artifactDir = await tempArtifacts()
      await mkdir(artifactDir)
      const paths = v3Stage1ArtifactPaths(artifactDir)
      await acquireRunLock(paths.lock, { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId, timestamp, runnerVersion: V3_STAGE1_RUNNER_VERSION, exclusionManifestHash: exclusions().exclusionManifestHash })
      await writeFile(paths.wal, walText)
      const transport = fakeTransport(payloads())
      const { result } = await runSynthetic({ artifactDir, controlledResume: true, transport })
      expect(result.status).toBe(V3_STATUSES.inconclusive)
      expect(['WAL_CORRUPTION', 'TORN_TRAILING_RECORD']).toContain(result.reason)
      expect(result.dispatchedRequests).toBe(0)
      expect(transport.calls).toHaveLength(0)
    }
  })
})

describe('C1b-V3 Stage 1B recovered-WAL context binding', () => {
  const page1Identity = () => buildV3UniverseRequestIdentity({
    frozen,
    request: buildAnnualPageRequest(frozen, 'year-1980', 1),
    invocationId,
    timestamp,
    phase: 'page1',
  })

  it.each([
    ['foreign study', (identity) => ({ ...identity, studyId: 'foreign-study' })],
    ['foreign invocation', () => buildV3UniverseRequestIdentity({ frozen, request: buildAnnualPageRequest(frozen, 'year-1980', 1), invocationId: 'foreign-invocation', timestamp, phase: 'page1' })],
    ['wrong requestHash', (identity) => ({ ...identity, requestHash: `sha256:${'f'.repeat(64)}` })],
  ])('rejects a valid Stage-0 chain with %s before dispatch', async (_label, alter) => {
    const prepared = await prepareControlledResume({ identity: alter(page1Identity()) })
    const transport = fakeTransport(payloads())
    const run = await runSynthetic({ artifactDir: prepared.artifactDir, controlledResume: true, exclusionManifest: prepared.manifest, transport })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_CONTEXT_MISMATCH', dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(0)
  })

  it('rejects a page-2 WAL attempt when no frozen pagination plan exists', async () => {
    const plan = paginationPlanFor(2)
    const request = buildAnnualPageRequest(frozen, 'year-1980', 2, { phase: 'page2', paginationPlan: plan })
    const identity = buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase: 'page2', paginationPlan: plan })
    const prepared = await prepareControlledResume({ identity })
    const transport = fakeTransport(payloads())
    const run = await runSynthetic({ artifactDir: prepared.artifactDir, controlledResume: true, exclusionManifest: prepared.manifest, transport })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_CONTEXT_MISMATCH', dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(0)
  })

  it('rejects a V3-shaped page attempt not authorized by the persisted plan', async () => {
    const identityPlan = paginationPlanFor(3)
    const persistedPlan = paginationPlanFor(2)
    const request = buildAnnualPageRequest(frozen, 'year-1980', 3, { phase: 'page2', paginationPlan: identityPlan })
    const identity = buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase: 'page2', paginationPlan: identityPlan })
    const prepared = await prepareControlledResume({ identity, plan: persistedPlan })
    const transport = fakeTransport(payloads())
    const run = await runSynthetic({ artifactDir: prepared.artifactDir, controlledResume: true, exclusionManifest: prepared.manifest, transport })
    expect(run.result).toMatchObject({ status: V3_STATUSES.inconclusive, reason: 'RUN_CONTEXT_MISMATCH', dispatchedRequests: 0 })
    expect(transport.calls).toHaveLength(0)
  })
})

describe('C1b-V3 Stage 1B snapshot and registry boundaries', () => {
  it('persists the complete canonical source snapshot before selection, retaining empty page 1', async () => {
    const events = []
    const run = await runSynthetic({ onEvent: (event) => events.push(event) })
    const snapshot = JSON.parse(await readFile(v3Stage1ArtifactPaths(run.artifactDir).snapshot, 'utf8'))
    expect(snapshot.rawResponseCorpus.find(({ cellId }) => cellId === 'year-1981')).toMatchObject({ requestedPage: 1, response: { page: 1, total_pages: 0, total_results: 0, results: [] } })
    expect(snapshot.requestManifest.map(({ cellId, page }) => `${cellId}:${page}`)).toEqual([...snapshot.requestManifest].sort((a, b) => Number(a.cellId.slice(-4)) - Number(b.cellId.slice(-4)) || a.page - b.page).map(({ cellId, page }) => `${cellId}:${page}`))
    expect(events.findIndex(({ type }) => type === 'source-snapshot-persisted')).toBeLessThan(events.findIndex(({ type }) => type === 'post-freeze-selection-start'))
  })

  it('does no selection and writes no registry if source snapshot persistence fails', async () => {
    const events = []
    let fired = false
    const run = await runSynthetic({ onEvent: (event) => events.push(event), onArtifactStep: (step, path) => {
      if (!fired && path.endsWith('source-snapshot.json') && step === 'artifact-temp-write-complete') { fired = true; throw new Error('snapshot fsync boundary') }
    } })
    expect(run.result.status).toBe(V3_STATUSES.inconclusive)
    expect(events.some(({ type }) => type === 'post-freeze-selection-start')).toBe(false)
    expect(await pathExists(v3Stage1ArtifactPaths(run.artifactDir).registry)).toBe(false)
  })

  it('writes a registry only for exact synthetic 180-candidate completion', async () => {
    const success = await runSynthetic()
    expect(success.result).toMatchObject({ status: V3_STATUSES.complete, maxConcurrency: 1 })
    expect(success.result.selection.finalCandidateCount).toBe(180)
    expect(await pathExists(v3Stage1ArtifactPaths(success.artifactDir).registry)).toBe(true)

    const source = payloads()
    source.get('year-1990:1').results.pop()
    source.get('year-1990:1').total_results--
    source.get('year-1990:2').total_results--
    const blocked = await runSynthetic({ source })
    expect(blocked.result.status).toBe(V3_STATUSES.insufficient)
    expect(await pathExists(v3Stage1ArtifactPaths(blocked.artifactDir).registry)).toBe(false)
  })

  it('uses only injected fake transport and leaves registered V2/V3 sources unchanged', async () => {
    const run = await runSynthetic()
    expect(run.result.status).toBe(V3_STATUSES.complete)
    expect(run.transport.calls).toHaveLength(50)
    const checks = [
      ['catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json', '3568b8fd4f2895ab4b9e2cdba145e501e737c784d08a948491413de47483b374'],
      ['catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.contracts.json', '072b538edcda6b17ff8997d5b5ec2a9fd46029d54d68e0ee7e6c01295b530fdc'],
    ]
    for (const [path, hash] of checks) expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(hash)
    expect(canonicalize(run.result.selection)).not.toContain('Authorization')
  })
})
