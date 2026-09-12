import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_FLAG, buildSmokePreflight, CANDIDATES, jaccard, launchGemini37Smoke, runGemini37Smoke } from './runGemini37SemanticSmoke.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('bounded Gemini 3.7 semantic smoke runner', () => {
  it('preflights the exact fixed cohort without network authorization', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network must not run') }); vi.stubGlobal('fetch', fetchSpy)
    const result = await launchGemini37Smoke([])
    expect(result.executionAuthorized).toBe(false)
    expect(result.preflight).toMatchObject({ modelId: 'gemini-3.7-flash', requestBudget: 3, candidates: CANDIDATES.map((candidate) => expect.objectContaining(candidate)) })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed on evidence hash drift', async () => {
    const readJsonFile = vi.fn(async (path) => path.endsWith('manifest.json') ? { candidates: CANDIDATES } : path.endsWith('crouching-tiger.json') ? { candidateId: 'crouching-tiger', inputHash: 'wrong' } : {})
    await expect(buildSmokePreflight({ readJsonFile })).rejects.toMatchObject({ code: 'EVIDENCE_IDENTITY_MISMATCH' })
  })

  it('hard caps execution at one attempt per candidate and three requests total', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gemini-37-smoke-')); let clock = 0
    const valid = { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'slow', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: {}, boundaryFlags: [] }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] }) })
    const packets = CANDIDATES.map((candidate, index) => ({ schemaVersion: 'evidence-packet.v1', ...candidate, inputHash: candidate.evidencePacketHash, tmdbId: index + 1, sourceProvenance: [], facts: {} }))
    const baseline = Object.fromEntries(CANDIDATES.map((candidate) => [candidate.candidateId, valid]))
    const readJsonFile = async (path) => path.endsWith('manifest.json') ? { candidates: CANDIDATES } : CANDIDATES.some((candidate) => path.endsWith(`${candidate.candidateId}.json`)) ? (path.includes('v8-1-semantic-pilot-001') ? baseline[CANDIDATES.find((candidate) => path.endsWith(`${candidate.candidateId}.json`)).candidateId] : packets.find((packet) => path.endsWith(`${packet.candidateId}.json`))) : {}
    try {
      const result = await runGemini37Smoke({ pipelineRoot: root, env: { GEMINI_API_KEY: 'fixture', GEMINI_MODEL: 'gemini-3.7-flash' }, fetchImpl, readJsonFile, readTextFile: async () => 'fixture prompt', writeJsonFile: async () => {}, fileExists: async () => false, now: () => ++clock })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(result.report).toMatchObject({ httpRequests: 3, counts: { completed: 0, malformedOutputFailures: 3, providerFailures: 0, terminalFailures: 3 } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('computes set Jaccard deterministically', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
    expect(jaccard([], [])).toBe(1)
  })
})
