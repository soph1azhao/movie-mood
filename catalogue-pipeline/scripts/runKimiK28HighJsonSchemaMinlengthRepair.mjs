import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'
import { providerFailureDetails } from './runKimiK28HighSemanticSmoke.mjs'
import { sanitizeMalformedDiagnostics } from './runKimiK28HighOneFilmDiagnostic.mjs'

export const RUN_ID = 'kimi-k28-high-json-schema-minlength-repair-2-film-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-minlength-repair'
export const SCHEMA_HASH = 'sha256:a5bacc030ad25d46a01856f6e49d6d041809683e82d2469d23ac9eae412866fc'
export const REQUEST_BUDGET = 2
export const MAX_ATTEMPTS_PER_CANDIDATE = 1
export const CANDIDATES = Object.freeze([
  { candidateId: 'my-neighbor-totoro', evidencePacketHash: 'sha256:b453708138f01e636a4fc3fc9feb4293b612084c115e6345f158e9025882e69f' },
  { candidateId: 'spirited-away', evidencePacketHash: 'sha256:f6a646a429ec7157a4cd98943c1de3fa106a85fb921f477ab385188de225c978' },
])

const MODEL_ID = 'kimi-for-coding'; const PROMPT_VERSION = 'semantic-classifier.v3'; const SCHEMA_VERSION = 'semantic-output.v2'
const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'
const PILOT_MANIFEST = 'generated/semantic/batches/v8-1-semantic-pilot-001/manifest.json'

export class KimiMinlengthRepairError extends Error { constructor(message, { code = 'KIMI_MINLENGTH_REPAIR_ERROR' } = {}) { super(message); this.name = 'KimiMinlengthRepairError'; this.code = code } }
async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }
function runtimePaths(pipelineRoot) { const root = resolve(pipelineRoot, 'generated/semantic/diagnostics', RUN_ID); return { root, reportPath: resolve(root, 'report.json'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/diagnostics', RUN_ID) } }
function providerFor({ env, fetchImpl }) { return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaVersion: SCHEMA_VERSION, env, fetchImpl }) }
function usage(value) { const source = value && typeof value === 'object' ? value : {}; return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens'].filter((key) => typeof source[key] === 'number').map((key) => [key, source[key]])) }

export async function buildMinlengthRepairPreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8'); const paths = runtimePaths(pipelineRoot)
  const provider = providerFor({ env: { KIMI_API_KEY: 'preflight-only-placeholder' }, fetchImpl: async () => { throw new Error('Preflight must not dispatch HTTP.') } })
  if (provider.metadata.outputAffectingConfiguration.semanticOutputSchemaHash !== SCHEMA_HASH) throw new KimiMinlengthRepairError('Structured-output schema hash drift.', { code: 'SCHEMA_HASH_MISMATCH' })
  const pilot = await readJsonFile(resolve(pipelineRoot, PILOT_MANIFEST)); const pilotById = new Map((pilot.candidates ?? []).map((candidate) => [candidate.candidateId, candidate])); const packets = []; const candidates = []
  for (const expected of CANDIDATES) {
    const registered = pilotById.get(expected.candidateId); const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${expected.candidateId}.json`))
    if (registered?.evidencePacketHash !== expected.evidencePacketHash || packet?.candidateId !== expected.candidateId || packet?.inputHash !== expected.evidencePacketHash || packet?.tmdbId !== registered?.tmdbId) throw new KimiMinlengthRepairError(`Evidence identity mismatch for ${expected.candidateId}.`, { code: 'EVIDENCE_IDENTITY_MISMATCH' })
    packets.push(packet); const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION }); candidates.push({ ...expected, tmdbId: packet.tmdbId, cacheKey, cacheHit: await fileExists(resolve(paths.cacheRoot, `${cacheKey}.json`)) })
  }
  return { runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, outputAffectingConfiguration: provider.metadata.outputAffectingConfiguration, promptVersion: PROMPT_VERSION, requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: 1, candidates, packets, prompt, paths }
}

export async function runKimiMinlengthRepair({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY) throw new KimiMinlengthRepairError('KIMI_API_KEY is required.', { code: 'MISSING_KIMI_API_KEY' })
  const preflight = await buildMinlengthRepairPreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile }); let httpRequests = 0
  const provider = providerFor({ env, fetchImpl: async (...args) => { if (httpRequests >= REQUEST_BUDGET) throw new KimiMinlengthRepairError('Repair request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' }); httpRequests += 1; return fetchImpl(...args) } }); const records = []
  for (const packet of preflight.packets) {
    const before = httpRequests
    try {
      const result = await classifySemanticCandidate({ evidencePacket: packet, provider, prompt: preflight.prompt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, cacheRoot: preflight.paths.cacheRoot, outputPath: resolve(preflight.paths.root, `${packet.candidateId}.json`), maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE })
      records.push({ candidateId: packet.candidateId, status: 'VALID', cacheHit: result.cacheHit, attempts: httpRequests - before, providerRequests: httpRequests - before, finishReason: result.providerResponseDiagnostics?.finishReason ?? null, usage: usage(result.providerUsageMetadata), artifactHash: result.artifact.outputHash })
    } catch (error) {
      const malformed = error?.code === 'MALFORMED_MODEL_OUTPUT'; const diagnostics = malformed ? sanitizeMalformedDiagnostics(error.details ?? {}) : null
      records.push({ candidateId: packet.candidateId, status: 'FAILED', cacheHit: false, attempts: httpRequests - before, providerRequests: httpRequests - before, finishReason: diagnostics?.finishReason ?? null, usage: diagnostics?.usage ?? {}, malformedDiagnostics: diagnostics, providerFailure: malformed ? null : providerFailureDetails(error) })
    }
  }
  const report = { schemaVersion: 'kimi-json-schema-minlength-repair.v1', runId: RUN_ID, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: 'high', outputMode: 'json_schema', semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: SCHEMA_HASH, hypothesis: 'Projecting existing local-validator minLength constraints prevents the previously observed too-short evidence cues.', requestBudget: REQUEST_BUDGET, maxAttemptsPerCandidate: MAX_ATTEMPTS_PER_CANDIDATE, concurrency: 1, httpRequests, records, counts: { valid: records.filter((record) => record.status === 'VALID').length, failed: records.filter((record) => record.status === 'FAILED').length } }
  await writeJsonFile(preflight.paths.reportPath, report); return { preflight, report }
}

export async function launchKimiMinlengthRepair(argv = process.argv.slice(2), options = {}) { const preflight = await buildMinlengthRepairPreflight(options); if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packets: undefined, prompt: undefined, paths: undefined } }; return { executionAuthorized: true, ...(await runKimiMinlengthRepair(options)) } }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchKimiMinlengthRepair().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
