import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ADAPTIVE_STATES, fileExists, readJson, runAdaptiveSemanticBatch, summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'
import { SCHEMA_HASH } from './runKimiAdaptiveSemantic100.mjs'

export const SEMANTIC_N_AUTHORIZATION_FLAG = '--execute-authorized-semantic-n'
export const SEMANTIC_TARGETS = Object.freeze([200, 300, 400, 500])
export const semanticRunId = (target) => `kimi-k28-adaptive-semantic-${target}-v1`
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const invariantKeys = ['providerId', 'modelId', 'outputMode', 'semanticOutputSchemaVersion', 'semanticOutputSchemaHash', 'promptVersion', 'promptContentHash', 'taxonomyHash', 'calibrationAnchorsHash', 'boundaryCasesHash', 'highMaxPolicyVersion', 'highProviderConfiguration', 'maxProviderConfiguration']

export class SemanticNError extends Error { constructor(message, { code = 'SEMANTIC_N_ERROR', details = {} } = {}) { super(message); this.name = 'SemanticNError'; this.code = code; this.details = details } }
const fail = (message, code, details = {}) => { throw new SemanticNError(message, { code, details }) }
const integerFlag = (argv, name) => { const i = argv.indexOf(name); if (i < 0 || !/^(0|[1-9]\d*)$/.test(argv[i + 1] ?? '')) fail(`Missing or invalid ${name}.`, 'INVALID_INVOCATION_BUDGET'); return Number(argv[i + 1]) }
const optionalIntegerFlag = (argv, name) => argv.includes(name) ? integerFlag(argv, name) : null
const runtimePaths = (pipelineRoot, runId) => { const runRoot = resolve(pipelineRoot, 'generated/semantic/batches', runId); return { runRoot, manifestPath: resolve(runRoot, 'manifest.json'), responseRoot: resolve(runRoot, 'responses'), outputRoot: resolve(runRoot, 'artifacts'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/batches', runId), lockPath: resolve(runRoot, 'RUN_LOCK') } }

export async function buildSemanticNPreflight({ target, pipelineRoot = resolve('catalogue-pipeline'), readJsonFile = readJson, readRawFile = readFile, exists = fileExists } = {}) {
  if (!SEMANTIC_TARGETS.includes(target)) fail('Target must be one of 200, 300, 400, or 500.', 'INVALID_TARGET')
  const runId = semanticRunId(target); const priorRunId = semanticRunId(target - 100)
  const cohortPath = resolve(pipelineRoot, 'generated/semantic/batches', runId, 'cohort-manifest.json')
  const priorPath = resolve(pipelineRoot, 'generated/semantic/batches', priorRunId, 'manifest.json')
  if (!(await exists(cohortPath)) || !(await exists(priorPath))) fail('Cohort or prior manifest is missing.', 'REQUIRED_MANIFEST_MISSING')
  const [cohort, prior, prompt] = await Promise.all([readJsonFile(cohortPath), readJsonFile(priorPath), readRawFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')])
  if (cohort.cohortId !== runId || cohort.priorRunId !== priorRunId || cohort.targetCount !== target || cohort.importedCount !== target - 100 || cohort.newCount !== 100 || cohort.totalCandidates !== target) fail('Cohort cadence/count identity mismatch.', 'COHORT_IDENTITY_MISMATCH')
  const placeholder = { KIMI_API_KEY: 'offline-preflight-placeholder' }; const neverFetch = async () => fail('Preflight must never dispatch HTTP.', 'PREFLIGHT_HTTP_FORBIDDEN')
  const high = createKimiProvider({ modelId: 'kimi-for-coding', reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaVersion: 'semantic-output.v2', env: placeholder, fetchImpl: neverFetch })
  const max = createKimiProvider({ modelId: 'kimi-for-coding', reasoningEffort: 'max', outputMode: 'json_schema', semanticOutputSchemaVersion: 'semantic-output.v2', env: placeholder, fetchImpl: neverFetch })
  const identity = { runId, sourceBatchId: cohort.cohortId, sourceCandidateManifestHash: cohort.cohortHash, priorRunId, providerId: KIMI_PROVIDER_ID, modelId: 'kimi-for-coding', outputMode: 'json_schema', semanticOutputSchemaVersion: 'semantic-output.v2', semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: 'semantic-classifier.v3', promptContentHash: `sha256:${stableHash(prompt)}`, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, highMaxPolicyVersion: 'kimi-k28-high-then-max-on-semantic-failure.v1', highProviderConfiguration: high.metadata.outputAffectingConfiguration, maxProviderConfiguration: max.metadata.outputAffectingConfiguration }
  for (const key of invariantKeys) if (stableHash(prior[key]) !== stableHash(identity[key])) fail(`Prior semantic identity drift: ${key}.`, 'PRIOR_IDENTITY_MISMATCH', { key })
  const importedStates = new Map(); const packets = new Map(); const candidates = []
  for (const candidate of cohort.importedCandidates) {
    const state = prior.states?.[candidate.candidateId]
    if (!state || ![ADAPTIVE_STATES.imported, ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid].includes(state.status) || state.tmdbId !== candidate.tmdbId || state.evidencePacketHash !== candidate.evidencePacketHash) fail('Imported state identity mismatch.', 'IMPORT_IDENTITY_MISMATCH', { candidateId: candidate.candidateId })
    const provenance = state.lifetimeProvenance ?? { sourceRunId: priorRunId, artifactPath: state.artifactPath, artifactHash: state.artifactHash, evidencePacketHash: state.evidencePacketHash, validatedEffort: state.validatedEffort }
    if (!provenance.artifactPath || !(await exists(provenance.artifactPath))) fail('Imported artifact missing.', 'IMPORT_ARTIFACT_MISSING', { candidateId: candidate.candidateId })
    const raw = await readRawFile(provenance.artifactPath); const artifact = JSON.parse(raw)
    if (artifact.outputHash !== provenance.artifactHash || artifact.movie?.candidateId !== candidate.candidateId || artifact.movie?.tmdbId !== candidate.tmdbId || artifact.evidencePacketHash !== candidate.evidencePacketHash || artifact.modelProvider !== identity.providerId || artifact.modelId !== identity.modelId || artifact.promptVersion !== identity.promptVersion || artifact.schemaVersion !== identity.semanticOutputSchemaVersion || artifact.providerConfiguration?.semanticOutputSchemaHash !== identity.semanticOutputSchemaHash) fail('Imported artifact content drift.', 'IMPORT_ARTIFACT_DRIFT', { candidateId: candidate.candidateId })
    importedStates.set(candidate.candidateId, { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash, status: ADAPTIVE_STATES.imported, semanticAttempts: { high: 0, max: 0 }, usage: { high: {}, max: {} }, httpRequests: 0, events: [{ type: 'IMPORTED_VALID_REFERENCE', sourceRunId: provenance.sourceRunId, artifactHash: provenance.artifactHash }], lifetimeProvenance: { ...provenance, artifactRawSha256: provenance.artifactRawSha256 ?? sha256(raw) } })
    candidates.push({ candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash })
  }
  for (const candidate of cohort.newCandidates) {
    const packetPath = resolve(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/evidence-packets', `${candidate.candidateId}.json`)
    if (!(await exists(packetPath))) fail('Fresh evidence packet missing.', 'EVIDENCE_PACKET_MISSING', { candidateId: candidate.candidateId })
    const packet = await readJsonFile(packetPath)
    if (packet.candidateId !== candidate.candidateId || packet.tmdbId !== candidate.tmdbId || packet.inputHash !== candidate.evidencePacketHash) fail('Fresh evidence identity mismatch.', 'EVIDENCE_PACKET_MISMATCH', { candidateId: candidate.candidateId })
    packets.set(candidate.candidateId, packet); candidates.push({ candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash })
  }
  const runtime = runtimePaths(pipelineRoot, runId); let manifest = null
  if (await exists(runtime.manifestPath)) { manifest = await readJsonFile(runtime.manifestPath); for (const key of Object.keys(identity)) if (stableHash(manifest[key]) !== stableHash(identity[key])) fail(`Resume identity drift: ${key}.`, 'RUN_IDENTITY_MISMATCH', { key }) }
  const summary = manifest ? summarizeAdaptiveBatch(manifest) : { importedValid: target - 100, generatedValidThisRun: 0, pending: 100, providerFailures: 0, uncertain: 0, currentRunHttpRequests: 0 }
  return { preflight: { ...identity, cohortHash: cohort.cohortHash, candidateCount: target, importedValid: summary.importedValid, pendingFresh: summary.pending, generatedValidThisRun: summary.generatedValidThisRun, executionAuthorized: false }, identity: { ...identity, cohortHash: cohort.cohortHash }, candidates, importedStates, packets, prompt, runtime, manifest }
}

export async function launchAdaptiveSemanticN(argv = process.argv.slice(2), options = {}) {
  const target = integerFlag(argv, '--target'); const context = await buildSemanticNPreflight({ ...options, target })
  const caps = { maxFreshCandidates: optionalIntegerFlag(argv, '--max-fresh-candidates'), maxHttpRequests: optionalIntegerFlag(argv, '--max-http-requests') }
  if (!argv.includes(SEMANTIC_N_AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...context.preflight, requestedInvocationCap: caps } }
  return { executionAuthorized: true, ...(await runAdaptiveSemanticBatch({ context, ...options, maxFreshCandidates: integerFlag(argv, '--max-fresh-candidates'), maxHttpRequests: integerFlag(argv, '--max-http-requests') })) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchAdaptiveSemanticN().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
