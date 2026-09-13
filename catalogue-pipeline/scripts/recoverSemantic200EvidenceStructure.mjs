import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { acquireRunLock, atomicWriteArtifact, releaseRunLock } from './c1bV2Stage0.mjs'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { ADAPTIVE_POLICIES, ADAPTIVE_STATES, summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'
import { validateSemanticOutput } from './validateBatch.mjs'

export const RECOVERY_AUTHORIZATION_FLAG = '--apply-authorized-semantic-200-structural-recovery'
export const RECOVERY_TYPE = 'candidate-bound-deterministic-evidence-structure'
export const RECOVERY_VERSION = 'semantic-200-evidence-structure-recovery.v1'
export const RECOVERY_BINDING = Object.freeze({
  runId: 'kimi-k28-adaptive-semantic-200-v1',
  candidateId: 'scale500-tmdb-9725',
  tmdbId: 9725,
  evidencePacketHash: 'sha256:f2708388a4d3d42d2bbc890677b642511cd765d9f6769c12de6c2bcf00cf3d98',
  sourceEffort: 'max',
  providerId: 'moonshot-kimi-api',
  modelId: 'kimi-for-coding',
  promptVersion: 'semantic-classifier.v3',
  schemaVersion: 'semantic-output.v2',
  schemaHash: 'sha256:a5bacc030ad25d46a01856f6e49d6d041809683e82d2469d23ac9eae412866fc',
})

const deepClone = (value) => JSON.parse(JSON.stringify(value))
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const same = (left, right) => stableHash(left) === stableHash(right)
const outputHash = (artifact) => { const { outputHash: ignored, ...hashable } = artifact; return `sha256:${stableHash(hashable)}` }

export class Semantic200RecoveryError extends Error {
  constructor(message, { code = 'SEMANTIC_200_RECOVERY_ERROR', details = {} } = {}) { super(message); this.name = 'Semantic200RecoveryError'; this.code = code; this.details = details }
}
const fail = (message, code, details = {}) => { throw new Semantic200RecoveryError(message, { code, details }) }
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const exists = async (path) => { try { await readFile(path); return true } catch { return false } }
const durableJson = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await atomicWriteArtifact(path, value) }

function runtimePaths(pipelineRoot) {
  const runRoot = resolve(pipelineRoot, 'generated/semantic/batches', RECOVERY_BINDING.runId)
  return {
    runRoot,
    manifestPath: resolve(runRoot, 'manifest.json'),
    responsePath: resolve(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.${RECOVERY_BINDING.sourceEffort}.json`),
    artifactPath: resolve(runRoot, 'artifacts', `${RECOVERY_BINDING.candidateId}.json`),
    recoveryPath: resolve(runRoot, 'recoveries', `${RECOVERY_BINDING.candidateId}.${RECOVERY_BINDING.sourceEffort}.${RECOVERY_VERSION}.json`),
    evidencePath: resolve(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/evidence-packets', `${RECOVERY_BINDING.candidateId}.json`),
    promptPath: resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'),
    lockPath: resolve(runRoot, 'RUN_LOCK'),
  }
}

function assertManifestIdentity(manifest, prompt) {
  const checks = {
    runId: RECOVERY_BINDING.runId,
    providerId: RECOVERY_BINDING.providerId,
    modelId: RECOVERY_BINDING.modelId,
    outputMode: 'json_schema',
    promptVersion: RECOVERY_BINDING.promptVersion,
    semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion,
    semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash,
    semanticPolicyVersion: ADAPTIVE_POLICIES.lowHighMax.version,
    candidateCount: 200,
    promptContentHash: `sha256:${stableHash(prompt)}`,
    taxonomyHash: `sha256:${stableHash(taxonomy)}`,
    calibrationAnchorsHash: `sha256:${stableHash(anchors)}`,
    boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`,
  }
  for (const [key, expected] of Object.entries(checks)) if (manifest?.[key] !== expected) fail(`Semantic-200 recovery identity mismatch: ${key}.`, 'RECOVERY_RUN_IDENTITY_MISMATCH', { key, expected, actual: manifest?.[key] })
  if (!same(manifest.maxProviderConfiguration, { outputMode: 'json_schema', protocol: 'openai-chat-completions', reasoningEffort: 'max', semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion })) fail('Max provider configuration is not the frozen recovery source identity.', 'RECOVERY_RUN_IDENTITY_MISMATCH', { key: 'maxProviderConfiguration' })
}

function assertCandidateBinding(state, packet, responsePath) {
  if (!state || state.candidateId !== RECOVERY_BINDING.candidateId || state.tmdbId !== RECOVERY_BINDING.tmdbId) fail('Recovery candidate identity mismatch.', 'RECOVERY_CANDIDATE_MISMATCH')
  if (state.evidencePacketHash !== RECOVERY_BINDING.evidencePacketHash || packet?.inputHash !== RECOVERY_BINDING.evidencePacketHash) fail('Recovery evidence hash mismatch.', 'RECOVERY_EVIDENCE_HASH_MISMATCH')
  if (packet.candidateId !== RECOVERY_BINDING.candidateId || packet.tmdbId !== RECOVERY_BINDING.tmdbId) fail('Recovery evidence packet identity mismatch.', 'RECOVERY_CANDIDATE_MISMATCH')
  if (resolve(state.responsePath ?? '') !== responsePath) fail('Recovery source response path mismatch.', 'RECOVERY_SOURCE_PATH_MISMATCH')
  if (state.semanticAttempts?.max !== 1 || state.httpRequests !== 3 || !state.events?.some((event) => event.type === 'HTTP_RESPONSE' && event.effort === 'max') || !state.events?.some((event) => event.type === 'SEMANTIC_VALIDATION_FAILURE' && event.effort === 'max')) fail('Required historical Max response/failure provenance is missing.', 'RECOVERY_SOURCE_PROVENANCE_MISMATCH')
}

export function reconstructMalformedEvidence(raw) {
  const moods = raw?.classification?.moods
  const situations = raw?.classification?.situations
  if (!Array.isArray(moods) || moods.length !== 1 || !Array.isArray(situations) || situations.length !== 1) fail('Frozen recovery requires exactly one selected mood and situation.', 'RECOVERY_CLASSIFICATION_SHAPE_MISMATCH')
  const moodItem = raw?.evidence?.moods?.['rationale:']
  const duplicateMoodItem = raw?.evidence?.situations?.moods
  const situationItem = raw?.evidence?.moods?.situations
  const duplicateSituationItem = raw?.evidence?.situations?.['rationale:']
  if (!moodItem || !same(moodItem, duplicateMoodItem) || !situationItem || !same(situationItem, duplicateSituationItem)) fail('Malformed orphan evidence objects do not match their duplicate source objects.', 'RECOVERY_SOURCE_STRUCTURE_MISMATCH')
  for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) if (!raw?.evidence?.[field] || !same(raw.evidence[field], raw?.evidence?.moods?.[field])) fail(`Malformed ${field} evidence sources do not match.`, 'RECOVERY_SOURCE_STRUCTURE_MISMATCH', { field })
  return {
    ...deepClone(raw),
    evidence: {
      moods: { [moods[0]]: deepClone(moodItem) },
      situations: { [situations[0]]: deepClone(situationItem) },
      pace: deepClone(raw.evidence.pace),
      emotionalWeight: deepClone(raw.evidence.emotionalWeight),
      attentionDemand: deepClone(raw.evidence.attentionDemand),
      discoveryStyle: deepClone(raw.evidence.discoveryStyle),
    },
  }
}

function transformRecord(raw) {
  const mood = raw.classification.moods[0]; const situation = raw.classification.situations[0]
  return [
    { from: ['evidence.moods["rationale:"]', 'evidence.situations.moods'], to: `evidence.moods.${mood}`, operation: 'assert-identical-then-place' },
    { from: ['evidence.moods.situations', 'evidence.situations["rationale:"]'], to: `evidence.situations.${situation}`, operation: 'assert-identical-then-place' },
    ...['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].map((field) => ({ from: [`evidence.${field}`, `evidence.moods.${field}`], to: `evidence.${field}`, operation: 'assert-identical-then-retain-top-level' })),
  ]
}

async function buildRecoveredArtifact({ raw, packet, prompt, manifest, artifactPath, recoveryPath, recoveredAt }) {
  const repaired = reconstructMalformedEvidence(raw)
  for (const field of ['classification', 'boundaryFlags', 'selfConfidence']) if (!same(repaired[field], raw[field])) fail(`Recovery changed ${field}.`, 'RECOVERY_SEMANTIC_CONTENT_CHANGED', { field })
  const provider = { metadata: { providerId: RECOVERY_BINDING.providerId, modelId: RECOVERY_BINDING.modelId, supportsStructuredJson: true, supportsTemperature: false, outputAffectingConfiguration: manifest.maxProviderConfiguration }, generateStructured: async () => repaired }
  const built = await classifySemanticCandidate({ evidencePacket: packet, provider, prompt, promptVersion: RECOVERY_BINDING.promptVersion, schemaVersion: RECOVERY_BINDING.schemaVersion, cacheRoot: resolve(manifest.runId, 'unused-cache'), outputPath: artifactPath, createdAt: recoveredAt, maxAttempts: 1, fileExists: async () => false, writeJsonFile: async () => false })
  const artifact = { ...built.artifact, providerMetadata: { ...built.artifact.providerMetadata, responseOrigin: 'existing-max-response', recoveryExternalCalls: 0 }, structuralRecovery: { recoveryType: RECOVERY_TYPE, recoveryVersion: RECOVERY_VERSION, sourceEffort: RECOVERY_BINDING.sourceEffort, recoveryRecordPath: recoveryPath } }
  artifact.outputHash = outputHash(artifact)
  const validation = validateSemanticOutput(artifact)
  if (!validation.ok) fail('Recovered artifact failed strict semantic validation.', 'RECOVERY_STRICT_VALIDATION_FAILED', { validation })
  return { artifact, validation, transform: transformRecord(raw) }
}

function assertIdempotentState({ state, artifact, recovery }) {
  if (state.status !== ADAPTIVE_STATES.maxValid || state.validatedEffort !== 'max' || artifact.outputHash !== state.artifactHash || recovery.recoveredArtifactHash !== artifact.outputHash || recovery.validationResult?.ok !== true || recovery.externalCalls !== 0) fail('Existing recovery state is not safely reusable.', 'RECOVERY_ALREADY_APPLIED_DRIFT')
}

export async function recoverSemantic200EvidenceStructure({
  pipelineRoot = resolve('catalogue-pipeline'), now = () => new Date().toISOString(), readJsonFile = readJson, readRawFile = readFile, fileExists = exists, writeJsonFile = durableJson, acquireLock = acquireRunLock, releaseLock = releaseRunLock,
} = {}) {
  const paths = runtimePaths(pipelineRoot)
  const [manifest, packet, prompt, sourceBytes] = await Promise.all([readJsonFile(paths.manifestPath), readJsonFile(paths.evidencePath), readRawFile(paths.promptPath, 'utf8'), readRawFile(paths.responsePath)])
  assertManifestIdentity(manifest, prompt)
  const state = manifest.states?.[RECOVERY_BINDING.candidateId]
  assertCandidateBinding(state, packet, paths.responsePath)
  const sourceRawSha256 = rawSha256(sourceBytes)
  const sourceManifestHash = stableHash(manifest)
  const raw = JSON.parse(sourceBytes.toString('utf8'))
  if (state.responseHash !== `sha256:${stableHash(raw)}`) fail('Parsed source response hash differs from the recorded response identity.', 'RECOVERY_SOURCE_HASH_MISMATCH')

  if (state.status === ADAPTIVE_STATES.maxValid) {
    if (!(await fileExists(paths.artifactPath)) || !(await fileExists(paths.recoveryPath))) fail('Recovered state exists without its immutable artifacts.', 'RECOVERY_ALREADY_APPLIED_DRIFT')
    const [artifact, recovery] = await Promise.all([readJsonFile(paths.artifactPath), readJsonFile(paths.recoveryPath)])
    assertIdempotentState({ state, artifact, recovery })
    return { applied: false, idempotent: true, artifact, recovery, summary: manifest.summary }
  }
  if (state.status !== ADAPTIVE_STATES.terminalSemanticFailure) fail('Recovery requires the exact terminal semantic failure state.', 'RECOVERY_STATE_MISMATCH', { status: state.status })

  const recoveredAt = now()
  const { artifact, validation, transform } = await buildRecoveredArtifact({ raw, packet, prompt, manifest, artifactPath: paths.artifactPath, recoveryPath: paths.recoveryPath, recoveredAt })
  const recovery = {
    schemaVersion: RECOVERY_VERSION, recoveryType: RECOVERY_TYPE, runId: RECOVERY_BINDING.runId, candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, evidencePacketHash: RECOVERY_BINDING.evidencePacketHash, sourceEffort: RECOVERY_BINDING.sourceEffort,
    sourceResponsePath: paths.responsePath, sourceResponseRawSha256: sourceRawSha256, sourceResponseIdentity: { recordedResponseHash: state.responseHash, providerId: manifest.providerId, modelId: manifest.modelId, promptVersion: manifest.promptVersion, semanticOutputSchemaVersion: manifest.semanticOutputSchemaVersion, semanticOutputSchemaHash: manifest.semanticOutputSchemaHash, providerConfiguration: manifest.maxProviderConfiguration },
    structuralTransform: transform, recoveredArtifactPath: paths.artifactPath, recoveredArtifactHash: artifact.outputHash, validationResult: { ok: validation.ok, validator: 'validateSemanticOutput' }, recoveredAt, externalCalls: 0,
  }
  const nextManifest = deepClone(manifest); const nextState = nextManifest.states[RECOVERY_BINDING.candidateId]
  nextState.status = ADAPTIVE_STATES.maxValid; nextState.validatedEffort = 'max'; nextState.artifactPath = paths.artifactPath; nextState.artifactHash = artifact.outputHash; nextState.cacheKey = artifact.cacheKey; nextState.structuralRecovery = { recoveryType: RECOVERY_TYPE, recoveryVersion: RECOVERY_VERSION, recoveryRecordPath: paths.recoveryPath, sourceResponseRawSha256: sourceRawSha256 }
  nextState.events.push({ type: 'DETERMINISTIC_STRUCTURAL_RECOVERY', effort: 'max', recoveryVersion: RECOVERY_VERSION, sourceResponseRawSha256: sourceRawSha256, artifactHash: artifact.outputHash, externalCalls: 0, recoveredAt })
  nextManifest.summary = summarizeAdaptiveBatch(nextManifest)
  const lock = await acquireLock(paths.lockPath, { runId: RECOVERY_BINDING.runId, operation: RECOVERY_VERSION, acquiredAt: recoveredAt })
  try {
    if (stableHash(await readJsonFile(paths.manifestPath)) !== sourceManifestHash) fail('Semantic-200 manifest changed before recovery commit.', 'RECOVERY_CONCURRENT_STATE_CHANGE')
    if (rawSha256(await readRawFile(paths.responsePath)) !== sourceRawSha256) fail('Raw Max source response changed before recovery commit.', 'RECOVERY_SOURCE_MUTATED')
    await writeJsonFile(paths.artifactPath, artifact)
    await writeJsonFile(paths.recoveryPath, recovery)
    await writeJsonFile(paths.manifestPath, nextManifest)
  } finally { await releaseLock(lock) }
  return { applied: true, idempotent: false, artifact, recovery, summary: nextManifest.summary }
}

export async function launchSemantic200Recovery(argv = process.argv.slice(2), options = {}) {
  if (!argv.includes(RECOVERY_AUTHORIZATION_FLAG)) return { executionAuthorized: false, externalCalls: 0, binding: RECOVERY_BINDING, operation: RECOVERY_VERSION }
  return { executionAuthorized: true, externalCalls: 0, ...(await recoverSemantic200EvidenceStructure(options)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchSemantic200Recovery().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
