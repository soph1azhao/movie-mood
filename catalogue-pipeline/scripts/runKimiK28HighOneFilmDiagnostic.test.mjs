import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_FLAG, CANDIDATE, launchKimiDiagnostic, runKimiDiagnostic } from './runKimiK28HighOneFilmDiagnostic.mjs'

afterEach(() => vi.unstubAllGlobals())

function fixtureContext() {
  const packet = { schemaVersion: 'evidence-packet.v1', ...CANDIDATE, inputHash: CANDIDATE.evidencePacketHash, tmdbId: 773, sourceProvenance: [], facts: {} }
  return { readJsonFile: async () => packet, readTextFile: async () => 'fixture prompt' }
}

function response(content, usage = {}) { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }], usage }) } }

describe('bounded Kimi malformed-output diagnostic runner', () => {
  it('requires explicit authorization and makes zero requests without it', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('network must not run') }); const { readJsonFile, readTextFile } = fixtureContext()
    const result = await launchKimiDiagnostic([], { pipelineRoot: '/fixture', fetchImpl, readJsonFile, readTextFile, fileExists: async () => false })
    expect(result.executionAuthorized).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('captures one malformed JSON response, usage, and no cacheable artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-one-film-diagnostic-')); const { readJsonFile, readTextFile } = fixtureContext()
    const fetchImpl = vi.fn().mockResolvedValue(response('{bad-json', { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } }))
    try {
      const result = await runKimiDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture', KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' }, fetchImpl, readJsonFile, readTextFile, fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('temperature')
      expect(result.report).toMatchObject({ httpRequests: 1, record: { status: 'MALFORMED_OUTPUT', providerRequests: 1, attempts: 1, diagnostics: { jsonParsed: false, parseErrorCode: 'INVALID_JSON', topLevelJsonKeys: null, responseCharacterLength: 9, finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 7, total_tokens: 30 } } } })
      expect(JSON.stringify(result.report)).not.toContain('{bad-json')
      await expect(access(join(root, 'cache/semantic/diagnostics/kimi-k28-high-one-film-diagnostic-v1'))).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('captures parseable schema-invalid validation diagnostics and bounded usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-one-film-schema-')); const { readJsonFile, readTextFile } = fixtureContext()
    const fetchImpl = vi.fn().mockResolvedValue(response(JSON.stringify({ classification: {} }), { prompt_tokens: 11, completion_tokens: 21, total_tokens: 32, completion_tokens_details: { reasoning_tokens: 8 } }))
    try {
      const result = await runKimiDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, readJsonFile, readTextFile, fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result.report.record).toMatchObject({ status: 'MALFORMED_OUTPUT', diagnostics: { jsonParsed: true, topLevelJsonKeys: ['classification'], semanticValidation: { code: expect.any(String), path: expect.any(String), keyword: expect.any(String) }, usage: { prompt_tokens: 11, completion_tokens: 21, thinking_tokens: 8, total_tokens: 32 } } })
      expect(JSON.stringify(result.report)).not.toContain('fixture')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('hard caps the diagnostic at one HTTP request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-one-film-cap-')); const { readJsonFile, readTextFile } = fixtureContext(); const fetchImpl = vi.fn().mockResolvedValue(response('{}'))
    try {
      const result = await runKimiDiagnostic({ pipelineRoot: root, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, readJsonFile, readTextFile, fileExists: async () => false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result.report.httpRequests).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
