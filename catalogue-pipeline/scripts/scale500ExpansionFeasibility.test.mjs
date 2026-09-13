import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { AUDIT_PATH, buildScalePlanningProjections } from './scale500ExpansionFeasibility.mjs'

const readJson = (path) => readFile(resolve(path), 'utf8').then(JSON.parse)
const rawSha256 = async (path) => `sha256:${createHash('sha256').update(await readFile(resolve(path))).digest('hex')}`

describe('Scale-500 expansion feasibility audit', () => {
  it('projects closed Scale-50 request and known-token equivalents deterministically', () => {
    expect(buildScalePlanningProjections()).toEqual({
      baseline: { completedFilms: 50, httpRequests: 53, knownObservedTokens: 374105, requestsPerCompletedFilm: 1.06, knownTokensPerCompletedFilm: 7482.1 },
      targets: {
        100: { targetFilms: 100, additionalFilmsBeyondClosedScale50: 50, projectedTotalHttpDispatches: 106, projectedAdditionalHttpDispatches: 53, projectedKnownTokenEquivalentTotal: 748210, projectedKnownTokenEquivalentAdditional: 374105 },
        250: { targetFilms: 250, additionalFilmsBeyondClosedScale50: 200, projectedTotalHttpDispatches: 265, projectedAdditionalHttpDispatches: 212, projectedKnownTokenEquivalentTotal: 1870525, projectedKnownTokenEquivalentAdditional: 1496420 },
        500: { targetFilms: 500, additionalFilmsBeyondClosedScale50: 450, projectedTotalHttpDispatches: 530, projectedAdditionalHttpDispatches: 477, projectedKnownTokenEquivalentTotal: 3741050, projectedKnownTokenEquivalentAdditional: 3366945 },
        1000: { targetFilms: 1000, additionalFilmsBeyondClosedScale50: 950, projectedTotalHttpDispatches: 1060, projectedAdditionalHttpDispatches: 1007, projectedKnownTokenEquivalentTotal: 7482100, projectedKnownTokenEquivalentAdditional: 7107995 },
      },
      caveat: expect.stringContaining('unrecovered token usage'),
    })
  })

  it('binds the committed audit to source evidence and keeps Scale-500 closed to live execution', async () => {
    const [audit, stage1Closure] = await Promise.all([readJson(AUDIT_PATH), readJson('catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-stage1-closure.v1.json')])
    const { auditCanonicalSha256, ...body } = audit
    expect(auditCanonicalSha256).toBe(`sha256:${stableHash(body)}`)
    expect(audit.sourceCorpus).toMatchObject({ totalOfflineRecords: 10375, uniqueTmdbIdentities: 10375, selectionTimeEligibleUnique: 10356 })
    expect(audit.readiness).toMatchObject({ recordsSatisfyingCurrentFactualRequirements: 100, recordsSatisfyingCurrentEvidencePacketRequirements: 100, offlineReadyUniqueForProductionCohort: 100, remainingOfflineReadyOutsideExpansion100: 0 })
    expect(audit.overlaps).toMatchObject({ existingProductionCatalogue: 9, pilotCalibrationUnion: 185, expansion100: 100, scale50: 50 })
    expect(audit.remainingCandidateSupply).toMatchObject({ selectionEligibleAfterProductionFilteringAndExpansion100: 10256, remainingEligibleUniqueCandidates: 10077 })
    expect(audit.scale500Feasibility).toMatchObject({ scale500OfflineFeasible: false, eligibleOfflineCandidatesAvailable: 100, shortfallTo500: 400, frozenScale500ManifestCreated: false })
    expect(audit.decision).toBe('EXTERNAL_ACQUISITION_REQUIRED')
    expect(audit.scaleNArchitecture.liveLauncherAuthorizedByThisAudit).toBe(false)
    expect(audit.externalCallsDuringAudit).toEqual({ kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 })
    expect(audit.sourceHashes.sourceSnapshot).toBe(stage1Closure.liveArtifactRawSha256['source-snapshot.json'])
    expect(audit.sourceCorpus.sourceSnapshotHash).toBe(stage1Closure.sourceSnapshotHash)
    expect(audit.sourceHashes.scale50Closure).toBe('sha256:eccbd9cf767e67887199e72f28f256a55ba3142c997eff273748bb6d4e51a507')
    expect(await rawSha256('catalogue-pipeline/calibration/diagnostics/kimi-k28-adaptive-scale-50-closure.v1.json')).toBe(audit.sourceHashes.scale50Closure)
  })
})
