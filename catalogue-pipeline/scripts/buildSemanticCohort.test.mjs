import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { ADAPTIVE_STATES } from './adaptiveSemanticBatchCore.mjs'
import { buildSemanticCohortManifest, SemanticCohortError } from './buildSemanticCohort.mjs'
import { ACQUISITION_STATES } from './runScale500FactualAcquisition.mjs'
import { stableHash } from '../adapters/tmdbProvider.ts'

// ---- Helpers ----

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'semantic-cohort-'))
}

async function writePriorManifest(pipelineRoot, runId, states) {
  const manifestPath = resolve(pipelineRoot, 'generated/semantic/batches', runId, 'manifest.json')
  await mkdir(resolve(manifestPath, '..'), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify({ runId, states }, null, 2)}\n`)
  return manifestPath
}

async function writeAcquisitionState(pipelineRoot, candidates) {
  const statePath = resolve(pipelineRoot, '../catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/acquisition-state.json')
  await mkdir(resolve(statePath, '..'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({ candidates }, null, 2)}\n`)
  return statePath
}

async function writeEvidencePacket(pipelineRoot, candidateId, tmdbId, hash) {
  const packet = { schemaVersion: 'evidence-packet.v1', candidateId, tmdbId, inputHash: hash, facts: {}, sourceProvenance: [] }
  const packetPath = resolve(pipelineRoot, '../catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/evidence-packets', `${candidateId}.json`)
  await mkdir(resolve(packetPath, '..'), { recursive: true })
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`)
  return packetPath
}

function makeImportedState(candidateId, tmdbId, artifactHash) {
  return {
    candidateId,
    tmdbId,
    evidencePacketHash: `sha256:ep-${candidateId}`,
    status: ADAPTIVE_STATES.imported,
    httpRequests: 0,
    semanticAttempts: { high: 0, max: 0 },
    usage: { high: {}, max: {} },
    events: [{ type: 'IMPORTED_VALID_REFERENCE' }],
    lifetimeProvenance: { sourceRunId: 'prior', artifactHash, evidencePacketHash: `sha256:ep-${candidateId}` },
    artifactHash,
  }
}

function makeHighValidState(candidateId, tmdbId, artifactHash) {
  return {
    candidateId,
    tmdbId,
    evidencePacketHash: `sha256:ep-${candidateId}`,
    status: ADAPTIVE_STATES.highValid,
    artifactHash,
    httpRequests: 1,
  }
}

function makeAcquisitionCandidate(candidateId, tmdbId, selectionRank) {
  return {
    candidateId,
    tmdbId,
    status: ACQUISITION_STATES.evidenceComplete,
    evidencePacketHash: `sha256:ep-new-${candidateId}`,
    selectionRank,
    decade: '2000s',
    band: 'mainstream',
    languageGroup: 'English',
    events: [],
  }
}

// We need to build a fake root structure for the tests.
// The buildSemanticCohortManifest function expects:
//   pipelineRoot/generated/semantic/batches/<runId>/manifest.json
//   pipelineRoot/generated/catalogue-expansion/scale-500-v1/acquisition-state.json
//   pipelineRoot/generated/catalogue-expansion/scale-500-v1/evidence-packets/<candidateId>.json
// We'll create them manually using in-memory mocks via the readJsonFile and exists params.

function buildMockFs(files) {
  const exists = async (path) => Object.hasOwn(files, path)
  const readJsonFile = async (path) => {
    if (!Object.hasOwn(files, path)) throw new Error(`File not found: ${path}`)
    return files[path]
  }
  return { exists, readJsonFile }
}

describe('buildSemanticCohortManifest', () => {
  it('imports prior valid artifacts by reference with zero dispatches', async () => {
    const pipelineRoot = '/mock/pipeline'
    const priorRunId = 'kimi-k28-adaptive-semantic-100-v1'
    const cohortId = 'kimi-k28-adaptive-semantic-150-v1'
    const priorStates = {
      'exp100-a': makeImportedState('exp100-a', 101, 'sha256:art-a'),
      'exp100-b': makeHighValidState('exp100-b', 102, 'sha256:art-b'),
    }
    const acquisitionCandidates = {
      'scale500-tmdb-201': makeAcquisitionCandidate('scale500-tmdb-201', 201, 0),
      'scale500-tmdb-202': makeAcquisitionCandidate('scale500-tmdb-202', 202, 1),
    }
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: priorStates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: acquisitionCandidates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-201.json`]: { candidateId: 'scale500-tmdb-201', tmdbId: 201, inputHash: 'sha256:ep-new-scale500-tmdb-201', facts: {}, sourceProvenance: [] },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-202.json`]: { candidateId: 'scale500-tmdb-202', tmdbId: 202, inputHash: 'sha256:ep-new-scale500-tmdb-202', facts: {}, sourceProvenance: [] },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const manifest = await buildSemanticCohortManifest({ cohortId, targetCount: 4, priorRunId, pipelineRoot, readJsonFile, exists })
    expect(manifest.importedCount).toBe(2)
    expect(manifest.newCount).toBe(2)
    expect(manifest.totalCandidates).toBe(4)
    // Imported candidates have IMPORTED_VALID disposition, no dispatch intent
    for (const imported of manifest.importedCandidates) {
      expect(imported.disposition).toBe('IMPORTED_VALID')
      expect(imported.priorRunId).toBe(priorRunId)
    }
    // New Semantic-200+ candidates start at the Low production tier.
    for (const fresh of manifest.newCandidates) {
      expect(fresh.disposition).toBe('PENDING_LOW')
    }
  })

  it('selects only EVIDENCE_COMPLETE candidates as new slots', async () => {
    const pipelineRoot = '/mock/pipeline2'
    const priorRunId = 'prior-run'
    const cohortId = 'new-cohort'
    const priorStates = { 'c1': makeImportedState('c1', 1, 'sha256:a1') }
    const acquisitionCandidates = {
      'scale500-tmdb-301': makeAcquisitionCandidate('scale500-tmdb-301', 301, 0),
      'scale500-tmdb-302': { candidateId: 'scale500-tmdb-302', tmdbId: 302, status: ACQUISITION_STATES.factualFailed, selectionRank: 1 },
      'scale500-tmdb-303': { candidateId: 'scale500-tmdb-303', tmdbId: 303, status: ACQUISITION_STATES.httpFailed, selectionRank: 2 },
    }
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: priorStates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: acquisitionCandidates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-301.json`]: { candidateId: 'scale500-tmdb-301', tmdbId: 301, inputHash: 'sha256:ep-new-scale500-tmdb-301', facts: {}, sourceProvenance: [] },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const manifest = await buildSemanticCohortManifest({ cohortId, targetCount: 2, priorRunId, pipelineRoot, readJsonFile, exists })
    expect(manifest.importedCount).toBe(1)
    expect(manifest.newCount).toBe(1)
    // Only 301 is evidence-complete — 302 and 303 must not appear
    expect(manifest.newCandidates.map((c) => c.tmdbId)).not.toContain(302)
    expect(manifest.newCandidates.map((c) => c.tmdbId)).not.toContain(303)
  })

  it('selects new candidates in selectionRank order', async () => {
    const pipelineRoot = '/mock/pipeline3'
    const priorRunId = 'prior-run'
    const cohortId = 'new-cohort'
    const priorStates = {}
    // Three evidence-complete candidates in non-rank order in the map
    const acquisitionCandidates = {
      'scale500-tmdb-403': makeAcquisitionCandidate('scale500-tmdb-403', 403, 2),
      'scale500-tmdb-401': makeAcquisitionCandidate('scale500-tmdb-401', 401, 0),
      'scale500-tmdb-402': makeAcquisitionCandidate('scale500-tmdb-402', 402, 1),
    }
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: priorStates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: acquisitionCandidates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-401.json`]: { candidateId: 'scale500-tmdb-401', tmdbId: 401, inputHash: 'sha256:ep-new-scale500-tmdb-401', facts: {}, sourceProvenance: [] },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-402.json`]: { candidateId: 'scale500-tmdb-402', tmdbId: 402, inputHash: 'sha256:ep-new-scale500-tmdb-402', facts: {}, sourceProvenance: [] },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const manifest = await buildSemanticCohortManifest({ cohortId, targetCount: 2, priorRunId, pipelineRoot, readJsonFile, exists })
    // Should select ranks 0 and 1 (401 and 402), not 403
    expect(manifest.newCandidates.map((c) => c.tmdbId)).toEqual([401, 402])
  })

  it('never selects an acquisition candidate already imported by the prior checkpoint', async () => {
    const pipelineRoot = '/mock/pipeline-dedup'; const priorRunId = 'prior-run'
    const prior = makeImportedState('scale500-tmdb-701', 701, 'sha256:prior')
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: { [prior.candidateId]: prior } },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: { 'scale500-tmdb-701': makeAcquisitionCandidate('scale500-tmdb-701', 701, 0), 'scale500-tmdb-702': makeAcquisitionCandidate('scale500-tmdb-702', 702, 1) } },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-702.json`]: { candidateId: 'scale500-tmdb-702', tmdbId: 702, inputHash: 'sha256:ep-new-scale500-tmdb-702' },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const manifest = await buildSemanticCohortManifest({ cohortId: 'next', targetCount: 2, priorRunId, pipelineRoot, readJsonFile, exists })
    expect(manifest.newCandidates.map((candidate) => candidate.candidateId)).toEqual(['scale500-tmdb-702'])
  })

  it('fails when not enough evidence-complete candidates', async () => {
    const pipelineRoot = '/mock/pipeline4'
    const priorRunId = 'prior-run'
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: {} },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: {} },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    await expect(buildSemanticCohortManifest({ cohortId: 'c', targetCount: 5, priorRunId, pipelineRoot, readJsonFile, exists })).rejects.toMatchObject({ code: 'INSUFFICIENT_EVIDENCE_COMPLETE' })
  })

  it('fails when target is not greater than imported count', async () => {
    const pipelineRoot = '/mock/pipeline5'
    const priorRunId = 'prior-run'
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: { c1: makeImportedState('c1', 1, 'sha256:a'), c2: makeImportedState('c2', 2, 'sha256:b'), c3: makeImportedState('c3', 3, 'sha256:c') } },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: {} },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    await expect(buildSemanticCohortManifest({ cohortId: 'c', targetCount: 3, priorRunId, pipelineRoot, readJsonFile, exists })).rejects.toMatchObject({ code: 'TARGET_COUNT_TOO_SMALL' })
  })

  it('fails when prior manifest is missing', async () => {
    const pipelineRoot = '/mock/pipeline6'
    const files = {}
    const { exists, readJsonFile } = buildMockFs(files)
    await expect(buildSemanticCohortManifest({ cohortId: 'c', targetCount: 10, priorRunId: 'nonexistent', pipelineRoot, readJsonFile, exists })).rejects.toMatchObject({ code: 'PRIOR_MANIFEST_NOT_FOUND' })
  })

  it('fails on missing required arguments', async () => {
    await expect(buildSemanticCohortManifest({ cohortId: '', targetCount: 100, priorRunId: 'x' })).rejects.toMatchObject({ code: 'MISSING_COHORT_ID' })
    await expect(buildSemanticCohortManifest({ cohortId: 'c', targetCount: 0, priorRunId: 'x' })).rejects.toMatchObject({ code: 'INVALID_TARGET_COUNT' })
    await expect(buildSemanticCohortManifest({ cohortId: 'c', targetCount: 100, priorRunId: '' })).rejects.toMatchObject({ code: 'MISSING_PRIOR_RUN_ID' })
  })

  it('records zero external calls in the manifest', async () => {
    const pipelineRoot = '/mock/pipeline7'
    const priorRunId = 'prior-run'
    const acquisitionCandidates = { 'scale500-tmdb-501': makeAcquisitionCandidate('scale500-tmdb-501', 501, 0) }
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: {} },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: acquisitionCandidates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-501.json`]: { candidateId: 'scale500-tmdb-501', tmdbId: 501, inputHash: 'sha256:ep-new-scale500-tmdb-501', facts: {}, sourceProvenance: [] },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const manifest = await buildSemanticCohortManifest({ cohortId: 'c', targetCount: 1, priorRunId, pipelineRoot, readJsonFile, exists })
    expect(manifest.externalCallsDuringBuild).toEqual({ kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 })
  })

  it('produces a stable cohortHash for the same inputs', async () => {
    const pipelineRoot = '/mock/pipeline8'
    const priorRunId = 'prior-run'
    const acquisitionCandidates = { 'scale500-tmdb-601': makeAcquisitionCandidate('scale500-tmdb-601', 601, 0) }
    const files = {
      [`${pipelineRoot}/generated/semantic/batches/${priorRunId}/manifest.json`]: { runId: priorRunId, states: {} },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/acquisition-state.json`]: { candidates: acquisitionCandidates },
      [`${pipelineRoot}/generated/catalogue-expansion/scale-500-v1/evidence-packets/scale500-tmdb-601.json`]: { candidateId: 'scale500-tmdb-601', tmdbId: 601, inputHash: 'sha256:ep-new-scale500-tmdb-601', facts: {}, sourceProvenance: [] },
    }
    const { exists, readJsonFile } = buildMockFs(files)
    const first = await buildSemanticCohortManifest({ cohortId: 'c', targetCount: 1, priorRunId, pipelineRoot, readJsonFile, exists })
    const second = await buildSemanticCohortManifest({ cohortId: 'c', targetCount: 1, priorRunId, pipelineRoot, readJsonFile, exists })
    expect(first.cohortHash).toBe(second.cohortHash)
  })
})
