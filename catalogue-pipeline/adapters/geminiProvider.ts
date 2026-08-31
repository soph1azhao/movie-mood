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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function buildResponseJsonSchema() {
  const evidenceItem = {
    type: 'object',
    required: ['rationale', 'sourceRefs'],
    properties: {
      rationale: { type: 'string' },
      sourceRefs: { type: 'array', items: { type: 'string' } },
    },
  }

  return {
    type: 'object',
    required: ['classification', 'evidence', 'boundaryFlags'],
    properties: {
      classification: {
        type: 'object',
        required: ['moods', 'situations', 'filterLanguages', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'],
        properties: {
          moods: { type: 'array', items: { type: 'string', enum: ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'] } },
          situations: { type: 'array', items: { type: 'string', enum: ['alone', 'date-night', 'friends', 'family', 'easy-watch'] } },
          filterLanguages: { type: 'array', items: { type: 'string' } },
          pace: { type: 'string', enum: ['slow', 'medium', 'fast'] },
          emotionalWeight: { type: 'string', enum: ['light', 'moderate', 'heavy'] },
          attentionDemand: { type: 'string', enum: ['easy', 'engaged', 'immersive'] },
          discoveryStyle: { type: 'string', enum: ['familiar', 'different', 'adventurous'] },
        },
      },
      evidence: {
        type: 'object',
        required: ['moods', 'situations', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'],
        properties: {
          moods: { type: 'object' },
          situations: { type: 'object' },
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
    throw new ModelProviderError('Gemini returned no structured text.', { code: 'MALFORMED_MODEL_OUTPUT' })
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
    throw new ModelProviderError('Gemini returned malformed structured JSON.', {
      code: 'MALFORMED_MODEL_OUTPUT',
      cause: error,
    })
  }

  throw new ModelProviderError('Gemini returned non-object structured JSON.', {
    code: 'MALFORMED_MODEL_OUTPUT',
  })
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text ? ` ${text.slice(0, 500)}` : ''
  } catch {
    return ''
  }
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
      const generationConfig: Record<string, unknown> = {
        temperature: typeof request.temperature === 'number' ? request.temperature : 0.1,
        topP: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: buildResponseJsonSchema(),
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
        throw new ModelProviderError(`Gemini request failed with HTTP ${response.status}.${await safeErrorText(response)}`, {
          code: response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_PROVIDER_HTTP_ERROR',
          retryable,
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
