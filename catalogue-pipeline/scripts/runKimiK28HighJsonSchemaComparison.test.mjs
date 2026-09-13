import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { AUTHORIZATION_FLAG, REQUEST_BUDGET, RUN_ID, SCHEMA_HASH, aggregateUsage, buildComparisonPreflight, launchKimiJsonSchemaComparison, runKimiJsonSchemaComparison, summarizeComparisons } from './runKimiK28HighJsonSchemaComparison.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

const ids = ['crouching-tiger', 'get-out', 'hunt-wilderpeople', 'inception', 'knives-out', 'little-miss-sunshine', 'my-neighbor-totoro', 'parasite', 'portrait-lady-fire', 'rrr', 'shawshank', 'spirited-away']
function output({ language = 'English', flags = [] } = {}) {
  const evidence = (rationale) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'specific factual journey evidence' }] } })
  return { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: [language], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence('The factual journey supports thoughtful viewing.') }, situations: { alone: evidence('The factual journey supports solo viewing.') }, pace: evidence('The factual journey supports a medium pace.'), emotionalWeight: evidence('The factual journey supports moderate weight.'), attentionDemand: evidence('The factual journey supports engaged attention.'), discoveryStyle: evidence('The factual journey supports different discovery.') }, boundaryFlags: flags }
}
function response(value, usage = [10, 20, 7, 30]) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[3], completion_tokens_details: { reasoning_tokens: usage[2] } } }) } }
function fixtures({ mismatch = false } = {}) {
  const prompt = 'fixture prompt'; const candidates = ids.map((candidateId, index) => ({ candidateId, tmdbId: index + 1, evidencePacketHash: `sha256:packet-${index}` }))
  const packets = Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, { schemaVersion: 'evidence-packet.v1', ...candidate, inputHash: candidate.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }]))
  const baselines = Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, { schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', modelProvider: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', movie: { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId }, evidencePacketHash: candidate.evidencePacketHash, outputHash: `sha256:${candidate.candidateId}`, ...output({ language: candidate.candidateId === 'get-out' ? 'en' : 'English' }) }]))
  const manifest = { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: 'semantic-classifier.v3', promptContentHash: mismatch ? 'sha256:drift' : `sha256:${stableHash(prompt)}`, semanticSchemaVersion: 'semantic-output.v2', taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, candidateCount: 12, candidateManifestHash: 'sha256:fixture-manifest', candidates }
  const readJsonFile = async (path) => path.endsWith('manifest.json') ? manifest : path.includes('v8-1-semantic-pilot-001') ? baselines[ids.find((id) => path.endsWith(`${id}.json`))] : packets[ids.find((id) => path.endsWith(`${id}.json`))]
  return { prompt, candidates, readJsonFile, readTextFile: async () => prompt }
}

describe('bounded Kimi K2.8 High JSON-Schema twelve-film comparison', () => {
  it('derives the exact unique frozen pilot cohort and blocks all HTTP without authorization', async () => {
    const fetchImpl = vi.fn(); const result = await launchKimiJsonSchemaComparison([], { pipelineRoot: '/fixture', ...fixtures(), fetchImpl, fileExists: async () => false })
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({ runId: RUN_ID, modelId: 'kimi-for-coding', reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaHash: SCHEMA_HASH, requestBudget: 24, maxAttemptsPerCandidate: 2, concurrency: 1, resume: { validCacheHits: 0, freshCandidatesRemaining: 12, priorAttempts: 0, remainingRequestBudget: 24 } })
    expect(result.preflight.candidates.map(({ candidateId }) => candidateId)).toEqual(ids); expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a pilot identity mismatch rather than substituting an input', async () => {
    await expect(buildComparisonPreflight({ pipelineRoot: '/fixture', ...fixtures({ mismatch: true }), fileExists: async () => false })).rejects.toMatchObject({ code: 'BASELINE_IDENTITY_MISMATCH' })
  })

  it('enforces serial execution, per-candidate two-attempt cap, and the global 24-request cap', async () => {
    const fixture = fixtures(); const fetchImpl = vi.fn(() => response({ classification: { ...output().classification, filterLanguages: undefined }, evidence: {}, boundaryFlags: [] }))
    const writes = []; const result = await runKimiJsonSchemaComparison({ pipelineRoot: '/fixture', env: { KIMI_API_KEY: 'fixture' }, fetchImpl, ...fixture, fileExists: async () => false, writeJsonFile: async (path, value) => writes.push({ path, value }) })
    expect(fetchImpl).toHaveBeenCalledTimes(REQUEST_BUDGET); expect(result.report.httpRequests).toBe(REQUEST_BUDGET)
    expect(result.report.records).toHaveLength(12); expect(result.report.records.every((record) => record.attempts === 2)).toBe(true)
    expect(writes.length).toBeGreaterThan(0)
  })

  it('reports raw language representations, boundary flags, and token dimensions without double-counting thinking', () => {
    const comparison = summarizeComparisons([{ candidateId: 'get-out', status: 'COMPLETED', comparison: { ordinalAgreement: { pace: { match: true }, emotionalWeight: { match: true }, attentionDemand: { match: true }, discoveryStyle: { match: true } }, moods: { jaccard: 1 }, situations: { jaccard: 0.5 }, filterLanguages: { candidate: ['English'], baseline: ['en'], exactSetAgreement: false }, boundaryFlags: { candidateCount: 2, baselineCount: 0, presenceAgreement: false } } }])
    expect(comparison.filterLanguages).toMatchObject({ rawRepresentation: 'unmodified-schema-values', exactSetAgreement: 0, pairs: [{ kimi: ['English'], gemini: ['en'] }] }); expect(comparison.boundaryFlags.meanPerFilm).toEqual({ kimi: 2, gemini: 0 })
    expect(aggregateUsage([{ usage: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 } }, { usage: { prompt_tokens: 11, completion_tokens: 21, thinking_tokens: 8, total_tokens: 32 } }])).toEqual({ prompt_tokens: 21, completion_tokens: 41, thinking_tokens: 15, total_tokens: 62 })
  })

  it('recognizes a persisted valid cache hit on resume without dispatching it again', async () => {
    const fixture = fixtures(); const stored = new Map(); let preflight = await buildComparisonPreflight({ pipelineRoot: '/fixture', ...fixture, fileExists: async () => false }); const candidate = preflight.candidates[0]
    const artifact = { schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', modelProvider: 'moonshot-kimi-api', modelId: 'kimi-for-coding', movie: { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId }, evidencePacketHash: candidate.evidencePacketHash, cacheKey: candidate.cacheKey, outputHash: 'sha256:kimi', ...output(), providerMetadata: { providerUsageMetadata: { prompt_tokens: 1, completion_tokens: 2, thinking_tokens: 1, total_tokens: 3 } } }
    stored.set(candidate.cacheKey, artifact); const readJsonFile = async (path) => stored.get(path.split('/').at(-1)?.replace('.json', '')) ?? fixture.readJsonFile(path)
    preflight = await buildComparisonPreflight({ pipelineRoot: '/fixture', ...fixture, readJsonFile, fileExists: async (path) => stored.has(path.split('/').at(-1)?.replace('.json', '')) })
    expect(preflight.resume.validCacheHits).toBe(1); expect(preflight.resume.freshCandidatesRemaining).toBe(11)
  })
})
