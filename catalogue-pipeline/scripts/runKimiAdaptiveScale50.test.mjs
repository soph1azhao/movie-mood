import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_FLAG, RUN_ID, SCHEMA_HASH, STATES, buildScale50Preflight, launchAdaptiveScale50, runAdaptiveScale50, summarizeScale50 } from './runKimiAdaptiveScale50.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access') })))
afterEach(() => vi.unstubAllGlobals())

function semanticOutput({ valid = true, boundaryFlags = [] } = {}) {
  const evidence = () => ({ rationale: 'A sufficiently detailed factual rationale.', sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: valid ? 'a sufficiently long factual cue' : 'short' }] } })
  return { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence() }, situations: { alone: evidence() }, pace: evidence(), emotionalWeight: evidence(), attentionDemand: evidence(), discoveryStyle: evidence() }, boundaryFlags }
}
function okResponse(output, usage = [10, 20, 7, 30]) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[3], completion_tokens_details: { reasoning_tokens: usage[2] } } }) } }
function httpFailure(status) { return { ok: false, status, headers: { get: () => null }, text: async () => '' } }

async function fixture() {
  const pipelineRoot = await mkdtemp(join(tmpdir(), 'scale50-')); const candidates = Array.from({ length: 50 }, (_, index) => ({ selectionIndex: index, candidateId: `candidate-${index}`, tmdbId: 1000 + index, evidencePacketHash: `sha256:${String(index).padStart(64, '0')}` }))
  const scaleManifest = { batchId: 'scale-50-v1', sourceCandidateManifestHash: 'sha256:ec6238081a234a67fc249676b27c9c7a6dca4135d03a525a22950b43a622b61e', scaleManifestHash: 'sha256:fixture', candidates }
  const prompt = 'fixture semantic classifier prompt'; const fallbackRead = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const readJsonFile = async (path) => path.endsWith('scale-50-v1/candidate-manifest.json') ? scaleManifest : path.includes('expansion-100-v1/evidence-packets/') ? (() => { const candidate = candidates.find(({ candidateId }) => path.endsWith(`${candidateId}.json`)); return { schemaVersion: 'evidence-packet.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, inputHash: candidate.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} } })() : fallbackRead(path)
  return { pipelineRoot, readJsonFile, readTextFile: async () => prompt, fileExists: async (path) => { try { await readFile(path); return true } catch { return false } }, cleanup: () => rm(pipelineRoot, { recursive: true, force: true }) }
}

describe('Kimi adaptive Scale-50 orchestrator', () => {
  it('preflights without credentials or HTTP and binds distinct High/Max schema identities', async () => {
    const f = await fixture(); const fetchImpl = vi.fn()
    try {
      const result = await launchAdaptiveScale50([], { ...f, fetchImpl }); expect(result.executionAuthorized).toBe(false); expect(fetchImpl).not.toHaveBeenCalled()
      expect(result.preflight).toMatchObject({ runId: RUN_ID, semanticOutputSchemaHash: SCHEMA_HASH, candidateCount: 50, highPendingCandidates: 50, freshCandidatesRemaining: 50 })
      const context = await buildScale50Preflight(f); const high = context.cache.get('candidate-0:high'); const max = context.cache.get('candidate-0:max'); expect(high.cacheKey).not.toBe(max.cacheKey)
      expect(AUTHORIZATION_FLAG).toBe('--execute-authorized-scale-50')
    } finally { await f.cleanup() }
  })

  it('completes valid High without invoking Max and reports non-duplicated usage', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValue(okResponse(semanticOutput({ boundaryFlags: [{ code: 'BOUNDARY_FLAG', fields: ['pace'], message: 'A sufficiently detailed boundary message.', reviewRequired: true }] })))
    try {
      const { manifest } = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 2, now: (() => { let n = 0; return () => ++n })() })
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reasoning_effort).toBe('high')
      expect(manifest.states['candidate-0']).toMatchObject({ status: STATES.highValid, semanticAttempts: { high: 1, max: 0 }, httpRequests: 1, boundaryFlagCount: 1 })
      expect(manifest.summary).toMatchObject({ counts: { highFirstPassValid: 1, maxEscalations: 0, completedTotal: 1 }, usage: { high: { total_tokens: 30 }, max: { total_tokens: 0 }, combined: { total_tokens: 30 } }, requestsPerCompletedFilm: 1 })
    } finally { await f.cleanup() }
  })

  it('escalates only a completed High semantic failure and can recover with Max', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse(semanticOutput({ valid: false }), [10, 10, 4, 20])).mockResolvedValueOnce(okResponse(semanticOutput(), [11, 21, 8, 32]))
    try {
      const { manifest } = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 2, delayFn: async () => {} })
      expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).reasoning_effort)).toEqual(['high', 'max'])
      expect(manifest.states['candidate-0']).toMatchObject({ status: STATES.maxValid, semanticAttempts: { high: 1, max: 1 }, highSemanticFailure: expect.any(Object), maxEligibleAt: expect.any(String) })
      expect(manifest.summary).toMatchObject({ counts: { highSemanticValidationFailures: 1, maxEscalations: 1, maxRecoveries: 1 }, usage: { high: { total_tokens: 20 }, max: { total_tokens: 32 }, combined: { total_tokens: 52 } } })
    } finally { await f.cleanup() }
  })

  it('makes invalid Max terminal and enforces the exact HTTP cap', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValue(okResponse(semanticOutput({ valid: false })))
    try {
      const first = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(first.manifest.states['candidate-0'].status).toBe(STATES.highSemanticFailedMaxPending)
      const second = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 0, maxHttpRequests: 1 }); expect(fetchImpl).toHaveBeenCalledTimes(2); expect(second.manifest.states['candidate-0'].status).toBe(STATES.terminalSemanticFailure)
    } finally { await f.cleanup() }
  })

  it('keeps provider failure on High and never escalates it to Max', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValue(httpFailure(401))
    try {
      const { manifest } = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 2 })
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(manifest.states['candidate-0']).toMatchObject({ status: STATES.terminalProviderFailure, failedEffort: 'high', semanticAttempts: { high: 1, max: 0 }, providerFailure: { httpStatus: 401, retryable: false } })
    } finally { await f.cleanup() }
  })

  it('uses bounded High transport retry and counts each HTTP request', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValueOnce(httpFailure(429)).mockResolvedValueOnce(okResponse(semanticOutput()))
    try {
      const { manifest } = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 2, delayFn: async () => {} })
      expect(fetchImpl).toHaveBeenCalledTimes(2); expect(manifest.httpRequests).toBe(2); expect(manifest.states['candidate-0']).toMatchObject({ status: STATES.highValid, transportRetries: 1, semanticAttempts: { high: 1, max: 0 } })
    } finally { await f.cleanup() }
  })

  it('persists retryable High provider failure without Max escalation', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValue(httpFailure(429))
    try {
      const { manifest } = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 })
      expect(fetchImpl).toHaveBeenCalledTimes(1); expect(manifest.states['candidate-0']).toMatchObject({ status: STATES.retryableProviderFailure, failedEffort: 'high', semanticAttempts: { high: 1, max: 0 }, providerFailure: { retryable: true, httpStatus: 429 } })
      expect(manifest.summary.counts.maxEscalations).toBe(0)
    } finally { await f.cleanup() }
  })

  it('resume never duplicates a valid candidate request', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockResolvedValue(okResponse(semanticOutput()))
    try {
      await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 })
      await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 })
      const dispatchedCandidates = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).messages[0].content).map(JSON.parse).map((input) => input.evidencePacket.candidateId)
      expect(dispatchedCandidates).toEqual(['candidate-0', 'candidate-1'])
    } finally { await f.cleanup() }
  })

  it('surfaces an ambiguous dispatch and resume never silently redispatches it', async () => {
    const f = await fixture(); const fetchImpl = vi.fn().mockRejectedValue(new Error('connection outcome unknown'))
    try {
      const first = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 }); expect(first.manifest.states['candidate-0'].status).toBe(STATES.uncertain); expect(fetchImpl).toHaveBeenCalledTimes(1)
      const second = await runAdaptiveScale50({ ...f, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 1 }); expect(second.manifest.states['candidate-0'].status).toBe(STATES.uncertain); expect(fetchImpl).toHaveBeenCalledTimes(2)
      const dispatchedCandidates = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).messages[0].content).map(JSON.parse).map((input) => input.evidencePacket.candidateId)
      expect(dispatchedCandidates).toEqual(['candidate-0', 'candidate-1'])
    } finally { await f.cleanup() }
  })

  it('summary separates High and Max tokens, including thinking tokens', () => {
    const manifest = { httpRequests: 2, states: { a: { status: STATES.maxValid, maxEligibleAt: 't', highSemanticFailure: {}, boundaryFlagCount: 2, latencyMs: 20, usage: { high: { prompt_tokens: 3, completion_tokens: 5, thinking_tokens: 2, total_tokens: 8 }, max: { prompt_tokens: 4, completion_tokens: 9, thinking_tokens: 6, total_tokens: 13 } } } } }
    expect(summarizeScale50(manifest)).toMatchObject({ usage: { high: { thinking_tokens: 2, total_tokens: 8 }, max: { thinking_tokens: 6, total_tokens: 13 }, combined: { thinking_tokens: 8, total_tokens: 21 } }, counts: { highAttempts: 0, maxEscalations: 1, maxRecoveries: 1 }, highFirstPassValidityRate: null, maxEscalationRateAmongHighAttempts: null, maxEscalationsAsFractionOfManifest: 1, maxRecoveryRate: 1 })
  })

  it('uses High-attempted rather than pending manifest candidates for operational rates', () => {
    const highValid = (candidateId) => ({ candidateId, status: STATES.highValid, semanticAttempts: { high: 1, max: 0 }, usage: { high: {}, max: {} } })
    const states = Object.fromEntries([
      ['high-1', highValid('high-1')], ['high-2', highValid('high-2')], ['high-3', highValid('high-3')],
      ['max-recovered', { candidateId: 'max-recovered', status: STATES.maxValid, semanticAttempts: { high: 1, max: 1 }, maxEligibleAt: '2026-01-01T00:00:00.000Z', highSemanticFailure: {}, usage: { high: {}, max: {} } }],
      ...Array.from({ length: 46 }, (_, index) => [`pending-${index}`, { candidateId: `pending-${index}`, status: STATES.pendingHigh, semanticAttempts: { high: 0, max: 0 }, usage: { high: {}, max: {} } }]),
    ])
    const summary = summarizeScale50({ httpRequests: 5, states })
    expect(summary).toMatchObject({ counts: { highAttempts: 4, highFirstPassValid: 3, maxEscalations: 1, maxRecoveries: 1, pendingTotal: 46 }, highFirstPassValidityRate: 0.75, maxEscalationRateAmongHighAttempts: 0.25, maxEscalationsAsFractionOfManifest: 0.02, maxRecoveryRate: 1 })
    expect(summary).not.toHaveProperty('maxEscalationRate')
  })
})
