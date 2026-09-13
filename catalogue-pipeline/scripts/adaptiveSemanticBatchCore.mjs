import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import semanticSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import { createKimiProvider } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { ModelProviderError } from '../adapters/modelProvider.ts'
import { acquireRunLock, atomicWriteArtifact, releaseRunLock } from './c1bV2Stage0.mjs'
import { buildSemanticClassifierInput, classifySemanticCandidate } from './classifySemantic.mjs'

export const ADAPTIVE_STATES = Object.freeze({
  imported: 'IMPORTED_VALID', pendingHigh: 'PENDING_HIGH', highValid: 'HIGH_VALID', highSemanticFailedMaxPending: 'HIGH_SEMANTIC_FAILED_MAX_PENDING', maxValid: 'MAX_VALID', retryableProviderFailure: 'RETRYABLE_PROVIDER_FAILURE', terminalProviderFailure: 'TERMINAL_PROVIDER_FAILURE', terminalSemanticFailure: 'TERMINAL_SEMANTIC_FAILURE', uncertain: 'UNCERTAIN_PRIOR_DISPATCH', highResponse: 'HIGH_RESPONSE_RECEIVED', maxResponse: 'MAX_RESPONSE_RECEIVED',
})
const terminal = new Set([ADAPTIVE_STATES.imported, ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid, ADAPTIVE_STATES.terminalProviderFailure, ADAPTIVE_STATES.terminalSemanticFailure, ADAPTIVE_STATES.uncertain])
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
  const usage = { high: emptyUsage(), max: emptyUsage() }
  for (const state of generated) { addUsage(usage.high, state.usage?.high); addUsage(usage.max, state.usage?.max) }
  const generatedValid = generated.filter((state) => [ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid].includes(state.status))
  return {
    importedValid: states.filter((state) => state.status === ADAPTIVE_STATES.imported).length,
    generatedValidThisRun: generatedValid.length,
    pending: generated.filter((state) => state.status === ADAPTIVE_STATES.pendingHigh).length,
    highSemanticFailures: generated.filter((state) => state.highSemanticFailure).length,
    maxEscalations: generated.filter((state) => state.maxEligibleAt).length,
    providerFailures: generated.filter((state) => [ADAPTIVE_STATES.retryableProviderFailure, ADAPTIVE_STATES.terminalProviderFailure].includes(state.status)).length,
    terminalSemanticFailures: generated.filter((state) => state.status === ADAPTIVE_STATES.terminalSemanticFailure).length,
    uncertain: generated.filter((state) => state.status === ADAPTIVE_STATES.uncertain).length,
    currentRunHttpRequests: manifest.currentRunHttpRequests ?? 0,
    tokenAccountingCurrentRun: { high: usage.high, max: usage.max, combined: Object.fromEntries(usageKeys.map((key) => [key, usage.high[key] + usage.max[key]])) },
  }
}

async function validateAndBuildArtifact({ raw, packet, provider, prompt, cacheRoot, outputPath, createdAt, promptVersion, schemaVersion }) {
  return classifySemanticCandidate({ evidencePacket: packet, provider: { metadata: provider.metadata, generateStructured: async () => raw }, prompt, promptVersion, schemaVersion, cacheRoot, outputPath, createdAt, maxAttempts: 1, fileExists: async () => false, writeJsonFile: async () => false })
}

export async function runAdaptiveSemanticBatch({ context, env = process.env, fetchImpl = globalThis.fetch, maxFreshCandidates, maxHttpRequests, maxTransportAttempts = 2, now = () => Date.now(), delayFn = async () => {}, writeJsonFile = durableJson } = {}) {
  if (!env.KIMI_API_KEY?.trim()) fail('KIMI_API_KEY is required for authorized adaptive generation.', 'MISSING_KIMI_API_KEY')
  if (!Number.isInteger(maxFreshCandidates) || maxFreshCandidates < 0 || !Number.isInteger(maxHttpRequests) || maxHttpRequests < 0) fail('Authorized adaptive runs require nonnegative integer candidate and HTTP caps.', 'INVALID_INVOCATION_BUDGET')
  const { runtime, identity, candidates, packets, importedStates, manifest: existing } = context
  await mkdir(runtime.runRoot, { recursive: true }); const lock = await acquireRunLock(runtime.lockPath, { runId: identity.runId, acquiredAt: new Date().toISOString() })
  let manifest = existing ?? { schemaVersion: 'adaptive-semantic-batch.v1', ...identity, candidateCount: candidates.length, currentRunHttpRequests: 0, invocationCount: 0, states: Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, importedStates.get(candidate.candidateId) ?? { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash, status: ADAPTIVE_STATES.pendingHigh, httpRequests: 0, transportRetries: 0, semanticAttempts: { high: 0, max: 0 }, usage: { high: {}, max: {} }, events: [] }])) }
  let freshStarted = 0; const invocationStart = manifest.currentRunHttpRequests
  const persist = async () => { manifest.summary = summarizeAdaptiveBatch(manifest); await writeJsonFile(runtime.manifestPath, manifest) }
  await persist()
  try {
    for (const candidate of candidates) {
      const state = manifest.states[candidate.candidateId]; const packet = packets.get(candidate.candidateId)
      if (terminal.has(state.status)) continue
      if (/DISPATCHING|RESPONSE_RECEIVED/.test(state.status)) { state.status = ADAPTIVE_STATES.uncertain; state.uncertainReason = 'PRIOR_PROCESS_STOPPED_AFTER_DISPATCH_BOUNDARY'; await persist(); continue }
      for (const effort of ['high', 'max']) {
        const eligible = effort === 'high' ? state.status === ADAPTIVE_STATES.pendingHigh || state.status === ADAPTIVE_STATES.retryableProviderFailure && state.failedEffort === 'high' : state.status === ADAPTIVE_STATES.highSemanticFailedMaxPending || state.status === ADAPTIVE_STATES.retryableProviderFailure && state.failedEffort === 'max'
        if (!eligible) continue
        if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) break
        if (effort === 'high' && state.semanticAttempts.high === 0) { if (freshStarted >= maxFreshCandidates) break; freshStarted += 1 }
        if (state.semanticAttempts[effort] === 0) state.semanticAttempts[effort] = 1
        const provider = createKimiProvider({ modelId: identity.modelId, reasoningEffort: effort, outputMode: identity.outputMode, semanticOutputSchemaVersion: identity.semanticOutputSchemaVersion, env, fetchImpl: async (...args) => {
          if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) fail('Invocation HTTP budget exhausted.', 'REQUEST_BUDGET_EXHAUSTED')
          state.status = `${effort.toUpperCase()}_DISPATCHING_UNCERTAIN`; state.httpRequests += 1; manifest.currentRunHttpRequests += 1; state.events.push({ type: 'HTTP_DISPATCH', effort, ordinal: state.httpRequests }); await persist(); return fetchImpl(...args)
        }, onResponseReceived: async (metadata) => { state.status = effort === 'high' ? ADAPTIVE_STATES.highResponse : ADAPTIVE_STATES.maxResponse; state.events.push({ type: 'HTTP_RESPONSE', effort, metadata }); await persist() } })
        const started = now(); let raw = null; let lastError = null; let responseObserved = false
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
        if (lastError?.code === 'MALFORMED_MODEL_OUTPUT' && raw === null) { const failure = semanticFailure(lastError); state.usage[effort] = failure.usage; state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure }); if (effort === 'high') { state.status = ADAPTIVE_STATES.highSemanticFailedMaxPending; state.highSemanticFailure = failure; state.maxEligibleAt = new Date().toISOString() } else { state.status = ADAPTIVE_STATES.terminalSemanticFailure; state.maxSemanticFailure = failure } await persist(); continue }
        const responsePath = resolve(runtime.responseRoot, `${candidate.candidateId}.${effort}.json`); await writeJsonFile(responsePath, raw); state.responsePath = responsePath; state.responseHash = `sha256:${stableHash(raw)}`; await persist()
        try { const outputPath = resolve(runtime.outputRoot, `${candidate.candidateId}.json`); const result = await validateAndBuildArtifact({ raw, packet, provider, prompt: context.prompt, cacheRoot: resolve(runtime.cacheRoot, effort), outputPath, createdAt: new Date().toISOString(), promptVersion: identity.promptVersion, schemaVersion: identity.semanticOutputSchemaVersion }); await writeJsonFile(result.cachePath, result.artifact); await writeJsonFile(outputPath, result.artifact); state.status = effort === 'high' ? ADAPTIVE_STATES.highValid : ADAPTIVE_STATES.maxValid; state.validatedEffort = effort; state.artifactPath = outputPath; state.cachePath = result.cachePath; state.cacheKey = result.cacheKey; state.artifactHash = result.artifact.outputHash; state.usage[effort] = boundedUsage(result.providerUsageMetadata); state.events.push({ type: 'SEMANTIC_VALID', effort, artifactHash: state.artifactHash }); await persist(); break } catch (error) { if (!['MALFORMED_MODEL_OUTPUT', 'INVALID_SEMANTIC_OUTPUT'].includes(error?.code)) throw error; const failure = semanticFailure(error); state.usage[effort] = Object.keys(failure.usage).length ? failure.usage : boundedUsage(raw.providerUsageMetadata); state.events.push({ type: 'SEMANTIC_VALIDATION_FAILURE', effort, failure }); if (effort === 'high') { state.status = ADAPTIVE_STATES.highSemanticFailedMaxPending; state.highSemanticFailure = failure; state.maxEligibleAt = new Date().toISOString() } else { state.status = ADAPTIVE_STATES.terminalSemanticFailure; state.maxSemanticFailure = failure } await persist() }
      }
      if (manifest.currentRunHttpRequests - invocationStart >= maxHttpRequests) break
    }
    manifest.lastInvocation = { maxFreshCandidates, maxHttpRequests, actualHttpRequests: manifest.currentRunHttpRequests - invocationStart, freshCandidatesStarted: freshStarted, completedAt: new Date().toISOString() }; await persist(); return { manifest }
  } finally { await releaseRunLock(lock) }
}
