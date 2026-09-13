import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createKimiProvider, KIMI_PROVIDER_ID } from '../adapters/kimiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { semanticCacheKeyFor } from './runSemanticBatch.mjs'
import { sanitizeMalformedDiagnostics } from './runKimiK28HighOneFilmDiagnostic.mjs'
import { providerFailureDetails } from './runKimiK28HighSemanticSmoke.mjs'

export const DIAGNOSTIC_ID = 'kimi-k28-high-json-schema-one-film-diagnostic-v1'
export const AUTHORIZATION_FLAG = '--execute-authorized-kimi-json-schema-diagnostic'
export const CANDIDATE = Object.freeze({ candidateId: 'little-miss-sunshine', evidencePacketHash: 'sha256:0cd97dc6dc0f32c5f2d2c530a955efea847a813d3a81b4935fee25c0de42b544' })
const MODEL_ID = 'kimi-for-coding'
const REASONING_EFFORT = 'high'
const OUTPUT_MODE = 'json_schema'
const SCHEMA_VERSION = 'semantic-output.v2'
const REQUEST_BUDGET = 1
const PACKET_ROOT = 'generated/semantic/diagnostics/phase-5c0-generalization/evidencePackets'

export class KimiJsonSchemaDiagnosticError extends Error {
  constructor(message, { code = 'KIMI_JSON_SCHEMA_DIAGNOSTIC_ERROR' } = {}) { super(message); this.name = 'KimiJsonSchemaDiagnosticError'; this.code = code }
}

async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
}

function paths(pipelineRoot) {
  const root = resolve(pipelineRoot, 'generated/semantic/diagnostics', DIAGNOSTIC_ID)
  return { root, reportPath: resolve(root, 'report.json'), cacheRoot: resolve(pipelineRoot, 'cache/semantic/diagnostics', DIAGNOSTIC_ID) }
}

function boundedUsage(value) {
  const source = value && typeof value === 'object' ? value : {}; const result = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'thinking_tokens', 'total_tokens']) if (typeof source[key] === 'number') result[key] = source[key]
  return result
}

function createProvider({ env, fetchImpl }) {
  return createKimiProvider({ modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, env, fetchImpl })
}

export async function buildDiagnosticPreflight({ pipelineRoot = resolve('catalogue-pipeline'), fileExists = exists, readJsonFile = readJson, readTextFile = readFile } = {}) {
  const packet = await readJsonFile(resolve(pipelineRoot, PACKET_ROOT, `${CANDIDATE.candidateId}.json`))
  if (packet.candidateId !== CANDIDATE.candidateId || packet.inputHash !== CANDIDATE.evidencePacketHash) throw new KimiJsonSchemaDiagnosticError('Diagnostic evidence identity mismatch.', { code: 'EVIDENCE_IDENTITY_MISMATCH' })
  const prompt = await readTextFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v3.md'), 'utf8')
  const provider = createProvider({ env: { KIMI_API_KEY: 'preflight-only-placeholder' }, fetchImpl: async () => { throw new Error('Preflight must not dispatch HTTP.') } })
  const runtimePaths = paths(pipelineRoot); const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion: 'semantic-classifier.v3', schemaVersion: SCHEMA_VERSION })
  return {
    diagnosticId: DIAGNOSTIC_ID, candidate: CANDIDATE, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT,
    outputMode: OUTPUT_MODE, outputAffectingConfiguration: provider.metadata.outputAffectingConfiguration,
    promptVersion: 'semantic-classifier.v3', promptContentHash: `sha256:${stableHash(prompt)}`, schemaVersion: SCHEMA_VERSION,
    requestBudget: REQUEST_BUDGET, maxAttempts: 1, concurrency: 1, cacheKey,
    cacheHit: await fileExists(resolve(runtimePaths.cacheRoot, `${cacheKey}.json`)), packet, prompt, paths: runtimePaths,
  }
}

export async function runKimiJsonSchemaDiagnostic({ pipelineRoot = resolve('catalogue-pipeline'), env = process.env, fetchImpl = globalThis.fetch, readJsonFile = readJson, readTextFile = readFile, writeJsonFile = writeJson, fileExists = exists } = {}) {
  if (!env.KIMI_API_KEY) throw new KimiJsonSchemaDiagnosticError('KIMI_API_KEY is required.', { code: 'MISSING_KIMI_API_KEY' })
  const preflight = await buildDiagnosticPreflight({ pipelineRoot, fileExists, readJsonFile, readTextFile })
  if (preflight.cacheHit) throw new KimiJsonSchemaDiagnosticError('Diagnostic cache entry already exists and requires inspection.', { code: 'UNEXPECTED_DIAGNOSTIC_CACHE' })
  let httpRequests = 0
  const countedFetch = async (...args) => {
    if (httpRequests >= REQUEST_BUDGET) throw new KimiJsonSchemaDiagnosticError('Diagnostic request budget exhausted.', { code: 'REQUEST_BUDGET_EXHAUSTED' })
    httpRequests += 1
    return fetchImpl(...args)
  }
  const provider = createProvider({ env, fetchImpl: countedFetch }); let record
  try {
    const result = await classifySemanticCandidate({ evidencePacket: preflight.packet, provider, prompt: preflight.prompt, promptVersion: preflight.promptVersion, schemaVersion: SCHEMA_VERSION, cacheRoot: preflight.paths.cacheRoot, outputPath: resolve(preflight.paths.root, `${CANDIDATE.candidateId}.json`), maxAttempts: 1 })
    record = { status: 'VALID', semanticValidatorSuccess: true, providerRequests: httpRequests, attempts: result.modelCalls, artifactHash: result.artifact.outputHash, finishReason: result.providerResponseDiagnostics?.finishReason ?? null, usage: boundedUsage(result.providerUsageMetadata) }
  } catch (error) {
    const malformed = error?.code === 'MALFORMED_MODEL_OUTPUT'
    record = malformed
      ? { status: 'SEMANTIC_REJECTION', semanticValidatorSuccess: false, providerRequests: httpRequests, attempts: httpRequests, errorCode: error.code, diagnostics: sanitizeMalformedDiagnostics(error.details ?? {}) }
      : { status: 'PROVIDER_REJECTION', semanticValidatorSuccess: false, providerRequests: httpRequests, attempts: httpRequests, providerFailure: providerFailureDetails(error) }
  }
  const report = { schemaVersion: 'kimi-json-schema-diagnostic.v1', diagnosticId: DIAGNOSTIC_ID, candidate: CANDIDATE, providerId: KIMI_PROVIDER_ID, modelId: MODEL_ID, reasoningEffort: REASONING_EFFORT, outputMode: OUTPUT_MODE, semanticOutputSchemaVersion: SCHEMA_VERSION, semanticOutputSchemaHash: preflight.outputAffectingConfiguration.semanticOutputSchemaHash, promptVersion: preflight.promptVersion, promptContentHash: preflight.promptContentHash, requestBudget: REQUEST_BUDGET, maxAttempts: 1, concurrency: 1, httpRequests, record }
  await writeJsonFile(preflight.paths.reportPath, report)
  return { preflight, report }
}

export async function launchKimiJsonSchemaDiagnostic(argv = process.argv.slice(2), options = {}) {
  const preflight = await buildDiagnosticPreflight(options)
  if (!argv.includes(AUTHORIZATION_FLAG)) return { executionAuthorized: false, preflight: { ...preflight, packet: undefined, prompt: undefined, paths: undefined } }
  return { executionAuthorized: true, ...(await runKimiJsonSchemaDiagnostic(options)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launchKimiJsonSchemaDiagnostic().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
