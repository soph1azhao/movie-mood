import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { PROMOTED_PRODUCTION_ROOT, validateExplicitPromotionAuthorization, validatePromotionOutputPath } from './t3ExplicitPromotionAuthorization.mjs'

export { PROMOTED_PRODUCTION_ROOT }

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const EXECUTOR_PATH = 'catalogue-pipeline/scripts/t3PromotionExecution.mjs'
export const PROMOTION_RECORDS_ROOT = `${PROMOTED_PRODUCTION_ROOT}/records`
export const PROMOTION_MANIFEST_PATH = `${PROMOTED_PRODUCTION_ROOT}/t3-promotion-completion-manifest.v1.json`
export const PROMOTION_LEDGER_PATH = `${PROMOTED_PRODUCTION_ROOT}/t3-promotion-execution-ledger.v1.json`

const fail = (condition, code) => { if (!condition) throw new Error(code) }
const rawHash = (root, relative) => hashBytes(fs.readFileSync(path.join(root, relative)))
const stable = (value) => serializeArtifactForPersistence(value)

export function validatePromotionExecutionOutputPath(relativePath) {
  return validatePromotionOutputPath(relativePath) && !relativePath.includes('/.staging-')
}

export function validateFuturePromotionExecutionAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-promotion-execution-authorization.v1' && authorization.executionAuthorized === true && authorization.executionCompleted === false, 'T3_PROMOTION_EXECUTION_AUTHORIZATION_REQUIRED')
  fail(authorization.promotionPopulation === 139 && authorization.outputRoot === PROMOTED_PRODUCTION_ROOT && authorization.runtimeAssemblyAuthorized === false && authorization.runtimeWriteAllowed === false && authorization.networkCallsAuthorized === 0 && authorization.providerCallsAuthorized === 0, 'T3_PROMOTION_EXECUTION_SCOPE_INVALID')
  fail(authorization.bindings?.executor?.path === EXECUTOR_PATH && authorization.bindings.executor.rawFileHash === rawHash(repoRoot, EXECUTOR_PATH), 'T3_PROMOTION_EXECUTION_EXECUTOR_BINDING_INVALID')
  fail(authorization.bindings?.explicitPromotionAuthorization?.rawFileHash === rawHash(repoRoot, authorization.bindings.explicitPromotionAuthorization.path), 'T3_PROMOTION_EXECUTION_PROMOTION_AUTHORIZATION_BINDING_INVALID')
  return true
}

function fixtureItem(sourcePath, targetRoot, expectedHash) {
  const bytes = fs.readFileSync(sourcePath)
  const envelope = JSON.parse(bytes)
  fail(hashBytes(bytes) === expectedHash, 'T3_PROMOTION_SOURCE_HASH_INVALID')
  fail(envelope?.status === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION' && envelope.productionRecord?.schemaVersion === 'production-record.v2', 'T3_PROMOTION_SOURCE_STATE_INVALID')
  fail(envelope.candidateId === envelope.productionRecord.candidateId && envelope.tmdbId === envelope.productionRecord.tmdbId, 'T3_PROMOTION_SOURCE_IDENTITY_INVALID')
  return { candidateId: envelope.candidateId, tmdbId: envelope.tmdbId, sourcePath, sourceHash: expectedHash, targetPath: path.join(targetRoot, 'records', `${envelope.candidateId}.json`), payload: envelope.productionRecord, payloadBytes: Buffer.from(stable(envelope.productionRecord)) }
}

function validateTargets(items) {
  const candidateIds = new Set(); const tmdbIds = new Set(); const targets = new Set()
  for (const item of items) {
    const target = item.targetAbsolutePath ?? item.targetPath
    fail(!candidateIds.has(item.candidateId) && !tmdbIds.has(item.tmdbId) && !targets.has(target), 'T3_PROMOTION_DUPLICATE_IDENTITY_OR_TARGET')
    candidateIds.add(item.candidateId); tmdbIds.add(item.tmdbId); targets.add(target)
    item.reused = fs.existsSync(target)
    if (!item.reused) continue
    fail(Buffer.compare(fs.readFileSync(target), item.payloadBytes) === 0, 'T3_PROMOTION_CONFLICTING_TARGET_EXISTS')
  }
}

function persistExclusive(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 })
}

/** Isolated test-only primitive; it does not consult repository authorities. */
export function promoteFixtureRecords({ items, outputRoot }) {
  fail(Array.isArray(items) && items.length > 0 && path.isAbsolute(outputRoot), 'T3_PROMOTION_FIXTURE_INPUT_INVALID')
  const prepared = items.map((item) => fixtureItem(item.sourcePath, outputRoot, item.expectedHash))
  validateTargets(prepared)
  const staging = path.join(outputRoot, `.staging-${process.pid}-${Date.now()}`)
  fail(!fs.existsSync(staging), 'T3_PROMOTION_STAGING_EXISTS')
  try {
    for (const item of prepared) if (!fs.existsSync(item.targetPath)) persistExclusive(path.join(staging, 'records', `${item.candidateId}.json`), item.payloadBytes)
    for (const item of prepared) {
      const staged = path.join(staging, 'records', `${item.candidateId}.json`)
      if (fs.existsSync(staged)) { fs.mkdirSync(path.dirname(item.targetPath), { recursive: true }); fs.renameSync(staged, item.targetPath) }
    }
    return prepared.map((item) => ({ candidateId: item.candidateId, tmdbId: item.tmdbId, sourceHash: item.sourceHash, promotedHash: hashBytes(item.payloadBytes), result: item.reused ? 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD' : 'PROMOTED_PRODUCTION_RECORD' }))
  } finally { fs.rmSync(staging, { recursive: true, force: true }) }
}

export function executePromotion({ explicitAuthorization, executionAuthorization, repoRoot = REPO } = {}) {
  validateExplicitPromotionAuthorization(explicitAuthorization, { repoRoot }); validateFuturePromotionExecutionAuthorization(executionAuthorization, { repoRoot })
  fail(executionAuthorization.bindings.explicitPromotionAuthorization.rawFileHash === rawHash(repoRoot, executionAuthorization.bindings.explicitPromotionAuthorization.path), 'T3_PROMOTION_EXECUTION_AUTHORIZATION_STALE')
  fail(!fs.existsSync(path.join(repoRoot, PROMOTION_MANIFEST_PATH)) && !fs.existsSync(path.join(repoRoot, PROMOTION_LEDGER_PATH)), 'T3_PROMOTION_EXECUTION_REPLAY_REJECTED')
  const prepared = explicitAuthorization.productionRecords.map((record) => {
    fail(validatePromotionExecutionOutputPath(`${PROMOTION_RECORDS_ROOT}/${record.candidateId}.json`), 'T3_PROMOTION_OUTPUT_PATH_FORBIDDEN')
    const sourcePath = path.join(repoRoot, record.artifactPath); const bytes = fs.readFileSync(sourcePath); const envelope = JSON.parse(bytes)
    fail(hashBytes(bytes) === record.artifactHash && envelope.candidateId === record.candidateId && envelope.tmdbId === record.tmdbId && envelope.status === 'ELIGIBLE_FOR_PROMOTION_AUTHORIZATION', 'T3_PROMOTION_SOURCE_ARTIFACT_INVALID')
    // validateExplicitPromotionAuthorization has already reassembled and schema-validated this exact envelope.
    return { candidateId: record.candidateId, tmdbId: record.tmdbId, sourcePath: record.artifactPath, sourceHash: record.artifactHash, targetPath: `${PROMOTION_RECORDS_ROOT}/${record.candidateId}.json`, payloadBytes: Buffer.from(stable(envelope.productionRecord)) }
  })
  fail(prepared.length === 139 && new Set(prepared.map((item) => item.candidateId)).size === 139, 'T3_PROMOTION_POPULATION_INVALID')
  for (const item of prepared) item.targetAbsolutePath = path.join(repoRoot, item.targetPath)
  validateTargets(prepared)
  const staging = path.join(repoRoot, PROMOTED_PRODUCTION_ROOT, `.staging-${process.pid}`)
  fail(!fs.existsSync(staging), 'T3_PROMOTION_STAGING_EXISTS')
  try {
    for (const item of prepared) if (!fs.existsSync(path.join(repoRoot, item.targetPath))) persistExclusive(path.join(staging, 'records', `${item.candidateId}.json`), item.payloadBytes)
    for (const item of prepared) { const staged = path.join(staging, 'records', `${item.candidateId}.json`); if (fs.existsSync(staged)) { const target = path.join(repoRoot, item.targetPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(staged, target) } }
    const records = prepared.map((item) => ({ candidateId: item.candidateId, tmdbId: item.tmdbId, sourceSuccessorArtifactPath: item.sourcePath, sourceSuccessorArtifactHash: item.sourceHash, promotedArtifactPath: item.targetPath, promotedArtifactHash: hashBytes(item.payloadBytes), result: item.reused ? 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD' : 'PROMOTED_PRODUCTION_RECORD' }))
    const reused = records.filter((record) => record.result === 'REUSED_EXACT_PROMOTED_PRODUCTION_RECORD').length; const promoted = records.length - reused
    const manifest = { schemaVersion: 't3-promotion-completion-manifest.v1', status: 'COMPLETE_ALL_PROMOTED_NON_RUNTIME', explicitPromotionAuthorizationHash: hashArtifact(explicitAuthorization), executionAuthorizationHash: hashArtifact(executionAuthorization), executorSourceHash: rawHash(repoRoot, EXECUTOR_PATH), population: 139, records, aggregate: { promoted, failed: 0, pending: 0, reused, semanticMutations: 0, factualMutations: 0, networkCalls: 0, providerCalls: 0, runtimeWrites: 0 }, runtimeAssemblyAuthorized: false, runtimeWriteAllowed: false }
    const ledger = { schemaVersion: 't3-promotion-execution-ledger.v1', status: 'COMPLETE_NON_RUNTIME_AWAITING_RUNTIME_ASSEMBLY_AUTHORIZATION', manifestHash: hashArtifact(manifest), population: 139, promoted, failed: 0, pending: 0, reused, runtimeAssemblyAuthorized: false, runtimeWriteAllowed: false }
    persistExclusive(path.join(repoRoot, PROMOTION_MANIFEST_PATH), Buffer.from(stable(manifest))); persistExclusive(path.join(repoRoot, PROMOTION_LEDGER_PATH), Buffer.from(stable(ledger)))
    return { manifest, ledger }
  } finally { fs.rmSync(staging, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) throw new Error('T3_PROMOTION_EXECUTION_AUTHORIZATION_REQUIRED')
