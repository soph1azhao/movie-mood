import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { AUTHORIZATION_FLAG, COHORT, EXECUTION_ORDER, REQUEST_BUDGET, RUN_ID, SCHEMA_HASH, buildHighVsMaxPreflight, launchKimiHighVsMaxScreen, runKimiHighVsMaxScreen } from './runKimiK28HighVsMaxScreen.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

function output(flags = []) { const evidence = (rationale) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'specific factual cue' }] } }); return { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence('A sufficiently detailed evidence rationale.') }, situations: { alone: evidence('A sufficiently detailed evidence rationale.') }, pace: evidence('A sufficiently detailed evidence rationale.'), emotionalWeight: evidence('A sufficiently detailed evidence rationale.'), attentionDemand: evidence('A sufficiently detailed evidence rationale.'), discoveryStyle: evidence('A sufficiently detailed evidence rationale.') }, boundaryFlags: flags } }
function response(value, usage) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: usage[0], completion_tokens: usage[1], total_tokens: usage[3], completion_tokens_details: { reasoning_tokens: usage[2] } } }) } }
function fixtures() {
  const prompt = 'fixture prompt'; const candidates = COHORT.map((candidate, index) => ({ ...candidate, tmdbId: index + 1 })); const packets = Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, { schemaVersion: 'evidence-packet.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, inputHash: candidate.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }])); const baselines = Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, { schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', modelProvider: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', movie: { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId }, evidencePacketHash: candidate.evidencePacketHash, outputHash: `sha256:${candidate.candidateId}`, ...output() }])); const manifest = { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: 'semantic-classifier.v3', promptContentHash: `sha256:${stableHash(prompt)}`, semanticSchemaVersion: 'semantic-output.v2', taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, candidates }
  const readJsonFile = async (path) => path.endsWith('manifest.json') ? manifest : path.includes('v8-1-semantic-pilot-001') ? baselines[COHORT.find((candidate) => path.endsWith(`${candidate.candidateId}.json`)).candidateId] : packets[COHORT.find((candidate) => path.endsWith(`${candidate.candidateId}.json`)).candidateId]
  return { readJsonFile, readTextFile: async () => prompt, fileExists: async () => false }
}

describe('Kimi K2.8 High versus Max paired screen', () => {
  it('preflights the exact frozen cohort, new schema, and counterbalanced order without HTTP', async () => {
    const fetchImpl = vi.fn(); const result = await launchKimiHighVsMaxScreen([], { pipelineRoot: '/fixture', ...fixtures(), fetchImpl })
    expect(result.executionAuthorized).toBe(false); expect(result.preflight).toMatchObject({ runId: RUN_ID, semanticOutputSchemaHash: SCHEMA_HASH, requestBudget: 8, maxAttemptsPerArmCandidate: 1, concurrency: 1 })
    expect(result.preflight.executionOrder.map(({ candidateId, reasoningEffort }) => ({ candidateId, reasoningEffort }))).toEqual(EXECUTION_ORDER); expect(result.preflight.executionOrder.map(({ evidencePacketHash }) => evidencePacketHash)).toEqual(EXECUTION_ORDER.map(({ candidateId }) => COHORT.find((candidate) => candidate.candidateId === candidateId).evidencePacketHash)); expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps High and Max fresh, cache-distinct, serial, and capped at one request for each arm/candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-high-max-')); const fixture = fixtures(); const fetchImpl = vi.fn()
    for (const entry of EXECUTION_ORDER) fetchImpl.mockResolvedValueOnce(response(output(entry.reasoningEffort === 'high' ? [{ code: 'BOUNDARY_FLAG', fields: ['pace'], message: 'A sufficiently detailed boundary message.', reviewRequired: true }] : []), entry.reasoningEffort === 'high' ? [10, 20, 7, 30] : [11, 31, 18, 42]))
    try {
      const result = await runKimiHighVsMaxScreen({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, ...fixture, now: (() => { let value = 0; return () => ++value })() })
      expect(fetchImpl).toHaveBeenCalledTimes(REQUEST_BUDGET); expect(result.report.httpRequests).toBe(8); expect(result.report.records).toHaveLength(8); expect(result.report.records.every((record) => record.attempts === 1 && record.providerRequests === 1 && record.status === 'VALID')).toBe(true)
      expect(result.preflight.executionOrder.map(({ cachePath }) => cachePath)).toHaveLength(new Set(result.preflight.executionOrder.map(({ cachePath }) => cachePath)).size)
      expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).reasoning_effort)).toEqual(EXECUTION_ORDER.map(({ reasoningEffort }) => reasoningEffort))
      expect(result.report.armSummaries.high).toMatchObject({ valid: 4, ordinalMatches: 16, conservatismReviewBurden: { totalBoundaryFlags: 4 }, usage: { total_tokens: 120 } }); expect(result.report.armSummaries.max).toMatchObject({ valid: 4, ordinalMatches: 16, conservatismReviewBurden: { totalBoundaryFlags: 0 }, usage: { total_tokens: 168 } }); expect(result.report.pairedDeltas.meanMaxMinusHigh).toMatchObject({ total_tokens: 12, thinking_tokens: 11, boundaryFlags: -1 })
      for (const [, init] of fetchImpl.mock.calls) { const body = JSON.parse(init.body); expect(body).not.toHaveProperty('temperature'); expect(body.response_format.json_schema.schema.properties.evidence.properties.pace.properties.grounding.properties.cues.items.properties.cue.minLength).toBe(8) }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('requires the explicit authorization flag', () => expect(AUTHORIZATION_FLAG).toBe('--execute-authorized-kimi-high-vs-max'))

  it('refuses baseline identity drift', async () => {
    const fixture = fixtures(); const drifted = { ...fixture, readJsonFile: async (path) => path.endsWith('manifest.json') ? { providerId: 'wrong' } : fixture.readJsonFile(path) }
    await expect(buildHighVsMaxPreflight({ pipelineRoot: '/fixture', ...drifted })).rejects.toMatchObject({ code: 'PAIRED_INPUT_IDENTITY_MISMATCH' })
  })
})
