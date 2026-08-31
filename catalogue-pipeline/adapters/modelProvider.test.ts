import { describe, expect, it, vi } from 'vitest'
import { assertCredentialIsolation, loadProviderConfig, resolveCredential } from './providerConfig.ts'
import { createModelCacheKey, ModelProviderError, runStructuredModelRequest } from './modelProvider.ts'

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

  it('rejects malformed structured output without retrying', async () => {
    const generateStructured = vi.fn().mockResolvedValue('{not json')

    await expect(runStructuredModelRequest({
      provider: { ...provider, generateStructured },
      request: { stage: 'editorial-writer' },
      maxAttempts: 3,
    })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' } satisfies Partial<ModelProviderError>)

    expect(generateStructured).toHaveBeenCalledTimes(1)
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

    expect(first).toHaveLength(64)
    expect(first).toBe(second)
    expect(new Set([first, promptChanged, factsChanged, calibrationChanged, modelChanged]).size).toBe(5)
  })
})
