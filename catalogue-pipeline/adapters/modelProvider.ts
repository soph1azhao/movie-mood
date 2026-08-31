import { stableHash } from './tmdbProvider.ts'

export const MODEL_STAGES = ['semantic-classifier', 'editorial-writer', 'critic'] as const

export class ModelProviderError extends Error {
  code: string
  retryable: boolean
  cause?: unknown

  constructor(message: string, { code = 'MODEL_PROVIDER_ERROR', retryable = false, cause = undefined } = {}) {
    super(message)
    this.name = 'ModelProviderError'
    this.code = code
    this.retryable = retryable
    this.cause = cause
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeJsonOutput(rawOutput: unknown): Record<string, unknown> {
  if (isObject(rawOutput)) return rawOutput

  if (typeof rawOutput === 'string') {
    try {
      const parsed = JSON.parse(rawOutput)
      if (isObject(parsed)) return parsed
    } catch (error) {
      throw new ModelProviderError('Model provider returned malformed JSON.', {
        code: 'MALFORMED_MODEL_OUTPUT',
        cause: error,
      })
    }
  }

  throw new ModelProviderError('Model provider returned a non-object structured output.', {
    code: 'MALFORMED_MODEL_OUTPUT',
  })
}

function splitProviderMetadata(output: Record<string, unknown>) {
  const { providerUsageMetadata, ...structuredOutput } = output
  return { structuredOutput, providerUsageMetadata }
}

export function createModelCacheKey({
  stage,
  tmdbId,
  factsHash,
  schemaVersion,
  promptVersion,
  taxonomyVersion,
  voiceGuideVersion,
  calibrationHash,
  providerId,
  modelId,
}: {
  stage: string
  tmdbId: number
  factsHash: string
  schemaVersion: string
  promptVersion: string
  taxonomyVersion?: string
  voiceGuideVersion?: string
  calibrationHash?: string
  providerId: string
  modelId: string
}): string {
  if (!MODEL_STAGES.includes(stage as (typeof MODEL_STAGES)[number])) {
    throw new ModelProviderError(`Unsupported model stage: ${stage}`, { code: 'UNSUPPORTED_MODEL_STAGE' })
  }

  return stableHash({
    stage,
    tmdbId,
    factsHash,
    schemaVersion,
    promptVersion,
    taxonomyVersion: taxonomyVersion ?? null,
    voiceGuideVersion: voiceGuideVersion ?? null,
    calibrationHash: calibrationHash ?? null,
    providerId,
    modelId,
  })
}

export async function runStructuredModelRequest({
  provider,
  request,
  validateOutput,
  maxAttempts = 2,
  delayFn = async () => {},
}: {
  provider: {
    metadata: {
      providerId: string
      modelId: string
      supportsStructuredJson: boolean
      supportsTemperature?: boolean
    }
    generateStructured: (request: Record<string, unknown>) => Promise<unknown>
  }
  request: Record<string, unknown>
  validateOutput?: (output: Record<string, unknown>) => { ok: boolean; hardFailures?: unknown[] }
  maxAttempts?: number
  delayFn?: (ms: number) => Promise<void>
}) {
  if (!provider.metadata.supportsStructuredJson) {
    throw new ModelProviderError('Model provider must support structured JSON output.', {
      code: 'STRUCTURED_OUTPUT_UNSUPPORTED',
    })
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const rawOutput = await provider.generateStructured({
        ...request,
        responseFormat: 'json_object',
        temperature: provider.metadata.supportsTemperature ? (request.temperature ?? 0.1) : undefined,
      })
      const { structuredOutput: output, providerUsageMetadata } = splitProviderMetadata(normalizeJsonOutput(rawOutput))
      const validation = validateOutput?.(output)

      if (validation && !validation.ok) {
        throw new ModelProviderError('Model provider output failed schema validation.', {
          code: 'MALFORMED_MODEL_OUTPUT',
          cause: validation.hardFailures,
        })
      }

      return {
        output,
        metadata: {
          providerId: provider.metadata.providerId,
          modelId: provider.metadata.modelId,
          attempts: attempt,
          structuredJson: true,
          ...(providerUsageMetadata ? { providerUsageMetadata } : {}),
        },
      }
    } catch (error) {
      if (error instanceof ModelProviderError && error.code === 'MALFORMED_MODEL_OUTPUT') {
        throw error
      }

      const retryable = error instanceof ModelProviderError ? error.retryable : Boolean((error as { retryable?: boolean })?.retryable)
      if (!retryable || attempt === maxAttempts) {
        throw new ModelProviderError(`Model provider failed after ${attempt} attempt(s).`, {
          code: attempt === maxAttempts && retryable ? 'MODEL_RETRY_LIMIT' : 'MODEL_PROVIDER_FAILURE',
          retryable,
          cause: error,
        })
      }

      await delayFn(250 * 2 ** (attempt - 1))
    }
  }

  throw new ModelProviderError('Model provider failed after bounded retries.', {
    code: 'MODEL_RETRY_LIMIT',
    retryable: true,
  })
}
