import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendWalRecord, canonicalSha256, createWalRecord, recoverWal, WAL_GENESIS_HASH } from '../scripts/c1bV2Stage0.mjs'
import { V4_STAGE2_AUTHORIZATION, V4_STAGE2_BLOCKED, V4_STAGE2_PRELIVE_FAILED, buildCoverageResult, classifyStage2Result, createWalBackedFetch, executeStage2Candidate, lockfileResolutionIdentity, projectFrozenCandidates, runV4Stage2, stage2Paths, verifyV4Stage2Jit } from './c1bV4Stage2Runner.mjs'

const temporary = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function tempPaths() { const root = await mkdtemp(resolve(tmpdir(), 'c1b-v4-stage2-')); temporary.push(root); await mkdir(root, { recursive: true }); return stage2Paths(process.cwd(), root) }
const candidate = { candidateId: 'tmdb:1', tmdbId: 1, title: 'Synthetic Film', year: 2018, director: undefined, frozenFacts: { id: 1, title: 'Synthetic Film', release_date: '2018-01-01', vote_count: 300, original_language: 'en', genre_ids: [18] } }
const response = (payload, status = 200) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload) })
const viableResponses = (wordCount = 160) => [
  response({ query: { pages: [{ pageid: 10, title: 'Synthetic Film (2018 film)', revisions: [{ revid: 20 }], pageprops: {} }] } }),
  response({ parse: { sections: [{ index: '1', line: 'Plot' }, { index: '2', line: 'Reception' }] } }),
  response({ parse: { text: { '*': `<p>${Array.from({ length: wordCount }, (_, index) => `w${index}`).join(' ')}.</p>` } } }),
]
function mockFetch(responses) { let index = 0; return vi.fn(async () => responses[index++]) }
const identity = (invocationId = 'test-run') => ({ studyId: 'phase-5c-c1b-v-confirmatory.v4', invocationId, attemptId: `${invocationId}|stage2|tmdb:1|http-0`, stage: 2, requestScope: 'candidate', requestPurpose: 'wikipedia-http-0', requestHash: canonicalSha256({ url: 'https://en.wikipedia.org/test', method: 'GET', headers: {} }), attemptOrdinal: 0, timestamp: '2026-09-12T00:00:00.000Z', scopeId: null, candidateId: 'tmdb:1', arm: null, drawIndex: null })

describe('C1b-V4 Stage-2 WAL-backed transport', () => {
  it('replays a completed HTTP attempt with zero new transport and no raw body in WAL', async () => {
    const paths = await tempPaths(); const body = { privateProse: 'raw wikipedia prose must remain cache-only' }; const baseFetch = mockFetch([response(body)])
    const args = { walPath: paths.wal, cacheDir: paths.cache, candidate, invocationId: 'test-run', timestamp: '2026-09-12T00:00:00.000Z' }
    expect(await (createWalBackedFetch({ ...args, baseFetch }))('https://en.wikipedia.org/test')).toMatchObject({ ok: true, status: 200 })
    const replayTransport = vi.fn()
    const replay = await (createWalBackedFetch({ ...args, baseFetch: replayTransport }))('https://en.wikipedia.org/test')
    expect(await replay.json()).toEqual(body); expect(replayTransport).not.toHaveBeenCalled(); expect(baseFetch).toHaveBeenCalledTimes(1)
    expect(await readFile(paths.wal, 'utf8')).not.toContain('raw wikipedia prose')
  })

  it('never redispatches UNKNOWN_IN_FLIGHT', async () => {
    const paths = await tempPaths(); const record = createWalRecord({ lifecycle: 'INTENT', identity: identity(), seq: 0, prevRecordHash: WAL_GENESIS_HASH }); await appendWalRecord(paths.wal, record)
    const baseFetch = vi.fn(); const fetchImpl = createWalBackedFetch({ walPath: paths.wal, cacheDir: paths.cache, candidate, invocationId: 'test-run', timestamp: '2026-09-12T00:00:00.000Z', baseFetch })
    await expect(fetchImpl('https://en.wikipedia.org/test')).rejects.toMatchObject({ code: 'UNKNOWN_IN_FLIGHT' }); expect(baseFetch).not.toHaveBeenCalled()
  })

  it('fails closed when a cached response body no longer matches its hash', async () => {
    const paths = await tempPaths(); const args = { walPath: paths.wal, cacheDir: paths.cache, candidate, invocationId: 'test-run', timestamp: '2026-09-12T00:00:00.000Z' }
    await (createWalBackedFetch({ ...args, baseFetch: mockFetch([response({ ok: true })]) }))('https://en.wikipedia.org/test')
    const record = (await recoverWal(paths.wal)).records.find(({ lifecycle }) => lifecycle === 'RESPONSE'); await writeFile(resolve(paths.cache, record.payload.response.bodyFile), '{}')
    const replayTransport = vi.fn(); await expect((createWalBackedFetch({ ...args, baseFetch: replayTransport }))('https://en.wikipedia.org/test')).rejects.toMatchObject({ code: 'RESPONSE_CACHE_HASH_MISMATCH' }); expect(replayTransport).not.toHaveBeenCalled()
  })
})

describe('C1b-V4 Stage-2 outcome and completion semantics', () => {
  it('classifies synthetic viable and below-threshold evidence without changing policy', async () => {
    for (const [words, status] of [[160, 'VIABLE'], [149, 'NON_VIABLE']]) {
      const paths = await tempPaths(); const exposureRecords = []; const privateEvidence = []
      const row = await executeStage2Candidate({ candidate, paths, invocationId: `run-${words}`, timestamp: '2026-09-12T00:00:00.000Z', baseFetch: mockFetch(viableResponses(words)), exposureRecords, privateEvidence })
      expect(row.terminalStatus).toBe(status); expect(exposureRecords).toHaveLength(1); expect(privateEvidence).toHaveLength(status === 'VIABLE' ? 1 : 0)
    }
  })

  it('classifies identity-unresolved and no-section as NON_VIABLE', async () => {
    const unresolvedPaths = await tempPaths(); const unresolved = await executeStage2Candidate({ candidate, paths: unresolvedPaths, invocationId: 'unresolved', timestamp: '2026-09-12T00:00:00.000Z', baseFetch: mockFetch([response({ query: { pages: [{ title: 'Synthetic Film', missing: true }] } })]), exposureRecords: [], privateEvidence: [] })
    expect(unresolved).toMatchObject({ terminalStatus: 'NON_VIABLE', failureReason: 'IDENTITY_UNRESOLVED' })
    const noSectionPaths = await tempPaths(); const noSection = await executeStage2Candidate({ candidate, paths: noSectionPaths, invocationId: 'no-section', timestamp: '2026-09-12T00:00:00.000Z', baseFetch: mockFetch([viableResponses()[0], response({ parse: { sections: [{ index: '1', line: 'Plot' }] } })]), exposureRecords: [], privateEvidence: [] })
    expect(noSection).toMatchObject({ terminalStatus: 'NON_VIABLE', failureReason: 'NO_MATCHING_SECTION' })
  })

  it.each([
    ['HTTP failure', [response({}, 500)]],
    ['parse failure', [response('{')]],
  ])('%s remains technical rather than NON_VIABLE', async (_name, responses) => {
    const paths = await tempPaths(); await expect(executeStage2Candidate({ candidate, paths, invocationId: `technical-${_name}`, timestamp: '2026-09-12T00:00:00.000Z', baseFetch: mockFetch(responses), exposureRecords: [], privateEvidence: [] })).rejects.toBeInstanceOf(Error)
  })

  it('exposure persistence failure remains technical', async () => {
    const paths = await tempPaths(); await mkdir(paths.exposure)
    await expect(executeStage2Candidate({ candidate, paths, invocationId: 'exposure-fail', timestamp: '2026-09-12T00:00:00.000Z', baseFetch: mockFetch(viableResponses()), exposureRecords: [], privateEvidence: [] })).rejects.toMatchObject({ code: 'EXPOSURE_PERSISTENCE_FAILED' })
  })

  it('cannot emit final coverage before 180 determinate outcomes', () => {
    expect(() => buildCoverageResult([candidate], [{ candidateId: candidate.candidateId, terminalStatus: 'VIABLE' }], [], [])).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_COVERAGE' }))
    expect(() => classifyStage2Result({ failureReason: 'PARSE_FAILED' })).toThrowError()
  })

  it('keeps raw prose out of the committable coverage result', () => {
    const candidates = Array.from({ length: 180 }, (_, index) => ({ ...candidate, candidateId: `tmdb:${index + 1}`, frozenFacts: { ...candidate.frozenFacts, id: index + 1 } }))
    const rows = candidates.map(({ candidateId }) => ({ candidateId, terminalStatus: 'VIABLE', failureReason: null, identityResolved: true, allowedSection: true }))
    const coverage = buildCoverageResult(candidates, rows, [], [{ candidateId: 'tmdb:1', text: 'private raw prose marker' }])
    expect(JSON.stringify(coverage)).not.toContain('private raw prose marker'); expect(coverage.rawWikipediaProseIncluded).toBe(false)
  })
})

describe('C1b-V4 Stage-2 pre-live gate and lock order', () => {
  it('passes the registered JIT gate without dispatch', async () => {
    const frozen = Buffer.from('importers:\n  .:\n    dependencies:\n      vite:\n        specifier: latest\n        version: 8.2.2\npackages:\n  vite@8.2.2:\n    resolution: {integrity: sha512-frozen}\n')
    const maintained = Buffer.from('importers:\n  .:\n    dependencies:\n      vite:\n        specifier: ^8.2.2\n        version: 8.2.2\npackages:\n  vite@8.2.2:\n    resolution: {integrity: sha512-frozen}\n')
    const drifted = Buffer.from('importers:\n  .:\n    dependencies:\n      vite:\n        specifier: ^8.3.0\n        version: 8.3.0\npackages:\n  vite@8.3.0:\n    resolution: {integrity: sha512-drifted}\n')
    expect(lockfileResolutionIdentity(maintained)).toBe(lockfileResolutionIdentity(frozen))
    expect(lockfileResolutionIdentity(drifted)).not.toBe(lockfileResolutionIdentity(frozen))
    const paths = await tempPaths(); const result = await verifyV4Stage2Jit({ paths }); expect(result.candidates).toHaveLength(180); expect(result.closure.materialLocalSources).toHaveLength(6)
  })

  it.each(['SOURCE_HASH_MISMATCH', 'PROTOCOL_HASH_MISMATCH', 'CONTRACT_BUNDLE_MISMATCH', 'CLOSURE_HASH_MISMATCH', 'REGISTRY_HASH_MISMATCH'])('%s blocks before network', async (code) => {
    const parent = await mkdtemp(resolve(tmpdir(), 'c1b-v4-run-')); temporary.push(parent); const artifactDir = resolve(parent, 'live'); const baseFetch = vi.fn(); const events = []
    const result = await runV4Stage2({ artifactDir, authorization: V4_STAGE2_AUTHORIZATION, baseFetch, jitVerifier: async ({ onEvent }) => { onEvent({ type: 'jit-start' }); throw Object.assign(new Error(code), { code }) }, onEvent: (event) => events.push(event) })
    expect(result).toMatchObject({ status: V4_STAGE2_PRELIVE_FAILED, reason: code, dispatchedRequests: 0 }); expect(baseFetch).not.toHaveBeenCalled(); expect(events[0].type).toBe('lock-acquired')
  })

  it('duplicate or missing candidates fail before transport', () => {
    expect(() => projectFrozenCandidates({ candidates: [] })).toThrowError(expect.objectContaining({ code: 'CANDIDATE_COUNT_MISMATCH' }))
    const duplicate = Array.from({ length: 180 }, (_, index) => ({ id: index === 179 ? 1 : index + 1, title: `Film ${index}`, release_date: '2000-01-01' }))
    expect(() => projectFrozenCandidates({ candidates: duplicate })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_CANDIDATE' }))
  })

  it('holds RUN_LOCK through first mocked dispatch and its durable terminal', async () => {
    const parent = await mkdtemp(resolve(tmpdir(), 'c1b-v4-run-')); temporary.push(parent); const artifactDir = resolve(parent, 'live'); const paths = stage2Paths(process.cwd(), artifactDir); const events = []
    const candidates = Array.from({ length: 180 }, (_, index) => ({ ...candidate, candidateId: `tmdb:${index + 1}`, tmdbId: index + 1, title: `Synthetic ${index + 1}`, frozenFacts: { ...candidate.frozenFacts, id: index + 1, title: `Synthetic ${index + 1}` } }))
    const result = await runV4Stage2({ artifactDir, authorization: V4_STAGE2_AUTHORIZATION, baseFetch: async () => response({ query: { pages: [{ title: 'Missing', missing: true }] } }), jitVerifier: async ({ onEvent }) => { onEvent({ type: 'jit-complete' }); return { candidates } }, onEvent: (event) => events.push(event), invocationId: 'lock-order', timestamp: '2026-09-12T00:00:00.000Z' })
    expect(result.status).toBe('COMPLETE'); expect(result.coverage.nonViableWikipediaEvidenceCount).toBe(180); expect(await readFile(paths.lock, 'utf8')).toContain('lock-order')
    const types = events.map((event) => event.type === 'wal-step' ? `${event.type}:${event.step}` : event.type)
    expect(types.indexOf('lock-acquired')).toBeLessThan(types.indexOf('jit-complete')); expect(types.indexOf('jit-complete')).toBeLessThan(types.indexOf('http-dispatch')); expect(types.indexOf('http-dispatch')).toBeLessThan(types.indexOf('wal-step:terminal-fsync-complete'))
  }, 30_000)
})
