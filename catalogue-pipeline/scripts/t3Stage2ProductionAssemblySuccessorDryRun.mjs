import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { suggestLocalId } from '../../scripts/curateCore.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateMovieFacts } from './validateBatch.mjs'
import { validateProductionRecordV2 } from './validateProductionRecordV2.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const HISTORICAL_DRY_RUN_ROOT = `${ROOT}/stage-2-production-assembly-dry-run-v1`
export const SUCCESSOR_DRY_RUN_ROOT = `${ROOT}/stage-2-production-assembly-dry-run-v2`
export const POSTER_COMPLETION_PATH = `${ROOT}/stage-2-poster-assets-v1/t3-stage-2-poster-acquisition-completion-manifest.v1.json`
export const POSTER_LEDGER_PATH = `${ROOT}/stage-2-poster-assets-v1/t3-stage-2-poster-acquisition-execution-ledger.v1.json`
export const PALETTE_COMPLETION_PATH = `${ROOT}/stage-2-palette-artifacts-v1/t3-stage-2-palette-generation-completion-manifest.v1.json`
export const PALETTE_LEDGER_PATH = `${ROOT}/stage-2-palette-artifacts-v1/t3-stage-2-palette-generation-execution-ledger.v1.json`

const COPY_FIELDS = ['description', 'whyWatch', 'curiosityHook', 'vibeSummary']
const read = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const rawHash = (root, relative) => hashBytes(fs.readFileSync(path.join(root, relative)))
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (values) => [...values].sort()

export function validateSuccessorOutputPath(relativePath) {
  return relativePath === SUCCESSOR_DRY_RUN_ROOT || relativePath?.startsWith(`${SUCCESSOR_DRY_RUN_ROOT}/`)
}

export function validateExactAcceptedCandidateIds(candidateIds, { repoRoot = REPO } = {}) {
  const closure = read(repoRoot, `${ROOT}/t3-final-closure.v1.json`)
  const expected = closure.partitions.humanSemanticClosureAcceptedCandidateIds
  fail(Array.isArray(candidateIds) && candidateIds.length === 139 && new Set(candidateIds).size === 139 && same(sorted(candidateIds), sorted(expected)), 'T3_SUCCESSOR_STAGE_2_ACCEPTED_POPULATION_INVALID')
  return true
}

function requireInsideSuccessorRoot(relativePath) {
  fail(validateSuccessorOutputPath(relativePath), 'T3_SUCCESSOR_STAGE_2_OUTPUT_PATH_FORBIDDEN')
  fail(!relativePath.startsWith(HISTORICAL_DRY_RUN_ROOT), 'T3_SUCCESSOR_STAGE_2_HISTORICAL_V1_PATH_FORBIDDEN')
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
    const sourcePath = `${ROOT}/execution/scale-tranche-3/writers/${record.candidateId}/output.json`; const source = read(repoRoot, sourcePath)
    fail(hashArtifact(source) === record.outputHash, 'T3_SUCCESSOR_STAGE_2_AUTOMATED_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: sourcePath, hash: record.outputHash, copy: source.copy })
  }
  for (const record of historical.records) {
    if (record.decision !== 'ACCEPT_REPAIR') continue
    const source = read(repoRoot, record.finalPreviewPath)
    fail(source.artifactHash === record.finalPreviewHash || hashArtifact(source) === record.finalPreviewHash, 'T3_SUCCESSOR_STAGE_2_HISTORICAL_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: record.finalPreviewPath, hash: record.finalPreviewHash, copy: source.output.copy })
  }
  const postBundleById = new Map(postBundle.records.map((record) => [record.candidateId, record]))
  for (const record of postClosure.records) {
    if (record.decision !== 'ACCEPT_REPAIR') continue
    const bundle = postBundleById.get(record.candidateId); fail(bundle, 'T3_SUCCESSOR_STAGE_2_POST_CLOSURE_BUNDLE_MISSING')
    const source = read(repoRoot, bundle.proposalPath)
    fail(source.artifactHash === record.proposalHash || hashArtifact(source) === record.proposalHash, 'T3_SUCCESSOR_STAGE_2_POST_CLOSURE_EDITORIAL_BINDING_INVALID')
    entries.set(record.candidateId, { path: bundle.proposalPath, hash: record.proposalHash, copy: source.output.copy })
  }
  fail(directLedger.accepted === 1 && directJudgment.decision === 'ACCEPT_REPAIR' && directAttempt.machineSemanticAcceptance === false && directAttempt.mechanicalDisposition === 'ELIGIBLE_FOR_RENEWED_DIRECT_HUMAN_CLOSURE', 'T3_SUCCESSOR_STAGE_2_DIRECT_REPAIR_HISTORY_INVALID')
  entries.set('scale500-tmdb-9299', { path: `${ROOT}/direct-review-repair-attempts-v1/001-scale500-tmdb-9299.json`, hash: directAttempt.artifactHash, copy: directAttempt.reconstructedEditorialCopy })
  fail(entries.size === 139 && same(sorted(entries.keys()), sorted(acceptedIds)), 'T3_SUCCESSOR_STAGE_2_EDITORIAL_POPULATION_INVALID')
  return entries
}

function factFor(candidate, repoRoot) {
  const snapshot = read(repoRoot, candidate.sourceBindings.factsRecord.path)
  const fact = snapshot.facts.find((row) => row.candidateId === candidate.candidateId && row.tmdbId === candidate.tmdbId)
  fail(fact && hashArtifact(fact) === candidate.sourceBindings.factsRecord.artifactHash, 'T3_SUCCESSOR_STAGE_2_FACTUAL_BINDING_INVALID')
  return fact
}

function localIdMap(rows, runtime) {
  const used = new Set(runtime.map((record) => record.id)); const counts = new Map()
  const bases = rows.map(({ candidate, fact }) => ({ candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, base: suggestLocalId(fact.title, fact.year) }))
  for (const row of bases) counts.set(row.base, (counts.get(row.base) ?? 0) + 1)
  const ids = new Map()
  for (const row of bases) { const id = counts.get(row.base) > 1 || used.has(row.base) ? `${row.base}-${row.tmdbId}` : row.base; fail(!used.has(id), 'T3_SUCCESSOR_STAGE_2_DUPLICATE_RUNTIME_ID'); used.add(id); ids.set(row.candidateId, id) }
  return ids
}

export function validatePosterBinding({ candidate, fact, acquisitionRecord, acquisitionResult, posterBytes }) {
  fail(acquisitionRecord?.status === 'POSTER_ASSET_ACQUIRED', 'T3_SUCCESSOR_STAGE_2_POSTER_NOT_ACQUIRED')
  fail(acquisitionRecord.candidateId === candidate.candidateId && acquisitionRecord.tmdbId === candidate.tmdbId && acquisitionRecord.posterPath === fact.posterPath, 'T3_SUCCESSOR_STAGE_2_POSTER_IDENTITY_OR_PATH_MISMATCH')
  fail(acquisitionResult?.status === 'POSTER_ASSET_ACQUIRED' && acquisitionResult.candidateId === candidate.candidateId && acquisitionResult.tmdbId === candidate.tmdbId && acquisitionResult.posterPath === fact.posterPath, 'T3_SUCCESSOR_STAGE_2_POSTER_RESULT_PROVENANCE_INVALID')
  fail(acquisitionResult.localAssetPath === acquisitionRecord.localAssetPath && acquisitionResult.posterByteHash === acquisitionRecord.posterByteHash, 'T3_SUCCESSOR_STAGE_2_POSTER_RESULT_MANIFEST_MISMATCH')
  fail(hashBytes(posterBytes) === acquisitionRecord.posterByteHash, 'T3_SUCCESSOR_STAGE_2_POSTER_BYTE_HASH_MISMATCH')
  return true
}

export function validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord, paletteArtifact, paletteAlgorithmHash }) {
  fail(paletteRecord?.status === 'PALETTE_GENERATED' && paletteRecord.secondPassDeterminism === 'PASS', 'T3_SUCCESSOR_STAGE_2_PALETTE_NOT_GENERATED')
  fail(paletteRecord.candidateId === candidate.candidateId && paletteRecord.tmdbId === candidate.tmdbId, 'T3_SUCCESSOR_STAGE_2_PALETTE_IDENTITY_MISMATCH')
  fail(paletteRecord.sourcePosterHash === acquisitionRecord.posterByteHash && paletteArtifact.sourcePosterHash === acquisitionRecord.posterByteHash, 'T3_SUCCESSOR_STAGE_2_PALETTE_POSTER_HASH_MISMATCH')
  fail(paletteArtifact.candidateId === candidate.candidateId && paletteArtifact.tmdbId === candidate.tmdbId && paletteArtifact.sourcePosterIdentity?.posterPath === fact.posterPath, 'T3_SUCCESSOR_STAGE_2_PALETTE_ARTIFACT_IDENTITY_OR_PATH_MISMATCH')
  fail(hashArtifact(paletteArtifact) === paletteRecord.paletteArtifactHash, 'T3_SUCCESSOR_STAGE_2_PALETTE_ARTIFACT_HASH_MISMATCH')
  fail(paletteArtifact.t3Bindings?.paletteAlgorithmRawFileHash === paletteAlgorithmHash, 'T3_SUCCESSOR_STAGE_2_PALETTE_ALGORITHM_BINDING_MISMATCH')
  return true
}

export function loadSuccessorRows({ repoRoot = REPO } = {}) {
  const closure = read(repoRoot, `${ROOT}/t3-final-closure.v1.json`)
  const cohort = read(repoRoot, `${ROOT}/cohort-manifest.json`)
  const posterCompletion = read(repoRoot, POSTER_COMPLETION_PATH); const posterLedger = read(repoRoot, POSTER_LEDGER_PATH)
  const paletteCompletion = read(repoRoot, PALETTE_COMPLETION_PATH); const paletteLedger = read(repoRoot, PALETTE_LEDGER_PATH)
  const acceptedIds = closure.partitions.humanSemanticClosureAcceptedCandidateIds
  validateExactAcceptedCandidateIds(acceptedIds, { repoRoot })
  fail(posterCompletion.status === 'COMPLETE_ALL_ACQUIRED' && posterCompletion.population === 139 && posterCompletion.acquiredCandidateIds.length === 139 && posterCompletion.failedCandidateIds.length === 0 && posterLedger.acquired === 139 && posterLedger.failed === 0, 'T3_SUCCESSOR_STAGE_2_POSTER_COMPLETION_INVALID')
  fail(paletteCompletion.status === 'COMPLETE_ALL_GENERATED' && paletteCompletion.population === 139 && paletteCompletion.generatedCandidateIds.length === 139 && paletteCompletion.failedCandidateIds.length === 0 && paletteLedger.generated === 139 && paletteLedger.failed === 0 && paletteLedger.determinismPassed === 139, 'T3_SUCCESSOR_STAGE_2_PALETTE_COMPLETION_INVALID')
  fail(same(sorted(acceptedIds), sorted(posterCompletion.acquiredCandidateIds)) && same(sorted(acceptedIds), sorted(paletteCompletion.generatedCandidateIds)), 'T3_SUCCESSOR_STAGE_2_ASSET_POPULATION_MISMATCH')
  const excluded = new Set([...closure.partitions.terminalPreHumanExclusionCandidateIds, ...closure.partitions.structuralQuarantineCandidateIds, 'exp100-tmdb-1156593'])
  const posters = new Map(posterCompletion.records.map((record) => [record.candidateId, record])); const palettes = new Map(paletteCompletion.records.map((record) => [record.candidateId, record]))
  const editorial = resolveEditorialSources(repoRoot, acceptedIds); const paletteAlgorithmHash = rawHash(repoRoot, 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs')
  const rows = acceptedIds.map((candidateId) => {
    const candidate = cohort.records.find((record) => record.candidateId === candidateId); fail(candidate && !excluded.has(candidateId), 'T3_SUCCESSOR_STAGE_2_EXCLUSION_LEAKAGE')
    const semantic = read(repoRoot, candidate.sourceBindings.semanticArtifact.path); const evidence = read(repoRoot, candidate.sourceBindings.evidencePacket.path); const fact = factFor(candidate, repoRoot); const final = editorial.get(candidateId)
    fail(hashArtifact(semantic) === candidate.sourceBindings.semanticArtifact.artifactHash && hashArtifact(evidence) === candidate.sourceBindings.evidencePacket.artifactHash && validateMovieFacts(fact).ok && final && COPY_FIELDS.every((field) => typeof final.copy[field] === 'string'), 'T3_SUCCESSOR_STAGE_2_SEMANTIC_OR_FACTUAL_BINDING_INVALID')
    const acquisitionRecord = posters.get(candidateId); const acquisitionResult = read(repoRoot, `${ROOT}/stage-2-poster-assets-v1/assets/${candidateId}/result.json`); const posterBytes = fs.readFileSync(path.join(repoRoot, acquisitionRecord?.localAssetPath ?? ''))
    const paletteRecord = palettes.get(candidateId); const paletteArtifact = read(repoRoot, paletteRecord?.paletteArtifactPath)
    validatePosterBinding({ candidate, fact, acquisitionRecord, acquisitionResult, posterBytes }); validatePaletteBinding({ candidate, fact, acquisitionRecord, paletteRecord, paletteArtifact, paletteAlgorithmHash })
    return { candidate, semantic, evidence, fact, final, acquisitionRecord, paletteRecord, paletteArtifact }
  })
  const runtime = read(repoRoot, 'src/data/tmdbMovieMappings.json'); const ids = localIdMap(rows, runtime); const runtimeTmdbIds = new Set(runtime.map((record) => record.tmdbId))
  return rows.map((row) => ({ ...row, localId: ids.get(row.candidate.candidateId), runtimeTmdbCollision: runtimeTmdbIds.has(row.candidate.tmdbId) }))
}

export function assembleSuccessorRow(row) {
  const { candidate, semantic, evidence, fact, final, paletteArtifact, localId } = row
  fail(!row.runtimeTmdbCollision, 'T3_SUCCESSOR_STAGE_2_DUPLICATE_RUNTIME_TMDB_ID')
  const promotion = { schemaVersion: 'promotion-candidate.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, cohortId: 'SCALE_TRANCHE_3', candidateCohortHash: hashArtifact(candidate), sourceHashes: { semanticArtifact: hashArtifact(semantic), evidencePacket: hashArtifact(evidence), factsRecord: hashArtifact(fact) } }
  const finalEditorialArtifact = { schemaVersion: 'editorial-artifact.v1.1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, output: { movie: semantic.movie, copy: final.copy } }
  const production = { schemaVersion: 'production-record.v2', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, curatedMovie: { id: localId, tmdbId: candidate.tmdbId, ...semantic.classification, ...final.copy, palette: paletteArtifact.palette }, facts: Object.fromEntries(['tmdbId', 'title', 'year', 'director', 'countries', 'spokenLanguages', 'genres', 'runtimeMinutes', 'posterPath'].map((field) => [field, fact[field]])), provenance: { promotionCandidateHash: hashArtifact(promotion), semanticArtifactHash: hashArtifact(semantic), evidencePacketHash: hashArtifact(evidence), factsRecordHash: hashArtifact(fact), finalEditorialArtifactHash: hashArtifact(finalEditorialArtifact), paletteArtifactHash: hashArtifact(paletteArtifact) } }
  const validation = validateProductionRecordV2(production, { existingIds: new Set(), existingTmdbIds: new Set(), promotionCandidate: promotion, semanticArtifact: semantic, evidencePacket: evidence, factsRecord: fact, finalEditorialArtifact, paletteArtifact })
  return { schemaVersion: 't3-stage-2-successor-dry-run-record.v1', candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, status: validation.ok ? 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION' : 'STAGE_2_SUCCESSOR_ASSEMBLY_VALIDATION_FAILURE_NOT_PROMOTION_READY', reasons: validation.hardFailures, bindings: { semanticArtifactHash: hashArtifact(semantic), evidencePacketHash: hashArtifact(evidence), factsRecordHash: hashArtifact(fact), finalAcceptedEditorialSourceHash: final.hash, finalEditorialAdapterHash: hashArtifact(finalEditorialArtifact), posterByteHash: row.acquisitionRecord.posterByteHash, paletteArtifactHash: hashArtifact(paletteArtifact), paletteAlgorithmRawFileHash: paletteArtifact.t3Bindings.paletteAlgorithmRawFileHash }, productionRecord: production }
}

export function validateFutureExecutionAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-stage-2-production-assembly-successor-dry-run-execution-authorization.v1' && authorization.executionAuthorized === true && authorization.executionCompleted === false, 'T3_SUCCESSOR_STAGE_2_EXECUTION_AUTHORIZATION_REQUIRED')
  fail(authorization.executionPopulation === 139 && authorization.outputRoot === SUCCESSOR_DRY_RUN_ROOT && authorization.dryRunOnly === true && authorization.networkCallsAuthorized === 0 && authorization.providerCallsAuthorized === 0 && authorization.semanticMutationAllowed === false && authorization.runtimeWriteAllowed === false && authorization.promotionAllowed === false, 'T3_SUCCESSOR_STAGE_2_EXECUTION_SCOPE_INVALID')
  fail(authorization.bindings?.executor?.path === 'catalogue-pipeline/scripts/t3Stage2ProductionAssemblySuccessorDryRun.mjs' && authorization.bindings.executor.rawFileHash === rawHash(repoRoot, authorization.bindings.executor.path), 'T3_SUCCESSOR_STAGE_2_EXECUTOR_BINDING_INVALID')
  return true
}

function writeTemporary(root, relative, value) {
  fail(relative.startsWith(`${SUCCESSOR_DRY_RUN_ROOT}.tmp-`), 'T3_SUCCESSOR_STAGE_2_TEMP_PATH_FORBIDDEN')
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 })
}

export function executeSuccessorDryRun({ authorization, repoRoot = REPO } = {}) {
  validateFutureExecutionAuthorization(authorization, { repoRoot }); requireInsideSuccessorRoot(SUCCESSOR_DRY_RUN_ROOT); fail(!fs.existsSync(path.join(repoRoot, SUCCESSOR_DRY_RUN_ROOT)), 'T3_SUCCESSOR_STAGE_2_DRY_RUN_REPLAY_REJECTED')
  const rows = loadSuccessorRows({ repoRoot }); const results = rows.map(assembleSuccessorRow); const reproduced = rows.map(assembleSuccessorRow)
  fail(same(results, reproduced), 'T3_SUCCESSOR_STAGE_2_NONDETERMINISTIC')
  const records = results.map((result) => ({ candidateId: result.candidateId, tmdbId: result.tmdbId, status: result.status, artifactPath: `${SUCCESSOR_DRY_RUN_ROOT}/records/${result.candidateId}.json`, artifactHash: hashArtifact(result) }))
  const passed = records.filter((record) => record.status === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION').length; const failed = records.length - passed
  const manifest = { schemaVersion: 't3-stage-2-production-assembly-successor-dry-run-manifest.v1', status: failed ? 'COMPLETE_WITH_DETERMINISTIC_FAILURES' : 'COMPLETE_ALL_PASS', executionAuthorizationHash: hashArtifact(authorization), executorSourceHash: authorization.bindings.executor.rawFileHash, population: 139, candidateIds: rows.map((row) => row.candidate.candidateId), records, aggregate: { assembled: passed, passed, failed, pending: 0, networkCalls: 0, providerCalls: 0, runtimeWrites: 0, promotionWrites: 0, determinism: 'PASS', runtimeCompatibility: passed === 139 ? 'PASS' : 'NOT_REACHED_DUE_TO_CANDIDATE_FAILURES' }, promotionAuthorized: false, runtimeAssemblyAuthorized: false }
  const ledger = { schemaVersion: 't3-stage-2-successor-readiness-ledger.v1', status: failed ? 'COMPLETE_WITH_FAILURES_AWAITING_FAILURE_RECONCILIATION' : 'COMPLETE_AWAITING_EXPLICIT_PROMOTION_AUTHORIZATION', manifestHash: hashArtifact(manifest), population: 139, assembled: passed, passed, failed, pending: 0, promotionAuthorizationEligible: passed, promotionAuthorized: false, runtimeAssemblyAuthorized: false, networkCalls: 0, providerCallsAdded: 0, runtimeWrites: 0, promotionWrites: 0 }
  const temporary = `${SUCCESSOR_DRY_RUN_ROOT}.tmp-${process.pid}`
  fail(!fs.existsSync(path.join(repoRoot, temporary)), 'T3_SUCCESSOR_STAGE_2_TEMP_EXISTS')
  try {
    for (const result of results) writeTemporary(repoRoot, `${temporary}/records/${result.candidateId}.json`, result)
    writeTemporary(repoRoot, `${temporary}/t3-stage-2-production-assembly-successor-dry-run-manifest.v1.json`, manifest)
    writeTemporary(repoRoot, `${temporary}/t3-stage-2-successor-readiness-ledger.v1.json`, ledger)
    fs.renameSync(path.join(repoRoot, temporary), path.join(repoRoot, SUCCESSOR_DRY_RUN_ROOT))
    return { rows, results, manifest, ledger, outputRoot: SUCCESSOR_DRY_RUN_ROOT }
  } catch (error) { fs.rmSync(path.join(repoRoot, temporary), { recursive: true, force: true }); throw error }
}

if (import.meta.url === `file://${process.argv[1]}`) throw new Error('T3_SUCCESSOR_STAGE_2_EXECUTION_AUTHORIZATION_REQUIRED')
