import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGeminiProvider } from '../adapters/geminiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'

export const SMOKE_ID = 'gemini-3.7-flash-3-film-smoke-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-gemini-37-smoke'
export const MODEL_ID = 'gemini-3.7-flash'
export const REQUEST_BUDGET = 3
export const CANDIDATES = Object.freeze([
  { candidateId: 'crouching-tiger', evidencePacketHash: 'sha256:43ba98a0e20c0097fa7977672bd3b5d07f68eed62e25ae00600ba906d6126ffe' },
  { candidateId: 'get-out', evidencePacketHash: 'sha256:478c8da46147da7369491f04f3507d515472d7c87dff1d764984606027909ba8' },
  { candidateId: 'little-miss-sunshine', evidencePacketHash: 'sha256:0cd97dc6dc0f32c5f2d2c530a955efea847a813d3a81b4935fee25c0de42b544' },
])

const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'
const BASELINE_ROOT = 'generated/semantic/batches/v8-1-semantic-pilot-001'

export class GeminiSmokeError extends Error {
  constructor(message, { code = 'GEMINI_SMOKE_ERROR', details = {} } = {}) { super(message); this.name = 'GeminiSmokeError'; this.code = code; this.details = details }
}

async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
}

function sameSet(first = [], second = []) {
  return first.length === second.length && new Set(first).size === new Set(second).size && first.every((value) => second.includes(value))
}

export function jaccard(first = [], second = []) {
  const a = new Set(first); const b = new Set(second); const union = new Set([...a, ...b])
  if (union.size === 0) return 1
  return [...a].filter((value) => b.has(value)).length / union.size
}

export function compareSemanticArtifacts(kimi, baseline) {
  const ordinalFields = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
  return {
    ordinalAgreement: Object.fromEntries(ordinalFields.map((field) => [field, { match: kimi.classification[field] === baseline.classification[field], candidate: kimi.classification[field], baseline: baseline.classification[field] }])),
    moods: { candidate: kimi.classification.moods, baseline: baseline.classification.moods, jaccard: jaccard(kimi.classification.moods, baseline.classification.moods) },
    situations: { candidate: kimi.classification.situations, baseline: baseline.classification.situations, jaccard: jaccard(kimi.classification.situations, baseline.classification.situations) },
    filterLanguages: { candidate: kimi.classification.filterLanguages, baseline: baseline.classification.filterLanguages, exactSetAgreement: sameSet(kimi.classification.filterLanguages, baseline.classification.filterLanguages) },
    boundaryFlags: { candidateCount: kimi.boundaryFlags?.length ?? 0, baselineCount: baseline.boundaryFlags?.length ?? 0, presenceAgreement: Boolean(kimi.boundaryFlags?.length) === Boolean(baseline.boundaryFlags?.length) },
  }
}

function paths(pipelineRoot) {
  const runRoot = resolve(pipelineRoot, 'generated/semantic/smokes', SMOKE_ID)
  return { runRoot, cacheRoot: resolve(pipelineRoot, 'cache/semantic/smokes', SMOKE_ID), reportPath: resolve(runRoot, 'report.json') }
}

export async function buildSmokePreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const promptVersion = 'semantic-classifier.v3'; const schemaVersion = 'semantic-output.v2'
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')
  const pilotManifest = await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, 'manifest.json'))
  const pilotById = new Map(pilotManifest.candidates.map((candidate) => [candidate.candidateId, candidate]))
  const packets = []; const baselines = new Map()
  for (const expected of CANDIDATES) {
    const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${expected.candidateId}.json`))
    const pilot = pilotById.get(expected.candidateId)
    if (packet.candidateId !== expected.candidateId || packet.inputHash !== expected.evidencePacketHash || pilot?.evidencePacketHash !== expected.evidencePacketHash) {
      throw new GeminiSmokeError(`Evidence identity mismatch for ${expected.candidateId}.`, { code: 'EVIDENCE_IDENTITY_MISMATCH' })
    }
    packets.push(packet)
    baselines.set(expected.candidateId, await readJsonFile(resolve(pipelineRoot, BASELINE_ROOT, `${expected.candidateId}.json`)))
  }
  if (packets.length !== 3 || new Set(packets.map((packet) => packet.candidateId)).size !== 3) throw new GeminiSmokeError('Smoke cohort must contain exactly three fixed candidates.', { code: 'COHORT_IDENTITY_MISMATCH' })
  const provider = { metadata: { providerId: 'google-gemini-developer-api', modelId: MODEL_ID } }
  const runtimePaths = paths(pipelineRoot)
  const candidates = []
  for (const packet of packets) {
    const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion, schemaVersion })
    candidates.push({ candidateId: packet.candidateId, evidencePacketHash: packet.inputHash, cacheKey, cacheHit: await fileExists(resolve(runtimePaths.cacheRoot, `${cacheKey}.json`)) })
  }
  return {
    smokeId: SMOKE_ID, providerId: provider.metadata.providerId, modelId: MODEL_ID, promptVersion,
    promptContentHash: `sha256:${stableHash(prompt)}`, schemaVersion, requestBudget: REQUEST_BUDGET,
    candidates, cacheHits: candidates.filter((candidate) => candidate.cacheHit).length,
    freshGenerationsRequired: candidates.filter((candidate) => !candidate.cacheHit).length,
    packets, baselines, prompt, paths: runtimePaths,
  }
}

function usageTotals(records) {
  const totals = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0, thoughtsTokenCount: 0, cachedContentTokenCount: 0 }
  const available = new Set()
  for (const record of records) for (const [key, value] of Object.entries(record.usage ?? {})) if (typeof value === 'number' && key in totals) { totals[key] += value; available.add(key) }
  return Object.fromEntries(Object.entries(totals).filter(([key]) => available.has(key)))
}

export async function runGemini37Smoke({
  pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch,
  now = () => Date.now(), readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists,
} = {}) {
  if (!env.GEMINI_API_KEY) throw new GeminiSmokeError('GEMINI_API_KEY is required.', { code: 'MISSING_GEMINI_API_KEY' })
  if (env.GEMINI_MODEL?.trim() !== MODEL_ID) throw new GeminiSmokeError(`GEMINI_MODEL must be ${MODEL_ID}.`, { code: 'MODEL_IDENTITY_MISMATCH' })
  const preflight = await buildSmokePreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile })
  if (preflight.cacheHits !== 0) throw new GeminiSmokeError('Unexpected Gemini 3.7 smoke cache entries require inspection.', { code: 'UNEXPECTED_SMOKE_CACHE' })
  let httpRequests = 0
  const countedFetch = async (...args) => {
    if (httpRequests >= REQUEST_BUDGET) throw new GeminiSmokeError('Gemini smoke HTTP request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' })
    httpRequests += 1
    return fetchImpl(...args)
  }
  const provider = createGeminiProvider({ modelId: MODEL_ID, env, fetchImpl: countedFetch })
  const records = []
  for (const packet of preflight.packets) {
    const startedAt = now()
    try {
      const result = await classifySemanticCandidate({
        evidencePacket: packet, provider, prompt: preflight.prompt, promptVersion: preflight.promptVersion,
        schemaVersion: preflight.schemaVersion, cacheRoot: preflight.paths.cacheRoot,
        outputPath: resolve(preflight.paths.runRoot, `${packet.candidateId}.json`), maxAttempts: 1,
      })
      records.push({ candidateId: packet.candidateId, status: 'COMPLETED', providerRequests: result.modelCalls, attempts: result.modelCalls, malformedOutputRetries: 0, transportRetries: 0, latencyMs: now() - startedAt, usage: result.providerUsageMetadata ?? null, artifactHash: result.artifact.outputHash, comparison: compareSemanticArtifacts(result.artifact, preflight.baselines.get(packet.candidateId)) })
    } catch (error) {
      records.push({ candidateId: packet.candidateId, status: 'FAILED', providerRequests: 1, attempts: 1, malformedOutputFailures: error?.code === 'MALFORMED_MODEL_OUTPUT' ? 1 : 0, providerFailure: error?.code === 'MALFORMED_MODEL_OUTPUT' ? null : { code: error?.code ?? 'UNKNOWN', retryable: Boolean(error?.retryable) }, latencyMs: now() - startedAt })
    }
  }
  const completed = records.filter((record) => record.status === 'COMPLETED')
  const report = {
    schemaVersion: 'gemini-semantic-smoke.v1', smokeId: SMOKE_ID, providerId: provider.metadata.providerId, modelId: MODEL_ID,
    promptVersion: preflight.promptVersion, promptContentHash: preflight.promptContentHash, schemaVersionOutput: preflight.schemaVersion,
    requestBudget: REQUEST_BUDGET, httpRequests, records,
    counts: { completed: completed.length, malformedOutputFailures: records.reduce((sum, record) => sum + (record.malformedOutputFailures ?? 0), 0), providerFailures: records.filter((record) => record.providerFailure).length, terminalFailures: records.filter((record) => record.status === 'FAILED').length },
    usageTotals: usageTotals(records),
    comparisonSummary: completed.length === 0 ? null : {
      ordinalAgreementCounts: Object.fromEntries(['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].map((field) => [field, completed.filter((record) => record.comparison.ordinalAgreement[field].match).length])),
      meanMoodJaccard: completed.reduce((sum, record) => sum + record.comparison.moods.jaccard, 0) / completed.length,
      meanSituationJaccard: completed.reduce((sum, record) => sum + record.comparison.situations.jaccard, 0) / completed.length,
      filterLanguageAgreementCount: completed.filter((record) => record.comparison.filterLanguages.exactSetAgreement).length,
      boundaryPresenceAgreementCount: completed.filter((record) => record.comparison.boundaryFlags.presenceAgreement).length,
    },
  }
  await writeJsonFile(preflight.paths.reportPath, report)
  return { preflight, report }
}

export async function launchGemini37Smoke(argv = process.argv.slice(2), options = {}) {
  const preflight = await buildSmokePreflight(options)
  if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, baselines: undefined, prompt: undefined, paths: undefined } }
  return { executionAuthorized: true, ...(await runGemini37Smoke(options)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchGemini37Smoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
