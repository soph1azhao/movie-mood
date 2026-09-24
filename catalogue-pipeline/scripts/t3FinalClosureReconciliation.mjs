import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const FINAL_CLOSURE_PATH = `${ROOT}/t3-final-closure.v1.json`
export const PROMOTION_READINESS_PATH = `${ROOT}/t3-promotion-readiness.v1.json`
const read = (repoRoot, relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const writeNew = (repoRoot, relativePath, value) => {
  const target = path.join(repoRoot, relativePath); fail(!fs.existsSync(target), 'T3_FINAL_CLOSURE_REPLAY_REJECTED')
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
  fail(fs.readFileSync(target, 'utf8') === serializeArtifactForPersistence(value), 'T3_FINAL_CLOSURE_WRITE_READBACK_INVALID')
}

export function buildFinalClosure({ repoRoot = REPO } = {}) {
  const cohort = read(repoRoot, `${ROOT}/cohort-manifest.json`)
  const routing = read(repoRoot, `${ROOT}/automated-routing-closure.v1.json`)
  const recomposition = read(repoRoot, `${ROOT}/t3-post-v2-prehuman-recomposition.v1.json`)
  const exclusion = read(repoRoot, `${ROOT}/t3-post-v2-prehuman-exclusion.v1.json`)
  const historical = read(repoRoot, `${ROOT}/t3-human-repair-closure-ledger.v2.json`)
  const postClosure = read(repoRoot, `${ROOT}/t3-post-closure-renewed-human-closure-ledger.v1.json`)
  const directJudgment = read(repoRoot, `${ROOT}/direct-human-review-judgments-v1/31-scale500-tmdb-9299.json`)
  const directExecution = read(repoRoot, `${ROOT}/t3-direct-review-repair-execution-ledger.v1.json`)
  const directRenewed = read(repoRoot, `${ROOT}/t3-direct-review-renewed-human-closure-ledger.v1.json`)
  const quarantine = read(repoRoot, `${ROOT}/quarantined-candidate-inventory.v1.json`)
  const reconciliation = read(repoRoot, `${ROOT}/t3-remaining-route-reconciliation.v3.json`)
  const productionAuthorization = read(repoRoot, `${ROOT}/t3-production-execution-authorization.v1.json`)
  const normalIds = cohort.records.map((record) => record.candidateId)
  const untouched = recomposition.partitions.untouchedOriginalHumanApproveCandidateIds
  const firstAccepted = historical.records.filter((record) => record.decision === 'ACCEPT_REPAIR').map((record) => record.candidateId)
  const renewedAccepted = postClosure.records.filter((record) => record.decision === 'ACCEPT_REPAIR').map((record) => record.candidateId)
  const directAccepted = directRenewed.records.filter((record) => record.decision === 'ACCEPT_REPAIR').map((record) => record.candidateId)
  const acceptedIds = [...untouched, ...firstAccepted, ...renewedAccepted, ...directAccepted].sort()
  const exclusions = exclusion.candidateIds.slice().sort()
  const quarantined = quarantine.records.map((record) => record.candidateId).sort()
  const all = [...acceptedIds, ...exclusions, ...quarantined]
  fail(normalIds.length === 150 && new Set(normalIds).size === 150, 'T3_FINAL_CLOSURE_NORMAL_POPULATION_INVALID')
  fail(acceptedIds.length === 139 && new Set(acceptedIds).size === 139 && exclusions.length === 2 && quarantined.length === 9, 'T3_FINAL_CLOSURE_PARTITION_COUNT_INVALID')
  fail(new Set(all).size === 150 && normalIds.every((id) => all.includes(id)), 'T3_FINAL_CLOSURE_IDENTITY_CONSERVATION_INVALID')
  fail(historical.counts.accepted === 88 && historical.counts.reworkRequired === 3 && postClosure.counts.accepted === 3 && postClosure.counts.pending === 0, 'T3_FINAL_CLOSURE_LAYERED_REPAIR_HISTORY_INVALID')
  fail(directJudgment.decision === 'REVISE' && directJudgment.severity === 'MINOR' && directExecution.status === 'COMPLETE_AWAITING_RENEWED_DIRECT_HUMAN_CLOSURE' && directRenewed.accepted === 1, 'T3_FINAL_CLOSURE_DIRECT_HISTORY_INVALID')
  fail(reconciliation.partitions.humanSemanticClosureAccepted.count === 139 && reconciliation.unresolvedActionableBranches.length === 0 && reconciliation.promotionAuthorized === false && reconciliation.runtimeAssemblyAuthorized === false, 'T3_FINAL_CLOSURE_RECONCILIATION_INVALID')
  fail(routing.accounting.physicalGeminiCalls === 151 && routing.accounting.futureModelCallsAuthorized === 0 && quarantine.status === 'FROZEN_NO_REPAIR_AUTHORIZED' && productionAuthorization.status === 'T3_PRODUCTION_EXECUTION_NOT_AUTHORIZED' && productionAuthorization.productionAssemblyForbidden === true && productionAuthorization.runtimePromotionForbidden === true, 'T3_FINAL_CLOSURE_GOVERNANCE_INVALID')
  const promotionIneligible = acceptedIds.map((candidateId) => ({ candidateId, reason: 'STAGE_2_PRODUCTION_ASSEMBLY_AND_DRY_RUN_VALIDATION_NOT_YET_AUTHORIZED_OR_COMPLETED' }))
  const bindings = { cohortManifestHash: hashArtifact(cohort), automatedRoutingClosureHash: hashArtifact(routing), postV2RecompositionHash: hashArtifact(recomposition), preHumanExclusionHash: hashArtifact(exclusion), historicalHumanRepairClosureLedgerHash: hashArtifact(historical), postClosureRenewedHumanClosureLedgerHash: hashArtifact(postClosure), directReviewFirstJudgmentHash: hashArtifact(directJudgment), directReviewExecutionLedgerHash: hashArtifact(directExecution), directReviewRenewedHumanClosureLedgerHash: hashArtifact(directRenewed), quarantineInventoryHash: hashArtifact(quarantine), latestReconciliationHash: hashArtifact(reconciliation), productionExecutionAuthorizationHash: hashArtifact(productionAuthorization) }
  const closure = { schemaVersion: 't3-final-closure.v1', status: 'T3_FINAL_CLOSURE_COMPLETE_AWAITING_STAGE_2_PRODUCTION_ASSEMBLY_AUTHORIZATION', trancheId: 'SCALE_TRANCHE_3', bindings, normalPopulation: 150, identityConservationComplete: true, semanticClosureComplete: true, partitions: { humanSemanticClosureAcceptedCandidateIds: acceptedIds, terminalPreHumanExclusionCandidateIds: exclusions, structuralQuarantineCandidateIds: quarantined }, counts: { accepted: 139, terminalPreHumanExclusions: 2, structuralQuarantine: 9, unresolved: 0 }, deferred: reconciliation.deferred, providerAccounting: { physicalGeminiCalls: routing.accounting.physicalGeminiCalls, hardPhysicalCap: routing.accounting.hardPhysicalCap, remainingHeadroom: routing.accounting.remainingPhysicalHeadroom, laterProviderCallsAdded: 0 }, promotionEligibleCandidateIds: [], promotionIneligibleAccepted: promotionIneligible, promotionAuthorized: false, runtimeAssemblyAuthorized: false, nextLawfulRoute: 'STAGE_2_PRODUCTION_ASSEMBLY_AND_DRY_RUN_VALIDATION_AUTHORIZATION' }
  const readiness = { schemaVersion: 't3-promotion-readiness.v1', status: 'T3_SEMANTIC_CLOSURE_COMPLETE_STAGE_2_PREREQUISITE_REQUIRED', trancheId: 'SCALE_TRANCHE_3', finalClosureHash: hashArtifact(closure), bindings, semanticClosureComplete: true, identityConservationComplete: true, promotionReadiness: false, promotionEligibleCandidateIds: [], promotionIneligibleAccepted: promotionIneligible, excludedCandidateIds: [...exclusions, ...quarantined], unresolvedBlockers: [{ code: 'STAGE_2_PRODUCTION_ASSEMBLY_AND_DRY_RUN_VALIDATION_NOT_AUTHORIZED_OR_COMPLETED', candidateIds: acceptedIds }], promotionAuthorized: false, runtimeAssemblyAuthorized: false, requiredGovernanceAction: 'AUTHORIZE_STAGE_2_PRODUCTION_ASSEMBLY_AND_DRY_RUN_VALIDATION_FOR_THE_139_HUMAN_SEMANTIC_CLOSURE_ACCEPTED_RECORDS' }
  return { closure, readiness }
}

export function validateFinalClosure({ closure, readiness }) {
  fail(closure.normalPopulation === 150 && closure.counts.accepted + closure.counts.terminalPreHumanExclusions + closure.counts.structuralQuarantine === 150, 'T3_FINAL_CLOSURE_COUNT_INVALID')
  fail(closure.counts.unresolved === 0 && closure.identityConservationComplete === true && closure.semanticClosureComplete === true, 'T3_FINAL_CLOSURE_SEMANTIC_STATE_INVALID')
  fail(closure.promotionEligibleCandidateIds.length === 0 && closure.promotionIneligibleAccepted.length === 139 && closure.promotionAuthorized === false && closure.runtimeAssemblyAuthorized === false, 'T3_FINAL_CLOSURE_PROMOTION_STATE_INVALID')
  fail(readiness.finalClosureHash === hashArtifact(closure) && readiness.promotionReadiness === false && readiness.unresolvedBlockers.length === 1 && readiness.promotionAuthorized === false && readiness.runtimeAssemblyAuthorized === false, 'T3_FINAL_CLOSURE_READINESS_INVALID')
  return true
}

export function writeFinalClosure({ repoRoot = REPO } = {}) {
  const { closure, readiness } = buildFinalClosure({ repoRoot }); validateFinalClosure({ closure, readiness }); writeNew(repoRoot, FINAL_CLOSURE_PATH, closure); writeNew(repoRoot, PROMOTION_READINESS_PATH, readiness)
  return { closureHash: hashArtifact(closure), readinessHash: hashArtifact(readiness) }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(writeFinalClosure(), null, 2))
