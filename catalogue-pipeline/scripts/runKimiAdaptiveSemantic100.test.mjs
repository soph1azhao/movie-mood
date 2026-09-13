import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { ADAPTIVE_STATES, fileExists, runAdaptiveSemanticBatch, summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'
import { AUTHORIZATION_FLAG, RUN_ID, buildSemantic100Preflight, launchAdaptiveSemantic100 } from './runKimiAdaptiveSemantic100.mjs'

describe('adaptive Semantic-100 production preflight', () => {
  const validOutput = (short = false) => {
    const evidence = () => ({ rationale: 'A sufficiently detailed factual rationale.', sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: short ? 'short' : 'a sufficiently long factual cue' }] } })
    return { classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence() }, situations: { alone: evidence() }, pace: evidence(), emotionalWeight: evidence(), attentionDemand: evidence(), discoveryStyle: evidence() }, boundaryFlags: [] }
  }
  const okResponse = (output) => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } } }) })
  it('imports the exact closed Scale-50 half, keeps the remainder pending, and performs zero HTTP', async () => {
    const fetchImpl = vi.fn()
    const isolatedExists = async (path) => path.endsWith('/manifest.json') && path.includes(RUN_ID) ? false : fileExists(path)
    const result = await launchAdaptiveSemantic100([], { fetchImpl, fileExists: isolatedExists })
    expect(result.executionAuthorized).toBe(false); expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.preflight).toMatchObject({ runId: RUN_ID, candidateCount: 100, importedValid: 50, pendingFresh: 50, currentRunHttpRequests: 0 })
    const context = await buildSemantic100Preflight({ fileExists: isolatedExists }); expect(context.importedStates).toHaveLength(50)
    for (const state of context.importedStates.values()) expect(state).toMatchObject({ status: ADAPTIVE_STATES.imported, httpRequests: 0, semanticAttempts: { high: 0, max: 0 }, lifetimeProvenance: { sourceRunId: 'kimi-k28-adaptive-scale-50-v1', artifactHash: expect.stringMatching(/^sha256:/), modelId: 'kimi-for-coding', promptVersion: 'semantic-classifier.v3', schemaVersion: 'semantic-output.v2' } })
    expect(new Set(context.candidates.map((candidate) => candidate.candidateId))).toHaveLength(100)
  })

  it('fails closed on imported artifact or semantic-identity drift before HTTP', async () => {
    const context = await buildSemantic100Preflight(); const first = context.importedStates.values().next().value; const original = readFile
    const driftRead = async (path, ...args) => path === first.lifetimeProvenance.artifactPath ? Buffer.from(JSON.stringify({ outputHash: 'sha256:drift' })) : original(path, ...args)
    await expect(buildSemantic100Preflight({ readRawFile: driftRead })).rejects.toMatchObject({ code: 'IMPORT_ARTIFACT_DRIFT' })
    const driftClosure = async () => ({ status: 'OPEN', outcome: { completedValid: 0 }, identity: {} })
    await expect(buildSemantic100Preflight({ verifyScale50Closure: driftClosure })).rejects.toMatchObject({ code: 'SCALE50_CLOSURE_INVALID' })
  })

  it('excludes imported history from current-run request and token accounting', () => {
    const manifest = { currentRunHttpRequests: 2, states: { imported: { status: ADAPTIVE_STATES.imported, usage: { high: { total_tokens: 999 }, max: {} } }, generated: { status: ADAPTIVE_STATES.maxValid, highSemanticFailure: {}, maxEligibleAt: 'now', usage: { high: { total_tokens: 10 }, max: { total_tokens: 20 } } }, pending: { status: ADAPTIVE_STATES.pendingHigh, usage: { high: {}, max: {} } } } }
    expect(summarizeAdaptiveBatch(manifest)).toMatchObject({ importedValid: 1, generatedValidThisRun: 1, pending: 1, highSemanticFailures: 1, maxEscalations: 1, currentRunHttpRequests: 2, tokenAccountingCurrentRun: { combined: { total_tokens: 30 } } })
  })

  it('keeps High-to-Max generation behavior isolated to fresh candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'semantic100-core-')); const candidate = { candidateId: 'fresh', tmdbId: 1, evidencePacketHash: 'sha256:fresh' }; const imported = { candidateId: 'imported', tmdbId: 2, evidencePacketHash: 'sha256:imported' }
    const context = { runtime: { runRoot: root, manifestPath: join(root, 'manifest.json'), responseRoot: join(root, 'responses'), outputRoot: join(root, 'artifacts'), cacheRoot: join(root, 'cache'), lockPath: join(root, 'RUN_LOCK') }, identity: { runId: 'fixture', providerId: 'moonshot-kimi-api', modelId: 'kimi-for-coding', outputMode: 'json_schema', semanticOutputSchemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3' }, candidates: [imported, candidate], importedStates: new Map([[imported.candidateId, { ...imported, status: ADAPTIVE_STATES.imported, semanticAttempts: { high: 0, max: 0 }, usage: { high: {}, max: {} }, httpRequests: 0, events: [] }]]), packets: new Map([[candidate.candidateId, { schemaVersion: 'evidence-packet.v1', ...candidate, inputHash: candidate.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }], facts: {} }]]), prompt: 'fixture prompt', manifest: null }
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse(validOutput(true))).mockResolvedValueOnce(okResponse(validOutput()))
    try { const { manifest } = await runAdaptiveSemanticBatch({ context, env: { KIMI_API_KEY: 'fixture' }, fetchImpl, maxFreshCandidates: 1, maxHttpRequests: 2 }); expect(fetchImpl).toHaveBeenCalledTimes(2); expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).reasoning_effort)).toEqual(['high', 'max']); expect(manifest.states.imported.status).toBe(ADAPTIVE_STATES.imported); expect(manifest.states.fresh).toMatchObject({ status: ADAPTIVE_STATES.maxValid, semanticAttempts: { high: 1, max: 1 } }); expect(manifest.summary).toMatchObject({ importedValid: 1, generatedValidThisRun: 1, currentRunHttpRequests: 2 }) } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('requires explicit authorization and bounded invocation caps', async () => {
    await expect(launchAdaptiveSemantic100([AUTHORIZATION_FLAG, '--max-fresh-candidates', 'x', '--max-http-requests', '20'])).rejects.toMatchObject({ code: 'INVALID_INVOCATION_BUDGET' })
  })
})
