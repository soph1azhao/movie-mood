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

export const RUN_ID = 'kimi-k28-high-vs-max-4-film-paired-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-high-vs-max'
export const SCHEMA_HASH = 'sha256:a5bacc030ad25d46a01856f6e49d6d041809683e82d2469d23ac9eae412866fc'
export const REQUEST_BUDGET = 8
export const MAX_ATTEMPTS_PER_ARM_CANDIDATE = 1
export const COHORT = Object.freeze([
  { candidateId: 'little-miss-sunshine', evidencePacketHash: 'sha256:0cd97dc6dc0f32c5f2d2c530a955efea847a813d3a81b4935fee25c0de42b544' },
  { candidateId: 'get-out', evidencePacketHash: 'sha256:478c8da46147da7369491f04f3507d515472d7c87dff1d764984606027909ba8' },
  { candidateId: 'rrr', evidencePacketHash: 'sha256:839d334015629eb2d2e4aa60796e3409826e5706a94c684e42e7fb92db41744e' },
  { candidateId: 'spirited-away', evidencePacketHash: 'sha256:f6a646a429ec7157a4cd98943c1de3fa106a85fb921f477ab385188de225c978' },
])
export const EXECUTION_ORDER = Object.freeze([
  { candidateId: 'little-miss-sunshine', reasoningEffort: 'high' }, { candidateId: 'little-miss-sunshine', reasoningEffort: 'max' },
  { candidateId: 'get-out', reasoningEffort: 'max' }, { candidateId: 'get-out', reasoningEffort: 'high' },
  { candidateId: 'rrr', reasoningEffort: 'high' }, { candidateId: 'rrr', reasoningEffort: 'max' },
  { candidateId: 'spirited-away', reasoningEffort: 'max' }, { candidateId: 'spirited-away', reasoningEffort: 'high' },
])

const MODEL_ID = 'kimi-for-coding'; const OUTPUT_MODE = 'json_schema'; const SCHEMA_VERSION = 'semantic-output.v2'; const PROMPT_VERSION = 'semantic-classifier.v3'
const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'; const BASELINE_ROOT = 'generated/semantic/batches/v8-1-semantic-pilot-001'
export class KimiHighVsMaxError extends Error { constructor(message, { code = 'KIMI_HIGH_VS_MAX_ERROR' } = {}) { super(message); this.name = 'KimiHighVsMaxError'; this.code = code } }
async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }
function paths(pipelineRoot, effort) { const root = resolve(pipelineRoot, 'generated/semantic/experiments', RUN_ID, effort); return { root, cacheRoot: resolve(pipelineRoot, 'cache/semantic/experiments', RUN_ID, effort), reportPath: resolve(pipelineRoot, 'generated/semantic/experiments', RUN_ID, 'report.json') } }
function providerFor(effort, env, fetchImpl) { return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: effort, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, env, fetchImpl }) }
function usage(value) { const source = value && typeof value === 'object' ? value : {}; return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens'].filter((key) => typeof source[key] === 'number').map((key) => [key, source[key]])) }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function median(values) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const index = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[index] : (sorted[index - 1] + sorted[index]) / 2 }
function baselineIdentity(prompt) { return { providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, semanticSchemaVersion: SCHEMA_VERSION, taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`, boundaryCasesHash: `sha256:${stableHash(boundaryCases)}` } }
function artifactMatchesBaseline(artifact, candidate) { return artifact?.movie?.candidateId === candidate.candidateId && artifact?.movie?.tmdbId === candidate.tmdbId && artifact?.evidencePacketHash === candidate.evidencePacketHash && artifact?.promptVersion === PROMPT_VERSION && artifact?.schemaVersion === SCHEMA_VERSION && artifact?.modelProvider === 'google-gemini-developer-api' && artifact?.modelId === 'gemini-3.6-flash' && typeof artifact?.outputHash === 'string' }

export function summarizeArm(records, effort) {
  const arm = records.filter((record) => record.reasoningEffort === effort); const valid = arm.filter((record) => record.status === 'VALID'); const axes = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']; const total = (key) => arm.reduce((sum, record) => sum + (record.usage?.[key] ?? 0), 0)
  const comparisons = valid.map((record) => record.geminiComparison).filter(Boolean)
  return { attempted: arm.length, valid: valid.length, ordinalMatches: comparisons.reduce((sum, comparison) => sum + axes.filter((axis) => comparison.ordinalAgreement[axis].match).length, 0), ordinalMatchesOutOf: comparisons.length * axes.length, comparablePairs: comparisons.length, perAxisOrdinalAgreement: Object.fromEntries(axes.map((axis) => [axis, comparisons.filter((comparison) => comparison.ordinalAgreement[axis].match).length])), moodsJaccard: { mean: mean(comparisons.map((comparison) => comparison.moods.jaccard)), median: median(comparisons.map((comparison) => comparison.moods.jaccard)) }, situationsJaccard: { mean: mean(comparisons.map((comparison) => comparison.situations.jaccard)), median: median(comparisons.map((comparison) => comparison.situations.jaccard)) }, conservatismReviewBurden: { totalBoundaryFlags: valid.reduce((sum, record) => sum + record.boundaryFlagCount, 0), meanBoundaryFlagsPerFilm: mean(valid.map((record) => record.boundaryFlagCount)) }, usage: { prompt_tokens: total('prompt_tokens'), completion_tokens: total('completion_tokens'), thinking_tokens: total('thinking_tokens'), total_tokens: total('total_tokens'), meanTotalTokensPerAttemptedFilm: arm.length ? total('total_tokens') / arm.length : null, meanThinkingTokens: mean(arm.map((record) => record.usage?.thinking_tokens).filter(Number.isFinite)) }, latencyMs: { median: median(valid.map((record) => record.latencyMs).filter(Number.isFinite)), mean: mean(valid.map((record) => record.latencyMs).filter(Number.isFinite)) } }
}

export function pairedDeltas(records) {
  const pairs = COHORT.map(({ candidateId }) => ({ candidateId, high: records.find((record) => record.candidateId === candidateId && record.reasoningEffort === 'high'), max: records.find((record) => record.candidateId === candidateId && record.reasoningEffort === 'max') })).filter(({ high, max }) => high?.status === 'VALID' && max?.status === 'VALID')
  const subtract = (read) => mean(pairs.map(({ high, max }) => read(max) - read(high)).filter(Number.isFinite))
  return { pairedCandidates: pairs.length, meanMaxMinusHigh: { total_tokens: subtract((record) => record.usage?.total_tokens), thinking_tokens: subtract((record) => record.usage?.thinking_tokens), latencyMs: subtract((record) => record.latencyMs), boundaryFlags: subtract((record) => record.boundaryFlagCount), ordinalAgreement: subtract((record) => record.geminiComparison ? Object.values(record.geminiComparison.ordinalAgreement).filter(({ match }) => match).length : NaN), moodsJaccard: subtract((record) => record.geminiComparison?.moods.jaccard), situationsJaccard: subtract((record) => record.geminiComparison?.situations.jaccard) } }
}

function recommendation(records, summaries) {
  const maxFailureWhereHighValid = COHORT.some(({ candidateId }) => records.find((record) => record.candidateId === candidateId && record.reasoningEffort === 'high')?.status === 'VALID' && records.find((record) => record.candidateId === candidateId && record.reasoningEffort === 'max')?.status !== 'VALID')
  const high = summaries.high; const max = summaries.max; const noClearAgreementImprovement = max.ordinalMatches <= high.ordinalMatches && max.moodsJaccard.mean <= high.moodsJaccard.mean && max.situationsJaccard.mean <= high.situationsJaccard.mean
  if (maxFailureWhereHighValid) return { recommendation: 'AGAINST_EXPANDING_MAX', reason: 'Max introduced a non-valid result where High was valid.' }
  if (max.conservatismReviewBurden.totalBoundaryFlags >= high.conservatismReviewBurden.totalBoundaryFlags && noClearAgreementImprovement) return { recommendation: 'AGAINST_EXPANDING_MAX', reason: 'Max did not reduce conservatism/review burden or improve observed semantic agreement.' }
  if (high.usage.total_tokens > 0 && max.usage.total_tokens > high.usage.total_tokens * 1.5 && noClearAgreementImprovement) return { recommendation: 'AGAINST_EXPANDING_MAX', reason: 'Max exceeded 1.5x High token use without clear observed semantic improvement.' }
  return { recommendation: 'MAINTAINER_REVIEW_REQUIRED', reason: 'This exploratory four-film screen reports paired evidence without forcing a statistical conclusion.' }
}

export async function buildHighVsMaxPreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8'); const manifest = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, 'manifest.json')); const reasons = []
  for (const [key, value] of Object.entries(baselineIdentity(prompt))) if (manifest[key] !== value) reasons.push(`BASELINE_${key}_MISMATCH`)
  const manifestById = new Map((manifest.candidates ?? []).map((candidate) => [candidate.candidateId, candidate])); const packets = new Map(); const baselines = new Map()
  for (const expected of COHORT) {
    const candidate = manifestById.get(expected.candidateId); const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${expected.candidateId}.json`)); const baseline = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, `${expected.candidateId}.json`))
    if (candidate?.evidencePacketHash !== expected.evidencePacketHash || packet?.candidateId !== expected.candidateId || packet?.tmdbId !== candidate?.tmdbId || packet?.inputHash !== expected.evidencePacketHash || !artifactMatchesBaseline(baseline, candidate)) reasons.push(`INPUT_OR_BASELINE_IDENTITY_MISMATCH:${expected.candidateId}`)
    packets.set(expected.candidateId, packet); baselines.set(expected.candidateId, baseline)
  }
  const high = providerFor('high', { KIMI_API_KEY: 'preflight-only-placeholder' }, async () => { throw new Error('Preflight must not dispatch HTTP.') }); const max = providerFor('max', { KIMI_API_KEY: 'preflight-only-placeholder' }, async () => { throw new Error('Preflight must not dispatch HTTP.') })
  if (high.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH || max.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH) reasons.push('CURRENT_SCHEMA_HASH_MISMATCH')
  if (reasons.length) throw new KimiHighVsMaxError('Paired screen input identity verification failed.', { code: 'PAIRED_INPUT_IDENTITY_MISMATCH', reasons })
  const plan = []
  for (const entry of EXECUTION_ORDER) { const packet = packets.get(entry.candidateId); const provider = entry.reasoningEffort === 'high' ? high : max; const armPaths = paths(pipelineRoot, entry.reasoningEffort); const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION }); plan.push({ ...entry, evidencePacketHash: packet.inputHash, tmdbId: packet.tmdbId, cacheKey, cachePath: resolve(armPaths.cacheRoot, `${cacheKey}.json`), cacheHit: await fileExists(resolve(armPaths.cacheRoot, `${cacheKey}.json`)) }) }
  if (new Set(plan.map(({ cachePath }) => cachePath)).size !== plan.length) throw new KimiHighVsMaxError('High and Max cache identities must be distinct.', { code: 'CROSS_ARM_CACHE_IDENTITY_COLLISION' })
  return { runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, requestBudget: REQUEST_BUDGET, maxAttemptsPerArmCandidate: MAX_ATTEMPTS_PER_ARM_CANDIDATE, concurrency: 1, executionOrder: plan, packets, baselines, prompt }
}

export async function runKimiHighVsMaxScreen({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY) throw new KimiHighVsMaxError('KIMI_API_KEY is required.', { code: 'MISSING_KIMI_API_KEY' })
  const preflight = await buildHighVsMaxPreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile }); let httpRequests = 0; const providers = Object.fromEntries(['high', 'max'].map((effort) => [effort, providerFor(effort, env, async (...args) => { if (httpRequests >= REQUEST_BUDGET) throw new KimiHighVsMaxError('Paired screen request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' }); httpRequests += 1; return fetchImpl(...args) })])); const records = []
  for (const plan of preflight.executionOrder) {
    const packet = preflight.packets.get(plan.candidateId); const started = now(); const before = httpRequests
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet, provider: providers[plan.reasoningEffort], prompt: preflight.prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot: paths(pipelineRoot, plan.reasoningEffort).cacheRoot, outputPath: resolve(paths(pipelineRoot, plan.reasoningEffort).root, `${packet.candidateId}.json`), maxAttempts: MAX_ATTEMPTS_PER_ARM_CANDIDATE })
      records.push({ candidateId: packet.candidateId, reasoningEffort: plan.reasoningEffort, status: 'VALID', semanticValidatorSuccess: true, cacheHit: result.cacheHit, attempts: httpRequests - before, providerRequests: httpRequests - before, finishReason: result.providerResponseDiagnostics?.finishReason ?? null, latencyMs: now() - started, usage: usage(result.providerUsageMetadata), artifactHash: result.artifact.outputHash, boundaryFlagCount: result.artifact.boundaryFlags?.length ?? 0, geminiComparison: compareSemanticArtifacts(result.artifact, preflight.baselines.get(packet.candidateId)) })
    } catch (error) {
      const malformed = error?.code === 'MALFORMED_MODEL_OUTPUT'; const diagnostics = malformed ? sanitizeMalformedDiagnostics(error.details ?? {}) : null
      records.push({ candidateId: packet.candidateId, reasoningEffort: plan.reasoningEffort, status: malformed ? 'MALFORMED' : 'PROVIDER_FAILURE', semanticValidatorSuccess: false, cacheHit: false, attempts: httpRequests - before, providerRequests: httpRequests - before, finishReason: diagnostics?.finishReason ?? null, latencyMs: now() - started, usage: diagnostics?.usage ?? {}, artifactHash: null, boundaryFlagCount: null, ...(malformed ? { malformedDiagnostics: diagnostics } : { providerFailure: providerFailureDetails(error) }) })
    }
  }
  const summaries = { high: summarizeArm(records, 'high'), max: summarizeArm(records, 'max') }; const report = { schemaVersion: 'kimi-high-vs-max-screen.v1', runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: PROMPT_VERSION, promptContentHash: preflight.promptContentHash, requestBudget: REQUEST_BUDGET, maxAttemptsPerArmCandidate: MAX_ATTEMPTS_PER_ARM_CANDIDATE, concurrency: 1, executionOrder: preflight.executionOrder.map(({ candidateId, reasoningEffort, evidencePacketHash }) => ({ candidateId, reasoningEffort, evidencePacketHash })), records, httpRequests, armSummaries: summaries, pairedDeltas: pairedDeltas(records), decision: recommendation(records, summaries) }
  await writeJsonFile(paths(pipelineRoot, 'high').reportPath, report); return { preflight, report }
}

export async function launchKimiHighVsMaxScreen(argv = process.argv.slice(2), options = {}) { const preflight = await buildHighVsMaxPreflight(options); if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, baselines: undefined, prompt: undefined } }; return { executionAuthorized: true, ...(await runKimiHighVsMaxScreen(options)) } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchKimiHighVsMaxScreen().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
