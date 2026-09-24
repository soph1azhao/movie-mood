import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-production-assembly-dry-run-authorization.v1.json`
export const DRY_RUN_ROOT = `${ROOT}/stage-2-production-assembly-dry-run-v1`

const readJson = (repoRoot, relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
const rawHash = (repoRoot, relativePath) => hashBytes(fs.readFileSync(path.join(repoRoot, relativePath)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index])
const isHash = (value) => /^sha256:[0-9a-f]{64}$/.test(value ?? '')

function writeNew(repoRoot, relativePath, value) {
  const target = path.join(repoRoot, relativePath)
  fail(!fs.existsSync(target), 'T3_STAGE_2_AUTHORIZATION_REPLAY_REJECTED')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
  fail(fs.readFileSync(target, 'utf8') === serializeArtifactForPersistence(value), 'T3_STAGE_2_AUTHORIZATION_WRITE_READBACK_INVALID')
}

export function validateDryRunOutputPath(relativePath) {
  return typeof relativePath === 'string' && (relativePath === DRY_RUN_ROOT || relativePath.startsWith(`${DRY_RUN_ROOT}/`))
}

export function buildStage2Authorization({ repoRoot = REPO } = {}) {
  const paths = {
    cohortManifest: `${ROOT}/cohort-manifest.json`,
    finalClosure: `${ROOT}/t3-final-closure.v1.json`,
    promotionReadiness: `${ROOT}/t3-promotion-readiness.v1.json`,
    reconciliation: `${ROOT}/t3-remaining-route-reconciliation.v3.json`,
    exclusion: `${ROOT}/t3-post-v2-prehuman-exclusion.v1.json`,
    quarantine: `${ROOT}/quarantined-candidate-inventory.v1.json`,
    assemblyReference: 'catalogue-pipeline/scripts/scaleTranche2ProductionAssembly.mjs',
    productionValidator: 'catalogue-pipeline/scripts/validateProductionRecordV2.mjs',
    promotionContract: 'catalogue-pipeline/scripts/validatePromotionContract.mjs',
    productionSchema: 'catalogue-pipeline/schemas/production-record.v2.schema.json',
    runtimeMappings: 'src/data/tmdbMovieMappings.json',
  }
  const cohort = readJson(repoRoot, paths.cohortManifest)
  const closure = readJson(repoRoot, paths.finalClosure)
  const readiness = readJson(repoRoot, paths.promotionReadiness)
  const reconciliation = readJson(repoRoot, paths.reconciliation)
  const exclusion = readJson(repoRoot, paths.exclusion)
  const quarantine = readJson(repoRoot, paths.quarantine)
  const acceptedCandidateIds = [...closure.partitions.humanSemanticClosureAcceptedCandidateIds].sort()
  const terminalExclusionCandidateIds = [...closure.partitions.terminalPreHumanExclusionCandidateIds].sort()
  const structuralQuarantineCandidateIds = [...closure.partitions.structuralQuarantineCandidateIds].sort()
  const normalCandidateIds = cohort.records.map((record) => record.candidateId).sort()
  const allPartitionIds = [...acceptedCandidateIds, ...terminalExclusionCandidateIds, ...structuralQuarantineCandidateIds].sort()

  fail(closure.status === 'T3_FINAL_CLOSURE_COMPLETE_AWAITING_STAGE_2_PRODUCTION_ASSEMBLY_AUTHORIZATION', 'T3_STAGE_2_FINAL_CLOSURE_STATUS_INVALID')
  fail(readiness.status === 'T3_SEMANTIC_CLOSURE_COMPLETE_STAGE_2_PREREQUISITE_REQUIRED', 'T3_STAGE_2_READINESS_STATUS_INVALID')
  fail(readiness.finalClosureHash === hashArtifact(closure), 'T3_STAGE_2_FINAL_CLOSURE_BINDING_INVALID')
  fail(closure.normalPopulation === 150 && closure.counts.accepted === 139 && closure.counts.terminalPreHumanExclusions === 2 && closure.counts.structuralQuarantine === 9 && closure.counts.unresolved === 0, 'T3_STAGE_2_FINAL_PARTITION_INVALID')
  fail(acceptedCandidateIds.length === 139 && terminalExclusionCandidateIds.length === 2 && structuralQuarantineCandidateIds.length === 9 && sameIds(normalCandidateIds, allPartitionIds), 'T3_STAGE_2_IDENTITY_CONSERVATION_INVALID')
  fail(terminalExclusionCandidateIds.join('|') === 'scale500-tmdb-12104|scale500-tmdb-26691', 'T3_STAGE_2_TERMINAL_EXCLUSIONS_INVALID')
  fail(!acceptedCandidateIds.includes('exp100-tmdb-1156593') && reconciliation.deferred.candidateIds?.includes('exp100-tmdb-1156593'), 'T3_STAGE_2_DEFERRED_ISOLATION_INVALID')
  fail(reconciliation.partitions.humanSemanticClosureAccepted.count === 139 && reconciliation.unresolvedActionableBranches.length === 0, 'T3_STAGE_2_RECONCILIATION_INVALID')
  fail(closure.providerAccounting.physicalGeminiCalls === 151 && closure.providerAccounting.hardPhysicalCap === 180 && closure.providerAccounting.remainingHeadroom === 29 && closure.providerAccounting.laterProviderCallsAdded === 0, 'T3_STAGE_2_PROVIDER_ACCOUNTING_INVALID')
  fail(readiness.promotionReadiness === false && closure.promotionAuthorized === false && closure.runtimeAssemblyAuthorized === false && readiness.promotionAuthorized === false && readiness.runtimeAssemblyAuthorized === false, 'T3_STAGE_2_PREAUTHORIZATION_STATE_INVALID')
  fail(sameIds(terminalExclusionCandidateIds, [...exclusion.candidateIds].sort()) && sameIds(structuralQuarantineCandidateIds, quarantine.records.map((record) => record.candidateId).sort()), 'T3_STAGE_2_EXCLUSION_QUARANTINE_BINDING_INVALID')

  const bindings = Object.fromEntries(Object.entries(paths).map(([name, relativePath]) => [name, {
    path: relativePath,
    rawFileHash: rawHash(repoRoot, relativePath),
    ...(relativePath.endsWith('.json') ? { canonicalArtifactHash: hashArtifact(readJson(repoRoot, relativePath)) } : {}),
  }]))
  fail(bindings.finalClosure.canonicalArtifactHash === readiness.finalClosureHash, 'T3_STAGE_2_CLOSURE_HASH_DOMAIN_INVALID')
  fail(bindings.reconciliation.canonicalArtifactHash === closure.bindings.latestReconciliationHash, 'T3_STAGE_2_RECONCILIATION_HASH_DOMAIN_INVALID')
  fail(bindings.assemblyReference.rawFileHash && bindings.productionValidator.rawFileHash && bindings.productionSchema.rawFileHash, 'T3_STAGE_2_CONTRACT_HASH_INVALID')

  return {
    schemaVersion: 't3-stage-2-production-assembly-dry-run-authorization.v1',
    status: 'T3_STAGE_2_ASSEMBLY_DRY_RUN_AUTHORIZED_AWAITING_EXECUTION',
    trancheId: 'SCALE_TRANCHE_3',
    bindings,
    stage2Population: 139,
    candidateIds: acceptedCandidateIds,
    candidateIdsHash: hashArtifact(acceptedCandidateIds),
    excludedCandidateIds: [...terminalExclusionCandidateIds, ...structuralQuarantineCandidateIds].sort(),
    deferredCandidateIds: ['exp100-tmdb-1156593'],
    assemblyContract: {
      productionRecordSchema: 'production-record.v2',
      existingAssemblyReference: {
        path: paths.assemblyReference,
        sourceHash: bindings.assemblyReference.rawFileHash,
        classification: 'IMPLEMENTED_UNVERIFIED_FOR_T3',
        use: 'PRODUCTION_CONTRACT_REFERENCE_ONLY',
        t3ExecutionBlockedBecause: 'SCALE_TRANCHE_2_CONTEXT_AND_POSTER_ACQUISITION_ARE_HARD_CODED',
      },
      reusableValidators: [
        { path: paths.productionValidator, sourceHash: bindings.productionValidator.rawFileHash },
        { path: paths.promotionContract, sourceHash: bindings.promotionContract.rawFileHash },
      ],
      executionPrerequisite: 'A_T3_SPECIFIC_DETERMINISTIC_DRY_RUN_EXECUTOR_MUST_BE_SOURCE_HASH_BOUND_BY_A_FOLLOW_ON_EXECUTION_AUTHORIZATION_BEFORE_EXECUTION.',
    },
    authorization: {
      dryRunExecutionAuthorized: true,
      dryRunOnly: true,
      dryRunArtifactRoot: DRY_RUN_ROOT,
      runtimeWriteAllowed: false,
      promotionAllowed: false,
      providerCallsAuthorized: 0,
      semanticMutationAllowed: false,
      semanticAdjudicationAllowed: false,
      fallbackGenerationAllowed: false,
    },
    editorialIdentityRule: 'All accepted editorial fields must be byte-identical to their bound final editorial artifact; deterministic serialization alone may change representation.',
    validationGates: [
      'PRODUCTION_RECORD_V2_SCHEMA_VALIDITY',
      'REQUIRED_FIELD_COMPLETENESS',
      'CANDIDATE_AND_RUNTIME_ID_UNIQUENESS',
      'TMDB_FACTUAL_BINDING_INTEGRITY',
      'SEMANTIC_FIELD_AND_FINAL_EDITORIAL_IDENTITY',
      'SOURCE_AND_PROVENANCE_HASH_BINDING',
      'NO_TERMINAL_EXCLUSION_OR_STRUCTURAL_QUARANTINE_LEAKAGE',
      'NO_DEFERRED_CANDIDATE_LEAKAGE',
      'SERIALIZATION_DETERMINISM',
      'RUNTIME_LOADER_COMPATIBILITY',
      'CATALOGUE_LEVEL_IDENTITY_AND_COMPLETENESS_INVARIANTS',
    ],
    failurePolicy: {
      semanticFailure: false,
      disposition: 'STAGE_2_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY',
      automaticSemanticRepair: false,
      automaticTerminalExclusion: false,
      requiredNextRoute: 'GOVERNED_DETERMINISTIC_ASSEMBLY_FAILURE_RECONCILIATION',
    },
    successDisposition: 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION',
    providerAccounting: { physicalGeminiCalls: 151, hardPhysicalCap: 180, remainingHeadroom: 29, externalProviderCallsAuthorized: 0 },
    promotionAuthorized: false,
    runtimeAssemblyAuthorized: false,
    stage2Executed: false,
  }
}

export function validateStage2Authorization(authorization) {
  fail(authorization?.schemaVersion === 't3-stage-2-production-assembly-dry-run-authorization.v1' && authorization.status === 'T3_STAGE_2_ASSEMBLY_DRY_RUN_AUTHORIZED_AWAITING_EXECUTION' && authorization.trancheId === 'SCALE_TRANCHE_3', 'T3_STAGE_2_AUTHORIZATION_IDENTITY_INVALID')
  fail(authorization.stage2Population === 139 && Array.isArray(authorization.candidateIds) && authorization.candidateIds.length === 139 && new Set(authorization.candidateIds).size === 139 && authorization.candidateIdsHash === hashArtifact(authorization.candidateIds), 'T3_STAGE_2_AUTHORIZATION_POPULATION_INVALID')
  fail(!authorization.candidateIds.includes('scale500-tmdb-12104') && !authorization.candidateIds.includes('scale500-tmdb-26691') && !authorization.candidateIds.includes('exp100-tmdb-1156593') && !authorization.candidateIds.some((id) => authorization.excludedCandidateIds.includes(id)), 'T3_STAGE_2_AUTHORIZATION_ISOLATION_INVALID')
  fail(authorization.authorization.dryRunExecutionAuthorized === true && authorization.authorization.dryRunOnly === true && validateDryRunOutputPath(authorization.authorization.dryRunArtifactRoot), 'T3_STAGE_2_DRY_RUN_SCOPE_INVALID')
  fail(authorization.authorization.runtimeWriteAllowed === false && authorization.authorization.promotionAllowed === false && authorization.authorization.providerCallsAuthorized === 0 && authorization.authorization.semanticMutationAllowed === false && authorization.authorization.semanticAdjudicationAllowed === false && authorization.authorization.fallbackGenerationAllowed === false, 'T3_STAGE_2_NONPROMOTION_GUARD_INVALID')
  fail(authorization.promotionAuthorized === false && authorization.runtimeAssemblyAuthorized === false && authorization.stage2Executed === false && authorization.successDisposition === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION', 'T3_STAGE_2_STATE_INVALID')
  for (const binding of Object.values(authorization.bindings ?? {})) {
    fail(typeof binding?.path === 'string' && isHash(binding.rawFileHash) && (!binding.canonicalArtifactHash || isHash(binding.canonicalArtifactHash)), 'T3_STAGE_2_BINDING_INVALID')
  }
  fail(authorization.assemblyContract?.existingAssemblyReference?.classification === 'IMPLEMENTED_UNVERIFIED_FOR_T3' && isHash(authorization.assemblyContract.existingAssemblyReference.sourceHash) && authorization.assemblyContract.executionPrerequisite?.includes('T3_SPECIFIC_DETERMINISTIC_DRY_RUN_EXECUTOR'), 'T3_STAGE_2_ASSEMBLY_REFERENCE_INVALID')
  fail(Array.isArray(authorization.validationGates) && authorization.validationGates.length >= 11 && authorization.failurePolicy?.semanticFailure === false && authorization.failurePolicy?.automaticSemanticRepair === false && authorization.failurePolicy?.automaticTerminalExclusion === false, 'T3_STAGE_2_GATE_POLICY_INVALID')
  return true
}

export function writeStage2Authorization({ repoRoot = REPO } = {}) {
  const authorization = buildStage2Authorization({ repoRoot })
  validateStage2Authorization(authorization)
  writeNew(repoRoot, AUTHORIZATION_PATH, authorization)
  return { authorization, authorizationHash: hashArtifact(authorization) }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(writeStage2Authorization(), null, 2))
