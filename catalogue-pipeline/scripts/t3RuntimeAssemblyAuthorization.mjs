import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const PROMOTED_ROOT = `${ROOT}/promoted-production-records-v1`
export const RUNTIME_TARGETS = Object.freeze(['src/data/curatedMovies.ts', 'src/data/generated/tmdbMovies.json', 'src/data/tmdbMovieMappings.json'])
export const RUNTIME_AUTHORIZATION_PATH = `${ROOT}/t3-runtime-assembly-authorization.v1.json`

const read = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const rawHash = (root, relative) => hashBytes(fs.readFileSync(path.join(root, relative)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }

export function validateRuntimeTargetPath(relativePath) {
  return RUNTIME_TARGETS.includes(relativePath)
}

export function buildRuntimeAssemblyPlan({ repoRoot = REPO } = {}) {
  const manifest = read(repoRoot, `${PROMOTED_ROOT}/t3-promotion-completion-manifest.v1.json`)
  const ledger = read(repoRoot, `${PROMOTED_ROOT}/t3-promotion-execution-ledger.v1.json`)
  fail(manifest.population === 139 && manifest.aggregate.promoted + manifest.aggregate.reused === 139 && manifest.aggregate.failed === 0 && manifest.aggregate.pending === 0, 'T3_RUNTIME_PROMOTION_COMPLETION_INVALID')
  fail(ledger.population === 139 && ledger.promoted + ledger.reused === 139 && ledger.failed === 0 && ledger.pending === 0 && ledger.manifestHash === hashArtifact(manifest) && ledger.runtimeAssemblyAuthorized === false && ledger.runtimeWriteAllowed === false, 'T3_RUNTIME_PROMOTION_LEDGER_INVALID')
  const runtimeMappings = read(repoRoot, 'src/data/tmdbMovieMappings.json')
  const runtimeFacts = read(repoRoot, 'src/data/generated/tmdbMovies.json')
  const existingIds = new Set(runtimeMappings.map((record) => record.id)); const existingTmdbIds = new Set(runtimeMappings.map((record) => record.tmdbId))
  fail(runtimeMappings.length === Object.keys(runtimeFacts).length && new Set(runtimeMappings.map((record) => record.id)).size === runtimeMappings.length && new Set(runtimeMappings.map((record) => record.tmdbId)).size === runtimeMappings.length, 'T3_RUNTIME_BASELINE_IDENTITY_INVALID')
  const projections = manifest.records.map((record) => {
    const bytes = fs.readFileSync(path.join(repoRoot, record.promotedArtifactPath)); const production = JSON.parse(bytes)
    fail(rawHash(repoRoot, record.promotedArtifactPath) === record.promotedArtifactHash && production.schemaVersion === 'production-record.v2' && production.candidateId === record.candidateId && production.tmdbId === record.tmdbId && production.curatedMovie?.id && production.curatedMovie.tmdbId === production.tmdbId && production.facts?.tmdbId === production.tmdbId, 'T3_RUNTIME_PROMOTED_RECORD_INVALID')
    return { candidateId: production.candidateId, tmdbId: production.tmdbId, runtimeId: production.curatedMovie.id, sourcePath: record.promotedArtifactPath, sourceHash: record.promotedArtifactHash, curatedMovie: production.curatedMovie, facts: production.facts, provenance: production.provenance }
  })
  const projectionIds = new Set(); const projectionTmdbIds = new Set()
  for (const projection of projections) {
    fail(!projectionIds.has(projection.runtimeId) && !projectionTmdbIds.has(projection.tmdbId), 'T3_RUNTIME_PROMOTED_DUPLICATE_IDENTITY')
    fail(!existingIds.has(projection.runtimeId) && !existingTmdbIds.has(projection.tmdbId), 'T3_RUNTIME_COLLISION_REQUIRES_RECONCILIATION')
    projectionIds.add(projection.runtimeId); projectionTmdbIds.add(projection.tmdbId)
  }
  return { schemaVersion: 't3-runtime-assembly-plan.v1', population: 139, baseline: { count: runtimeMappings.length, targetHashes: Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, rawHash(repoRoot, target)])) }, outputTargets: RUNTIME_TARGETS, ordering: 'PRESERVE_CURRENT_RUNTIME_ORDER_THEN_PROMOTION_COMPLETION_MANIFEST_ORDER', overlaps: { exactExisting: 0, deterministicUpdates: 0, conflicts: 0 }, expectedFinalCount: runtimeMappings.length + projections.length, projections }
}

export function validateRuntimeAssemblyPlan(plan) {
  fail(plan?.schemaVersion === 't3-runtime-assembly-plan.v1' && plan.population === 139 && plan.baseline?.count >= 0 && plan.expectedFinalCount === plan.baseline.count + 139, 'T3_RUNTIME_PLAN_SHAPE_INVALID')
  fail(Array.isArray(plan.outputTargets) && plan.outputTargets.length === RUNTIME_TARGETS.length && plan.outputTargets.every(validateRuntimeTargetPath), 'T3_RUNTIME_TARGET_PATH_INVALID')
  fail(plan.overlaps?.exactExisting === 0 && plan.overlaps?.deterministicUpdates === 0 && plan.overlaps?.conflicts === 0 && plan.projections?.length === 139, 'T3_RUNTIME_PLAN_OVERLAP_INVALID')
  fail(new Set(plan.projections.map((record) => record.runtimeId)).size === 139 && new Set(plan.projections.map((record) => record.tmdbId)).size === 139, 'T3_RUNTIME_PLAN_DUPLICATE_IDENTITY')
  for (const record of plan.projections) fail(record.curatedMovie?.id === record.runtimeId && record.curatedMovie.tmdbId === record.tmdbId && record.facts?.tmdbId === record.tmdbId && Array.isArray(record.curatedMovie.palette) && record.curatedMovie.palette.length === 2, 'T3_RUNTIME_PLAN_PROJECTION_INVALID')
  return true
}

export function validateRuntimeAssemblyAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-runtime-assembly-authorization.v1' && authorization.runtimeAssemblyPopulation === 139 && authorization.runtimeAssemblyAuthorized === true && authorization.runtimeWriteAuthorized === false, 'T3_RUNTIME_AUTHORIZATION_SCOPE_INVALID')
  fail(authorization.semanticMutationAllowed === false && authorization.factualMutationAllowed === false && authorization.paletteRegenerationAllowed === false && authorization.posterAcquisitionAllowed === false && authorization.networkCallsAuthorized === 0 && authorization.providerCallsAuthorized === 0 && authorization.releaseAllowed === false && authorization.deploymentAllowed === false, 'T3_RUNTIME_AUTHORIZATION_BOUNDARY_INVALID')
  fail(authorization.bindings && Object.values(authorization.bindings).every((binding) => binding?.path && binding.rawFileHash === rawHash(repoRoot, binding.path)), 'T3_RUNTIME_AUTHORIZATION_BINDING_INVALID')
  const plan = buildRuntimeAssemblyPlan({ repoRoot }); validateRuntimeAssemblyPlan(plan)
  fail(authorization.expectedFinalCount === plan.expectedFinalCount && JSON.stringify(authorization.targetPaths) === JSON.stringify(RUNTIME_TARGETS) && authorization.bindings.runtimeAssemblyPlan.rawFileHash === rawHash(repoRoot, authorization.bindings.runtimeAssemblyPlan.path), 'T3_RUNTIME_AUTHORIZATION_PLAN_INVALID')
  return true
}
