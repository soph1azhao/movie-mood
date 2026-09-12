import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { atomicWriteArtifact, canonicalSha256, classifyAttempt, recoverWal } from '../scripts/c1bV2Stage0.mjs'

export const V4_STAGE2_CLOSURE_PATH = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v4-stage2-closure.v1.json'
export const V4_STAGE2_LIVE_ROOT = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v4/stage2-wikipedia-viability-live-v1'
export const V4_REGISTRATION_COMMIT = '8b7e4875eb9ca8c6a4958b17b35735b85aa24f63'
export const V4_RUNNER_COMMIT = 'a413206'

export class V4Stage2ClosureError extends Error {
  constructor(message, code = 'V4_STAGE2_CLOSURE_ERROR', details) { super(message); this.name = 'V4Stage2ClosureError'; this.code = code; this.details = details }
}
const fail = (message, code, details) => { throw new V4Stage2ClosureError(message, code, details) }
const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const exists = async (path) => { try { await readFile(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

async function artifactHash(path, { optional = false } = {}) {
  if (optional && !await exists(path)) return { path: basename(path), present: false }
  return { path: basename(path), present: true, rawSha256: rawSha256(await readFile(path)) }
}

async function safeDirectoryHashes(path) {
  let entries
  try { entries = await readdir(path, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return { present: false, entries: [] }; throw error }
  const hashes = []
  for (const entry of entries) if (entry.isFile()) {
    const bytes = await readFile(resolve(path, entry.name))
    hashes.push({ path: entry.name, rawSha256: rawSha256(bytes) })
  }
  return { present: true, entries: hashes.sort((a, b) => a.path.localeCompare(b.path)) }
}

function assertClosureSafe(value) {
  const prohibited = new Set(['text', 'html', 'body', 'rawMediaWikiSection', 'rawWikipediaProse'])
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node)) {
      if (prohibited.has(key)) fail(`Closure contains prohibited raw-prose field: ${key}`, 'RAW_PROSE_IN_CLOSURE')
      walk(child)
    }
  }
  walk(value)
}

export async function deriveV4Stage2Closure({ root = process.cwd(), liveRoot = resolve(root, V4_STAGE2_LIVE_ROOT) } = {}) {
  const paths = {
    wal: resolve(liveRoot, 'execution.wal'), candidates: resolve(liveRoot, 'candidate-status.json'), metadata: resolve(liveRoot, 'run-metadata.json'),
    exposure: resolve(liveRoot, 'exposure-metadata.json'), coverage: resolve(liveRoot, 'coverage-result.json'), privateEvidence: resolve(liveRoot, 'private-evidence.json'),
  }
  if (await exists(paths.coverage)) fail('Successful coverage artifact exists; cannot close as incomplete.', 'UNEXPECTED_COVERAGE_ARTIFACT')
  const recovered = await recoverWal(paths.wal)
  if (recovered.status !== 'VALID') fail('WAL is not valid.', 'WAL_INVALID', recovered.status)
  const candidates = await readJson(paths.candidates); const metadata = await readJson(paths.metadata)
  const rows = candidates.candidates
  if (!Array.isArray(rows) || rows.length !== 3 || candidates.determinateCandidateCount !== 3) fail('Candidate state is not exactly three determinate rows.', 'CANDIDATE_STATE_MISMATCH')
  if (rows.some((row) => row.terminalStatus !== 'NON_VIABLE')) fail('A determinate candidate is not NON_VIABLE.', 'CANDIDATE_OUTCOME_MISMATCH')
  const counts = Object.fromEntries(['INTENT', 'RESPONSE', 'TERMINAL'].map((lifecycle) => [lifecycle, recovered.records.filter((record) => record.lifecycle === lifecycle).length]))
  if (recovered.records.length !== 33 || counts.INTENT !== 11 || counts.RESPONSE !== 11 || counts.TERMINAL !== 11) fail('WAL lifecycle counts do not match frozen closure facts.', 'WAL_COUNT_MISMATCH', counts)
  const attemptIds = [...new Set(recovered.records.map(({ attemptId }) => attemptId))]; const classifications = attemptIds.map((attemptId) => classifyAttempt(recovered.records, attemptId))
  const unknownInFlightCount = classifications.filter(({ status }) => status === 'UNKNOWN_IN_FLIGHT').length
  const completedAttemptCount = classifications.filter(({ status }) => status === 'COMPLETED').length
  if (unknownInFlightCount !== 0 || completedAttemptCount !== 11) fail('WAL attempt dispositions do not match frozen closure facts.', 'WAL_ATTEMPT_MISMATCH')
  const blockedResponse = recovered.records.find((record) => record.lifecycle === 'RESPONSE' && record.candidateId === 'tmdb:14924' && record.payload?.response?.status === 429)
  if (!blockedResponse) fail('No durable HTTP 429 response for TMDB 14924.', 'BLOCKER_RESPONSE_MISMATCH')
  if (metadata.status !== 'BLOCKED — COVERAGE EXECUTION INCOMPLETE' || metadata.reason !== 'FETCH_FAILED' || metadata.determinateCandidateCount !== 3 || metadata.dispatchedRequests !== 11 || metadata.replayCount !== 0 || metadata.unknownInFlightCount !== 0) fail('Run metadata does not report the frozen blocked state.', 'RUN_METADATA_MISMATCH')
  const protocol = await readJson(resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.json'))
  const bundle = await readJson(resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.contracts.json'))
  const executableClosure = await readJson(resolve(root, 'catalogue-pipeline/calibration/diagnostics/wikipedia-executable-closure.v1.json'))
  const closure = {
    closureId: 'phase5c-c1b-v4-stage2-closure.v1', protocolId: 'phase-5c-c1b-v-confirmatory.v4', stage: 2,
    closureKind: 'POST_EXECUTION_FORENSIC_CLOSURE', classification: 'OPERATIONALLY_INCONCLUSIVE', protocolStageStatus: 'BLOCKED — COVERAGE EXECUTION INCOMPLETE',
    execution: { started: true, completed: false, determinateCandidateCount: 3, requiredDeterminateCandidateCount: 180, viableCount: 0, nonViableCount: 3, coverageResultEmitted: false },
    blocker: { candidateTmdbId: 14924, category: 'TECHNICAL_TRANSPORT_FAILURE', httpStatus: blockedResponse.payload.response.status, failureCode: metadata.reason },
    wal: { valid: true, recordCount: recovered.records.length, ...counts, completedAttemptCount, unknownInFlightCount, replayCount: metadata.replayCount },
    downstream: { coverageInferenceAuthorized: false, humanGoldStarted: false, stage3Started: false, semanticEfficacyInferenceAvailable: false },
    prohibitedInterpretations: ['0/3 coverage estimate', 'GO', 'NO-GO', 'population-level Wikipedia viability inference'],
    recoveryDisposition: { liveRetryPerformed: false, liveRetryAuthorizedByThisClosure: false, runnerSemanticsModified: false, newRetryPolicyIntroduced: false, candidateReplacementPerformed: false },
    provenance: {
      registeredV4Commit: V4_REGISTRATION_COMMIT, runnerCommit: V4_RUNNER_COMMIT,
      protocolJcsSha256: canonicalSha256(protocol), contractsBundleHash: bundle.contractsBundleHash, executableClosureCanonicalSha256: canonicalSha256(executableClosure),
      liveArtifacts: {
        executionWal: await artifactHash(paths.wal), candidateStatus: await artifactHash(paths.candidates), runMetadata: await artifactHash(paths.metadata), exposureMetadata: await artifactHash(paths.exposure, { optional: true }),
        privateEvidence: await artifactHash(paths.privateEvidence, { optional: true }), responseCache: await safeDirectoryHashes(resolve(liveRoot, 'response-cache')), adapterCache: await safeDirectoryHashes(resolve(liveRoot, 'adapter-cache')),
      },
    },
  }
  assertClosureSafe(closure)
  return closure
}

export function verifyV4Stage2Closure({ closure, derived }) {
  assertClosureSafe(closure)
  if (canonicalSha256(closure) !== canonicalSha256(derived)) fail('Closure does not exactly match live forensic derivation.', 'CLOSURE_DERIVATION_MISMATCH')
  return { ok: true, canonicalSha256: canonicalSha256(closure) }
}

export async function writeV4Stage2Closure({ root = process.cwd(), outputPath = resolve(root, V4_STAGE2_CLOSURE_PATH), liveRoot } = {}) {
  const closure = await deriveV4Stage2Closure({ root, liveRoot })
  if (await exists(outputPath)) fail('Closure artifact already exists.', 'CLOSURE_ARTIFACT_EXISTS')
  await atomicWriteArtifact(outputPath, closure)
  return { closure, rawSha256: rawSha256(await readFile(outputPath)), canonicalSha256: canonicalSha256(closure) }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  writeV4Stage2Closure().then((result) => console.log(JSON.stringify({ rawSha256: result.rawSha256, canonicalSha256: result.canonicalSha256 }, null, 2))).catch((error) => { console.error(error); process.exitCode = 1 })
}
