import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semanticSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ModelProviderError } from '../adapters/modelProvider.ts'
import { acquireRunLock, atomicWriteArtifact, releaseRunLock } from './c1bV2Stage0.mjs'
import { buildSemanticClassifierInput, classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'
import { SCALE_50_BATCH_ID, SOURCE_MANIFEST_HASH } from './scale50Manifest.mjs'

export const RUN_ID = 'kimi-k28-adaptive-scale-50-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-scale-50'
export const POLICY_VERSION = 'kimi-k28-high-then-max-on-semantic-failure.v1'
export const SCHEMA_HASH = 'sha256:a5bacc030ad25d46a01856f6e49d6d041809683e82d2469d23ac9eae412866fc'
export const MANUAL_REDISPATCH_REASON = 'PRIOR_TRANSPORT_OUTCOME_COULD_NOT_BE_RECOVERED'
export const STATES = Object.freeze({
  pendingHigh: 'PENDING_HIGH', highValid: 'HIGH_VALID', highSemanticFailedMaxPending: 'HIGH_SEMANTIC_FAILED_MAX_PENDING', maxValid: 'MAX_VALID',
  retryableProviderFailure: 'RETRYABLE_PROVIDER_FAILURE', terminalProviderFailure: 'TERMINAL_PROVIDER_FAILURE', terminalSemanticFailure: 'TERMINAL_SEMANTIC_FAILURE',
  uncertain: 'UNCERTAIN_PRIOR_DISPATCH', manualHighRedispatchAuthorized: 'MANUAL_HIGH_REDISPATCH_AUTHORIZED', highResponse: 'HIGH_RESPONSE_RECEIVED', maxResponse: 'MAX_RESPONSE_RECEIVED',
})

const MODEL_ID = 'kimi-for-coding'; const OUTPUT_MODE = 'json_schema'; const SCHEMA_VERSION = 'semantic-output.v2'; const PROMPT_VERSION = 'semantic-classifier.v3'; const MAX_TRANSPORT_ATTEMPTS = 2
const terminalStates = new Set([STATES.highValid, STATES.maxValid, STATES.terminalProviderFailure, STATES.terminalSemanticFailure, STATES.uncertain])
const knownStates = new Set([...Object.values(STATES), 'HIGH_DISPATCHING_UNCERTAIN', 'MAX_DISPATCHING_UNCERTAIN'])

export class Scale50RunError extends Error { constructor(message, { code = 'SCALE_50_RUN_ERROR', details = {} } = {}) { super(message); this.name = 'Scale50RunError'; this.code = code; this.details = details } }
function fail(message, code, details = {}) { throw new Scale50RunError(message, { code, details }) }
async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function durableJson(path, value) { await mkdir(resolve(path, '..'), { recursive: true }); await atomicWriteArtifact(path, value) }
function paths(pipelineRoot) { const runRoot = resolve(pipelineRoot, 'generated/semantic/batches', RUN_ID); return { runRoot, manifestPath: resolve(runRoot, 'manifest.json'), responseRoot: resolve(runRoot, 'responses'), outputRoot: resolve(runRoot, 'artifacts'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/batches', RUN_ID), lockPath: resolve(runRoot, 'RUN_LOCK') } }
function providerFor(effort, env, fetchImpl, onResponseReceived) { return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: effort, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, env, fetchImpl, onResponseReceived }) }
function boundedUsage(value) { const source = value && typeof value === 'object' ? value : {}; return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens'].filter((key) => typeof source[key] === 'number').map((key) => [key, source[key]])) }
function addUsage(target, value) { for (const key of Object.keys(target)) target[key] += value?.[key] ?? 0 }
function cacheValid(artifact, candidate, provider, cacheKey) { return artifact?.cacheKey === cacheKey && artifact?.movie?.candidateId === candidate.candidateId && artifact?.movie?.tmdbId === candidate.tmdbId && artifact?.evidencePacketHash === candidate.evidencePacketHash && artifact?.modelProvider === provider.metadata.providerId && artifact?.modelId === provider.metadata.modelId && artifact?.schemaVersion === SCHEMA_VERSION && artifact?.promptVersion === PROMPT_VERSION && artifact?.providerConfiguration?.reasoningEffort === provider.metadata.outputAffectingConfiguration.reasoningEffort && artifact?.providerConfiguration?.semanticOutputSchemaHash === SCHEMA_HASH && typeof artifact?.outputHash === 'string' }

function runIdentity(scaleManifest, prompt, high, max) {
  return { runId: RUN_ID, scaleManifestHash: scaleManifest.scaleManifestHash, sourceCandidateManifestHash: SOURCE_MANIFEST_HASH, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`, highMaxPolicyVersion: POLICY_VERSION, highProviderConfiguration: high.metadata.outputAffectingConfiguration, maxProviderConfiguration: max.metadata.outputAffectingConfiguration }
}
function assertIdentity(manifest, identity) { for (const [key, expected] of Object.entries(identity)) if (stableHash(manifest[key]) !== stableHash(expected)) fail(`Scale-50 resume identity mismatch: ${key}.`, 'RUN_IDENTITY_MISMATCH', { key }) }

export function summarizeScale50(manifest) {
  const states = Object.values(manifest.states); const completed = states.filter((state) => [STATES.highValid, STATES.maxValid].includes(state.status)); const usage = { high: { prompt_tokens: 0, completion_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, max: { prompt_tokens: 0, completion_tokens: 0, thinking_tokens: 0, total_tokens: 0 } }
  for (const state of states) { addUsage(usage.high, state.usage?.high); addUsage(usage.max, state.usage?.max) }
  const combined = { prompt_tokens: usage.high.prompt_tokens + usage.max.prompt_tokens, completion_tokens: usage.high.completion_tokens + usage.max.completion_tokens, thinking_tokens: usage.high.thinking_tokens + usage.max.thinking_tokens, total_tokens: usage.high.total_tokens + usage.max.total_tokens }
  const highAttempts = states.filter((state) => (state.semanticAttempts?.high ?? 0) > 0).length; const highFirstPassValidAttempts = states.filter((state) => state.status === STATES.highValid && (state.semanticAttempts?.high ?? 0) > 0).length; const maxEscalations = states.filter((state) => state.maxEligibleAt).length; const maxRecoveries = states.filter((state) => state.status === STATES.maxValid).length; const latencies = completed.map((state) => state.latencyMs).filter(Number.isFinite)
  return {
    counts: { highAttempts, highFirstPassValid: states.filter((state) => state.status === STATES.highValid).length, highSemanticValidationFailures: states.filter((state) => state.highSemanticFailure).length, maxEscalations, maxRecoveries, maxTerminalSemanticFailures: states.filter((state) => state.status === STATES.terminalSemanticFailure).length, retryableProviderFailures: states.filter((state) => state.status === STATES.retryableProviderFailure).length, terminalProviderFailures: states.filter((state) => state.status === STATES.terminalProviderFailure).length, uncertainCandidates: states.filter((state) => state.status === STATES.uncertain).length, completedTotal: completed.length, pendingTotal: states.filter((state) => !terminalStates.has(state.status)).length },
    usage: { ...usage, combined }, requestsPerCompletedFilm: completed.length ? manifest.httpRequests / completed.length : null, highFirstPassValidityRate: highAttempts ? highFirstPassValidAttempts / highAttempts : null, maxEscalationRateAmongHighAttempts: highAttempts ? maxEscalations / highAttempts : null, maxEscalationsAsFractionOfManifest: states.length ? maxEscalations / states.length : null, maxRecoveryRate: maxEscalations ? maxRecoveries / maxEscalations : null,
    meanBoundaryFlagsPerValidFilm: completed.length ? completed.reduce((sum, state) => sum + (state.boundaryFlagCount ?? 0), 0) / completed.length : null,
    candidateLatencyMs: { mean: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null },
  }
}

export async function buildScale50Preflight({ pipelineRoot = resolve('catalogue-pipeline'), readJsonFile = readJson, readTextFile = readFile, fileExists = exists } = {}) {
  const runtime = paths(pipelineRoot); const [scaleManifest, prompt] = await Promise.all([readJsonFile(resolve(pipelineRoot, 'generated/catalogue-expansion', SCALE_50_BATCH_ID, 'candidate-manifest.json')), readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')])
  if (scaleManifest?.batchId !== SCALE_50_BATCH_ID || scaleManifest?.sourceCandidateManifestHash !== SOURCE_MANIFEST_HASH || scaleManifest?.candidates?.length !== 50) fail('Frozen Scale-50 manifest identity mismatch.', 'SCALE_50_MANIFEST_MISMATCH')
  const placeholder = { KIMI_API_KEY: 'offline-preflight-placeholder' }; const neverFetch = async () => { throw new Error('Preflight must never dispatch HTTP.') }; const high = providerFor('high', placeholder, neverFetch); const max = providerFor('max', placeholder, neverFetch)
  if (high.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH || max.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH) fail('Provider JSON-Schema hash drift.', 'SCHEMA_HASH_MISMATCH')
  const identity = runIdentity(scaleManifest, prompt, high, max); let manifest = null
  if (await fileExists(runtime.manifestPath)) { manifest = await readJsonFile(runtime.manifestPath); assertIdentity(manifest, identity) }
  const packets = new Map(); const cache = new Map()
  for (const candidate of scaleManifest.candidates) {
    const packet = await readJsonFile(resolve(pipelineRoot, 'generated/catalogue-expansion/expansion-100-v1/evidence-packets', `${candidate.candidateId}.json`))
    if (packet?.candidateId !== candidate.candidateId || packet?.tmdbId !== candidate.tmdbId || packet?.inputHash !== candidate.evidencePacketHash) fail('Frozen evidence packet drift.', 'EVIDENCE_PACKET_IDENTITY_MISMATCH', { candidateId: candidate.candidateId })
    packets.set(candidate.candidateId, packet)
    for (const [effort, provider] of [['high', high], ['max', max]]) { const key = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION }); let valid = false; try { valid = cacheValid(await readJsonFile(resolve(runtime.cacheRoot, effort, `${key}.json`)), candidate, provider, key) } catch {} cache.set(`${candidate.candidateId}:${effort}`, { cacheKey: key, valid }) }
  }
  const states = manifest?.states ?? {}; const stateValues = scaleManifest.candidates.map(({ candidateId }) => states[candidateId] ?? { status: STATES.pendingHigh })
  for (const [candidateId, state] of Object.entries(states)) {
    if (!knownStates.has(state?.status)) fail('Persisted Scale-50 candidate state is invalid.', 'INVALID_CANDIDATE_STATE', { candidateId, status: state?.status })
    if ((state.status === STATES.highSemanticFailedMaxPending || state.status === STATES.retryableProviderFailure && state.failedEffort === 'max') && (!state.highSemanticFailure || !state.maxEligibleAt)) fail('Max eligibility lacks a durable High semantic-failure provenance.', 'INVALID_MAX_ELIGIBILITY', { candidateId })
  }
  const preflight = { ...identity, candidateCount: 50, validHighCacheHits: [...cache.entries()].filter(([key, value]) => key.endsWith(':high') && value.valid).length, validMaxCacheHits: [...cache.entries()].filter(([key, value]) => key.endsWith(':max') && value.valid).length, completedCandidates: stateValues.filter((state) => [STATES.highValid, STATES.maxValid].includes(state.status)).length, highPendingCandidates: stateValues.filter((state) => state.status === STATES.pendingHigh || state.status === STATES.retryableProviderFailure && state.failedEffort === 'high').length, maxEligibleCandidates: stateValues.filter((state) => state.status === STATES.highSemanticFailedMaxPending || state.status === STATES.retryableProviderFailure && state.failedEffort === 'max').length, retryableProviderFailures: stateValues.filter((state) => state.status === STATES.retryableProviderFailure).length, uncertainCandidates: stateValues.filter((state) => [STATES.uncertain, STATES.manualHighRedispatchAuthorized].includes(state.status) || /DISPATCHING|RESPONSE_RECEIVED/.test(state.status)).length, freshCandidatesRemaining: stateValues.filter((state) => state.status === STATES.pendingHigh).length, priorHttpRequests: manifest?.httpRequests ?? 0, remainingEligibleWork: stateValues.filter((state) => !terminalStates.has(state.status)).length }
  return { preflight, scaleManifest, prompt, packets, cache, manifest, runtime }
}

async function validateAndBuildArtifact({ raw, packet, provider, prompt, cacheRoot, outputPath, createdAt }) {
  return classifySemanticCandidate({ evidencePacket: packet, provider: { metadata: provider.metadata, generateStructured: async () => raw }, prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot, outputPath, createdAt, maxAttempts: 1, fileExists: async () => false, writeJsonFile: async () => false })
}

function providerFailure(error) { return { code: error?.code ?? 'UNKNOWN_PROVIDER_FAILURE', retryable: Boolean(error?.retryable), httpStatus: error?.details?.httpStatus ?? null } }
function semanticFailure(error) { return { code: error?.code ?? 'MALFORMED_MODEL_OUTPUT', validation: error?.details?.providerResponseDiagnostics?.validation ?? error?.details?.firstFailure ?? null, usage: boundedUsage(error?.details?.providerUsageMetadata) } }

export async function runAdaptiveScale50({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, maxFreshCandidates, maxHttpRequests, manualRecoveryCandidateId = null, maxTransportAttempts = MAX_TRANSPORT_ATTEMPTS, now = () => Date.now(), delayFn = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = durableJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY?.trim()) fail('KIMI_API_KEY is required for an authorized Scale-50 run.', 'MISSING_KIMI_API_KEY')
  if (!Number.isInteger(maxFreshCandidates) || maxFreshCandidates < 0 || !Number.isInteger(maxHttpRequests) || maxHttpRequests < 0) fail('Authorized Scale-50 runs require nonnegative integer candidate and HTTP caps.', 'INVALID_INVOCATION_BUDGET')
  const context = await buildScale50Preflight({ pipelineRoot, readJsonFile, readTextFile, fileExists }); const { runtime, scaleManifest, packets, prompt, cache } = context
  await mkdir(runtime.runRoot, { recursive: true }); const lock = await acquireRunLock(runtime.lockPath, { runId: RUN_ID, acquiredAt: new Date().toISOString() })
  const identityFields = ['runId', 'scaleManifestHash', 'sourceCandidateManifestHash', 'providerId', 'modelId', 'outputMode', 'semanticOutputSchemaVersion', 'semanticOutputSchemaHash', 'promptVersion', 'promptContentHash', 'taxonomyHash', 'calibrationAnchorsHash', 'boundaryCasesHash', 'highMaxPolicyVersion', 'highProviderConfiguration', 'maxProviderConfiguration']
  const durableIdentity = Object.fromEntries(identityFields.map((key) => [key, context.preflight[key]]))
  let manifest = context.manifest ?? { schemaVersion: 'kimi-adaptive-scale-run.v1', ...durableIdentity, candidateCount: 50, createdAt: new Date().toISOString(), httpRequests: 0, invocationCount: 0, states: Object.fromEntries(scaleManifest.candidates.map((candidate) => [candidate.candidateId, { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash, status: STATES.pendingHigh, httpRequests: 0, transportRetries: 0, semanticAttempts: { high: 0, max: 0 }, usage: { high: {}, max: {} }, events: [] }])) }
  if (manualRecoveryCandidateId) {
    const candidate = scaleManifest.candidates.find(({ candidateId }) => candidateId === manualRecoveryCandidateId); const state = manifest.states[manualRecoveryCandidateId]
    if (!candidate || !state || state.evidencePacketHash !== candidate.evidencePacketHash) fail('Manual recovery candidate does not match the frozen Scale-50 manifest.', 'MANUAL_RECOVERY_CANDIDATE_MISMATCH', { candidateId: manualRecoveryCandidateId })
    if (state.status !== STATES.uncertain || state.uncertainReason !== 'TRANSPORT_OUTCOME_UNKNOWN') fail('Manual recovery requires the exact unresolved transport-uncertain state.', 'MANUAL_RECOVERY_STATE_MISMATCH', { candidateId: manualRecoveryCandidateId, status: state.status })
    if ((state.manualRedispatches ?? 0) !== 0 || state.events?.some(({ type }) => type === 'MANUAL_REDISPATCH_AUTHORIZED')) fail('A manual redispatch was already authorized for this candidate.', 'MANUAL_REDISPATCH_ALREADY_AUTHORIZED', { candidateId: manualRecoveryCandidateId })
    if (!state.events?.some(({ type, effort }) => type === 'HTTP_DISPATCH' && effort === 'high') || !state.events?.some(({ type, effort }) => type === 'UNCERTAIN' && effort === 'high')) fail('Manual recovery requires preserved High dispatch and uncertainty provenance.', 'MANUAL_RECOVERY_PROVENANCE_MISSING', { candidateId: manualRecoveryCandidateId })
    state.events.push({ type: 'MANUAL_REDISPATCH_AUTHORIZED', effort: 'high', reason: MANUAL_REDISPATCH_REASON, priorStatus: STATES.uncertain, priorUncertainReason: state.uncertainReason, priorUsageRecovered: false })
    state.unrecoveredPriorDispatch = { effort: 'high', httpRequests: state.httpRequests, usage: null, reason: state.uncertainReason }
    state.status = STATES.manualHighRedispatchAuthorized; state.manualRedispatches = 1; state.semanticAttempts.high = (state.semanticAttempts.high ?? 0) + 1
  }
  manifest.invocationCount += 1; const invocationStartRequests = manifest.httpRequests; let freshStarted = 0
  const persist = async () => { manifest.summary = summarizeScale50(manifest); await writeJsonFile(runtime.manifestPath, manifest) }
  await persist()
  try {
    for (const candidate of scaleManifest.candidates) {
      let state = manifest.states[candidate.candidateId]; const packet = packets.get(candidate.candidateId)
      if (manualRecoveryCandidateId && candidate.candidateId !== manualRecoveryCandidateId) continue
      if (terminalStates.has(state.status)) continue
      if (/DISPATCHING|RESPONSE_RECEIVED/.test(state.status)) { state.status = STATES.uncertain; state.uncertainReason = 'PRIOR_PROCESS_STOPPED_AFTER_DISPATCH_BOUNDARY'; await persist(); continue }
      for (const effort of ['high', 'max']) {
        const eligible = effort === 'high' ? state.status === STATES.pendingHigh || state.status === STATES.retryableProviderFailure && state.failedEffort === 'high' || manualRecoveryCandidateId === candidate.candidateId && state.status === STATES.manualHighRedispatchAuthorized : state.status === STATES.highSemanticFailedMaxPending || state.status === STATES.retryableProviderFailure && state.failedEffort === 'max'
        if (!eligible) continue
        const cached = cache.get(`${candidate.candidateId}:${effort}`)
        if (cached.valid) { const artifact = await readJsonFile(resolve(runtime.cacheRoot, effort, `${cached.cacheKey}.json`)); state.status = effort === 'high' ? STATES.highValid : STATES.maxValid; state.cacheHit = true; state.artifactHash = artifact.outputHash; state.boundaryFlagCount = artifact.boundaryFlags?.length ?? 0; state.usage[effort] = boundedUsage(artifact.providerMetadata?.providerUsageMetadata); await persist(); break }
        if (manifest.httpRequests - invocationStartRequests >= maxHttpRequests) break
        if (effort === 'high' && state.semanticAttempts.high === 0) { if (freshStarted >= maxFreshCandidates) break; freshStarted += 1 }
        if (state.semanticAttempts[effort] === 0) state.semanticAttempts[effort] = 1
        const started = now(); let raw = null; let responseObserved = false; let lastError = null
        const provider = providerFor(effort, env, async (...args) => {
          if (manifest.httpRequests - invocationStartRequests >= maxHttpRequests) throw new Scale50RunError('Scale-50 invocation HTTP budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' })
          state.status = `${effort.toUpperCase()}_DISPATCHING_UNCERTAIN`; state.httpRequests += 1; manifest.httpRequests += 1; state.events.push({ type: 'HTTP_DISPATCH', effort, ordinal: state.httpRequests }); await persist()
          return fetchImpl(...args)
        }, async (metadata) => { responseObserved = true; state.status = effort === 'high' ? STATES.highResponse : STATES.maxResponse; state.events.push({ type: 'HTTP_RESPONSE', effort, metadata }); await persist() })
        for (let transportAttempt = 1; transportAttempt <= maxTransportAttempts && raw === null; transportAttempt += 1) {
          try {
            const input = buildSemanticClassifierInput({ evidencePacket: packet, prompt, promptVersion: PROMPT_VERSION })
            raw = await provider.generateStructured({ stage: 'semantic-classifier', schemaVersion: SCHEMA_VERSION, promptVersion: PROMPT_VERSION, input, outputSchema: semanticSchema, temperature: 0.1 })
          } catch (error) {
            lastError = error
            if (error?.code === 'MALFORMED_MODEL_OUTPUT' && responseObserved) break
            const knownProviderResponse = error instanceof ModelProviderError && Number.isInteger(error.details?.httpStatus)
            if (!knownProviderResponse) { state.status = STATES.uncertain; state.uncertainReason = error?.code ?? 'TRANSPORT_OUTCOME_UNKNOWN'; state.events.push({ type: 'UNCERTAIN', effort, reason: state.uncertainReason }); await persist(); break }
            const failure = providerFailure(error); state.status = failure.retryable ? STATES.retryableProviderFailure : STATES.terminalProviderFailure; state.failedEffort = effort; state.providerFailure = failure; state.events.push({ type: 'PROVIDER_FAILURE', effort, ...failure }); await persist()
            if (!failure.retryable || transportAttempt === maxTransportAttempts || manifest.httpRequests - invocationStartRequests >= maxHttpRequests) break
            state.transportRetries += 1
            await delayFn(error.retryAfterMs ?? 250 * 2 ** (transportAttempt - 1))
          }
        }
        if (manualRecoveryCandidateId && state.status === STATES.retryableProviderFailure) { state.status = STATES.terminalProviderFailure; state.recoveryRequestCapExhausted = true }
        if (state.status === STATES.uncertain || state.status === STATES.terminalProviderFailure || raw === null && lastError?.code !== 'MALFORMED_MODEL_OUTPUT') { state.latencyMs = (state.latencyMs ?? 0) + now() - started; await persist(); break }
        if (lastError?.code === 'MALFORMED_MODEL_OUTPUT' && raw === null) {
          const failure = semanticFailure(lastError); state.usage[effort] = failure.usage; state.latencyMs = (state.latencyMs ?? 0) + now() - started; state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure });
          if (effort === 'high') { state.status = STATES.highSemanticFailedMaxPending; state.highSemanticFailure = failure; state.maxEligibleAt = new Date().toISOString() } else { state.status = STATES.terminalSemanticFailure; state.maxSemanticFailure = failure }
          await persist(); continue
        }
        const responsePath = resolve(runtime.responseRoot, `${candidate.candidateId}.${effort}.json`); await writeJsonFile(responsePath, raw); state.responsePath = responsePath; state.responseHash = `sha256:${stableHash(raw)}`; await persist()
        try {
          const outputPath = resolve(runtime.outputRoot, `${candidate.candidateId}.json`); const result = await validateAndBuildArtifact({ raw, packet, provider, prompt, cacheRoot: resolve(runtime.cacheRoot, effort), outputPath, createdAt: new Date().toISOString() })
          await writeJsonFile(result.cachePath, result.artifact); await writeJsonFile(outputPath, result.artifact)
          state.status = effort === 'high' ? STATES.highValid : STATES.maxValid; state.validatedEffort = effort; state.artifactPath = outputPath; state.cachePath = result.cachePath; state.cacheKey = result.cacheKey; state.artifactHash = result.artifact.outputHash; state.usage[effort] = boundedUsage(result.providerUsageMetadata); state.boundaryFlagCount = result.artifact.boundaryFlags?.length ?? 0; state.latencyMs = (state.latencyMs ?? 0) + now() - started; state.events.push({ type: 'SEMANTIC_VALID', effort, artifactHash: state.artifactHash }); await persist(); break
        } catch (error) {
          if (!['MALFORMED_MODEL_OUTPUT', 'INVALID_SEMANTIC_OUTPUT'].includes(error?.code)) throw error
          const failure = semanticFailure(error); state.usage[effort] = Object.keys(failure.usage).length ? failure.usage : boundedUsage(raw.providerUsageMetadata); state.latencyMs = (state.latencyMs ?? 0) + now() - started; state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure })
          if (effort === 'high') { state.status = STATES.highSemanticFailedMaxPending; state.highSemanticFailure = failure; state.maxEligibleAt = new Date().toISOString() } else { state.status = STATES.terminalSemanticFailure; state.maxSemanticFailure = failure }
          await persist()
        }
      }
      if (manifest.httpRequests - invocationStartRequests >= maxHttpRequests) break
    }
    manifest.lastInvocation = { maxFreshCandidates, maxHttpRequests, actualHttpRequests: manifest.httpRequests - invocationStartRequests, freshCandidatesStarted: freshStarted, completedAt: new Date().toISOString() }; await persist(); return { preflight: context.preflight, manifest }
  } finally { await releaseRunLock(lock) }
}

function integerFlag(argv, name) { const index = argv.indexOf(name); if (index < 0 || !/^(0|[1-9]\d*)$/.test(argv[index + 1] ?? '')) fail(`Missing or invalid ${name}.`, 'INVALID_INVOCATION_BUDGET'); return Number(argv[index + 1]) }
function optionalIntegerFlag(argv, name) { const index = argv.indexOf(name); return index < 0 ? null : integerFlag(argv, name) }
export async function launchAdaptiveScale50(argv = process.argv.slice(2), options = {}) { const context = await buildScale50Preflight(options); const requestedInvocationCap = { maxFreshCandidates: optionalIntegerFlag(argv, '--max-fresh-candidates'), maxHttpRequests: optionalIntegerFlag(argv, '--max-http-requests') }; if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...context.preflight, requestedInvocationCap } }; return { executionAuthorized: true, ...(await runAdaptiveScale50({ ...options, maxFreshCandidates: integerFlag(argv, '--max-fresh-candidates'), maxHttpRequests: integerFlag(argv, '--max-http-requests') })) } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchAdaptiveScale50().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
