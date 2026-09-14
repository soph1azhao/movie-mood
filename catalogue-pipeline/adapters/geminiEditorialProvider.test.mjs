import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GeminiEditorialProviderError,
  THINKING_LEVELS,
  buildCriticGeminiSchema,
  buildEditorialGeminiSchema,
  buildGemini38Request,
  classifyGeminiFailure,
  executeGemini38Structured,
  mayRedispatch,
  resolveRetryDelayMs,
} from './geminiEditorialProvider.mjs'

const identity = { candidateId: 'candidate-1', tmdbId: 101 }

test('Gemini 3.8 editorial request is structured and omits sampling and search controls', () => {
  const schema = buildEditorialGeminiSchema(identity)
  const request = buildGemini38Request({ promptText: 'Exact prompt v1', input: { candidateId: identity.candidateId }, responseSchema: schema, thinkingLevel: THINKING_LEVELS.writer, maxOutputTokens: 8192 })
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(request.body.generationConfig.responseJsonSchema, schema)
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

test('retry delay precedence is Retry-After, RetryInfo, provider message, then bounded fallback', () => {
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers({ 'Retry-After': '2' }) }, rawText: '{"error":{"message":"wait 9s"}}', attempt: 1 }), 2000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3s"}]}}', attempt: 1 }), 3000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{"error":{"message":"retry in 4 seconds"}}', attempt: 1 }), 4000)
  assert.equal(resolveRetryDelayMs({ response: { headers: new Headers() }, rawText: '{}', attempt: 9, maxDelayMs: 30000 }), 30000)
})

test('ambiguous transport outcome is never automatically redispatched', async () => {
  let calls = 0
  await assert.rejects(
    executeGemini38Structured({ apiKey: 'test-only', request: { endpoint: 'https://invalid.test', body: {} }, maxAttempts: 4, fetchImpl: async () => { calls += 1; throw new Error('socket outcome unknown') } }),
    (error) => error instanceof GeminiEditorialProviderError && error.code === 'AMBIGUOUS_TRANSPORT_OUTCOME',
  )
  assert.equal(calls, 1)
})
