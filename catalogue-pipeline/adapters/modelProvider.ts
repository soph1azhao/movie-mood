import { stableHash } from './tmdbProvider.ts'

export const MODEL_STAGES = ['semantic-classifier', 'editorial-writer', 'critic'] as const

export class ModelProviderError extends Error {
  code: string
  retryable: boolean
  retryAfterMs?: number
  cause?: unknown
  details?: Record<string, unknown>

  constructor(message: string, { code = 'MODEL_PROVIDER_ERROR', retryable = false, retryAfterMs = undefined, cause = undefined, details = undefined }: { code?: string; retryable?: boolean; retryAfterMs?: number; cause?: unknown; details?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'ModelProviderError'
    this.code = code
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
    this.cause = cause
    this.details = details
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

function validationDiagnostic(failures: unknown): string {
  const first = Array.isArray(failures) ? failures[0] : undefined
  if (!first || typeof first !== 'object') return ''
  const issue = first as Record<string, unknown>
  const path = typeof issue.field === 'string' ? issue.field : typeof issue.path === 'string' ? issue.path : 'output'
  const keyword = typeof issue.keyword === 'string'
    ? issue.keyword
    : typeof issue.code === 'string'
      ? issue.code
      : 'validation'
  return ` path: ${path}; keyword: ${keyword}.`
}

function aggregateProviderUsageMetadata(entries: unknown[]): Record<string, unknown> | undefined {
  const metadata = entries.filter(isObject)
  if (metadata.length === 0) return undefined
  if (metadata.length === 1) return metadata[0]
  const aggregate: Record<string, unknown> = {}
  for (const entry of metadata) {
    for (const [key, value] of Object.entries(entry)) {
      aggregate[key] = typeof value === 'number' && typeof aggregate[key] === 'number'
        ? aggregate[key] + value
        : value
    }
  }
  return aggregate
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
  providerConfiguration,
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
  providerConfiguration?: Record<string, unknown>
}): string {
  if (!MODEL_STAGES.includes(stage as (typeof MODEL_STAGES)[number])) {
    throw new ModelProviderError(`Unsupported model stage: ${stage}`, { code: 'UNSUPPORTED_MODEL_STAGE' })
  }

  const cacheIdentity: Record<string, unknown> = {
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
  }
  if (providerConfiguration) cacheIdentity.providerConfiguration = providerConfiguration
  return stableHash(cacheIdentity)
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
      supportsMalformedOutputRepair?: boolean
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

  const usageEntries: unknown[] = []
  let transportRetries = 0
  let malformedOutputRetries = 0
  const providerRequest = {
    ...request,
    responseFormat: 'json_object',
    temperature: provider.metadata.supportsTemperature ? (request.temperature ?? 0.1) : undefined,
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const rawOutput = await provider.generateStructured(providerRequest)
      const { structuredOutput: output, providerUsageMetadata } = splitProviderMetadata(normalizeJsonOutput(rawOutput))
      if (providerUsageMetadata) usageEntries.push(providerUsageMetadata)
      const validation = validateOutput?.(output)

      if (validation && !validation.ok) {
        throw new ModelProviderError(`Model provider output failed schema validation.${validationDiagnostic(validation.hardFailures)}`, {
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
          ...(transportRetries > 0 ? { transportRetries } : {}),
          ...(malformedOutputRetries > 0 ? { malformedOutputRetries } : {}),
          ...(aggregateProviderUsageMetadata(usageEntries) ? { providerUsageMetadata: aggregateProviderUsageMetadata(usageEntries) } : {}),
          ...(usageEntries.length > 1 ? { providerUsageByRequest: usageEntries } : {}),
        },
      }
    } catch (error) {
      if (error instanceof ModelProviderError && error.code === 'MALFORMED_MODEL_OUTPUT') {
        if (attempt < maxAttempts) {
          malformedOutputRetries += 1
          continue
        }
        throw new ModelProviderError(error.message, {
          code: 'MALFORMED_MODEL_OUTPUT',
          cause: error.cause,
          details: { attempts: attempt, malformedOutputRetries },
        })
      }

      const retryable = error instanceof ModelProviderError ? error.retryable : Boolean((error as { retryable?: boolean })?.retryable)
      if (!retryable || attempt === maxAttempts) {
        throw new ModelProviderError(`Model provider failed after ${attempt} attempt(s).`, {
          code: attempt === maxAttempts && retryable ? 'MODEL_RETRY_LIMIT' : 'MODEL_PROVIDER_FAILURE',
          retryable,
          cause: error,
        })
      }

      transportRetries += 1
      await delayFn(error instanceof ModelProviderError && error.retryAfterMs !== undefined
        ? error.retryAfterMs
        : 250 * 2 ** (attempt - 1))
    }
  }

  throw new ModelProviderError('Model provider failed after bounded retries.', {
    code: 'MODEL_RETRY_LIMIT',
    retryable: true,
  })
}
