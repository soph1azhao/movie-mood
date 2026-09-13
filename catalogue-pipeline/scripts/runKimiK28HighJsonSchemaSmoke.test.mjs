import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { AUTHORIZATION_FLAG, CANDIDATES, SCHEMA_HASH, aggregateUsage, buildSmokePreflight, launchKimiJsonSchemaSmoke, runKimiJsonSchemaSmoke } from './runKimiK28HighJsonSchemaSmoke.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

function output({ filterLanguages = true } = {}) {
  const evidence = (rationale) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'specific factual journey evidence' }] } })
  const classification = { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }
  if (!filterLanguages) delete classification.filterLanguages
  return { classification, evidence: { moods: { thoughtful: evidence('The factual journey supports thoughtful viewing.') }, situations: { alone: evidence('The factual journey supports solo viewing.') }, pace: evidence('The factual journey supports a medium pace.'), emotionalWeight: evidence('The factual journey supports moderate weight.'), attentionDemand: evidence('The factual journey supports engaged attention.'), discoveryStyle: evidence('The factual journey supports different discovery.') }, boundaryFlags: [] }
}

function fixtures({ compatible = true } = {}) {
  const prompt = 'fixture prompt'
  const packets = CANDIDATES.map((candidate, index) => ({ schemaVersion: 'evidence-packet.v1', ...candidate, inputHash: candidate.evidencePacketHash, tmdbId: index + 1, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }))
  const baselines = Object.fromEntries(packets.map((packet) => [packet.candidateId, { schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', modelProvider: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', movie: { candidateId: packet.candidateId, tmdbId: packet.tmdbId }, evidencePacketHash: packet.inputHash, outputHash: `sha256:${packet.candidateId}`, ...output() }]))
  const manifest = { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: 'semantic-classifier.v3', promptContentHash: `sha256:${stableHash(prompt)}`, semanticSchemaVersion: 'semantic-output.v2', taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, candidates: CANDIDATES }
  if (!compatible) manifest.promptContentHash = 'sha256:incompatible'
  const readJsonFile = async (path) => {
    if (path.endsWith('manifest.json')) return manifest
    const candidate = CANDIDATES.find((entry) => path.endsWith(`${entry.candidateId}.json`))
    if (!candidate) throw new Error('unexpected fixture path')
    return path.includes('v8-1-semantic-pilot-001') ? baselines[candidate.candidateId] : packets.find((packet) => packet.candidateId === candidate.candidateId)
  }
  return { prompt, readJsonFile, readTextFile: async () => prompt }
}

function response(value, usage) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[3], completion_tokens_details: { reasoning_tokens: usage[2] } } }) } }

describe('bounded Kimi K2.8 High JSON-Schema three-film smoke', () => {
  it('preflights the exact frozen cohort and identity without authorization or HTTP', async () => {
    const fetchImpl = vi.fn(); const fixture = fixtures()
    const result = await launchKimiJsonSchemaSmoke([], { pipelineRoot: '/fixture', ...fixture, fetchImpl, fileExists: async () => false })
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({ smokeId: 'kimi-k28-high-json-schema-3-film-smoke-v1', modelId: 'kimi-for-coding', reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaVersion: 'semantic-output.v2', semanticOutputSchemaHash: SCHEMA_HASH, requestBudget: 6, maxAttemptsPerCandidate: 2, concurrency: 1, candidates: CANDIDATES.map((candidate) => expect.objectContaining(candidate)), baselineComparison: { compatible: true, reasons: [] } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports first-attempt validity, bounded retry recovery, terminal malformed output, and usage without double-counting thinking', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-json-schema-smoke-')); const fixture = fixtures()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(output(), [10, 20, 7, 30]))
      .mockResolvedValueOnce(response(output({ filterLanguages: false }), [11, 21, 8, 32]))
      .mockResolvedValueOnce(response(output(), [12, 22, 9, 34]))
      .mockResolvedValueOnce(response(output({ filterLanguages: false }), [13, 23, 10, 36]))
      .mockResolvedValueOnce(response(output({ filterLanguages: false }), [14, 24, 11, 38]))
    try {
      const result = await runKimiJsonSchemaSmoke({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture', KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' }, fetchImpl, ...fixture, fileExists: async () => false, now: (() => { let value = 0; return () => ++value })() })
      expect(fetchImpl).toHaveBeenCalledTimes(5)
      expect(result.report.records).toMatchObject([
        { candidateId: 'crouching-tiger', status: 'COMPLETED', attempts: 1, providerRequests: 1, firstAttemptValidated: true, retryRequired: false, retryRecovered: false, finishReason: 'stop', comparison: expect.any(Object) },
        { candidateId: 'get-out', status: 'COMPLETED', attempts: 2, providerRequests: 2, firstAttemptValidated: false, retryRequired: true, retryRecovered: true, usage: { prompt_tokens: 23, completion_tokens: 43, thinking_tokens: 17, total_tokens: 66 }, comparison: expect.any(Object) },
        { candidateId: 'little-miss-sunshine', status: 'FAILED', attempts: 2, providerRequests: 2, firstAttemptValidated: false, retryRequired: true, retryRecovered: false, usage: { prompt_tokens: 27, completion_tokens: 47, thinking_tokens: 21, total_tokens: 74 }, comparison: null },
      ])
      expect(result.report.counts).toEqual({ completed: 2, failed: 1, firstAttemptValid: 1, retryRecovered: 1, httpRequests: 5 })
      expect(result.report.usageTotals).toEqual({ prompt_tokens: 60, completion_tokens: 110, thinking_tokens: 45, total_tokens: 170 })
      expect(result.report.usageTotals.total_tokens).not.toBe(170 + 45)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('refuses comparison when the existing Gemini baseline identity is incompatible', async () => {
    const preflight = await buildSmokePreflight({ pipelineRoot: '/fixture', ...fixtures({ compatible: false }), fileExists: async () => false })
    expect(preflight.baselineComparison.compatible).toBe(false)
    expect(preflight.baselineComparison.reasons).toContain('BASELINE_promptContentHash_MISMATCH')
  })

  it('aggregates token dimensions independently', () => {
    expect(aggregateUsage([{ usage: { prompt_tokens: 1, completion_tokens: 2, thinking_tokens: 1, total_tokens: 3 } }, { usage: { prompt_tokens: 4, completion_tokens: 5, thinking_tokens: 2, total_tokens: 9 } }])).toEqual({ prompt_tokens: 5, completion_tokens: 7, thinking_tokens: 3, total_tokens: 12 })
  })
})
