import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'
import { ROOT, RUNTIME_AUTHORIZATION_PATH, RUNTIME_TARGETS, buildRuntimeAssemblyPlan, validateRuntimeAssemblyAuthorization } from './t3RuntimeAssemblyAuthorization.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const EXECUTOR_PATH = 'catalogue-pipeline/scripts/t3RuntimeAssemblyExecution.mjs'
export const PROSPECTIVE_ROOT = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-3/runtime-assembly-prospective-v1'
export const PROSPECTIVE_MANIFEST_PATH = `${PROSPECTIVE_ROOT}/t3-runtime-assembly-prospective-manifest.v1.json`
export const RUNTIME_COMPLETION_ROOT = `${ROOT}/runtime-assembly-completion-v1`
export const COMPLETION_MANIFEST = 't3-runtime-assembly-completion-manifest.v1.json'
export const EXECUTION_LEDGER = 't3-runtime-assembly-execution-ledger.v1.json'
const fail = (condition, code) => { if (!condition) throw new Error(code) }
const raw = (root, relative) => hashBytes(fs.readFileSync(path.join(root, relative)))
const sameTargets = (targets) => JSON.stringify([...targets].sort()) === JSON.stringify([...RUNTIME_TARGETS].sort())
const tokenCharacter = (character) => Boolean(character) && ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || '_$.-'.includes(character))
const overlapsRuntimeTarget = (root, completionRoot) => RUNTIME_TARGETS.some((target) => { const runtimePath = path.resolve(root, target); const completionPath = path.resolve(completionRoot); return completionPath === runtimePath || completionPath.startsWith(`${runtimePath}${path.sep}`) })

function skipTrivia(source, state) {
  while (state.index < source.length) {
    if (' \n\r\t'.includes(source[state.index])) { state.index++; continue }
    if (source.slice(state.index, state.index + 2) === '//') { state.index = source.indexOf('\n', state.index); if (state.index < 0) state.index = source.length; continue }
    if (source.slice(state.index, state.index + 2) === '/*') { state.index = source.indexOf('*/', state.index + 2); fail(state.index >= 0, 'T3_RUNTIME_CURATED_AST_INVALID'); state.index += 2; continue }
    return
  }
}

function token(source, state) {
  skipTrivia(source, state)
  const start = state.index
  while (state.index < source.length && tokenCharacter(source[state.index])) state.index++
  fail(start !== state.index, 'T3_RUNTIME_CURATED_AST_INVALID')
  return source.slice(start, state.index)
}

function stringLiteral(source, state) {
  const quote = source[state.index++]; const start = state.index - 1; let escaped = false
  while (state.index < source.length) { const character = source[state.index++]; if (!escaped && character === quote) { const rawValue = source.slice(start, state.index); fail(quote === '"', 'T3_RUNTIME_CURATED_AST_LITERAL_INVALID'); return JSON.parse(rawValue) }; escaped = !escaped && character === '\\' }
  throw new Error('T3_RUNTIME_CURATED_AST_INVALID')
}

function literal(source, state) {
  skipTrivia(source, state); const character = source[state.index]
  if (character === '"' || character === "'") return stringLiteral(source, state)
  if (character === '[') { state.index++; const values = []; skipTrivia(source, state); while (source[state.index] !== ']') { values.push(literal(source, state)); skipTrivia(source, state); fail(source[state.index] === ',' || source[state.index] === ']', 'T3_RUNTIME_CURATED_AST_INVALID'); if (source[state.index++] === ']') return values; skipTrivia(source, state) } state.index++; return values }
  if (character === '{') { state.index++; const value = {}; skipTrivia(source, state); while (source[state.index] !== '}') { const key = source[state.index] === '"' || source[state.index] === "'" ? stringLiteral(source, state) : token(source, state); skipTrivia(source, state); fail(source[state.index++] === ':', 'T3_RUNTIME_CURATED_AST_INVALID'); value[key] = literal(source, state); skipTrivia(source, state); fail(source[state.index] === ',' || source[state.index] === '}', 'T3_RUNTIME_CURATED_AST_INVALID'); if (source[state.index++] === '}') return value; skipTrivia(source, state) } state.index++; return value }
  const value = token(source, state)
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  const number = Number(value); fail(Number.isFinite(number), 'T3_RUNTIME_CURATED_AST_LITERAL_INVALID'); return number
}

function loadCurated(root) {
  const source = fs.readFileSync(path.join(root, 'src/data/curatedMovies.ts'), 'utf8'); const marker = 'export const curatedMovies'; const start = source.indexOf(marker)
  fail(start >= 0 && source.indexOf(marker, start + marker.length) < 0, 'T3_RUNTIME_CURATED_EXPORT_INVALID')
  const state = { index: source.indexOf('=', start + marker.length) + 1 }; fail(state.index > 0, 'T3_RUNTIME_CURATED_EXPORT_INVALID')
  const value = literal(source, state); fail(Array.isArray(value), 'T3_RUNTIME_CURATED_EXPORT_INVALID'); return value
}

const curatedBytes = (items) => Buffer.from(`import type { CuratedMovie } from '../types/movie'\n\nexport const curatedMovies: CuratedMovie[] = ${JSON.stringify(items, null, 2)}\n`)
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

function resolveProspectiveMovies({ curated, facts, mappings }) {
  const mappingsById = new Map(mappings.map((mapping) => [mapping.id, mapping]))
  const seenIds = new Set(); const seenTmdbIds = new Set()
  return curated.map((movie) => {
    fail(!seenIds.has(movie.id) && !seenTmdbIds.has(movie.tmdbId), 'T3_RUNTIME_PROSPECTIVE_DUPLICATE_IDENTITY')
    seenIds.add(movie.id); seenTmdbIds.add(movie.tmdbId)
    const fact = facts[movie.id]; const mapping = mappingsById.get(movie.id)
    fail(fact && mapping && fact.tmdbId === movie.tmdbId && mapping.tmdbId === movie.tmdbId, 'T3_RUNTIME_PROSPECTIVE_RESOLVER_INVALID')
    fail(Array.isArray(movie.palette) && movie.palette.length === 2 && movie.palette.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)), 'T3_RUNTIME_PROSPECTIVE_PALETTE_INVALID')
    fail(fact.posterPath === null || (typeof fact.posterPath === 'string' && fact.posterPath.startsWith('/')), 'T3_RUNTIME_PROSPECTIVE_POSTER_PATH_INVALID')
    return { ...movie, ...fact, languages: movie.filterLanguages }
  })
}

export function validateProspectiveRuntimeState({ plan, baseline, curated, facts, mappings }) {
  fail([...curated, ...Object.values(facts), ...mappings].every((item) => !Object.hasOwn(item, 'provenance')), 'T3_RUNTIME_PROVENANCE_LEAK')
  const resolved = resolveProspectiveMovies({ curated, facts, mappings })
  const curatedIds = new Set(curated.map((item) => item.id)); const mappingIds = new Set(mappings.map((item) => item.id)); const factIds = new Set(Object.keys(facts)); const tmdbIds = new Set(mappings.map((item) => item.tmdbId))
  fail(curated.length === 180 && Object.keys(facts).length === 180 && mappings.length === 180 && resolved.length === 180 && curatedIds.size === 180 && mappingIds.size === 180 && factIds.size === 180 && tmdbIds.size === 180, 'T3_RUNTIME_PROSPECTIVE_IDENTITY_INVALID')
  fail([...curatedIds].every((id) => mappingIds.has(id) && factIds.has(id)), 'T3_RUNTIME_PROSPECTIVE_IDENTITY_INVALID')
  for (const movie of baseline.curated) { const mapping = mappings.find((item) => item.id === movie.id); fail(JSON.stringify(curated.find((item) => item.id === movie.id)) === JSON.stringify(movie) && JSON.stringify(facts[movie.id]) === JSON.stringify(baseline.facts[movie.id]) && JSON.stringify(mapping) === JSON.stringify(baseline.mappings.find((item) => item.id === movie.id)), 'T3_RUNTIME_BASELINE_CONTENT_CHANGED') }
  for (const record of plan.projections) { const mapping = mappings.find((item) => item.id === record.runtimeId); fail(JSON.stringify(curated.find((item) => item.id === record.runtimeId)) === JSON.stringify(record.curatedMovie) && JSON.stringify(facts[record.runtimeId]) === JSON.stringify(record.facts) && JSON.stringify(mapping) === JSON.stringify({ id: record.runtimeId, tmdbId: record.tmdbId }), 'T3_RUNTIME_PROMOTED_CONTENT_CHANGED') }
  return { resolvedCount: resolved.length, uniqueRuntimeIds: curatedIds.size, uniqueTmdbIds: tmdbIds.size }
}

export function buildProspectiveRuntimeArtifacts({ repoRoot = REPO, authorization } = {}) {
  validateRuntimeAssemblyAuthorization(authorization, { repoRoot })
  const plan = buildRuntimeAssemblyPlan({ repoRoot }); const curated = loadCurated(repoRoot); const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src/data/generated/tmdbMovies.json'))); const mappings = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src/data/tmdbMovieMappings.json')))
  fail(curated.length === plan.baseline.count && Object.keys(facts).length === plan.baseline.count && mappings.length === plan.baseline.count, 'T3_RUNTIME_BASELINE_COUNT_INVALID')
  for (const target of RUNTIME_TARGETS) fail(raw(repoRoot, target) === authorization.bindings[{ 'src/data/curatedMovies.ts': 'curatedMovies', 'src/data/generated/tmdbMovies.json': 'tmdbMovies', 'src/data/tmdbMovieMappings.json': 'tmdbMovieMappings' }[target]].rawFileHash, 'T3_RUNTIME_BASELINE_HASH_DRIFT')
  const additions = plan.projections; const nextCurated = [...curated, ...additions.map((record) => record.curatedMovie)]; const nextFacts = { ...facts, ...Object.fromEntries(additions.map((record) => [record.runtimeId, record.facts])) }; const nextMappings = [...mappings, ...additions.map((record) => ({ id: record.runtimeId, tmdbId: record.tmdbId }))]
  const baseline = { curated, facts, mappings, bytes: Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, fs.readFileSync(path.join(repoRoot, target))])), hashes: Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, raw(repoRoot, target)])) }
  const validation = validateProspectiveRuntimeState({ plan, baseline, curated: nextCurated, facts: nextFacts, mappings: nextMappings })
  const artifacts = { 'src/data/curatedMovies.ts': curatedBytes(nextCurated), 'src/data/generated/tmdbMovies.json': jsonBytes(nextFacts), 'src/data/tmdbMovieMappings.json': jsonBytes(nextMappings) }
  return { plan, artifacts, hashes: Object.fromEntries(Object.entries(artifacts).map(([target, bytes]) => [target, hashBytes(bytes)])), baseline, validation }
}

export function writeProspectiveArtifacts({ prospectiveRoot, artifacts }) {
  fail(path.isAbsolute(prospectiveRoot) && sameTargets(Object.keys(artifacts ?? {})) && !RUNTIME_TARGETS.some((target) => path.resolve(prospectiveRoot, target) === path.resolve(REPO, target)), 'T3_RUNTIME_PROSPECTIVE_ROOT_INVALID')
  for (const [target, bytes] of Object.entries(artifacts)) { const output = path.join(prospectiveRoot, target); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes, { flag: 'wx' }) }
}

export function emitProspectiveRuntimeAssembly({ repoRoot = REPO, authorization, prospectiveRoot = path.join(repoRoot, PROSPECTIVE_ROOT) } = {}) {
  const result = buildProspectiveRuntimeArtifacts({ repoRoot, authorization }); writeProspectiveArtifacts({ prospectiveRoot, artifacts: result.artifacts })
  const manifest = { schemaVersion: 't3-runtime-assembly-prospective-manifest.v1', status: 'PROSPECTIVE_NON_RUNTIME_VALIDATED', runtimeWriteAuthorized: false, targetPaths: RUNTIME_TARGETS, baseline: { count: 41, hashes: result.baseline.hashes }, added: 139, finalCount: 180, overlaps: { exactExisting: 0, deterministicUpdates: 0, conflicts: 0 }, validation: result.validation, prospectiveHashes: result.hashes, networkCalls: 0, providerCalls: 0, posterMutations: 0, paletteMutations: 0 }
  fs.writeFileSync(path.join(prospectiveRoot, 't3-runtime-assembly-prospective-manifest.v1.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return { ...result, prospectiveRoot, manifest }
}

export function validateRuntimeWriteAuthorization(authorization, { repoRoot = REPO } = {}) {
  fail(authorization?.schemaVersion === 't3-runtime-write-execution-authorization.v1' && authorization.runtimeWriteAuthorized === true && authorization.runtimeAssemblyPopulation === 139 && authorization.expectedFinalCount === 180 && authorization.semanticMutationAllowed === false && authorization.factualMutationAllowed === false && authorization.posterMutationAllowed === false && authorization.paletteMutationAllowed === false && authorization.networkCallsAuthorized === 0 && authorization.providerCallsAuthorized === 0 && authorization.releaseAllowed === false && authorization.deploymentAllowed === false && sameTargets(authorization.targetPaths ?? []), 'T3_RUNTIME_WRITE_AUTHORIZATION_REQUIRED')
  fail(authorization.completionRoot === RUNTIME_COMPLETION_ROOT && !overlapsRuntimeTarget(repoRoot, path.join(repoRoot, authorization.completionRoot)), 'T3_RUNTIME_COMPLETION_ROOT_FORBIDDEN')
  fail(authorization.bindings?.executor?.path === EXECUTOR_PATH && authorization.bindings.executor.rawFileHash === raw(repoRoot, EXECUTOR_PATH), 'T3_RUNTIME_WRITE_AUTHORIZATION_EXECUTOR_INVALID')
  fail(authorization.bindings.runtimeAssemblyAuthorization?.path === RUNTIME_AUTHORIZATION_PATH && authorization.bindings.runtimeAssemblyAuthorization.rawFileHash === raw(repoRoot, RUNTIME_AUTHORIZATION_PATH), 'T3_RUNTIME_WRITE_AUTHORIZATION_ASSEMBLY_INVALID')
  const manifestBinding = authorization.bindings.prospectiveManifest
  fail(manifestBinding?.path === PROSPECTIVE_MANIFEST_PATH && manifestBinding.rawFileHash === raw(repoRoot, PROSPECTIVE_MANIFEST_PATH), 'T3_RUNTIME_WRITE_AUTHORIZATION_PROSPECTIVE_MANIFEST_INVALID')
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, PROSPECTIVE_MANIFEST_PATH)))
  fail(manifest.schemaVersion === 't3-runtime-assembly-prospective-manifest.v1' && manifest.status === 'PROSPECTIVE_NON_RUNTIME_VALIDATED' && manifest.runtimeWriteAuthorized === false && manifest.baseline?.count === 41 && manifest.added === 139 && manifest.finalCount === 180 && JSON.stringify(manifest.overlaps) === JSON.stringify({ exactExisting: 0, deterministicUpdates: 0, conflicts: 0 }) && sameTargets(manifest.targetPaths ?? []) && sameTargets(Object.keys(manifest.baseline?.hashes ?? {})) && sameTargets(Object.keys(manifest.prospectiveHashes ?? {})), 'T3_RUNTIME_WRITE_PROSPECTIVE_STATE_INVALID')
  for (const target of RUNTIME_TARGETS) {
    fail(authorization.bindings.baselineTargets?.[target] === manifest.baseline.hashes[target] && manifest.baseline.hashes[target] === raw(repoRoot, target), 'T3_RUNTIME_WRITE_AUTHORIZATION_BASELINE_INVALID')
    fail(authorization.prospectiveTargetHashes?.[target] === manifest.prospectiveHashes[target], 'T3_RUNTIME_WRITE_AUTHORIZATION_PROSPECTIVE_HASH_INVALID')
  }
  fail(sameTargets(Object.keys(authorization.bindings.baselineTargets ?? {})) && sameTargets(Object.keys(authorization.prospectiveTargetHashes ?? {})), 'T3_RUNTIME_WRITE_AUTHORIZATION_TARGETS_INVALID')
  return { manifest, manifestHash: manifestBinding.rawFileHash }
}

function validateTransactionInputs({ authorization, artifacts, baselineHashes }) {
  fail(authorization?.runtimeWriteAuthorized === true && sameTargets(authorization.targetPaths ?? []) && sameTargets(Object.keys(authorization.prospectiveTargetHashes ?? {})) && sameTargets(Object.keys(authorization.bindings?.baselineTargets ?? {})), 'T3_RUNTIME_WRITE_AUTHORIZATION_REQUIRED')
  for (const target of RUNTIME_TARGETS) {
    fail(hashBytes(artifacts[target]) === authorization.prospectiveTargetHashes[target], 'T3_RUNTIME_WRITE_ARTIFACT_HASH_MISMATCH')
    fail(baselineHashes[target] === authorization.bindings.baselineTargets[target], 'T3_RUNTIME_WRITE_BASELINE_HASH_MISMATCH')
  }
}

function writeCompletionArtifacts({ completionRoot, authorization, finalHashes, baselineHashes, prospectiveManifestHash, rollbackUsed = false }) {
  const manifest = { schemaVersion: 't3-runtime-assembly-completion-manifest.v1', status: 'RUNTIME_ASSEMBLY_COMPLETE', runtimeAssemblyAuthorizationHash: authorization.bindings.runtimeAssemblyAuthorization.rawFileHash, runtimeWriteAuthorizationHash: hashArtifact(authorization), executorRawHash: authorization.bindings.executor.rawFileHash, prospectiveManifestHash, targetPaths: RUNTIME_TARGETS, baselineHashes, authorizedProspectiveHashes: authorization.prospectiveTargetHashes, finalHashes, baselineCount: 41, added: 139, finalCount: 180, overlaps: { exactExisting: 0, deterministicUpdates: 0, conflicts: 0 }, semanticMutations: 0, factualMutations: 0, posterMutations: 0, paletteMutations: 0, networkCalls: 0, providerCalls: 0, rollbackUsed }
  fs.mkdirSync(completionRoot, { recursive: true })
  const manifestPath = path.join(completionRoot, COMPLETION_MANIFEST); fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  const ledger = { schemaVersion: 't3-runtime-assembly-execution-ledger.v1', status: 'RUNTIME_ASSEMBLY_COMPLETE_RELEASE_NOT_AUTHORIZED', completionManifestHash: hashArtifact(manifest), runtimeAssemblyComplete: true, releaseAllowed: false, deploymentAllowed: false, rollbackUsed }
  fs.writeFileSync(path.join(completionRoot, EXECUTION_LEDGER), `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' })
  return { manifest, ledger }
}

/** Fixture-capable transaction primitive. Real calls require a future write authorization. */
export function commitRuntimeTransaction({ root, artifacts, runtimeWriteAuthorization, fixtureMode = false, completionRoot = path.join(root, RUNTIME_COMPLETION_ROOT), failAfterReplacement = null, corruptReadback = false } = {}) {
  const live = path.resolve(root) === REPO; const targets = RUNTIME_TARGETS; fail(sameTargets(Object.keys(artifacts ?? {})), 'T3_RUNTIME_TRANSACTION_TARGETS_INVALID')
  const governedCompletionRoot = path.join(root, RUNTIME_COMPLETION_ROOT)
  const liveAuthorization = live ? validateRuntimeWriteAuthorization(runtimeWriteAuthorization, { repoRoot: root }) : null
  if (live) fail(path.resolve(completionRoot) === governedCompletionRoot, 'T3_RUNTIME_COMPLETION_ROOT_FORBIDDEN'); else fail(fixtureMode === true && !overlapsRuntimeTarget(root, completionRoot), 'T3_RUNTIME_COMPLETION_ROOT_FORBIDDEN')
  const baseline = Object.fromEntries(targets.map((target) => [target, fs.readFileSync(path.join(root, target))]))
  const baselineHashes = Object.fromEntries(targets.map((target) => [target, hashBytes(baseline[target])]))
  validateTransactionInputs({ authorization: runtimeWriteAuthorization, artifacts, baselineHashes })
  fail(!fs.existsSync(path.join(completionRoot, COMPLETION_MANIFEST)) && !fs.existsSync(path.join(completionRoot, EXECUTION_LEDGER)), 'T3_RUNTIME_COMPLETION_ALREADY_EXISTS')
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 't3-runtime-stage-'))
  let completionStarted = false
  try {
    if (failAfterReplacement === 0) throw new Error('T3_RUNTIME_TRANSACTION_INJECTED_FAILURE')
    for (const target of targets) { const staged = path.join(stage, target); fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, artifacts[target]) }
    for (const target of targets) fail(hashBytes(fs.readFileSync(path.join(stage, target))) === runtimeWriteAuthorization.prospectiveTargetHashes[target], 'T3_RUNTIME_TRANSACTION_STAGING_HASH_MISMATCH')
    let replaced = 0
    for (const target of targets) { const live = path.join(root, target); const temporary = `${live}.t3-runtime-${process.pid}`; fs.writeFileSync(temporary, artifacts[target]); fs.renameSync(temporary, live); replaced++; if (failAfterReplacement === replaced) throw new Error('T3_RUNTIME_TRANSACTION_INJECTED_FAILURE') }
    const finalHashes = Object.fromEntries(targets.map((target) => [target, hashBytes(fs.readFileSync(path.join(root, target)))]))
    if (corruptReadback || targets.some((target) => finalHashes[target] !== runtimeWriteAuthorization.prospectiveTargetHashes[target])) throw new Error('T3_RUNTIME_TRANSACTION_READBACK_INVALID')
    completionStarted = true
    const completion = writeCompletionArtifacts({ completionRoot, authorization: runtimeWriteAuthorization, finalHashes, baselineHashes, prospectiveManifestHash: liveAuthorization?.manifestHash ?? runtimeWriteAuthorization.bindings.prospectiveManifest.rawFileHash })
    return { committed: true, rollbackUsed: false, finalHashes, completion }
  } catch (error) {
    if (completionStarted) { fs.rmSync(path.join(completionRoot, COMPLETION_MANIFEST), { force: true }); fs.rmSync(path.join(completionRoot, EXECUTION_LEDGER), { force: true }) }
    try { for (const target of targets) { const live = path.join(root, target); const temporary = `${live}.t3-rollback-${process.pid}`; fs.writeFileSync(temporary, baseline[target]); fs.renameSync(temporary, live) } } catch { throw new Error('T3_RUNTIME_TRANSACTION_ROLLBACK_SEVERE') }
    fail(targets.every((target) => hashBytes(fs.readFileSync(path.join(root, target))) === baselineHashes[target]), 'T3_RUNTIME_TRANSACTION_ROLLBACK_SEVERE'); throw error
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) throw new Error('T3_RUNTIME_WRITE_AUTHORIZATION_REQUIRED')
