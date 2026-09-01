import { ModelProviderError } from './modelProvider.ts'
import { resolveCredential } from './providerConfig.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type GeminiProviderOptions = {
  modelId: string
  credentialEnv?: string
  env?: Record<string, string | undefined>
  fetchImpl?: FetchLike
  endpointBaseUrl?: string
}

const DEFAULT_ENDPOINT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const RETRY_SAFETY_MARGIN_MS = 1000
const MAX_PROVIDER_RETRY_DELAY_MS = 10 * 60 * 1000
export const GEMINI_SCHEMA_PROJECTION_VERSION = 'gemini-generate-content-schema.v1'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function buildGeminiResponseJsonSchema(sourceRefs: string[] = []) {
  const validSourceRefs = [...new Set(sourceRefs.filter((sourceRef) => typeof sourceRef === 'string' && sourceRef.length > 0))].sort()
  const sourceRefsSchema = validSourceRefs.length > 0
    ? { type: 'array', minItems: 1, items: { type: 'string', enum: validSourceRefs } }
    : { type: 'array', minItems: 1, items: { type: 'string' } }
  const evidenceItem = {
    type: 'object',
    required: ['rationale', 'sourceRefs'],
    properties: {
      rationale: { type: 'string' },
      sourceRefs: sourceRefsSchema,
    },
    additionalProperties: false,
  }

  return {
    type: 'object',
    required: ['classification', 'evidence', 'boundaryFlags'],
    additionalProperties: false,
    properties: {
      classification: {
        type: 'object',
        required: ['moods', 'situations', 'filterLanguages', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'],
        additionalProperties: false,
        properties: {
          moods: { type: 'array', minItems: 1, items: { type: 'string', enum: ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'] } },
          situations: { type: 'array', minItems: 1, items: { type: 'string', enum: ['alone', 'date-night', 'friends', 'family', 'easy-watch'] } },
          filterLanguages: { type: 'array', minItems: 1, items: { type: 'string' } },
          pace: { type: 'string', enum: ['slow', 'medium', 'fast'] },
          emotionalWeight: { type: 'string', enum: ['light', 'moderate', 'heavy'] },
          attentionDemand: { type: 'string', enum: ['easy', 'engaged', 'immersive'] },
          discoveryStyle: { type: 'string', enum: ['familiar', 'different', 'adventurous'] },
        },
      },
      evidence: {
        type: 'object',
        required: ['moods', 'situations', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'],
        additionalProperties: false,
        properties: {
          moods: { type: 'object', additionalProperties: evidenceItem },
          situations: { type: 'object', additionalProperties: evidenceItem },
          pace: evidenceItem,
          emotionalWeight: evidenceItem,
          attentionDemand: evidenceItem,
          discoveryStyle: evidenceItem,
        },
      },
      boundaryFlags: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'fields', 'message', 'reviewRequired'],
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' },
            reviewRequired: { type: 'boolean' },
          },
        },
      },
      selfConfidence: {
        type: 'object',
        additionalProperties: { type: 'number' },
      },
    },
  }
}

function extractText(responseBody: Record<string, unknown>): string {
  const candidates = Array.isArray(responseBody.candidates) ? responseBody.candidates : []
  const firstCandidate = asObject(candidates[0])
  const content = asObject(firstCandidate.content)
  const parts = Array.isArray(content.parts) ? content.parts : []
  const text = parts.map((part) => asObject(part).text).filter((value): value is string => typeof value === 'string').join('')
  if (!text.trim()) {
    throw new ModelProviderError('Gemini returned no structured text. [response-extraction]', { code: 'MALFORMED_MODEL_OUTPUT' })
  }
  return text
}

function usageMetadata(responseBody: Record<string, unknown>) {
  const usage = asObject(responseBody.usageMetadata)
  return {
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    thoughtsTokenCount: usage.thoughtsTokenCount,
  }
}

function parseStructuredText(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch (error) {
    throw new ModelProviderError('Gemini returned malformed structured JSON. [invalid-json]', {
      code: 'MALFORMED_MODEL_OUTPUT',
      cause: error,
    })
  }

  throw new ModelProviderError('Gemini returned non-object structured JSON.', {
    code: 'MALFORMED_MODEL_OUTPUT',
  })
}

async function safeErrorText(response: Response, credential: string): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return ''
    return ` ${text.slice(0, 500).replaceAll(credential, '[REDACTED_CREDENTIAL]')}`
  } catch {
    return ''
  }
}

function boundedDelayMs(delayMs: number): number | undefined {
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_PROVIDER_RETRY_DELAY_MS) return undefined
  return delayMs + RETRY_SAFETY_MARGIN_MS
}

function parseRetryDelayDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^\s*(\d+(?:\.\d+)?)s\s*$/.exec(value)
  if (!match) return undefined
  return boundedDelayMs(Number(match[1]) * 1000)
}

function retryAfterHeaderMs(response: Response): number | undefined {
  const value = response.headers?.get?.('retry-after') ?? response.headers?.get?.('Retry-After') ?? null
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return boundedDelayMs(seconds * 1000)
  const timestamp = Date.parse(value)
  if (Number.isFinite(timestamp)) return boundedDelayMs(Math.max(0, timestamp - Date.now()))
  return undefined
}

function retryInfoDelayMs(errorText: string): number | undefined {
  try {
    const parsed = JSON.parse(errorText)
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : []
    const retryInfo = details.find((detail: unknown) => {
      const object = asObject(detail)
      return object['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
    })
    return parseRetryDelayDuration(asObject(retryInfo).retryDelay)
  } catch {
    return undefined
  }
}

function retryMessageDelayMs(errorText: string): number | undefined {
  const match = /\bPlease retry in (\d+(?:\.\d+)?)s\s*\.?/i.exec(errorText)
  return match ? parseRetryDelayDuration(`${match[1]}s`) : undefined
}

function retryDelayMs(response: Response, errorText: string): number | undefined {
  return retryAfterHeaderMs(response) ?? retryInfoDelayMs(errorText) ?? retryMessageDelayMs(errorText)
}

export function createGeminiProvider({
  modelId,
  credentialEnv = 'GEMINI_API_KEY',
  env = process.env,
  fetchImpl = globalThis.fetch,
  endpointBaseUrl = DEFAULT_ENDPOINT_BASE_URL,
}: GeminiProviderOptions) {
  if (!modelId || typeof modelId !== 'string') {
    throw new ModelProviderError('Gemini provider requires a modelId.', { code: 'MISSING_MODEL_ID' })
  }
  if (typeof fetchImpl !== 'function') {
    throw new ModelProviderError('Gemini provider requires fetch.', { code: 'MISSING_FETCH' })
  }
  const credential = resolveCredential({ credentialEnv, env }).trim()

  return {
    metadata: {
      providerId: 'google-gemini-developer-api',
      modelId,
      supportsStructuredJson: true,
      supportsTemperature: true,
    },
    async generateStructured(request: Record<string, unknown>) {
      const url = `${endpointBaseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(modelId)}:generateContent`
      const requestInput = asObject(request.input)
      const evidencePacket = asObject(requestInput.evidencePacket)
      const sourceRefs = Array.isArray(evidencePacket.sourceProvenance)
        ? evidencePacket.sourceProvenance.map((source) => asObject(source).source).filter((source): source is string => typeof source === 'string')
        : []
      const generationConfig: Record<string, unknown> = {
        temperature: typeof request.temperature === 'number' ? request.temperature : 0.1,
        topP: 0.2,
        responseFormat: {
          text: {
            mimeType: 'APPLICATION_JSON',
            schema: buildGeminiResponseJsonSchema(sourceRefs),
          },
        },
      }
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': credential,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(request.input) }] }],
          generationConfig,
        }),
      })

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        const errorText = await safeErrorText(response, credential)
        throw new ModelProviderError(`Gemini request failed with HTTP ${response.status}.${errorText}`, {
          code: response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_PROVIDER_HTTP_ERROR',
          retryable,
          retryAfterMs: response.status === 429 ? retryDelayMs(response, errorText) : undefined,
        })
      }

      const body = asObject(await response.json())
      const parsed = parseStructuredText(extractText(body))
      return {
        ...parsed,
        providerUsageMetadata: usageMetadata(body),
      }
    },
  }
}
