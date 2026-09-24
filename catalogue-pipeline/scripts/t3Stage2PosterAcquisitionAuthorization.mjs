import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-poster-acquisition-authorization.v1.json`
export const MANIFEST_PATH = `${ROOT}/t3-stage-2-poster-acquisition-manifest.v1.json`
export const OUTPUT_ROOT = `${ROOT}/stage-2-poster-assets-v1`
const read = (repoRoot, relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
const rawHash = (repoRoot, relativePath) => hashBytes(fs.readFileSync(path.join(repoRoot, relativePath)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }

function writeNew(repoRoot, relativePath, value) {
  const target = path.join(repoRoot, relativePath)
  fail(!fs.existsSync(target), 'T3_POSTER_ACQUISITION_AUTHORIZATION_REPLAY_REJECTED')
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
}

export function buildPosterAcquisitionGovernance({ repoRoot = REPO } = {}) {
  const paths = {
    finalClosure: `${ROOT}/t3-final-closure.v1.json`, promotionReadiness: `${ROOT}/t3-promotion-readiness.v1.json`, stage2Authorization: `${ROOT}/t3-stage-2-production-assembly-dry-run-authorization.v1.json`, executionAuthorization: `${ROOT}/t3-stage-2-production-assembly-dry-run-execution-authorization.v5.json`, dryRunManifest: `${ROOT}/stage-2-production-assembly-dry-run-v1/t3-stage-2-production-assembly-dry-run-manifest.v1.json`, readinessLedger: `${ROOT}/stage-2-production-assembly-dry-run-v1/t3-stage-2-readiness-ledger.v1.json`, failureReconciliation: `${ROOT}/t3-stage-2-assembly-failure-reconciliation.v1.json`, cohort: `${ROOT}/cohort-manifest.json`, urlResolver: 'catalogue-pipeline/scripts/paletteAlgorithmV1.mjs', t2AcquisitionReference: 'catalogue-pipeline/scripts/scaleTranche2ProductionAssembly.mjs', productionSchema: 'catalogue-pipeline/schemas/production-record.v2.schema.json', paletteAlgorithm: 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs',
  }
  const closure = read(repoRoot, paths.finalClosure); const stage2 = read(repoRoot, paths.stage2Authorization); const execution = read(repoRoot, paths.executionAuthorization); const manifest = read(repoRoot, paths.dryRunManifest); const ledger = read(repoRoot, paths.readinessLedger); const failure = read(repoRoot, paths.failureReconciliation); const cohort = read(repoRoot, paths.cohort)
  const ids = stage2.candidateIds
  fail(failure.rootCause.classification === 'MISSING_REQUIRED_LOCAL_PRODUCTION_ASSETS' && failure.affectedPopulation === 139 && failure.assetInventory.frozenTmdbPosterPathPresent === 139 && failure.assetInventory.matchingLocalPosterAssets === 0 && failure.assetInventory.matchingPaletteArtifacts === 0 && failure.semanticStatusUnchanged === true && failure.promotionEligibilityRemainsZero === true, 'T3_POSTER_ACQUISITION_ADMISSION_INVALID')
  fail(ids.length === 139 && new Set(ids).size === 139 && manifest.aggregate.failed === 139 && ledger.promotionAuthorizationEligible === 0 && hashArtifact(stage2) === execution.bindings.stage2Authorization.canonicalArtifactHash && hashArtifact(manifest) === ledger.manifestHash && failure.bindings.stage2AuthorizationHash === hashArtifact(stage2) && failure.bindings.executionAuthorizationHash === hashArtifact(execution) && failure.bindings.dryRunManifestHash === hashArtifact(manifest) && failure.bindings.readinessLedgerHash === hashArtifact(ledger), 'T3_POSTER_ACQUISITION_BINDING_INVALID')
  const excluded = new Set([...closure.partitions.terminalPreHumanExclusionCandidateIds, ...closure.partitions.structuralQuarantineCandidateIds, 'exp100-tmdb-1156593'])
  const candidates = ids.map((candidateId) => {
    const candidate = cohort.records.find((record) => record.candidateId === candidateId); fail(candidate && !excluded.has(candidateId), 'T3_POSTER_ACQUISITION_POPULATION_LEAKAGE')
    const snapshot = read(repoRoot, candidate.sourceBindings.factsRecord.path); const fact = snapshot.facts.find((record) => record.candidateId === candidateId && record.tmdbId === candidate.tmdbId)
    fail(fact && typeof fact.posterPath === 'string' && fact.posterPath.startsWith('/') && hashArtifact(fact) === candidate.sourceBindings.factsRecord.artifactHash, 'T3_POSTER_ACQUISITION_POSTER_PATH_BINDING_INVALID')
    return { candidateId, tmdbId: candidate.tmdbId, posterPath: fact.posterPath, factsRecordPath: candidate.sourceBindings.factsRecord.path, factsRecordHash: candidate.sourceBindings.factsRecord.artifactHash }
  })
  const bindings = Object.fromEntries(Object.entries(paths).map(([name, relativePath]) => [name, { path: relativePath, rawFileHash: rawHash(repoRoot, relativePath), ...(relativePath.endsWith('.json') ? { canonicalArtifactHash: hashArtifact(read(repoRoot, relativePath)) } : {}) }]))
  const authorization = { schemaVersion: 't3-stage-2-poster-acquisition-authorization.v1', status: 'T3_POSTER_ACQUISITION_AUTHORIZED_AWAITING_NETWORK_EXECUTION_AUTHORIZATION', trancheId: 'SCALE_TRANCHE_3', bindings, acquisitionPopulation: 139, candidateIds: ids, candidateIdsHash: hashArtifact(ids), externalSystem: { allowed: 'TMDB_IMAGE_CDN_ONLY', forbidden: ['TMDB_DATA_API', 'MODEL_PROVIDERS', 'WEB_SEARCH', 'ALTERNATE_POSTER_PROVIDERS', 'SCRAPING', 'SUBSTITUTION'], apiTokenRequired: false }, urlConstruction: { helperPath: paths.urlResolver, helperRawFileHash: bindings.urlResolver.rawFileHash, rendition: 'w500', frozenPosterPathOnly: true, resolveAtExecutionOnly: true }, outputPolicy: { outputRoot: OUTPUT_ROOT, generated: true, t3Scoped: true, runtimeWriteAllowed: false, promotionAllowed: false, allowedFiles: ['poster bytes', 'request provenance JSON', 'response provenance JSON', 'acquisition ledger JSON'] }, candidateBindingFields: ['candidateId', 'tmdbId', 'posterPath', 'factsRecordPath', 'factsRecordHash'], contentValidation: { requiredHttpStatus: 200, acceptedContentTypes: ['image/jpeg', 'image/webp'], nonEmptyBody: true, locallyReadableImage: true, byteHashRequired: true, rejectHtmlOrErrorBody: true, silentSubstitutionAllowed: false }, retryPolicy: { attemptLimitPerCandidate: 2, retryable: ['TRANSIENT_TRANSPORT_FAILURE', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'], terminal: ['HTTP_404', 'HTTP_410', 'HTTP_429', 'UNSUPPORTED_CONTENT_TYPE', 'EMPTY_BODY', 'MALFORMED_OR_NON_IMAGE_BYTES'], noAutomaticRestoration: true }, cachePolicy: { reuseOnlyWithExactCandidatePosterPathAndBoundProvenance: true, validateRequestResponseAndByteHashBeforeReuse: true, conflictingCachedBytes: 'REJECT_FAIL_CLOSED', overwriteConflictingBytes: false, completedBatchReplay: 'REJECT_OR_EXPLICIT_VALIDATED_NO_OP_ONLY' }, partialFailurePolicy: { candidateStates: ['POSTER_ASSET_ACQUIRED', 'POSTER_ASSET_ACQUISITION_FAILED'], semanticStatusUnchanged: true, promotionReadyForThisRun: false, automaticSemanticRepair: false, automaticTerminalExclusion: false, exactMachineReadableReasonRequired: true }, paletteGenerationAuthorized: false, futureExecutor: { executorAuthorized: false, requiredBindings: ['authorization hash', 'candidate manifest hash', 'posterPath bindings', 'URL resolver hash', 'output policy', 'retry policy', 'no-substitution policy'], networkCallsAuthorizedOnlyByFollowOnExecutionAuthorization: true }, networkAccounting: { acquisitionPopulation: 139, maxHttpRequests: 278, httpRequestsAttempted: 0, successfulDownloads: 0, failedDownloads: 0, retries: 0, cacheHits: 0, bytesDownloaded: 0, separateFromModelProviderAccounting: true }, providerCallsAuthorized: 0, providerAccounting: { physicalGeminiCalls: 151, hardPhysicalCap: 180, remainingHeadroom: 29 }, semanticMutationAllowed: false, runtimeWriteAllowed: false, promotionAllowed: false, palettesGenerated: 0, postersDownloaded: 0, stage2Reruns: 0 }
  const candidateManifest = { schemaVersion: 't3-stage-2-poster-acquisition-manifest.v1', status: 'FROZEN_AWAITING_NETWORK_EXECUTION_AUTHORIZATION', trancheId: 'SCALE_TRANCHE_3', authorizationHash: hashArtifact(authorization), population: 139, records: candidates, outputRoot: OUTPUT_ROOT, paletteGenerationAuthorized: false, networkCallsMade: 0 }
  return { authorization, candidateManifest }
}

export function validatePosterAcquisitionGovernance({ authorization, candidateManifest }) {
  fail(authorization?.schemaVersion === 't3-stage-2-poster-acquisition-authorization.v1' && authorization.acquisitionPopulation === 139 && authorization.candidateIds.length === 139 && authorization.candidateIdsHash === hashArtifact(authorization.candidateIds), 'T3_POSTER_ACQUISITION_AUTH_SCHEMA_INVALID')
  fail(authorization.externalSystem.allowed === 'TMDB_IMAGE_CDN_ONLY' && authorization.externalSystem.apiTokenRequired === false && authorization.urlConstruction.rendition === 'w500' && authorization.urlConstruction.resolveAtExecutionOnly === true && authorization.outputPolicy.outputRoot === OUTPUT_ROOT, 'T3_POSTER_ACQUISITION_AUTH_SCOPE_INVALID')
  fail(authorization.paletteGenerationAuthorized === false && authorization.futureExecutor.executorAuthorized === false && authorization.providerCallsAuthorized === 0 && authorization.runtimeWriteAllowed === false && authorization.promotionAllowed === false && authorization.postersDownloaded === 0, 'T3_POSTER_ACQUISITION_AUTH_GUARD_INVALID')
  fail(authorization.retryPolicy.attemptLimitPerCandidate === 2 && authorization.cachePolicy.conflictingCachedBytes === 'REJECT_FAIL_CLOSED' && authorization.networkAccounting.maxHttpRequests === 278, 'T3_POSTER_ACQUISITION_AUTH_POLICY_INVALID')
  fail(candidateManifest?.authorizationHash === hashArtifact(authorization) && candidateManifest.population === 139 && candidateManifest.records.length === 139 && new Set(candidateManifest.records.map((record) => record.candidateId)).size === 139 && candidateManifest.records.every((record) => record.posterPath.startsWith('/') && /^sha256:[0-9a-f]{64}$/.test(record.factsRecordHash)), 'T3_POSTER_ACQUISITION_MANIFEST_INVALID')
  return true
}

export function writePosterAcquisitionGovernance({ repoRoot = REPO } = {}) {
  const { authorization, candidateManifest } = buildPosterAcquisitionGovernance({ repoRoot }); validatePosterAcquisitionGovernance({ authorization, candidateManifest }); writeNew(repoRoot, AUTHORIZATION_PATH, authorization); writeNew(repoRoot, MANIFEST_PATH, candidateManifest); return { authorizationHash: hashArtifact(authorization), manifestHash: hashArtifact(candidateManifest) }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(writePosterAcquisitionGovernance(), null, 2))
