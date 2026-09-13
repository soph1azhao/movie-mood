import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_FLAG, buildSmokePreflight, CANDIDATES, launchKimiSmoke, providerFailureDetails } from './runKimiK28HighSemanticSmoke.mjs'

afterEach(() => vi.unstubAllGlobals())

function fixtureContext() {
  const valid = { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'slow', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: {}, boundaryFlags: [] }
  const packets = CANDIDATES.map((candidate, index) => ({ schemaVersion: 'evidence-packet.v1', ...candidate, inputHash: candidate.evidencePacketHash, tmdbId: index + 1, sourceProvenance: [], facts: {} }))
  const baseline = Object.fromEntries(CANDIDATES.map((candidate) => [candidate.candidateId, valid]))
  const readJsonFile = async (path) => path.endsWith('manifest.json') ? { candidates: CANDIDATES } : CANDIDATES.some((candidate) => path.endsWith(`${candidate.candidateId}.json`)) ? (path.includes('v8-1-semantic-pilot-001') ? baseline[CANDIDATES.find((candidate) => path.endsWith(`${candidate.candidateId}.json`)).candidateId] : packets.find((packet) => path.endsWith(`${packet.candidateId}.json`))) : {}
  return { valid, readJsonFile }
}

describe('bounded Kimi K2.8 high-effort semantic smoke runner', () => {
  it('preflights the exact fixed cohort without a credential or network authorization', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network must not run') }); vi.stubGlobal('fetch', fetchSpy)
    const result = await launchKimiSmoke([])
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({
      smokeId: 'kimi-k28-high-3-film-smoke-v2', providerId: 'moonshot-kimi-api', modelId: 'kimi-for-coding',
      reasoningEffort: 'high', outputAffectingConfiguration: { protocol: 'openai-chat-completions', reasoningEffort: 'high' },
      requestBudget: 6, maxAttemptsPerCandidate: 2, concurrency: 1,
      candidates: CANDIDATES.map((candidate) => expect.objectContaining(candidate)),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed on evidence hash drift', async () => {
    const readJsonFile = vi.fn(async (path) => path.endsWith('manifest.json') ? { candidates: CANDIDATES } : path.endsWith('crouching-tiger.json') ? { candidateId: 'crouching-tiger', inputHash: 'wrong' } : {})
    await expect(buildSmokePreflight({ readJsonFile })).rejects.toMatchObject({ code: 'EVIDENCE_IDENTITY_MISMATCH' })
  })

  it('requires the authorization flag before executing', async () => {
    const { readJsonFile } = fixtureContext(); const fetchImpl = vi.fn()
    const result = await launchKimiSmoke([], { pipelineRoot: '/fixture', readJsonFile, readTextFile: async () => 'fixture prompt', fileExists: async () => false, fetchImpl })
    expect(result.executionAuthorized).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses Kimi Code, high effort without temperature, serial execution, and at most two attempts per candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-k28-smoke-')); const { valid, readJsonFile } = fixtureContext(); let clock = 0
    const response = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) }
    const fetchImpl = vi.fn().mockResolvedValue(response)
    try {
      const result = await launchKimiSmoke([AUTHORIZATION_FLAG], {
        pipelineRoot: root, env: { KIMI_API_KEY: 'fixture', KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' }, fetchImpl,
        readJsonFile, readTextFile: async () => 'fixture prompt', writeJsonFile: async () => {}, fileExists: async () => false, now: () => ++clock,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(6)
      for (const call of fetchImpl.mock.calls) {
        expect(call[0]).toBe('https://api.kimi.com/coding/v1/chat/completions')
        expect(JSON.parse(call[1].body)).toMatchObject({ model: 'kimi-for-coding', reasoning_effort: 'high', stream: false, response_format: { type: 'json_object' } })
        expect(JSON.parse(call[1].body)).not.toHaveProperty('temperature')
      }
      expect(result.report).toMatchObject({ httpRequests: 6, requestBudget: 6, maxAttemptsPerCandidate: 2, concurrency: 1, counts: { completed: 0, failed: 3, malformedOutputFailures: 3, providerFailures: 0 } })
      expect(result.report.records.every((record) => record.attempts === 2)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reports bounded underlying HTTP diagnostics without response content', () => {
    const underlying = Object.assign(new Error('secret response body'), { code: 'MODEL_PROVIDER_HTTP_ERROR', retryable: false, details: { httpStatus: 400 } })
    const wrapped = Object.assign(new Error('Model provider failed.'), { code: 'MODEL_PROVIDER_FAILURE', retryable: false, cause: underlying })
    expect(providerFailureDetails(wrapped)).toEqual({ code: 'MODEL_PROVIDER_HTTP_ERROR', wrapperCode: 'MODEL_PROVIDER_FAILURE', httpStatus: 400, retryable: false })
    expect(JSON.stringify(providerFailureDetails(wrapped))).not.toContain('secret response body')
  })
})
