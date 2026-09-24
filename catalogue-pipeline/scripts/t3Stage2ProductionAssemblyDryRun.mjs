import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { suggestLocalId } from '../../scripts/curateCore.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateMovieFacts } from './validateBatch.mjs'
import { validateProductionRecordV2 } from './validateProductionRecordV2.mjs'
import { paletteFromPosterV11, PALETTE_ALGORITHM_VERSION_V11 } from './paletteAlgorithmV11.mjs'
import { AUTHORIZATION_PATH as STAGE2_AUTHORIZATION_PATH, buildStage2Authorization, DRY_RUN_ROOT, validateStage2Authorization } from './t3Stage2AssemblyDryRunAuthorization.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const EXECUTION_AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-production-assembly-dry-run-execution-authorization.v5.json`
const PREDECESSOR_EXECUTION_AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-production-assembly-dry-run-execution-authorization.v4.json`
export const MANIFEST_PATH = `${DRY_RUN_ROOT}/t3-stage-2-production-assembly-dry-run-manifest.v1.json`
export const LEDGER_PATH = `${DRY_RUN_ROOT}/t3-stage-2-readiness-ledger.v1.json`
const COPY_FIELDS = ['description', 'whyWatch', 'curiosityHook', 'vibeSummary']
const read = (repoRoot, relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
const rawHash = (repoRoot, relativePath) => hashBytes(fs.readFileSync(path.join(repoRoot, relativePath)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const sorted = (values) => [...values].sort()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pathFor = (candidateId) => `${DRY_RUN_ROOT}/records/${candidateId}.json`

function write(relativePath, value, root = REPO) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
}

function localIdMap(candidates, runtime) {
  const used = new Set(runtime.map((record) => record.id))
  const bases = candidates.map(({ candidateId, tmdbId, fact }) => ({ candidateId, tmdbId, base: suggestLocalId(fact.title, fact.year) }))
  const counts = new Map()
  for (const row of bases) counts.set(row.base, (counts.get(row.base) ?? 0) + 1)
  const result = new Map()
  for (const row of bases) {
    const id = counts.get(row.base) > 1 || used.has(row.base) ? `${row.base}-${row.tmdbId}` : row.base
    fail(!used.has(id), 'T3_STAGE_2_DUPLICATE_RUNTIME_ID')
    used.add(id); result.set(row.candidateId, id)
  }
  return result
}

function resolveEditorialSources(repoRoot, acceptedIds) {
  const historical = read(repoRoot, `${ROOT}/t3-human-repair-closure-ledger.v2.json`)
  const postClosure = read(repoRoot, `${ROOT}/t3-post-closure-renewed-human-closure-ledger.v1.json`)
  const postBundle = read(repoRoot, `${ROOT}/post-closure-rework-renewed-human-review.v1.json`)
  const directLedger = read(repoRoot, `${ROOT}/t3-direct-review-renewed-human-closure-ledger.v1.json`)
  const directAttempt = read(repoRoot, `${ROOT}/direct-review-repair-attempts-v1/001-scale500-tmdb-9299.json`)
  const directJudgment = read(repoRoot, `${ROOT}/direct-review-renewed-human-judgments-v1/001-scale500-tmdb-9299.json`)
  const autoLedger = read(repoRoot, `${ROOT}/full-auto-cleared-human-review-ledger.v1.json`)
  const entries = new Map()
  for (const record of autoLedger.records) {
    if (record.decision !== 'APPROVE') continue
    const sourcePath = `${ROOT}/execution/scale-tranche-3/writers/${record.candidateId}/output.json`
    const source = read(repoRoot, sourcePath)
    fail(hashArtifact(source) === record.outputHash, 'T3_STAGE_2_AUTOMATED_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: sourcePath, hash: record.outputHash, copy: source.copy, kind: 'ORIGINAL_HUMAN_APPROVED_OUTPUT' })
  }
  for (const record of historical.records) {
    if (record.decision !== 'ACCEPT_REPAIR') continue
    const source = read(repoRoot, record.finalPreviewPath)
    fail(source.artifactHash === record.finalPreviewHash || hashArtifact(source) === record.finalPreviewHash, 'T3_STAGE_2_HISTORICAL_REPAIR_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: record.finalPreviewPath, hash: record.finalPreviewHash, copy: source.output.copy, kind: 'HISTORICAL_HUMAN_REPAIR_CLOSURE' })
  }
  const postBundleById = new Map(postBundle.records.map((record) => [record.candidateId, record]))
  for (const record of postClosure.records) {
    if (record.decision !== 'ACCEPT_REPAIR') continue
    const bundle = postBundleById.get(record.candidateId); fail(bundle, 'T3_STAGE_2_POST_CLOSURE_BUNDLE_MISSING')
    const source = read(repoRoot, bundle.proposalPath)
    fail(source.artifactHash === record.proposalHash || hashArtifact(source) === record.proposalHash, 'T3_STAGE_2_POST_CLOSURE_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: bundle.proposalPath, hash: record.proposalHash, copy: source.output.copy, kind: 'POST_CLOSURE_RENEWED_HUMAN_REPAIR' })
  }
  fail(directLedger.accepted === 1 && directJudgment.decision === 'ACCEPT_REPAIR' && directAttempt.machineSemanticAcceptance === false && directAttempt.mechanicalDisposition === 'ELIGIBLE_FOR_RENEWED_DIRECT_HUMAN_CLOSURE', 'T3_STAGE_2_DIRECT_REPAIR_HISTORY_INVALID')
  entries.set('scale500-tmdb-9299', { path: `${ROOT}/direct-review-repair-attempts-v1/001-scale500-tmdb-9299.json`, hash: directAttempt.artifactHash, copy: directAttempt.reconstructedEditorialCopy, kind: 'DIRECT_REVIEW_RENEWED_HUMAN_REPAIR' })
  fail(entries.size === 139 && same(sorted(entries.keys()), sorted(acceptedIds)), 'T3_STAGE_2_FINAL_EDITORIAL_POPULATION_INVALID')
  return entries
}

function factFor(candidate, repoRoot) {
  const snapshot = read(repoRoot, candidate.sourceBindings.factsRecord.path)
  const fact = snapshot.facts.find((row) => row.candidateId === candidate.candidateId && row.tmdbId === candidate.tmdbId)
  fail(fact && hashArtifact(fact) === candidate.sourceBindings.factsRecord.artifactHash, 'T3_STAGE_2_FACTUAL_BINDING_INVALID')
  return fact
}

function localPoster(candidateId, fact, repoRoot) {
  const roots = [
    'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/production-assembly-v1_1/poster-cache/w500',
    'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/production-assembly-canary-v1/poster-cache/w500',
  ]
  for (const root of roots) {
    const base = path.join(repoRoot, root, candidateId)
    const poster = path.join(base, 'poster'); const request = path.join(base, 'request.json'); const response = path.join(base, 'response.json')
    if (!fs.existsSync(poster) || !fs.existsSync(request) || !fs.existsSync(response)) continue
    const req = JSON.parse(fs.readFileSync(request, 'utf8')); const res = JSON.parse(fs.readFileSync(response, 'utf8'))
    if (req.candidateId === candidateId && req.posterPath === fact.posterPath && res.httpStatus === 200 && res.rawSha256 === hashBytes(fs.readFileSync(poster))) return { bytes: fs.readFileSync(poster), sourcePath: path.relative(repoRoot, poster) }
  }
  return null
}

export function buildExecutionAuthorization({ repoRoot = REPO } = {}) {
  const stage2Authorization = read(repoRoot, STAGE2_AUTHORIZATION_PATH)
  validateStage2Authorization(stage2Authorization)
  const paths = {
    stage2Authorization: STAGE2_AUTHORIZATION_PATH,
    finalClosure: `${ROOT}/t3-final-closure.v1.json`, promotionReadiness: `${ROOT}/t3-promotion-readiness.v1.json`, reconciliation: `${ROOT}/t3-remaining-route-reconciliation.v3.json`,
    executor: 'catalogue-pipeline/scripts/t3Stage2ProductionAssemblyDryRun.mjs', productionSchema: 'catalogue-pipeline/schemas/production-record.v2.schema.json',
    productionValidator: 'catalogue-pipeline/scripts/validateProductionRecordV2.mjs', promotionContract: 'catalogue-pipeline/scripts/validatePromotionContract.mjs', paletteAlgorithm: 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs',
  }
  const bindings = Object.fromEntries(Object.entries(paths).map(([name, relativePath]) => [name, { path: relativePath, rawFileHash: rawHash(repoRoot, relativePath), ...(relativePath.endsWith('.json') ? { canonicalArtifactHash: hashArtifact(read(repoRoot, relativePath)) } : {}) }]))
  fail(bindings.stage2Authorization.canonicalArtifactHash === hashArtifact(stage2Authorization), 'T3_STAGE_2_EXECUTION_STAGE2_AUTH_BINDING_INVALID')
  const predecessor = read(repoRoot, PREDECESSOR_EXECUTION_AUTHORIZATION_PATH)
  return { schemaVersion: 't3-stage-2-production-assembly-dry-run-execution-authorization.v5', status: 'T3_STAGE_2_DRY_RUN_EXECUTION_AUTHORIZED', trancheId: 'SCALE_TRANCHE_3', predecessor: { path: PREDECESSOR_EXECUTION_AUTHORIZATION_PATH, hash: hashArtifact(predecessor), disposition: 'PRE_EXECUTION_SEMANTIC_ENVELOPE_VALIDATOR_SHAPE_INTEGRITY_FAILURE_NO_OUTPUT_OR_ATTEMPT_PERSISTED' }, bindings, candidateIds: stage2Authorization.candidateIds, candidateIdsHash: stage2Authorization.candidateIdsHash, executionPopulation: 139, dryRunOnly: true, providerCallsAuthorized: 0, semanticMutationAllowed: false, runtimeWriteAllowed: false, promotionAllowed: false, posterPolicy: 'LOCAL_FROZEN_ASSETS_ONLY_NO_NETWORK_NO_SUBSTITUTION', outputRoot: DRY_RUN_ROOT, executionAuthorized: true, executionCompleted: false }
}

export function validateExecutionAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-stage-2-production-assembly-dry-run-execution-authorization.v5' && authorization.status === 'T3_STAGE_2_DRY_RUN_EXECUTION_AUTHORIZED' && authorization.trancheId === 'SCALE_TRANCHE_3', 'T3_STAGE_2_EXECUTION_AUTH_IDENTITY_INVALID')
  fail(authorization.executionPopulation === 139 && authorization.candidateIds.length === 139 && authorization.candidateIdsHash === hashArtifact(authorization.candidateIds), 'T3_STAGE_2_EXECUTION_AUTH_POPULATION_INVALID')
  fail(authorization.dryRunOnly === true && authorization.providerCallsAuthorized === 0 && authorization.semanticMutationAllowed === false && authorization.runtimeWriteAllowed === false && authorization.promotionAllowed === false && authorization.outputRoot === DRY_RUN_ROOT && authorization.executionAuthorized === true && authorization.executionCompleted === false, 'T3_STAGE_2_EXECUTION_AUTH_SCOPE_INVALID')
  for (const binding of Object.values(authorization.bindings)) fail(rawHash(repoRoot, binding.path) === binding.rawFileHash, 'T3_STAGE_2_EXECUTION_AUTH_BINDING_DRIFT')
  const stage2Authorization = read(repoRoot, STAGE2_AUTHORIZATION_PATH)
  fail(hashArtifact(stage2Authorization) === authorization.bindings.stage2Authorization.canonicalArtifactHash && same(stage2Authorization.candidateIds, authorization.candidateIds), 'T3_STAGE_2_EXECUTION_AUTH_STAGE2_DRIFT')
  fail(authorization.predecessor?.path === PREDECESSOR_EXECUTION_AUTHORIZATION_PATH && authorization.predecessor?.hash === hashArtifact(read(repoRoot, PREDECESSOR_EXECUTION_AUTHORIZATION_PATH)) && authorization.predecessor?.disposition === 'PRE_EXECUTION_SEMANTIC_ENVELOPE_VALIDATOR_SHAPE_INTEGRITY_FAILURE_NO_OUTPUT_OR_ATTEMPT_PERSISTED', 'T3_STAGE_2_EXECUTION_AUTH_PREDECESSOR_INVALID')
  return true
}

function buildRows(repoRoot, executionAuthorization) {
  const closure = read(repoRoot, `${ROOT}/t3-final-closure.v1.json`)
  const cohort = read(repoRoot, `${ROOT}/cohort-manifest.json`)
  const runtime = read(repoRoot, 'src/data/tmdbMovieMappings.json')
  const acceptedIds = closure.partitions.humanSemanticClosureAcceptedCandidateIds
  fail(same(acceptedIds, executionAuthorization.candidateIds), 'T3_STAGE_2_EXECUTION_ACCEPTED_SET_DRIFT')
  const excluded = new Set([...closure.partitions.terminalPreHumanExclusionCandidateIds, ...closure.partitions.structuralQuarantineCandidateIds, 'exp100-tmdb-1156593'])
  const candidates = acceptedIds.map((candidateId) => cohort.records.find((record) => record.candidateId === candidateId))
  fail(candidates.every(Boolean) && candidates.every((candidate) => !excluded.has(candidate.candidateId)), 'T3_STAGE_2_EXECUTION_EXCLUSION_LEAKAGE')
  const editorial = resolveEditorialSources(repoRoot, acceptedIds)
  const prepared = candidates.map((candidate) => {
    const semantic = read(repoRoot, candidate.sourceBindings.semanticArtifact.path); const evidence = read(repoRoot, candidate.sourceBindings.evidencePacket.path); const fact = factFor(candidate, repoRoot); const final = editorial.get(candidate.candidateId)
    fail(hashArtifact(semantic) === candidate.sourceBindings.semanticArtifact.artifactHash && hashArtifact(evidence) === candidate.sourceBindings.evidencePacket.artifactHash, 'T3_STAGE_2_EXECUTION_SOURCE_BINDING_INVALID')
    const classification = semantic.classification
    fail(classification && ['moods', 'situations', 'filterLanguages', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].every((field) => classification[field] !== undefined) && validateMovieFacts(fact).ok && final && COPY_FIELDS.every((field) => typeof final.copy[field] === 'string'), 'T3_STAGE_2_EXECUTION_SEMANTIC_OR_FACTUAL_VALIDATION_INVALID')
    return { candidate, semantic, evidence, fact, final }
  })
  const ids = localIdMap(prepared.map((row) => ({ ...row.candidate, fact: row.fact })), runtime)
  const runtimeTmdbIds = new Set(runtime.map((record) => record.tmdbId))
  return prepared.map((row) => ({ ...row, localId: ids.get(row.candidate.candidateId), runtimeTmdbCollision: runtimeTmdbIds.has(row.candidate.tmdbId) }))
}

async function assembleRow(row, repoRoot) {
  const candidateId = row.candidate.candidateId
  fail(!row.runtimeTmdbCollision, 'T3_STAGE_2_DUPLICATE_RUNTIME_TMDB_ID')
  const poster = localPoster(candidateId, row.fact, repoRoot)
  if (!poster) return { schemaVersion: 't3-stage-2-dry-run-record.v1', candidateId, tmdbId: row.candidate.tmdbId, status: 'STAGE_2_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY', reasons: [{ code: 'LOCAL_POSTER_ASSET_UNAVAILABLE', field: 'facts.posterPath', message: 'No matching frozen local poster asset is available; network acquisition and substitution are forbidden.' }], bindings: { semanticArtifactHash: hashArtifact(row.semantic), evidencePacketHash: hashArtifact(row.evidence), factsRecordHash: hashArtifact(row.fact), finalEditorialArtifactHash: row.final.hash }, productionRecord: null }
  const palette = { schemaVersion: 'palette-artifact.v1', candidateId, tmdbId: row.candidate.tmdbId, palette: await paletteFromPosterV11(poster.bytes), method: 'poster-algorithm', sourcePosterIdentity: { posterPath: row.fact.posterPath }, sourcePosterHash: hashBytes(poster.bytes), algorithmVersion: PALETTE_ALGORITHM_VERSION_V11, override: null }
  const promotion = { schemaVersion: 'promotion-candidate.v1', candidateId, tmdbId: row.candidate.tmdbId, cohortId: 'SCALE_TRANCHE_3', candidateCohortHash: hashArtifact(row.candidate), sourceHashes: { semanticArtifact: hashArtifact(row.semantic), evidencePacket: hashArtifact(row.evidence), factsRecord: hashArtifact(row.fact) } }
  const production = { schemaVersion: 'production-record.v2', candidateId, tmdbId: row.candidate.tmdbId, curatedMovie: { id: row.localId, tmdbId: row.candidate.tmdbId, ...row.semantic.classification, ...row.final.copy, palette: palette.palette }, facts: Object.fromEntries(['tmdbId', 'title', 'year', 'director', 'countries', 'spokenLanguages', 'genres', 'runtimeMinutes', 'posterPath'].map((field) => [field, row.fact[field]])), provenance: { promotionCandidateHash: hashArtifact(promotion), semanticArtifactHash: hashArtifact(row.semantic), evidencePacketHash: hashArtifact(row.evidence), factsRecordHash: hashArtifact(row.fact), finalEditorialArtifactHash: row.final.hash, paletteArtifactHash: hashArtifact(palette) } }
  const validation = validateProductionRecordV2(production, { existingIds: new Set(), existingTmdbIds: new Set(), promotionCandidate: promotion, semanticArtifact: row.semantic, evidencePacket: row.evidence, factsRecord: row.fact, finalEditorialArtifact: { schemaVersion: 'editorial-artifact.v1.1', candidateId, tmdbId: row.candidate.tmdbId, output: { movie: row.semantic.movie, copy: row.final.copy } }, paletteArtifact: palette })
  return { schemaVersion: 't3-stage-2-dry-run-record.v1', candidateId, tmdbId: row.candidate.tmdbId, status: validation.ok ? 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION' : 'STAGE_2_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY', reasons: validation.hardFailures, bindings: { semanticArtifactHash: hashArtifact(row.semantic), evidencePacketHash: hashArtifact(row.evidence), factsRecordHash: hashArtifact(row.fact), finalEditorialArtifactHash: row.final.hash, paletteArtifactHash: hashArtifact(palette) }, productionRecord: production }
}

export async function executeDryRun({ repoRoot = REPO } = {}) {
  fail(!fs.existsSync(path.join(repoRoot, DRY_RUN_ROOT)), 'T3_STAGE_2_DRY_RUN_REPLAY_REJECTED')
  const authorization = read(repoRoot, EXECUTION_AUTHORIZATION_PATH); validateExecutionAuthorization(authorization, { repoRoot })
  const rows = buildRows(repoRoot, authorization)
  const results = await Promise.all(rows.map((row) => assembleRow(row, repoRoot)))
  const reproduced = await Promise.all(rows.map((row) => assembleRow(row, repoRoot)))
  fail(same(results, reproduced), 'T3_STAGE_2_DRY_RUN_NONDETERMINISTIC')
  const records = results.map((result) => ({ candidateId: result.candidateId, tmdbId: result.tmdbId, status: result.status, artifactPath: pathFor(result.candidateId), artifactHash: hashArtifact(result) }))
  const passed = records.filter((record) => record.status === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION').length
  const failed = records.length - passed
  const manifest = { schemaVersion: 't3-stage-2-production-assembly-dry-run-manifest.v1', status: failed ? 'COMPLETE_WITH_DETERMINISTIC_FAILURES' : 'COMPLETE_ALL_PASS', executionAuthorizationHash: hashArtifact(authorization), executorSourceHash: authorization.bindings.executor.rawFileHash, population: 139, candidateIds: authorization.candidateIds, records, aggregate: { assembled: passed, passed, failed, pending: 0, providerCalls: 0, runtimeWrites: 0, promotionWrites: 0, determinism: 'PASS', runtimeCompatibility: passed === 139 ? 'PASS' : 'NOT_REACHED_DUE_TO_CANDIDATE_FAILURES' }, promotionAuthorized: false, runtimeAssemblyAuthorized: false }
  const ledger = { schemaVersion: 't3-stage-2-readiness-ledger.v1', status: failed ? 'COMPLETE_WITH_FAILURES_AWAITING_FAILURE_RECONCILIATION' : 'COMPLETE_AWAITING_EXPLICIT_PROMOTION_AUTHORIZATION', manifestHash: hashArtifact(manifest), population: 139, assembled: passed, passed, failed, pending: 0, promotionAuthorizationEligible: passed, promotionAuthorized: false, runtimeAssemblyAuthorized: false, providerCallsAdded: 0, runtimeWrites: 0, promotionWrites: 0 }
  const temporary = `${DRY_RUN_ROOT}.tmp-${process.pid}`
  fail(!fs.existsSync(path.join(repoRoot, temporary)), 'T3_STAGE_2_DRY_RUN_TEMP_EXISTS')
  try { for (const result of results) write(path.join(temporary, 'records', `${result.candidateId}.json`), result, repoRoot); write(path.join(temporary, 't3-stage-2-production-assembly-dry-run-manifest.v1.json'), manifest, repoRoot); write(path.join(temporary, 't3-stage-2-readiness-ledger.v1.json'), ledger, repoRoot); fs.renameSync(path.join(repoRoot, temporary), path.join(repoRoot, DRY_RUN_ROOT)) } catch (error) { fs.rmSync(path.join(repoRoot, temporary), { recursive: true, force: true }); throw error }
  return { manifest, ledger, results }
}

export function writeExecutionAuthorization({ repoRoot = REPO } = {}) {
  fail(!fs.existsSync(path.join(repoRoot, EXECUTION_AUTHORIZATION_PATH)), 'T3_STAGE_2_EXECUTION_AUTH_REPLAY_REJECTED')
  const authorization = buildExecutionAuthorization({ repoRoot }); validateExecutionAuthorization(authorization, { repoRoot }); write(EXECUTION_AUTHORIZATION_PATH, authorization, repoRoot); return { authorization, authorizationHash: hashArtifact(authorization) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2]
  if (mode === '--authorize') console.log(JSON.stringify(writeExecutionAuthorization(), null, 2))
  else if (mode === '--execute') executeDryRun().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { throw error })
  else throw new Error('Usage: --authorize | --execute')
}
