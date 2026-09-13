import { describe, expect, it, vi } from 'vitest'
import { assertCredentialIsolation, loadProviderConfig, resolveCredential } from './providerConfig.ts'
import { createModelCacheKey, ModelProviderError, runStructuredModelRequest } from './modelProvider.ts'
import { stableHash } from './tmdbProvider.ts'

const provider = {
  metadata: {
    providerId: 'mock-provider',
    modelId: 'mock-model-v1',
    supportsStructuredJson: true,
    supportsTemperature: true,
  },
  generateStructured: vi.fn(),
}

describe('model provider adapter', () => {
  it('returns structured JSON output with provider/model metadata', async () => {
    provider.generateStructured = vi.fn().mockResolvedValue({ ok: true, value: 42 })

    const result = await runStructuredModelRequest({
      provider,
      request: {
        stage: 'semantic-classifier',
        prompt: 'classify',
      },
      validateOutput: (output) => ({ ok: output.ok === true }),
    })

    expect(result.output).toEqual({ ok: true, value: 42 })
    expect(result.metadata).toMatchObject({
      providerId: 'mock-provider',
      modelId: 'mock-model-v1',
      attempts: 1,
      structuredJson: true,
    })
    expect(provider.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: 'json_object',
      temperature: 0.1,
    }))
  })

  it('retries malformed JSON once with the exact same structured request', async () => {
    const generateStructured = vi.fn().mockResolvedValueOnce('{not json').mockResolvedValueOnce({ ok: true })
    const request = { stage: 'editorial-writer', nested: { unchanged: true } }
    const result = await runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request,
      maxAttempts: 2,
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.metadata).toMatchObject({ attempts: 2, malformedOutputRetries: 1 })
    expect(generateStructured).toHaveBeenCalledTimes(2)
    expect(generateStructured.mock.calls[1][0]).toEqual(generateStructured.mock.calls[0][0])
    expect(generateStructured.mock.calls[1][0]).not.toHaveProperty('repairDiagnostic')
  })

  it('retries a failed deterministic validation once and only returns the valid second generation', async () => {
    const invalid = { ok: false, leaked: 'invalid-first-output' }
    const generateStructured = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce({ ok: true })
    const result = await runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'semantic-classifier' },
      validateOutput: (output) => ({ ok: output.ok === true, hardFailures: output.ok ? [] : [{ field: 'ok', code: 'INVALID_ENUM' }] }),
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.output).not.toEqual(invalid)
    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('keeps MALFORMED_MODEL_OUTPUT after two malformed generations', async () => {
    const generateStructured = vi.fn().mockResolvedValue('{not json')

    await expect(runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'editorial-writer' },
      maxAttempts: 2,
    })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT', details: { attempts: 2, malformedOutputRetries: 1 } } satisfies Partial<ModelProviderError>)

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('aggregates bounded usage across malformed attempts without adding thinking into total', async () => {
    const firstUsage = { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 }
    const secondUsage = { prompt_tokens: 11, completion_tokens: 21, thinking_tokens: 8, total_tokens: 32 }
    const malformed = (usage) => new ModelProviderError('malformed', { code: 'MALFORMED_MODEL_OUTPUT', details: { providerUsageMetadata: usage, providerResponseDiagnostics: { jsonParsed: false } } })
    const generateStructured = vi.fn().mockRejectedValueOnce(malformed(firstUsage)).mockRejectedValueOnce(malformed(secondUsage))
    const error = await runStructuredModelRequest({ provider: { ...provider, generateStructured }, request: { stage: 'semantic-classifier' }, maxAttempts: 2 }).catch((value) => value as ModelProviderError)
    expect(error.details?.providerUsageMetadata).toEqual({ prompt_tokens: 21, completion_tokens: 41, thinking_tokens: 15, total_tokens: 62 })
    expect(error.details?.providerUsageByRequest).toEqual([firstUsage, secondUsage])
    expect((error.details?.providerUsageMetadata as Record<string, number>).total_tokens).toBe(30 + 32)
  })

  it('reports the first sanitized schema validation path and keyword', async () => {
    const generateStructured = vi.fn().mockResolvedValue({ pace: 'turbo' })

    await expect(runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'semantic-classifier' },
      validateOutput: () => ({ ok: false, hardFailures: [{ field: 'attentionDemand', code: 'INVALID_ENUM' }] }),
    })).rejects.toMatchObject({
      code: 'MALFORMED_MODEL_OUTPUT',
      message: expect.stringContaining('path: attentionDemand; keyword: INVALID_ENUM'),
    })
  })

  it('retains bounded validation diagnostics and provider usage for a terminal malformed output', async () => {
    const generateStructured = vi.fn().mockResolvedValue({ pace: 'turbo', providerUsageMetadata: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 }, providerResponseDiagnostics: { jsonParsed: true, topLevelJsonKeys: ['pace'], responseCharacterLength: 17, finishReason: 'stop' } })
    await expect(runStructuredModelRequest({
      provider: { ...provider, generateStructured }, request: { stage: 'semantic-classifier' }, maxAttempts: 1,
      validateOutput: () => ({ ok: false, hardFailures: [{ field: 'pace', code: 'INVALID_ENUM' }] }),
    })).rejects.toMatchObject({
      code: 'MALFORMED_MODEL_OUTPUT',
      details: { providerUsageMetadata: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 }, providerResponseDiagnostics: { jsonParsed: true, topLevelJsonKeys: ['pace'], responseCharacterLength: 17, finishReason: 'stop', validation: { code: 'INVALID_ENUM', path: 'pace', keyword: 'INVALID_ENUM' } }, attempts: 1, malformedOutputRetries: 0 },
    } satisfies Partial<ModelProviderError>)
  })

  it('stops after the configured retry limit for transient model failures', async () => {
    const transientError = new ModelProviderError('try again', { retryable: true })
    const generateStructured = vi.fn().mockRejectedValue(transientError)
    const delayFn = vi.fn()

    await expect(runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'critic' },
      maxAttempts: 2,
      delayFn,
    })).rejects.toMatchObject({ code: 'MODEL_RETRY_LIMIT' })

    expect(generateStructured).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledTimes(1)
  })

  it('uses provider retry timing for bounded rate-limit retries', async () => {
    const rateLimitError = new ModelProviderError('rate limited', { retryable: true, retryAfterMs: 27000 })
    const generateStructured = vi.fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ ok: true })
    const delayFn = vi.fn().mockResolvedValue(undefined)

    const result = await runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'semantic-classifier' },
      maxAttempts: 2,
      delayFn,
    })

    expect(result.output).toEqual({ ok: true })
    expect(delayFn).toHaveBeenCalledWith(27000)
    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable provider failure', async () => {
    const generateStructured = vi.fn().mockRejectedValue(new ModelProviderError('no retry', { retryable: false }))
    await expect(runStructuredModelRequest({ provider: { ...provider, generateStructured }, request: { stage: 'critic' } })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_FAILURE' })
    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it('keeps credentials outside committed provider config', () => {
    expect(resolveCredential({
      credentialEnv: 'MODEL_API_KEY',
      env: { MODEL_API_KEY: 'runtime-secret' },
    })).toBe('runtime-secret')

    expect(() => assertCredentialIsolation({
      providerId: 'bad-provider',
      modelId: 'bad-model',
      apiKey: 'do-not-commit',
    })).toThrow(/inline credentials/i)

    expect(loadProviderConfig({
      config: {
        providerId: 'mock-provider',
        modelId: 'mock-model-v1',
        credentialEnv: 'MODEL_API_KEY',
      },
      env: { MODEL_API_KEY: 'runtime-secret' },
    })).toMatchObject({
      providerId: 'mock-provider',
      modelId: 'mock-model-v1',
      credentialEnv: 'MODEL_API_KEY',
      credential: 'runtime-secret',
    })
  })

  it('uses stable version-aware cache keys without tmdbId-only behavior', () => {
    const base = {
      stage: 'semantic-classifier',
      tmdbId: 603,
      factsHash: 'facts-v1',
      schemaVersion: 'semantic-output.v1',
      promptVersion: 'semantic-prompt.v1',
      taxonomyVersion: 'taxonomy.v1',
      voiceGuideVersion: undefined,
      calibrationHash: 'calibration-v1',
      providerId: 'mock-provider',
      modelId: 'mock-model-v1',
    }

    const first = createModelCacheKey(base)
    const second = createModelCacheKey({ ...base })
    const promptChanged = createModelCacheKey({ ...base, promptVersion: 'semantic-prompt.v2' })
    const factsChanged = createModelCacheKey({ ...base, factsHash: 'facts-v2' })
    const calibrationChanged = createModelCacheKey({ ...base, calibrationHash: 'calibration-v2' })
    const modelChanged = createModelCacheKey({ ...base, modelId: 'mock-model-v2' })
    const configurationChanged = createModelCacheKey({ ...base, providerConfiguration: { reasoningEffort: 'high' } })

    expect(first).toHaveLength(64)
    expect(first).toBe(second)
    expect(first).toBe(stableHash({ ...base, voiceGuideVersion: null }))
    expect(new Set([first, promptChanged, factsChanged, calibrationChanged, modelChanged, configurationChanged]).size).toBe(6)
  })
})
