import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import { createModelCacheKey } from '../adapters/modelProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { classifySemanticCandidate } from './classifySemantic.mjs'

export const SEMANTIC_BATCH_SCHEMA_VERSION = 'semantic-batch-run.v1'
const STATES = new Set(['PENDING', 'CACHE_HIT', 'COMPLETED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE'])

export class SemanticBatchError extends Error {
  constructor(message, { code = 'SEMANTIC_BATCH_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'SemanticBatchError'
    this.code = code
    this.details = details
  }
}

async function exists(path) { try { await readFile(path); return true } catch { return false } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function atomicWriteJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  try { await writeFile(temp, text); await rename(temp, path) } catch (error) { await rm(temp, { force: true }); throw error }
}

function safeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) throw new SemanticBatchError('Batch runId contains unsupported characters.', { code: 'INVALID_RUN_ID' })
  return value
}

export function createCandidateManifest(evidencePackets) {
  if (!Array.isArray(evidencePackets) || evidencePackets.length === 0) throw new SemanticBatchError('A batch requires at least one evidence packet.', { code: 'EMPTY_CANDIDATE_MANIFEST' })
  const candidates = evidencePackets.map((packet) => {
    if (!packet?.candidateId || !Number.isInteger(packet.tmdbId) || !packet.inputHash) throw new SemanticBatchError('Candidate evidence packet lacks identity or input hash.', { code: 'INVALID_EVIDENCE_PACKET' })
    return { candidateId: packet.candidateId, tmdbId: packet.tmdbId, evidencePacketHash: packet.inputHash }
  })
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) throw new SemanticBatchError('Candidate manifest contains duplicate candidate IDs.', { code: 'DUPLICATE_CANDIDATE_ID' })
  return { candidates, candidateManifestHash: `sha256:${stableHash(candidates)}` }
}

export function semanticCacheKeyFor({ packet, provider, promptVersion, schemaVersion, calibrationAnchors = anchors, calibrationBoundaryCases = boundaryCases }) {
  return createModelCacheKey({
    stage: 'semantic-classifier', tmdbId: packet.tmdbId, factsHash: packet.inputHash, schemaVersion, promptVersion,
    taxonomyVersion: taxonomy.taxonomyVersion, calibrationHash: stableHash({ calibrationAnchors, calibrationBoundaryCases }),
    providerId: provider.metadata.providerId, modelId: provider.metadata.modelId, providerConfiguration: provider.metadata.outputAffectingConfiguration,
  })
}

function counts(states) {
  const result = { pending: 0, cacheHit: 0, completed: 0, failedRetryable: 0, failedTerminal: 0 }
  for (const state of Object.values(states)) {
    if (state.status === 'PENDING') result.pending += 1
    if (state.status === 'CACHE_HIT') result.cacheHit += 1
    if (state.status === 'COMPLETED') result.completed += 1
    if (state.status === 'RETRYABLE_FAILURE') result.failedRetryable += 1
    if (state.status === 'TERMINAL_FAILURE') result.failedTerminal += 1
  }
  return result
}

function manifestIdentity({ provider, prompt, promptVersion, schemaVersion, candidateManifestHash, calibrationAnchors = anchors, calibrationBoundaryCases = boundaryCases }) {
  return {
    providerId: provider.metadata.providerId, modelId: provider.metadata.modelId, promptVersion, semanticSchemaVersion: schemaVersion, candidateManifestHash,
    promptContentHash: `sha256:${stableHash(prompt)}`, taxonomyHash: `sha256:${stableHash(taxonomy)}`,
    calibrationAnchorsHash: `sha256:${stableHash(calibrationAnchors)}`, boundaryCasesHash: `sha256:${stableHash(calibrationBoundaryCases)}`,
    providerConfigurationHash: provider.metadata.outputAffectingConfiguration ? `sha256:${stableHash(provider.metadata.outputAffectingConfiguration)}` : null,
  }
}

function assertResumeIdentity(manifest, identity) {
  for (const [key, value] of Object.entries(identity)) if (manifest[key] !== value) throw new SemanticBatchError(`Batch resume identity mismatch: ${key}.`, { code: 'BATCH_IDENTITY_MISMATCH', details: { key, expected: manifest[key], actual: value } })
}

function normalizedFailure(error) {
  const code = error?.code ?? 'UNKNOWN_BATCH_FAILURE'
  return { code, retryable: code === 'MODEL_RETRY_LIMIT' || Boolean(error?.retryable) }
}

function validCache(artifact, { packet, cacheKey, provider, prompt, calibrationAnchors = anchors, calibrationBoundaryCases = boundaryCases }) {
  const expectedInputHash = `sha256:${stableHash({ evidencePacketHash: packet.inputHash, promptHash: stableHash(prompt), taxonomyHash: stableHash(taxonomy), anchorsHash: stableHash(calibrationAnchors), boundaryCasesHash: stableHash(calibrationBoundaryCases) })}`
  return artifact?.cacheKey === cacheKey && artifact?.inputHash === expectedInputHash && artifact?.evidencePacketHash === packet.inputHash && artifact?.movie?.candidateId === packet.candidateId && artifact?.modelProvider === provider.metadata.providerId && artifact?.modelId === provider.metadata.modelId && typeof artifact?.outputHash === 'string'
}

function usageSummary(states) {
  const usage = { inputTokens: null, outputTokens: null, thinkingTokens: null, cachedTokens: null, successfulModelRequests: 0, retries: 0 }
  for (const state of Object.values(states)) {
    if (!['COMPLETED', 'CACHE_HIT'].includes(state.status)) continue
    usage.successfulModelRequests += state.attempts ?? 0
    usage.retries += Math.max(0, (state.attempts ?? 0) - 1)
    const metadata = state.providerUsageMetadata
    const fields = [['inputTokens', ['promptTokenCount', 'prompt_tokens']], ['outputTokens', ['candidatesTokenCount', 'completion_tokens']], ['thinkingTokens', ['thoughtsTokenCount', 'thinking_tokens']], ['cachedTokens', ['cachedContentTokenCount', 'cached_tokens']]]
    for (const [target, sources] of fields) for (const source of sources) if (typeof metadata?.[source] === 'number') { usage[target] = (usage[target] ?? 0) + metadata[source]; break }
  }
  return usage
}

export async function runSemanticBatch({
  runId, evidencePackets, provider, prompt, promptVersion, schemaVersion, cacheRoot, outputRoot, runRoot,
  dryRun = false, maxFreshCalls = Infinity, createdAt = new Date().toISOString(), classifyCandidate = classifySemanticCandidate,
  readJsonFile = readJson, writeJsonFile = atomicWriteJson, fileExists = exists,
}) {
  safeId(runId)
  if (!provider?.metadata?.providerId || !provider?.metadata?.modelId) throw new SemanticBatchError('Batch requires explicit provider and model identity.', { code: 'MISSING_PROVIDER_IDENTITY' })
  if (!Number.isInteger(maxFreshCalls) && maxFreshCalls !== Infinity) throw new SemanticBatchError('maxFreshCalls must be a nonnegative integer.', { code: 'INVALID_MAX_FRESH_CALLS' })
  const { candidates, candidateManifestHash } = createCandidateManifest(evidencePackets)
  const packetById = new Map(evidencePackets.map((packet) => [packet.candidateId, packet]))
  const identity = manifestIdentity({ provider, prompt, promptVersion, schemaVersion, candidateManifestHash })
  const manifestPath = resolve(runRoot, safeId(runId), 'manifest.json')
  let manifest
  if (await fileExists(manifestPath)) {
    manifest = await readJsonFile(manifestPath)
    assertResumeIdentity(manifest, identity)
    if (!dryRun && manifest.status !== 'STOPPED_TERMINAL_FAILURE') manifest.status = 'RUNNING'
  } else {
    manifest = { schemaVersion: SEMANTIC_BATCH_SCHEMA_VERSION, runId, ...identity, candidateCount: candidates.length, candidates, createdAt, status: 'RUNNING', states: Object.fromEntries(candidates.map((candidate) => [candidate.candidateId, { ...candidate, status: 'PENDING' }])) }
  }
  if (manifest.schemaVersion !== SEMANTIC_BATCH_SCHEMA_VERSION) throw new SemanticBatchError('Unsupported semantic batch manifest.', { code: 'INVALID_BATCH_MANIFEST' })

  let freshCalls = 0
  let staleCacheCount = 0
  for (const candidate of candidates) {
    const packet = packetById.get(candidate.candidateId)
    const state = manifest.states[candidate.candidateId]
    if (!state || !STATES.has(state.status)) throw new SemanticBatchError('Batch state is invalid.', { code: 'INVALID_BATCH_STATE' })
    if (state.status === 'CACHE_HIT' || state.status === 'COMPLETED' || state.status === 'TERMINAL_FAILURE') continue
    const cacheKey = semanticCacheKeyFor({ packet, provider, promptVersion, schemaVersion })
    const cachePath = resolve(cacheRoot, `${cacheKey}.json`)
    let cached = null
    if (await fileExists(cachePath)) { try { cached = await readJsonFile(cachePath) } catch {} }
    if (cached && validCache(cached, { packet, cacheKey, provider, prompt })) {
      manifest.states[candidate.candidateId] = { ...candidate, status: 'CACHE_HIT', cacheKey, artifactPath: cachePath, artifactHash: cached.outputHash, attempts: 0, providerUsageMetadata: cached.providerMetadata?.providerUsageMetadata ?? null }
      if (!dryRun) { manifest.counts = counts(manifest.states); await writeJsonFile(manifestPath, manifest) }
      continue
    }
    if (cached) staleCacheCount += 1
    if (dryRun) continue
    if (freshCalls >= maxFreshCalls) { manifest.status = 'BUDGET_EXHAUSTED'; manifest.counts = counts(manifest.states); manifest.usage = usageSummary(manifest.states); await writeJsonFile(manifestPath, manifest); break }
    try {
      const remaining = maxFreshCalls - freshCalls
      const result = await classifyCandidate({ evidencePacket: packet, provider, prompt, promptVersion, schemaVersion, cacheRoot, outputPath: resolve(outputRoot, `${packet.candidateId}.json`), maxAttempts: Math.min(2, remaining) })
      freshCalls += result.modelCalls
      manifest.states[candidate.candidateId] = { ...candidate, status: result.cacheHit ? 'CACHE_HIT' : 'COMPLETED', cacheKey: result.cacheKey, artifactPath: result.outputPath, artifactHash: result.artifact.outputHash, attempts: result.modelCalls, providerUsageMetadata: result.providerUsageMetadata ?? null }
      manifest.counts = counts(manifest.states); await writeJsonFile(manifestPath, manifest)
    } catch (error) {
      const failure = normalizedFailure(error)
      manifest.states[candidate.candidateId] = { ...candidate, status: failure.retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE', cacheKey, attempts: error?.details?.attempts ?? null, failureCode: failure.code }
      manifest.status = failure.retryable ? 'STOPPED_RETRYABLE_FAILURE' : 'STOPPED_TERMINAL_FAILURE'
      manifest.counts = counts(manifest.states); await writeJsonFile(manifestPath, manifest)
      break
    }
  }
  if (dryRun) {
    const cacheHits = candidates.filter((candidate) => {
      const packet = packetById.get(candidate.candidateId)
      return manifest.states[candidate.candidateId]?.status === 'CACHE_HIT' || false
    }).length
    const inspected = await Promise.all(candidates.map(async (candidate) => {
      const packet = packetById.get(candidate.candidateId); const key = semanticCacheKeyFor({ packet, provider, promptVersion, schemaVersion }); const path = resolve(cacheRoot, `${key}.json`)
      if (!await fileExists(path)) return 'fresh'; try { return validCache(await readJsonFile(path), { packet, cacheKey: key, provider, prompt }) ? 'hit' : 'stale' } catch { return 'stale' }
    }))
    return { dryRun: true, runId, ...identity, candidateCount: candidates.length, cacheHits: inspected.filter((v) => v === 'hit').length, freshGenerationCount: inspected.filter((v) => v === 'fresh').length, staleCacheCount: inspected.filter((v) => v === 'stale').length, projectedFreshRequestCount: inspected.filter((v) => v !== 'hit').length }
  }
  manifest.counts = counts(manifest.states)
  if (!manifest.status || manifest.status === 'RUNNING') manifest.status = manifest.counts.pending === 0 ? 'COMPLETED' : 'RUNNING'
  await writeJsonFile(manifestPath, manifest)
  manifest.usage = usageSummary(manifest.states)
  await writeJsonFile(manifestPath, manifest)
  const usage = manifest.usage
  return { manifest, manifestPath, usage, staleCacheCount }
}

async function discoverLargestEvidenceSet(root) {
  const groups = new Map()
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile() && path.endsWith('evidencePackets') && entry.name.endsWith('.json')) {
        const list = groups.get(path) ?? []; list.push(child); groups.set(path, list)
      }
    }
  }
  await walk(root)
  const [, paths] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? []
  if (!paths) throw new SemanticBatchError('No local evidence-packet set was found.', { code: 'NO_EVIDENCE_PACKETS' })
  return Promise.all(paths.sort().map(readJson))
}

async function main() {
  const [command = 'dry-run', runId = 'local-batch'] = process.argv.slice(2)
  if (command !== 'dry-run') throw new SemanticBatchError('Only offline dry-run is available without an explicit production invocation.', { code: 'UNSUPPORTED_BATCH_COMMAND' })
  const root = resolve('catalogue-pipeline')
  const packets = await discoverLargestEvidenceSet(resolve(root, 'generated/semantic'))
  const promptVersion = 'semantic-classifier.v3'
  const schemaVersion = 'semantic-output.v2'
  const modelId = process.env.GEMINI_MODEL?.trim() || 'gemini-3.7-flash'
  const provider = { metadata: { providerId: 'google-gemini-developer-api', modelId } }
  const prompt = await readFile(resolve(root, 'prompts/semantic-classifier.v3.md'), 'utf8')
  console.log(JSON.stringify(await runSemanticBatch({ runId, evidencePackets: packets, provider, prompt, promptVersion, schemaVersion, cacheRoot: resolve(root, 'cache/semantic'), outputRoot: resolve(root, 'generated/semantic/batches', runId), runRoot: resolve(root, 'generated/semantic/batches'), dryRun: true }), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
