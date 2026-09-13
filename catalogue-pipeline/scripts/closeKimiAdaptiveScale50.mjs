import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { atomicWriteArtifact, canonicalSha256 } from './c1bV2Stage0.mjs'
import { RUN_ID, SCHEMA_HASH, STATES, summarizeScale50 } from './runKimiAdaptiveScale50.mjs'
import { SOURCE_MANIFEST_HASH } from './scale50Manifest.mjs'

export const CLOSURE_PATH = 'catalogue-pipeline/calibration/diagnostics/kimi-k28-adaptive-scale-50-closure.v1.json'
export const SCALE_MANIFEST_HASH = 'sha256:bc2733492833df6b1e693c7646a468967e663d241b0d2aa7e2f58c1e64d7fd52'
const EXPECTED_IDENTITY = Object.freeze({
  runId: RUN_ID,
  scaleManifestHash: SCALE_MANIFEST_HASH,
  sourceCandidateManifestHash: SOURCE_MANIFEST_HASH,
  providerId: 'moonshot-kimi-api',
  modelId: 'kimi-for-coding',
  outputMode: 'json_schema',
  semanticOutputSchemaVersion: 'semantic-output.v2',
  semanticOutputSchemaHash: SCHEMA_HASH,
  promptVersion: 'semantic-classifier.v3',
  promptContentHash: 'sha256:5db1e9e61a08dedb18c68d49071fac7cb78242bf8851a984166b459eb3f784a8',
  taxonomyHash: 'sha256:11447b106cb2c84c5cf3643aba742a19b8069bcbd92f475dfcc661d004f2faa7',
  calibrationAnchorsHash: 'sha256:018c0d3499d6785b2f430c446943596a6333263da1c0e44b8cd7c5e8c5ba30ca',
  boundaryCasesHash: 'sha256:b38d958ba399ebde683b9c4f263f70dfcfd1dbbee53bc40a1b3bf876b820b006',
  highMaxPolicyVersion: 'kimi-k28-high-then-max-on-semantic-failure.v1',
})

export class AdaptiveScale50ClosureError extends Error {
  constructor(message, { code = 'ADAPTIVE_SCALE_50_CLOSURE_ERROR', details = {} } = {}) { super(message); this.name = 'AdaptiveScale50ClosureError'; this.code = code; this.details = details }
}
function fail(message, code, details = {}) { throw new AdaptiveScale50ClosureError(message, { code, details }) }
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

export function deriveAdaptiveScale50Closure({ manifest, runManifestRawSha256, validArtifactSetHash, validArtifactRawSetHash }) {
  for (const [key, expected] of Object.entries(EXPECTED_IDENTITY)) if (manifest?.[key] !== expected) fail(`Scale-50 closure identity mismatch: ${key}.`, 'CLOSURE_IDENTITY_MISMATCH', { key })
  const states = Object.values(manifest.states ?? {}); if (manifest.candidateCount !== 50 || states.length !== 50) fail('Scale-50 closure requires exactly 50 candidates.', 'CLOSURE_CANDIDATE_COUNT_MISMATCH')
  if (states.some(({ status }) => ![STATES.highValid, STATES.maxValid].includes(status))) fail('Scale-50 closure requires every candidate to be valid.', 'CLOSURE_INCOMPLETE')
  const summary = summarizeScale50(manifest); const manual = states.filter((state) => (state.manualRedispatches ?? 0) > 0); const transportUnknownEvents = states.flatMap((state) => state.events ?? []).filter(({ type, reason }) => type === 'UNCERTAIN' && reason === 'TRANSPORT_OUTCOME_UNKNOWN').length; const unrecoveredUsageDispatches = states.filter((state) => state.unrecoveredPriorDispatch?.usage === null).length
  if (summary.counts.highAttempts !== 50 || summary.counts.highFirstPassValid !== 47 || summary.highFirstPassValidityRate !== 0.94 || summary.counts.highSemanticValidationFailures !== 2 || summary.counts.maxEscalations !== 2 || summary.counts.maxRecoveries !== 2 || summary.maxRecoveryRate !== 1 || summary.counts.completedTotal !== 50 || summary.counts.uncertainCandidates !== 0 || summary.counts.pendingTotal !== 0) fail('Scale-50 closure metrics do not match the completed run.', 'CLOSURE_METRIC_MISMATCH', { summary })
  if (manifest.httpRequests !== 53 || summary.requestsPerCompletedFilm !== 1.06 || summary.usage.combined.total_tokens !== 374105 || summary.meanBoundaryFlagsPerValidFilm !== 1.94 || manual.length !== 1 || transportUnknownEvents !== 1 || unrecoveredUsageDispatches !== 1) fail('Scale-50 operational accounting mismatch.', 'CLOSURE_OPERATIONAL_ACCOUNTING_MISMATCH')
  const recovered = manual[0]; if (recovered.candidateId !== 'exp100-tmdb-1071806' || recovered.semanticAttempts?.high !== 2 || recovered.status !== STATES.highValid || !recovered.events?.some(({ type }) => type === 'MANUAL_REDISPATCH_AUTHORIZED')) fail('Manual uncertain-dispatch recovery provenance mismatch.', 'CLOSURE_RECOVERY_PROVENANCE_MISMATCH')
  const body = {
    schemaVersion: 'kimi-adaptive-scale-50-closure.v1', status: 'CLOSED', closureKind: 'PRODUCTION_ENGINEERING_OPERATIONAL_CLOSURE', closedAt: manifest.lastInvocation?.completedAt ?? null,
    identity: { ...EXPECTED_IDENTITY, runManifestRawSha256, validArtifactSetHash, validArtifactRawSetHash },
    outcome: { candidateCount: 50, completedValid: 50, unresolved: 0, originalHighFirstPassValid: 47, highFirstPassValidityRate: 0.94, highSemanticValidationFailures: 2, maxEscalations: 2, maxRecoveries: 2, maxRecoveryRate: 1, manualUncertainRedispatches: 1, transportUnknownEvents: 1, unresolvedTransportUnknown: 0, totalHttpRequests: 53, requestsPerCompletedFilm: 1.06, meanBoundaryFlagsPerValidFilm: 1.94 },
    usageAccounting: { highKnownObserved: summary.usage.high, maxKnownObserved: summary.usage.max, combinedKnownObserved: summary.usage.combined, knownObservedTokens: 374105, unrecoveredUsageDispatches: 1, actualProviderTokenConsumptionFullyKnown: false, caveat: 'The original transport-unknown High dispatch may or may not have consumed provider tokens; no usage was recovered, fabricated, or estimated for it.' },
    recovery: { candidateId: recovered.candidateId, originalOutcome: 'TRANSPORT_OUTCOME_UNKNOWN', authorizationEvent: 'MANUAL_REDISPATCH_AUTHORIZED', replacementEffort: 'high', finalStatus: recovered.status, highSemanticAttempts: 2, noSilentRedispatchSafeguardWorkedAsDesigned: true },
    interpretation: ['High-to-Max orchestration produced 50/50 valid Scale-50 artifacts.', 'High remained the default reasoning effort.', 'Max was used for 2/50 candidates and recovered both completed High semantic-validation failures.', 'One transport-ambiguous High dispatch required explicit maintainer-authorized High redispatch.', 'This is an engineering and operational result, not a statistical estimate of model quality.', 'Gemini remains a comparison baseline, not ground truth.'],
    externalCallsDuringClosure: { kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 },
  }
  return { ...body, closureCanonicalSha256: canonicalSha256(body) }
}

export async function verifyAndDeriveAdaptiveScale50Closure({ root = process.cwd() } = {}) {
  const manifestPath = resolve(root, 'catalogue-pipeline/generated/semantic/batches', RUN_ID, 'manifest.json'); const manifestRaw = await readFile(manifestPath); const manifest = JSON.parse(manifestRaw); const logical = []; const raw = []
  for (const state of Object.values(manifest.states ?? {}).sort((left, right) => left.candidateId.localeCompare(right.candidateId))) {
    const artifactRaw = await readFile(state.artifactPath); const artifact = JSON.parse(artifactRaw)
    if (artifact.movie?.candidateId !== state.candidateId || artifact.movie?.tmdbId !== state.tmdbId || artifact.evidencePacketHash !== state.evidencePacketHash || artifact.outputHash !== state.artifactHash) fail('Valid Scale-50 artifact identity mismatch.', 'CLOSURE_ARTIFACT_MISMATCH', { candidateId: state.candidateId })
    logical.push({ candidateId: state.candidateId, artifactHash: state.artifactHash }); raw.push({ candidateId: state.candidateId, rawSha256: rawSha256(artifactRaw) })
  }
  return deriveAdaptiveScale50Closure({ manifest, runManifestRawSha256: rawSha256(manifestRaw), validArtifactSetHash: canonicalSha256(logical), validArtifactRawSetHash: canonicalSha256(raw) })
}

export async function writeAdaptiveScale50Closure({ root = process.cwd() } = {}) {
  const closure = await verifyAndDeriveAdaptiveScale50Closure({ root }); const path = resolve(root, CLOSURE_PATH); await atomicWriteArtifact(path, closure); return { path, closure, rawSha256: rawSha256(await readFile(path)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv.includes('--write-closure') ? writeAdaptiveScale50Closure() : verifyAndDeriveAdaptiveScale50Closure().then((closure) => ({ closure }))
  action.then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
}
