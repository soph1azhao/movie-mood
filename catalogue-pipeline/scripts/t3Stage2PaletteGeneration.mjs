import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes, serializeArtifactForPersistence, validatePaletteArtifact } from './validatePromotionContract.mjs'
import { PALETTE_ALGORITHM_VERSION_V11, paletteFromPosterV11 } from './paletteAlgorithmV11.mjs'
import { AUTHORIZATION_PATH, MANIFEST_PATH, OUTPUT_ROOT, validatePaletteGenerationGovernance } from './t3Stage2PaletteGenerationAuthorization.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3'
export const EXECUTION_AUTHORIZATION_PATH = `${ROOT}/t3-stage-2-palette-generation-execution-authorization.v1.json`
export const COMPLETION_MANIFEST_PATH = `${OUTPUT_ROOT}/t3-stage-2-palette-generation-completion-manifest.v1.json`
export const EXECUTION_LEDGER_PATH = `${OUTPUT_ROOT}/t3-stage-2-palette-generation-execution-ledger.v1.json`
const read = (root, p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const rawHash = (root, p) => hashBytes(fs.readFileSync(path.join(root, p)))
const fail = (ok, code) => { if (!ok) throw new Error(code) }
const persist = (root, p, value) => { const target = path.join(root, p); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, serializeArtifactForPersistence(value), { flag: 'wx', mode: 0o600 }) }

export function buildExecutionAuthorization({ repoRoot = REPO } = {}) {
  const authorization = read(repoRoot, AUTHORIZATION_PATH); const manifest = read(repoRoot, MANIFEST_PATH); validatePaletteGenerationGovernance({ authorization, manifest })
  const paths = { paletteAuthorization: AUTHORIZATION_PATH, paletteManifest: MANIFEST_PATH, posterCompletion: `${ROOT}/stage-2-poster-assets-v1/t3-stage-2-poster-acquisition-completion-manifest.v1.json`, posterLedger: `${ROOT}/stage-2-poster-assets-v1/t3-stage-2-poster-acquisition-execution-ledger.v1.json`, executor: 'catalogue-pipeline/scripts/t3Stage2PaletteGeneration.mjs', paletteAlgorithm: 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs', paletteValidator: 'catalogue-pipeline/scripts/validatePromotionContract.mjs', outputPolicy: AUTHORIZATION_PATH }
  const bindings = Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, { path: p, rawFileHash: rawHash(repoRoot, p), ...(p.endsWith('.json') ? { canonicalArtifactHash: hashArtifact(read(repoRoot, p)) } : {}) }]))
  return { schemaVersion: 't3-stage-2-palette-generation-execution-authorization.v1', status: 'T3_PALETTE_GENERATION_EXECUTION_AUTHORIZED', trancheId: 'SCALE_TRANCHE_3', bindings, executionPopulation: 139, candidateIdsHash: authorization.candidateIdsHash, algorithm: PALETTE_ALGORITHM_VERSION_V11, networkCallsAuthorized: 0, providerCallsAuthorized: 0, semanticMutationAllowed: false, posterMutationAllowed: false, runtimeWriteAllowed: false, promotionAllowed: false, outputRoot: OUTPUT_ROOT, executionCompleted: false }
}
export function validateExecutionAuthorization(a, { repoRoot = REPO } = {}) {
  fail(a?.schemaVersion === 't3-stage-2-palette-generation-execution-authorization.v1' && a.status === 'T3_PALETTE_GENERATION_EXECUTION_AUTHORIZED' && a.executionPopulation === 139 && a.algorithm === PALETTE_ALGORITHM_VERSION_V11, 'T3_PALETTE_EXECUTION_AUTH_INVALID')
  fail(a.networkCallsAuthorized === 0 && a.providerCallsAuthorized === 0 && a.semanticMutationAllowed === false && a.posterMutationAllowed === false && a.runtimeWriteAllowed === false && a.promotionAllowed === false && a.outputRoot === OUTPUT_ROOT && a.executionCompleted === false, 'T3_PALETTE_EXECUTION_SCOPE_INVALID')
  for (const b of Object.values(a.bindings)) fail(rawHash(repoRoot, b.path) === b.rawFileHash, 'T3_PALETTE_EXECUTION_BINDING_DRIFT')
  const authorization = read(repoRoot, AUTHORIZATION_PATH); const manifest = read(repoRoot, MANIFEST_PATH)
  fail(a.bindings.paletteAuthorization.canonicalArtifactHash === hashArtifact(authorization) && a.bindings.paletteManifest.canonicalArtifactHash === hashArtifact(manifest) && a.candidateIdsHash === authorization.candidateIdsHash && manifest.records.length === 139, 'T3_PALETTE_EXECUTION_MANIFEST_DRIFT')
  return true
}
export function writeExecutionAuthorization({ repoRoot = REPO } = {}) { fail(!fs.existsSync(path.join(repoRoot, EXECUTION_AUTHORIZATION_PATH)), 'T3_PALETTE_EXECUTION_AUTH_REPLAY_REJECTED'); const a = buildExecutionAuthorization({ repoRoot }); validateExecutionAuthorization(a, { repoRoot }); persist(repoRoot, EXECUTION_AUTHORIZATION_PATH, a); return { authorizationHash: hashArtifact(a) } }

export async function generatePalette(record, { root = REPO } = {}) {
  const bytes = fs.readFileSync(path.join(root, record.posterAssetPath)); const computed = hashBytes(bytes)
  if (computed !== record.sourcePosterHash) return { candidateId: record.candidateId, tmdbId: record.tmdbId, status: 'PALETTE_GENERATION_FAILED', sourcePosterHash: record.sourcePosterHash, reasons: [{ code: 'SOURCE_POSTER_HASH_MISMATCH', computed }] }
  const first = await paletteFromPosterV11(bytes); const second = await paletteFromPosterV11(bytes)
  if (JSON.stringify(first) !== JSON.stringify(second)) return { candidateId: record.candidateId, tmdbId: record.tmdbId, status: 'PALETTE_GENERATION_FAILED', sourcePosterHash: computed, reasons: [{ code: 'PALETTE_NONDETERMINISTIC' }] }
  const artifact = { schemaVersion: 'palette-artifact.v1', candidateId: record.candidateId, tmdbId: record.tmdbId, palette: first, method: 'poster-algorithm', sourcePosterIdentity: { posterPath: record.posterPath }, sourcePosterHash: computed, algorithmVersion: PALETTE_ALGORITHM_VERSION_V11, override: null, t3Bindings: { posterAssetPath: record.posterAssetPath, posterAcquisitionResultHash: record.posterAcquisitionResultHash, paletteAlgorithmRawFileHash: rawHash(root, 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs') } }
  if (!validatePaletteArtifact(artifact).ok || hashArtifact(artifact) !== hashArtifact({ ...artifact })) return { candidateId: record.candidateId, tmdbId: record.tmdbId, status: 'PALETTE_GENERATION_FAILED', sourcePosterHash: computed, reasons: [{ code: 'PALETTE_ARTIFACT_VALIDATION_OR_DETERMINISM_FAILED' }] }
  return { candidateId: record.candidateId, tmdbId: record.tmdbId, status: 'PALETTE_GENERATED', sourcePosterHash: computed, paletteArtifact: artifact, paletteArtifactHash: hashArtifact(artifact), secondPassDeterminism: 'PASS', cacheReuse: false }
}
export async function executePaletteGeneration({ repoRoot = REPO } = {}) {
  fail(!fs.existsSync(path.join(repoRoot, OUTPUT_ROOT)), 'T3_PALETTE_EXECUTION_REPLAY_REJECTED'); const a = read(repoRoot, EXECUTION_AUTHORIZATION_PATH); validateExecutionAuthorization(a, { repoRoot }); const manifest = read(repoRoot, MANIFEST_PATH); const temp = `${OUTPUT_ROOT}.tmp-${process.pid}`; const results = []
  try { for (const record of manifest.records) { const result = await generatePalette(record, { root: repoRoot }); if (result.status === 'PALETTE_GENERATED') { const artifactPath = `${OUTPUT_ROOT}/artifacts/${record.candidateId}.json`; persist(repoRoot, `${temp}/artifacts/${record.candidateId}.json`, result.paletteArtifact); delete result.paletteArtifact; result.paletteArtifactPath = artifactPath } persist(repoRoot, `${temp}/results/${record.candidateId}.json`, result); results.push(result) }
    const generated = results.filter((r) => r.status === 'PALETTE_GENERATED'); const failed = results.filter((r) => r.status !== 'PALETTE_GENERATED'); const completion = { schemaVersion: 't3-stage-2-palette-generation-completion-manifest.v1', status: failed.length ? 'COMPLETE_WITH_CANDIDATE_FAILURES' : 'COMPLETE_ALL_GENERATED', executionAuthorizationHash: hashArtifact(a), executorSourceHash: a.bindings.executor.rawFileHash, population: 139, generatedCandidateIds: generated.map((r) => r.candidateId), failedCandidateIds: failed.map((r) => r.candidateId), records: results.map((r) => ({ candidateId: r.candidateId, tmdbId: r.tmdbId, status: r.status, sourcePosterHash: r.sourcePosterHash, paletteArtifactPath: r.paletteArtifactPath ?? null, paletteArtifactHash: r.paletteArtifactHash ?? null, secondPassDeterminism: r.secondPassDeterminism ?? 'FAIL', reasons: r.reasons ?? [] })), networkCalls: 0, providerCalls: 0, runtimeWrites: 0, promotionWrites: 0 }
    const ledger = { schemaVersion: 't3-stage-2-palette-generation-execution-ledger.v1', status: failed.length ? 'COMPLETE_WITH_FAILURES_AWAITING_FAILURE_RECONCILIATION' : 'COMPLETE_AWAITING_SUCCESSOR_STAGE_2_DRY_RUN_AUTHORIZATION', completionManifestHash: hashArtifact(completion), population: 139, generated: generated.length, failed: failed.length, pending: 0, determinismPassed: generated.filter((r) => r.secondPassDeterminism === 'PASS').length, cacheHits: 0, networkCalls: 0, providerCalls: 0, runtimeWrites: 0, promotionWrites: 0 }
    persist(repoRoot, `${temp}/t3-stage-2-palette-generation-completion-manifest.v1.json`, completion); persist(repoRoot, `${temp}/t3-stage-2-palette-generation-execution-ledger.v1.json`, ledger); fs.renameSync(path.join(repoRoot, temp), path.join(repoRoot, OUTPUT_ROOT)); return { completion, ledger }
  } catch (error) { fs.rmSync(path.join(repoRoot, temp), { recursive: true, force: true }); throw error }
}
if (import.meta.url === `file://${process.argv[1]}`) { if (process.argv[2] === '--authorize') console.log(JSON.stringify(writeExecutionAuthorization(), null, 2)); else if (process.argv[2] === '--execute') executePaletteGeneration().then((x) => console.log(JSON.stringify(x, null, 2))); else throw new Error('Usage: --authorize | --execute') }
