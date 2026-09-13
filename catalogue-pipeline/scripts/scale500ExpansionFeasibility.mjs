import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import { stableHash } from '../adapters/tmdbProvider.ts'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { collectDiscoveryPool, decadeFor, popularityBand } from './catalogueExpansionReadiness.mjs'
import { validateMovieFacts } from './validateBatch.mjs'

export const AUDIT_PATH = 'catalogue-pipeline/calibration/diagnostics/scale-500-expansion-feasibility.v1.json'
export const AUDIT_SCHEMA_VERSION = 'scale-500-expansion-feasibility.v1'
export const BASELINE_HEAD = '00addfcd0b82d2098ea480f7d8712fdc95f7306d'
export const TARGET_SCALES = Object.freeze([100, 250, 500, 1000])

export const DEFAULT_INPUT_PATHS = Object.freeze({
  sourceSnapshot: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/source-snapshot.json',
  stage1Closure: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-stage1-closure.v1.json',
  expansionManifest: 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/candidate-manifest.json',
  factualSnapshot: 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json',
  readinessReport: 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/expansion-readiness-report.v1.json',
  scale50Manifest: 'catalogue-pipeline/generated/catalogue-expansion/scale-50-v1/candidate-manifest.json',
  scale50Closure: 'catalogue-pipeline/calibration/diagnostics/kimi-k28-adaptive-scale-50-closure.v1.json',
  productionMappings: 'src/data/tmdbMovieMappings.json',
  semanticPilotManifest: 'catalogue-pipeline/generated/semantic/batches/v8-1-semantic-pilot-001/manifest.json',
  phase5aCalibrationFacts: 'catalogue-pipeline/generated/tmdbFacts/phase-5a-calibration.json',
  prospectiveHoldouts: 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json',
  c1bV3CandidateRegistry: 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/candidate-registry.json',
})

const asSet = (values) => new Set(values)
const intersectionCount = (left, right) => [...left].filter((value) => right.has(value)).length
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const countBy = (values, keyFor) => Object.fromEntries([...values.reduce((counts, value) => {
  const key = String(keyFor(value)); counts.set(key, (counts.get(key) ?? 0) + 1); return counts
}, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)))

function requireIdentity(condition, message) { if (!condition) throw new Error(message) }

export function buildScalePlanningProjections({ completedFilms = 50, httpRequests = 53, knownObservedTokens = 374105, targetScales = TARGET_SCALES } = {}) {
  const requestsPerCompletedFilm = httpRequests / completedFilms
  const knownTokensPerCompletedFilm = knownObservedTokens / completedFilms
  return {
    baseline: { completedFilms, httpRequests, knownObservedTokens, requestsPerCompletedFilm, knownTokensPerCompletedFilm },
    targets: Object.fromEntries(targetScales.map((targetFilms) => {
      const additionalFilms = Math.max(0, targetFilms - completedFilms)
      return [String(targetFilms), {
        targetFilms,
        additionalFilmsBeyondClosedScale50: additionalFilms,
        projectedTotalHttpDispatches: Math.ceil(targetFilms * requestsPerCompletedFilm),
        projectedAdditionalHttpDispatches: Math.ceil(additionalFilms * requestsPerCompletedFilm),
        projectedKnownTokenEquivalentTotal: Math.round(targetFilms * knownTokensPerCompletedFilm),
        projectedKnownTokenEquivalentAdditional: Math.round(additionalFilms * knownTokensPerCompletedFilm),
      }]
    })),
    caveat: 'Engineering projections apply the closed Scale-50 averages. They are not guaranteed provider-quota consumption; one original transport-unknown dispatch has unrecovered token usage, and future content may change token and retry behavior.',
  }
}

export function deriveScale500Feasibility({
  sourceSnapshot, stage1Closure, expansionManifest, factualSnapshot, readinessReport, scale50Manifest, scale50Closure,
  productionMappings = mappings, semanticPilotManifest, phase5aCalibrationFacts, prospectiveHoldouts, c1bV3CandidateRegistry,
  sourceRawHashes,
}) {
  requireIdentity(sourceSnapshot?.sourceSnapshotHash === stage1Closure?.sourceSnapshotHash, 'Stage-1 source snapshot identity mismatch.')
  requireIdentity(sourceSnapshot?.rawResponseCorpus?.length === stage1Closure?.totalRequiredPages, 'Stage-1 source corpus page count mismatch.')
  requireIdentity(expansionManifest?.candidateManifestHash === readinessReport?.candidateManifestHash, 'Expansion-100 readiness identity mismatch.')
  requireIdentity(scale50Manifest?.sourceCandidateManifestHash === expansionManifest?.candidateManifestHash, 'Scale-50 source identity mismatch.')
  requireIdentity(scale50Closure?.status === 'CLOSED' && scale50Closure?.outcome?.completedValid === 50, 'Scale-50 is not closed at 50/50 valid.')

  const occurrences = sourceSnapshot.rawResponseCorpus.flatMap((entry) => entry.response?.results ?? [])
  const uniqueByTmdbId = new Map(occurrences.map((record) => [record.id, record]))
  const sourceIds = asSet(uniqueByTmdbId.keys())
  const productionIds = asSet(productionMappings.map((entry) => entry.tmdbId).filter(Number.isInteger))
  const pilotIds = asSet((semanticPilotManifest?.candidates ?? []).map((entry) => entry.tmdbId))
  const phase5aIds = asSet((phase5aCalibrationFacts?.facts ?? []).map((entry) => entry.tmdbId))
  const holdoutIds = asSet((prospectiveHoldouts?.records ?? []).map((entry) => entry.tmdbId))
  const c1bIds = asSet((c1bV3CandidateRegistry?.candidates ?? []).map((entry) => entry.id))
  const pilotCalibrationIds = asSet([...pilotIds, ...phase5aIds, ...holdoutIds, ...c1bIds])
  const expansionIds = asSet(expansionManifest.candidates.map((entry) => entry.tmdbId))
  const scale50Ids = asSet(scale50Manifest.candidates.map((entry) => entry.tmdbId))

  const validFacts = (factualSnapshot?.facts ?? []).filter((facts) => validateMovieFacts(facts).ok)
  const validFactIds = asSet(validFacts.map((facts) => facts.tmdbId))
  const factsById = new Map(validFacts.map((facts) => [facts.tmdbId, facts]))
  const evidenceReadyRecords = (readinessReport?.records ?? []).filter((record) => {
    const facts = factsById.get(record.tmdbId)
    if (!facts || record.factualSnapshotStatus !== 'COMPLETE' || record.evidencePacketStatus !== 'COMPLETE' || record.readiness !== 'AUTOMATICALLY_READY') return false
    const built = buildEvidencePacket({ candidateId: record.candidateId, facts, tmdbOverview: facts.overview, keywordAssessment: { useful: false, selected: [] } })
    return built.reviewFlags.length === 0 && built.packet.inputHash === record.evidencePacketHash
  })
  const evidenceReadyIds = asSet(evidenceReadyRecords.map((record) => record.tmdbId))
  requireIdentity(validFactIds.size === validFacts.length, 'Detailed factual snapshot contains duplicate TMDB identities.')
  requireIdentity(evidenceReadyIds.size === evidenceReadyRecords.length, 'Evidence-ready records contain duplicate TMDB identities.')

  const discoveryEligible = collectDiscoveryPool(sourceSnapshot, productionMappings)
  const discoveryEligibleIds = asSet(discoveryEligible.map((record) => record.id))
  const remainingAfterExpansion = [...discoveryEligibleIds].filter((id) => !expansionIds.has(id))
  const remainingAfterExposureAndExpansion = remainingAfterExpansion.filter((id) => !pilotCalibrationIds.has(id))
  const supply = {
    decade: countBy(discoveryEligible, (record) => decadeFor(Number.parseInt(record.release_date.slice(0, 4), 10))),
    languageGroup: countBy(discoveryEligible, (record) => record.original_language === 'en' ? 'English' : 'Non-English'),
    familiarityTier: countBy(discoveryEligible, popularityBand),
    originalLanguage: countBy(discoveryEligible, (record) => record.original_language),
    primaryGenreId: countBy(discoveryEligible, (record) => record.genre_ids?.[0] ?? 'unknown'),
  }

  const offlineReadyForProduction = [...evidenceReadyIds].filter((id) => !productionIds.has(id)).length
  const shortfall = Math.max(0, 500 - offlineReadyForProduction)
  const body = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    auditKind: 'ZERO_NETWORK_PRODUCTION_EXPANSION_FEASIBILITY',
    basedOnHead: BASELINE_HEAD,
    sourceCorpus: {
      exactSource: DEFAULT_INPUT_PATHS.sourceSnapshot,
      sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash,
      rawSha256: sourceRawHashes.sourceSnapshot,
      totalOfflineRecords: occurrences.length,
      uniqueTmdbIdentities: sourceIds.size,
      duplicateOccurrences: occurrences.length - sourceIds.size,
      selectionTimeEligibleUnique: discoveryEligibleIds.size,
      provenance: 'The expansion-100-v1 selector consumed this frozen Stage-1 TMDB discover response corpus and excluded src/data/tmdbMovieMappings.json before deterministic production-diversity selection.',
    },
    sourceHashes: sourceRawHashes,
    readiness: {
      detailedOfflineFactRecords: factualSnapshot.facts.length,
      uniqueDetailedFactIdentities: validFactIds.size,
      recordsSatisfyingCurrentFactualRequirements: validFacts.length,
      recordsSatisfyingCurrentEvidencePacketRequirements: evidenceReadyIds.size,
      offlineReadyUniqueForProductionCohort: offlineReadyForProduction,
      remainingOfflineReadyOutsideExpansion100: [...evidenceReadyIds].filter((id) => !expansionIds.has(id)).length,
      overviewFirstPolicy: readinessReport.evidencePolicy,
    },
    overlaps: {
      note: 'Overlap counts are independently computed and are not mutually exclusive.',
      existingProductionCatalogue: intersectionCount(sourceIds, productionIds),
      pilotCalibrationUnion: intersectionCount(sourceIds, pilotCalibrationIds),
      pilotCalibrationScope: {
        semanticPilot: { universe: pilotIds.size, sourceOverlap: intersectionCount(sourceIds, pilotIds) },
        phase5aCalibration: { universe: phase5aIds.size, sourceOverlap: intersectionCount(sourceIds, phase5aIds) },
        prospectiveHoldouts: { universe: holdoutIds.size, sourceOverlap: intersectionCount(sourceIds, holdoutIds) },
        c1bV3ConfirmatoryCandidates: { universe: c1bIds.size, sourceOverlap: intersectionCount(sourceIds, c1bIds) },
        unionUniverse: pilotCalibrationIds.size,
      },
      expansion100: intersectionCount(sourceIds, expansionIds),
      scale50: intersectionCount(sourceIds, scale50Ids),
      expansion100PilotCalibrationOverlap: intersectionCount(expansionIds, pilotCalibrationIds),
      scale50PilotCalibrationOverlap: intersectionCount(scale50Ids, pilotCalibrationIds),
    },
    remainingCandidateSupply: {
      selectionEligibleAfterProductionFilteringAndExpansion100: remainingAfterExpansion.length,
      selectionEligibleAfterAlsoExcludingPilotCalibration: remainingAfterExposureAndExpansion.length,
      remainingEligibleUniqueCandidates: remainingAfterExposureAndExpansion.length,
      warning: 'These records contain discover metadata only. They do not satisfy the current detailed factual or evidence-packet requirements.',
      distributionBeforeNewAcquisition: supply,
    },
    scale500Feasibility: {
      scale500OfflineFeasible: offlineReadyForProduction >= 500,
      eligibleOfflineCandidatesAvailable: offlineReadyForProduction,
      shortfallTo500: shortfall,
      missingData: ['director', 'runtimeMinutes', 'countries', 'spokenLanguages', 'resolved genre names', 'validated deterministic factual snapshot', 'bound evidence-packet.v1 artifact'],
      minimumExternalAcquisitionRequired: `${shortfall} successful TMDB movie-detail records using the existing single-request details endpoint with appended credits/keywords; keywords may remain excluded under the overview-first evidence policy. Actual attempts may exceed ${shortfall} if selected records fail factual or grounding validation.`,
      frozenScale500ManifestCreated: false,
    },
    recommendedComposition: {
      targetFilms: 500,
      includeClosedScale50Members: 50,
      decadeTargets: { '1980s': 100, '1990s': 100, '2000s': 100, '2010s': 100, '2020s': 100 },
      languageGroupTargets: { English: 250, 'Non-English': 250 },
      familiarityTierTargets: { mainstream: 175, familiar: 175, discovery: 150 },
      primaryGenreRule: 'Represent all 19 primary-genre IDs present in eligible supply with a floor of 10 each, then fill remaining slots by deterministic genre round-robin within decade × language-group × familiarity cells.',
      orderingRule: ['retain all 50 closed Scale-50 members', 'satisfy hard decade/language/familiarity targets', 'rotate primary genre ID ascending within each cell', 'rank by vote_count descending, vote_average descending, TMDB ID ascending'],
      feasibilityNote: 'The recorded selection-time supply exceeds every aggregate target. A final manifest remains forbidden until 400 additional candidates have complete validated facts and evidence packets.',
    },
    scaleNArchitecture: {
      validatedCapability: 'Kimi K2.8 High → Max remains technically validated.',
      recommendation: 'Extract a parameterized adaptive Scale-N orchestration core while retaining the frozen Scale-50 entrypoint, constants, state, and closure unchanged as a compatibility wrapper.',
      smallestRequiredChanges: ['parameterize run/manifest identity, candidate count, roots, and authorization contract', 'generalize preflight and summaries without changing High→Max or uncertain-dispatch semantics', 'add manifest-bound import verification for prior valid artifacts', 'add batch-size-specific closure verification and bounded invocation budgets'],
      closedScale50Reuse: {
        strategy: 'Reference, do not copy: future manifest members may declare an immutable prior-valid-artifact reference containing sourceRunId, candidateId, evidencePacketHash, artifactHash, and provider/prompt/schema/taxonomy identities.',
        verification: 'The Scale-N preflight must verify the referenced closed Scale-50 closure, artifact bytes/hash, candidate/evidence identity, and exact semantic cache identity before marking the member IMPORTED_VALID with zero dispatches.',
        prohibitions: ['no redispatch', 'no copied artifact with new generation provenance', 'no cache-key rewriting', 'no mutation of Scale-50 manifest, events, caches, artifacts, or closure'],
      },
      maintainerAuthorizationRequiredBeforeLiveScale500: true,
      liveLauncherAuthorizedByThisAudit: false,
    },
    planningProjections: buildScalePlanningProjections(),
    decision: offlineReadyForProduction >= 500 ? 'READY' : 'EXTERNAL_ACQUISITION_REQUIRED',
    externalCallsDuringAudit: { kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 },
    mutationsDuringAudit: { scale50Artifacts: 0, semanticOutputs: 0, providerPolicy: 0 },
  }
  return { ...body, auditCanonicalSha256: `sha256:${stableHash(body)}` }
}

async function readInput(root, path) { const raw = await readFile(resolve(root, path)); return { raw, value: JSON.parse(raw) } }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }

export async function loadAndDeriveScale500Feasibility({ root = process.cwd() } = {}) {
  const loaded = Object.fromEntries(await Promise.all(Object.entries(DEFAULT_INPUT_PATHS).map(async ([key, path]) => [key, await readInput(root, path)])))
  const sourceRawHashes = Object.fromEntries(Object.entries(loaded).map(([key, input]) => [key, sha256(input.raw)]))
  return deriveScale500Feasibility({ ...Object.fromEntries(Object.entries(loaded).map(([key, input]) => [key, input.value])), sourceRawHashes })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadAndDeriveScale500Feasibility().then(async (audit) => {
    if (process.argv.includes('--write-audit')) await writeJson(resolve(AUDIT_PATH), audit)
    console.log(JSON.stringify(audit, null, 2))
  }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
