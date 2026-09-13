import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'
import { compareSemanticArtifacts, providerFailureDetails } from './runKimiK28HighSemanticSmoke.mjs'
import { sanitizeMalformedDiagnostics } from './runKimiK28HighOneFilmDiagnostic.mjs'

export const RUN_ID = 'kimi-k28-high-json-schema-12-film-comparison-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-12-film-comparison'
export const SCHEMA_HASH = 'sha256:8876dfaa86d325d3eb6b2545af31b762bfc60584fc8fab9d0d5be76f12396d20'
export const REQUEST_BUDGET = 24
export const MAX_ATTEMPTS_PER_CANDIDATE = 2
export const CONCURRENCY = 1

const MODEL_ID = 'kimi-for-coding'; const REASONING_EFFORT = 'high'; const OUTPUT_MODE = 'json_schema'; const SCHEMA_VERSION = 'semantic-output.v2'; const PROMPT_VERSION = 'semantic-classifier.v3'
const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'
const BASELINE_ROOT = 'generated/semantic/batches/v8-1-semantic-pilot-001'

export class KimiComparisonError extends Error {
  constructor(message, { code = 'KIMI_COMPARISON_ERROR' } = {}) { super(message); this.name = 'KimiComparisonError'; this.code = code }
}

async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }
function paths(pipelineRoot) { const root = resolve(pipelineRoot, 'generated/semantic/comparisons', RUN_ID); return { root, reportPath: resolve(root, 'report.json'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/comparisons', RUN_ID) } }
function providerFor({ env, fetchImpl }) { return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaProjectionVersion: 'legacy-v1', env, fetchImpl }) }
function boundedUsage(value) { const source = value && typeof value === 'object' ? value : {}; return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens'].filter((key) => typeof source[key] === 'number').map((key) => [key, source[key]])) }
function sameIdentity(artifact, candidate) { return artifact?.movie?.candidateId === candidate.candidateId && artifact?.movie?.tmdbId === candidate.tmdbId && artifact?.evidencePacketHash === candidate.evidencePacketHash && artifact?.promptVersion === PROMPT_VERSION && artifact?.schemaVersion === SCHEMA_VERSION && artifact?.modelProvider === 'google-gemini-developer-api' && artifact?.modelId === 'gemini-3.6-flash' && typeof artifact?.outputHash === 'string' }
function baselineIdentity(prompt) { return { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, semanticSchemaVersion: SCHEMA_VERSION, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}` } }
function validKimiCache(artifact, { candidate, cacheKey, provider }) { return artifact?.cacheKey === cacheKey && artifact?.movie?.candidateId === candidate.candidateId && artifact?.movie?.tmdbId === candidate.tmdbId && artifact?.evidencePacketHash === candidate.evidencePacketHash && artifact?.modelProvider === provider.metadata.providerId && artifact?.modelId === provider.metadata.modelId && artifact?.schemaVersion === SCHEMA_VERSION && artifact?.promptVersion === PROMPT_VERSION && typeof artifact?.outputHash === 'string' }
function median(values) { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b); const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2 }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function percent90(values) { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.ceil(ordered.length * 0.9) - 1] }

export function aggregateUsage(records) { const totals = { prompt_tokens: 0, completion_tokens: 0, thinking_tokens: 0, total_tokens: 0 }; for (const record of records) for (const key of Object.keys(totals)) if (typeof record.usage?.[key] === 'number') totals[key] += record.usage[key]; return totals }

export function summarizeComparisons(records) {
  const completed = records.filter((record) => record.status === 'COMPLETED' && record.comparison)
  const axes = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
  const jaccards = (field) => completed.map((record) => record.comparison[field].jaccard)
  return {
    comparablePairs: completed.length,
    ordinalExactAgreement: Object.fromEntries(axes.map((axis) => [axis, completed.filter((record) => record.comparison.ordinalAgreement[axis].match).length])),
    overallOrdinalExactAgreement: completed.filter((record) => axes.every((axis) => record.comparison.ordinalAgreement[axis].match)).length,
    moodsJaccard: { mean: mean(jaccards('moods')), median: median(jaccards('moods')) },
    situationsJaccard: { mean: mean(jaccards('situations')), median: median(jaccards('situations')) },
    filterLanguages: { rawRepresentation: 'unmodified-schema-values', exactSetAgreement: completed.filter((record) => record.comparison.filterLanguages.exactSetAgreement).length, pairs: completed.map((record) => ({ candidateId: record.candidateId, kimi: record.comparison.filterLanguages.candidate, gemini: record.comparison.filterLanguages.baseline, exactSetAgreement: record.comparison.filterLanguages.exactSetAgreement })) },
    boundaryFlags: { presenceAgreement: completed.filter((record) => record.comparison.boundaryFlags.presenceAgreement).length, meanPerFilm: { kimi: mean(completed.map((record) => record.comparison.boundaryFlags.candidateCount)), gemini: mean(completed.map((record) => record.comparison.boundaryFlags.baselineCount)) } },
  }
}

function priorById(report) { return new Map((report?.records ?? []).map((record) => [record.candidateId, record])) }
function reportIdentity(preflight) { return { runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: PROMPT_VERSION, promptContentHash: preflight.promptContentHash, candidateManifestHash: preflight.candidateManifestHash } }
function assertReportIdentity(report, identity) { for (const [key, value] of Object.entries(identity)) if (report[key] !== value) throw new KimiComparisonError(`Existing comparison report identity mismatch: ${key}.`, { code: 'RUN_IDENTITY_MISMATCH' }) }

export async function buildComparisonPreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')
  const provider = providerFor({ env: { KIMI_API_KEY: 'preflight-only-placeholder' }, fetchImpl: async () => { throw new Error('Preflight must not dispatch HTTP.') } })
  if (provider.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH) throw new KimiComparisonError('Structured-output schema hash drift.', { code: 'SCHEMA_HASH_MISMATCH' })
  const manifest = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, 'manifest.json')); const reasons = []
  for (const [field, expected] of Object.entries(baselineIdentity(prompt))) if (manifest[field] !== expected) reasons.push(`BASELINE_${field}_MISMATCH`)
  if (manifest.candidateCount !== 12 || !Array.isArray(manifest.candidates) || manifest.candidates.length !== 12 || new Set(manifest.candidates.map((candidate) => candidate.candidateId)).size !== 12) reasons.push('BASELINE_COHORT_NOT_EXACTLY_12_UNIQUE')
  const packets = []; const baselines = new Map(); const runtimePaths = paths(pipelineRoot)
  for (const candidate of manifest.candidates ?? []) {
    try {
      const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${candidate.candidateId}.json`)); const baseline = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, `${candidate.candidateId}.json`))
      if (packet?.candidateId !== candidate.candidateId || packet?.tmdbId !== candidate.tmdbId || packet?.inputHash !== candidate.evidencePacketHash) reasons.push(`EVIDENCE_IDENTITY_MISMATCH:${candidate.candidateId}`)
      else if (!sameIdentity(baseline, candidate)) reasons.push(`BASELINE_ARTIFACT_IDENTITY_MISMATCH:${candidate.candidateId}`)
      else { packets.push(packet); baselines.set(candidate.candidateId, baseline) }
    } catch { reasons.push(`BASELINE_OR_PACKET_UNAVAILABLE:${candidate.candidateId}`) }
  }
  if (reasons.length) throw new KimiComparisonError('Pilot cohort or baseline identity verification failed.', { code: 'BASELINE_IDENTITY_MISMATCH', reasons })
  const priorReport = await fileExists(runtimePaths.reportPath) ? await readJsonFile(runtimePaths.reportPath) : null
  const candidateManifestHash = manifest.candidateManifestHash; const candidateEntries = []
  for (const packet of packets) {
    const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION }); let cacheHit = false
    try { const cache = await readJsonFile(resolve(runtimePaths.cacheRoot, `${cacheKey}.json`)); cacheHit = validKimiCache(cache, { candidate: packet, cacheKey, provider }) } catch {}
    candidateEntries.push({ candidateId: packet.candidateId, tmdbId: packet.tmdbId, evidencePacketHash: packet.inputHash, cacheKey, cacheHit })
  }
  const preflight = { runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, outputAffectingConfiguration: provider.metadata.outputAffectingConfiguration, promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, candidateManifestHash, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: CONCURRENCY, candidates: candidateEntries, packets, baselines, prompt, paths: runtimePaths }
  if (priorReport) assertReportIdentity(priorReport, reportIdentity(preflight))
  const prior = priorById(priorReport); const priorRequests = (priorReport?.httpRequests ?? 0)
  const uncertainCandidates = candidateEntries.filter((candidate) => !candidate.cacheHit && (prior.get(candidate.candidateId)?.attempts ?? 0) > 0).map((candidate) => candidate.candidateId)
  const fresh = candidateEntries.filter((candidate) => !candidate.cacheHit && !prior.has(candidate.candidateId))
  return { ...preflight, resume: { validCacheHits: candidateEntries.filter((candidate) => candidate.cacheHit).length, freshCandidatesRemaining: fresh.length, priorAttempts: [...prior.values()].reduce((sum, record) => sum + (record.attempts ?? 0), 0), priorHttpRequests: priorRequests, remainingRequestBudget: Math.max(0, REQUEST_BUDGET - priorRequests), uncertainCandidates }, priorReport }
}

function makeReport(preflight, records, httpRequests) {
  const completed = records.filter((record) => record.status === 'COMPLETED'); const usageTotals = aggregateUsage(records); const valid = completed.length; const latencies = completed.map((record) => record.latencyMs).filter(Number.isFinite)
  return { schemaVersion: 'kimi-json-schema-comparison.v1', ...reportIdentity(preflight), requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: CONCURRENCY, baselineIdentityVerified: true, filterLanguageRepresentationFinding: { classification: 'HISTORICAL_REPRESENTATION_DRIFT', reason: 'semantic-output.v2 validates filterLanguages as strings and defines no canonical normalization; Gemini pilot artifacts may contain ISO-like values while Kimi may contain language names.', normalizationApplied: false }, cohort: preflight.candidates.map(({ candidateId, tmdbId, evidencePacketHash }) => ({ candidateId, tmdbId, evidencePacketHash })), records, httpRequests, counts: { validFilms: valid, terminalFailures: records.filter((record) => record.status === 'FAILED').length, firstAttemptValid: records.filter((record) => record.firstAttemptValidated).length, retryRecovered: records.filter((record) => record.retryRecovered).length }, rates: { firstAttemptValidity: records.length ? records.filter((record) => record.firstAttemptValidated).length / records.length : null, retryRecovery: records.filter((record) => record.retryRequired).length ? records.filter((record) => record.retryRecovered).length / records.filter((record) => record.retryRequired).length : null, requestsPerValidFilm: valid ? httpRequests / valid : null }, usageTotals, usagePerValidFilm: Object.fromEntries(Object.entries(usageTotals).map(([key, value]) => [key, valid ? value / valid : null])), latencyMs: { median: median(latencies), mean: mean(latencies), p90: percent90(latencies), max: latencies.length ? Math.max(...latencies) : null }, comparisonSummary: summarizeComparisons(records) }
}

export async function runKimiJsonSchemaComparison({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY) throw new KimiComparisonError('KIMI_API_KEY is required.', { code: 'MISSING_KIMI_API_KEY' })
  const preflight = await buildComparisonPreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile }); const previous = preflight.priorReport; let httpRequests = previous?.httpRequests ?? 0
  const byId = priorById(previous); const provider = providerFor({ env, fetchImpl: async (...args) => { if (httpRequests >= REQUEST_BUDGET) throw new KimiComparisonError('Comparison request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' }); httpRequests += 1; return fetchImpl(...args) } })
  const persist = async () => { const report = makeReport(preflight, [...byId.values()], httpRequests); await writeJsonFile(preflight.paths.reportPath, report); return report }
  for (const packet of preflight.packets) {
    const plan = preflight.candidates.find((candidate) => candidate.candidateId === packet.candidateId); const prior = byId.get(packet.candidateId)
    if (plan.cacheHit) {
      if (!prior || prior.status !== 'COMPLETED') { const artifact = await readJsonFile(resolve(preflight.paths.cacheRoot, `${plan.cacheKey}.json`)); const baseline = preflight.baselines.get(packet.candidateId); byId.set(packet.candidateId, { candidateId: packet.candidateId, status: 'COMPLETED', cacheHit: true, attempts: prior?.attempts ?? 0, providerRequests: prior?.providerRequests ?? 0, firstAttemptValidated: (prior?.attempts ?? 0) === 1, retryRequired: (prior?.attempts ?? 0) > 1, retryRecovered: (prior?.attempts ?? 0) > 1, finishReason: prior?.finishReason ?? null, latencyMs: prior?.latencyMs ?? null, usage: prior?.usage ?? boundedUsage(artifact.providerMetadata?.providerUsageMetadata), artifactHash: artifact.outputHash, comparison: compareSemanticArtifacts(artifact, baseline) }); await persist() }
      continue
    }
    // A persisted attempt without a valid artifact may represent a request whose terminal process disappeared.
    // Do not turn that ambiguous state into a silent re-dispatch on a later invocation.
    if (prior && (prior.attempts ?? 0) > 0) continue
    const alreadyUsed = 0; const allowance = Math.min(MAX_ATTEMPTS_PER_CANDIDATE, REQUEST_BUDGET - httpRequests)
    if (allowance <= 0) break
    const started = now(); const before = httpRequests
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet, provider, prompt: preflight.prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot: preflight.paths.cacheRoot, outputPath: resolve(preflight.paths.root, `${packet.candidateId}.json`), maxAttempts: allowance })
      const attempts = alreadyUsed + (httpRequests - before); byId.set(packet.candidateId, { candidateId: packet.candidateId, status: 'COMPLETED', cacheHit: result.cacheHit, attempts, providerRequests: attempts, firstAttemptValidated: attempts === 1, retryRequired: attempts > 1, retryRecovered: attempts > 1, finishReason: result.providerResponseDiagnostics?.finishReason ?? null, latencyMs: (prior?.latencyMs ?? 0) + now() - started, usage: boundedUsage(result.providerUsageMetadata), artifactHash: result.artifact.outputHash, comparison: compareSemanticArtifacts(result.artifact, preflight.baselines.get(packet.candidateId)) })
    } catch (error) {
      const attempts = alreadyUsed + (httpRequests - before); const malformed = error?.code === 'MALFORMED_MODEL_OUTPUT'; const diagnostics = malformed ? sanitizeMalformedDiagnostics(error.details ?? {}) : null
      byId.set(packet.candidateId, { candidateId: packet.candidateId, status: 'FAILED', attempts, providerRequests: attempts, firstAttemptValidated: false, retryRequired: attempts > 1, retryRecovered: false, finishReason: diagnostics?.finishReason ?? null, latencyMs: (prior?.latencyMs ?? 0) + now() - started, usage: diagnostics?.usage ?? {}, malformedDiagnostics: diagnostics, providerFailure: malformed ? null : providerFailureDetails(error), comparison: null })
    }
    await persist()
  }
  return { preflight, report: await persist() }
}

export async function launchKimiJsonSchemaComparison(argv = process.argv.slice(2), { onAuthorizedPreflight, ...options } = {}) { const preflight = await buildComparisonPreflight(options); if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, baselines: undefined, prompt: undefined, paths: undefined, priorReport: undefined } }; onAuthorizedPreflight?.({ runId: RUN_ID, resume: preflight.resume, candidates: preflight.candidates.map(({ candidateId, cacheHit }) => ({ candidateId, cacheHit })) }); return { executionAuthorized: true, ...(await runKimiJsonSchemaComparison(options)) } }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchKimiJsonSchemaComparison(process.argv.slice(2), { onAuthorizedPreflight: (value) => console.log(JSON.stringify({ executionAuthorized: true, resumePreflight: value }, null, 2)) }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
