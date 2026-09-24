import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
const DRY_ROOT = `${ROOT}/stage-2-production-assembly-dry-run-v1`
export const RECONCILIATION_PATH = `${ROOT}/t3-stage-2-assembly-failure-reconciliation.v1.json`
const read = (repoRoot, relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
const rawHash = (repoRoot, relativePath) => hashBytes(fs.readFileSync(path.join(repoRoot, relativePath)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const sort = (values) => [...values].sort()

function writeNew(repoRoot, relativePath, value) {
  const target = path.join(repoRoot, relativePath)
  fail(!fs.existsSync(target), 'T3_STAGE_2_FAILURE_RECONCILIATION_REPLAY_REJECTED')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
}

function pathsWithName(repoRoot, relativeRoot, name) {
  const root = path.join(repoRoot, relativeRoot)
  if (!fs.existsSync(root)) return []
  const found = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name === name) found.push(path.relative(repoRoot, absolute))
    }
  }
  visit(root); return found
}

function pathsWithSuffix(repoRoot, relativeRoot, suffix) {
  const root = path.join(repoRoot, relativeRoot)
  if (!fs.existsSync(root)) return []
  const found = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name.endsWith(suffix)) found.push(path.relative(repoRoot, absolute))
    }
  }
  visit(root); return found
}

export function buildFailureReconciliation({ repoRoot = REPO } = {}) {
  const stage2 = read(repoRoot, `${ROOT}/t3-stage-2-production-assembly-dry-run-authorization.v1.json`)
  const execution = read(repoRoot, `${ROOT}/t3-stage-2-production-assembly-dry-run-execution-authorization.v5.json`)
  const manifest = read(repoRoot, `${DRY_ROOT}/t3-stage-2-production-assembly-dry-run-manifest.v1.json`)
  const ledger = read(repoRoot, `${DRY_ROOT}/t3-stage-2-readiness-ledger.v1.json`)
  const closure = read(repoRoot, `${ROOT}/t3-final-closure.v1.json`)
  const readiness = read(repoRoot, `${ROOT}/t3-promotion-readiness.v1.json`)
  const cohort = read(repoRoot, `${ROOT}/cohort-manifest.json`)
  const schemaPath = 'catalogue-pipeline/schemas/production-record.v2.schema.json'
  const validatorPath = 'catalogue-pipeline/scripts/validateProductionRecordV2.mjs'
  const contractPath = 'catalogue-pipeline/scripts/validatePromotionContract.mjs'
  const t2Path = 'catalogue-pipeline/scripts/scaleTranche2ProductionAssembly.mjs'
  const accepted = stage2.candidateIds
  const failures = manifest.records.map((record) => ({ ...record, artifact: read(repoRoot, record.artifactPath) }))
  const failureIds = failures.map((row) => row.candidateId)
  const excluded = new Set([...closure.partitions.terminalPreHumanExclusionCandidateIds, ...closure.partitions.structuralQuarantineCandidateIds, 'exp100-tmdb-1156593'])
  fail(stage2.stage2Population === 139 && execution.executionPopulation === 139 && manifest.population === 139 && ledger.population === 139 && accepted.length === 139, 'T3_STAGE_2_FAILURE_RECONCILIATION_POPULATION_INVALID')
  fail(hashArtifact(stage2) === execution.bindings.stage2Authorization.canonicalArtifactHash && hashArtifact(execution) === manifest.executionAuthorizationHash && hashArtifact(manifest) === ledger.manifestHash, 'T3_STAGE_2_FAILURE_RECONCILIATION_BINDING_INVALID')
  fail(sort(accepted).join('|') === sort(failureIds).join('|') && new Set(failureIds).size === 139 && failures.every((row) => row.status === 'STAGE_2_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY' && row.artifact.status === row.status && row.artifact.reasons?.length === 1 && row.artifact.reasons[0].code === 'LOCAL_POSTER_ASSET_UNAVAILABLE') && !failureIds.some((id) => excluded.has(id)), 'T3_STAGE_2_FAILURE_RECONCILIATION_FAILURE_SET_INVALID')
  let posterPathPresent = 0; let posterPathAbsent = 0
  for (const candidateId of accepted) {
    const candidate = cohort.records.find((record) => record.candidateId === candidateId); fail(candidate, 'T3_STAGE_2_FAILURE_RECONCILIATION_COHORT_DRIFT')
    const snapshot = read(repoRoot, candidate.sourceBindings.factsRecord.path); const fact = snapshot.facts.find((record) => record.candidateId === candidateId)
    fail(fact && hashArtifact(fact) === candidate.sourceBindings.factsRecord.artifactHash, 'T3_STAGE_2_FAILURE_RECONCILIATION_FACTUAL_DRIFT')
    if (fact.posterPath) posterPathPresent += 1; else posterPathAbsent += 1
  }
  const posterFiles = pathsWithName(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion', 'poster')
  const posterCandidateIds = new Set(posterFiles.map((file) => file.split('/').at(-2)))
  const matchingLocalPosters = accepted.filter((id) => posterCandidateIds.has(id))
  const matchingPaletteFiles = pathsWithSuffix(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion', '.json').filter((file) => file.includes('/palettes/') && accepted.includes(path.basename(file, '.json')))
  fail(posterPathPresent === 139 && posterPathAbsent === 0 && matchingLocalPosters.length === 0 && matchingPaletteFiles.length === 0, 'T3_STAGE_2_FAILURE_RECONCILIATION_ASSET_INVENTORY_INVALID')
  return {
    schemaVersion: 't3-stage-2-assembly-failure-reconciliation.v1', status: 'T3_STAGE_2_ASSEMBLY_FAILURE_RECONCILED_AWAITING_POSTER_PREREQUISITE_ROUTE', trancheId: 'SCALE_TRANCHE_3',
    bindings: { stage2AuthorizationHash: hashArtifact(stage2), executionAuthorizationHash: hashArtifact(execution), dryRunManifestHash: hashArtifact(manifest), readinessLedgerHash: hashArtifact(ledger), finalClosureHash: hashArtifact(closure), promotionReadinessHash: hashArtifact(readiness), productionSchemaRawFileHash: rawHash(repoRoot, schemaPath), productionValidatorRawFileHash: rawHash(repoRoot, validatorPath), promotionContractRawFileHash: rawHash(repoRoot, contractPath), t2AssemblyReferenceRawFileHash: rawHash(repoRoot, t2Path) },
    affectedPopulation: 139, candidateIds: accepted, sharedFailureCode: 'LOCAL_POSTER_ASSET_UNAVAILABLE', rootCause: { classification: 'MISSING_REQUIRED_LOCAL_PRODUCTION_ASSETS', resolverDefect: false, assemblyContractTooStrict: false, rationale: 'production-record.v2 requires curatedMovie.palette and provenance.paletteArtifactHash; the palette artifact requires a sourcePosterHash derived from image bytes. Every accepted candidate has frozen posterPath metadata but no matching local poster bytes or palette artifact.' },
    assetInventory: { matchingLocalPosterAssets: 0, matchingPaletteArtifacts: 0, frozenTmdbPosterPathPresent: 139, frozenTmdbPosterPathAbsent: 0, candidatesWithOnlyFrozenPosterMetadata: 139, candidatesWithNeitherPosterMetadataNorLocalAsset: 0, namingOrPathConventionMismatch: false, searchedPosterAssetCount: posterFiles.length },
    productionRecordPosterDependencies: [
      { field: 'facts.posterPath', required: true, purpose: 'Frozen TMDB factual identity and runtime image location metadata.', requiresImageBytes: false },
      { field: 'curatedMovie.palette', required: true, purpose: 'Movie Mood fallback-poster presentation.', requiresImageBytes: true },
      { field: 'provenance.paletteArtifactHash', required: true, purpose: 'Binds palette to deterministic poster-derived artifact.', requiresImageBytes: true },
      { field: 'paletteArtifact.sourcePosterHash', requiredByPaletteArtifact: true, purpose: 'Binds palette to exact local poster bytes.', requiresImageBytes: true },
    ],
    t2PosterFlow: ['LOCAL_FACTUAL_AND_IDENTITY_ASSEMBLY', 'TMDB_POSTER_URL_RESOLUTION_FROM_FROZEN_POSTER_PATH', 'TMDB_IMAGE_CDN_FETCH_AND_LOCAL_CACHE_PERSISTENCE', 'DETERMINISTIC_PALETTE_EXTRACTION_FROM_BYTES', 'PALETTE_AND_PRODUCTION_RECORD_VALIDATION', 'SEPARATE_PROMOTION_RUNTIME_STEP'],
    networkAnalysis: { requiredForPrerequisite: true, externalSystem: 'TMDB_IMAGE_CDN_ONLY', tmdbDataApiRequired: false, apiTokenRequiredForImageCdn: false, frozenPosterPathsSufficientForUrlResolution: true, semanticOrFactualMeaningChangedByDownload: false, modelProviderAccountingAffected: false, separateNetworkAccountingRequired: true },
    nextLawfulRoute: { code: 'BOUNDED_T3_POSTER_ASSET_ACQUISITION_AUTHORIZATION', population: 139, sourceAuthority: ['frozen T3 factual snapshot posterPath', 'frozen T3 candidate/tmdb identity', 'frozen Stage 2 failure reconciliation'], networkAllowance: 'TMDB_IMAGE_CDN_ONLY_NO_TMDB_DATA_API_NO_MODEL_PROVIDER', outputRoot: `${ROOT}/stage-2-poster-assets-v1`, idempotency: 'validated request/response/byte-hash cache reuse; bounded retry policy; no silent substitution', assetProvenance: 'candidateId, tmdbId, frozen posterPath, resolved w500 URL, response metadata, raw byte hash, palette artifact hash', failurePolicy: 'record candidate-level asset acquisition failure; do not reopen semantic review or promote; follow with successor Stage 2 dry run only after governed acquisition closure', requiresSuccessorDryRun: true },
    semanticStatusUnchanged: true, promotionEligibilityRemainsZero: true, providerCallsAuthorized: 0, runtimeWriteAllowed: false, promotionAllowed: false, providerAccounting: { physicalGeminiCalls: 151, hardPhysicalCap: 180, remainingHeadroom: 29 },
  }
}

export function validateFailureReconciliation(value) {
  fail(value?.schemaVersion === 't3-stage-2-assembly-failure-reconciliation.v1' && value.status === 'T3_STAGE_2_ASSEMBLY_FAILURE_RECONCILED_AWAITING_POSTER_PREREQUISITE_ROUTE', 'T3_STAGE_2_FAILURE_RECONCILIATION_SCHEMA_INVALID')
  fail(value.affectedPopulation === 139 && value.candidateIds.length === 139 && value.sharedFailureCode === 'LOCAL_POSTER_ASSET_UNAVAILABLE' && value.assetInventory.matchingLocalPosterAssets === 0 && value.assetInventory.matchingPaletteArtifacts === 0 && value.assetInventory.frozenTmdbPosterPathPresent === 139, 'T3_STAGE_2_FAILURE_RECONCILIATION_COUNTS_INVALID')
  fail(value.rootCause.classification === 'MISSING_REQUIRED_LOCAL_PRODUCTION_ASSETS' && value.rootCause.resolverDefect === false && value.rootCause.assemblyContractTooStrict === false && value.semanticStatusUnchanged === true && value.promotionEligibilityRemainsZero === true, 'T3_STAGE_2_FAILURE_RECONCILIATION_CLASSIFICATION_INVALID')
  fail(value.nextLawfulRoute.code === 'BOUNDED_T3_POSTER_ASSET_ACQUISITION_AUTHORIZATION' && value.nextLawfulRoute.networkAllowance === 'TMDB_IMAGE_CDN_ONLY_NO_TMDB_DATA_API_NO_MODEL_PROVIDER' && value.providerCallsAuthorized === 0 && value.runtimeWriteAllowed === false && value.promotionAllowed === false, 'T3_STAGE_2_FAILURE_RECONCILIATION_GUARDS_INVALID')
  return true
}

export function writeFailureReconciliation({ repoRoot = REPO } = {}) {
  const artifact = buildFailureReconciliation({ repoRoot }); validateFailureReconciliation(artifact); writeNew(repoRoot, RECONCILIATION_PATH, artifact); return { artifact, artifactHash: hashArtifact(artifact) }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(writeFailureReconciliation(), null, 2))
