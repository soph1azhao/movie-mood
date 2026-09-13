/**
 * buildSemanticCohort.mjs
 *
 * General cumulative Semantic-N cohort builder.
 *
 * Given:
 *   - A prior completed semantic run (e.g. Semantic-100) whose valid artifacts are imported
 *     by immutable reference (zero dispatches, no new token accounting)
 *   - New evidence-complete candidates from the Scale-500 acquisition state
 *
 * Produces a manifest for the next Semantic-N run that the existing
 * runAdaptiveSemanticBatch core can execute unchanged.
 *
 * Design constraints (from spec):
 *   - No copying, relabeling, or redispatch of existing valid artifacts
 *   - No new token accounting for imported records
 *   - New factual/evidence records become PENDING_HIGH only after their identities are frozen
 */
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { atomicWriteArtifact } from './c1bV2Stage0.mjs'
import { ADAPTIVE_STATES } from './adaptiveSemanticBatchCore.mjs'
import { ACQUISITION_STATES, ACQUISITION_OUTPUT_ROOT, buildAcquisitionPreflight } from './runScale500FactualAcquisition.mjs'

export const COHORT_SCHEMA_VERSION = 'semantic-cohort-manifest.v1'

export class SemanticCohortError extends Error {
  constructor(message, { code = 'SEMANTIC_COHORT_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'SemanticCohortError'
    this.code = code
    this.details = details
  }
}
const fail = (message, code, details = {}) => { throw new SemanticCohortError(message, { code, details }) }

async function fileExists(path) {
  try { await readFile(path); return true } catch { return false }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

/**
 * Build a Semantic-N cohort manifest by:
 * 1. Loading and verifying all valid artifacts from the prior semantic run
 * 2. Selecting new evidence-complete candidates from Scale-500 acquisition state
 * 3. Freezing a new cumulative batch manifest
 *
 * @param {{
 *   cohortId: string,          // e.g. 'kimi-k28-adaptive-semantic-150-v1'
 *   targetCount: number,       // e.g. 150
 *   priorRunId: string,        // e.g. 'kimi-k28-adaptive-semantic-100-v1'
 *   pipelineRoot?: string,
 *   readJsonFile?: Function,
 *   exists?: Function,
 * }} opts
 */
export async function buildSemanticCohortManifest({
  cohortId,
  targetCount,
  priorRunId,
  pipelineRoot = resolve('catalogue-pipeline'),
  readJsonFile = readJson,
  exists = fileExists,
} = {}) {
  if (!cohortId?.trim()) fail('cohortId is required.', 'MISSING_COHORT_ID')
  if (!Number.isInteger(targetCount) || targetCount <= 0) fail('targetCount must be a positive integer.', 'INVALID_TARGET_COUNT')
  if (!priorRunId?.trim()) fail('priorRunId is required.', 'MISSING_PRIOR_RUN_ID')

  // Load prior run manifest
  const priorManifestPath = resolve(pipelineRoot, 'generated/semantic/batches', priorRunId, 'manifest.json')
  if (!(await exists(priorManifestPath))) fail(`Prior run manifest not found: ${priorManifestPath}`, 'PRIOR_MANIFEST_NOT_FOUND')
  const priorManifest = await readJsonFile(priorManifestPath)

  // Load acquisition state for new evidence-complete candidates
  const acquisitionStatePath = resolve(pipelineRoot, ACQUISITION_OUTPUT_ROOT.replace('catalogue-pipeline/', ''), 'acquisition-state.json')
  const acquisitionEvidencePacketDir = resolve(pipelineRoot, ACQUISITION_OUTPUT_ROOT.replace('catalogue-pipeline/', ''), 'evidence-packets')

  if (!(await exists(acquisitionStatePath))) fail('Acquisition state not found. Run runScale500FactualAcquisition first.', 'ACQUISITION_STATE_NOT_FOUND')
  const acquisitionState = await readJsonFile(acquisitionStatePath)

  // Find evidence-complete candidates from acquisition
  // Collect imported states from the prior run (all IMPORTED_VALID or freshly generated valid)
  const priorStates = Object.values(priorManifest.states ?? {})
  const priorValid = priorStates.filter(
    (s) => [ADAPTIVE_STATES.imported, ADAPTIVE_STATES.highValid, ADAPTIVE_STATES.maxValid].includes(s.status)
  )

  const importedCount = priorValid.length
  if ([200, 300, 400, 500].includes(targetCount) && (priorStates.length !== priorValid.length || priorValid.length !== targetCount - 100)) {
    fail('Prior semantic checkpoint is not exactly the complete preceding 100-film cadence.', 'PRIOR_CHECKPOINT_INCOMPLETE', { stateCount: priorStates.length, validCount: priorValid.length, expected: targetCount - 100 })
  }
  const newSlotsNeeded = targetCount - importedCount

  // Only candidates not already present in the cumulative prior checkpoint are
  // eligible for the next 100-film tranche.
  const priorCandidateIds = new Set(priorValid.map((state) => state.candidateId))
  const evidenceComplete = Object.values(acquisitionState.candidates ?? {}).filter(
    (c) => c.status === ACQUISITION_STATES.evidenceComplete && c.evidencePacketHash && !priorCandidateIds.has(c.candidateId)
  )

  if (newSlotsNeeded <= 0) {
    fail(`Target count (${targetCount}) is not greater than prior imported count (${importedCount}).`, 'TARGET_COUNT_TOO_SMALL', { targetCount, importedCount })
  }

  if (evidenceComplete.length < newSlotsNeeded) {
    fail(`Not enough evidence-complete candidates (${evidenceComplete.length}) for target (${newSlotsNeeded} needed).`, 'INSUFFICIENT_EVIDENCE_COMPLETE', { available: evidenceComplete.length, needed: newSlotsNeeded })
  }

  // Select candidates in selectionRank order (deterministic)
  const evidenceSorted = [...evidenceComplete].sort((a, b) => (a.selectionRank ?? 0) - (b.selectionRank ?? 0))
  const selectedNew = evidenceSorted.slice(0, newSlotsNeeded)

  // Load evidence packets for new candidates
  const newCandidates = []
  for (const candidate of selectedNew) {
    const packetPath = resolve(acquisitionEvidencePacketDir, `${candidate.candidateId}.json`)
    if (!(await exists(packetPath))) {
      fail(`Evidence packet missing for candidate: ${candidate.candidateId}`, 'EVIDENCE_PACKET_MISSING', { candidateId: candidate.candidateId })
    }
    const packet = await readJsonFile(packetPath)
    if (packet.candidateId !== candidate.candidateId || packet.inputHash !== candidate.evidencePacketHash) {
      fail(`Evidence packet identity mismatch for candidate: ${candidate.candidateId}`, 'EVIDENCE_PACKET_MISMATCH', { candidateId: candidate.candidateId })
    }
    newCandidates.push({
      candidateId: candidate.candidateId,
      tmdbId: candidate.tmdbId,
      evidencePacketHash: packet.inputHash,
      disposition: 'PENDING_HIGH',
    })
  }

  // Build import references from prior valid states (reference only, no copy)
  const importedCandidates = priorValid.map((s) => ({
    candidateId: s.candidateId,
    tmdbId: s.tmdbId,
    evidencePacketHash: s.evidencePacketHash ?? s.lifetimeProvenance?.evidencePacketHash,
    disposition: 'IMPORTED_VALID',
    priorRunId,
    priorArtifactHash: s.artifactHash ?? s.lifetimeProvenance?.artifactHash,
  }))

  // Cohort hash covers all candidates and their dispositions (immutable identity)
  const cohortHash = `sha256:${stableHash([
    ...importedCandidates.map((c) => ({ candidateId: c.candidateId, tmdbId: c.tmdbId, evidencePacketHash: c.evidencePacketHash, disposition: c.disposition, priorArtifactHash: c.priorArtifactHash })),
    ...newCandidates,
  ])}`

  const manifestBody = {
    schemaVersion: COHORT_SCHEMA_VERSION,
    cohortId,
    priorRunId,
    targetCount,
    importedCount,
    newCount: newCandidates.length,
    totalCandidates: importedCount + newCandidates.length,
    cohortHash,
    importedCandidates,
    newCandidates,
    externalCallsDuringBuild: { kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 },
  }

  return manifestBody
}

/**
 * Build and write a cohort manifest to disk.
 */
export async function writeSemanticCohortManifest({
  cohortId,
  targetCount,
  priorRunId,
  pipelineRoot = resolve('catalogue-pipeline'),
  readJsonFile = readJson,
  exists = fileExists,
} = {}) {
  const manifest = await buildSemanticCohortManifest({ cohortId, targetCount, priorRunId, pipelineRoot, readJsonFile, exists })
  const outputPath = resolve(pipelineRoot, 'generated/semantic/batches', cohortId, 'cohort-manifest.json')
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  await atomicWriteArtifact(outputPath, manifest)
  return { manifest, outputPath }
}

function integerArg(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || !/^(0|[1-9]\d*)$/.test(argv[index + 1] ?? '')) {
    fail(`Missing or invalid ${name}.`, 'INVALID_ARG')
  }
  return Number(argv[index + 1])
}

function stringArg(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || !argv[index + 1]?.trim()) fail(`Missing or invalid ${name}.`, 'INVALID_ARG')
  return argv[index + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const cohortId = stringArg(argv, '--cohort-id')
  const targetCount = integerArg(argv, '--target')
  const priorRunId = stringArg(argv, '--from-run')

  writeSemanticCohortManifest({ cohortId, targetCount, priorRunId }).then(({ manifest, outputPath }) => {
    console.log(`Cohort manifest written: ${outputPath}`)
    console.log(JSON.stringify({ cohortId: manifest.cohortId, importedCount: manifest.importedCount, newCount: manifest.newCount, cohortHash: manifest.cohortHash }, null, 2))
  }).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
}
