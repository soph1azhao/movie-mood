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

export const SMOKE_ID = 'kimi-k28-high-json-schema-3-film-smoke-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-json-schema-smoke'
export const SCHEMA_HASH = 'sha256:8876dfaa86d325d3eb6b2545af31b762bfc60584fc8fab9d0d5be76f12396d20'
export const REQUEST_BUDGET = 6
export const MAX_ATTEMPTS_PER_CANDIDATE = 2
export const CANDIDATES = Object.freeze([
  { candidateId: 'crouching-tiger', evidencePacketHash: 'sha256:43ba98a0e20c0097fa7977672bd3b5d07f68eed62e25ae00600ba906d6126ffe' },
  { candidateId: 'get-out', evidencePacketHash: 'sha256:478c8da46147da7369491f04f3507d515472d7c87dff1d764984606027909ba8' },
  { candidateId: 'little-miss-sunshine', evidencePacketHash: 'sha256:0cd97dc6dc0f32c5f2d2c530a955efea847a813d3a81b4935fee25c0de42b544' },
])

const MODEL_ID = 'kimi-for-coding'; const REASONING_EFFORT = 'high'; const OUTPUT_MODE = 'json_schema'; const SCHEMA_VERSION = 'semantic-output.v2'; const PROMPT_VERSION = 'semantic-classifier.v3'
const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'
const BASELINE_ROOT = 'generated/semantic/batches/v8-1-semantic-pilot-001'

export class KimiJsonSchemaSmokeError extends Error {
  constructor(message, { code = 'KIMI_JSON_SCHEMA_SMOKE_ERROR' } = {}) { super(message); this.name = 'KimiJsonSchemaSmokeError'; this.code = code }
}

async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }
function paths(pipelineRoot) { const root = resolve(pipelineRoot, 'generated/semantic/smokes', SMOKE_ID); return { root, reportPath: resolve(root, 'report.json'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/smokes', SMOKE_ID) } }
function providerFor({ env, fetchImpl }) { return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaProjectionVersion: 'legacy-v1', env, fetchImpl }) }

function usage(value) {
  const source = value && typeof value === 'object' ? value : {}; const result = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens']) if (typeof source[key] === 'number') result[key] = source[key]
  return result
}

export function aggregateUsage(records) {
  const totals = { prompt_tokens: 0, completion_tokens: 0, thinking_tokens: 0, total_tokens: 0 }
  for (const record of records) for (const key of Object.keys(totals)) if (typeof record.usage?.[key] === 'number') totals[key] += record.usage[key]
  return totals
}

function baselineIdentity(prompt) {
  return {
    providerId: 'google-gemini-developer-api', modelId: 'gemini-3.6-flash', promptVersion: PROMPT_VERSION,
    promptContentHash: `sha256:${stableHash(prompt)}`, semanticSchemaVersion: SCHEMA_VERSION,
    taxonomyHash: `sha256:${stableHash(taxonomy)}`, calibrationAnchorsHash: `sha256:${stableHash(anchors)}`,
    boundaryCasesHash: `sha256:${stableHash(boundaryCases)}`,
  }
}

async function loadCompatibleBaselines({ pipelineRoot, prompt, readJsonFile }) {
  const reasons = []; const artifacts = new Map(); let manifest
  try { manifest = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, 'manifest.json')) } catch { return { compatible: false, reasons: ['BASELINE_MANIFEST_UNAVAILABLE'], artifacts } }
  for (const [field, expected] of Object.entries(baselineIdentity(prompt))) if (manifest[field] !== expected) reasons.push(`BASELINE_${field}_MISMATCH`)
  const manifestCandidates = new Map((manifest.candidates ?? []).map((candidate) => [candidate.candidateId, candidate]))
  for (const candidate of CANDIDATES) {
    if (manifestCandidates.get(candidate.candidateId)?.evidencePacketHash !== candidate.evidencePacketHash) { reasons.push(`BASELINE_EVIDENCE_MISMATCH:${candidate.candidateId}`); continue }
    try {
      const artifact = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, `${candidate.candidateId}.json`))
      if (artifact.movie?.candidateId !== candidate.candidateId || artifact.evidencePacketHash !== candidate.evidencePacketHash || artifact.promptVersion !== PROMPT_VERSION || artifact.schemaVersion !== SCHEMA_VERSION || artifact.modelProvider !== 'google-gemini-developer-api' || artifact.modelId !== 'gemini-3.6-flash' || typeof artifact.outputHash !== 'string') reasons.push(`BASELINE_ARTIFACT_IDENTITY_MISMATCH:${candidate.candidateId}`)
      else artifacts.set(candidate.candidateId, artifact)
    } catch { reasons.push(`BASELINE_ARTIFACT_UNAVAILABLE:${candidate.candidateId}`) }
  }
  return { compatible: reasons.length === 0 && artifacts.size === CANDIDATES.length, reasons, artifacts }
}

export async function buildSmokePreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')
  const provider = providerFor({ env: { KIMI_API_KEY: 'preflight-only-placeholder' }, fetchImpl: async () => { throw new Error('Preflight must not dispatch HTTP.') } })
  if (provider.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH) throw new KimiJsonSchemaSmokeError('Structured-output schema hash drift.', { code: 'SCHEMA_HASH_MISMATCH' })
  const runtimePaths = paths(pipelineRoot); const packets = []; const candidates = []
  for (const expected of CANDIDATES) {
    const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${expected.candidateId}.json`))
    if (packet.candidateId !== expected.candidateId || packet.inputHash !== expected.evidencePacketHash) throw new KimiJsonSchemaSmokeError(`Evidence identity mismatch for ${expected.candidateId}.`, { code: 'EVIDENCE_IDENTITY_MISMATCH' })
    packets.push(packet); const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION })
    candidates.push({ ...expected, cacheKey, cacheHit: await fileExists(resolve(runtimePaths.cacheRoot, `${cacheKey}.json`)) })
  }
  const baseline = await loadCompatibleBaselines({ pipelineRoot, prompt, readJsonFile })
  return { smokeId: SMOKE_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, outputAffectingConfiguration: provider.metadata.outputAffectingConfiguration, promptVersion: PROMPT_VERSION, promptContentHash: `sha256:${stableHash(prompt)}`, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: 1, candidates, cacheHits: candidates.filter((candidate) => candidate.cacheHit).length, baselineComparison: { compatible: baseline.compatible, reasons: baseline.reasons }, packets, baselines: baseline.artifacts, prompt, paths: runtimePaths }
}

export async function runKimiJsonSchemaSmoke({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY) throw new KimiJsonSchemaSmokeError('KIMI_API_KEY is required.', { code: 'MISSING_KIMI_API_KEY' })
  const preflight = await buildSmokePreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile })
  if (preflight.cacheHits !== 0) throw new KimiJsonSchemaSmokeError('Unexpected structured-output smoke cache entries require inspection.', { code: 'UNEXPECTED_SMOKE_CACHE' })
  let httpRequests = 0
  const countedFetch = async (...args) => { if (httpRequests >= REQUEST_BUDGET) throw new KimiJsonSchemaSmokeError('Smoke request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' }); httpRequests += 1; return fetchImpl(...args) }
  const provider = providerFor({ env, fetchImpl: countedFetch }); const records = []
  for (const packet of preflight.packets) {
    const started = now(); const before = httpRequests
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet, provider, prompt: preflight.prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot: preflight.paths.cacheRoot, outputPath: resolve(preflight.paths.root, `${packet.candidateId}.json`), maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE })
      const attempts = httpRequests - before; const baseline = preflight.baselines.get(packet.candidateId)
      records.push({ candidateId: packet.candidateId, status: 'COMPLETED', attempts, providerRequests: attempts, firstAttemptValidated: attempts === 1, retryRequired: attempts > 1, retryRecovered: attempts > 1, finishReason: result.providerResponseDiagnostics?.finishReason ?? null, latencyMs: now() - started, usage: usage(result.providerUsageMetadata), artifactHash: result.artifact.outputHash, comparison: preflight.baselineComparison.compatible && baseline ? compareSemanticArtifacts(result.artifact, baseline) : null })
    } catch (error) {
      const attempts = httpRequests - before; const malformed = error?.code === 'MALFORMED_MODEL_OUTPUT'; const diagnostics = malformed ? sanitizeMalformedDiagnostics(error.details ?? {}) : null
      records.push({ candidateId: packet.candidateId, status: 'FAILED', attempts, providerRequests: attempts, firstAttemptValidated: false, retryRequired: attempts > 1, retryRecovered: false, finishReason: diagnostics?.finishReason ?? null, latencyMs: now() - started, usage: diagnostics?.usage ?? {}, malformedDiagnostics: diagnostics, providerFailure: malformed ? null : providerFailureDetails(error), comparison: null })
    }
  }
  const completed = records.filter((record) => record.status === 'COMPLETED')
  const report = { schemaVersion: 'kimi-json-schema-smoke.v1', smokeId: SMOKE_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, promptVersion: PROMPT_VERSION, promptContentHash: preflight.promptContentHash, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: 1, baselineComparison: preflight.baselineComparison, records, counts: { completed: completed.length, failed: records.length - completed.length, firstAttemptValid: records.filter((record) => record.firstAttemptValidated).length, retryRecovered: records.filter((record) => record.retryRecovered).length, httpRequests }, usageTotals: aggregateUsage(records) }
  await writeJsonFile(preflight.paths.reportPath, report); return { preflight, report }
}

export async function launchKimiJsonSchemaSmoke(argv = process.argv.slice(2), options = {}) {
  const preflight = await buildSmokePreflight(options)
  if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, baselines: undefined, prompt: undefined, paths: undefined } }
  return { executionAuthorized: true, ...(await runKimiJsonSchemaSmoke(options)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchKimiJsonSchemaSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
