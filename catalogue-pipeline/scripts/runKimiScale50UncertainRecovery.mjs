import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MANUAL_REDISPATCH_REASON, RUN_ID, SCHEMA_HASH, STATES, buildScale50Preflight, runAdaptiveScale50 } from './runKimiAdaptiveScale50.mjs'

export const AUTHORIZATION_FLAG = '--execute-authorized-uncertain-redispatch'
export const CANDIDATE_FLAG = '--candidate'
export const RECOVERY_CANDIDATE = Object.freeze({
  candidateId: 'exp100-tmdb-1071806',
  tmdbId: 1071806,
  evidencePacketHash: 'sha256:17871d92856d95c1b24734aaef4f4cfd73c38ea0f840f3214eac0e344772d6a0',
})
export const HARD_HTTP_CAP = 2

export class UncertainRecoveryError extends Error {
  constructor(message, { code = 'UNCERTAIN_RECOVERY_ERROR', details = {} } = {}) { super(message); this.name = 'UncertainRecoveryError'; this.code = code; this.details = details }
}
function fail(message, code, details = {}) { throw new UncertainRecoveryError(message, { code, details }) }
function candidateArgument(argv) { const index = argv.indexOf(CANDIDATE_FLAG); if (index < 0 || !argv[index + 1]) fail('The uncertain recovery requires an exact --candidate value.', 'MISSING_RECOVERY_CANDIDATE'); return argv[index + 1] }

export async function buildUncertainRecoveryPreflight({ candidateId, ...options } = {}) {
  if (candidateId !== RECOVERY_CANDIDATE.candidateId) fail('This closure recovery is authorized only for the recorded uncertain Scale-50 candidate.', 'RECOVERY_CANDIDATE_NOT_AUTHORIZED', { candidateId })
  const context = await buildScale50Preflight({ pipelineRoot: resolve('catalogue-pipeline'), ...options })
  const candidate = context.scaleManifest.candidates.find((entry) => entry.candidateId === candidateId); const state = context.manifest?.states?.[candidateId]
  if (!candidate || candidate.tmdbId !== RECOVERY_CANDIDATE.tmdbId || candidate.evidencePacketHash !== RECOVERY_CANDIDATE.evidencePacketHash) fail('Recovery candidate identity or frozen evidence hash mismatch.', 'RECOVERY_EVIDENCE_IDENTITY_MISMATCH', { candidateId })
  if (context.preflight.runId !== RUN_ID || context.preflight.semanticOutputSchemaHash !== SCHEMA_HASH) fail('Scale-50 recovery run identity mismatch.', 'RECOVERY_RUN_IDENTITY_MISMATCH')
  if (!state || state.status !== STATES.uncertain || state.uncertainReason !== 'TRANSPORT_OUTCOME_UNKNOWN') fail('Candidate is not in the exact recoverable uncertain state.', 'RECOVERY_STATE_MISMATCH', { candidateId, status: state?.status, uncertainReason: state?.uncertainReason })
  if ((state.manualRedispatches ?? 0) !== 0 || state.events?.some(({ type }) => type === 'MANUAL_REDISPATCH_AUTHORIZED')) fail('The one-time uncertain redispatch has already been authorized.', 'RECOVERY_ALREADY_AUTHORIZED', { candidateId })
  if (!state.events?.some(({ type, effort }) => type === 'HTTP_DISPATCH' && effort === 'high') || !state.events?.some(({ type, effort }) => type === 'UNCERTAIN' && effort === 'high')) fail('Original High dispatch/uncertainty provenance is incomplete.', 'RECOVERY_PROVENANCE_MISSING', { candidateId })
  return { runId: RUN_ID, candidate: RECOVERY_CANDIDATE, currentStatus: state.status, uncertainReason: state.uncertainReason, preservedEventTypes: state.events.map(({ type }) => type), priorCandidateHttpRequests: state.httpRequests, priorRunHttpRequests: context.manifest.httpRequests, priorUsageRecovered: false, authorizationEvent: { type: 'MANUAL_REDISPATCH_AUTHORIZED', effort: 'high', reason: MANUAL_REDISPATCH_REASON }, highFreshGenerationCap: 1, maxGenerationCap: 1, maxEligibility: 'RECEIVED_HIGH_SEMANTIC_VALIDATION_FAILURE_ONLY', hardHttpCap: HARD_HTTP_CAP, concurrency: 1 }
}

export async function runUncertainRecovery({ candidateId, ...options } = {}) {
  await buildUncertainRecoveryPreflight({ candidateId, ...options })
  return runAdaptiveScale50({ ...options, maxFreshCandidates: 0, maxHttpRequests: HARD_HTTP_CAP, maxTransportAttempts: 1, manualRecoveryCandidateId: candidateId })
}

export async function launchUncertainRecovery(argv = process.argv.slice(2), options = {}) {
  const candidateId = candidateArgument(argv); const preflight = await buildUncertainRecoveryPreflight({ candidateId, ...options })
  if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight }
  return { executionAuthorized: true, preflight, ...(await runUncertainRecovery({ candidateId, ...options })) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchUncertainRecovery().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
