import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTHORIZATION_FLAG, CANDIDATES, REQUEST_BUDGET, RUN_ID, SCHEMA_HASH, launchKimiMinlengthRepair, runKimiMinlengthRepair } from './runKimiK28HighJsonSchemaMinlengthRepair.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

function output() {
  const evidence = (rationale) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'eight ok' }] } })
  return { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence('A rationale safely over twelve characters.') }, situations: { alone: evidence('A rationale safely over twelve characters.') }, pace: evidence('A rationale safely over twelve characters.'), emotionalWeight: evidence('A rationale safely over twelve characters.'), attentionDemand: evidence('A rationale safely over twelve characters.'), discoveryStyle: evidence('A rationale safely over twelve characters.') }, boundaryFlags: [] }
}
function response() { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } } }) } }
function fixtures() {
  const registered = CANDIDATES.map((candidate, index) => ({ ...candidate, tmdbId: index + 1 })); const packets = Object.fromEntries(registered.map((candidate) => [candidate.candidateId, { schemaVersion: 'evidence-packet.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, inputHash: candidate.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }]))
  const readJsonFile = async (path) => path.endsWith('manifest.json') ? { candidates: registered } : packets[CANDIDATES.find((candidate) => path.endsWith(`${candidate.candidateId}.json`)).candidateId]
  return { readJsonFile, readTextFile: async () => 'fixture prompt', fileExists: async () => false }
}

describe('Kimi structured-output minLength repair diagnostic', () => {
  it('preflights the exact two frozen failures and new cache identity without authorization or HTTP', async () => {
    const fetchImpl = vi.fn(); const result = await launchKimiMinlengthRepair([], { pipelineRoot: '/fixture', ...fixtures(), fetchImpl })
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({ runId: RUN_ID, modelId: 'kimi-for-coding', reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaHash: SCHEMA_HASH, requestBudget: 2, maxAttemptsPerCandidate: 1, concurrency: 1, candidates: CANDIDATES.map((candidate) => expect.objectContaining(candidate)) })
    expect(SCHEMA_HASH).not.toBe('sha256:8876dfaa86d325d3eb6b2545af31b762bfc60584fc8fab9d0d5be76f12396d20'); expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends exactly one serial request per candidate with the projected length constraints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-minlength-repair-')); const fetchImpl = vi.fn().mockResolvedValue(response()); const writes = []
    try {
      const result = await runKimiMinlengthRepair({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, ...fixtures(), writeJsonFile: async (path, value) => writes.push({ path, value }) })
      expect(fetchImpl).toHaveBeenCalledTimes(REQUEST_BUDGET); expect(result.report).toMatchObject({ httpRequests: 2, counts: { valid: 2, failed: 0 } })
      for (const call of fetchImpl.mock.calls) {
        const body = JSON.parse(call[1].body); const schema = body.response_format.json_schema.schema; const evidence = schema.properties.evidence.properties.pace
        expect(body).toMatchObject({ model: 'kimi-for-coding', reasoning_effort: 'high', stream: false }); expect(body).not.toHaveProperty('temperature')
        expect(evidence.properties.rationale.minLength).toBe(12); expect(evidence.properties.grounding.properties.cues.items.properties.cue.minLength).toBe(8); expect(evidence.properties.grounding.properties.bridge.minLength).toBe(12); expect(schema.properties.boundaryFlags.items.properties.message.minLength).toBe(12)
      }
      expect(writes.at(-1).value.records.every((record) => record.attempts === 1)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('requires the explicit authorization flag', () => expect(AUTHORIZATION_FLAG).toBe('--execute-authorized-kimi-minlength-repair'))
})
