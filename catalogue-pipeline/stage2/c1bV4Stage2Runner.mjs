import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fetchWikipediaReceptionEvidenceV2 } from '../adapters/wikipediaDescriptiveEvidenceV2.mjs'
import { acquireRunLock, atomicWriteArtifact, canonicalSha256, canonicalize, classifyAttempt, executeRequest, recoverWal, verifyContractsBundle } from '../scripts/c1bV2Stage0.mjs'

export const V4_STAGE2_PROTOCOL_ID = 'phase-5c-c1b-v-confirmatory.v4'
export const V4_STAGE2_RUNNER_VERSION = 'c1b-v4-stage2-runner.v1'
export const V4_STAGE2_AUTHORIZATION = '--execute-authorized-v4-stage2'
export const V4_STAGE2_BLOCKED = 'BLOCKED — COVERAGE EXECUTION INCOMPLETE'
export const V4_STAGE2_PRELIVE_FAILED = 'BLOCKED — V4 PRE-LIVE EXECUTABLE CLOSURE GATE FAILED'
export const V4_STAGE2_ROOT = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v4/stage2-wikipedia-viability-live-v1'
export const V4_IMPLEMENTATION_COMMIT = '0308ca0b2fb8c54315384d41da8871edcd2e0a84'
export const V4_REGISTRATION_COMMIT = '8b7e4875eb9ca8c6a4958b17b35735b85aa24f63'

const EXPECTED = Object.freeze({
  protocol: 'sha256:2802d515ae329bbb933731816e6b016fcd0296168965abdc8b4f13a0b102da02',
  bundle: 'sha256:6ea56d5209c0835959f846998cd8ca5d4bff94ec646dfdb10aab930859b42e98',
  closure: 'sha256:20e321c5ae662a182f688e8de28f147134705394b4256744fe9dad7b2e95194e',
  registry: 'sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f',
  stage1Closure: 'sha256:d7ebf19f03486da8faa3d907924fab4c10176d3c5150c9cba8273497bd5a348c',
})
const PATHS = Object.freeze({
  protocol: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.json',
  bundle: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.contracts.json',
  closure: 'catalogue-pipeline/calibration/diagnostics/wikipedia-executable-closure.v1.json',
  registry: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/candidate-registry.json',
  stage1Closure: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-stage1-closure.v1.json',
})
const REGISTERED_V4_FILES = Object.freeze([
  PATHS.protocol,
  PATHS.bundle,
  PATHS.closure,
  'catalogue-pipeline/calibration/diagnostics/c1b-v4-triage-exposure-audit.v1.json',
  'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.acceptance-tests.md',
  'tests/fixtures/wikipedia/provenance.json',
])
const SUBSTANTIVE_FAILURES = new Set(['IDENTITY_UNRESOLVED', 'NO_MATCHING_SECTION', 'NO_QUALIFYING_PROSE', 'PROHIBITED_CONTENT_ONLY'])

export class V4Stage2Error extends Error {
  constructor(message, code = 'V4_STAGE2_ERROR', details) { super(message); this.name = 'V4Stage2Error'; this.code = code; this.details = details }
}
const fail = (message, code, details) => { throw new V4Stage2Error(message, code, details) }
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
// The registered raw hash preserves the exact V4-era lockfile. For later repository
// maintenance, importer `specifier` text is not part of the resolved dependency
// graph: pnpm records the selected versions, integrity and dependency edges
// elsewhere in the lockfile. Excluding only those lines lets an equivalent range
// replace `latest` without making the historical V4 environment unreproducible.
export const lockfileResolutionIdentity = (bytes) => rawSha256(Buffer.from(Buffer.from(bytes).toString('utf8').replace(/^[ \t]+specifier:[^\r\n]*(?:\r?\n|$)/gmu, ''), 'utf8'))
const exists = async (path) => { try { await readFile(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const gitFile = (root, commit, path) => execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })

export function stage2Paths(root = process.cwd(), artifactDir = resolve(root, V4_STAGE2_ROOT)) {
  return {
    root: artifactDir, lock: resolve(artifactDir, 'RUN_LOCK'), wal: resolve(artifactDir, 'execution.wal'),
    cache: resolve(artifactDir, 'response-cache'), adapterCache: resolve(artifactDir, 'adapter-cache'),
    exposure: resolve(artifactDir, 'exposure-metadata.json'), candidates: resolve(artifactDir, 'candidate-status.json'),
    privateEvidence: resolve(artifactDir, 'private-evidence.json'), metadata: resolve(artifactDir, 'run-metadata.json'),
    coverage: resolve(artifactDir, 'coverage-result.json'),
  }
}

async function atomicReplace(path, value) {
  const tempPath = `${path}.tmp`
  if (await exists(tempPath)) fail(`Stale atomic-write temp file: ${tempPath}`, 'STALE_TEMP_FILE')
  await atomicWriteArtifact(path, value, { tempPath })
}

export function projectFrozenCandidates(registry) {
  if (!Array.isArray(registry?.candidates) || registry.candidates.length !== 180) fail('Candidate registry must contain exactly 180 candidates.', 'CANDIDATE_COUNT_MISMATCH')
  const ids = registry.candidates.map(({ id }) => id)
  if (new Set(ids.map(String)).size !== 180) fail('Candidate registry contains duplicate IDs.', 'DUPLICATE_CANDIDATE')
  return registry.candidates.map((candidate) => {
    const year = Number(String(candidate.release_date ?? '').slice(0, 4))
    if (!Number.isInteger(candidate.id) || !candidate.title || !Number.isInteger(year)) fail('Candidate lacks required frozen facts.', 'INVALID_CANDIDATE_FACTS', candidate.id)
    return { candidateId: `tmdb:${candidate.id}`, tmdbId: candidate.id, title: candidate.title, year, director: candidate.director ?? undefined, frozenFacts: candidate }
  })
}

export async function verifyV4Stage2Jit({ root = process.cwd(), paths = stage2Paths(root), onEvent = () => {} } = {}) {
  for (const path of REGISTERED_V4_FILES) {
    const current = await readFile(resolve(root, path)); const registered = gitFile(root, V4_REGISTRATION_COMMIT, path)
    if (!current.equals(registered)) fail(`Registered V4 artifact mismatch: ${path}`, 'REGISTERED_V4_ARTIFACT_MISMATCH')
  }
  const protocolBytes = await readFile(resolve(root, PATHS.protocol)); const protocol = JSON.parse(protocolBytes)
  const bundle = await readJson(resolve(root, PATHS.bundle)); const closure = await readJson(resolve(root, PATHS.closure))
  if (canonicalSha256(protocol) !== EXPECTED.protocol) fail('Registered V4 protocol hash mismatch.', 'PROTOCOL_HASH_MISMATCH')
  const verifierProtocol = structuredClone(protocol)
  verifierProtocol.contractBundle.requiredContracts = bundle.orderedContractManifest
  verifyContractsBundle(verifierProtocol, bundle)
  const requiredPairs = bundle.orderedContractManifest.map(({ id, contentHash }) => ({ id, contentHash }))
  if (canonicalize(protocol.contractBundle.requiredContracts) !== canonicalize(requiredPairs)) fail('Registered V4 protocol contract references mismatch.', 'CONTRACT_BUNDLE_MISMATCH')
  if (bundle.contractsBundleHash !== EXPECTED.bundle) fail('Registered V4 contract bundle mismatch.', 'CONTRACT_BUNDLE_MISMATCH')
  if (canonicalSha256(closure) !== EXPECTED.closure) fail('Executable closure manifest mismatch.', 'CLOSURE_HASH_MISMATCH')
  if (closure.frozenImplementationCommit !== V4_IMPLEMENTATION_COMMIT || closure.materialLocalSources.length !== 6) fail('Executable closure identity mismatch.', 'CLOSURE_IDENTITY_MISMATCH')
  for (const source of closure.materialLocalSources) {
    const current = await readFile(resolve(root, source.path)); const frozen = gitFile(root, V4_IMPLEMENTATION_COMMIT, source.path)
    if (rawSha256(current) !== source.rawSha256 || rawSha256(frozen) !== source.rawSha256) fail(`Frozen semantic source mismatch: ${source.path}`, 'SOURCE_HASH_MISMATCH')
  }
  for (const lockfile of closure.dependencyLockfiles) {
    const current = await readFile(resolve(root, lockfile.path)); const frozen = gitFile(root, V4_IMPLEMENTATION_COMMIT, lockfile.path)
    if (rawSha256(frozen) !== lockfile.rawSha256) fail(`Frozen lockfile mismatch: ${lockfile.path}`, 'LOCKFILE_HASH_MISMATCH')
    if (lockfileResolutionIdentity(current) !== lockfileResolutionIdentity(frozen)) fail(`Frozen lockfile resolution mismatch: ${lockfile.path}`, 'LOCKFILE_HASH_MISMATCH')
  }
  const requiredMajor = Number(/^>=(\d+)\.0\.0$/u.exec(closure.nodeEngine)?.[1])
  if (!Number.isInteger(requiredMajor) || Number(process.versions.node.split('.')[0]) < requiredMajor) fail('Node engine is incompatible.', 'NODE_ENGINE_MISMATCH')
  const stage1Closure = await readFile(resolve(root, PATHS.stage1Closure))
  if (rawSha256(stage1Closure) !== EXPECTED.stage1Closure) fail('V3 Stage-1 closure hash mismatch.', 'STAGE1_CLOSURE_HASH_MISMATCH')
  const registryBytes = await readFile(resolve(root, PATHS.registry));
  if (rawSha256(registryBytes) !== EXPECTED.registry) fail('Imported candidate registry hash mismatch.', 'REGISTRY_HASH_MISMATCH')
  const registry = JSON.parse(registryBytes); const candidates = projectFrozenCandidates(registry)
  const recovered = await recoverWal(paths.wal)
  if (recovered.status === 'WAL_CORRUPTION' || recovered.status === 'TORN_TRAILING_RECORD') fail('Stage-2 WAL is not valid.', 'WAL_INVALID')
  for (const record of recovered.records) if (classifyAttempt(recovered.records, record.attemptId).status === 'UNKNOWN_IN_FLIGHT') fail('Stage-2 WAL contains UNKNOWN_IN_FLIGHT.', 'UNKNOWN_IN_FLIGHT')
  onEvent({ type: 'jit-complete' })
  return { protocol, bundle, closure, candidates, recovered }
}

async function persistBody(cacheDir, body) {
  const hash = rawSha256(Buffer.from(body, 'utf8')); const file = `${hash.slice(7)}.json`; const path = resolve(cacheDir, file)
  await mkdir(cacheDir, { recursive: true })
  if (await exists(path)) {
    if (rawSha256(await readFile(path)) !== hash) fail('Response-cache hash mismatch.', 'RESPONSE_CACHE_HASH_MISMATCH')
  } else await atomicWriteArtifact(path, body)
  return { bodyFile: file, bodySha256: hash }
}

async function verifyResponseReference(cacheDir, reference) {
  if (!reference || typeof reference.bodyFile !== 'string' || basename(reference.bodyFile) !== reference.bodyFile) fail('Malformed response-cache reference.', 'RESPONSE_CACHE_REFERENCE_INVALID')
  const body = await readFile(resolve(cacheDir, reference.bodyFile), 'utf8')
  if (rawSha256(Buffer.from(body, 'utf8')) !== reference.bodySha256) fail('Response-cache hash mismatch.', 'RESPONSE_CACHE_HASH_MISMATCH')
  return body
}

function responseObject(reference, body) {
  const headers = new Map(Object.entries(reference.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  return { ok: reference.status >= 200 && reference.status < 300, status: reference.status, headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null }, json: async () => JSON.parse(body) }
}

export function createWalBackedFetch({ walPath, cacheDir, candidate, invocationId, timestamp, baseFetch, onEvent = () => {} }) {
  let ordinal = 0
  return async (url, init = {}) => {
    const httpOrdinal = ordinal++
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]).sort())
    const request = { url: String(url), method: init.method ?? 'GET', headers }
    const identity = {
      studyId: V4_STAGE2_PROTOCOL_ID, invocationId, attemptId: `${invocationId}|stage2|${candidate.candidateId}|http-${httpOrdinal}`,
      stage: 2, requestScope: 'candidate', requestPurpose: `wikipedia-http-${httpOrdinal}`, requestHash: canonicalSha256(request),
      attemptOrdinal: httpOrdinal, timestamp, scopeId: null, candidateId: candidate.candidateId, arm: null, drawIndex: null,
    }
    const execution = await executeRequest({
      walPath, identity, prepareDispatch: async () => request,
      transport: { dispatch: async () => {
        onEvent({ type: 'http-dispatch', candidateId: candidate.candidateId, httpOrdinal })
        const response = await baseFetch(request.url, { ...init, method: request.method, headers: request.headers })
        const body = await response.text(); const cached = await persistBody(cacheDir, body)
        const relevantHeaders = {}
        for (const name of ['content-type', 'retry-after', 'etag', 'last-modified', 'date']) { const value = response.headers?.get?.(name); if (value != null) relevantHeaders[name] = value }
        return { status: response.status, headers: relevantHeaders, ...cached }
      } },
      parseResponse: async (reference) => { await verifyResponseReference(cacheDir, reference); return reference },
      onStep: (step) => onEvent({ type: 'wal-step', step, candidateId: candidate.candidateId, httpOrdinal }),
    })
    if (execution.status !== 'COMPLETED') fail(`HTTP attempt is not replay-safe: ${execution.status}`, execution.status)
    const body = await verifyResponseReference(cacheDir, execution.output)
    onEvent({ type: 'http-complete', candidateId: candidate.candidateId, httpOrdinal, replayed: execution.replayed === true })
    return responseObject(execution.output, body)
  }
}

export function classifyStage2Result(result, diagnostics = []) {
  if (result?.descriptiveEvidence) {
    const eligibleNormalizedWordCount = result.descriptiveEvidence.text.split(/\s+/u).filter(Boolean).length
    return { terminalStatus: eligibleNormalizedWordCount >= 150 ? 'VIABLE' : 'NON_VIABLE', failureReason: eligibleNormalizedWordCount >= 150 ? null : 'ELIGIBLE_NORMALIZED_WORD_COUNT_BELOW_150', eligibleNormalizedWordCount, identityResolved: true, allowedSection: true }
  }
  if (SUBSTANTIVE_FAILURES.has(result?.failureReason)) {
    return { terminalStatus: 'NON_VIABLE', failureReason: result.failureReason, eligibleNormalizedWordCount: 0, identityResolved: result.failureReason !== 'IDENTITY_UNRESOLVED', allowedSection: !['IDENTITY_UNRESOLVED', 'NO_MATCHING_SECTION'].includes(result.failureReason) }
  }
  const diagnosticCode = diagnostics.find(({ event }) => event?.includes('failure'))?.code
  fail('Technical adapter result cannot become NON_VIABLE.', result?.resolverFailureCode ?? diagnosticCode ?? result?.failureReason ?? 'TECHNICAL_ADAPTER_FAILURE')
}

export async function executeStage2Candidate({ candidate, paths, invocationId, timestamp, baseFetch, exposureRecords, privateEvidence, onEvent = () => {} }) {
  const diagnostics = []
  const fetchImpl = createWalBackedFetch({ walPath: paths.wal, cacheDir: paths.cache, candidate, invocationId, timestamp, baseFetch, onEvent })
  const result = await fetchWikipediaReceptionEvidenceV2({
    facts: candidate, fetchImpl, retrievedAt: timestamp, cacheRoot: paths.adapterCache,
    writeJsonFile: async (_path, value) => {
      const hash = canonicalSha256(value); const path = resolve(paths.adapterCache, `${hash.slice(7)}.json`)
      await mkdir(paths.adapterCache, { recursive: true }); if (!await exists(path)) await atomicWriteArtifact(path, value)
      return true
    },
    onDescriptiveResponseReceived: async (record) => {
      const key = canonicalSha256({ candidateId: candidate.candidateId, ...record })
      if (!exposureRecords.some((entry) => entry.exposureId === key)) exposureRecords.push({ exposureId: key, candidateId: candidate.candidateId, ...record })
      await atomicReplace(paths.exposure, { protocolId: V4_STAGE2_PROTOCOL_ID, records: exposureRecords })
    },
    onDiagnosticEvent: (event) => diagnostics.push(event),
  })
  const classified = classifyStage2Result(result, diagnostics)
  if (classified.terminalStatus === 'VIABLE') {
    const provenance = result.descriptiveEvidence.provenance
    privateEvidence.push({ candidateId: candidate.candidateId, wikipediaTitle: provenance.canonicalWikipediaTitle, pageId: provenance.pageId, revisionId: provenance.revisionId, sectionHeading: provenance.sectionHeading, sectionIndex: provenance.sectionIndex, contentSha256: result.descriptiveEvidence.contentSha256, eligibleNormalizedWordCount: classified.eligibleNormalizedWordCount, text: result.descriptiveEvidence.text })
    await atomicReplace(paths.privateEvidence, { protocolId: V4_STAGE2_PROTOCOL_ID, evidence: privateEvidence })
  }
  return { candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, title: candidate.title, ...classified, provenance: result.descriptiveEvidence ? { ...result.descriptiveEvidence.provenance, retrievedAt: result.descriptiveEvidence.provenance.retrievedAt } : null }
}

export function wilson95(k, n) {
  const z = 1.959963984540054; const p = k / n; const denominator = 1 + z ** 2 / n
  const center = (p + z ** 2 / (2 * n)) / denominator; const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * n)) / n) / denominator
  return { lower: center - margin, upper: center + margin }
}

function groupCoverage(candidates, rows, keyFn) {
  const groups = new Map(); const rowById = new Map(rows.map((row) => [row.candidateId, row]))
  for (const candidate of candidates) for (const key of keyFn(candidate.frozenFacts)) {
    const group = groups.get(key) ?? { total: 0, viable: 0 }; group.total++; if (rowById.get(candidate.candidateId)?.terminalStatus === 'VIABLE') group.viable++; groups.set(key, group)
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, coverage: value.viable / value.total }]))
}

export function buildCoverageResult(candidates, rows, walRecords, privateEvidence) {
  if (candidates.length !== 180 || rows.length !== 180 || rows.some(({ terminalStatus }) => !['VIABLE', 'NON_VIABLE'].includes(terminalStatus))) fail('Coverage requires 180 determinate outcomes.', 'INCOMPLETE_COVERAGE')
  const viable = rows.filter(({ terminalStatus }) => terminalStatus === 'VIABLE').length
  const failureReasons = {}; for (const row of rows) if (row.failureReason) failureReasons[row.failureReason] = (failureReasons[row.failureReason] ?? 0) + 1
  const count = (predicate) => rows.filter(predicate).length
  return {
    protocolId: V4_STAGE2_PROTOCOL_ID, status: 'COMPLETE', denominator: 180, viableWikipediaEvidenceCount: viable,
    nonViableWikipediaEvidenceCount: 180 - viable, coverage: viable / 180, wilson95DescriptiveInterval: wilson95(viable, 180),
    identityResolutionCount: count((row) => row.identityResolved), identityResolutionRate: count((row) => row.identityResolved) / 180,
    allowedSectionCount: count((row) => row.allowedSection), allowedSectionRate: count((row) => row.allowedSection) / 180,
    eligibleNormalizedWordCountAtLeast150Count: viable, eligibleNormalizedWordCountAtLeast150Rate: viable / 180,
    failureReasonDistribution: failureReasons,
    coverageByFactualStrata: {
      releaseDecade: groupCoverage(candidates, rows, (f) => [`${String(f.release_date).slice(0, 3)}0s`]),
      voteCountBand: groupCoverage(candidates, rows, (f) => [f.vote_count < 200 ? 'lt-200' : f.vote_count <= 800 ? '200-800' : 'gt-800']),
      language: groupCoverage(candidates, rows, (f) => [f.original_language ?? 'unavailable']),
      country: { status: 'UNAVAILABLE_FROM_FROZEN_FACTUAL_COHORT' },
      genre: groupCoverage(candidates, rows, (f) => (f.genre_ids ?? []).map(String)),
      runtimeBand: { status: 'UNAVAILABLE_FROM_FROZEN_FACTUAL_COHORT' },
    },
    walCounts: { INTENT: walRecords.filter(({ lifecycle }) => lifecycle === 'INTENT').length, RESPONSE: walRecords.filter(({ lifecycle }) => lifecycle === 'RESPONSE').length, TERMINAL: walRecords.filter(({ lifecycle }) => lifecycle === 'TERMINAL').length },
    unknownInFlightCount: 0, privateEvidenceSnapshotHash: canonicalSha256({ protocolId: V4_STAGE2_PROTOCOL_ID, evidence: privateEvidence }), rawWikipediaProseIncluded: false,
  }
}

export async function runV4Stage2({ root = process.cwd(), artifactDir = resolve(root, V4_STAGE2_ROOT), authorization, baseFetch = globalThis.fetch, invocationId = `${V4_STAGE2_RUNNER_VERSION}-live-v1`, timestamp = new Date().toISOString(), jitVerifier = verifyV4Stage2Jit, onEvent = () => {} } = {}) {
  if (authorization !== V4_STAGE2_AUTHORIZATION) return { status: 'NOT_AUTHORIZED', dispatchedRequests: 0 }
  const paths = stage2Paths(root, artifactDir)
  if (existsSync(artifactDir)) return { status: V4_STAGE2_PRELIVE_FAILED, reason: 'OUTPUT_DIRECTORY_COLLISION', dispatchedRequests: 0, paths }
  await mkdir(artifactDir, { recursive: true })
  let lock
  try { lock = await acquireRunLock(paths.lock, { protocolId: V4_STAGE2_PROTOCOL_ID, stage: 2, invocationId, timestamp, runnerVersion: V4_STAGE2_RUNNER_VERSION }); onEvent({ type: 'lock-acquired' }) }
  catch (error) { return { status: V4_STAGE2_PRELIVE_FAILED, reason: error.code ?? 'RUN_LOCK_FAILURE', dispatchedRequests: 0, paths } }
  let frozen
  try { frozen = await jitVerifier({ root, paths, onEvent }) }
  catch (error) { await atomicReplace(paths.metadata, { protocolId: V4_STAGE2_PROTOCOL_ID, invocationId, timestamp, status: V4_STAGE2_PRELIVE_FAILED, reason: error.code ?? 'JIT_FAILURE', dispatchedRequests: 0 }); return { status: V4_STAGE2_PRELIVE_FAILED, reason: error.code ?? 'JIT_FAILURE', dispatchedRequests: 0, paths, lock } }
  const rows = []; const exposureRecords = []; const privateEvidence = []; let dispatchedRequests = 0; let replayCount = 0
  const observed = (event) => { if (event.type === 'http-dispatch') dispatchedRequests++; if (event.type === 'http-complete' && event.replayed) replayCount++; onEvent(event) }
  for (const candidate of frozen.candidates) {
    try {
      const row = await executeStage2Candidate({ candidate, paths, invocationId, timestamp, baseFetch, exposureRecords, privateEvidence, onEvent: observed })
      rows.push(row); await atomicReplace(paths.candidates, { protocolId: V4_STAGE2_PROTOCOL_ID, determinateCandidateCount: rows.length, candidates: rows })
    } catch (error) {
      const recovered = await recoverWal(paths.wal); const unknown = new Set(recovered.records.filter(({ lifecycle }) => lifecycle === 'INTENT').map(({ attemptId }) => attemptId)).size - recovered.records.filter(({ lifecycle }) => lifecycle === 'TERMINAL').length
      await atomicReplace(paths.metadata, { protocolId: V4_STAGE2_PROTOCOL_ID, invocationId, timestamp, status: V4_STAGE2_BLOCKED, reason: error.code ?? 'TECHNICAL_FAILURE', determinateCandidateCount: rows.length, dispatchedRequests, replayCount, unknownInFlightCount: Math.max(0, unknown) })
      return { status: V4_STAGE2_BLOCKED, reason: error.code ?? 'TECHNICAL_FAILURE', determinateCandidateCount: rows.length, dispatchedRequests, replayCount, paths }
    }
  }
  const recovered = await recoverWal(paths.wal); const coverage = buildCoverageResult(frozen.candidates, rows, recovered.records, privateEvidence)
  coverage.totalHttpDispatchCount = dispatchedRequests; coverage.replayCount = replayCount
  await atomicReplace(paths.coverage, coverage)
  const metadata = { protocolId: V4_STAGE2_PROTOCOL_ID, invocationId, timestamp, runnerVersion: V4_STAGE2_RUNNER_VERSION, status: 'COMPLETE', determinateCandidateCount: 180, dispatchedRequests, replayCount, coverageResultHash: canonicalSha256(coverage) }
  await atomicReplace(paths.metadata, metadata)
  return { status: 'COMPLETE', coverage, metadata, paths, lock }
}
