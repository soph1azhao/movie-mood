import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GeminiEditorialProviderError,
  THINKING_LEVELS,
  buildCriticGeminiSchema,
  buildEditorialGeminiSchema,
  buildGemini38Request,
  GEMINI_EDITORIAL_SCHEMA_PROJECTION_VERSION,
  GEMINI_EDITORIAL_TRANSPORT_VERSION,
  projectGeminiResponseJsonSchema,
  classifyGeminiFailure,
  executeGemini38Structured,
  mayRedispatch,
  resolveRetryDelayMs,
} from './geminiEditorialProvider.mjs'

const identity = { candidateId: 'candidate-1', tmdbId: 101 }

test('Gemini 3.8 editorial request is structured and omits sampling and search controls', () => {
  assert.equal(GEMINI_EDITORIAL_SCHEMA_PROJECTION_VERSION, 'gemini-editorial-structured-output.v3')
  assert.equal(GEMINI_EDITORIAL_TRANSPORT_VERSION, 'gemini-3.8-generate-content-response-format.v1')
  const schema = buildEditorialGeminiSchema(identity)
  const request = buildGemini38Request({ promptText: 'Exact prompt v1', input: { candidateId: identity.candidateId }, responseSchema: schema, thinkingLevel: THINKING_LEVELS.writer, maxOutputTokens: 8192 })
  assert.equal(request.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON')
  assert.notDeepEqual(request.body.generationConfig.responseFormat.text.schema, schema)
  assert.deepEqual(request.body.generationConfig.responseFormat.text.schema, projectGeminiResponseJsonSchema(schema))
  assert.equal('responseMimeType' in request.body.generationConfig, false)
  assert.equal('responseJsonSchema' in request.body.generationConfig, false)
  assert.equal('responseSchema' in request.body.generationConfig, false)
  assert.equal(request.body.generationConfig.responseFormat.text.schema.properties.copy.properties.description.minLength, undefined)
  assert.equal(request.body.generationConfig.responseFormat.text.schema.properties.copy.properties.description.maxLength, undefined)
  assert.equal(request.body.generationConfig.responseFormat.text.schema.additionalProperties, false)
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'low')
  assert.equal(request.body.systemInstruction.parts[0].text, 'Exact prompt v1')
  assert.equal(request.body.contents[0].parts[0].text, '{"candidateId":"candidate-1"}\n')
  assert.match(request.requestMetadata.promptRawByteHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(request.requestMetadata.packetCanonicalByteHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(request.requestMetadata.schemaCanonicalByteHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(request.requestMetadata.completeRequestHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal('temperature' in request.body.generationConfig, false)
  assert.equal('topP' in request.body.generationConfig, false)
  assert.equal('topK' in request.body.generationConfig, false)
  assert.equal('top_p' in request.body.generationConfig, false)
  assert.equal('top_k' in request.body.generationConfig, false)
  assert.equal('tools' in request.body, false)
})

test('Gemini response-schema projection recursively preserves supported keywords and strips unsupported ones', () => {
  const source = {
    type: 'object', additionalProperties: false, required: ['nested'], minLength: 1, unknownKeyword: true,
    properties: { nested: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', minLength: 2, maxLength: 9, pattern: 'x', enum: ['x'] } }, integerId: { type: 'integer', enum: [1071806] }, amount: { type: 'number', enum: [1.5] } },
    anyOf: [{ type: 'number', minimum: 1, maximum: 3, multipleOf: 2 }, { type: 'string', const: 'x' }],
    oneOf: [{ type: 'object', properties: { value: { type: 'string', minLength: 1 } } }],
  }
  const original = structuredClone(source)
  const projected = projectGeminiResponseJsonSchema(source)
  assert.deepEqual(source, original)
  assert.equal(projected.additionalProperties, false)
  assert.equal(projected.minLength, undefined)
  assert.equal(projected.unknownKeyword, undefined)
  assert.equal(projected.properties.nested.minItems, 1)
  assert.equal(projected.properties.nested.maxItems, 2)
  assert.equal(projected.properties.nested.items.minLength, undefined)
  assert.deepEqual(projected.properties.nested.items.enum, ['x'])
  assert.equal(projected.properties.integerId.enum, undefined)
  assert.equal(projected.properties.amount.enum, undefined)
  assert.deepEqual(projected.anyOf[0], { type: 'number', minimum: 1, maximum: 3 })
  assert.deepEqual(projected.oneOf[0].properties.value, { type: 'string' })
})

test('numeric enums are stripped recursively while string enums and source schema remain intact', () => {
  const source = { type: 'object', properties: { integer: { type: 'integer', enum: [7] }, number: { type: 'number', enum: [2.5] }, text: { type: 'string', enum: ['7'] } } }
  const copy = structuredClone(source)
  const projected = projectGeminiResponseJsonSchema(source)
  assert.equal(projected.properties.integer.enum, undefined)
  assert.equal(projected.properties.number.enum, undefined)
  assert.deepEqual(projected.properties.text.enum, ['7'])
  assert.deepEqual(source, copy)
})

test('writer and critic schemas lock identity and planned thinking levels', () => {
  const writer = buildEditorialGeminiSchema(identity)
  const critic = buildCriticGeminiSchema(identity)
  assert.deepEqual(writer.properties.movie.properties.candidateId.enum, ['candidate-1'])
  assert.deepEqual(writer.properties.movie.properties.tmdbId.enum, [101])
  assert.deepEqual(critic.properties.movie.properties.candidateId.enum, ['candidate-1'])
  assert.deepEqual(critic.properties.movie.properties.tmdbId.enum, [101])
  assert.deepEqual(critic.properties.copyAssessment.required, [
    'taxonomyAlignment', 'voiceConsistency', 'specificity', 'descriptionHookDifferentiation', 'genericLanguageRisk',
    'syntacticRepetitionRisk', 'setupOnlySpoilerCompliance', 'synopsisDrift', 'distinctiveness', 'layoutFit',
  ])
  assert.deepEqual(THINKING_LEVELS, { writer: 'low', critic: 'medium' })
})

test('provider, output-validation, and ambiguous transport failures stay distinct', () => {
  const retryable = classifyGeminiFailure({ responseReceived: true, status: 503 })
  const terminal = classifyGeminiFailure({ responseReceived: true, status: 400 })
  const malformed = classifyGeminiFailure({ malformedOutput: true })
  const ambiguous = classifyGeminiFailure({ responseReceived: false })
  assert.deepEqual([retryable.category, terminal.category, malformed.category, ambiguous.category], ['provider-http', 'provider-http', 'model-output-validation', 'ambiguous-transport'])
  assert.equal(mayRedispatch(retryable, { attempt: 1, maxAttempts: 2 }), true)
  assert.equal(mayRedispatch(terminal, { attempt: 1, maxAttempts: 2 }), false)
  assert.equal(mayRedispatch(ambiguous, { attempt: 1, maxAttempts: 2 }), false)
})

test('only response-bearing transient HTTP failures are retryable', () => {
  for (const status of [429, 500, 502, 503, 504]) assert.equal(mayRedispatch(classifyGeminiFailure({ responseReceived: true, status }), { attempt: 1, maxAttempts: 2 }), true)
  for (const status of [400, 401, 403]) assert.equal(mayRedispatch(classifyGeminiFailure({ responseReceived: true, status }), { attempt: 1, maxAttempts: 2 }), false)
  assert.equal(mayRedispatch(classifyGeminiFailure({ malformedOutput: true }), { attempt: 1, maxAttempts: 2 }), false)
})

test('a response-bearing retry is bounded and preserves exact usage and raw responses', async () => {
  let calls = 0
  const preserved = []
  const output = { schemaVersion: 'editorial-output.v1', movie: identity }
  const fetchImpl = async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 503, text: async () => '{"error":"busy"}' }
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 } }) }
  }
  const sleeps = []
  const result = await executeGemini38Structured({ apiKey: 'test-only', request: { endpoint: 'https://invalid.test', body: {} }, fetchImpl, maxAttempts: 2, preserveRawResponse: async (value) => preserved.push(value), sleep: async (ms) => sleeps.push(ms) })
  assert.equal(calls, 2)
  assert.equal(preserved.length, 2)
  assert.deepEqual(result.usageMetadata, { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 })
  assert.deepEqual(result.output, output)
  assert.deepEqual(sleeps, [1000])
})

test('dispatch intent precedes each physical call and raw response persistence precedes validation', async () => {
  const events = []
  const output = { schemaVersion: 'editorial-output.v1', movie: identity }
  await executeGemini38Structured({
    apiKey: 'test-only', request: { endpoint: 'https://invalid.test', body: {} }, maxAttempts: 1,
    onDispatch: async ({ attempt }) => events.push(`intent:${attempt}`),
    fetchImpl: async () => { events.push('fetch'); return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }) } },
    preserveRawResponse: async () => events.push('raw'),
    validateOutput: () => { events.push('validate'); return { ok: true } },
  })
  assert.deepEqual(events, ['intent:1', 'fetch', 'raw', 'validate'])
})

test('retry delay precedence is Retry-After, RetryInfo, provider message, then bounded fallback', () => {
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers({ 'Retry-After': '2' }) }, rawText: '{"error":{"message":"wait 9s"}}', attempt: 1 }), 2000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3s"}]}}', attempt: 1 }), 3000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{"error":{"message":"retry in 4 seconds"}}', attempt: 1 }), 4000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{}', attempt: 9, maxDelayMs: 30000 }), 30000)
})

test('ambiguous transport outcome is never automatically redispatched', async () => {
  let calls = 0
  let dispatches = 0
  await assert.rejects(
    executeGemini38Structured({ apiKey: 'test-only', request: { endpoint: 'https://invalid.test', body: {} }, maxAttempts: 4, onDispatch: async () => { dispatches += 1 }, fetchImpl: async () => { calls += 1; throw new Error('socket outcome unknown') } }),
    (error) => error instanceof GeminiEditorialProviderError && error.code === 'AMBIGUOUS_TRANSPORT_OUTCOME',
  )
  assert.equal(calls, 1)
  assert.equal(dispatches, 1)
})

test('malformed HTTP-200 and local authoritative validation failures never redispatch', async () => {
  for (const responseText of ['not json', JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ schemaVersion: 'editorial-output.v1', movie: { candidateId: 'wrong', tmdbId: 999 } }) }] } }] })]) {
    let calls = 0
    await assert.rejects(executeGemini38Structured({ apiKey: 'test-only', request: { endpoint: 'https://invalid.test', body: {} }, maxAttempts: 2, fetchImpl: async () => { calls += 1; return { ok: true, status: 200, text: async () => responseText } }, validateOutput: () => ({ ok: false, hardFailures: ['AUTHORITATIVE_FAILURE'] }) }), /structured validation/)
    assert.equal(calls, 1)
  }
})
