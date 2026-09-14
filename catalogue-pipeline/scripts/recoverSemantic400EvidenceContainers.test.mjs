import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ADAPTIVE_POLICIES, ADAPTIVE_STATES, summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'
import { RECOVERY_AUTHORIZATION_FLAG, RECOVERY_BINDING, launchSemantic400Recovery, reconstructMalformedContainers, recoverSemantic400EvidenceContainers } from './recoverSemantic400EvidenceContainers.mjs'

const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const writeJson = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`) }
const item = (name) => ({ grounding: { mode: 'direct', cues: [{ cue: `existing ${name} grounding cue`, sourceRef: 'tmdb-overview' }] }, rationale: `Existing ${name} rationale text is deliberately long enough.`, sourceRefs: ['tmdb-overview'] })
const repeatedContainer = (value) => ({ grounding: JSON.parse(JSON.stringify(value)), rationale: JSON.parse(JSON.stringify(value)), sourceRefs: JSON.parse(JSON.stringify(value)) })

function malformedRaw() {
  const mood = item('mood'); const situation = item('situation')
  return { classification: { moods: ['suspenseful'], situations: ['alone'], pace: 'medium', emotionalWeight: 'heavy', attentionDemand: 'engaged', discoveryStyle: 'different', filterLanguages: ['German'] }, evidence: { moods: repeatedContainer(mood), situations: repeatedContainer(situation), pace: item('pace'), emotionalWeight: item('emotional weight'), attentionDemand: item('attention demand'), discoveryStyle: item('discovery style') }, boundaryFlags: [], selfConfidence: { moods: 0.8, situations: 0.7, pace: 0.6, emotionalWeight: 0.8, attentionDemand: 0.7, discoveryStyle: 0.7 }, providerUsageMetadata: { prompt_tokens: 20, completion_tokens: 30, thinking_tokens: 10, total_tokens: 50 } }
}

async function fixture({ mutateManifest, mutatePacket, mutateRaw } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'semantic-400-recovery-')); const pipelineRoot = join(root, 'catalogue-pipeline'); const runRoot = join(pipelineRoot, 'generated/semantic/batches', RECOVERY_BINDING.runId)
  const highPath = join(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.high.json`); const maxPath = join(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.max.json`); const evidencePath = join(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/evidence-packets', `${RECOVERY_BINDING.candidateId}.json`); const promptPath = join(pipelineRoot, 'prompts/semantic-classifier.v3.md'); const manifestPath = join(runRoot, 'manifest.json')
  const prompt = 'Frozen Semantic-400 test prompt'; const raw = malformedRaw(); mutateRaw?.(raw)
  const packet = { schemaVersion: 'evidence-packet.v1', candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, inputHash: RECOVERY_BINDING.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }] }; mutatePacket?.(packet)
  const state = { candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, evidencePacketHash: RECOVERY_BINDING.evidencePacketHash, status: ADAPTIVE_STATES.terminalSemanticFailure, responsePath: resolve(maxPath), responseHash: 'sha256:max-response', semanticAttempts: { low: 1, high: 1, max: 1 }, httpRequests: 3, transportRetries: 0, usage: { low: { total_tokens: 10 }, high: { total_tokens: 20 }, max: { total_tokens: 30 } }, lowSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, highSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, maxSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, highEligibleAt: 'before-high', maxEligibleAt: 'before-max', events: [{ type: 'HTTP_DISPATCH', effort: 'low' }, { type: 'HTTP_RESPONSE', effort: 'low' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'low' }, { type: 'HTTP_DISPATCH', effort: 'high' }, { type: 'HTTP_RESPONSE', effort: 'high' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'high' }, { type: 'HTTP_DISPATCH', effort: 'max' }, { type: 'HTTP_RESPONSE', effort: 'max' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'max' }] }
  const untouched = { candidateId: 'untouched', tmdbId: 1, evidencePacketHash: 'sha256:untouched', status: ADAPTIVE_STATES.imported, semanticAttempts: { low: 0, high: 0, max: 0 }, usage: { low: {}, high: {}, max: {} }, httpRequests: 0, events: [] }
  const manifest = { schemaVersion: 'adaptive-semantic-batch.v1', runId: RECOVERY_BINDING.runId, providerId: RECOVERY_BINDING.providerId, modelId: RECOVERY_BINDING.modelId, outputMode: 'json_schema', promptVersion: RECOVERY_BINDING.promptVersion, promptContentHash: `sha256:${stableHash(prompt)}`, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion, semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, semanticPolicyVersion: ADAPTIVE_POLICIES.lowHighMax.version, highProviderConfiguration: { outputMode: 'json_schema', protocol: 'openai-chat-completions', reasoningEffort: 'high', semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion }, candidateCount: 400, currentRunHttpRequests: 114, states: { [RECOVERY_BINDING.candidateId]: state, [untouched.candidateId]: untouched } }; manifest.summary = summarizeAdaptiveBatch(manifest); mutateManifest?.(manifest)
  await writeJson(highPath, raw); await writeJson(maxPath, { preserved: true }); await writeJson(evidencePath, packet); await mkdir(dirname(promptPath), { recursive: true }); await writeFile(promptPath, prompt); await writeJson(manifestPath, manifest)
  const expectedSourceRawSha256 = rawSha256(await readFile(highPath)); const options = { pipelineRoot, expectedSourceRawSha256, now: () => '2026-09-14T00:00:00.000Z', acquireLock: async () => ({ path: join(runRoot, 'RUN_LOCK') }), releaseLock: async () => {} }
  return { ...options, runRoot, highPath, manifestPath, state, untouched }
}

describe('candidate-bound Semantic-400 evidence-container recovery', () => {
  it('freezes the exact production High response and has a zero-call unauthorized preflight', async () => { expect(RECOVERY_BINDING).toMatchObject({ runId: 'kimi-k28-adaptive-semantic-400-v1', candidateId: 'scale500-tmdb-505706', tmdbId: 505706, sourceEffort: 'high', sourceResponseRawSha256: 'sha256:c9081467c31552c35a6ad0bb78bfaa73abe8dcbc31d169e437d43a5d7b6b9ac2' }); await expect(launchSemantic400Recovery([], { pipelineRoot: '/must-not-read' })).resolves.toMatchObject({ executionAuthorized: false, externalCalls: 0 }) })

  it('wraps the sole repeated High evidence items under classification-derived labels without semantic edits', () => {
    const raw = malformedRaw(); const repaired = reconstructMalformedContainers(raw)
    expect(repaired.classification).toEqual(raw.classification); expect(repaired.boundaryFlags).toEqual(raw.boundaryFlags); expect(repaired.selfConfidence).toEqual(raw.selfConfidence)
    expect(repaired.evidence.moods).toEqual({ suspenseful: raw.evidence.moods.grounding }); expect(repaired.evidence.situations).toEqual({ alone: raw.evidence.situations.grounding })
    for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) expect(repaired.evidence[field]).toEqual(raw.evidence[field])
  })

  it('refuses wrong candidate, TMDB, evidence hash, and run identity', async () => {
    const variants = [
      { mutateManifest: (m) => { m.states[RECOVERY_BINDING.candidateId].candidateId = 'wrong' }, code: 'RECOVERY_CANDIDATE_MISMATCH' },
      { mutatePacket: (p) => { p.tmdbId = 1 }, code: 'RECOVERY_CANDIDATE_MISMATCH' },
      { mutatePacket: (p) => { p.inputHash = 'sha256:wrong' }, code: 'RECOVERY_EVIDENCE_HASH_MISMATCH' },
      { mutateManifest: (m) => { m.runId = 'wrong' }, code: 'RECOVERY_RUN_IDENTITY_MISMATCH' },
    ]
    for (const variant of variants) await expect(recoverSemantic400EvidenceContainers(await fixture(variant))).rejects.toMatchObject({ code: variant.code })
  })

  it('fails closed on non-identical or unexpected containers', () => {
    const disagree = malformedRaw(); disagree.evidence.moods.rationale.rationale = 'Different existing rationale text that is still long enough.'; expect(() => reconstructMalformedContainers(disagree)).toThrowError(expect.objectContaining({ code: 'RECOVERY_SOURCE_STRUCTURE_MISMATCH' }))
    const extra = malformedRaw(); extra.evidence.situations.extra = item('extra'); expect(() => reconstructMalformedContainers(extra)).toThrowError(expect.objectContaining({ code: 'RECOVERY_SOURCE_STRUCTURE_MISMATCH' }))
  })

  it('requires strict validation before locking or manifest mutation', async () => {
    const f = await fixture({ mutateRaw: (raw) => { raw.evidence.pace.rationale = 'short' } }); const before = await readFile(f.manifestPath, 'utf8'); const acquireLock = vi.fn()
    await expect(recoverSemantic400EvidenceContainers({ ...f, acquireLock })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' }); expect(acquireLock).not.toHaveBeenCalled(); expect(await readFile(f.manifestPath, 'utf8')).toBe(before)
  })

  it('preserves the High source plus all later Max history, usage, attempts, and HTTP accounting', async () => {
    const f = await fixture(); const highBefore = await readFile(f.highPath); const stateBefore = JSON.parse(JSON.stringify(f.state)); const result = await launchSemantic400Recovery([RECOVERY_AUTHORIZATION_FLAG], f); const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8')); const state = manifest.states[RECOVERY_BINDING.candidateId]
    expect(result).toMatchObject({ executionAuthorized: true, applied: true, externalCalls: 0 }); expect(await readFile(f.highPath)).toEqual(highBefore); expect(manifest.states[f.untouched.candidateId]).toEqual(f.untouched)
    expect(state).toMatchObject({ status: ADAPTIVE_STATES.highValid, validatedEffort: 'high', semanticAttempts: stateBefore.semanticAttempts, usage: stateBefore.usage, httpRequests: 3, maxEligibleAt: stateBefore.maxEligibleAt, maxSemanticFailure: stateBefore.maxSemanticFailure, responsePath: stateBefore.responsePath, responseHash: stateBefore.responseHash })
    expect(state.events.slice(0, stateBefore.events.length)).toEqual(stateBefore.events); expect(state.events.at(-1)).toMatchObject({ type: 'DETERMINISTIC_STRUCTURAL_RECOVERY', effort: 'high', afterSubsequentMaxSemanticFailure: true, externalCalls: 0 })
    expect(result.artifact.providerConfiguration.reasoningEffort).toBe('high'); expect(result.artifact.providerMetadata).toMatchObject({ responseOrigin: 'existing-high-response', recoveryExternalCalls: 0 }); expect(result.recovery).toMatchObject({ sourceEffort: 'high', subsequentMaxFailureHistoryPreserved: true, validationResult: { ok: true }, externalCalls: 0, recoveredArtifactHash: result.artifact.outputHash })
    expect(result.summary).toMatchObject({ highValid: 1, maxAttempts: 1, maxEscalations: 1, terminalSemanticFailures: 0, currentRunHttpRequests: 114 }); expect(result.summary.tokenAccountingCurrentRun.combined.total_tokens).toBe(60)
  })

  it('is safely idempotent and writes nothing on a second invocation', async () => { const f = await fixture(); await recoverSemantic400EvidenceContainers(f); const writeJsonFile = vi.fn(); const result = await recoverSemantic400EvidenceContainers({ ...f, writeJsonFile }); expect(result).toMatchObject({ applied: false, idempotent: true }); expect(writeJsonFile).not.toHaveBeenCalled() })
})
