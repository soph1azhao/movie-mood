import { describe, expect, it, vi } from 'vitest'
import { ModelProviderError, runStructuredModelRequest } from './modelProvider.ts'
import { buildGeminiResponseJsonSchema, createGeminiProvider } from './geminiProvider.ts'

function response(body: Record<string, unknown>, ok = true, status = 200, headers?: Headers) {
  return {
    ok,
    status,
    headers,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('Gemini model provider', () => {
  it('uses environment credentials, structured JSON config, deterministic settings, and usage metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              classification: {
                moods: ['thoughtful'],
                situations: ['alone'],
                filterLanguages: ['English'],
                pace: 'slow',
                emotionalWeight: 'moderate',
                attentionDemand: 'engaged',
                discoveryStyle: 'different',
              },
              evidence: {
                moods: { thoughtful: { rationale: 'The packet supports reflective viewing.', sourceRefs: ['tmdb-facts'] } },
                situations: { alone: { rationale: 'The packet supports personal viewing.', sourceRefs: ['tmdb-facts'] } },
                pace: { rationale: 'The packet supports slow movement.', sourceRefs: ['tmdb-facts'] },
                emotionalWeight: { rationale: 'The packet supports moderate emotional load.', sourceRefs: ['tmdb-facts'] },
                attentionDemand: { rationale: 'The packet supports engaged attention.', sourceRefs: ['tmdb-facts'] },
                discoveryStyle: { rationale: 'The packet supports a different discovery style.', sourceRefs: ['tmdb-facts'] },
              },
              boundaryFlags: [],
            }),
          }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 123,
        candidatesTokenCount: 45,
        totalTokenCount: 168,
        thoughtsTokenCount: 7,
      },
    }))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'test-key' },
      fetchImpl,
    })

    const result = await runStructuredModelRequest({
      provider,
      request: { input: { prompt: 'classify this packet' }, temperature: 0 },
    })

    expect(result.output.classification).toMatchObject({ pace: 'slow' })
    expect(result.metadata).toMatchObject({
      providerId: 'google-gemini-developer-api',
      modelId: 'gemini-3.7-flash',
      providerUsageMetadata: {
        promptTokenCount: 123,
        candidatesTokenCount: 45,
        totalTokenCount: 168,
        thoughtsTokenCount: 7,
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/models/gemini-3.7-flash:generateContent'), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
    }))
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      topP: 0.2,
      responseFormat: { text: { mimeType: 'APPLICATION_JSON' } },
    })
    expect(body.generationConfig.responseFormat.text.schema).toMatchObject({
      type: 'object',
      required: ['classification', 'evidence', 'boundaryFlags'],
    })
    expect(body.generationConfig).not.toHaveProperty('responseMimeType')
    expect(body.generationConfig).not.toHaveProperty('responseJsonSchema')
    expect(JSON.stringify(body.generationConfig.responseFormat)).not.toContain('application/json')
  })

  it('projects candidate-specific source references as an exact enum', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ classification: {}, evidence: {}, boundaryFlags: [] }) }] } }],
      usageMetadata: {},
    }))
    const provider = createGeminiProvider({ modelId: 'gemini-3.5-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    await provider.generateStructured({ input: { evidencePacket: { sourceProvenance: [{ source: 'tmdb-overview' }, { source: 'tmdb-facts' }, { source: 'tmdb-overview' }] } } })

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    const projected = body.generationConfig.responseFormat.text.schema
    expect(projected.properties.evidence.properties.moods.additionalProperties.properties.sourceRefs.items.enum).toEqual(['tmdb-facts', 'tmdb-overview'])
    expect(projected.properties.evidence.properties.situations.additionalProperties.properties.sourceRefs.items.enum).toEqual(['tmdb-facts', 'tmdb-overview'])
    expect(buildGeminiResponseJsonSchema().properties.evidence.properties.moods.additionalProperties.properties.sourceRefs.items).not.toHaveProperty('enum')
  })

  it('always transmits GEMINI_API_KEY through the documented API-key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ classification: {}, evidence: {}, boundaryFlags: [] }) }] } }],
      usageMetadata: {},
    }))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'ya29.test-token' },
      fetchImpl,
    })

    await provider.generateStructured({ input: {}, temperature: 0 })

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'ya29.test-token' }),
    }))
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
  })

  it('marks Gemini rate limits retryable without exposing credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, false, 429, new Headers({ 'retry-after': '27' })))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'test-key' },
      fetchImpl,
    })

    await expect(provider.generateStructured({ input: {} })).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMIT',
      retryable: true,
      retryAfterMs: 28000,
    } satisfies Partial<ModelProviderError>)
  })

  it('honors structured Google RetryInfo delay', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.031368648s' }],
      },
    }, false, 429))
    const provider = createGeminiProvider({ modelId: 'gemini-3.7-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    const error = await provider.generateStructured({ input: {} }).catch((value) => value as ModelProviderError)
    expect(error.retryAfterMs).toBeCloseTo(38031.368648, 6)
  })

  it('parses the sanitized retry-message fallback when structured metadata is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { message: 'Resource exhausted. Please retry in 37.031s.' } }, false, 429))
    const provider = createGeminiProvider({ modelId: 'gemini-3.7-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    await expect(provider.generateStructured({ input: {} })).rejects.toMatchObject({ retryAfterMs: 38031 })
  })

  it('ignores malformed retry text and never includes credentials in errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { message: 'Please retry in sometime. test-key' } }, false, 429))
    const provider = createGeminiProvider({ modelId: 'gemini-3.7-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    const error = await provider.generateStructured({ input: {} }).catch((value) => value as ModelProviderError)
    expect(error).toMatchObject({ code: 'MODEL_RATE_LIMIT', retryable: true })
    expect(error.retryAfterMs).toBeUndefined()
    expect(error.message).not.toContain('test-key')
  })

  it('uses a new provider delay for each bounded 429 retry', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ error: { message: 'Please retry in 10s.' } }, false, 429))
      .mockResolvedValueOnce(response({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } }, false, 429))
      .mockResolvedValueOnce(response({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }))
    const provider = createGeminiProvider({ modelId: 'gemini-3.7-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })
    const delayFn = vi.fn().mockResolvedValue(undefined)

    const result = await runStructuredModelRequest({ provider, request: { input: {} }, maxAttempts: 3, delayFn })

    expect(result.output).toEqual({ ok: true })
    expect(delayFn).toHaveBeenCalledWith(11000)
    expect(delayFn).toHaveBeenLastCalledWith(21000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retryable 4xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { message: 'invalid request' } }, false, 400))
    const provider = createGeminiProvider({ modelId: 'gemini-3.7-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    await expect(runStructuredModelRequest({ provider, request: { input: {} }, maxAttempts: 3 })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_FAILURE' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('marks temporary 503 availability failures retryable for bounded orchestration', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { status: 'UNAVAILABLE', message: 'temporary high demand' } }, false, 503))
    const provider = createGeminiProvider({ modelId: 'gemini-3.6-flash', env: { GEMINI_API_KEY: 'test-key' }, fetchImpl })

    await expect(provider.generateStructured({ input: {} })).rejects.toMatchObject({
      code: 'MODEL_PROVIDER_HTTP_ERROR',
      retryable: true,
    } satisfies Partial<ModelProviderError>)
  })

  it('rejects malformed Gemini structured text without retrying through the provider adapter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: '{not json' }] } }],
    }))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'test-key' },
      fetchImpl,
    })

    await expect(runStructuredModelRequest({
      provider,
      request: { input: {} },
      maxAttempts: 3,
    })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('requires credentials by environment variable reference only', () => {
    expect(() => createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: {},
      fetchImpl: vi.fn(),
    })).toThrow(/GEMINI_API_KEY/)
  })
})
