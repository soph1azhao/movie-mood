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

export const RECOVERY_AUTHORIZATION_FLAG = '--apply-authorized-semantic-400-container-recovery'
export const RECOVERY_TYPE = 'candidate-bound-deterministic-evidence-container-recovery'
export const RECOVERY_VERSION = 'semantic-400-evidence-container-recovery.v1'
export const RECOVERY_BINDING = Object.freeze({
  runId: 'kimi-k28-adaptive-semantic-400-v1', candidateId: 'scale500-tmdb-505706', tmdbId: 505706,
  evidencePacketHash: 'sha256:285853f375ccb33f54f85f74b7c2d2d8c93e7896ecda6b11d3d682abd23854a1',
  sourceEffort: 'high', sourceResponseRawSha256: 'sha256:c9081467c31552c35a6ad0bb78bfaa73abe8dcbc31d169e437d43a5d7b6b9ac2',
  providerId: 'moonshot-kimi-api', modelId: 'kimi-for-coding', promptVersion: 'semantic-classifier.v3', schemaVersion: 'semantic-output.v2',
  schemaHash: 'sha256:a5bacc030ad25d46a01856f6e49d6d041809683e82d2469d23ac9eae412866fc',
})

const deepClone = (value) => JSON.parse(JSON.stringify(value))
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const same = (left, right) => stableHash(left) === stableHash(right)
const artifactHash = (artifact) => { const { outputHash: ignored, ...hashable } = artifact; return `sha256:${stableHash(hashable)}` }
const evidenceItemKeys = ['grounding', 'rationale', 'sourceRefs']

export class Semantic400RecoveryError extends Error {
  constructor(message, { code = 'SEMANTIC_400_RECOVERY_ERROR', details = {} } = {}) { super(message); this.name = 'Semantic400RecoveryError'; this.code = code; this.details = details }
}
const fail = (message, code, details = {}) => { throw new Semantic400RecoveryError(message, { code, details }) }
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const exists = async (path) => { try { await readFile(path); return true } catch { return false } }
const durableJson = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await atomicWriteArtifact(path, value) }

function runtimePaths(pipelineRoot) {
  const runRoot = resolve(pipelineRoot, 'generated/semantic/batches', RECOVERY_BINDING.runId)
  return {
    runRoot, manifestPath: resolve(runRoot, 'manifest.json'), lockPath: resolve(runRoot, 'RUN_LOCK'),
    sourceResponsePath: resolve(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.high.json`),
    latestResponsePath: resolve(runRoot, 'responses', `${RECOVERY_BINDING.candidateId}.max.json`),
    artifactPath: resolve(runRoot, 'artifacts', `${RECOVERY_BINDING.candidateId}.json`),
    recoveryPath: resolve(runRoot, 'recoveries', `${RECOVERY_BINDING.candidateId}.high.${RECOVERY_VERSION}.json`),
    evidencePath: resolve(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/evidence-packets', `${RECOVERY_BINDING.candidateId}.json`),
    promptPath: resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'),
  }
}

function exactKeys(value, expected) { return value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort()) }
function isEvidenceItem(value) {
  return exactKeys(value, evidenceItemKeys) && typeof value.rationale === 'string' && Array.isArray(value.sourceRefs) && value.sourceRefs.every((entry) => typeof entry === 'string') && value.grounding && typeof value.grounding === 'object' && !Array.isArray(value.grounding)
}
function extractRepeatedEvidenceItem(container, field) {
  if (!exactKeys(container, evidenceItemKeys)) fail(`${field} does not have the exact frozen malformed container shape.`, 'RECOVERY_SOURCE_STRUCTURE_MISMATCH', { field })
  const items = evidenceItemKeys.map((key) => container[key])
  if (!items.every(isEvidenceItem) || !items.slice(1).every((item) => same(item, items[0]))) fail(`${field} does not contain one unambiguous repeated evidence item.`, 'RECOVERY_SOURCE_STRUCTURE_MISMATCH', { field })
  return items[0]
}

export function reconstructMalformedContainers(raw) {
  const moods = raw?.classification?.moods; const situations = raw?.classification?.situations
  if (!Array.isArray(moods) || moods.length !== 1 || !Array.isArray(situations) || situations.length !== 1) fail('Frozen recovery requires exactly one selected mood and situation.', 'RECOVERY_CLASSIFICATION_SHAPE_MISMATCH')
  const moodItem = extractRepeatedEvidenceItem(raw?.evidence?.moods, 'evidence.moods')
  const situationItem = extractRepeatedEvidenceItem(raw?.evidence?.situations, 'evidence.situations')
  for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) if (!isEvidenceItem(raw?.evidence?.[field])) fail(`Required ${field} evidence item is missing or ambiguous.`, 'RECOVERY_SOURCE_STRUCTURE_MISMATCH', { field })
  return { ...deepClone(raw), evidence: { moods: { [moods[0]]: deepClone(moodItem) }, situations: { [situations[0]]: deepClone(situationItem) }, pace: deepClone(raw.evidence.pace), emotionalWeight: deepClone(raw.evidence.emotionalWeight), attentionDemand: deepClone(raw.evidence.attentionDemand), discoveryStyle: deepClone(raw.evidence.discoveryStyle) } }
}

function assertManifestIdentity(manifest, prompt) {
  const checks = { runId: RECOVERY_BINDING.runId, providerId: RECOVERY_BINDING.providerId, modelId: RECOVERY_BINDING.modelId, outputMode: 'json_schema', promptVersion: RECOVERY_BINDING.promptVersion, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion, semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, semanticPolicyVersion: ADAPTIVE_POLICIES.lowHighMax.version, candidateCount: 400, promptContentHash: `sha256:${stableHash(prompt)}`, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}` }
  for (const [key, expected] of Object.entries(checks)) if (manifest?.[key] !== expected) fail(`Semantic-400 recovery identity mismatch: ${key}.`, 'RECOVERY_RUN_IDENTITY_MISMATCH', { key, expected, actual: manifest?.[key] })
  const expectedProvider = { outputMode: 'json_schema', protocol: 'openai-chat-completions', reasoningEffort: 'high', semanticOutputSchemaHash: RECOVERY_BINDING.schemaHash, semanticOutputSchemaVersion: RECOVERY_BINDING.schemaVersion }
  if (!same(manifest.highProviderConfiguration, expectedProvider)) fail('High provider configuration is not the frozen recovery source identity.', 'RECOVERY_RUN_IDENTITY_MISMATCH', { key: 'highProviderConfiguration' })
}

function assertCandidateBinding(state, packet, latestResponsePath) {
  if (!state || state.candidateId !== RECOVERY_BINDING.candidateId || state.tmdbId !== RECOVERY_BINDING.tmdbId || packet?.candidateId !== RECOVERY_BINDING.candidateId || packet?.tmdbId !== RECOVERY_BINDING.tmdbId) fail('Recovery candidate/TMDB identity mismatch.', 'RECOVERY_CANDIDATE_MISMATCH')
  if (state.evidencePacketHash !== RECOVERY_BINDING.evidencePacketHash || packet.inputHash !== RECOVERY_BINDING.evidencePacketHash) fail('Recovery evidence hash mismatch.', 'RECOVERY_EVIDENCE_HASH_MISMATCH')
  if (resolve(state.responsePath ?? '') !== latestResponsePath || state.semanticAttempts?.low !== 1 || state.semanticAttempts?.high !== 1 || state.semanticAttempts?.max !== 1 || state.httpRequests !== 3) fail('Historical Low/High/Max attempt provenance mismatch.', 'RECOVERY_SOURCE_PROVENANCE_MISMATCH')
  for (const effort of ['low', 'high', 'max']) if (!state.events?.some((event) => event.type === 'HTTP_RESPONSE' && event.effort === effort) || !state.events?.some((event) => event.type === 'SEMANTIC_VALIDATION_FAILURE' && event.effort === effort)) fail(`Historical ${effort} response/failure provenance is missing.`, 'RECOVERY_SOURCE_PROVENANCE_MISMATCH', { effort })
  if (!state.maxEligibleAt || !state.maxSemanticFailure) fail('Subsequent Max failure provenance is missing.', 'RECOVERY_SOURCE_PROVENANCE_MISMATCH')
}

async function buildRecoveredArtifact({ raw, packet, prompt, manifest, artifactPath, recoveryPath, recoveredAt }) {
  const repaired = reconstructMalformedContainers(raw)
  for (const field of ['classification', 'boundaryFlags', 'selfConfidence']) if (!same(repaired[field], raw[field])) fail(`Recovery changed ${field}.`, 'RECOVERY_SEMANTIC_CONTENT_CHANGED', { field })
  for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) if (!same(repaired.evidence[field], raw.evidence[field])) fail(`Recovery changed ${field} evidence.`, 'RECOVERY_SEMANTIC_CONTENT_CHANGED', { field })
  const provider = { metadata: { providerId: RECOVERY_BINDING.providerId, modelId: RECOVERY_BINDING.modelId, supportsStructuredJson: true, supportsTemperature: false, outputAffectingConfiguration: manifest.highProviderConfiguration }, generateStructured: async () => repaired }
  const built = await classifySemanticCandidate({ evidencePacket: packet, provider, prompt, promptVersion: RECOVERY_BINDING.promptVersion, schemaVersion: RECOVERY_BINDING.schemaVersion, cacheRoot: resolve(manifest.runId, 'unused-cache'), outputPath: artifactPath, createdAt: recoveredAt, maxAttempts: 1, fileExists: async () => false, writeJsonFile: async () => false })
  const artifact = { ...built.artifact, providerMetadata: { ...built.artifact.providerMetadata, responseOrigin: 'existing-high-response', recoveryExternalCalls: 0 }, structuralRecovery: { recoveryType: RECOVERY_TYPE, recoveryVersion: RECOVERY_VERSION, sourceEffort: 'high', recoveryRecordPath: recoveryPath, subsequentMaxFailureHistoryPreserved: true } }
  artifact.outputHash = artifactHash(artifact)
  const validation = validateSemanticOutput(artifact)
  if (!validation.ok) fail('Recovered artifact failed strict semantic validation.', 'RECOVERY_STRICT_VALIDATION_FAILED', { validation })
  return { artifact, validation, transform: [{ from: ['evidence.moods.grounding', 'evidence.moods.rationale', 'evidence.moods.sourceRefs'], to: `evidence.moods.${raw.classification.moods[0]}`, operation: 'assert-three-identical-evidence-items-then-wrap-one' }, { from: ['evidence.situations.grounding', 'evidence.situations.rationale', 'evidence.situations.sourceRefs'], to: `evidence.situations.${raw.classification.situations[0]}`, operation: 'assert-three-identical-evidence-items-then-wrap-one' }, ...['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].map((field) => ({ from: `evidence.${field}`, to: `evidence.${field}`, operation: 'retain-unchanged' }))] }
}

function assertIdempotentState({ state, artifact, recovery }) {
  if (state.status !== ADAPTIVE_STATES.highValid || state.validatedEffort !== 'high' || artifact.outputHash !== state.artifactHash || recovery.recoveredArtifactHash !== artifact.outputHash || recovery.validationResult?.ok !== true || recovery.externalCalls !== 0) fail('Existing recovery state is not safely reusable.', 'RECOVERY_ALREADY_APPLIED_DRIFT')
}

export async function recoverSemantic400EvidenceContainers({ pipelineRoot = resolve('catalogue-pipeline'), now = () => new Date().toISOString(), readJsonFile = readJson, readRawFile = readFile, fileExists = exists, writeJsonFile = durableJson, acquireLock = acquireRunLock, releaseLock = releaseRunLock, expectedSourceRawSha256 = RECOVERY_BINDING.sourceResponseRawSha256 } = {}) {
  const paths = runtimePaths(pipelineRoot)
  const [manifest, packet, prompt, sourceBytes] = await Promise.all([readJsonFile(paths.manifestPath), readJsonFile(paths.evidencePath), readRawFile(paths.promptPath, 'utf8'), readRawFile(paths.sourceResponsePath)])
  assertManifestIdentity(manifest, prompt); const state = manifest.states?.[RECOVERY_BINDING.candidateId]; assertCandidateBinding(state, packet, paths.latestResponsePath)
  const sourceResponseRawSha256 = rawSha256(sourceBytes); const sourceManifestHash = stableHash(manifest)
  if (sourceResponseRawSha256 !== expectedSourceRawSha256) fail('Frozen High source response raw hash mismatch.', 'RECOVERY_SOURCE_HASH_MISMATCH', { expected: expectedSourceRawSha256, actual: sourceResponseRawSha256 })
  const raw = JSON.parse(sourceBytes.toString('utf8'))
  if (state.status === ADAPTIVE_STATES.highValid) {
    if (!(await fileExists(paths.artifactPath)) || !(await fileExists(paths.recoveryPath))) fail('Recovered state exists without its immutable artifacts.', 'RECOVERY_ALREADY_APPLIED_DRIFT')
    const [artifact, recovery] = await Promise.all([readJsonFile(paths.artifactPath), readJsonFile(paths.recoveryPath)]); assertIdempotentState({ state, artifact, recovery }); return { applied: false, idempotent: true, artifact, recovery, summary: manifest.summary }
  }
  if (state.status !== ADAPTIVE_STATES.terminalSemanticFailure) fail('Recovery requires the exact terminal semantic failure state.', 'RECOVERY_STATE_MISMATCH', { status: state.status })
  const recoveredAt = now(); const { artifact, validation, transform } = await buildRecoveredArtifact({ raw, packet, prompt, manifest, artifactPath: paths.artifactPath, recoveryPath: paths.recoveryPath, recoveredAt })
  const recovery = { schemaVersion: RECOVERY_VERSION, recoveryType: RECOVERY_TYPE, runId: RECOVERY_BINDING.runId, candidateId: RECOVERY_BINDING.candidateId, tmdbId: RECOVERY_BINDING.tmdbId, evidencePacketHash: RECOVERY_BINDING.evidencePacketHash, sourceEffort: 'high', sourceResponsePath: paths.sourceResponsePath, sourceResponseRawSha256, sourceSemanticIdentity: { providerId: manifest.providerId, modelId: manifest.modelId, promptVersion: manifest.promptVersion, semanticOutputSchemaVersion: manifest.semanticOutputSchemaVersion, semanticOutputSchemaHash: manifest.semanticOutputSchemaHash, providerConfiguration: manifest.highProviderConfiguration }, structuralTransform: transform, recoveredArtifactPath: paths.artifactPath, recoveredArtifactHash: artifact.outputHash, validationResult: { ok: validation.ok, validator: 'validateSemanticOutput' }, subsequentMaxFailureHistoryPreserved: true, recoveredAt, externalCalls: 0 }
  const nextManifest = deepClone(manifest); const nextState = nextManifest.states[RECOVERY_BINDING.candidateId]
  nextState.status = ADAPTIVE_STATES.highValid; nextState.validatedEffort = 'high'; nextState.artifactPath = paths.artifactPath; nextState.artifactHash = artifact.outputHash; nextState.cacheKey = artifact.cacheKey; nextState.structuralRecovery = { recoveryType: RECOVERY_TYPE, recoveryVersion: RECOVERY_VERSION, recoveryRecordPath: paths.recoveryPath, sourceResponseRawSha256, sourceEffort: 'high', subsequentMaxFailureHistoryPreserved: true }
  nextState.events.push({ type: 'DETERMINISTIC_STRUCTURAL_RECOVERY', effort: 'high', recoveryVersion: RECOVERY_VERSION, sourceResponseRawSha256, artifactHash: artifact.outputHash, afterSubsequentMaxSemanticFailure: true, externalCalls: 0, recoveredAt })
  nextManifest.summary = summarizeAdaptiveBatch(nextManifest)
  const lock = await acquireLock(paths.lockPath, { runId: RECOVERY_BINDING.runId, operation: RECOVERY_VERSION, acquiredAt: recoveredAt })
  try { if (stableHash(await readJsonFile(paths.manifestPath)) !== sourceManifestHash) fail('Semantic-400 manifest changed before recovery commit.', 'RECOVERY_CONCURRENT_STATE_CHANGE'); if (rawSha256(await readRawFile(paths.sourceResponsePath)) !== sourceResponseRawSha256) fail('Raw High source response changed before recovery commit.', 'RECOVERY_SOURCE_MUTATED'); await writeJsonFile(paths.artifactPath, artifact); await writeJsonFile(paths.recoveryPath, recovery); await writeJsonFile(paths.manifestPath, nextManifest) } finally { await releaseLock(lock) }
  return { applied: true, idempotent: false, artifact, recovery, summary: nextManifest.summary }
}

export async function launchSemantic400Recovery(argv = process.argv.slice(2), options = {}) { if (!argv.includes(RECOVERY_AUTHORIZATION_FLAG)) return { executionAuthorized: false, externalCalls: 0, binding: RECOVERY_BINDING, operation: RECOVERY_VERSION }; return { executionAuthorized: true, externalCalls: 0, ...(await recoverSemantic400EvidenceContainers(options)) } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchSemantic400Recovery().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
