import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ADAPTIVE_POLICIES, ADAPTIVE_STATES, summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'
import { RECOVERY_AUTHORIZATION_FLAG, RECOVERY_BINDING, launchSemantic200Recovery, recoverSemantic200EvidenceStructure, reconstructMalformedEvidence } from './recoverSemantic200EvidenceStructure.mjs'

const writeJson = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`) }
const item = (name) => ({ rationale: `Existing ${name} rationale text is deliberately long enough.`, sourceRefs: ['tmdb-overview'], grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-overview', cue: `existing ${name} grounding cue` }] } })

function malformedRaw() {
  const mood = item('mood'); const situation = item('situation'); const pace = item('pace'); const emotionalWeight = item('emotional weight'); const attentionDemand = item('attention demand'); const discoveryStyle = item('discovery style')
  return JSON.parse(JSON.stringify({
    classification: { moods: ['suspenseful'], situations: ['friends'], pace: 'medium', emotionalWeight: 'heavy', attentionDemand: 'engaged', discoveryStyle: 'familiar', filterLanguages: ['English'] },
    evidence: { attentionDemand, discoveryStyle, emotionalWeight, pace, moods: { attentionDemand, discoveryStyle, emotionalWeight, pace, situations: situation, 'rationale:': mood }, situations: { moods: mood, 'rationale:': situation } },
    boundaryFlags: [], selfConfidence: { moods: 0.9, situations: 0.7, pace: 0.8, emotionalWeight: 0.8, attentionDemand: 0.8, discoveryStyle: 0.8 },
    providerUsageMetadata: { prompt_tokens: 10, completion_tokens: 20, thinking_tokens: 5, total_tokens: 30 },
  }))
}

async function fixture({ mutateManifest, mutatePacket, mutateRaw } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'semantic-200-recovery-')); const pipelineRoot = join(root, 'catalogue-pipeline'); const runRoot = join(pipelineRoot, 'generated/semantic/batches', RECOVERY_BINDING.runId)
  const responsePath = join(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.max.json`); const evidencePath = join(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/evidence-packets', `${RECOVERY_BINDING.candidateId}.json`); const promptPath = join(pipelineRoot, 'prompts/semantic-classifier.v3.md'); const manifestPath = join(runRoot, 'manifest.json')
  const prompt = 'Frozen test semantic prompt'; const raw = malformedRaw(); mutateRaw?.(raw)
  const packet = { schemaVersion: 'evidence-packet.v1', candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, inputHash: RECOVERY_BINDING.evidencePacketHash, sourceProvenance: [{ source: 'tmdb-overview' }] }; mutatePacket?.(packet)
  const state = { candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, evidencePacketHash: RECOVERY_BINDING.evidencePacketHash, status: ADAPTIVE_STATES.terminalSemanticFailure, responsePath: resolve(responsePath), responseHash: `sha256:${stableHash(raw)}`, semanticAttempts: { low: 1, high: 1, max: 1 }, httpRequests: 3, transportRetries: 0, usage: { low: { total_tokens: 10 }, high: { total_tokens: 20 }, max: { total_tokens: 30 } }, lowSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, highSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, maxSemanticFailure: { code: 'MALFORMED_MODEL_OUTPUT' }, maxEligibleAt: 'before', events: [{ type: 'HTTP_DISPATCH', effort: 'low' }, { type: 'HTTP_RESPONSE', effort: 'low' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'low' }, { type: 'HTTP_DISPATCH', effort: 'high' }, { type: 'HTTP_RESPONSE', effort: 'high' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'high' }, { type: 'HTTP_DISPATCH', effort: 'max' }, { type: 'HTTP_RESPONSE', effort: 'max' }, { type: 'SEMANTIC_VALIDATION_FAILURE', effort: 'max' }] }
  const untouched = { candidateId: 'untouched-import', tmdbId: 1, evidencePacketHash: 'sha256:untouched', status: ADAPTIVE_STATES.imported, semanticAttempts: { low: 0, high: 0, max: 0 }, usage: { low: {}, high: {}, max: {} }, httpRequests: 0, events: [{ type: 'IMPORTED_VALID_REFERENCE' }] }
  const manifest = { schemaVersion: 'adaptive-semantic-batch.v1', runId: RECOVERY_BINDING.runId, providerId: RECOVERY_BINDING.providerId, modelId: RECOVERY_BINDING.modelId, outputMode: 'json_schema', promptVersion: RECOVERY_BINDING.promptVersion, promptContentHash: `sha256:${stableHash(prompt)}`, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion, semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, semanticPolicyVersion: ADAPTIVE_POLICIES.lowHighMax.version, maxProviderConfiguration: { outputMode: 'json_schema', protocol: 'openai-chat-completions', reasoningEffort: 'max', semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion }, candidateCount: 200, currentRunHttpRequests: 115, states: { [RECOVERY_BINDING.candidateId]: state, [untouched.candidateId]: untouched } }; manifest.summary = summarizeAdaptiveBatch(manifest); mutateManifest?.(manifest)
  await writeJson(responsePath, raw); await writeJson(evidencePath, packet); await mkdir(dirname(promptPath), { recursive: true }); await writeFile(promptPath, prompt); await writeJson(manifestPath, manifest)
  const options = { pipelineRoot, now: () => '2026-09-13T20:00:00.000Z', acquireLock: async () => ({ path: join(runRoot, 'RUN_LOCK') }), releaseLock: async () => {} }
  return { ...options, pipelineRoot, runRoot, responsePath, manifestPath, raw, packet, state, untouched }
}

describe('candidate-bound Semantic-200 structural recovery', () => {
  it('has a zero-write, zero-call preflight without explicit authorization', async () => { const result = await launchSemantic200Recovery([], { pipelineRoot: '/must-not-be-read' }); expect(result).toMatchObject({ executionAuthorized: false, externalCalls: 0, binding: RECOVERY_BINDING }) })

  it('derives labels from classification and only repositions exact existing evidence objects', () => {
    const raw = malformedRaw(); const repaired = reconstructMalformedEvidence(raw)
    expect(repaired.classification).toEqual(raw.classification); expect(repaired.boundaryFlags).toEqual(raw.boundaryFlags); expect(repaired.selfConfidence).toEqual(raw.selfConfidence)
    expect(repaired.evidence).toEqual({ moods: { suspenseful: raw.evidence.moods['rationale:'] }, situations: { friends: raw.evidence.moods.situations }, pace: raw.evidence.pace, emotionalWeight: raw.evidence.emotionalWeight, attentionDemand: raw.evidence.attentionDemand, discoveryStyle: raw.evidence.discoveryStyle })
  })

  it('refuses wrong candidate, evidence hash, and run identity before mutation', async () => {
    for (const variant of [
      { mutateManifest: (m) => { m.states[RECOVERY_BINDING.candidateId].candidateId = 'wrong' }, code: 'RECOVERY_CANDIDATE_MISMATCH' },
      { mutatePacket: (p) => { p.inputHash = 'sha256:wrong' }, code: 'RECOVERY_EVIDENCE_HASH_MISMATCH' },
      { mutateManifest: (m) => { m.runId = 'wrong' }, code: 'RECOVERY_RUN_IDENTITY_MISMATCH' },
    ]) await expect(recoverSemantic200EvidenceStructure(await fixture(variant))).rejects.toMatchObject({ code: variant.code })
  })

  it('fails strict validation before locking or manifest mutation', async () => {
    const f = await fixture({ mutateRaw: (raw) => { raw.evidence.moods['rationale:'].rationale = 'short'; raw.evidence.situations.moods.rationale = 'short' } }); const before = await readFile(f.manifestPath, 'utf8'); const acquireLock = vi.fn()
    await expect(recoverSemantic200EvidenceStructure({ ...f, acquireLock })).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
    expect(acquireLock).not.toHaveBeenCalled(); expect(await readFile(f.manifestPath, 'utf8')).toBe(before)
  })

  it('preserves raw response and all attempt, usage, HTTP, and failure history while adding explicit recovery provenance', async () => {
    const f = await fixture(); const rawBefore = await readFile(f.responsePath); const stateBefore = JSON.parse(JSON.stringify(f.state)); const result = await launchSemantic200Recovery([RECOVERY_AUTHORIZATION_FLAG], f); const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8')); const state = manifest.states[RECOVERY_BINDING.candidateId]
    expect(result).toMatchObject({ executionAuthorized: true, externalCalls: 0, applied: true }); expect(await readFile(f.responsePath)).toEqual(rawBefore)
    expect(state).toMatchObject({ status: ADAPTIVE_STATES.maxValid, validatedEffort: 'max', semanticAttempts: stateBefore.semanticAttempts, usage: stateBefore.usage, httpRequests: 3, lowSemanticFailure: stateBefore.lowSemanticFailure, highSemanticFailure: stateBefore.highSemanticFailure, maxSemanticFailure: stateBefore.maxSemanticFailure })
    expect(state.events.slice(0, stateBefore.events.length)).toEqual(stateBefore.events); expect(state.events.at(-1)).toMatchObject({ type: 'DETERMINISTIC_STRUCTURAL_RECOVERY', effort: 'max', externalCalls: 0 })
    expect(manifest.states[f.untouched.candidateId]).toEqual(f.untouched)
    expect(result.artifact.structuralRecovery).toMatchObject({ recoveryType: 'candidate-bound-deterministic-evidence-structure', sourceEffort: 'max' }); expect(result.artifact.providerMetadata).toMatchObject({ responseOrigin: 'existing-max-response', recoveryExternalCalls: 0 }); expect(result.recovery).toMatchObject({ recoveredArtifactHash: result.artifact.outputHash, validationResult: { ok: true, validator: 'validateSemanticOutput' }, externalCalls: 0 })
    expect(result.summary).toMatchObject({ generatedValidThisRun: 1, maxValid: 1, terminalSemanticFailures: 0, currentRunHttpRequests: 115 }); expect(result.summary.tokenAccountingCurrentRun.combined.total_tokens).toBe(60)
  })

  it('is idempotent after a successful application and performs no second writes', async () => {
    const f = await fixture(); await recoverSemantic200EvidenceStructure(f); const writeJsonFile = vi.fn(); const second = await recoverSemantic200EvidenceStructure({ ...f, writeJsonFile })
    expect(second).toMatchObject({ applied: false, idempotent: true }); expect(writeJsonFile).not.toHaveBeenCalled()
  })

  it('refuses ambiguous orphan mappings instead of guessing', () => { const raw = malformedRaw(); raw.evidence.situations.moods.rationale = 'different existing text'; expect(() => reconstructMalformedEvidence(raw)).toThrowError(expect.objectContaining({ code: 'RECOVERY_SOURCE_STRUCTURE_MISMATCH' })) })
})
