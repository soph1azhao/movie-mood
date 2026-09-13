import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'
import { compareSemanticArtifacts, providerFailureDetails } from './runKimiK28HighSemanticSmoke.mjs'
import { sanitizeMalformedDiagnostics } from './runKimiK28HighOneFilmDiagnostic.mjs'
import { acquireRunLock, releaseRunLock } from './c1bV2Stage0.mjs'

export const RUN_ID = 'kimi-k28-low-engineering-screen-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-low-screen'
export const REQUEST_BUDGET = 10
export const ALLOWED_LIMITS = Object.freeze([3, 10])
export const MANIFEST_PATH = 'calibration/diagnostics/kimi-k28-low-engineering-screen.v1.json'
const SOURCE_RUN_ID = 'kimi-k28-adaptive-semantic-100-v1'
const MODEL_ID = 'kimi-for-coding'; const EFFORT = 'low'; const OUTPUT_MODE = 'json_schema'; const PROMPT_VERSION = 'semantic-classifier.v3'; const SCHEMA_VERSION = 'semantic-output.v2'

export class KimiLowScreenError extends Error { constructor(message, { code = 'KIMI_LOW_SCREEN_ERROR', details = {} } = {}) { super(message); this.name = 'KimiLowScreenError'; this.code = code; this.details = details } }
const fail = (message, code, details = {}) => { throw new KimiLowScreenError(message, { code, details }) }
async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp`; try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, path) } catch (error) { await rm(temp, { force: true }); throw error } }
function paths(pipelineRoot) { const root = resolve(pipelineRoot, 'generated/semantic/diagnostics', RUN_ID); return { root, statePath: resolve(root, 'state.json'), reportPath: resolve(root, 'report.json'), outputRoot: resolve(root, 'artifacts'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/diagnostics', RUN_ID), lockPath: resolve(root, 'RUN_LOCK') } }
function numberArg(argv, name) { const i = argv.indexOf(name); if (i < 0 || !/^\d+$/.test(argv[i + 1] ?? '')) fail(`Missing or invalid ${name}.`, 'INVALID_LIMIT'); return Number(argv[i + 1]) }
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
function median(values) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2 }
function finite(records, read) { return records.map(read).filter(Number.isFinite) }
function usage(value) { const source = value && typeof value === 'object' ? value : {}; return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens'].filter((key) => Number.isFinite(source[key])).map((key) => [key, source[key]])) }

export function summarizeLowScreen(records, limit) {
  const attempted = records.filter((record) => ['VALID', 'INVALID', 'PROVIDER_FAILURE', 'UNCERTAIN'].includes(record.status)); const valid = attempted.filter((record) => record.status === 'VALID'); const matched = valid.filter((record) => record.historicalProductionEffort === 'high')
  const lowLatencies = finite(valid, (record) => record.lowLatencyMs); const highLatencies = finite(matched, (record) => record.historicalProductionLatencyMs); const lowTokens = finite(matched, (record) => record.lowUsage?.total_tokens); const highTokens = finite(matched, (record) => record.historicalProductionTotalTokens)
  const lowMedianLatency = median(lowLatencies); const highMedianLatency = median(highLatencies); const lowMeanTokens = mean(lowTokens); const highMeanTokens = mean(highTokens)
  const latencyRatio = Number.isFinite(lowMedianLatency) && Number.isFinite(highMedianLatency) && highMedianLatency > 0 ? lowMedianLatency / highMedianLatency : null
  const tokenRatio = Number.isFinite(lowMeanTokens) && Number.isFinite(highMeanTokens) && highMeanTokens > 0 ? lowMeanTokens / highMeanTokens : null
  const firstThree = records.slice(0, 3); const firstThreeFailures = firstThree.filter((record) => record.status && record.status !== 'VALID').length
  const firstThreeLowMedian = median(finite(firstThree.filter((record) => record.status === 'VALID'), (record) => record.lowLatencyMs)); const firstThreeHighMedian = median(finite(firstThree.filter((record) => record.status === 'VALID' && record.historicalProductionEffort === 'high'), (record) => record.historicalProductionLatencyMs)); const firstThreeLatencyRatio = Number.isFinite(firstThreeLowMedian) && Number.isFinite(firstThreeHighMedian) && firstThreeHighMedian > 0 ? firstThreeLowMedian / firstThreeHighMedian : null
  const speedGate = firstThree.length < 3 || firstThree.some((record) => !record.status) ? 'PENDING' : firstThreeFailures >= 2 || firstThreeLatencyRatio !== null && firstThreeLatencyRatio > 1.25 ? 'STOP_EARLY' : 'PASS'
  let recommendation = 'INCONCLUSIVE'
  if (attempted.length >= 10 && !attempted.some((record) => record.status === 'UNCERTAIN')) {
    const tokenSaving = tokenRatio === null ? null : 1 - tokenRatio
    if (valid.length <= 8 || latencyRatio !== null && latencyRatio > 1.10 || tokenSaving !== null && tokenSaving < 0.15) recommendation = 'REJECT'
    else if (valid.length >= 9 && tokenRatio !== null && tokenRatio <= 0.85 && latencyRatio !== null && latencyRatio <= 1.10) recommendation = 'ADOPT'
  }
  const ordinalFields = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
  return { requestedLimit: limit, attempted: attempted.length, strictValid: valid.length, lowFirstPassValidityRate: attempted.length ? valid.length / attempted.length : null, lowLatencyMs: { mean: mean(lowLatencies), median: lowMedianLatency }, matchedHistoricalHighLatencyMs: { mean: mean(highLatencies), median: highMedianLatency, available: highLatencies.length === matched.length && matched.length > 0 }, latencyRatio, lowTotalTokenMean: lowMeanTokens, matchedHistoricalHighTotalTokenMean: highMeanTokens, tokenRatio, tokenSavingFraction: tokenRatio === null ? null : 1 - tokenRatio, speedGate, speedGateLatencyRatio: firstThreeLatencyRatio, ordinalSemanticAgreement: { matches: matched.reduce((sum, record) => sum + ordinalFields.filter((field) => record.comparison?.ordinalAgreement?.[field]?.match).length, 0), outOf: matched.length * ordinalFields.length }, boundaryFlagComparison: { presenceMatches: matched.filter((record) => record.comparison?.boundaryFlags?.presenceAgreement).length, pairs: matched.length }, lowRecommendation: recommendation }
}

export async function buildLowScreenPreflight({ pipelineRoot = resolve('catalogue-pipeline'), readJsonFile = readJson, readTextFile = readFile, fileExists = exists } = {}) {
  const [definition, sourceManifest, expansion, prompt] = await Promise.all([readJsonFile(resolve(pipelineRoot, MANIFEST_PATH)), readJsonFile(resolve(pipelineRoot, 'generated/semantic/batches', SOURCE_RUN_ID, 'manifest.json')), readJsonFile(resolve(pipelineRoot, 'generated/catalogue-expansion/expansion-100-v1/candidate-manifest.json')), readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')])
  if (definition.runId !== RUN_ID || definition.sourceRunId !== SOURCE_RUN_ID || definition.providerId !== KIMI_PROVIDER_ID || definition.modelId !== MODEL_ID || definition.reasoningEffort !== EFFORT || definition.candidates?.length !== 10 || new Set(definition.candidates.map((candidate) => candidate.candidateId)).size !== 10) fail('Frozen diagnostic manifest identity mismatch.', 'DIAGNOSTIC_MANIFEST_MISMATCH')
  const provider = createKimiProvider({ modelId: MODEL_ID, reasoningEffort: EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, env: { KIMI_API_KEY: 'offline-preflight-placeholder' }, fetchImpl: async () => fail('Preflight HTTP forbidden.', 'PREFLIGHT_HTTP_FORBIDDEN') })
  if (provider.metadata.outputAffectingConfiguration.reasoningEffort !== 'low') fail('Low must be the sole reasoning effort.', 'EFFORT_IDENTITY_MISMATCH')
  const expansionById = new Map(expansion.candidates.map((candidate) => [candidate.candidateId, candidate])); const packets = new Map(); const baselines = new Map(); const candidates = []; const runtime = paths(pipelineRoot)
  for (const expected of definition.candidates) {
    const sourceState = sourceManifest.states?.[expected.candidateId]; const expansionCandidate = expansionById.get(expected.candidateId)
    if (!sourceState || sourceState.status !== 'HIGH_VALID' || sourceState.validatedEffort !== 'high' || sourceState.evidencePacketHash !== expected.evidencePacketHash || sourceState.artifactHash !== expected.historicalArtifactHash || expansionCandidate?.tmdbId !== expected.tmdbId) fail('Historical High-first-pass identity mismatch.', 'HISTORICAL_IDENTITY_MISMATCH', { candidateId: expected.candidateId })
    const packet = await readJsonFile(resolve(pipelineRoot, 'generated/catalogue-expansion/expansion-100-v1/evidence-packets', `${expected.candidateId}.json`)); const baseline = await readJsonFile(sourceState.artifactPath)
    if (packet.candidateId !== expected.candidateId || packet.tmdbId !== expected.tmdbId || packet.inputHash !== expected.evidencePacketHash || baseline.outputHash !== expected.historicalArtifactHash || baseline.evidencePacketHash !== expected.evidencePacketHash) fail('Evidence or historical artifact drift.', 'INPUT_ARTIFACT_DRIFT', { candidateId: expected.candidateId })
    const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION }); const cachePath = resolve(runtime.cacheRoot, `${cacheKey}.json`)
    packets.set(expected.candidateId, packet); baselines.set(expected.candidateId, baseline); candidates.push({ ...expected, historicalTotalTokens: sourceState.usage?.high?.total_tokens ?? null, historicalLatencyMs: sourceState.latencyMs ?? null, cacheKey, cachePath, cacheHit: await fileExists(cachePath) })
  }
  let state = null; if (await fileExists(runtime.statePath)) state = await readJsonFile(runtime.statePath)
  if (state && (state.runId !== RUN_ID || state.definitionHash !== `sha256:${stableHash(definition)}`)) fail('Persisted diagnostic identity drift.', 'STATE_IDENTITY_MISMATCH')
  for (const candidate of candidates) if (candidate.cacheHit && !['VALID'].includes(state?.records?.[candidate.candidateId]?.status)) fail('Unbound Low cache artifact requires inspection.', 'UNBOUND_CACHE_ARTIFACT', { candidateId: candidate.candidateId })
  return { runId: RUN_ID, definitionHash: `sha256:${stableHash(definition)}`, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: EFFORT, outputMode: OUTPUT_MODE, promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: provider.metadata.outputAffectingConfiguration.semanticOutputSchemaHash, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: 1, concurrency: 1, historicalLatencyAvailable: candidates.every((candidate) => Number.isFinite(candidate.historicalLatencyMs)), candidates, packets, baselines, prompt, runtime, state }
}

export async function runLowScreen({ limit, pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists, buildPreflight = buildLowScreenPreflight, classifyFn = classifySemanticCandidate, ensureRoot = (path) => mkdir(path, { recursive: true }), acquireLock = acquireRunLock, releaseLock = releaseRunLock } = {}) {
  if (!ALLOWED_LIMITS.includes(limit)) fail('Limit must be 3 or 10.', 'INVALID_LIMIT'); if (!env.KIMI_API_KEY?.trim()) fail('KIMI_API_KEY is required.', 'MISSING_KIMI_API_KEY')
  const preflight = await buildPreflight({ pipelineRoot, readJsonFile, readTextFile, fileExists }); await ensureRoot(preflight.runtime.root); const lock = await acquireLock(preflight.runtime.lockPath, { runId: RUN_ID, acquiredAt: new Date().toISOString() })
  try {
  const state = preflight.state ?? { schemaVersion: 'kimi-k28-low-engineering-screen-state.v1', runId: RUN_ID, definitionHash: preflight.definitionHash, httpRequests: 0, records: {} }
  for (const record of Object.values(state.records)) if (record.status === 'DISPATCHING') { record.status = 'UNCERTAIN'; record.uncertainReason = 'PRIOR_PROCESS_STOPPED_AFTER_DISPATCH_BOUNDARY'; record.events.push({ type: 'UNCERTAIN_ON_RESUME' }) }
  const persist = async () => writeJsonFile(preflight.runtime.statePath, state); await persist()
  if (Object.values(state.records).some((record) => record.status === 'UNCERTAIN')) fail('Ambiguous prior dispatch requires manual resolution; automatic redispatch refused.', 'UNCERTAIN_PRIOR_DISPATCH')
  const currentSummary = summarizeLowScreen(preflight.candidates.map((candidate) => state.records[candidate.candidateId] ?? {}), limit)
  if (limit === 10 && currentSummary.speedGate === 'STOP_EARLY') fail('Three-film speed gate requires STOP_EARLY.', 'LOW_SCREEN_STOP_EARLY')
  for (const candidate of preflight.candidates.slice(0, limit)) {
    if (state.records[candidate.candidateId]?.status) continue
    if (state.httpRequests >= REQUEST_BUDGET) fail('Low screen request budget exhausted.', 'REQUEST_BUDGET_EXHAUSTED')
    const record = { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, evidencePacketHash: candidate.evidencePacketHash, reasoningEffort: 'low', historicalProductionEffort: candidate.historicalEffort, historicalProductionLatencyMs: candidate.historicalLatencyMs, historicalProductionTotalTokens: candidate.historicalTotalTokens, status: 'DISPATCHING', events: [{ type: 'HTTP_DISPATCH_INTENT', effort: 'low' }] }; state.records[candidate.candidateId] = record; await persist()
    const started = now(); let responseObserved = false
    const countedFetch = async (...args) => { if (state.httpRequests >= REQUEST_BUDGET) fail('Low screen request budget exhausted.', 'REQUEST_BUDGET_EXHAUSTED'); state.httpRequests += 1; await persist(); const response = await fetchImpl(...args); responseObserved = true; record.status = 'RESPONSE_RECEIVED'; record.events.push({ type: 'HTTP_RESPONSE', status: response.status }); await persist(); return response }
    const provider = createKimiProvider({ modelId: MODEL_ID, reasoningEffort: 'low', outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, env, fetchImpl: countedFetch })
    try {
      const result = await classifyFn({ evidencePacket: preflight.packets.get(candidate.candidateId), provider, prompt: preflight.prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot: preflight.runtime.cacheRoot, outputPath: resolve(preflight.runtime.outputRoot, `${candidate.candidateId}.json`), maxAttempts: 1 })
      record.status = 'VALID'; record.lowLatencyMs = now() - started; record.lowUsage = usage(result.providerUsageMetadata); record.lowArtifactHash = result.artifact.outputHash; record.comparison = compareSemanticArtifacts(result.artifact, preflight.baselines.get(candidate.candidateId)); record.events.push({ type: 'SEMANTIC_VALID' })
    } catch (error) {
      record.lowLatencyMs = now() - started
      if (!responseObserved) { record.status = 'UNCERTAIN'; record.uncertainReason = 'TRANSPORT_OUTCOME_UNKNOWN'; record.events.push({ type: 'UNCERTAIN' }) }
      else if (error?.code === 'MALFORMED_MODEL_OUTPUT' || error?.code === 'INVALID_SEMANTIC_OUTPUT') { const diagnostics = sanitizeMalformedDiagnostics(error.details ?? {}); record.status = 'INVALID'; record.lowUsage = usage(diagnostics.usage); record.malformedDiagnostics = diagnostics; record.events.push({ type: 'SEMANTIC_INVALID', code: error.code }) }
      else { record.status = 'PROVIDER_FAILURE'; record.providerFailure = providerFailureDetails(error); record.events.push({ type: 'PROVIDER_FAILURE', code: record.providerFailure.code }) }
    }
    await persist(); const partial = summarizeLowScreen(preflight.candidates.map((entry) => state.records[entry.candidateId] ?? {}), limit); if (limit === 3 && partial.speedGate === 'STOP_EARLY') break
  }
  const orderedRecords = preflight.candidates.map((candidate) => state.records[candidate.candidateId]).filter(Boolean); const metrics = summarizeLowScreen(preflight.candidates.map((candidate) => state.records[candidate.candidateId] ?? {}), limit)
  const report = { schemaVersion: 'kimi-k28-low-engineering-screen-report.v1', runId: RUN_ID, definitionHash: preflight.definitionHash, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: 'low', promptVersion: PROMPT_VERSION, promptContentHash: preflight.promptContentHash, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: preflight.semanticOutputSchemaHash, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: 1, concurrency: 1, httpRequests: state.httpRequests, records: orderedRecords, metrics, productionPolicyChanged: false }
  await writeJsonFile(preflight.runtime.reportPath, report); return { preflight, report }
  } finally { await releaseLock(lock) }
}

export async function launchLowScreen(argv = process.argv.slice(2), options = {}) { const limit = numberArg(argv, '--limit'); if (!ALLOWED_LIMITS.includes(limit)) fail('Limit must be 3 or 10.', 'INVALID_LIMIT'); const preflight = await buildLowScreenPreflight(options); if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, baselines: undefined, prompt: undefined, runtime: undefined, state: undefined, requestedLimit: limit } }; return { executionAuthorized: true, ...(await runLowScreen({ ...options, limit })) } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchLowScreen().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
