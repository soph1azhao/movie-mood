// C1b-V3 Stage 1F: offline-only forensic verification and compact closure record.

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicWriteArtifact, canonicalize, classifyAttempt, parseJsonRejectingDuplicateKeys, recoverWal } from './c1bV2Stage0.mjs'
import { V3_PROTOCOL_ID, V3_STAGE1_CONTRACT_REF, V3_STATUSES, executeV3PostFreezeSelection, loadRegisteredV3Spec, verifyCorpusCompleteness, verifyPaginationPlan, verifyV3ExclusionManifest, verifyV3SourceSnapshot } from './c1bV3Stage1.mjs'
import { V3_STAGE1_RUNNER_VERSION, verifyRecoveredV3WalContext } from './c1bV3Stage1Runner.mjs'

export const V3_STAGE1_CLOSURE_RELATIVE = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-stage1-closure.v1.json'
export const V3_STAGE1_LIVE_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1'
const PRELIVE_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/pre-live-v1'
const EXPECTED_SNAPSHOT_HASH = 'sha256:9422ffa827f2e1d4f18e2fa8550302af0da28bfb9915b9eb67d81512a2e1b7d9'
const EXPECTED_EXCLUSION_HASH = 'sha256:8b7973b87d9d942946b558b4d1f0565253a54bc1ab020dfc3511fa5cf9e2887a'
const EXECUTION_BOUNDARY_COMMIT = '87e10719dc47aa440f334c52a0a498b6e4e164dc'
const PRELIVE_CHECKPOINT = '59faa1809bb974ff61366ce4c037fb494bb6b9e1'
const LIVE_HASHES = Object.freeze({
  RUN_LOCK: 'sha256:b2b97e656e72b6e521bd32f98195c800a4ca3e9fb5f3c83dca2df5d119412c0d',
  'candidate-registry.json': 'sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f',
  'execution.wal': 'sha256:7913f24ee537609c17aefd540ac7337450c51086c8e168dc20b9a160b90b8a74',
  'pagination-plan.json': 'sha256:b1a7ec12e9e94f03b0e0897475e2eb4b429541bf770db792f300d1267f5dc51f',
  'run-metadata.json': 'sha256:f915f5fe49d9500a8991c770e1f16377581454d153ca3bb1b1ab8b4bd56382f8',
  'source-snapshot.json': 'sha256:9e0b39e2bdff7bc768b90f39093124f0d4bb01a3b6eec89340fbbebe3f3032ac',
})
const PRELIVE_HASHES = Object.freeze({
  'exclusion-manifest.json': 'sha256:658d6b1888bf81c3f0e02dd93cd2d90cd111480522e78db18c2f91b095ec8841',
  'exclusion-provenance.json': 'sha256:2b36b3f5fcf9e8fa961dff420515f8f3126d8bccd0180c78da477cfe20420e73',
  'phase5c-c1b-v3-stage1-pre-live-gate.v1.json': 'sha256:e298fc685e7e4e0abaa2b54dc6309d323170659f865a3a775ce882e0b442a19c',
})

export class V3Stage1ClosureError extends Error {
  constructor(message, code = 'V3_STAGE1_CLOSURE_ERROR', details) { super(message); this.name = 'V3Stage1ClosureError'; this.code = code; this.details = details }
}
const fail = (message, code, details) => { throw new V3Stage1ClosureError(message, code, details) }
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const readJson = async (path) => parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))
const exactKeys = (value, keys) => canonicalize(Object.keys(value).sort()) === canonicalize([...keys].sort())

async function verifyRawSet(directory, expected) {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => !entry.isFile())) fail('Live artifact set contains a non-file entry.', 'LIVE_ARTIFACT_SET_MISMATCH')
  const actualNames = entries.map(({ name }) => name).sort()
  const expectedNames = Object.keys(expected).sort()
  if (canonicalize(actualNames) !== canonicalize(expectedNames)) fail('Live artifact set mismatch.', 'LIVE_ARTIFACT_SET_MISMATCH', { actualNames })
  const actual = {}
  for (const name of expectedNames) {
    actual[name] = rawSha256(await readFile(join(directory, name)))
    if (actual[name] !== expected[name]) fail('Live artifact raw hash mismatch.', 'LIVE_ARTIFACT_MUTATION', { name })
  }
  return actual
}

export async function verifyV3Stage1Closure({ root = process.cwd() } = {}) {
  const liveDir = resolve(root, V3_STAGE1_LIVE_RELATIVE)
  const preliveDir = resolve(root, PRELIVE_RELATIVE)
  const liveArtifactRawSha256 = await verifyRawSet(liveDir, LIVE_HASHES)
  const frozenStage1CArtifactRawSha256 = {}
  for (const [name, expected] of Object.entries(PRELIVE_HASHES)) {
    const actual = rawSha256(await readFile(join(preliveDir, name)))
    if (actual !== expected) fail('Frozen Stage-1C artifact mutation.', 'PRELIVE_ARTIFACT_MUTATION', { name })
    frozenStage1CArtifactRawSha256[name] = actual
  }
  const [lock, planArtifact, snapshot, registry, metadata, exclusionManifest, frozen] = await Promise.all([
    readJson(join(liveDir, 'RUN_LOCK')),
    readJson(join(liveDir, 'pagination-plan.json')),
    readJson(join(liveDir, 'source-snapshot.json')),
    readJson(join(liveDir, 'candidate-registry.json')),
    readJson(join(liveDir, 'run-metadata.json')),
    readJson(join(preliveDir, 'exclusion-manifest.json')),
    loadRegisteredV3Spec({ root }),
  ])
  const identity = { protocolId: V3_PROTOCOL_ID, stage: 1, invocationId: 'phase-5c-c1b-v3-stage1-recruitment-live-v1', runnerVersion: V3_STAGE1_RUNNER_VERSION, exclusionManifestHash: EXPECTED_EXCLUSION_HASH }
  if (!exactKeys(lock, [...Object.keys(identity), 'timestamp']) || Object.entries(identity).some(([key, value]) => lock[key] !== value)) fail('RUN_LOCK identity mismatch.', 'RUN_IDENTITY_MISMATCH')
  for (const key of ['protocolId', 'stage', 'invocationId', 'timestamp', 'exclusionManifestHash']) if (metadata[key] !== lock[key]) fail('Run metadata identity mismatch.', 'RUN_METADATA_MISMATCH', { key })
  verifyV3ExclusionManifest(exclusionManifest)
  if (exclusionManifest.exclusionManifestHash !== EXPECTED_EXCLUSION_HASH || exclusionManifest.exclusions.length !== 150) fail('Frozen exclusion identity mismatch.', 'EXCLUSION_MISMATCH')
  if (planArtifact.protocolId !== V3_PROTOCOL_ID || planArtifact.stage !== 1 || planArtifact.contractRef !== V3_STAGE1_CONTRACT_REF) fail('Pagination plan binding mismatch.', 'PAGINATION_PLAN_MISMATCH')
  const plan = planArtifact.paginationPlan
  verifyPaginationPlan(frozen, plan)

  const recovered = await recoverWal(join(liveDir, 'execution.wal'))
  if (recovered.status !== 'VALID') fail('WAL recovery did not produce a valid complete chain.', 'WAL_INVALID', { status: recovered.status })
  const attemptIds = [...new Set(recovered.records.map(({ attemptId }) => attemptId))]
  if (recovered.records.length !== 1626 || attemptIds.length !== 542) fail('WAL record/attempt count mismatch.', 'WAL_COUNT_MISMATCH')
  const lifecycleCounts = { INTENT: 0, RESPONSE: 0, TERMINAL: 0 }
  for (const record of recovered.records) lifecycleCounts[record.lifecycle] = (lifecycleCounts[record.lifecycle] ?? 0) + 1
  for (const attemptId of attemptIds) {
    const records = recovered.records.filter((record) => record.attemptId === attemptId)
    if (records.length !== 3 || records.map(({ lifecycle }) => lifecycle).join('|') !== 'INTENT|RESPONSE|TERMINAL' || classifyAttempt(recovered.records, attemptId).status !== 'COMPLETED') fail('WAL attempt lifecycle mismatch.', 'WAL_ATTEMPT_INCOMPLETE', { attemptId })
  }
  await verifyRecoveredV3WalContext({ frozen, records: recovered.records, invocationId: lock.invocationId, timestamp: lock.timestamp, planPath: join(liveDir, 'pagination-plan.json') })
  const intents = recovered.records.filter(({ lifecycle }) => lifecycle === 'INTENT')
  const page1Intents = intents.filter(({ requestPurpose }) => requestPurpose === 'page1-gate')
  const page2Intents = intents.filter(({ requestPurpose }) => requestPurpose === 'page2-enumeration')
  if (page1Intents.length !== 45 || page1Intents.map(({ scopeId }) => scopeId).join('|') !== Array.from({ length: 45 }, (_, index) => `stage1:year-${1980 + index}:page:1`).join('|')) fail('Page-1 request order mismatch.', 'REQUEST_CONTEXT_MISMATCH')
  const totalRequiredPages = plan.entries.reduce((sum, { requiredPages }) => sum + requiredPages.length, 0)
  const nonemptyAnnualCells = plan.entries.filter(({ total_pages }) => total_pages > 0).length
  if (totalRequiredPages !== 542 || page1Intents.length + page2Intents.length !== 542) fail('Required provider request total mismatch.', 'PAGINATION_TOTAL_MISMATCH')

  verifyV3SourceSnapshot(snapshot)
  verifyCorpusCompleteness(frozen, plan, snapshot.requestManifest, snapshot.rawResponseCorpus)
  if (snapshot.sourceSnapshotHash !== EXPECTED_SNAPSHOT_HASH || snapshot.paginationPlanHash !== plan.paginationPlanHash) fail('Source snapshot binding mismatch.', 'SOURCE_SNAPSHOT_MISMATCH')
  const reproduced = executeV3PostFreezeSelection({ frozen, paginationPlan: plan, sourceSnapshot: snapshot, exclusionManifest })
  if (canonicalize(reproduced) !== canonicalize(registry)) fail('Candidate registry is not deterministically reproducible.', 'REGISTRY_REPRODUCTION_MISMATCH')
  if (registry.status !== V3_STATUSES.complete || registry.finalCandidateCount !== 180 || new Set(registry.candidates.map(({ id }) => id)).size !== 180) fail('Candidate registry count/status mismatch.', 'REGISTRY_MISMATCH')
  const candidateQuotaCounts = { '1980-1989': 0, '1990-1999': 0, '2000-2009': 0, '2010-2019': 0, '2020-2024': 0 }
  for (const candidate of registry.candidates) {
    const year = Number(candidate.release_date.slice(0, 4))
    const stratum = year < 1990 ? '1980-1989' : year < 2000 ? '1990-1999' : year < 2010 ? '2000-2009' : year < 2020 ? '2010-2019' : '2020-2024'
    candidateQuotaCounts[stratum]++
  }
  if (canonicalize(candidateQuotaCounts) !== canonicalize({ '1980-1989': 24, '1990-1999': 24, '2000-2009': 33, '2010-2019': 45, '2020-2024': 54 })) fail('Candidate quota mismatch.', 'REGISTRY_QUOTA_MISMATCH')
  if (metadata.status !== V3_STATUSES.complete || metadata.reason !== null || metadata.dispatchedRequests !== 542 || metadata.sourceSnapshotHash !== EXPECTED_SNAPSHOT_HASH || metadata.finalCandidateCount !== 180) fail('Run metadata terminal state mismatch.', 'RUN_METADATA_MISMATCH')
  const checks = { liveArtifactSetExact: true, liveArtifactHashesExact: true, walValid: true, everyAttemptCompleted: true, requestContextValid: true, paginationPlanValid: true, sourceSnapshotValid: true, candidateRegistryReproduced: true, runMetadataConsistent: true, frozenStage1CEvidenceExact: true }
  return { lock, metadata, plan, snapshot, registry, liveArtifactRawSha256, frozenStage1CArtifactRawSha256, walRecordCount: recovered.records.length, walAttemptCount: attemptIds.length, lifecycleCounts, page1RequestCount: page1Intents.length, page2RequestCount: page2Intents.length, totalRequiredPages, nonemptyAnnualCells, aggregateSourceOccurrenceCount: snapshot.rawResponseCorpus.reduce((sum, row) => sum + row.response.results.length, 0), candidateQuotaCounts, checks }
}

export function buildV3Stage1ClosureRecord(verified) {
  return {
    artifactId: 'phase5c-c1b-v3-stage1-closure.v1', protocolId: V3_PROTOCOL_ID, stage: 1,
    invocationId: verified.lock.invocationId, runnerVersion: verified.lock.runnerVersion,
    executionBoundaryCommit: EXECUTION_BOUNDARY_COMMIT, preLiveCheckpoint: PRELIVE_CHECKPOINT,
    exclusionManifestHash: verified.lock.exclusionManifestHash, sourceSnapshotHash: verified.snapshot.sourceSnapshotHash,
    finalCandidateCount: verified.registry.finalCandidateCount, dispatchedRequests: verified.metadata.dispatchedRequests,
    walRecordCount: verified.walRecordCount, walAttemptCount: verified.walAttemptCount,
    lifecycleCounts: verified.lifecycleCounts, page1RequestCount: verified.page1RequestCount, page2RequestCount: verified.page2RequestCount,
    paginationPlanHash: verified.plan.paginationPlanHash, totalRequiredPages: verified.totalRequiredPages,
    nonemptyAnnualCells: verified.nonemptyAnnualCells, aggregateSourceOccurrenceCount: verified.aggregateSourceOccurrenceCount,
    terminalStatus: verified.metadata.status, terminalReason: verified.metadata.reason,
    liveArtifactRawSha256: verified.liveArtifactRawSha256, frozenStage1CArtifactRawSha256: verified.frozenStage1CArtifactRawSha256,
    candidateQuotaCounts: verified.candidateQuotaCounts, checks: verified.checks,
    networkCallsDuringClosure: 0, closureGeneratedBy: 'catalogue-pipeline/scripts/c1bV3Stage1Closure.mjs',
  }
}

export async function writeV3Stage1Closure({ root = process.cwd() } = {}) {
  const verified = await verifyV3Stage1Closure({ root })
  const record = buildV3Stage1ClosureRecord(verified)
  const path = resolve(root, V3_STAGE1_CLOSURE_RELATIVE)
  await atomicWriteArtifact(path, record)
  return { path, record, rawSha256: rawSha256(await readFile(path)) }
}
