import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'
import { RUNTIME_AUTHORIZATION_PATH, RUNTIME_TARGETS, validateRuntimeAssemblyAuthorization } from './t3RuntimeAssemblyAuthorization.mjs'
import { COMPLETION_MANIFEST, EXECUTION_LEDGER, EXECUTOR_PATH, PROSPECTIVE_MANIFEST_PATH, RUNTIME_COMPLETION_ROOT, buildProspectiveRuntimeArtifacts, commitRuntimeTransaction, emitProspectiveRuntimeAssembly, validateProspectiveRuntimeState, validateRuntimeWriteAuthorization } from './t3RuntimeAssemblyExecution.mjs'

const authorization = JSON.parse(fs.readFileSync(RUNTIME_AUTHORIZATION_PATH))
const snapshot = () => Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, fs.readFileSync(target)]))
const hash = (file) => hashBytes(fs.readFileSync(file))
const parseArtifacts = (result) => {
  const curatedSource = result.artifacts['src/data/curatedMovies.ts'].toString()
  return { curated: JSON.parse(curatedSource.slice(curatedSource.indexOf('= [') + 2)), facts: JSON.parse(result.artifacts['src/data/generated/tmdbMovies.json']), mappings: JSON.parse(result.artifacts['src/data/tmdbMovieMappings.json']) }
}

function liveWriteAuthorization() {
  const prospectiveManifest = JSON.parse(fs.readFileSync(PROSPECTIVE_MANIFEST_PATH))
  return { schemaVersion: 't3-runtime-write-execution-authorization.v1', runtimeWriteAuthorized: true, runtimeAssemblyPopulation: 139, expectedFinalCount: 180, semanticMutationAllowed: false, factualMutationAllowed: false, posterMutationAllowed: false, paletteMutationAllowed: false, networkCallsAuthorized: 0, providerCallsAuthorized: 0, releaseAllowed: false, deploymentAllowed: false, completionRoot: RUNTIME_COMPLETION_ROOT, targetPaths: RUNTIME_TARGETS, prospectiveTargetHashes: prospectiveManifest.prospectiveHashes, bindings: { executor: { path: EXECUTOR_PATH, rawFileHash: hash(EXECUTOR_PATH) }, runtimeAssemblyAuthorization: { path: RUNTIME_AUTHORIZATION_PATH, rawFileHash: hash(RUNTIME_AUTHORIZATION_PATH) }, prospectiveManifest: { path: PROSPECTIVE_MANIFEST_PATH, rawFileHash: hash(PROSPECTIVE_MANIFEST_PATH) }, baselineTargets: prospectiveManifest.baseline.hashes } }
}

test('frozen authorization validates and real promoted input produces an exact prospective 180-record runtime state', () => {
  const before = snapshot(); assert.equal(validateRuntimeAssemblyAuthorization(authorization), true)
  const result = buildProspectiveRuntimeArtifacts({ authorization }); const state = parseArtifacts(result)
  assert.equal(result.plan.baseline.count, 41); assert.equal(result.plan.projections.length, 139); assert.equal(result.plan.expectedFinalCount, 180)
  assert.deepEqual(result.plan.overlaps, { exactExisting: 0, deterministicUpdates: 0, conflicts: 0 })
  assert.equal(state.curated.length, 180); assert.equal(Object.keys(state.facts).length, 180); assert.equal(state.mappings.length, 180)
  assert.deepEqual(result.validation, { resolvedCount: 180, uniqueRuntimeIds: 180, uniqueTmdbIds: 180 })
  for (const target of RUNTIME_TARGETS) assert.deepEqual(fs.readFileSync(target), before[target])
})

test('prospective output is confined outside runtime and records three exact candidate files plus hashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't3-prospective-')); const result = emitProspectiveRuntimeAssembly({ authorization, prospectiveRoot: root })
  for (const target of RUNTIME_TARGETS) assert.deepEqual(fs.readFileSync(path.join(root, target)), result.artifacts[target])
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 't3-runtime-assembly-prospective-manifest.v1.json')))
  assert.equal(manifest.status, 'PROSPECTIVE_NON_RUNTIME_VALIDATED'); assert.equal(manifest.runtimeWriteAuthorized, false); assert.deepEqual(manifest.prospectiveHashes, result.hashes)
})

test('future write authorization binds the exact frozen prospective manifest, three per-target hashes, and completion root', () => {
  assert.deepEqual(validateRuntimeWriteAuthorization(liveWriteAuthorization()).manifest.prospectiveHashes, JSON.parse(fs.readFileSync(PROSPECTIVE_MANIFEST_PATH)).prospectiveHashes)
  const wrongManifest = liveWriteAuthorization(); wrongManifest.bindings.prospectiveManifest.rawFileHash = 'sha256:wrong'
  assert.throws(() => validateRuntimeWriteAuthorization(wrongManifest), /PROSPECTIVE_MANIFEST_INVALID/)
  const wrongRoot = liveWriteAuthorization(); wrongRoot.completionRoot = 'catalogue-pipeline/generated/elsewhere'
  assert.throws(() => validateRuntimeWriteAuthorization(wrongRoot), /COMPLETION_ROOT_FORBIDDEN/)
  assert.deepEqual(liveWriteAuthorization().targetPaths, RUNTIME_TARGETS)
})

test('prospective validator rejects duplicate identity, missing facts, mapping mismatch, baseline changes, and provenance leakage', () => {
  const result = buildProspectiveRuntimeArtifacts({ authorization }); const state = parseArtifacts(result); const invoke = () => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...state })
  assert.deepEqual(invoke(), result.validation)
  const duplicate = structuredClone(state); duplicate.curated[179].id = duplicate.curated[0].id; assert.throws(() => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...duplicate }), /DUPLICATE_IDENTITY/)
  const missingFacts = structuredClone(state); delete missingFacts.facts[missingFacts.curated[179].id]; assert.throws(() => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...missingFacts }), /RESOLVER_INVALID/)
  const mappingMismatch = structuredClone(state); mappingMismatch.mappings[179].tmdbId++; assert.throws(() => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...mappingMismatch }), /RESOLVER_INVALID/)
  const baselineChanged = structuredClone(state); baselineChanged.curated[0].description = 'changed'; assert.throws(() => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...baselineChanged }), /BASELINE_CONTENT_CHANGED/)
  const provenanceLeak = structuredClone(state); provenanceLeak.facts[state.curated[179].id].provenance = {}; assert.throws(() => validateProspectiveRuntimeState({ plan: result.plan, baseline: result.baseline, ...provenanceLeak }), /PROVENANCE_LEAK/)
})

test('baseline authorization hash drift fails closed before prospective construction', () => {
  const drifted = structuredClone(authorization); drifted.bindings.curatedMovies.rawFileHash = 'sha256:drifted'
  assert.throws(() => buildProspectiveRuntimeArtifacts({ authorization: drifted }), /AUTHORIZATION_BINDING_INVALID/)
})

test('runtime writes require future source-hash-bound authority', () => {
  const result = buildProspectiveRuntimeArtifacts({ authorization })
  assert.throws(() => commitRuntimeTransaction({ root: process.cwd(), artifacts: result.artifacts, runtimeWriteAuthorized: true }), /WRITE_AUTHORIZATION_REQUIRED/)
})

test('live transaction rejects a caller-selected completion root before target replacement', () => {
  const before = snapshot(); const artifacts = buildProspectiveRuntimeArtifacts({ authorization }).artifacts
  assert.throws(() => commitRuntimeTransaction({ root: process.cwd(), artifacts, runtimeWriteAuthorization: liveWriteAuthorization(), completionRoot: path.join(process.cwd(), 'src/data') }), /COMPLETION_ROOT_FORBIDDEN/)
  for (const target of RUNTIME_TARGETS) assert.deepEqual(fs.readFileSync(target), before[target])
})

test('executor contains no network, provider, poster-acquisition, or palette-generation path', () => {
  const source = fs.readFileSync(new URL('./t3RuntimeAssemblyExecution.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\/|gemini|openai|posterAcquisition|paletteGeneration/i)
})

function snapshotFixture(root) { return Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, fs.readFileSync(path.join(root, target))])) }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't3-runtime-')); const artifacts = {}
  for (const target of RUNTIME_TARGETS) { const file = path.join(root, target); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `old:${target}`); artifacts[target] = Buffer.from(`new:${target}`) }
  const before = snapshotFixture(root); const baselineTargets = Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, hashBytes(before[target])]))
  const writeAuthorization = { schemaVersion: 't3-runtime-write-execution-authorization.v1', runtimeWriteAuthorized: true, runtimeAssemblyPopulation: 139, expectedFinalCount: 180, targetPaths: RUNTIME_TARGETS, prospectiveTargetHashes: Object.fromEntries(RUNTIME_TARGETS.map((target) => [target, hashBytes(artifacts[target])])), bindings: { executor: { path: EXECUTOR_PATH, rawFileHash: hash(EXECUTOR_PATH) }, runtimeAssemblyAuthorization: { path: RUNTIME_AUTHORIZATION_PATH, rawFileHash: hash(RUNTIME_AUTHORIZATION_PATH) }, prospectiveManifest: { path: PROSPECTIVE_MANIFEST_PATH, rawFileHash: hash(PROSPECTIVE_MANIFEST_PATH) }, baselineTargets } }
  return { root, artifacts, before, writeAuthorization, completionRoot: path.join(root, 'completion') }
}

test('fixture transaction commits exactly authorized buffers and writes completion manifest then ledger', () => {
  const f = fixture(); const result = commitRuntimeTransaction({ root: f.root, artifacts: f.artifacts, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot })
  assert.equal(result.committed, true); for (const target of RUNTIME_TARGETS) assert.deepEqual(fs.readFileSync(path.join(f.root, target)), f.artifacts[target])
  const manifest = JSON.parse(fs.readFileSync(path.join(f.completionRoot, COMPLETION_MANIFEST))); const ledger = JSON.parse(fs.readFileSync(path.join(f.completionRoot, EXECUTION_LEDGER)))
  assert.deepEqual(manifest.finalHashes, f.writeAuthorization.prospectiveTargetHashes); assert.equal(manifest.finalCount, 180); assert.equal(ledger.completionManifestHash, hashArtifact(manifest)); assert.equal(ledger.releaseAllowed, false); assert.equal(ledger.deploymentAllowed, false)
})

test('fixture completion root is allowed only in fixture mode and cannot overlap a runtime target', () => {
  const f = fixture(); assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: f.artifacts, runtimeWriteAuthorization: f.writeAuthorization, completionRoot: f.completionRoot }), /COMPLETION_ROOT_FORBIDDEN/)
  assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: f.artifacts, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: path.join(f.root, RUNTIME_TARGETS[0]) }), /COMPLETION_ROOT_FORBIDDEN/)
  assert.deepEqual(snapshotFixture(f.root), f.before)
})

for (const target of RUNTIME_TARGETS) test(`mutated ${target} candidate is rejected before replacement`, () => {
  const f = fixture(); const mutated = { ...f.artifacts, [target]: Buffer.from(f.artifacts[target]) }; mutated[target][0] ^= 1
  assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: mutated, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot }), /ARTIFACT_HASH_MISMATCH/)
  assert.deepEqual(snapshotFixture(f.root), f.before); assert.equal(fs.existsSync(path.join(f.completionRoot, COMPLETION_MANIFEST)), false); assert.equal(fs.existsSync(path.join(f.completionRoot, EXECUTION_LEDGER)), false)
})

test('extra or missing candidate target is rejected before replacement', () => {
  const f = fixture(); const extra = { ...f.artifacts, 'src/data/extra.json': Buffer.from('extra') }
  assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: extra, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot }), /TRANSACTION_TARGETS_INVALID/)
  const missing = { ...f.artifacts }; delete missing[RUNTIME_TARGETS[0]]
  assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: missing, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot }), /TRANSACTION_TARGETS_INVALID/)
  assert.deepEqual(snapshotFixture(f.root), f.before)
})

test('fixture baseline drift is rejected before replacement', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, RUNTIME_TARGETS[0]), 'drifted')
  const drifted = snapshotFixture(f.root); assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: f.artifacts, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot }), /BASELINE_HASH_MISMATCH/)
  assert.deepEqual(snapshotFixture(f.root), drifted)
})

for (const [name, options] of [['fails before first replacement', { failAfterReplacement: 0 }], ['rolls back after replacement one', { failAfterReplacement: 1 }], ['rolls back after replacement two', { failAfterReplacement: 2 }], ['rolls back after readback failure', { corruptReadback: true }]]) test(`fixture transaction ${name}`, () => {
  const f = fixture(); assert.throws(() => commitRuntimeTransaction({ root: f.root, artifacts: f.artifacts, runtimeWriteAuthorization: f.writeAuthorization, fixtureMode: true, completionRoot: f.completionRoot, ...options }))
  assert.deepEqual(snapshotFixture(f.root), f.before); assert.equal(fs.existsSync(path.join(f.completionRoot, COMPLETION_MANIFEST)), false); assert.equal(fs.existsSync(path.join(f.completionRoot, EXECUTION_LEDGER)), false)
})
