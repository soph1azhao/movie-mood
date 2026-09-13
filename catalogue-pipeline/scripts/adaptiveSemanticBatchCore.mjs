import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import semanticSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import { createKimiProvider } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ModelProviderError } from '../adapters/modelProvider.ts'
import { acquireRunLock, atomicWriteArtifact, releaseRunLock } from './c1bV2Stage0.mjs'
import { buildSemanticClassifierInput, classifySemanticCandidate } from './classifySemantic.mjs'

export const ADAPTIVE_STATES = Object.freeze({
  imported: 'IMPORTED_VALID', pendingLow: 'PENDING_LOW', lowValid: 'LOW_VALID', lowSemanticFailedHighPending: 'LOW_SEMANTIC_FAILED_HIGH_PENDING', pendingHigh: 'PENDING_HIGH', highValid: 'HIGH_VALID', highSemanticFailedMaxPending: 'HIGH_SEMANTIC_FAILED_MAX_PENDING', maxValid: 'MAX_VALID', retryableProviderFailure: 'RETRYABLE_PROVIDER_FAILURE', terminalProviderFailure: 'TERMINAL_PROVIDER_FAILURE', terminalSemanticFailure: 'TERMINAL_SEMANTIC_FAILURE', uncertain: 'UNCERTAIN_PRIOR_DISPATCH', lowResponse: 'LOW_RESPONSE_RECEIVED', highResponse: 'HIGH_RESPONSE_RECEIVED', maxResponse: 'MAX_RESPONSE_RECEIVED',
})
export const ADAPTIVE_POLICIES = Object.freeze({
  highMax: Object.freeze({ version: 'kimi-k28-high-then-max-on-semantic-failure.v1', efforts: ['high', 'max'], initialState: ADAPTIVE_STATES.pendingHigh, eligibleState: { high: ADAPTIVE_STATES.pendingHigh, max: ADAPTIVE_STATES.highSemanticFailedMaxPending }, validState: { high: ADAPTIVE_STATES.highValid, max: ADAPTIVE_STATES.maxValid }, responseState: { high: ADAPTIVE_STATES.highResponse, max: ADAPTIVE_STATES.maxResponse }, semanticFailureState: { high: ADAPTIVE_STATES.highSemanticFailedMaxPending, max: ADAPTIVE_STATES.terminalSemanticFailure } }),
  lowHighMax: Object.freeze({ version: 'kimi-k28-low-high-max-on-semantic-failure.v1', efforts: ['low', 'high', 'max'], initialState: ADAPTIVE_STATES.pendingLow, eligibleState: { low: ADAPTIVE_STATES.pendingLow, high: ADAPTIVE_STATES.lowSemanticFailedHighPending, max: ADAPTIVE_STATES.highSemanticFailedMaxPending }, validState: { low: ADAPTIVE_STATES.lowValid, high: ADAPTIVE_STATES.highValid, max: ADAPTIVE_STATES.maxValid }, responseState: { low: ADAPTIVE_STATES.lowResponse, high: ADAPTIVE_STATES.highResponse, max: ADAPTIVE_STATES.maxResponse }, semanticFailureState: { low: ADAPTIVE_STATES.lowSemanticFailedHighPending, high: ADAPTIVE_STATES.highSemanticFailedMaxPending, max: ADAPTIVE_STATES.terminalSemanticFailure } }),
})
const terminal = new Set([ADAPTIVE_STATES.imported, ADAPTIVE_STATES.lowValid, ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid, ADAPTIVE_STATES.terminalProviderFailure, ADAPTIVE_STATES.terminalSemanticFailure, ADAPTIVE_STATES.uncertain])
const usageKeys = ['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens']
const emptyUsage = () => Object.fromEntries(usageKeys.map((key) => [key, 0]))
const boundedUsage = (value) => Object.fromEntries(usageKeys.filter((key) => typeof value?.[key] === 'number').map((key) => [key, value[key]]))
const addUsage = (target, value) => usageKeys.forEach((key) => { target[key] += value?.[key] ?? 0 })
const providerFailure = (error) => ({ code: error?.code ?? 'UNKNOWN_PROVIDER_FAILURE', retryable: Boolean(error?.retryable), httpStatus: error?.details?.httpStatus ?? null })
const semanticFailure = (error) => ({ code: error?.code ?? 'MALFORMED_MODEL_OUTPUT', validation: error?.details?.providerResponseDiagnostics?.validation ?? error?.details?.firstFailure ?? null, usage: boundedUsage(error?.details?.providerUsageMetadata) })

export class AdaptiveSemanticBatchError extends Error { constructor(message, { code = 'ADAPTIVE_SEMANTIC_BATCH_ERROR', details = {} } = {}) { super(message); this.name = 'AdaptiveSemanticBatchError'; this.code = code; this.details = details } }
export const fail = (message, code, details = {}) => { throw new AdaptiveSemanticBatchError(message, { code, details }) }
export async function fileExists(path) { try { await readFile(path); return true } catch { return false } }
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
export async function durableJson(path, value) { await mkdir(resolve(path, '..'), { recursive: true }); await atomicWriteArtifact(path, value) }

export function summarizeAdaptiveBatch(manifest) {
  const states = Object.values(manifest.states ?? {}); const generated = states.filter((state) => state.status !== ADAPTIVE_STATES.imported)
  const usage = { low: emptyUsage(), high: emptyUsage(), max: emptyUsage() }
  for (const state of generated) for (const effort of ['low', 'high', 'max']) addUsage(usage[effort], state.usage?.[effort])
  const generatedValid = generated.filter((state) => [ADAPTIVE_STATES.lowValid, ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid].includes(state.status))
  const attempts = (effort) => generated.reduce((sum, state) => sum + (state.semanticAttempts?.[effort] ?? 0), 0)
  return {
    importedValid: states.filter((state) => state.status === ADAPTIVE_STATES.imported).length,
    generatedValidThisRun: generatedValid.length,
    pending: generated.filter((state) => [ADAPTIVE_STATES.pendingLow, ADAPTIVE_STATES.pendingHigh, ADAPTIVE_STATES.lowSemanticFailedHighPending, ADAPTIVE_STATES.highSemanticFailedMaxPending].includes(state.status)).length,
    lowAttempts: attempts('low'), lowValid: generated.filter((state) => state.status === ADAPTIVE_STATES.lowValid).length, lowSemanticFailures: generated.filter((state) => state.lowSemanticFailure).length,
    highAttempts: attempts('high'), highValid: generated.filter((state) => state.status === ADAPTIVE_STATES.highValid).length,
    highSemanticFailures: generated.filter((state) => state.highSemanticFailure).length,
    maxAttempts: attempts('max'), maxValid: generated.filter((state) => state.status === ADAPTIVE_STATES.maxValid).length, maxEscalations: generated.filter((state) => state.maxEligibleAt).length,
    providerFailures: generated.filter((state) => [ADAPTIVE_STATES.retryableProviderFailure, ADAPTIVE_STATES.terminalProviderFailure].includes(state.status)).length,
    terminalSemanticFailures: generated.filter((state) => state.status === ADAPTIVE_STATES.terminalSemanticFailure).length,
    uncertain: generated.filter((state) => state.status === ADAPTIVE_STATES.uncertain).length,
    currentRunHttpRequests: manifest.currentRunHttpRequests ?? 0,
    tokenAccountingCurrentRun: { low: usage.low, high: usage.high, max: usage.max, combined: Object.fromEntries(usageKeys.map((key) => [key, usage.low[key] + usage.high[key] + usage.max[key]])) },
  }
}

async function validateAndBuildArtifact({ raw, packet, provider, prompt, cacheRoot, outputPath, createdAt, promptVersion, schemaVersion }) {
  return classifySemanticCandidate({ evidencePacket: packet, provider: { metadata: provider.metadata, generateStructured: async () => raw }, prompt, promptVersion, schemaVersion, cacheRoot, outputPath, createdAt, maxAttempts: 1, fileExists: async () => false, writeJsonFile: async () => false })
}

export async function runAdaptiveSemanticBatch({ context, policy = ADAPTIVE_POLICIES.highMax, env = process.env, fetchImpl = globalThis.fetch, maxFreshCandidates, maxHttpRequests, maxTransportAttempts = 2, now = () => Date.now(), delayFn = async () => {}, writeJsonFile = durableJson } = {}) {
  if (!env.KIMI_API_KEY?.trim()) fail('KIMI_API_KEY is required for authorized adaptive generation.', 'MISSING_KIMI_API_KEY')
  if (!Number.isInteger(maxFreshCandidates) || maxFreshCandidates < 0 || !Number.isInteger(maxHttpRequests) || maxHttpRequests < 0) fail('Authorized adaptive runs require nonnegative integer candidate and HTTP caps.', 'INVALID_INVOCATION_BUDGET')
  if (![ADAPTIVE_POLICIES.highMax, ADAPTIVE_POLICIES.lowHighMax].includes(policy)) fail('Unknown adaptive semantic policy.', 'INVALID_SEMANTIC_POLICY')
  const { runtime, identity, candidates, packets, importedStates, manifest: existing } = context
  if ((identity.semanticPolicyVersion ?? identity.highMaxPolicyVersion) !== policy.version) fail('Adaptive semantic policy identity mismatch.', 'SEMANTIC_POLICY_IDENTITY_MISMATCH')
  await mkdir(runtime.runRoot, { recursive: true }); const lock = await acquireRunLock(runtime.lockPath, { runId: identity.runId, acquiredAt: new Date().toISOString() })
  let manifest = existing ?? { schemaVersion: 'adaptive-semantic-batch.v1', ...identity, candidateCount: candidates.length, currentRunHttpRequests: 0, invocationCount: 0, states: Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, importedStates.get(candidate.candidateId) ?? { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash, status: policy.initialState, httpRequests: 0, transportRetries: 0, semanticAttempts: Object.fromEntries(policy.efforts.map((effort) => [effort, 0])), usage: Object.fromEntries(policy.efforts.map((effort) => [effort, {}])), events: [] }])) }
  let freshStarted = 0; const invocationStart = manifest.currentRunHttpRequests
  const persist = async () => { manifest.summary = summarizeAdaptiveBatch(manifest); await writeJsonFile(runtime.manifestPath, manifest) }
  await persist()
  try {
    for (const candidate of candidates) {
      const state = manifest.states[candidate.candidateId]; const packet = packets.get(candidate.candidateId)
      if (terminal.has(state.status)) continue
      if (/DISPATCHING|RESPONSE_RECEIVED/.test(state.status)) { state.status = ADAPTIVE_STATES.uncertain; state.uncertainReason = 'PRIOR_PROCESS_STOPPED_AFTER_DISPATCH_BOUNDARY'; await persist(); continue }
      for (const effort of policy.efforts) {
        const eligible = state.status === policy.eligibleState[effort] || state.status === ADAPTIVE_STATES.retryableProviderFailure && state.failedEffort === effort
        if (!eligible) continue
        if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) break
        if (effort === policy.efforts[0] && state.semanticAttempts[effort] === 0) { if (freshStarted >= maxFreshCandidates) break; freshStarted += 1 }
        if (state.semanticAttempts[effort] === 0) state.semanticAttempts[effort] = 1
        let responseObserved = false
        const provider = createKimiProvider({ modelId: identity.modelId, reasoningEffort: effort, outputMode: identity.outputMode, semanticOutputSchemaVersion: identity.semanticOutputSchemaVersion, env, fetchImpl: async (...args) => {
          if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) fail('Invocation HTTP budget exhausted.', 'REQUEST_BUDGET_EXHAUSTED')
          state.status = `${effort.toUpperCase()}_DISPATCHING_UNCERTAIN`; state.httpRequests += 1; manifest.currentRunHttpRequests += 1; state.events.push({ type: 'HTTP_DISPATCH', effort, ordinal: state.httpRequests }); await persist(); return fetchImpl(...args)
        }, onResponseReceived: async (metadata) => { responseObserved = true; state.status = policy.responseState[effort]; state.events.push({ type: 'HTTP_RESPONSE', effort, metadata }); await persist() } })
        const started = now(); let raw = null; let lastError = null
        for (let attempt = 1; attempt <= maxTransportAttempts && raw === null; attempt += 1) {
          try { const input = buildSemanticClassifierInput({ evidencePacket: packet, prompt: context.prompt, promptVersion: identity.promptVersion }); raw = await provider.generateStructured({ stage: 'semantic-classifier', schemaVersion: identity.semanticOutputSchemaVersion, promptVersion: identity.promptVersion, input, outputSchema: semanticSchema, temperature: 0.1 }) } catch (error) {
            lastError = error; responseObserved ||= error?.details?.providerResponseDiagnostics?.jsonParsed !== undefined
            if (error?.code === 'MALFORMED_MODEL_OUTPUT' && responseObserved) break
            const knownResponse = error instanceof ModelProviderError && Number.isInteger(error.details?.httpStatus)
            if (!knownResponse) { state.status = ADAPTIVE_STATES.uncertain; state.uncertainReason = error?.code ?? 'TRANSPORT_OUTCOME_UNKNOWN'; state.events.push({ type: 'UNCERTAIN', effort, reason: state.uncertainReason }); await persist(); break }
            const failure = providerFailure(error); state.status = failure.retryable ? ADAPTIVE_STATES.retryableProviderFailure : ADAPTIVE_STATES.terminalProviderFailure; state.failedEffort = effort; state.providerFailure = failure; state.events.push({ type: 'PROVIDER_FAILURE', effort, ...failure }); await persist(); if (!failure.retryable || attempt === maxTransportAttempts || manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) break; state.transportRetries += 1; await delayFn(error.retryAfterMs ?? 250 * 2 ** (attempt - 1))
          }
        }
        if (state.status === ADAPTIVE_STATES.uncertain || state.status === ADAPTIVE_STATES.terminalProviderFailure || raw === null && lastError?.code !== 'MALFORMED_MODEL_OUTPUT') { state.latencyMs = (state.latencyMs ?? 0) + now() - started; await persist(); break }
        if (lastError?.code === 'MALFORMED_MODEL_OUTPUT' && raw === null) { const failure = semanticFailure(lastError); state.usage[effort] = failure.usage; state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure }); state[`${effort}SemanticFailure`] = failure; state.status = policy.semanticFailureState[effort]; const nextEffort = policy.efforts[policy.efforts.indexOf(effort) + 1]; if (nextEffort) state[`${nextEffort}EligibleAt`] = new Date().toISOString(); await persist(); continue }
        const responsePath = resolve(runtime.responseRoot, `${candidate.candidateId}.${effort}.json`); await writeJsonFile(responsePath, raw); state.responsePath = responsePath; state.responseHash = `sha256:${stableHash(raw)}`; await persist()
        try { const outputPath = resolve(runtime.outputRoot, `${candidate.candidateId}.json`); const result = await validateAndBuildArtifact({ raw, packet, provider, prompt: context.prompt, cacheRoot: resolve(runtime.cacheRoot, effort), outputPath, createdAt: new Date().toISOString(), promptVersion: identity.promptVersion, schemaVersion: identity.semanticOutputSchemaVersion }); await writeJsonFile(result.cachePath, result.artifact); await writeJsonFile(outputPath, result.artifact); state.status = policy.validState[effort]; state.validatedEffort = effort; state.artifactPath = outputPath; state.cachePath = result.cachePath; state.cacheKey = result.cacheKey; state.artifactHash = result.artifact.outputHash; state.usage[effort] = boundedUsage(result.providerUsageMetadata); state.events.push({ type: 'SEMANTIC_VALID', effort, artifactHash: state.artifactHash }); await persist(); break } catch (error) { if (!['MALFORMED_MODEL_OUTPUT', 'INVALID_SEMANTIC_OUTPUT'].includes(error?.code)) throw error; const failure = semanticFailure(error); state.usage[effort] = Object.keys(failure.usage).length ? failure.usage : boundedUsage(raw.providerUsageMetadata); state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure }); state[`${effort}SemanticFailure`] = failure; state.status = policy.semanticFailureState[effort]; const nextEffort = policy.efforts[policy.efforts.indexOf(effort) + 1]; if (nextEffort) state[`${nextEffort}EligibleAt`] = new Date().toISOString(); await persist() }
      }
      if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) break
    }
    manifest.lastInvocation = { maxFreshCandidates, maxHttpRequests, actualHttpRequests: manifest.currentRunHttpRequests - invocationStart, freshCandidatesStarted: freshStarted, completedAt: new Date().toISOString() }; await persist(); return { manifest }
  } finally { await releaseRunLock(lock) }
}
