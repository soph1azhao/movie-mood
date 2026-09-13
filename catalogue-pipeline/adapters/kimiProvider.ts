import { ModelProviderError } from './modelProvider.ts'
import { resolveCredential } from './providerConfig.ts'
import { stableHash } from './tmdbProvider.ts'
import { buildSemanticResponseJsonSchema } from './geminiProvider.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type KimiReasoningEffort = 'default' | 'low' | 'high' | 'max' | 'disabled'
export type KimiOutputMode = 'json_object' | 'json_schema'

type KimiProviderOptions = {
  modelId: string
  reasoningEffort?: KimiReasoningEffort
  outputMode?: KimiOutputMode
  semanticOutputSchemaVersion?: 'semantic-output.v2'
  semanticOutputSchemaProjectionVersion?: 'legacy-v1' | 'current'
  /** @deprecated Use reasoningEffort: 'disabled'. */
  thinkingMode?: 'default' | 'disabled'
  credentialEnv?: string
  env?: Record<string, string | undefined>
  fetchImpl?: FetchLike
  endpointBaseUrl?: string
  onResponseReceived?: (metadata: Record<string, unknown>) => Promise<unknown> | unknown
}

export const KIMI_PROVIDER_ID = 'moonshot-kimi-api'
export const KIMI_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1'
export const KIMI_SUPPORTED_MODELS = ['kimi-k2.5', 'kimi-for-coding', 'kimi-for-coding-highspeed', 'k3', 'k3-256k'] as const

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function responseDiagnostics(content: unknown, finishReason: unknown, extras: Record<string, unknown> = {}) {
  return {
    jsonParsed: false,
    topLevelJsonKeys: null,
    responseCharacterLength: typeof content === 'string' ? content.length : null,
    finishReason: typeof finishReason === 'string' ? finishReason : null,
    ...extras,
  }
}

function parseStructuredContent(content: unknown, { providerUsageMetadata, finishReason }: { providerUsageMetadata?: Record<string, number>; finishReason: unknown }): { output: Record<string, unknown>; providerResponseDiagnostics: Record<string, unknown> } {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ModelProviderError('Kimi returned empty structured content.', { code: 'MALFORMED_MODEL_OUTPUT', details: {
      ...(providerUsageMetadata ? { providerUsageMetadata } : {}),
      providerResponseDiagnostics: responseDiagnostics(content, finishReason, { parseErrorCode: 'EMPTY_STRUCTURED_CONTENT' }),
    } })
  }
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return {
      output: parsed as Record<string, unknown>,
      providerResponseDiagnostics: responseDiagnostics(content, finishReason, { jsonParsed: true, topLevelJsonKeys: Object.keys(parsed).sort() }),
    }
  } catch (cause) {
    throw new ModelProviderError('Kimi returned invalid JSON.', { code: 'MALFORMED_MODEL_OUTPUT', cause, details: {
      ...(providerUsageMetadata ? { providerUsageMetadata } : {}),
      providerResponseDiagnostics: responseDiagnostics(content, finishReason, { parseErrorCode: 'INVALID_JSON' }),
    } })
  }
  throw new ModelProviderError('Kimi returned non-object JSON.', { code: 'MALFORMED_MODEL_OUTPUT', details: {
    ...(providerUsageMetadata ? { providerUsageMetadata } : {}),
    providerResponseDiagnostics: responseDiagnostics(content, finishReason, { parseErrorCode: 'NON_OBJECT_JSON' }),
  } })
}

function extractStructuredContent(body: Record<string, unknown>, providerUsageMetadata?: Record<string, number>) {
  const choices = Array.isArray(body.choices) ? body.choices : []
  const choice = asObject(choices[0])
  return parseStructuredContent(asObject(choice.message).content, { providerUsageMetadata, finishReason: choice.finish_reason })
}

function normalizedUsage(body: Record<string, unknown>): Record<string, number> | undefined {
  const usage = asObject(body.usage)
  const completionDetails = asObject(usage.completion_tokens_details)
  const promptDetails = asObject(usage.prompt_tokens_details)
  const values: Record<string, unknown> = {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    thinking_tokens: completionDetails.reasoning_tokens,
    cached_tokens: promptDetails.cached_tokens,
  }
  const result = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'number')) as Record<string, number>
  return Object.keys(result).length > 0 ? result : undefined
}

async function safeErrorText(response: Response, credential: string): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 500).replaceAll(credential, '[REDACTED_CREDENTIAL]')
    return text ? ` ${text}` : ''
  } catch {
    return ''
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers?.get?.('retry-after') ?? response.headers?.get?.('Retry-After') ?? null
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined
}

export function createKimiProvider({
  modelId,
  reasoningEffort = 'default',
  outputMode = 'json_object',
  semanticOutputSchemaVersion,
  semanticOutputSchemaProjectionVersion = 'current',
  thinkingMode = 'default',
  credentialEnv = 'KIMI_API_KEY',
  env = process.env,
  fetchImpl = globalThis.fetch,
  endpointBaseUrl,
  onResponseReceived,
}: KimiProviderOptions) {
  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    throw new ModelProviderError('Kimi provider requires an explicit modelId.', { code: 'MISSING_MODEL_ID' })
  }
  if (!['default', 'disabled'].includes(thinkingMode)) {
    throw new ModelProviderError('Kimi thinkingMode must be default or disabled.', { code: 'INVALID_THINKING_MODE' })
  }
  if (!['default', 'low', 'high', 'max', 'disabled'].includes(reasoningEffort)) {
    throw new ModelProviderError('Kimi reasoningEffort must be default, low, high, max, or disabled.', { code: 'INVALID_REASONING_EFFORT' })
  }
  if (!['json_object', 'json_schema'].includes(outputMode)) {
    throw new ModelProviderError('Kimi outputMode must be json_object or json_schema.', { code: 'INVALID_OUTPUT_MODE' })
  }
  if (outputMode === 'json_schema' && semanticOutputSchemaVersion !== 'semantic-output.v2') {
    throw new ModelProviderError('Kimi json_schema mode requires semantic-output.v2.', { code: 'INVALID_SEMANTIC_OUTPUT_SCHEMA_VERSION' })
  }
  if (!['legacy-v1', 'current'].includes(semanticOutputSchemaProjectionVersion)) {
    throw new ModelProviderError('Kimi semantic output schema projection must be legacy-v1 or current.', { code: 'INVALID_SEMANTIC_OUTPUT_SCHEMA_PROJECTION' })
  }
  if (thinkingMode === 'disabled' && reasoningEffort !== 'default' && reasoningEffort !== 'disabled') {
    throw new ModelProviderError('Kimi thinkingMode disabled conflicts with reasoningEffort.', { code: 'CONFLICTING_REASONING_CONFIGURATION' })
  }
  if (typeof fetchImpl !== 'function') throw new ModelProviderError('Kimi provider requires fetch.', { code: 'MISSING_FETCH' })
  const credential = resolveCredential({ credentialEnv, env }).trim()
  if (!credential) throw new ModelProviderError(`Required provider credential env var is empty: ${credentialEnv}`, { code: 'MISSING_PROVIDER_CREDENTIAL' })
  const baseUrl = (endpointBaseUrl ?? env.KIMI_BASE_URL ?? KIMI_DEFAULT_BASE_URL).replace(/\/$/, '')
  const resolvedReasoningEffort: KimiReasoningEffort = thinkingMode === 'disabled' ? 'disabled' : reasoningEffort
  const supportsTemperature = !['low', 'high', 'max'].includes(resolvedReasoningEffort)
  const semanticOutputSchema = outputMode === 'json_schema' ? buildSemanticResponseJsonSchema([], semanticOutputSchemaVersion, semanticOutputSchemaProjectionVersion) : null
  const semanticOutputSchemaHash = semanticOutputSchema ? `sha256:${stableHash(semanticOutputSchema)}` : null
  const outputAffectingConfiguration = outputMode === 'json_schema'
    ? { protocol: 'openai-chat-completions', reasoningEffort: resolvedReasoningEffort, outputMode, semanticOutputSchemaVersion, semanticOutputSchemaHash }
    : { protocol: 'openai-chat-completions', reasoningEffort: resolvedReasoningEffort }

  return {
    metadata: {
      providerId: KIMI_PROVIDER_ID,
      modelId: modelId.trim(),
      supportsStructuredJson: true,
      supportsTemperature,
      outputAffectingConfiguration,
    },
    async generateStructured(request: Record<string, unknown>) {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId.trim(),
          messages: [{ role: 'user', content: JSON.stringify(request.input) }],
          stream: false,
          ...(supportsTemperature && typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
          response_format: outputMode === 'json_schema'
            ? { type: 'json_schema', json_schema: { name: 'semantic_output_v2', strict: true, schema: semanticOutputSchema } }
            : { type: 'json_object' },
          ...(['low', 'high', 'max'].includes(resolvedReasoningEffort) ? { reasoning_effort: resolvedReasoningEffort } : {}),
          ...(resolvedReasoningEffort === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
        }),
      })
      if (!response.ok) {
        const diagnostic = await safeErrorText(response, credential)
        throw new ModelProviderError(`Kimi request failed with HTTP ${response.status}.${diagnostic}`, {
          code: response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_PROVIDER_HTTP_ERROR',
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: response.status === 429 ? retryAfterMs(response) : undefined,
          details: { httpStatus: response.status },
        })
      }
      await onResponseReceived?.({ status: response.status, provider: KIMI_PROVIDER_ID, model: modelId.trim(), phase: request.stage, promptVersion: request.promptVersion, schemaVersion: request.schemaVersion })
      const body = asObject(await response.json())
      const providerUsageMetadata = normalizedUsage(body)
      const { output, providerResponseDiagnostics } = extractStructuredContent(body, providerUsageMetadata)
      const result = { ...output, ...(providerUsageMetadata ? { providerUsageMetadata } : {}) }
      Object.defineProperty(result, 'providerResponseDiagnostics', { value: providerResponseDiagnostics, enumerable: false })
      return result
    },
  }
}
