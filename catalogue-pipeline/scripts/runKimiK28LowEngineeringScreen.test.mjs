import { describe, expect, it, vi } from 'vitest'
import { ModelProviderError } from '../adapters/modelProvider.ts'
import { ALLOWED_LIMITS, REQUEST_BUDGET, RUN_ID, buildLowScreenPreflight, launchLowScreen, runLowScreen, summarizeLowScreen } from './runKimiK28LowEngineeringScreen.mjs'

const classification = { moods: ['uplifting'], situations: ['family-night'], filterLanguages: ['en'], pace: 'steady', emotionalWeight: 'moderate', attentionDemand: 'medium', discoveryStyle: 'accessible' }
function fakePreflight(state = null) {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ candidateId: `c${index}`, tmdbId: index + 1, evidencePacketHash: `sha256:e${index}`, historicalEffort: 'high', historicalLatencyMs: 100, historicalTotalTokens: 1000 }))
  return { runId: RUN_ID, definitionHash: 'sha256:def', candidates, packets: new Map(candidates.map((candidate) => [candidate.candidateId, { schemaVersion: 'evidence-packet.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, inputHash: candidate.evidencePacketHash }])), baselines: new Map(candidates.map((candidate) => [candidate.candidateId, { classification, boundaryFlags: [] }])), prompt: 'frozen prompt', promptContentHash: 'sha256:p', semanticOutputSchemaHash: 'sha256:s', runtime: { statePath: '/diagnostic/state.json', reportPath: '/diagnostic/report.json', cacheRoot: '/diagnostic/cache', outputRoot: '/diagnostic/artifacts' }, state }
}
const okFetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } } }) }))
const validClassifier = async ({ provider, outputPath, cacheRoot }) => { expect(provider.metadata.outputAffectingConfiguration.reasoningEffort).toBe('low'); expect(outputPath).toContain('/diagnostic/artifacts/'); expect(cacheRoot).toBe('/diagnostic/cache'); const raw = await provider.generateStructured({ stage: 'semantic-classifier', schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', input: {}, outputSchema: {} }); return { artifact: { outputHash: 'sha256:low', classification, boundaryFlags: [] }, providerUsageMetadata: raw.providerUsageMetadata } }
const locks = { acquireLock: vi.fn(async () => ({ path: '/diagnostic/RUN_LOCK' })), releaseLock: vi.fn(async () => {}) }

describe('Kimi K2.8 Low engineering screen', () => {
  it('freezes an exact diverse ten-film High-first-pass cohort and extracts historical usage', async () => {
    const preflight = await buildLowScreenPreflight()
    expect(preflight.candidates.map((candidate) => candidate.candidateId)).toEqual(['exp100-tmdb-36819', 'exp100-tmdb-666', 'exp100-tmdb-2440', 'exp100-tmdb-486947', 'exp100-tmdb-1156593', 'exp100-tmdb-8740', 'exp100-tmdb-11450', 'exp100-tmdb-2621', 'exp100-tmdb-381719', 'exp100-tmdb-670428'])
    expect(new Set(preflight.candidates.map((candidate) => candidate.decade))).toEqual(new Set(['1980s', '1990s', '2000s', '2010s', '2020s']))
    expect(preflight.candidates.every((candidate) => candidate.historicalEffort === 'high' && Number.isFinite(candidate.historicalTotalTokens))).toBe(true)
    expect(preflight.historicalLatencyAvailable).toBe(false)
  })

  it('uses Low only, performs one request per candidate, and never falls back', async () => {
    okFetch.mockClear(); const writes = vi.fn(); const result = await runLowScreen({ ...locks, limit: 3, env: { KIMI_API_KEY: 'mock' }, fetchImpl: okFetch, writeJsonFile: writes, buildPreflight: async () => fakePreflight(), classifyFn: validClassifier, now: (() => { let n = 0; return () => n += 10 })() })
    expect(okFetch).toHaveBeenCalledTimes(3); expect(result.report.httpRequests).toBe(3); expect(result.report.records.every((record) => record.reasoningEffort === 'low')).toBe(true)
    expect(writes.mock.calls.every(([path]) => path.startsWith('/diagnostic/'))).toBe(true)
  })

  it('unauthorized preflight performs zero HTTP calls', async () => { const fetchImpl = vi.fn(); const result = await launchLowScreen(['--limit', '3'], { fetchImpl }); expect(result.executionAuthorized).toBe(false); expect(fetchImpl).not.toHaveBeenCalled() })

  it('applies the three-film validity stop rule', async () => {
    okFetch.mockClear(); let calls = 0
    const invalidClassifier = async (args) => { const raw = await args.provider.generateStructured({ stage: 'semantic-classifier', schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', input: {}, outputSchema: {} }); calls += 1; if (calls <= 2) throw new ModelProviderError('invalid', { code: 'MALFORMED_MODEL_OUTPUT', details: { providerUsageMetadata: { total_tokens: 30 }, providerResponseDiagnostics: { jsonParsed: true } } }); return { artifact: { outputHash: 'sha256:low', classification, boundaryFlags: [] }, providerUsageMetadata: raw.providerUsageMetadata } }
    const result = await runLowScreen({ ...locks, limit: 3, env: { KIMI_API_KEY: 'mock' }, fetchImpl: okFetch, writeJsonFile: vi.fn(), buildPreflight: async () => fakePreflight(), classifyFn: invalidClassifier })
    expect(result.report.metrics.speedGate).toBe('STOP_EARLY'); expect(result.report.httpRequests).toBe(3)
  })

  it('hard-caps the full continuation at ten requests', async () => {
    okFetch.mockClear(); const result = await runLowScreen({ ...locks, limit: 10, env: { KIMI_API_KEY: 'mock' }, fetchImpl: okFetch, writeJsonFile: vi.fn(), buildPreflight: async () => fakePreflight(), classifyFn: validClassifier })
    expect(REQUEST_BUDGET).toBe(10); expect(ALLOWED_LIMITS).toEqual([3, 10]); expect(okFetch).toHaveBeenCalledTimes(10); expect(result.report.httpRequests).toBe(10)
  })

  it('keeps thinking tokens as a subset and never adds them to total tokens', () => {
    const records = [{ status: 'VALID', lowLatencyMs: 100, lowUsage: { completion_tokens: 80, thinking_tokens: 50, total_tokens: 120 }, historicalProductionEffort: 'high', historicalProductionLatencyMs: 100, historicalProductionTotalTokens: 200, comparison: { ordinalAgreement: {}, boundaryFlags: {} } }]
    const summary = summarizeLowScreen(records, 10); expect(summary.lowTotalTokenMean).toBe(120); expect(summary.tokenRatio).toBe(0.6)
  })

  it('stops the three-film gate when matched Low median latency exceeds 1.25x High', () => { const records = Array.from({ length: 3 }, () => ({ status: 'VALID', lowLatencyMs: 126, lowUsage: { total_tokens: 80 }, historicalProductionEffort: 'high', historicalProductionLatencyMs: 100, historicalProductionTotalTokens: 100, comparison: { ordinalAgreement: {}, boundaryFlags: {} } })); expect(summarizeLowScreen(records, 3)).toMatchObject({ speedGate: 'STOP_EARLY', speedGateLatencyRatio: 1.26 }) })

  it('turns a second-run dispatch boundary into fail-closed uncertainty without HTTP', async () => {
    const state = { runId: RUN_ID, definitionHash: 'sha256:def', httpRequests: 1, records: { c0: { candidateId: 'c0', status: 'DISPATCHING', events: [{ type: 'HTTP_DISPATCH_INTENT' }] } } }; const fetchImpl = vi.fn()
    await expect(runLowScreen({ ...locks, limit: 3, env: { KIMI_API_KEY: 'mock' }, fetchImpl, writeJsonFile: vi.fn(), buildPreflight: async () => fakePreflight(state), classifyFn: validClassifier })).rejects.toMatchObject({ code: 'UNCERTAIN_PRIOR_DISPATCH' })
    expect(fetchImpl).not.toHaveBeenCalled(); expect(state.records.c0.status).toBe('UNCERTAIN')
  })
})
