import { createHash } from 'node:crypto'
import { serializeArtifactForPersistence } from '../scripts/validatePromotionContract.mjs'

export const GEMINI_EDITORIAL_PROVIDER_ID = 'google-gemini-developer-api'
export const GEMINI_EDITORIAL_MODEL_ID = 'gemini-3.8-flash'
export const GEMINI_EDITORIAL_SCHEMA_PROJECTION_VERSION = 'gemini-editorial-structured-output.v3'
export const GEMINI_EDITORIAL_TRANSPORT_VERSION = 'gemini-3.8-generate-content-response-format.v1'
export const THINKING_LEVELS = Object.freeze({ writer: 'low', critic: 'medium' })

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504])
export const MAX_RETRY_DELAY_MS = 30_000

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export class GeminiEditorialProviderError extends Error {
  constructor(message, { code, category, retryable = false, ambiguous = false, status = null, cause = null } = {}) {
    super(message)
    this.name = 'GeminiEditorialProviderError'
    this.code = code
    this.category = category
    this.retryable = retryable
    this.ambiguous = ambiguous
    this.status = status
    this.cause = cause
  }
}

function copyProperties() {
  return {
    description: { type: 'string', minLength: 80, maxLength: 220 },
    whyWatch: { type: 'string', minLength: 60, maxLength: 180 },
    curiosityHook: { type: 'string', minLength: 50, maxLength: 170 },
    vibeSummary: { type: 'string', minLength: 45, maxLength: 150 },
  }
}

export function buildEditorialGeminiSchema({ candidateId, tmdbId }) {
  return {
    type: 'object',
    required: ['schemaVersion', 'promptVersion', 'voiceGuideVersion', 'movie', 'copy', 'writerNotes'],
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'string', enum: ['editorial-output.v1'] },
      promptVersion: { type: 'string', enum: ['editorial-writer.v1'] },
      voiceGuideVersion: { type: 'string', enum: ['voice.v2'] },
      movie: {
        type: 'object', required: ['candidateId', 'tmdbId'], additionalProperties: false,
        properties: { candidateId: { type: 'string', enum: [candidateId] }, tmdbId: { type: 'integer', enum: [tmdbId] } },
      },
      copy: { type: 'object', required: Object.keys(copyProperties()), additionalProperties: false, properties: copyProperties() },
      writerNotes: {
        type: 'object', required: ['spoilerBoundary'], additionalProperties: false,
        properties: {
          spoilerBoundary: {
            type: 'object', required: ['allowedMaterial', 'excludedMaterial', 'sourceRefs'], additionalProperties: false,
            properties: {
              allowedMaterial: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              excludedMaterial: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              sourceRefs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
          },
        },
      },
    },
  }
}

export function buildCriticGeminiSchema({ candidateId, tmdbId }) {
  const assessmentNames = ['taxonomyAlignment', 'voiceConsistency', 'specificity', 'descriptionHookDifferentiation', 'genericLanguageRisk', 'syntacticRepetitionRisk', 'setupOnlySpoilerCompliance', 'synopsisDrift', 'distinctiveness', 'layoutFit']
  return {
    type: 'object',
    required: ['schemaVersion', 'promptVersion', 'voiceGuideVersion', 'movie', 'verdict', 'issues', 'copyAssessment'],
    additionalProperties: false,
    properties: {
      schemaVersion: { type: 'string', enum: ['critic-output.v1'] },
      promptVersion: { type: 'string', enum: ['editorial-critic.v1'] },
      voiceGuideVersion: { type: 'string', enum: ['voice.v2'] },
      movie: {
        type: 'object', required: ['candidateId', 'tmdbId'], additionalProperties: false,
        properties: { candidateId: { type: 'string', enum: [candidateId] }, tmdbId: { type: 'integer', enum: [tmdbId] } },
      },
      verdict: { type: 'string', enum: ['hard_fail', 'needs_review', 'approve_for_review', 'candidate_for_auto_accept'] },
      issues: {
        type: 'array',
        items: {
          type: 'object', required: ['code', 'message', 'fields'], additionalProperties: false,
          properties: { code: { type: 'string', minLength: 1 }, message: { type: 'string', minLength: 1 }, fields: { type: 'array', items: { type: 'string' } } },
        },
      },
      copyAssessment: {
        type: 'object', required: assessmentNames, additionalProperties: false,
        properties: Object.fromEntries(assessmentNames.map((name) => [name, { type: 'string', enum: ['pass', 'review', 'fail'] }])),
      },
    },
  }
}

export function buildCriticGeminiSchemaV11(identity) {
  const schema = buildCriticGeminiSchema(identity)
  schema.properties.promptVersion.enum = ['editorial-critic.v1.1']
  return schema
}

// Gemini's response-format schema accepts a documented JSON-Schema subset. Keep
// this projection provider-local: authoritative Movie Mood validation remains
// responsible for constraints omitted from the transport schema.
const GEMINI_RESPONSE_SCHEMA_KEYS = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description',
  'enum', 'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum',
  'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required',
])

export function projectGeminiResponseJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map((entry) => projectGeminiResponseJsonSchema(entry))
  if (!schema || typeof schema !== 'object') return schema
  const projected = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_RESPONSE_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' || key === '$defs') {
      if (value && typeof value === 'object' && !Array.isArray(value)) projected[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, projectGeminiResponseJsonSchema(child)]))
      continue
    }
    if (key === 'items' || key === 'additionalProperties') {
      projected[key] = value && typeof value === 'object' ? projectGeminiResponseJsonSchema(value) : value
      continue
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') {
      projected[key] = Array.isArray(value) ? value.map((entry) => projectGeminiResponseJsonSchema(entry)) : value
      continue
    }
    projected[key] = value
  }
  if ((projected.type === 'integer' || projected.type === 'number') && Array.isArray(projected.enum) && projected.enum.every((value) => typeof value === 'number')) delete projected.enum
  return projected
}

export function buildGemini38Request({ modelId = GEMINI_EDITORIAL_MODEL_ID, promptText, input, responseSchema, thinkingLevel, maxOutputTokens }) {
  if (!['low', 'medium', 'high'].includes(thinkingLevel)) throw new GeminiEditorialProviderError('Invalid thinking level.', { code: 'INVALID_THINKING_LEVEL', category: 'configuration' })
  if (typeof promptText !== 'string' || promptText.length === 0) throw new GeminiEditorialProviderError('A non-empty exact prompt text is required.', { code: 'MISSING_PROMPT_TEXT', category: 'configuration' })
  const canonicalInput = serializeArtifactForPersistence(input)
  const projectedSchema = projectGeminiResponseJsonSchema(responseSchema)
  const canonicalSchema = serializeArtifactForPersistence(projectedSchema)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`
  const body = {
    systemInstruction: { parts: [{ text: promptText }] },
    contents: [{ role: 'user', parts: [{ text: canonicalInput }] }],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: projectedSchema,
        },
      },
      maxOutputTokens,
      thinkingConfig: { thinkingLevel },
    },
  }
  return {
    endpoint,
    requestMetadata: {
      promptRawByteHash: sha256(promptText),
      packetCanonicalByteHash: sha256(canonicalInput),
      schemaCanonicalByteHash: sha256(canonicalSchema),
      completeRequestHash: sha256(serializeArtifactForPersistence({ endpoint, body })),
    },
    body,
  }
}

export function classifyGeminiFailure({ status = null, responseReceived = false, malformedOutput = false, cause = null } = {}) {
  // A response-bearing malformed output has a known delivery outcome. T3 must
  // route it locally, never spend its transient transport retry reserve.
  if (malformedOutput) return new GeminiEditorialProviderError('Gemini model output failed structured validation.', { code: 'MODEL_OUTPUT_INVALID', category: 'model-output-validation', retryable: false, cause })
  if (responseReceived) {
    const retryable = RETRYABLE_HTTP_STATUS.has(status)
    return new GeminiEditorialProviderError(`Gemini HTTP response ${status}.`, { code: retryable ? 'PROVIDER_HTTP_RETRYABLE' : 'PROVIDER_HTTP_TERMINAL', category: 'provider-http', retryable, status, cause })
  }
  return new GeminiEditorialProviderError('Gemini transport outcome is ambiguous; automatic redispatch is prohibited.', { code: 'AMBIGUOUS_TRANSPORT_OUTCOME', category: 'ambiguous-transport', ambiguous: true, retryable: false, cause })
}

export function mayRedispatch(error, { attempt, maxAttempts }) {
  return error instanceof GeminiEditorialProviderError && error.retryable && !error.ambiguous && attempt < maxAttempts
}

export function extractGeminiStructuredOutput(body) {
  const parts = body?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) throw classifyGeminiFailure({ malformedOutput: true })
  const text = parts.map((part) => part?.text).filter((value) => typeof value === 'string').join('')
  if (!text.trim()) throw classifyGeminiFailure({ malformedOutput: true })
  try {
    const output = JSON.parse(text)
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Structured output must be an object.')
    return output
  } catch (error) {
    throw classifyGeminiFailure({ malformedOutput: true, cause: error })
  }
}

function parseDurationMs(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:s|sec(?:onds?)?)/i)
  return match ? Number(match[1]) * 1000 : null
}

function retryAfterMs(response) {
  const value = response.headers?.get?.('retry-after') ?? response.headers?.get?.('Retry-After') ?? null
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null
}

export function resolveRetryDelayMs({ response, rawText, attempt, maxDelayMs = MAX_RETRY_DELAY_MS }) {
  const retryAfter = retryAfterMs(response)
  if (retryAfter !== null) return Math.min(retryAfter, maxDelayMs)
  let body = null
  try { body = JSON.parse(rawText) } catch {}
  const details = body?.error?.details ?? body?.details ?? []
  const retryInfo = Array.isArray(details) ? details.find((detail) => String(detail?.['@type'] ?? '').includes('RetryInfo')) : null
  const retryInfoDelay = parseDurationMs(retryInfo?.retryDelay)
  if (retryInfoDelay !== null) return Math.min(retryInfoDelay, maxDelayMs)
  const messageDelay = parseDurationMs(body?.error?.message ?? body?.message ?? rawText)
  if (messageDelay !== null) return Math.min(messageDelay, maxDelayMs)
  return Math.min(1000 * (2 ** (attempt - 1)), maxDelayMs)
}

export async function executeGemini38Structured({ apiKey, request, fetchImpl = globalThis.fetch, maxAttempts = 2, startingAttempt = 0, validateOutput = () => ({ ok: true }), preserveRawResponse = async () => {}, onDispatch = async () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRetryDelayMs = MAX_RETRY_DELAY_MS }) {
  if (!apiKey) throw new GeminiEditorialProviderError('GEMINI_API_KEY is required.', { code: 'MISSING_CREDENTIAL', category: 'configuration' })
  for (let attempt = startingAttempt + 1; attempt <= maxAttempts; attempt += 1) {
    let response
    try {
      await onDispatch({ attempt })
      response = await fetchImpl(request.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(request.body),
      })
    } catch (cause) {
      throw classifyGeminiFailure({ responseReceived: false, cause })
    }
    const rawText = await response.text()
    await preserveRawResponse({ attempt, status: response.status, rawText, rawResponseHash: sha256(rawText) })
    if (!response.ok) {
      const error = classifyGeminiFailure({ responseReceived: true, status: response.status })
      if (mayRedispatch(error, { attempt, maxAttempts })) {
        await sleep(resolveRetryDelayMs({ response, rawText, attempt, maxDelayMs: maxRetryDelayMs }))
        continue
      }
      throw error
    }
    let body
    try { body = JSON.parse(rawText) } catch (cause) {
      const error = classifyGeminiFailure({ malformedOutput: true, cause })
      if (mayRedispatch(error, { attempt, maxAttempts })) { await sleep(resolveRetryDelayMs({ response, rawText, attempt, maxDelayMs: maxRetryDelayMs })); continue }
      throw error
    }
    let output
    try { output = extractGeminiStructuredOutput(body) } catch (error) {
      if (mayRedispatch(error, { attempt, maxAttempts })) { await sleep(resolveRetryDelayMs({ response, rawText, attempt, maxDelayMs: maxRetryDelayMs })); continue }
      throw error
    }
    const validation = validateOutput(output)
    if (!validation.ok) {
      const error = classifyGeminiFailure({ malformedOutput: true, cause: validation.hardFailures })
      if (mayRedispatch(error, { attempt, maxAttempts })) { await sleep(resolveRetryDelayMs({ response, rawText, attempt, maxDelayMs: maxRetryDelayMs })); continue }
      throw error
    }
    return { output, usageMetadata: body.usageMetadata ?? null, attempt }
  }
  throw new GeminiEditorialProviderError('Gemini request attempts exhausted.', { code: 'ATTEMPTS_EXHAUSTED', category: 'provider' })
}
