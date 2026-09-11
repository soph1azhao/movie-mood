// C1b-V2 Stage 1C: controlled live TMDB recruitment runner.
// Real transport is injected; the default CLI transport performs one fetch per
// call and has no retry loop. No other external service is referenced.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  OPERATIONALLY_INCONCLUSIVE,
  acquireRunLock,
  atomicWriteArtifact,
  canonicalSha256,
  canonicalize,
  executeRequest,
  parseJsonRejectingDuplicateKeys,
  verifyContractsBundle,
} from './c1bV2Stage0.mjs'
import {
  STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED,
  STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE,
  STAGE1_PROTOCOL_ID,
  STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT,
  STAGE1_STRATA,
  Stage1Error,
  buildExclusionManifest,
  buildStratumPageRequest,
  checkFactualEligibility,
  createSourceSnapshot,
  executePostFreezeSelection,
  matchStratum,
  planStratumPagination,
  resolveDuplicateDisposition,
  serializeRequestUrl,
  validateCorpusCompleteness,
  validateSerializedRequest,
  verifyExclusionManifest,
} from './c1bV2Stage1.mjs'

export const STAGE1_LIVE_RUN_ID = 'phase-5c-c1b-v-confirmatory.v2-stage1-live-v1'
export const STAGE1_COMPLETE = 'STAGE 1 COMPLETE — FRESH FACTUAL UNIVERSE FROZEN'
export const STAGE1_PRELIVE_FAILED = 'STOP — STAGE 1C PRE-LIVE GATE FAILED'
export const STAGE1_LIVE_OUTPUT_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v2/stage1-recruitment-live-v1'
export const TMDB_DISCOVER_BASE_URL = 'https://api.themoviedb.org/3'

const REQUIRED_PROTOCOL_HASH = 'sha256:00d82b9b439c2d721fabaf0da6c8e6027b338d7e82bffa3cc9ee0d37c070a376'
const REQUIRED_BUNDLE_HASH = 'sha256:7b342a7f51e8d4ac1695298ba80774834fd6984385b6ad7ed7348c2969ac0c99'

export class Stage1RunnerError extends Error {
  constructor(message, code = 'STAGE1_RUNNER_ERROR', details = undefined) {
    super(message)
    this.name = 'Stage1RunnerError'
    this.code = code
    this.details = details
  }
}

const SOURCE_PATHS = Object.freeze({
  supersededRegistry: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v1.1/stage1-prospective-factual-candidates.json',
  correctedRegistry: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v1.1/stage1-recruitment-v1/prospective-factual-candidates.json',
  humanGold: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v1.1/stage2a-human-labeling/frozen-human-gold.json',
  wikipediaViability: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v1.1/stage2b-wikipedia-viability/viability.json',
  technicalStatus: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v1.1/stage2b-unresolved-completion/technical-status.json',
  incident: 'tests/fixtures/audits/stage2b-operational-incident.v1.json',
  incidentResolution: 'tests/fixtures/audits/stage2b-unresolved-resolution.v1.json',
  ledger: 'catalogue-pipeline/calibration/semantic-exposure-ledger.v1.json',
  holdouts: 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json',
  phase5aFacts: 'catalogue-pipeline/generated/tmdbFacts/phase-5a-calibration.json',
  phase5bFacts: 'catalogue-pipeline/generated/tmdbFacts/diagnostics/phase-5b-ordinal-hedging.json',
  phase5c0Facts: 'catalogue-pipeline/generated/tmdbFacts/diagnostics/phase-5c0-generalization.json',
  developmentCoverage: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-development-descriptive-v2/descriptive-coverage.json',
  maskedProbe1: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-identity-masked-mechanistic-k3-v1/arm0/k3-256k/probe-01.json',
  maskedProbe2: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-identity-masked-mechanistic-k3-v1/arm0/k3-256k/probe-02.json',
})

async function readJson(root, path) {
  return parseJsonRejectingDuplicateKeys(await readFile(resolve(root, path), 'utf8'))
}

function rawSha256(value) { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}` }

function identityFrom(row) {
  return {
    canonicalId: row.canonicalId ?? row.candidateId ?? null,
    title: row.title ?? row.candidateTitle ?? null,
    tmdbId: Number(row.tmdbId),
  }
}

function addIdentity(index, row, sourcePath) {
  const identity = identityFrom(row)
  if (!identity.canonicalId || !Number.isInteger(identity.tmdbId) || identity.tmdbId <= 0) return
  const prior = index.get(identity.canonicalId)
  if (prior && prior.tmdbId !== identity.tmdbId) throw new Stage1RunnerError(`Conflicting TMDB identity for ${identity.canonicalId}.`, 'EXCLUSION_METADATA_CONFLICT', { prior, identity, sourcePath })
  if (!prior) index.set(identity.canonicalId, identity)
}

function resolveIdentity(index, canonicalId, sourcePath) {
  const identity = index.get(canonicalId)
  if (!identity) throw new Stage1RunnerError(`No repository-backed TMDB identity for exposed candidate ${canonicalId}.`, 'UNRESOLVED_EXCLUSION_IDENTITY', { canonicalId, sourcePath })
  return identity
}

function sourceRecord(identity, { reason, provenance, sourceRecordCount = 1, details = undefined }) {
  return { ...identity, reason, provenance, sourceRecordCount, ...(details ? { details } : {}) }
}

async function listJsonFiles(path) {
  const files = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await listJsonFiles(child))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(child)
  }
  return files.sort()
}

async function materializedSemanticRecords(root, artifactRoot, identityIndex) {
  const absoluteRoot = resolve(root, artifactRoot)
  const files = (await listJsonFiles(absoluteRoot)).filter((path) => !path.includes('/evidencePackets/') && basename(path) !== 'report.json')
  const byCanonicalId = new Map()
  for (const path of files) {
    const canonicalId = basename(path, '.json')
    if (!identityIndex.has(canonicalId)) continue
    const paths = byCanonicalId.get(canonicalId) ?? []
    paths.push(relative(root, path)); byCanonicalId.set(canonicalId, paths)
  }
  return [...byCanonicalId.entries()].map(([canonicalId, artifactPaths]) => sourceRecord(resolveIdentity(identityIndex, canonicalId, artifactRoot), {
    reason: 'semantic-model-output-materialized',
    provenance: artifactPaths[0],
    sourceRecordCount: artifactPaths.length,
    details: { artifactPaths },
  }))
}

export async function assembleRepositoryExclusions({ root = process.cwd() } = {}) {
  const loadedEntries = await Promise.all(Object.entries(SOURCE_PATHS).map(async ([key, path]) => [key, await readJson(root, path)]))
  const data = Object.fromEntries(loadedEntries)
  const identityIndex = new Map()
  for (const row of [
    ...data.supersededRegistry.candidates,
    ...data.correctedRegistry.candidates,
    ...data.humanGold.entries,
    ...data.holdouts.records,
    ...data.phase5aFacts.facts,
    ...data.phase5bFacts.facts,
    ...data.phase5c0Facts.facts,
  ]) addIdentity(identityIndex, row, 'repository identity sources')

  const sources = []
  const addSource = (sourcePath, sourceCategory, records, extra = {}) => {
    sources.push({ sourceName: sourceCategory, sourceFile: sourcePath, entries: records, audit: { sourcePath, sourceCategory, ...extra } })
  }
  const direct = (rows, path, reason) => rows.map((row) => sourceRecord(identityFrom(row), { reason, provenance: path }))
  const resolved = (rows, path, reason) => rows.map((row) => sourceRecord(resolveIdentity(identityIndex, row.canonicalId, path), { reason, provenance: path }))

  addSource(SOURCE_PATHS.supersededRegistry, 'c1b-v1-superseded-stage1-registry', direct(data.supersededRegistry.candidates, SOURCE_PATHS.supersededRegistry, 'materialized-in-c1b-v1-stage1-registry'))
  addSource(SOURCE_PATHS.correctedRegistry, 'c1b-v1-corrected-stage1-registry', direct(data.correctedRegistry.candidates, SOURCE_PATHS.correctedRegistry, 'materialized-in-c1b-v1-stage1-registry'))
  addSource(SOURCE_PATHS.humanGold, 'c1b-v1-human-gold', direct(data.humanGold.entries, SOURCE_PATHS.humanGold, 'c1b-v1-human-gold-candidate'))
  addSource(SOURCE_PATHS.wikipediaViability, 'c1b-v1-wikipedia-exposure', resolved(data.wikipediaViability.records, SOURCE_PATHS.wikipediaViability, 'wikipedia-exposed'))
  addSource(SOURCE_PATHS.technicalStatus, 'c1b-v1-unresolved-completion', resolved(data.technicalStatus.records, SOURCE_PATHS.technicalStatus, 'incident-resolution-candidate'))
  addSource(SOURCE_PATHS.incidentResolution, 'c1b-v1-incident-resolution-fixture', resolved(data.incidentResolution.records, SOURCE_PATHS.incidentResolution, 'incident-resolution-candidate'))
  addSource(SOURCE_PATHS.incident, 'c1b-v1-operational-incident', resolved(data.incidentResolution.records, SOURCE_PATHS.incident, 'operational-incident-candidate'), { linkedCandidateSource: SOURCE_PATHS.incidentResolution })

  const ledgerGroups = new Map()
  for (const event of data.ledger.events) {
    if (event.canonicalId === 'identity-masked-probe') continue
    const group = ledgerGroups.get(event.canonicalId) ?? []
    group.push(event); ledgerGroups.set(event.canonicalId, group)
  }
  const ledgerRecords = [...ledgerGroups.entries()].map(([canonicalId, events]) => sourceRecord(resolveIdentity(identityIndex, canonicalId, SOURCE_PATHS.ledger), {
    reason: 'semantic-or-descriptive-exposure-ledger-entry',
    provenance: SOURCE_PATHS.ledger,
    sourceRecordCount: events.length,
    details: { exposureTypes: [...new Set(events.map(({ exposureType }) => exposureType))].sort(), phases: [...new Set(events.map(({ phase }) => phase))].sort() },
  }))
  addSource(SOURCE_PATHS.ledger, 'phase5-exposure-ledger', ledgerRecords, { excludedOpaqueNonFilmIdentity: 'identity-masked-probe', opaqueResolution: 'resolved separately by sourceDescriptiveHash' })

  const exposedCanonicalIds = new Set(ledgerGroups.keys())
  const holdoutRecords = data.holdouts.records.filter(({ canonicalId, tmdbId }) => canonicalId && tmdbId && exposedCanonicalIds.has(canonicalId)).map((row) => sourceRecord(identityFrom(row), { reason: 'prospective-development-candidate-materially-exposed', provenance: SOURCE_PATHS.holdouts }))
  addSource(SOURCE_PATHS.holdouts, 'prospective-semantic-holdouts-exposed', holdoutRecords, { omittedUnresolvedUnexposedReserves: data.holdouts.records.filter(({ tmdbId }) => !tmdbId).map(({ title }) => title) })

  const materializedRoots = [
    ['phase5a-semantic-output', 'catalogue-pipeline/generated/semantic/phase-5a-calibration', SOURCE_PATHS.phase5aFacts],
    ['phase5b-semantic-output', 'catalogue-pipeline/generated/semantic/diagnostics/phase-5b-ordinal-hedging', SOURCE_PATHS.phase5bFacts],
    ['phase5c0-semantic-output', 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c0-generalization', SOURCE_PATHS.phase5c0Facts],
    ['phase5c-compositional-situation-output', 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-compositional-inference', SOURCE_PATHS.phase5c0Facts],
    ['phase5c-friends-compositional-output', 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-friends-compositional', SOURCE_PATHS.phase5c0Facts],
  ]
  for (const [category, artifactRoot, identitySourcePath] of materializedRoots) {
    const records = await materializedSemanticRecords(root, artifactRoot, identityIndex)
    if (!records.length) throw new Stage1RunnerError(`No materialized semantic outputs found under ${artifactRoot}.`, 'UNRESOLVED_EXCLUSION_IDENTITY')
    addSource(artifactRoot, category, records, { identitySourcePath })
  }

  const coverageByHash = new Map(data.developmentCoverage.rows.filter(({ contentSha256 }) => contentSha256).map((row) => [row.contentSha256, row.canonicalId]))
  const probeFiles = [[SOURCE_PATHS.maskedProbe1, data.maskedProbe1], [SOURCE_PATHS.maskedProbe2, data.maskedProbe2]]
  const probeRecords = probeFiles.map(([path, probe]) => {
    const canonicalId = coverageByHash.get(probe.sourceDescriptiveHash)
    if (!canonicalId) throw new Stage1RunnerError(`Opaque probe source hash cannot be resolved from repository evidence: ${probe.sourceDescriptiveHash}`, 'UNRESOLVED_EXCLUSION_IDENTITY', { path })
    return sourceRecord(resolveIdentity(identityIndex, canonicalId, path), { reason: 'identity-masked-semantic-probe-source', provenance: path, details: { opaqueId: probe.opaqueId, sourceDescriptiveHash: probe.sourceDescriptiveHash } })
  })
  addSource('catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-identity-masked-mechanistic-k3-v1', 'identity-masked-semantic-probes', probeRecords, { resolutionSource: SOURCE_PATHS.developmentCoverage })

  const manifest = buildExclusionManifest({ protocolId: STAGE1_PROTOCOL_ID, sources })
  verifyExclusionManifest(manifest)
  const contributed = new Set()
  const inventorySources = sources.map((source) => {
    const ids = [...new Set(source.entries.map(({ tmdbId }) => tmdbId))].sort((a, b) => a - b)
    const uniqueTmdbIdsContributed = ids.filter((id) => !contributed.has(id))
    ids.forEach((id) => contributed.add(id))
    return { ...source.audit, recordCount: source.entries.length, uniqueTmdbIdCount: ids.length, uniqueTmdbIdsContributed, records: source.entries }
  })
  const sourceDigests = await Promise.all(Object.values(SOURCE_PATHS).map(async (path) => ({ path, rawSha256: rawSha256(await readFile(resolve(root, path), 'utf8')) })))
  const provenance = {
    inventoryVersion: 1,
    protocolId: STAGE1_PROTOCOL_ID,
    exclusionManifestHash: manifest.exclusionManifestHash,
    sources: inventorySources,
    sourceDigests: sourceDigests.sort((a, b) => a.path.localeCompare(b.path)),
    totalExclusions: manifest.exclusions.length,
  }
  return { manifest, provenance }
}

export function buildUniverseRequestIdentity({ request, invocationId, timestamp }) {
  validateSerializedRequest(request)
  return {
    studyId: STAGE1_PROTOCOL_ID,
    invocationId,
    attemptId: `${invocationId}:${request.stratumId}:page:${request.page}`,
    stage: 1,
    requestScope: 'universe',
    requestPurpose: 'tmdb-discover-movie-stage1-recruitment',
    requestHash: canonicalSha256({ endpoint: request.endpoint, params: request.params, stratumId: request.stratumId }),
    attemptOrdinal: 0,
    timestamp,
    scopeId: `stage1:${request.stratumId}:page:${request.page}`,
    candidateId: null,
    arm: null,
    drawIndex: null,
  }
}

export function createTmdbDiscoverTransport({ token, fetchImpl = globalThis.fetch, onDispatch = () => {} }) {
  if (!token) throw new Stage1RunnerError('TMDB_READ_ACCESS_TOKEN is unavailable.', 'MISSING_TMDB_TOKEN')
  return Object.freeze({
    automaticRetries: false,
    maxAttempts: 1,
    async dispatch(request) {
      validateSerializedRequest(request)
      const requestUrl = serializeRequestUrl(request)
      const url = `${TMDB_DISCOVER_BASE_URL}${requestUrl}`
      onDispatch({ request, url })
      const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
      return { body: await response.text(), ok: response.ok, status: response.status }
    },
  })
}

export function parseTmdbDiscoverWireResponse(wire) {
  if (!wire || wire.ok !== true || !Number.isInteger(wire.status) || typeof wire.body !== 'string') throw new Stage1RunnerError(`TMDB discovery response failed with HTTP ${wire?.status ?? 'unknown'}.`, 'TMDB_HTTP_FAILURE', { status: wire?.status ?? null })
  const parsed = parseJsonRejectingDuplicateKeys(wire.body)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) throw new Stage1RunnerError('TMDB discovery response has invalid structure.', 'INVALID_TMDB_RESPONSE')
  return parsed
}

async function pathExists(path) { return stat(path).then(() => true, () => false) }

async function persistOnceOrVerify(path, value) {
  if (await pathExists(path)) {
    const existing = parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))
    if (canonicalize(existing) !== canonicalize(value)) throw new Stage1RunnerError(`Immutable artifact differs on replay: ${path}`, 'IMMUTABLE_ARTIFACT_MISMATCH')
    return
  }
  await atomicWriteArtifact(path, value)
}

async function writeRunMetadata(path, value) { await atomicWriteArtifact(path, value) }

function outputPaths(outputDir) {
  return {
    lock: join(outputDir, 'RUN_LOCK'), wal: join(outputDir, 'execution.wal'), metadata: join(outputDir, 'run-metadata.json'),
    exclusion: join(outputDir, 'exclusion-manifest.json'), provenance: join(outputDir, 'exclusion-provenance.json'),
    requestManifest: join(outputDir, 'request-manifest.json'), snapshot: join(outputDir, 'source-snapshot.json'), snapshotHash: join(outputDir, 'source-snapshot-hash.json'),
    registry: join(outputDir, 'selected-180-candidate-registry.json'), strata: join(outputDir, 'strata-summary.json'), hashes: join(outputDir, 'audit-hashes.json'), gate: join(outputDir, 'pre-live-gate.json'),
  }
}

function summarizeSelectionInputs(snapshot, exclusionManifest, selection) {
  const unique = resolveDuplicateDisposition(snapshot)
  const excluded = new Set(exclusionManifest.exclusions.map(({ tmdbId }) => tmdbId))
  const summary = STAGE1_STRATA.map((stratum) => {
    const records = unique.filter(({ release_date }) => matchStratum(release_date)?.id === stratum.id)
    const factuallyEligible = records.filter((record) => checkFactualEligibility(record).eligible)
    const excludedRecords = factuallyEligible.filter(({ id }) => excluded.has(id))
    return {
      stratumId: stratum.id,
      quota: stratum.quota,
      uniqueRecords: records.length,
      factuallyEligible: factuallyEligible.length,
      excluded: excludedRecords.length,
      eligibleNonExcluded: factuallyEligible.length - excludedRecords.length,
      selected: selection?.strataSummary.find((row) => row.stratumId === stratum.id)?.selectedCount ?? 0,
    }
  })
  const rawCount = snapshot.rawResponseCorpus.reduce((sum, page) => sum + page.response.results.length, 0)
  return { duplicateDisposition: { rawRecordCount: rawCount, uniqueTmdbIdCount: unique.length, identicalDuplicatesCollapsed: rawCount - unique.length, conflicts: 0 }, strata: summary }
}

export async function runStage1Recruitment({
  contract,
  exclusionManifest,
  exclusionProvenance,
  outputDir,
  transport,
  invocationId = STAGE1_LIVE_RUN_ID,
  timestamp = new Date().toISOString(),
  controlledResume = false,
  gateReport = null,
  onStep = () => {},
} = {}) {
  verifyExclusionManifest(exclusionManifest)
  const paths = outputPaths(outputDir)
  if (!controlledResume) {
    if (await pathExists(outputDir)) throw new Stage1RunnerError(`Output directory already exists: ${outputDir}`, 'OUTPUT_DIRECTORY_COLLISION')
    await mkdir(outputDir, { recursive: true })
    await acquireRunLock(paths.lock, { invocationId, protocolId: STAGE1_PROTOCOL_ID, stage: 1, createdAt: timestamp })
  } else if (!await pathExists(paths.lock)) throw new Stage1RunnerError('Controlled resume requires the preserved RUN_LOCK.', 'RUN_LOCK_MISSING')
  await persistOnceOrVerify(paths.exclusion, exclusionManifest)
  await persistOnceOrVerify(paths.provenance, exclusionProvenance)
  if (gateReport) await persistOnceOrVerify(paths.gate, gateReport)

  const requests = []
  const responses = []
  const plans = new Map()
  let dispatched = 0
  const fetchPage = async (stratum, page) => {
    const request = buildStratumPageRequest(contract, stratum, page)
    requests.push(request)
    const identity = buildUniverseRequestIdentity({ request, invocationId, timestamp })
    let result
    try {
      result = await executeRequest({
        walPath: paths.wal,
        identity,
        prepareDispatch: async () => { validateSerializedRequest(request); return request },
        transport: { dispatch: async (prepared) => { dispatched++; return transport.dispatch(prepared) } },
        parseResponse: parseTmdbDiscoverWireResponse,
      })
    } catch (error) {
      const classifiedError = error.code ? error : new Stage1RunnerError('Transport failed after dispatch entry and before durable RESPONSE.', 'AMBIGUOUS_TRANSPORT_FAILURE')
      await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status: OPERATIONALLY_INCONCLUSIVE, reason: classifiedError.code, dispatchedRequests: dispatched })
      return { failed: true, status: OPERATIONALLY_INCONCLUSIVE, error: classifiedError }
    }
    if (result.status !== 'COMPLETED') {
      const error = new Stage1RunnerError(`Request recovered as ${result.status}.`, result.status)
      await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status: OPERATIONALLY_INCONCLUSIVE, reason: result.status, dispatchedRequests: dispatched })
      return { failed: true, status: OPERATIONALLY_INCONCLUSIVE, error }
    }
    if (result.output.page !== page) {
      const error = new Stage1RunnerError(`TMDB response page ${result.output.page} does not match requested page ${page}.`, 'INCOMPLETE_DISCOVERY_CORPUS')
      await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status: OPERATIONALLY_INCONCLUSIVE, reason: error.code, dispatchedRequests: dispatched })
      return { failed: true, status: OPERATIONALLY_INCONCLUSIVE, error }
    }
    responses.push({ stratumId: stratum.id, page, response: result.output })
    onStep({ type: 'page-complete', stratumId: stratum.id, page, replayed: result.replayed === true })
    return { failed: false, response: result.output }
  }

  for (const stratum of STAGE1_STRATA) {
    const fetched = await fetchPage(stratum, 1)
    if (fetched.failed) return { status: fetched.status, dispatchedRequests: dispatched, paths, reason: fetched.error.code }
    try { plans.set(stratum.id, planStratumPagination(fetched.response)) } catch (error) {
      const status = error.code === 'DISCOVERY_PAGE_BUDGET_EXCEEDED' ? STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED : OPERATIONALLY_INCONCLUSIVE
      await persistOnceOrVerify(paths.requestManifest, { protocolId: STAGE1_PROTOCOL_ID, requests })
      await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status, blockedStratum: stratum.id, totalPages: fetched.response.total_pages, dispatchedRequests: dispatched })
      return { status, blockedStratum: stratum.id, totalPages: fetched.response.total_pages, dispatchedRequests: dispatched, paths }
    }
  }
  onStep({ type: 'page1-gate-complete' })

  for (const stratum of STAGE1_STRATA) for (const page of plans.get(stratum.id).requiredPages.slice(1)) {
    const fetched = await fetchPage(stratum, page)
    if (fetched.failed) return { status: fetched.status, dispatchedRequests: dispatched, paths, reason: fetched.error.code }
  }

  try {
    for (const stratum of STAGE1_STRATA) {
      const stratumResponses = responses.filter(({ stratumId }) => stratumId === stratum.id)
      validateCorpusCompleteness(stratum.id, plans.get(stratum.id).totalPages, stratumResponses)
      if (stratumResponses.some(({ response }) => response.total_pages !== plans.get(stratum.id).totalPages)) throw new Stage1RunnerError(`Inconsistent total_pages for stratum ${stratum.id}.`, 'INCOMPLETE_DISCOVERY_CORPUS')
    }
  } catch (error) {
    await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status: OPERATIONALLY_INCONCLUSIVE, reason: error.code, dispatchedRequests: dispatched })
    return { status: OPERATIONALLY_INCONCLUSIVE, reason: error.code, dispatchedRequests: dispatched, paths }
  }

  const requestManifest = { protocolId: STAGE1_PROTOCOL_ID, requests }
  await persistOnceOrVerify(paths.requestManifest, requestManifest)
  const snapshot = createSourceSnapshot({ protocolId: STAGE1_PROTOCOL_ID, requests, responses })
  await persistOnceOrVerify(paths.snapshot, snapshot)
  await persistOnceOrVerify(paths.snapshotHash, { protocolId: STAGE1_PROTOCOL_ID, sourceSnapshotHash: snapshot.sourceSnapshotHash })
  onStep({ type: 'source-snapshot-persisted', sourceSnapshotHash: snapshot.sourceSnapshotHash })

  let selection
  try { selection = executePostFreezeSelection({ protocolId: STAGE1_PROTOCOL_ID, sourceSnapshot: snapshot, exclusionManifest, onStep: (step) => onStep({ type: step }) }) } catch (error) {
    const status = error.code === 'SOURCE_SNAPSHOT_DUPLICATE_CONFLICT' ? STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT : error.code === 'INSUFFICIENT_FRESH_FACTUAL_UNIVERSE' ? STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE : OPERATIONALLY_INCONCLUSIVE
    await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status, reason: error.code, details: error.details ?? null, dispatchedRequests: dispatched, sourceSnapshotHash: snapshot.sourceSnapshotHash })
    return { status, reason: error.code, details: error.details, dispatchedRequests: dispatched, sourceSnapshotHash: snapshot.sourceSnapshotHash, paths }
  }
  const summary = summarizeSelectionInputs(snapshot, exclusionManifest, selection)
  await persistOnceOrVerify(paths.registry, selection)
  await persistOnceOrVerify(paths.strata, summary)
  await persistOnceOrVerify(paths.hashes, { exclusionManifestHash: exclusionManifest.exclusionManifestHash, requestManifestHash: canonicalSha256(requestManifest), sourceSnapshotHash: snapshot.sourceSnapshotHash, registryHash: canonicalSha256(selection) })
  await writeRunMetadata(paths.metadata, { protocolId: STAGE1_PROTOCOL_ID, invocationId, status: STAGE1_COMPLETE, dispatchedRequests: dispatched, finalCandidateCount: selection.candidates.length, sourceSnapshotHash: snapshot.sourceSnapshotHash, exclusionManifestHash: exclusionManifest.exclusionManifestHash })
  return { status: STAGE1_COMPLETE, dispatchedRequests: dispatched, sourceSnapshotHash: snapshot.sourceSnapshotHash, selection, summary, plans: Object.fromEntries([...plans].map(([id, plan]) => [id, plan.totalPages])), paths }
}

function commandPassed(command, args, cwd) { return spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).status === 0 }

export async function evaluatePreLiveGate({ root, outputDir, token, exclusionManifest, exclusionProvenance, contract, transport, prospectiveCalls = 0 }) {
  const protocolPath = resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.json')
  const bundlePath = resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.contracts.json')
  const protocol = parseJsonRejectingDuplicateKeys(await readFile(protocolPath, 'utf8'))
  const bundle = parseJsonRejectingDuplicateKeys(await readFile(bundlePath, 'utf8'))
  const sampleRequest = buildStratumPageRequest(contract, STAGE1_STRATA[0], 1)
  const checks = {
    correctRepository: root === '/Users/hermes/code/movie-mood',
    acceptedCheckpointAncestry: ['f4b31c8', 'f72b6b3', 'f8d7313'].every((commit) => commandPassed('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], root)),
    frozenProtocolHash: canonicalSha256(protocol) === REQUIRED_PROTOCOL_HASH,
    contractsBundleHash: canonicalSha256(bundle.orderedContractManifest) === REQUIRED_BUNDLE_HASH && verifyContractsBundle(protocol, bundle).ok,
    stage0Tests: commandPassed('pnpm', ['exec', 'vitest', 'run', 'catalogue-pipeline/scripts/c1bV2Stage0.test.mjs'], root),
    stage1aTests: commandPassed('pnpm', ['exec', 'vitest', 'run', 'catalogue-pipeline/scripts/c1bV2Stage1.test.mjs'], root),
    gitDiffCheck: commandPassed('git', ['diff', '--check'], root),
    runnerTests: commandPassed('pnpm', ['exec', 'vitest', 'run', 'catalogue-pipeline/scripts/c1bV2Stage1Runner.test.mjs'], root),
    exclusionManifestAssembled: Array.isArray(exclusionManifest?.exclusions) && exclusionManifest.exclusions.length > 0,
    exclusionManifestHashVerifies: (() => { try { return verifyExclusionManifest(exclusionManifest).ok } catch { return false } })(),
    exclusionProvenanceInventoryExists: Array.isArray(exclusionProvenance?.sources) && exclusionProvenance.sources.length > 0,
    noExclusionMetadataConflicts: true,
    exactRequestContract: (() => { try { validateSerializedRequest(sampleRequest); return true } catch { return false } })(),
    regionAbsent: !serializeRequestUrl(sampleRequest).includes('region'),
    automaticHttpRetriesDisabled: transport?.automaticRetries === false && transport?.maxAttempts === 1,
    walPathConfigured: Boolean(outputPaths(outputDir).wal),
    runLockConfigured: Boolean(outputPaths(outputDir).lock),
    outputDirectoryDoesNotCollide: !await pathExists(outputDir),
    tmdbCredentialAvailable: typeof token === 'string' && token.length > 0,
    zeroProspectiveCallsBeforeGate: prospectiveCalls === 0,
  }
  return { gate: Object.values(checks).every(Boolean) ? 'STAGE 1C PRE-LIVE GATE — PASS' : STAGE1_PRELIVE_FAILED, checks, protocolHash: REQUIRED_PROTOCOL_HASH, contractsBundleHash: REQUIRED_BUNDLE_HASH }
}

async function main() {
  const root = process.cwd()
  const outputDir = resolve(root, STAGE1_LIVE_OUTPUT_RELATIVE)
  const token = process.env.TMDB_READ_ACCESS_TOKEN
  let exclusions
  try { exclusions = await assembleRepositoryExclusions({ root }) } catch (error) {
    console.error(JSON.stringify({ gate: STAGE1_PRELIVE_FAILED, failedCheck: error.code, message: error.message }))
    process.exitCode = 1; return
  }
  const bundle = await readJson(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.contracts.json')
  const contract = bundle.contracts.find(({ id }) => id === 'stage1-recruitment-contract.v2')
  const transport = createTmdbDiscoverTransport({ token })
  const gate = await evaluatePreLiveGate({ root, outputDir, token, exclusionManifest: exclusions.manifest, exclusionProvenance: exclusions.provenance, contract, transport, prospectiveCalls: 0 })
  console.log(JSON.stringify(gate, null, 2))
  if (gate.gate !== 'STAGE 1C PRE-LIVE GATE — PASS') { process.exitCode = 1; return }
  const result = await runStage1Recruitment({ contract, exclusionManifest: exclusions.manifest, exclusionProvenance: exclusions.provenance, outputDir, transport, gateReport: gate })
  console.log(JSON.stringify({ status: result.status, blockedStratum: result.blockedStratum ?? null, totalPages: result.totalPages ?? null, dispatchedRequests: result.dispatchedRequests, sourceSnapshotHash: result.sourceSnapshotHash ?? null }, null, 2))
  if (result.status !== STAGE1_COMPLETE) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(JSON.stringify({ status: OPERATIONALLY_INCONCLUSIVE, code: error.code ?? 'UNEXPECTED_ERROR', message: error.message }))
  process.exitCode = 2
})
