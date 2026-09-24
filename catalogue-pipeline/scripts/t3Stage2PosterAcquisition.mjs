import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { resolveTmdbPosterUrl } from './paletteAlgorithmV1.mjs'
import { AUTHORIZATION_PATH, MANIFEST_PATH, OUTPUT_ROOT, validatePosterAcquisitionGovernance } from './t3Stage2PosterAcquisitionAuthorization.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const EXECUTION_AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-poster-acquisition-execution-authorization.v1.json`
export const COMPLETION_MANIFEST_PATH = `${OUTPUT_ROOT}/t3-stage-2-poster-acquisition-completion-manifest.v1.json`
export const EXECUTION_LEDGER_PATH = `${OUTPUT_ROOT}/t3-stage-2-poster-acquisition-execution-ledger.v1.json`
const read = (root, p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const rawHash = (root, p) => hashBytes(fs.readFileSync(path.join(root, p)))
const fail = (ok, code) => { if (!ok) throw new Error(code) }
const persist = (root, p, value) => { const target = path.join(root, p); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 }) }
const persistBytes = (root, p, bytes) => { const target = path.join(root, p); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }) }
const isInsideOutput = (p) => p === OUTPUT_ROOT || p.startsWith(`${OUTPUT_ROOT}/`)

async function readableImage(bytes) { try { const { default: sharp } = await import('sharp'); const m = await sharp(bytes).metadata(); return Boolean(m.width && m.height) } catch { return false } }
function contentType(response) { return response.headers?.get?.('content-type')?.toLowerCase().split(';', 1)[0].trim() ?? null }
function responseState({ response, bytes, error }) {
  if (error) return { code: 'TRANSIENT_TRANSPORT_FAILURE', retryable: true }
  if (!response) return { code: 'NO_RESPONSE', retryable: false }
  if (response.status === 200) {
    const type = contentType(response)
    if (!['image/jpeg', 'image/webp'].includes(type)) return { code: 'UNSUPPORTED_CONTENT_TYPE', retryable: false, contentType: type }
    if (!bytes?.length) return { code: 'EMPTY_BODY', retryable: false, contentType: type }
    return { code: 'HTTP_200', retryable: false, contentType: type }
  }
  return { code: `HTTP_${response.status}`, retryable: [500, 502, 503, 504].includes(response.status), contentType: contentType(response) }
}

export function buildExecutionAuthorization({ repoRoot = REPO } = {}) {
  const authorization = read(repoRoot, AUTHORIZATION_PATH); const manifest = read(repoRoot, MANIFEST_PATH); validatePosterAcquisitionGovernance({ authorization, candidateManifest: manifest })
  const paths = { acquisitionAuthorization: AUTHORIZATION_PATH, acquisitionManifest: MANIFEST_PATH, failureReconciliation: `${ROOT}/t3-stage-2-assembly-failure-reconciliation.v1.json`, executor: 'catalogue-pipeline/scripts/t3Stage2PosterAcquisition.mjs', urlResolver: 'catalogue-pipeline/scripts/paletteAlgorithmV1.mjs', imageValidation: 'catalogue-pipeline/scripts/t3Stage2PosterAcquisition.mjs', retryPolicy: AUTHORIZATION_PATH, outputPolicy: AUTHORIZATION_PATH }
  const bindings = Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, { path: p, rawFileHash: rawHash(repoRoot, p), ...(p.endsWith('.json') ? { canonicalArtifactHash: hashArtifact(read(repoRoot, p)) } : {}) }]))
  return { schemaVersion: 't3-stage-2-poster-acquisition-execution-authorization.v1', status: 'T3_POSTER_ACQUISITION_NETWORK_EXECUTION_AUTHORIZED', trancheId: 'SCALE_TRANCHE_3', bindings, executionPopulation: 139, candidateIdsHash: manifest.authorizationHash ? authorization.candidateIdsHash : null, maxAttemptsPerCandidate: 2, maxHttpRequests: 278, externalSystem: 'TMDB_IMAGE_CDN_ONLY', rendition: 'w500', providerCallsAuthorized: 0, paletteGenerationAllowed: false, runtimeWriteAllowed: false, promotionAllowed: false, outputRoot: OUTPUT_ROOT, executionCompleted: false }
}
export function validateExecutionAuthorization(a, { repoRoot = REPO } = {}) {
  fail(a?.schemaVersion === 't3-stage-2-poster-acquisition-execution-authorization.v1' && a.status === 'T3_POSTER_ACQUISITION_NETWORK_EXECUTION_AUTHORIZED' && a.executionPopulation === 139 && a.maxAttemptsPerCandidate === 2 && a.maxHttpRequests === 278, 'T3_POSTER_EXECUTION_AUTH_INVALID')
  fail(a.externalSystem === 'TMDB_IMAGE_CDN_ONLY' && a.rendition === 'w500' && a.providerCallsAuthorized === 0 && a.paletteGenerationAllowed === false && a.runtimeWriteAllowed === false && a.promotionAllowed === false && a.outputRoot === OUTPUT_ROOT && a.executionCompleted === false, 'T3_POSTER_EXECUTION_AUTH_SCOPE_INVALID')
  for (const b of Object.values(a.bindings)) fail(rawHash(repoRoot, b.path) === b.rawFileHash, 'T3_POSTER_EXECUTION_AUTH_BINDING_DRIFT')
  const authorization = read(repoRoot, AUTHORIZATION_PATH); const manifest = read(repoRoot, MANIFEST_PATH)
  fail(a.bindings.acquisitionAuthorization.canonicalArtifactHash === hashArtifact(authorization) && a.bindings.acquisitionManifest.canonicalArtifactHash === hashArtifact(manifest) && a.candidateIdsHash === authorization.candidateIdsHash && manifest.records.length === 139, 'T3_POSTER_EXECUTION_AUTH_MANIFEST_DRIFT')
  return true
}
export function writeExecutionAuthorization({ repoRoot = REPO } = {}) { fail(!fs.existsSync(path.join(repoRoot, EXECUTION_AUTHORIZATION_PATH)), 'T3_POSTER_EXECUTION_AUTH_REPLAY_REJECTED'); const a = buildExecutionAuthorization({ repoRoot }); validateExecutionAuthorization(a, { repoRoot }); persist(repoRoot, EXECUTION_AUTHORIZATION_PATH, a); return { authorizationHash: hashArtifact(a) } }

async function cacheResult(root, record) {
  const base = path.join(root, OUTPUT_ROOT, 'assets', record.candidateId); const poster = path.join(base, 'poster'); const result = path.join(base, 'result.json')
  if (!fs.existsSync(poster) && !fs.existsSync(result)) return null
  if (!fs.existsSync(poster) || !fs.existsSync(result)) return { status: 'POSTER_ASSET_ACQUISITION_FAILED', candidateId: record.candidateId, tmdbId: record.tmdbId, reasons: [{ code: 'CACHE_CONFLICT_UNBOUND_OR_INCOMPLETE' }], requestHistory: [] }
  const saved = JSON.parse(fs.readFileSync(result, 'utf8')); const bytes = fs.readFileSync(poster)
  if (saved.status !== 'POSTER_ASSET_ACQUIRED' || saved.posterPath !== record.posterPath || saved.tmdbId !== record.tmdbId || saved.posterByteHash !== hashBytes(bytes)) return { status: 'POSTER_ASSET_ACQUISITION_FAILED', candidateId: record.candidateId, tmdbId: record.tmdbId, reasons: [{ code: 'CACHE_CONFLICT_PROVENANCE_OR_BYTES_MISMATCH' }], requestHistory: [] }
  return { ...saved, bytes, cacheReuse: true, requestHistory: [] }
}
export async function acquireCandidate(record, { fetchImpl = fetch, decodeImpl = readableImage, now = () => new Date().toISOString() } = {}) {
  const url = resolveTmdbPosterUrl(record.posterPath); const history = []
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response; let bytes; let error
    try { response = await fetchImpl(url, { headers: { Accept: 'image/jpeg' } }); bytes = Buffer.from(await response.arrayBuffer()) } catch (caught) { error = String(caught) }
    const state = responseState({ response, bytes, error }); history.push({ attempt, url, ...(response ? { httpStatus: response.status, contentType: state.contentType, byteLength: bytes.length, byteHash: hashBytes(bytes) } : { transportError: error }), outcome: state.code })
    if (state.code === 'HTTP_200') {
      if (!(await decodeImpl(bytes))) return { status: 'POSTER_ASSET_ACQUISITION_FAILED', candidateId: record.candidateId, tmdbId: record.tmdbId, posterPath: record.posterPath, resolvedCdnUrl: url, requestHistory: history, reasons: [{ code: 'MALFORMED_OR_NON_IMAGE_BYTES' }], cacheReuse: false }
      return { status: 'POSTER_ASSET_ACQUIRED', candidateId: record.candidateId, tmdbId: record.tmdbId, posterPath: record.posterPath, resolvedCdnUrl: url, rendition: 'w500', requestHistory: history, finalHttpStatus: 200, contentType: state.contentType, posterByteLength: bytes.length, posterByteHash: hashBytes(bytes), bytes, acquiredAt: now(), cacheReuse: false }
    }
    if (!state.retryable || attempt === 2) return { status: 'POSTER_ASSET_ACQUISITION_FAILED', candidateId: record.candidateId, tmdbId: record.tmdbId, posterPath: record.posterPath, resolvedCdnUrl: url, requestHistory: history, reasons: [{ code: state.code }], cacheReuse: false }
  }
}
export async function executeAcquisition({ repoRoot = REPO, fetchImpl = fetch, decodeImpl = readableImage } = {}) {
  fail(!fs.existsSync(path.join(repoRoot, OUTPUT_ROOT)), 'T3_POSTER_ACQUISITION_REPLAY_REJECTED')
  const a = read(repoRoot, EXECUTION_AUTHORIZATION_PATH); validateExecutionAuthorization(a, { repoRoot }); const manifest = read(repoRoot, MANIFEST_PATH); const temp = `${OUTPUT_ROOT}.tmp-${process.pid}`; const results = []; let calls = 0
  try { for (const record of manifest.records) { let result = await cacheResult(repoRoot, record); if (!result) { result = await acquireCandidate(record, { fetchImpl, decodeImpl }); calls += result.requestHistory.length } fail(calls <= a.maxHttpRequests, 'T3_POSTER_HTTP_BUDGET_EXCEEDED'); const base = `${temp}/assets/${record.candidateId}`; if (result.status === 'POSTER_ASSET_ACQUIRED') { persistBytes(repoRoot, `${base}/poster`, result.bytes); delete result.bytes; result.localAssetPath = `${OUTPUT_ROOT}/assets/${record.candidateId}/poster`; result.cacheReuse = Boolean(result.cacheReuse); } persist(repoRoot, `${base}/result.json`, result); results.push(result) }
    const acquired = results.filter((r) => r.status === 'POSTER_ASSET_ACQUIRED'); const failed = results.filter((r) => r.status !== 'POSTER_ASSET_ACQUIRED'); const completion = { schemaVersion: 't3-stage-2-poster-acquisition-completion-manifest.v1', status: failed.length ? 'COMPLETE_WITH_CANDIDATE_FAILURES' : 'COMPLETE_ALL_ACQUIRED', executionAuthorizationHash: hashArtifact(a), executorSourceHash: a.bindings.executor.rawFileHash, population: 139, acquiredCandidateIds: acquired.map((r) => r.candidateId), failedCandidateIds: failed.map((r) => r.candidateId), records: results.map((r) => ({ candidateId: r.candidateId, tmdbId: r.tmdbId, status: r.status, posterPath: r.posterPath, resolvedCdnUrl: r.resolvedCdnUrl, localAssetPath: r.localAssetPath ?? null, posterByteHash: r.posterByteHash ?? null, reasons: r.reasons ?? [] })), networkAccounting: { httpRequests: calls, successfulDownloads: acquired.filter((r) => !r.cacheReuse).length, failedCandidates: failed.length, retries: results.reduce((n, r) => n + Math.max(0, r.requestHistory.length - 1), 0), cacheHits: acquired.filter((r) => r.cacheReuse).length, bytesDownloaded: acquired.filter((r) => !r.cacheReuse).reduce((n, r) => n + r.posterByteLength, 0) }, palettesGenerated: 0, providerCallsAdded: 0, runtimeWrites: 0, promotionWrites: 0 }
    const ledger = { schemaVersion: 't3-stage-2-poster-acquisition-execution-ledger.v1', status: failed.length ? 'COMPLETE_WITH_FAILURES_AWAITING_FAILURE_RECONCILIATION' : 'COMPLETE_AWAITING_PALETTE_GENERATION_AUTHORIZATION', completionManifestHash: hashArtifact(completion), population: 139, acquired: acquired.length, failed: failed.length, pending: 0, ...completion.networkAccounting, palettesGenerated: 0, providerCallsAdded: 0, runtimeWrites: 0, promotionWrites: 0 }
    persist(repoRoot, `${temp}/t3-stage-2-poster-acquisition-completion-manifest.v1.json`, completion); persist(repoRoot, `${temp}/t3-stage-2-poster-acquisition-execution-ledger.v1.json`, ledger); fs.renameSync(path.join(repoRoot, temp), path.join(repoRoot, OUTPUT_ROOT)); return { completion, ledger }
  } catch (error) { fs.rmSync(path.join(repoRoot, temp), { recursive: true, force: true }); throw error }
}
if (import.meta.url === `file://${process.argv[1]}`) { if (process.argv[2] === '--authorize') console.log(JSON.stringify(writeExecutionAuthorization(), null, 2)); else if (process.argv[2] === '--execute') executeAcquisition().then((x) => console.log(JSON.stringify(x, null, 2))); else throw new Error('Usage: --authorize | --execute') }
