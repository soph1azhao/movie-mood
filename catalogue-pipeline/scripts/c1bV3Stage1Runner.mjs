// C1b-V3 Stage 1B: crash-safe controlled runner integration.
// This module has no default transport and performs no network I/O on import.

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  OPERATIONALLY_INCONCLUSIVE,
  acquireRunLock,
  atomicWriteArtifact,
  canonicalize,
  classifyAttempt,
  executeRequest,
  parseJsonRejectingDuplicateKeys,
  recoverWal,
} from './c1bV2Stage0.mjs'
import {
  V3_PROTOCOL_ID,
  V3_STAGE1_CONTRACT_REF,
  V3_STATUSES,
  buildAnnualPageRequest,
  buildPaginationPlan,
  createV3SourceSnapshot,
  evaluatePage1Gate,
  executeV3PostFreezeSelection,
  loadRegisteredV3Spec,
  serializeAnnualRequest,
  validateAnnualRequest,
  validateLaterPageResponse,
  verifyCorpusCompleteness,
  verifyPaginationPlan,
  verifyV3ExclusionManifest,
  verifyV3SourceSnapshot,
} from './c1bV3Stage1.mjs'

export const V3_STAGE1_PRELIVE_FAILED = 'STOP — V3 STAGE 1 PRE-LIVE GATE FAILED'
export const V3_STAGE1_MIN_DISPATCH_INTERVAL_MS = 250
export const V3_STAGE1_RUNNER_VERSION = 'c1b-v3-stage1b-runner-v1'

export class V3Stage1RunnerError extends Error {
  constructor(message, code = 'V3_STAGE1_RUNNER_ERROR', details) {
    super(message)
    this.name = 'V3Stage1RunnerError'
    this.code = code
    this.details = details
  }
}

const fail = (message, code, details) => { throw new V3Stage1RunnerError(message, code, details) }
const exists = (path) => stat(path).then(() => true, () => false)
const defaultSleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
const rawSha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

export function v3Stage1ArtifactPaths(artifactDir) {
  return Object.freeze({
    lock: join(artifactDir, 'RUN_LOCK'),
    wal: join(artifactDir, 'execution.wal'),
    plan: join(artifactDir, 'pagination-plan.json'),
    snapshot: join(artifactDir, 'source-snapshot.json'),
    registry: join(artifactDir, 'candidate-registry.json'),
    metadata: join(artifactDir, 'run-metadata.json'),
  })
}

export function computeV3RequestHash(frozen, request, options) {
  return rawSha256(serializeAnnualRequest(frozen, request, options))
}

export function buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase, paginationPlan }) {
  const requestPurpose = phase === 'page1' ? 'page1-gate' : phase === 'page2' ? 'page2-enumeration' : null
  if (!requestPurpose) fail('V3 request phase is invalid.', 'INVALID_REQUEST_PHASE')
  const options = phase === 'page1' ? { phase } : { phase, paginationPlan }
  validateAnnualRequest(frozen, request, options)
  const scopeId = `stage1:${request.cellId}:page:${request.page}`
  return Object.freeze({
    studyId: V3_PROTOCOL_ID,
    invocationId,
    attemptId: `${invocationId}:${scopeId}:${requestPurpose}:attempt:0`,
    stage: 1,
    requestScope: 'universe',
    requestPurpose,
    requestHash: computeV3RequestHash(frozen, request, options),
    attemptOrdinal: 0,
    timestamp,
    scopeId,
    candidateId: null,
    arm: null,
    drawIndex: null,
  })
}

export function parseV3DiscoveryWireResponse(wire) {
  if (!wire || wire.ok !== true || !Number.isInteger(wire.status) || typeof wire.body !== 'string') {
    fail(`V3 discovery response failed with HTTP ${wire?.status ?? 'unknown'}.`, 'TMDB_HTTP_FAILURE')
  }
  const parsed = parseJsonRejectingDuplicateKeys(wire.body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Malformed V3 discovery payload.', 'INVALID_DISCOVERY_PAYLOAD')
  return parsed
}

function planArtifact(plan) {
  return { protocolId: V3_PROTOCOL_ID, stage: 1, contractRef: V3_STAGE1_CONTRACT_REF, paginationPlan: plan }
}

function verifyPlanArtifact(frozen, artifact) {
  if (!artifact || Object.keys(artifact).sort().join('|') !== 'contractRef|paginationPlan|protocolId|stage' || artifact.protocolId !== V3_PROTOCOL_ID || artifact.stage !== 1 || artifact.contractRef !== V3_STAGE1_CONTRACT_REF) {
    fail('Persisted pagination plan binding mismatch.', 'PAGINATION_PLAN_ARTIFACT_MISMATCH')
  }
  verifyPaginationPlan(frozen, artifact.paginationPlan)
  return artifact.paginationPlan
}

async function atomicPersistOnceOrVerify(path, value, onStep) {
  if (await exists(path)) {
    const stored = parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))
    if (canonicalize(stored) !== canonicalize(value)) fail(`Immutable artifact mismatch: ${path}`, 'IMMUTABLE_ARTIFACT_MISMATCH')
    return stored
  }
  await atomicWriteArtifact(path, value, { onStep: (step) => onStep(step, path) })
  return parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))
}

function inspectRecoveredWal(recovered) {
  if (recovered.status === 'WAL_CORRUPTION') return { blocked: true, reason: 'WAL_CORRUPTION' }
  if (recovered.status === 'TORN_TRAILING_RECORD') return { blocked: true, reason: 'TORN_TRAILING_RECORD' }
  const attempts = [...new Set(recovered.records.map(({ attemptId }) => attemptId))]
  if (attempts.some((attemptId) => classifyAttempt(recovered.records, attemptId).status === 'UNKNOWN_IN_FLIGHT')) {
    return { blocked: true, reason: 'UNKNOWN_IN_FLIGHT' }
  }
  return { blocked: false }
}

async function readPersistedPlanForRecovery(frozen, path) {
  if (!await exists(path)) fail('Page-2 WAL identity has no persisted pagination plan.', 'RUN_CONTEXT_MISMATCH')
  try {
    return verifyPlanArtifact(frozen, parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8')))
  } catch (error) {
    fail('Page-2 WAL identity has no valid persisted pagination plan.', 'RUN_CONTEXT_MISMATCH', { cause: error.code ?? error.message })
  }
}

export async function verifyRecoveredV3WalContext({ frozen, records, invocationId, timestamp, planPath }) {
  if (!Array.isArray(records)) fail('Recovered WAL records are unavailable.', 'RUN_CONTEXT_MISMATCH')
  let recoveredPlan
  for (const record of records) {
    const match = /^stage1:(year-\d{4}):page:([1-9]\d*)$/u.exec(record.scopeId ?? '')
    if (!match) fail('Recovered WAL scopeId is not a V3 annual-page identity.', 'RUN_CONTEXT_MISMATCH')
    const cellId = match[1]
    const page = Number(match[2])
    if (!frozen.cells.some((cell) => cell.cellId === cellId) || !Number.isInteger(page) || page < 1 || page > 50) {
      fail('Recovered WAL annual cell/page is outside the frozen partition.', 'RUN_CONTEXT_MISMATCH')
    }
    const phase = page === 1 ? 'page1' : 'page2'
    if (phase === 'page2' && !recoveredPlan) recoveredPlan = await readPersistedPlanForRecovery(frozen, planPath)
    let request, expected
    try {
      const options = phase === 'page1' ? { phase } : { phase, paginationPlan: recoveredPlan }
      request = buildAnnualPageRequest(frozen, cellId, page, options)
      expected = buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase, paginationPlan: recoveredPlan })
    } catch (error) {
      fail('Recovered WAL request is not authorized by the frozen V3 context.', 'RUN_CONTEXT_MISMATCH', { cause: error.code ?? error.message })
    }
    const fields = ['studyId', 'invocationId', 'stage', 'requestScope', 'candidateId', 'arm', 'drawIndex', 'attemptOrdinal', 'timestamp', 'scopeId', 'requestPurpose', 'attemptId', 'requestHash']
    if (fields.some((field) => record[field] !== expected[field])) {
      fail('Recovered WAL identity does not belong to this V3 run.', 'RUN_CONTEXT_MISMATCH', { attemptId: record.attemptId })
    }
  }
  return { ok: true, paginationPlan: recoveredPlan }
}

function normalizeTransport(transport) {
  if (typeof transport === 'function') return transport
  if (transport && typeof transport.dispatch === 'function') return (request) => transport.dispatch(request)
  fail('An injected transport function is required.', 'MISSING_TRANSPORT')
}

export async function runV3Stage1Recruitment({
  root = process.cwd(),
  artifactDir,
  transport,
  exclusionManifest,
  controlledResume = false,
  invocationId = `${V3_STAGE1_RUNNER_VERSION}-synthetic`,
  timestamp = new Date().toISOString(),
  monotonicNow = () => performance.now(),
  sleep = defaultSleep,
  loadSpec = loadRegisteredV3Spec,
  beforeDispatch = async (request) => request,
  onWalStep = () => {},
  onArtifactStep = () => {},
  onEvent = () => {},
} = {}) {
  let frozen
  try {
    frozen = await loadSpec({ root })
  } catch (error) {
    return { status: V3_STAGE1_PRELIVE_FAILED, reason: error.code ?? 'SPECIFICATION_VERIFICATION_FAILED', dispatchedRequests: 0 }
  }
  if (!artifactDir) return { status: V3_STAGE1_PRELIVE_FAILED, reason: 'ARTIFACT_DIRECTORY_REQUIRED', dispatchedRequests: 0 }
  const paths = v3Stage1ArtifactPaths(resolve(artifactDir))
  const recovered = await recoverWal(paths.wal)
  const walState = inspectRecoveredWal(recovered)
  if (walState.blocked) return { status: OPERATIONALLY_INCONCLUSIVE, reason: walState.reason, dispatchedRequests: 0, paths }
  try { verifyV3ExclusionManifest(exclusionManifest) } catch (error) {
    return { status: V3_STAGE1_PRELIVE_FAILED, reason: error.code ?? 'EXCLUSION_MANIFEST_INVALID', dispatchedRequests: 0, paths }
  }
  const exclusionManifestHash = exclusionManifest.exclusionManifestHash

  try {
    if (!controlledResume) {
      if (await exists(paths.lock)) fail('RUN_LOCK already exists.', 'RUN_LOCK_HELD')
      if (await exists(artifactDir)) fail('Artifact directory already exists.', 'OUTPUT_DIRECTORY_COLLISION')
      await mkdir(artifactDir, { recursive: true })
      await acquireRunLock(paths.lock, { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId, timestamp, runnerVersion: V3_STAGE1_RUNNER_VERSION, exclusionManifestHash })
    } else {
      if (!await exists(paths.lock)) fail('Controlled resume requires the preserved RUN_LOCK.', 'RUN_LOCK_MISSING')
      const lock = parseJsonRejectingDuplicateKeys(await readFile(paths.lock, 'utf8'))
      if (lock.protocolId !== V3_PROTOCOL_ID || lock.stage !== 1 || lock.invocationId !== invocationId || lock.timestamp !== timestamp || lock.runnerVersion !== V3_STAGE1_RUNNER_VERSION || lock.exclusionManifestHash !== exclusionManifestHash) fail('Controlled resume context differs from RUN_LOCK.', 'RUN_CONTEXT_MISMATCH')
      await verifyRecoveredV3WalContext({ frozen, records: recovered.records, invocationId, timestamp, planPath: paths.plan })
    }
  } catch (error) {
    return { status: OPERATIONALLY_INCONCLUSIVE, reason: error.code ?? 'RUN_LOCK_FAILURE', dispatchedRequests: 0, paths }
  }

  let dispatch = null
  try { dispatch = normalizeTransport(transport) } catch (error) {
    return { status: OPERATIONALLY_INCONCLUSIVE, reason: error.code, dispatchedRequests: 0, paths }
  }
  let dispatchedRequests = 0
  let lastDispatchStart = null
  let active = 0
  let maxConcurrency = 0
  const pacedTransport = {
    async dispatch(request) {
      if (lastDispatchStart !== null) {
        let current = monotonicNow()
        if (!Number.isFinite(current)) fail('Monotonic clock returned a non-finite value.', 'PACING_INVARIANT_FAILURE')
        let elapsed = current - lastDispatchStart
        while (elapsed < V3_STAGE1_MIN_DISPATCH_INTERVAL_MS) {
          await sleep(V3_STAGE1_MIN_DISPATCH_INTERVAL_MS - elapsed)
          current = monotonicNow()
          if (!Number.isFinite(current)) fail('Monotonic clock returned a non-finite value.', 'PACING_INVARIANT_FAILURE')
          elapsed = current - lastDispatchStart
        }
      }
      const startedAt = monotonicNow()
      if (!Number.isFinite(startedAt) || (lastDispatchStart !== null && startedAt - lastDispatchStart < V3_STAGE1_MIN_DISPATCH_INTERVAL_MS)) {
        fail('Monotonic dispatch pacing invariant failed.', 'PACING_INVARIANT_FAILURE')
      }
      lastDispatchStart = startedAt
      dispatchedRequests++
      active++
      maxConcurrency = Math.max(maxConcurrency, active)
      onEvent({ type: 'dispatch-start', request, startedAt })
      try { return await dispatch(request) } finally { active-- }
    },
  }

  const metadata = async (status, reason = null, extra = {}) => {
    try {
      await atomicWriteArtifact(paths.metadata, { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId, timestamp, exclusionManifestHash, status, reason, dispatchedRequests, ...extra }, { onStep: (step) => onArtifactStep(step, paths.metadata) })
    } catch { /* The primary durability failure remains authoritative. */ }
  }
  const stop = async (status, reason, extra = {}) => {
    await metadata(status, reason, extra)
    return { status, reason, dispatchedRequests, maxConcurrency, paths, ...extra }
  }

  const requests = []
  const corpus = []
  const gates = []
  const fetchPage = async (cellId, page, phase, paginationPlan) => {
    const options = phase === 'page1' ? { phase } : { phase, paginationPlan }
    const request = buildAnnualPageRequest(frozen, cellId, page, options)
    const identity = buildV3UniverseRequestIdentity({ frozen, request, invocationId, timestamp, phase, paginationPlan })
    let execution
    try {
      execution = await executeRequest({
        walPath: paths.wal,
        identity,
        prepareDispatch: async () => {
          validateAnnualRequest(frozen, request, options)
          await beforeDispatch(request)
          return request
        },
        transport: pacedTransport,
        parseResponse: (wire) => {
          const response = parseV3DiscoveryWireResponse(wire)
          const validation = phase === 'page1'
            ? evaluatePage1Gate(request, response)
            : validateLaterPageResponse(frozen, paginationPlan, request, response)
          if (validation.status === V3_STATUSES.inconclusive) fail('Malformed V3 discovery payload.', 'INVALID_DISCOVERY_PAYLOAD')
          return response
        },
        onStep: (step) => onWalStep(step, { request, identity }),
      })
    } catch (error) {
      const afterFailure = await recoverWal(paths.wal)
      const attempt = afterFailure.records?.length ? classifyAttempt(afterFailure.records, identity.attemptId) : null
      return { failed: true, reason: attempt?.status === 'UNKNOWN_IN_FLIGHT' ? 'UNKNOWN_IN_FLIGHT' : (error.code ?? 'WAL_OR_TRANSPORT_FAILURE') }
    }
    if (execution.status !== 'COMPLETED') return { failed: true, reason: execution.status }
    requests.push(request)
    corpus.push({ cellId, requestedPage: page, response: execution.output })
    onEvent({ type: 'page-complete', cellId, page, replayed: execution.replayed === true })
    return { failed: false, request, response: execution.output }
  }

  for (const cell of frozen.cells) {
    const fetched = await fetchPage(cell.cellId, 1, 'page1')
    if (fetched.failed) return stop(OPERATIONALLY_INCONCLUSIVE, fetched.reason)
    const gate = evaluatePage1Gate(fetched.request, fetched.response)
    if (gate.status === V3_STATUSES.inconclusive) return stop(OPERATIONALLY_INCONCLUSIVE, 'INVALID_DISCOVERY_PAYLOAD')
    if (gate.status === V3_STATUSES.empty || gate.status === V3_STATUSES.budget) return stop(gate.status, gate.status, { blockedCell: cell.cellId, totalPages: fetched.response.total_pages })
    gates.push(gate)
  }
  onEvent({ type: 'page1-gate-complete' })

  let paginationPlan
  try {
    paginationPlan = buildPaginationPlan(frozen, gates)
    verifyPaginationPlan(frozen, paginationPlan)
    const stored = await atomicPersistOnceOrVerify(paths.plan, planArtifact(paginationPlan), onArtifactStep)
    paginationPlan = verifyPlanArtifact(frozen, stored)
    onEvent({ type: 'pagination-plan-persisted', paginationPlanHash: paginationPlan.paginationPlanHash })
  } catch (error) {
    return stop(OPERATIONALLY_INCONCLUSIVE, error.code ?? 'PAGINATION_PLAN_PERSISTENCE_FAILURE')
  }

  for (const entry of paginationPlan.entries) {
    for (const page of entry.requiredPages.slice(1)) {
      const fetched = await fetchPage(entry.cellId, page, 'page2', paginationPlan)
      if (fetched.failed) return stop(OPERATIONALLY_INCONCLUSIVE, fetched.reason)
      let validation
      try { validation = validateLaterPageResponse(frozen, paginationPlan, fetched.request, fetched.response) } catch (error) {
        return stop(OPERATIONALLY_INCONCLUSIVE, error.code ?? 'INVALID_DISCOVERY_PAYLOAD')
      }
      if (validation.status === V3_STATUSES.inconclusive) return stop(OPERATIONALLY_INCONCLUSIVE, 'INVALID_DISCOVERY_PAYLOAD')
      if (validation.status === V3_STATUSES.drift) return stop(V3_STATUSES.drift, V3_STATUSES.drift, { blockedCell: entry.cellId, page })
    }
  }

  let sourceSnapshot
  try {
    verifyCorpusCompleteness(frozen, paginationPlan, requests, corpus)
    sourceSnapshot = createV3SourceSnapshot(frozen, paginationPlan, requests, corpus)
    verifyV3SourceSnapshot(sourceSnapshot)
    const stored = await atomicPersistOnceOrVerify(paths.snapshot, sourceSnapshot, onArtifactStep)
    verifyV3SourceSnapshot(stored)
    sourceSnapshot = stored
    onEvent({ type: 'source-snapshot-persisted', sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash })
  } catch (error) {
    return stop(OPERATIONALLY_INCONCLUSIVE, error.code ?? 'SOURCE_SNAPSHOT_PERSISTENCE_FAILURE')
  }

  let selection
  try {
    onEvent({ type: 'post-freeze-selection-start' })
    selection = executeV3PostFreezeSelection({ frozen, paginationPlan, sourceSnapshot, exclusionManifest })
  } catch (error) {
    return stop(OPERATIONALLY_INCONCLUSIVE, error.code ?? 'POST_FREEZE_SELECTION_FAILURE')
  }
  if (selection.status !== V3_STATUSES.complete) return stop(selection.status, selection.status, { sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash })

  try {
    await atomicPersistOnceOrVerify(paths.registry, selection, onArtifactStep)
    onEvent({ type: 'candidate-registry-persisted', finalCandidateCount: selection.finalCandidateCount })
  } catch (error) {
    return stop(OPERATIONALLY_INCONCLUSIVE, error.code ?? 'CANDIDATE_REGISTRY_PERSISTENCE_FAILURE', { sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash })
  }
  await metadata(V3_STATUSES.complete, null, { sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash, finalCandidateCount: selection.finalCandidateCount })
  return { status: V3_STATUSES.complete, dispatchedRequests, maxConcurrency, paginationPlan, sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash, selection, paths }
}
