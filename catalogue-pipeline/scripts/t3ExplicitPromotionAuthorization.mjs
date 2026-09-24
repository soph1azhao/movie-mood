import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'
import { assembleSuccessorRow, loadSuccessorRows } from './t3Stage2ProductionAssemblySuccessorDryRun.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const SUCCESSOR_ROOT = `${ROOT}/stage-2-production-assembly-dry-run-v2`
export const PROMOTION_AUTHORIZATION_PATH = `${ROOT}/t3-explicit-promotion-authorization.v1.json`
export const PROMOTED_PRODUCTION_ROOT = `${ROOT}/promoted-production-records-v1`

const read = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const rawHash = (root, relative) => hashBytes(fs.readFileSync(path.join(root, relative)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const canonicalSame = (left, right) => hashArtifact(left) === hashArtifact(right)

export function validatePromotionOutputPath(relativePath) {
  return relativePath === PROMOTED_PRODUCTION_ROOT || relativePath?.startsWith(`${PROMOTED_PRODUCTION_ROOT}/`)
}

export function validateExplicitPromotionAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-explicit-promotion-authorization.v1', 'T3_PROMOTION_AUTHORIZATION_SCHEMA_INVALID')
  fail(authorization.promotionPopulation === 139 && authorization.promotionExecutionAuthorized === false && authorization.runtimeAssemblyAuthorized === false && authorization.runtimeWriteAllowed === false, 'T3_PROMOTION_AUTHORIZATION_SCOPE_INVALID')
  fail(authorization.semanticMutationAllowed === false && authorization.factualMutationAllowed === false && authorization.paletteRegenerationAllowed === false && authorization.posterSubstitutionAllowed === false, 'T3_PROMOTION_AUTHORIZATION_MUTATION_SCOPE_INVALID')
  fail(authorization.networkCallsAuthorized === 0 && authorization.providerCallsAuthorized === 0 && authorization.releaseAllowed === false && authorization.deploymentAllowed === false, 'T3_PROMOTION_AUTHORIZATION_EXTERNAL_SCOPE_INVALID')
  fail(authorization.outputRoot === PROMOTED_PRODUCTION_ROOT && validatePromotionOutputPath(authorization.outputRoot), 'T3_PROMOTION_AUTHORIZATION_OUTPUT_PATH_INVALID')
  fail(authorization.runtimeInputOrOutputPathsAllowed === false, 'T3_PROMOTION_AUTHORIZATION_RUNTIME_BOUNDARY_INVALID')
  const bindings = authorization.bindings
  fail(bindings && Object.values(bindings).every((binding) => binding?.path && binding.rawFileHash === rawHash(repoRoot, binding.path)), 'T3_PROMOTION_AUTHORIZATION_BINDING_INVALID')
  const closure = read(repoRoot, `${ROOT}/t3-final-closure.v1.json`)
  const manifest = read(repoRoot, `${SUCCESSOR_ROOT}/t3-stage-2-production-assembly-successor-dry-run-manifest.v1.json`)
  const ledger = read(repoRoot, `${SUCCESSOR_ROOT}/t3-stage-2-successor-readiness-ledger.v1.json`)
  const expectedIds = closure.partitions.humanSemanticClosureAcceptedCandidateIds
  fail(expectedIds.length === 139 && new Set(expectedIds).size === 139 && same(authorization.candidateIds, expectedIds), 'T3_PROMOTION_AUTHORIZATION_POPULATION_INVALID')
  fail(manifest.population === 139 && manifest.aggregate?.assembled === 139 && manifest.aggregate?.passed === 139 && manifest.aggregate?.failed === 0 && manifest.aggregate?.pending === 0 && manifest.aggregate?.determinism === 'PASS' && manifest.aggregate?.runtimeCompatibility === 'PASS', 'T3_PROMOTION_AUTHORIZATION_SUCCESSOR_MANIFEST_INVALID')
  fail(ledger.population === 139 && ledger.assembled === 139 && ledger.passed === 139 && ledger.failed === 0 && ledger.pending === 0 && ledger.promotionAuthorizationEligible === 139 && ledger.promotionAuthorized === false && ledger.runtimeAssemblyAuthorized === false && ledger.manifestHash === hashArtifact(manifest), 'T3_PROMOTION_AUTHORIZATION_SUCCESSOR_LEDGER_INVALID')
  fail(manifest.records.length === 139 && new Set(manifest.records.map((record) => record.candidateId)).size === 139 && same(manifest.candidateIds, expectedIds), 'T3_PROMOTION_AUTHORIZATION_MANIFEST_IDENTITY_INVALID')
  fail(Array.isArray(authorization.productionRecords) && authorization.productionRecords.length === 139 && same(authorization.productionRecords.map((record) => record.candidateId), expectedIds), 'T3_PROMOTION_AUTHORIZATION_RECORD_SET_INVALID')
  const rows = new Map(loadSuccessorRows({ repoRoot }).map((row) => [row.candidate.candidateId, row]))
  for (const record of manifest.records) {
    const actualBytes = fs.readFileSync(path.join(repoRoot, record.artifactPath))
    const actual = JSON.parse(actualBytes)
    const frozen = authorization.productionRecords.find((item) => item.candidateId === record.candidateId)
    const reproduced = assembleSuccessorRow(rows.get(record.candidateId))
    fail(record.status === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION' && actual.status === record.status && actual.candidateId === record.candidateId && actual.tmdbId === record.tmdbId, 'T3_PROMOTION_AUTHORIZATION_NON_PASS_RECORD')
    fail(rawHash(repoRoot, record.artifactPath) === record.artifactHash && hashArtifact(actual) === record.artifactHash && frozen?.artifactPath === record.artifactPath && frozen.artifactHash === record.artifactHash, 'T3_PROMOTION_AUTHORIZATION_RECORD_HASH_INVALID')
    fail(canonicalSame(actual, reproduced), 'T3_PROMOTION_AUTHORIZATION_RECORD_PROVENANCE_OR_MUTATION_INVALID')
  }
  return true
}
