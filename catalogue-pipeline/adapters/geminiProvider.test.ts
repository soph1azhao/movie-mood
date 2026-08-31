import { describe, expect, it, vi } from 'vitest'
import { ModelProviderError, runStructuredModelRequest } from './modelProvider.ts'
import { createGeminiProvider } from './geminiProvider.ts'

function response(body: Record<string, unknown>, ok = true, status = 200) {
  return {
    ok,
    status,
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
      responseMimeType: 'application/json',
    })
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      type: 'object',
      required: ['classification', 'evidence', 'boundaryFlags'],
    })
  })

  it('uses bearer auth for OAuth-style maintainer credentials without exposing them elsewhere', async () => {
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
      headers: expect.objectContaining({ Authorization: 'Bearer ya29.test-token' }),
    }))
  })

  it('normalizes explicit bearer credentials without duplicating the scheme', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ classification: {}, evidence: {}, boundaryFlags: [] }) }] } }],
      usageMetadata: {},
    }))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'Bearer test-token' },
      fetchImpl,
    })

    await provider.generateStructured({ input: {}, temperature: 0 })

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }))
  })

  it('marks Gemini rate limits retryable without exposing credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, false, 429))
    const provider = createGeminiProvider({
      modelId: 'gemini-3.7-flash',
      env: { GEMINI_API_KEY: 'test-key' },
      fetchImpl,
    })

    await expect(provider.generateStructured({ input: {} })).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMIT',
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
