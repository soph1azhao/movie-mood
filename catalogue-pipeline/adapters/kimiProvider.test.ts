import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifySemanticCandidate } from '../scripts/classifySemantic.mjs'
import { semanticCacheKeyFor } from '../scripts/runSemanticBatch.mjs'
import { ModelProviderError, runStructuredModelRequest } from './modelProvider.ts'
import { createKimiProvider, KIMI_DEFAULT_BASE_URL, KIMI_PROVIDER_ID } from './kimiProvider.ts'

function response(body: Record<string, unknown>, { ok = true, status = 200, headers = new Headers() } = {}) {
  return { ok, status, headers, json: vi.fn().mockResolvedValue(body), text: vi.fn().mockResolvedValue(JSON.stringify(body)) } as unknown as Response
}

function validSemanticOutput() {
  const evidence = (rationale: string) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'gentle family journey' }] } })
  return {
    classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'slow', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' },
    evidence: {
      moods: { thoughtful: evidence('The gentle family journey supports reflection.') },
      situations: { alone: evidence('The gentle family journey suits focused solo viewing.') },
      pace: evidence('The gentle family journey suggests a measured pace.'),
      emotionalWeight: evidence('The gentle family journey supports moderate weight.'),
      attentionDemand: evidence('The gentle family journey rewards engaged attention.'),
      discoveryStyle: evidence('The gentle family journey offers a distinct perspective.'),
    },
    boundaryFlags: [],
  }
}

function chatBody(output = validSemanticOutput(), usage: Record<string, unknown> = {}) {
  return { choices: [{ message: { content: JSON.stringify(output), reasoning_content: 'private reasoning must be ignored' } }], usage }
}

function packet() {
  return {
    schemaVersion: 'evidence-packet.v1', candidateId: 'fixture-film', tmdbId: 123, inputHash: 'sha256:fixture',
    sourceProvenance: [{ source: 'tmdb-facts' }, { source: 'tmdb-overview' }],
    facts: { title: 'Fixture Film', year: 2001, director: 'Director', genres: ['Drama'], runtimeMinutes: 100, countries: ['Canada'], spokenLanguages: ['English'], overview: 'A gentle family journey changes everyone involved.', keywords: [] },
  }
}

function provider(fetchImpl: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  return createKimiProvider({ modelId: 'kimi-for-coding', env: { KIMI_API_KEY: 'test-kimi-key' }, fetchImpl, ...overrides })
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

describe('Moonshot Kimi provider adapter', () => {
  it('requires an explicit model ID and an environment-referenced credential', () => {
    expect(() => createKimiProvider({ modelId: '', env: { KIMI_API_KEY: 'test-kimi-key' }, fetchImpl: vi.fn() })).toThrow(/explicit modelId/)
    expect(() => createKimiProvider({ modelId: 'kimi-k2.5', env: {}, fetchImpl: vi.fn() })).toThrow(/KIMI_API_KEY/)
    expect(() => createKimiProvider({ modelId: 'kimi-k2.5', env: { KIMI_API_KEY: '   ' }, fetchImpl: vi.fn() })).toThrow(/empty/)
  })

  it('creates stable credential-free metadata without making a request', () => {
    const fetchImpl = vi.fn()
    const kimi = provider(fetchImpl)
    expect(kimi.metadata).toEqual({ providerId: KIMI_PROVIDER_ID, modelId: 'kimi-for-coding', supportsStructuredJson: true, supportsTemperature: true, outputAffectingConfiguration: { protocol: 'openai-chat-completions', reasoningEffort: 'default' } })
    expect(JSON.stringify(kimi.metadata)).not.toContain('test-kimi-key')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the minimal JSON-mode Chat Completions request and preserves temperature', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody()))
    await provider(fetchImpl).generateStructured({ input: { evidencePacket: packet() }, temperature: 0.1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(`${KIMI_DEFAULT_BASE_URL}/chat/completions`, expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer test-kimi-key', 'Content-Type': 'application/json' } }))
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body).toMatchObject({ model: 'kimi-for-coding', messages: [{ role: 'user' }], stream: false, temperature: 0.1, response_format: { type: 'json_object' } })
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body.response_format).not.toHaveProperty('json_schema')
    expect(JSON.stringify(body)).not.toContain('test-kimi-key')
  })

  it('supports explicit base URL overrides and identity-bound disabled thinking', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody({ ok: true })))
    const kimi = provider(fetchImpl, { thinkingMode: 'disabled', env: { KIMI_API_KEY: 'test-kimi-key', KIMI_BASE_URL: 'https://fixture.invalid/v1/' } })
    await kimi.generateStructured({ input: {} })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://fixture.invalid/v1/chat/completions')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).thinking).toEqual({ type: 'disabled' })
    expect(kimi.metadata.outputAffectingConfiguration).toEqual({ protocol: 'openai-chat-completions', reasoningEffort: 'disabled' })
  })

  it.each(['low', 'high', 'max'] as const)('sends and identity-binds reasoning effort %s', async (reasoningEffort) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody({ ok: true })))
    const kimi = provider(fetchImpl, { reasoningEffort })
    await kimi.generateStructured({ input: {}, temperature: 0.1 })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      model: 'kimi-for-coding', reasoning_effort: reasoningEffort, messages: [{ role: 'user' }],
      stream: false, temperature: 0.1, response_format: { type: 'json_object' },
    })
    expect(kimi.metadata.outputAffectingConfiguration).toEqual({ protocol: 'openai-chat-completions', reasoningEffort })
  })

  it('rejects invalid reasoning effort before HTTP', () => {
    const fetchImpl = vi.fn()
    expect(() => provider(fetchImpl, { reasoningEffort: 'medium' })).toThrow(/reasoningEffort/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('routes KIMI_BASE_URL to the Kimi Code chat completions endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody({ ok: true })))
    const kimi = provider(fetchImpl, { reasoningEffort: 'low', env: { KIMI_API_KEY: 'test-kimi-key', KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' } })
    await kimi.generateStructured({ input: {} })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.kimi.com/coding/v1/chat/completions')
  })

  it('parses object JSON, ignores reasoning content, and normalizes only available usage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody({ ok: true }, { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 }, prompt_tokens_details: { cached_tokens: 3 } })))
    const result = await provider(fetchImpl).generateStructured({ input: {} })
    expect(result).toEqual({ ok: true, providerUsageMetadata: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, thinking_tokens: 7, cached_tokens: 3 } })
    expect(JSON.stringify(result)).not.toContain('private reasoning')
  })

  it.each([
    ['missing choices', {}, 'empty structured content'],
    ['empty content', { choices: [{ message: { content: '' } }] }, 'empty structured content'],
    ['invalid JSON', { choices: [{ message: { content: '{bad' } }] }, 'invalid JSON'],
    ['array JSON', { choices: [{ message: { content: '[]' } }] }, 'non-object JSON'],
  ])('maps %s to MALFORMED_MODEL_OUTPUT', async (_label, body, message) => {
    await expect(provider(vi.fn().mockResolvedValue(response(body))).generateStructured({ input: {} })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT', message: expect.stringContaining(message) } satisfies Partial<ModelProviderError>)
  })

  it('maps 429 with Retry-After and redacts credentials from bounded diagnostics', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: 'test-kimi-key is invalid' }, { ok: false, status: 429, headers: new Headers({ 'Retry-After': '2' }) }))
    const error = await provider(fetchImpl).generateStructured({ input: {} }).catch((value) => value as ModelProviderError)
    expect(error).toMatchObject({ code: 'MODEL_RATE_LIMIT', retryable: true, retryAfterMs: 2000 })
    expect(error.message).not.toContain('test-kimi-key')
    expect(error.message.length).toBeLessThan(600)
  })

  it.each([[503, true], [400, false]])('maps HTTP %i retryability', async (status, retryable) => {
    await expect(provider(vi.fn().mockResolvedValue(response({ error: 'failure' }, { ok: false, status }))).generateStructured({ input: {} })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_HTTP_ERROR', retryable } satisfies Partial<ModelProviderError>)
  })

  it('works through classification and the canonical semantic validator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'movie-mood-kimi-valid-'))
    const fetchImpl = vi.fn().mockResolvedValue(response(chatBody(validSemanticOutput(), { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })))
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet(), provider: provider(fetchImpl), prompt: 'fixture prompt', cacheRoot: join(root, 'cache'), outputPath: join(root, 'output.json'), createdAt: '2026-01-01T00:00:00.000Z' })
      expect(result).toMatchObject({ cacheHit: false, modelCalls: 1, artifact: { modelProvider: KIMI_PROVIDER_ID, modelId: 'kimi-for-coding' }, providerUsageMetadata: { prompt_tokens: 10 } })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('lets canonical validation retry malformed semantic output without persisting attempt one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'movie-mood-kimi-malformed-'))
    const invalid = { ...validSemanticOutput(), classification: { ...validSemanticOutput().classification, pace: 'impossible' } }
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(chatBody(invalid))).mockResolvedValueOnce(response(chatBody()))
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet(), provider: provider(fetchImpl), prompt: 'fixture prompt', cacheRoot: join(root, 'cache'), outputPath: join(root, 'output.json'), createdAt: '2026-01-01T00:00:00.000Z' })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ modelCalls: 2, malformedOutputRetries: 1 })
      expect(JSON.parse(await readFile(join(root, 'output.json'), 'utf8')).classification.pace).toBe('slow')
      expect(await readdir(join(root, 'cache'))).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('uses the generic retry path for a transient transport failure without sleeping', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, { ok: false, status: 503 })).mockResolvedValueOnce(response(chatBody({ ok: true })))
    const delayFn = vi.fn()
    const result = await runStructuredModelRequest({ provider: provider(fetchImpl), request: { input: {} }, maxAttempts: 2, delayFn })
    expect(result.output).toEqual({ ok: true })
    expect(result.metadata).toMatchObject({ attempts: 2, transportRetries: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
  })

  it('keeps provider, model, and reasoning-effort cache identities isolated', () => {
    const common = { packet: packet(), promptVersion: 'semantic-classifier.v3', schemaVersion: 'semantic-output.v2' }
    const providers = [
      provider(vi.fn()),
      provider(vi.fn(), { reasoningEffort: 'low' }),
      provider(vi.fn(), { reasoningEffort: 'high' }),
      createKimiProvider({ modelId: 'k3-256k', env: { KIMI_API_KEY: 'test-kimi-key' }, fetchImpl: vi.fn() }),
      { metadata: { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash' } },
    ]
    expect(new Set(providers.map((entry) => semanticCacheKeyFor({ ...common, provider: entry }))).size).toBe(5)
  })
})
