import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_FLAG, CANDIDATE, launchKimiJsonSchemaDiagnostic, runKimiJsonSchemaDiagnostic } from './runKimiK28HighJsonSchemaDiagnostic.mjs'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network access') })))
afterEach(() => vi.unstubAllGlobals())

function semanticOutput() {
  const evidence = (rationale) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: 'family road trip toward a pageant' }] } })
  return {
    classification: { moods: ['funny'], situations: ['family'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'familiar' },
    evidence: { moods: { funny: evidence('The family road trip supports comic friction.') }, situations: { family: evidence('The family journey supports family viewing.') }, pace: evidence('The road trip sustains a medium narrative pace.'), emotionalWeight: evidence('The family conflict supports moderate emotional weight.'), attentionDemand: evidence('The ensemble journey rewards engaged attention.'), discoveryStyle: evidence('The familiar family road format supports this classification.') },
    boundaryFlags: [],
  }
}

function context() {
  const packet = { schemaVersion: 'evidence-packet.v1', ...CANDIDATE, inputHash: CANDIDATE.evidencePacketHash, tmdbId: 773, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }
  return { readJsonFile: async () => packet, readTextFile: async () => 'fixture prompt' }
}

function response(output, usage = {}) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage }) } }

describe('Kimi K2.8 High JSON-Schema one-film diagnostic', () => {
  it('requires exact authorization and makes zero calls without it', async () => {
    const fetchImpl = vi.fn(); const result = await launchKimiJsonSchemaDiagnostic([], { pipelineRoot: '/fixture', ...context(), fetchImpl, fileExists: async () => false })
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({ diagnosticId: 'kimi-k28-high-json-schema-one-film-diagnostic-v1', outputMode: 'json_schema', requestBudget: 1, maxAttempts: 1, concurrency: 1, outputAffectingConfiguration: { semanticOutputSchemaVersion: 'semantic-output.v2', semanticOutputSchemaHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends one json_schema request and diagnoses the observed missing filterLanguages field', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-json-schema-missing-field-')); const invalid = semanticOutput(); delete invalid.classification.filterLanguages
    const fetchImpl = vi.fn().mockResolvedValue(response(invalid, { prompt_tokens: 1993, completion_tokens: 4098, total_tokens: 6091, completion_tokens_details: { reasoning_tokens: 2419 } }))
    try {
      const result = await runKimiJsonSchemaDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture', KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' }, fetchImpl, ...context(), fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
      expect(body).toMatchObject({ model: 'kimi-for-coding', reasoning_effort: 'high', stream: false, response_format: { type: 'json_schema', json_schema: { name: 'semantic_output_v2', strict: true, schema: { properties: { classification: { required: expect.arrayContaining(['filterLanguages']) } } } } } })
      expect(body).not.toHaveProperty('temperature')
      expect(result.report.record).toMatchObject({ status: 'SEMANTIC_REJECTION', semanticValidatorSuccess: false, providerRequests: 1, diagnostics: { jsonParsed: true, semanticValidation: { code: 'MISSING_REQUIRED_FIELD', path: 'classification.filterLanguages', keyword: 'MISSING_REQUIRED_FIELD' }, usage: { prompt_tokens: 1993, completion_tokens: 4098, thinking_tokens: 2419, total_tokens: 6091 } } })
      expect(result.report.record.diagnostics.usage.total_tokens).toBe(6091)
      await expect(access(join(root, 'cache/semantic/diagnostics/kimi-k28-high-json-schema-one-film-diagnostic-v1'))).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('allows the unchanged local validator to create a valid artifact only after semantic acceptance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-json-schema-valid-')); const fetchImpl = vi.fn().mockResolvedValue(response(semanticOutput(), { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } }))
    try {
      const result = await runKimiJsonSchemaDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, ...context(), fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result.report.record).toMatchObject({ status: 'VALID', semanticValidatorSuccess: true, providerRequests: 1, finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 } })
      await expect(access(join(root, 'cache/semantic/diagnostics/kimi-k28-high-json-schema-one-film-diagnostic-v1'))).resolves.toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('records bounded endpoint rejection diagnostics without fallback or body persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-json-schema-rejected-')); const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), text: async () => 'json_schema unsupported plus secret response' })
    try {
      const result = await runKimiJsonSchemaDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, ...context(), fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result.report.record).toMatchObject({ status: 'PROVIDER_REJECTION', providerRequests: 1, providerFailure: { code: 'MODEL_PROVIDER_HTTP_ERROR', wrapperCode: 'MODEL_PROVIDER_FAILURE', httpStatus: 400, retryable: false } })
      expect(JSON.stringify(result.report)).not.toContain('secret response')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
