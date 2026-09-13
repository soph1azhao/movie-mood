import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchTmdbMovie, normalizePipelineTmdbFacts, redactSecret, TMDB_FACTS_SCHEMA_VERSION, TMDB_REQUEST_VERSION } from '../adapters/tmdbProvider.ts'
import { atomicWriteArtifact } from './c1bV2Stage0.mjs'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { validateMovieFacts } from './validateBatch.mjs'
import { ACQUISITION_TARGET, DEFAULT_QUEUE_PATHS, Scale500QueueError, buildScale500AcquisitionQueue } from './scale500AcquisitionQueue.mjs'

export { ACQUISITION_TARGET }
export const ACQUISITION_AUTHORIZATION_FLAG = '--execute-authorized-scale-500-acquisition'
export const ACQUISITION_STATE_SCHEMA_VERSION = 'scale-500-acquisition-state.v1'
export const ACQUISITION_TMDB_CACHE_ROOT = `catalogue-pipeline/cache/tmdb/${TMDB_REQUEST_VERSION}`
export const ACQUISITION_OUTPUT_ROOT = 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1'

// Candidate states
export const ACQUISITION_STATES = Object.freeze({
  pending: 'PENDING',
  fetching: 'FETCHING',
  uncertain: 'UNCERTAIN_PRIOR_DISPATCH',
  httpFailed: 'HTTP_FAILED',
  factualComplete: 'FACTUAL_COMPLETE',
  factualFailed: 'FACTUAL_FAILED',
  evidenceComplete: 'EVIDENCE_COMPLETE',
  evidenceFailed: 'EVIDENCE_FAILED',
})

// Only EVIDENCE_COMPLETE counts toward the acquisition target
const READY_STATE = ACQUISITION_STATES.evidenceComplete
const TERMINAL_STATES = new Set([
  ACQUISITION_STATES.evidenceComplete,
  ACQUISITION_STATES.httpFailed,
  ACQUISITION_STATES.factualFailed,
  ACQUISITION_STATES.evidenceFailed,
  ACQUISITION_STATES.uncertain,
])

export class Scale500AcquisitionError extends Error {
  constructor(message, { code = 'SCALE_500_ACQUISITION_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'Scale500AcquisitionError'
    this.code = code
    this.details = details
  }
}
const fail = (message, code, details = {}) => { throw new Scale500AcquisitionError(message, { code, details }) }

async function fileExists(path) {
  try { await readFile(path); return true } catch { return false }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

async function writeJsonAtomic(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await atomicWriteArtifact(path, value)
}

function paths(root) {
  const outputRoot = resolve(root, ACQUISITION_OUTPUT_ROOT)
  return {
    queuePath: resolve(root, DEFAULT_QUEUE_PATHS.queueOutput),
    statePath: resolve(outputRoot, 'acquisition-state.json'),
    factualSnapshotPath: resolve(outputRoot, 'factual-snapshot.json'),
    evidencePacketDir: resolve(outputRoot, 'evidence-packets'),
    tmdbCacheRoot: resolve(root, ACQUISITION_TMDB_CACHE_ROOT),
    outputRoot,
  }
}

function cachePathFor(tmdbCacheRoot, tmdbId) {
  return resolve(tmdbCacheRoot, `${tmdbId}.json`)
}

/**
 * Preflight: zero HTTP, reads queue and state, returns summary.
 */
export async function buildAcquisitionPreflight({ root = process.cwd(), readJsonFile = readJson, exists = fileExists, targetReadyCount = ACQUISITION_TARGET } = {}) {
  const p = paths(root)

  if (!(await exists(p.queuePath))) {
    fail('Acquisition queue not found. Run loadAndBuildScale500AcquisitionQueue first.', 'QUEUE_NOT_FOUND')
  }

  const queue = await readJsonFile(p.queuePath)
  if (!queue?.queue || !Array.isArray(queue.queue)) fail('Acquisition queue is malformed.', 'QUEUE_MALFORMED')

  let state = null
  if (await exists(p.statePath)) state = await readJsonFile(p.statePath)

  const stateMap = new Map(Object.entries(state?.candidates ?? {}))
  if (state && state.queueHash !== queue.queueHash) fail('Persisted acquisition state queue identity drift.', 'QUEUE_IDENTITY_MISMATCH')
  const readyCount = [...stateMap.values()].filter((s) => s.status === READY_STATE).length
  const pendingCount = queue.queue.filter((e) => {
    const s = stateMap.get(e.candidateId)
    return !s || s.status === ACQUISITION_STATES.pending
  }).length
  const primaryPending = queue.queue.filter((e) => e.reserveTier === 'primary').filter((e) => {
    const s = stateMap.get(e.candidateId)
    return !s || s.status === ACQUISITION_STATES.pending
  }).length

  return {
    executionAuthorized: false,
    queueHash: queue.queueHash,
    acquisitionTarget: targetReadyCount,
    totalQueued: queue.composition.totalQueued,
    primaryCandidates: queue.composition.primaryCandidates,
    reserveCandidates: queue.composition.reserveCandidates,
    readyCount,
    remainingToTarget: Math.max(0, targetReadyCount - readyCount),
    targetMet: readyCount >= targetReadyCount,
    primaryPendingCount: primaryPending,
    totalPendingCount: pendingCount,
    currentInvocationHttpRequests: state?.currentInvocationHttpRequests ?? 0,
    totalHttpRequests: state?.totalHttpRequests ?? 0,
    invocationCount: state?.invocationCount ?? 0,
    uncertainCount: [...stateMap.values()].filter((s) => s.status === ACQUISITION_STATES.uncertain || s.status === ACQUISITION_STATES.fetching).length,
  }
}

/**
 * Resume-safe, trancheable acquisition runner.
 * Processes candidates from the ranked queue, persisting after each.
 * Stops when readyCount >= ACQUISITION_TARGET or budgets are exhausted.
 *
 * @param {{
 *   root?: string,
 *   token: string,
 *   maxFreshCandidates: number,
 *   maxHttpRequests: number,
 *   fetchFn?: typeof fetch,
 *   delayFn?: (ms: number) => Promise<void>,
 *   readJsonFile?: typeof readJson,
 *   writeJsonFile?: typeof writeJsonAtomic,
 *   exists?: typeof fileExists,
 *   now?: () => number,
 * }} opts
 */
export async function runScale500FactualAcquisition({
  root = process.cwd(),
  token,
  maxFreshCandidates,
  maxHttpRequests,
  targetReadyCount = ACQUISITION_TARGET,
  fetchFn = globalThis.fetch,
  delayFn = (ms) => new Promise((res) => setTimeout(res, ms)),
  readJsonFile = readJson,
  writeJsonFile = writeJsonAtomic,
  exists = fileExists,
  now = () => Date.now(),
} = {}) {
  if (!token?.trim()) fail('TMDB_READ_ACCESS_TOKEN is required.', 'MISSING_TMDB_TOKEN')
  if (!Number.isInteger(maxFreshCandidates) || maxFreshCandidates < 0) fail('maxFreshCandidates must be a non-negative integer.', 'INVALID_BUDGET')
  if (!Number.isInteger(maxHttpRequests) || maxHttpRequests < 0) fail('maxHttpRequests must be a non-negative integer.', 'INVALID_BUDGET')

  const p = paths(root)
  if (!(await exists(p.queuePath))) fail('Acquisition queue not found.', 'QUEUE_NOT_FOUND')

  const queue = await readJsonFile(p.queuePath)
  if (!queue?.queue || !Array.isArray(queue.queue)) fail('Acquisition queue is malformed.', 'QUEUE_MALFORMED')

  // Load or initialize state
  let state = null
  if (await exists(p.statePath)) state = await readJsonFile(p.statePath)
  if (state && state.queueHash !== queue.queueHash) fail('Persisted acquisition state queue identity drift.', 'QUEUE_IDENTITY_MISMATCH')

  const candidates = state?.candidates ?? {}
  const stateMap = new Map(Object.entries(candidates))

  // Entering transport makes the outcome ambiguous until a response is durably recorded.
  // Never silently redispatch a candidate found at this boundary on resume.
  let interruptedCount = 0
  for (const [candidateId, candidateState] of stateMap) {
    if (candidateState.status === ACQUISITION_STATES.fetching) {
      candidateState.status = ACQUISITION_STATES.uncertain
      candidateState.events = [...(candidateState.events ?? []), { type: 'UNCERTAIN_ON_RESUME', priorStatus: 'FETCHING', reason: 'TRANSPORT_OUTCOME_UNKNOWN' }]
      interruptedCount += 1
    }
  }

  let readyCount = [...stateMap.values()].filter((s) => s.status === READY_STATE).length
  let invocationHttpRequests = 0
  let freshStarted = 0

  const currentState = {
    schemaVersion: ACQUISITION_STATE_SCHEMA_VERSION,
    queueHash: queue.queueHash,
    acquisitionTarget: targetReadyCount,
    invocationCount: (state?.invocationCount ?? 0) + 1,
    totalHttpRequests: state?.totalHttpRequests ?? 0,
    currentInvocationHttpRequests: 0,
    interruptedOnResume: interruptedCount,
    candidates: Object.fromEntries(stateMap),
  }

  const persist = async () => {
    currentState.currentInvocationHttpRequests = invocationHttpRequests
    currentState.readyCount = readyCount
    currentState.targetMet = readyCount >= targetReadyCount
    await writeJsonFile(p.statePath, currentState)
  }

  await mkdir(p.evidencePacketDir, { recursive: true })
  await persist()

  // Track primary quota per cell to prevent cross-cell reserve substitution
  const cellTargetQuotas = new Map()
  for (const entry of queue.queue) {
    if (entry.reserveTier === 'primary' && entry.cellKey) {
      cellTargetQuotas.set(entry.cellKey, (cellTargetQuotas.get(entry.cellKey) ?? 0) + 1)
    }
  }

  // Count currently ready candidates per cell
  const readyPerCell = new Map()
  for (const [candidateId, candidateState] of stateMap) {
    if (candidateState.status === READY_STATE) {
      const qEntry = queue.queue.find((e) => e.candidateId === candidateId)
      const cellKey = qEntry?.cellKey ?? candidateState.cellKey
      if (cellKey) {
        readyPerCell.set(cellKey, (readyPerCell.get(cellKey) ?? 0) + 1)
      }
    }
  }

  for (const entry of queue.queue) {
    // Auto-stop: target satisfied
    if (readyCount >= targetReadyCount) break
    // Budget: no more HTTP budget
    if (invocationHttpRequests >= maxHttpRequests) break

    const { candidateId, tmdbId, cellKey } = entry
    let candidateState = stateMap.get(candidateId)

    // Skip terminal states
    if (candidateState && TERMINAL_STATES.has(candidateState.status)) continue

    // Reserve candidate check: only attempt reserves if candidate's cell has NOT met its quota
    if (entry.reserveTier === 'reserve') {
      if (readyCount >= targetReadyCount) break
      const cellQuota = cellTargetQuotas.get(cellKey) ?? 0
      const cellReady = readyPerCell.get(cellKey) ?? 0
      if (cellReady >= cellQuota) {
        // This cell already met its primary quota; never use its reserves to substitute for other cells
        continue
      }
    }

    // Fresh candidate budget
    if (!candidateState || candidateState.status === ACQUISITION_STATES.pending) {
      if (freshStarted >= maxFreshCandidates) continue
      freshStarted += 1
    }

    // Initialize state if new
    if (!candidateState) {
      candidateState = {
        candidateId,
        tmdbId,
        cellKey: entry.cellKey ?? null,
        decade: entry.decade,
        band: entry.band,
        languageGroup: entry.languageGroup,
        selectionRank: entry.selectionRank,
        reserveTier: entry.reserveTier,
        status: ACQUISITION_STATES.pending,
        httpRequests: 0,
        events: [],
      }
      stateMap.set(candidateId, candidateState)
      currentState.candidates[candidateId] = candidateState
    }

    // A durable local cache hit is resolved before the dispatch boundary.
    const fetchedAt = new Date().toISOString()
    let tmdbResponse = null
    const cachePath = cachePathFor(p.tmdbCacheRoot, tmdbId)
    const cacheHit = await exists(cachePath)

    if (cacheHit) {
      const cached = await readJsonFile(cachePath)
      tmdbResponse = cached?.response ?? cached
      candidateState.events.push({ type: 'CACHE_HIT', cachePath })
    } else {
      // Durable dispatch intent. If the process stops before HTTP_SUCCESS/HTTP_FAILED,
      // resume converts FETCHING to UNCERTAIN_PRIOR_DISPATCH and refuses redispatch.
      candidateState.status = ACQUISITION_STATES.fetching
      candidateState.httpRequests = (candidateState.httpRequests ?? 0) + 1
      invocationHttpRequests += 1
      currentState.totalHttpRequests += 1
      candidateState.events = [...(candidateState.events ?? []), { type: 'HTTP_DISPATCH', ordinal: candidateState.httpRequests }]
      await persist()
      try {
        // One adapter attempt per accounted request keeps the invocation cap exact.
        tmdbResponse = await fetchTmdbMovie({ tmdbId, token, fetchFn, delayFn, maxAttempts: 1 })
        // Write raw response to TMDB cache
        await mkdir(resolve(cachePath, '..'), { recursive: true })
        await writeJsonFile(cachePath, { requestVersion: TMDB_REQUEST_VERSION, tmdbId, response: tmdbResponse })
        candidateState.events.push({ type: 'HTTP_SUCCESS' })
      } catch (error) {
        const responseKnown = Number.isInteger(error?.status)
        candidateState.status = responseKnown ? ACQUISITION_STATES.httpFailed : ACQUISITION_STATES.uncertain
        candidateState.httpFailure = { code: error?.code ?? 'TMDB_FETCH_FAILED', status: error?.status ?? null, message: error?.message ?? String(error) }
        candidateState.events.push(responseKnown
          ? { type: 'HTTP_FAILED', code: candidateState.httpFailure.code, status: error.status }
          : { type: 'UNCERTAIN', code: candidateState.httpFailure.code, reason: 'TRANSPORT_OUTCOME_UNKNOWN' })
        await persist()
        continue
      }
    }

    // Normalize facts — normalizePipelineTmdbFacts may throw TmdbSyncError for hard data
    // defects (wrong ID, missing runtime, etc.); treat those as FACTUAL_FAILED
    let facts
    try {
      facts = normalizePipelineTmdbFacts(tmdbResponse, tmdbId, { fetchedAt })
    } catch (normError) {
      candidateState.status = ACQUISITION_STATES.factualFailed
      candidateState.factualFailure = { code: normError?.code ?? 'NORMALIZATION_ERROR', message: normError?.message ?? String(normError) }
      candidateState.events.push({ type: 'FACTUAL_FAILED', reason: 'NORMALIZATION_THREW', message: normError?.message })
      await persist()
      continue
    }

    const factualValidation = validateMovieFacts({
      candidateId,
      candidateTitle: entry.title,
      candidateYear: entry.year,
      ...facts,
    })

    if (!factualValidation.ok) {
      candidateState.status = ACQUISITION_STATES.factualFailed
      candidateState.factualFailure = { hardFailures: factualValidation.hardFailures }
      candidateState.events.push({ type: 'FACTUAL_FAILED', hardFailures: factualValidation.hardFailures?.length ?? 0 })
      await persist()
      continue
    }

    candidateState.status = ACQUISITION_STATES.factualComplete
    candidateState.factsHash = facts.factsHash
    candidateState.events.push({ type: 'FACTUAL_COMPLETE', factsHash: facts.factsHash })

    // Write facts to cumulative factual snapshot
    await appendFactToSnapshot(p.factualSnapshotPath, { candidateId, candidateTitle: entry.title, candidateYear: entry.year, ...facts }, readJsonFile, writeJsonFile, exists)

    // Build and validate evidence packet (overview-first policy)
    const { packet, reviewFlags } = buildEvidencePacket({
      candidateId,
      facts: { candidateId, candidateTitle: entry.title, candidateYear: entry.year, ...facts },
      tmdbOverview: facts.overview,
      keywordAssessment: { useful: false, selected: [] },
    })

    if (reviewFlags.length > 0) {
      candidateState.status = ACQUISITION_STATES.evidenceFailed
      candidateState.evidenceFailure = { reviewFlags }
      candidateState.events.push({ type: 'EVIDENCE_FAILED', flagCount: reviewFlags.length })
      await persist()
      continue
    }

    // Write evidence packet
    const evidencePacketPath = resolve(p.evidencePacketDir, `${candidateId}.json`)
    await writeJsonFile(evidencePacketPath, packet)

    candidateState.status = ACQUISITION_STATES.evidenceComplete
    candidateState.evidencePacketHash = packet.inputHash
    candidateState.evidencePacketPath = evidencePacketPath
    candidateState.events.push({ type: 'EVIDENCE_COMPLETE', evidencePacketHash: packet.inputHash })

    readyCount += 1
    if (entry.cellKey) {
      readyPerCell.set(entry.cellKey, (readyPerCell.get(entry.cellKey) ?? 0) + 1)
    }
    await persist()
  }

  // Final persist with summary
  currentState.summary = {
    readyCount,
    targetMet: readyCount >= targetReadyCount,
    remainingToTarget: Math.max(0, targetReadyCount - readyCount),
    freshStartedThisRun: freshStarted,
    invocationHttpRequests,
    totalHttpRequests: currentState.totalHttpRequests,
    statusBreakdown: countStatuses(stateMap),
  }
  await persist()

  return {
    readyCount,
    targetMet: readyCount >= targetReadyCount,
    remainingToTarget: Math.max(0, targetReadyCount - readyCount),
    freshStartedThisRun: freshStarted,
    invocationHttpRequests,
    summary: currentState.summary,
  }
}

function countStatuses(stateMap) {
  const counts = {}
  for (const state of stateMap.values()) {
    counts[state.status] = (counts[state.status] ?? 0) + 1
  }
  return counts
}

async function appendFactToSnapshot(snapshotPath, fact, readJsonFile, writeJsonFile, exists) {
  let snapshot = { schemaVersion: TMDB_FACTS_SCHEMA_VERSION, facts: [] }
  if (await exists(snapshotPath)) snapshot = await readJsonFile(snapshotPath)
  if (snapshot?.schemaVersion !== TMDB_FACTS_SCHEMA_VERSION || !Array.isArray(snapshot.facts)) {
    fail('Existing factual snapshot is malformed; refusing to overwrite it.', 'FACTUAL_SNAPSHOT_MALFORMED')
  }
  // Remove existing entry for this candidateId if any (idempotent)
  snapshot.facts = snapshot.facts.filter((f) => f.candidateId !== fact.candidateId)
  snapshot.facts.push(fact)
  await writeJsonFile(snapshotPath, snapshot)
}

function integerFlag(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || !/^(0|[1-9]\d*)$/.test(argv[index + 1] ?? '')) {
    fail(`Missing or invalid ${name}.`, 'INVALID_BUDGET')
  }
  return Number(argv[index + 1])
}

export async function launchScale500FactualAcquisition(argv = process.argv.slice(2), options = {}) {
  const targetReadyCount = argv.includes('--target-ready-count')
    ? integerFlag(argv, '--target-ready-count')
    : (options.targetReadyCount ?? ACQUISITION_TARGET)

  // --ready-count mode: just print ready count from state (zero network)
  if (argv.includes('--ready-count')) {
    const preflight = await buildAcquisitionPreflight({ ...options, targetReadyCount })
    console.log(JSON.stringify({ readyCount: preflight.readyCount, remainingToTarget: preflight.remainingToTarget, targetMet: preflight.targetMet }, null, 2))
    return { executionAuthorized: false, preflight }
  }

  const preflight = await buildAcquisitionPreflight({ ...options, targetReadyCount })

  if (!argv.includes(ACQUISITION_AUTHORIZATION_FLAG)) {
    return { executionAuthorized: false, preflight }
  }

  const maxFreshCandidates = integerFlag(argv, '--max-fresh-candidates')
  const maxHttpRequests = integerFlag(argv, '--max-http-requests')
  const token = (options.env ?? process.env).TMDB_READ_ACCESS_TOKEN
  if (!token) fail('TMDB_READ_ACCESS_TOKEN environment variable is required.', 'MISSING_TMDB_TOKEN')

  const result = await runScale500FactualAcquisition({ ...options, token, maxFreshCandidates, maxHttpRequests, targetReadyCount })
  return { executionAuthorized: true, preflight, ...result }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  launchScale500FactualAcquisition().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`${redactSecret(error.message, process.env.TMDB_READ_ACCESS_TOKEN)} [${error.code ?? 'ERROR'}]`)
    process.exitCode = 1
  })
}
