// C1b-V3 Stage 1C: offline-only pre-live exclusion freeze and gate.
// It intentionally has no transport, WAL, or provider-request capability.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { atomicWriteArtifact, canonicalSha256, canonicalize, parseJsonRejectingDuplicateKeys } from './c1bV2Stage0.mjs'
import { assembleRepositoryExclusions } from './c1bV2Stage1Runner.mjs'
import { V3_PROTOCOL_ID, buildV3ExclusionManifest, loadRegisteredV3Spec, verifyV3ExclusionManifest } from './c1bV3Stage1.mjs'
import { V3_STAGE1_RUNNER_VERSION } from './c1bV3Stage1Runner.mjs'

export const V3_PRELIVE_ARTIFACT_VERSION = 'phase5c-c1b-v3-stage1-pre-live.v1'
export const V3_STAGE1A_CHECKPOINT = '0d4065d7f3098391e5cdeac65bbd27055c602dfe'
export const V3_STAGE1B_CHECKPOINT = '3c9b8d9c65bdf97addb58d2402b6918f093e3b59'
export const V3_FUTURE_INVOCATION_ID = 'phase-5c-c1b-v3-stage1-recruitment-live-v1'
export const V3_FUTURE_LIVE_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1'
export const V3_PRELIVE_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/pre-live-v1'

const EXPECTED = Object.freeze({
  protocolRaw: 'sha256:3568b8fd4f2895ab4b9e2cdba145e501e737c784d08a948491413de47483b374',
  protocolJcs: 'sha256:4ceaa4af2db232de365e9f42a4e85ce4bdff9fb9dc56e38b3806d85c4b0f8bc2',
  contractsRaw: 'sha256:072b538edcda6b17ff8997d5b5ec2a9fd46029d54d68e0ee7e6c01295b530fdc',
  contractsBundle: 'sha256:2f477ef6ba7f12e17ed5f1178026e2572f9abddf12507395121519ed03b6b738',
  stage1Contract: 'sha256:00c3aa3f7509c0bf662ec8e9eb8d5e0b2119d70dbf957dc821c3aa54d310a5a4',
  partition: 'sha256:10e44ffb38f0e870a80e2a57f61719fd1bb55d6e6fd8836aadb05743a773c0c6',
  acceptanceRaw: 'sha256:1fc55f07ed59a6a6551e044a33891581b427df67526dea08176b491d28a3c923',
})
const V2_CLOSURE = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v2-stage1-closure.v1.json'
const V2_LIVE_RELATIVE = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v2/stage1-recruitment-live-v1'
const V2_FROZEN_ROOTS = Object.freeze({
  closure: { path: V2_CLOSURE, rawSha256: 'sha256:ce8f49d4ce5cef5c1638ce225379ea42a2d9dea043ca06dd33254ffb2f2b949d' },
  protocol: { path: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.json', rawSha256: 'sha256:3083da9116bfc9d90b74f347e9b52095ff9a60f45a6ae536ebe8d5b57a598057' },
  contracts: { path: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.contracts.json', rawSha256: 'sha256:78e49fe2750399505aa095d329b13b26f61d29ee895c97d9d17e17c3ab6adcea' },
  acceptance: { path: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.acceptance-tests.md', rawSha256: 'sha256:cad481ea0dc793dbb5ae45e7c5c49695da3e2d9855f11bd7541c2186215ab52e' },
})
const EXPECTED_EXCLUSION_COUNT = 150
const EXPECTED_EXCLUSION_MANIFEST_HASH = 'sha256:8b7973b87d9d942946b558b4d1f0565253a54bc1ab020dfc3511fa5cf9e2887a'
const EXPECTED_EXCLUSION_MANIFEST_RAW_SHA256 = 'sha256:658d6b1888bf81c3f0e02dd93cd2d90cd111480522e78db18c2f91b095ec8841'
const IMPLEMENTATION_BINDINGS = Object.freeze([
  { role: 'stage1a', checkpoint: V3_STAGE1A_CHECKPOINT, path: 'catalogue-pipeline/scripts/c1bV3Stage1.mjs' },
  { role: 'stage1a-test', checkpoint: V3_STAGE1A_CHECKPOINT, path: 'catalogue-pipeline/scripts/c1bV3Stage1.test.mjs' },
  { role: 'stage1b', checkpoint: V3_STAGE1B_CHECKPOINT, path: 'catalogue-pipeline/scripts/c1bV3Stage1Runner.mjs' },
  { role: 'stage1b-test', checkpoint: V3_STAGE1B_CHECKPOINT, path: 'catalogue-pipeline/scripts/c1bV3Stage1Runner.test.mjs' },
  { role: 'v2-source-assembler', checkpoint: '0e0d000b49279f8db77552e9bf919e41713ba3de', path: 'catalogue-pipeline/scripts/c1bV2Stage1Runner.mjs' },
])

export class V3PreLiveError extends Error {
  constructor(message, code = 'V3_PRELIVE_ERROR', details) { super(message); this.name = 'V3PreLiveError'; this.code = code; this.details = details }
}
const fail = (message, code, details) => { throw new V3PreLiveError(message, code, details) }
const rawSha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const rawFileSha256 = async (path, readFileImpl = readFile) => rawSha256(await readFileImpl(path, 'utf8'))
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right))

async function pathExists(path) { try { await readFile(path); return true } catch (error) { return error.code === 'EISDIR' || false } }
async function readJson(root, relative) { return parseJsonRejectingDuplicateKeys(await readFile(resolve(root, relative), 'utf8')) }

function sourceFilePaths(source) {
  const paths = new Set()
  if (source.sourcePath?.endsWith('.json')) paths.add(source.sourcePath)
  if (source.resolutionSource?.endsWith('.json')) paths.add(source.resolutionSource)
  for (const record of source.records ?? []) {
    if (typeof record.provenance === 'string' && record.provenance.endsWith('.json')) paths.add(record.provenance)
    for (const artifactPath of record.details?.artifactPaths ?? []) if (artifactPath.endsWith('.json')) paths.add(artifactPath)
  }
  return sorted(paths)
}

async function sourceAudit(root, source) {
  const sourceFiles = sourceFilePaths(source)
  const rawFiles = await Promise.all(sourceFiles.map(async (relativePath) => ({ path: relativePath, rawSha256: await rawFileSha256(resolve(root, relativePath)) })))
  const ids = source.records.map(({ tmdbId }) => tmdbId)
  return {
    sourceCategory: source.sourceCategory,
    sourcePath: source.sourcePath,
    sourceRole: 'substantive-exclusion',
    inputRecordCount: source.recordCount,
    uniqueTmdbIdCount: source.uniqueTmdbIdCount,
    duplicateIdCount: ids.length - new Set(ids).size,
    uniqueTmdbIdsContributed: [...source.uniqueTmdbIdsContributed].sort((a, b) => a - b),
    rawFiles: rawFiles.sort((a, b) => a.path.localeCompare(b.path)),
    rawFileInventoryHash: canonicalSha256({ rawFiles: rawFiles.sort((a, b) => a.path.localeCompare(b.path)) }),
    sourceClassification: 'substantive candidate-specific semantic, descriptive, human-label, prospective, or diagnostic exposure',
  }
}

export async function buildV3PreLiveExclusions({ root = process.cwd(), assembleExclusions = assembleRepositoryExclusions } = {}) {
  const inherited = await assembleExclusions({ root })
  const sourceRows = inherited.provenance.sources
  if (!Array.isArray(sourceRows) || !sourceRows.length) fail('No recorded substantive exposure sources are available.', 'EXPOSURE_SOURCES_MISSING')
  const sources = sourceRows.map((source) => ({ sourceName: source.sourceCategory, entries: source.records }))
  const manifest = buildV3ExclusionManifest({ protocolId: V3_PROTOCOL_ID, sources })
  verifyV3ExclusionManifest(manifest)
  if (manifest.exclusions.length !== EXPECTED_EXCLUSION_COUNT || manifest.exclusionManifestHash !== EXPECTED_EXCLUSION_MANIFEST_HASH) fail('The registered V3 exclusion union changed.', 'EXCLUSION_UNION_CHANGED')
  const audits = await Promise.all(sourceRows.map((source) => sourceAudit(root, source)))
  const identityResolutionInputs = (await Promise.all(inherited.provenance.sourceDigests.map(async ({ path }) => ({ path, rawSha256: await rawFileSha256(resolve(root, path)) })))).sort((a, b) => a.path.localeCompare(b.path))
  const sourceAssemblerBinding = (await implementationBindings(root)).find(({ role }) => role === 'v2-source-assembler')
  if (!sourceAssemblerBinding?.exact) fail('The V2 source assembler is not byte-identical to its audited checkpoint.', 'IMPLEMENTATION_BINDING_MISMATCH')
  const allIds = sourceRows.flatMap(({ records }) => records.map(({ tmdbId }) => tmdbId))
  const provenance = {
    artifactId: 'phase5c-c1b-v3-stage1-exclusion-provenance.v1',
    artifactVersion: 1,
    protocolId: V3_PROTOCOL_ID,
    generatedBy: V3_PRELIVE_ARTIFACT_VERSION,
    sourceInterpretation: 'Reuses the audited V2 deterministic source interpretation only where its source categories are substantive exposures under the registered V3 policy; V2 protocol identity and manifest hash are not reused.',
    substantiveSources: audits.sort((a, b) => a.sourceCategory.localeCompare(b.sourceCategory)),
    identityResolutionInputs,
    mergedUniqueExclusionCount: manifest.exclusions.length,
    duplicateDiagnostics: { inputRecordCount: allIds.length, duplicateIdCount: allIds.length - new Set(allIds).size, metadataConflictStatus: 'NONE' },
    v2FactualPage1Rule: {
      consumedAsExclusionInput: false,
      rawResponseCopiedIntoV3Universe: false,
      feasibilityFactsRetainedOnly: { '1980-1989.total_pages': 45, '1990-1999.total_pages': 65 },
      rationale: 'V2 page-1 observations were feasibility-only factual discovery and are not substantive exposure.',
    },
    sourceAssemblerBinding: { path: sourceAssemblerBinding.path, checkpoint: sourceAssemblerBinding.checkpoint, rawSha256: sourceAssemblerBinding.workingRawSha256 },
    exclusionManifestHash: manifest.exclusionManifestHash,
  }
  return { manifest, provenance }
}

export async function verifyV3ExclusionProvenance(provenance, { root = process.cwd(), manifest } = {}) {
  if (!provenance || provenance.protocolId !== V3_PROTOCOL_ID || provenance.artifactId !== 'phase5c-c1b-v3-stage1-exclusion-provenance.v1' || !Array.isArray(provenance.substantiveSources) || provenance.v2FactualPage1Rule?.consumedAsExclusionInput !== false || provenance.v2FactualPage1Rule?.rawResponseCopiedIntoV3Universe !== false) fail('V3 exclusion provenance binding mismatch.', 'PROVENANCE_MISMATCH')
  if (manifest) verifyV3ExclusionManifest(manifest)
  if (manifest && provenance.exclusionManifestHash !== manifest.exclusionManifestHash) fail('V3 provenance exclusion hash mismatch.', 'PROVENANCE_MISMATCH')
  const facts = provenance.v2FactualPage1Rule?.feasibilityFactsRetainedOnly
  if (facts?.['1980-1989.total_pages'] !== 45 || facts?.['1990-1999.total_pages'] !== 65) fail('V2 feasibility facts are not exact.', 'PROVENANCE_MISMATCH')
  if (JSON.stringify(provenance).includes(V2_LIVE_RELATIVE)) fail('V2 live execution material is prohibited from V3 exclusion provenance.', 'V2_LIVE_PROVENANCE_PROHIBITED')
  const assembler = provenance.sourceAssemblerBinding
  const expectedAssembler = (await implementationBindings(root)).find(({ role }) => role === 'v2-source-assembler')
  if (!assembler || !expectedAssembler?.exact || assembler.path !== expectedAssembler.path || assembler.checkpoint !== expectedAssembler.checkpoint || assembler.rawSha256 !== expectedAssembler.workingRawSha256) fail('V2 source assembler binding mismatch.', 'PROVENANCE_MISMATCH')
  for (const source of provenance.substantiveSources) for (const file of source.rawFiles ?? []) {
    if (await rawFileSha256(resolve(root, file.path)) !== file.rawSha256) fail('V3 provenance source hash mismatch.', 'PROVENANCE_SOURCE_HASH_MISMATCH', { path: file.path })
  }
  for (const file of provenance.identityResolutionInputs ?? []) if (await rawFileSha256(resolve(root, file.path)) !== file.rawSha256) fail('V3 provenance identity input hash mismatch.', 'PROVENANCE_SOURCE_HASH_MISMATCH', { path: file.path })
  return { ok: true }
}

function gitPassed(root, args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).status === 0 }
function gitOutput(root, args) { const result = spawnSync('git', args, { cwd: root, encoding: null, stdio: 'pipe' }); return result.status === 0 ? result.stdout : null }
function gitHead(root) { const output = gitOutput(root, ['rev-parse', 'HEAD']); return output?.toString('utf8').trim() ?? null }
async function implementationBindings(root) {
  return Promise.all(IMPLEMENTATION_BINDINGS.map(async (binding) => {
    const expectedBytes = gitOutput(root, ['show', `${binding.checkpoint}:${binding.path}`])
    const indexBytes = gitOutput(root, ['show', `:${binding.path}`])
    let workingBytes = null
    try { workingBytes = await readFile(resolve(root, binding.path)) } catch { /* reported below */ }
    const expectedRawSha256 = expectedBytes ? rawSha256(expectedBytes) : null
    return { ...binding, expectedRawSha256, indexRawSha256: indexBytes ? rawSha256(indexBytes) : null, workingRawSha256: workingBytes ? rawSha256(workingBytes) : null, exact: Boolean(expectedBytes && indexBytes && workingBytes) && rawSha256(indexBytes) === expectedRawSha256 && rawSha256(workingBytes) === expectedRawSha256 }
  }))
}
export async function verifyV2ForensicIntegrity(root, { readFileImpl = readFile } = {}) {
  const roots = await Promise.all(Object.entries(V2_FROZEN_ROOTS).map(async ([name, entry]) => ({ name, ...entry, actual: await rawFileSha256(resolve(root, entry.path), readFileImpl) })))
  const rootsOk = roots.every(({ rawSha256: expected, actual }) => expected === actual)
  if (!rootsOk) return { ok: false, roots, entries: [] }
  let closure
  try { closure = parseJsonRejectingDuplicateKeys(await readFileImpl(resolve(root, V2_CLOSURE), 'utf8')) } catch { return { ok: false, roots, entries: [] } }
  const entries = await Promise.all(Object.entries(closure.artifactSha256 ?? {}).map(async ([name, expected]) => {
    const actual = await rawFileSha256(resolve(root, V2_LIVE_RELATIVE, name), readFileImpl)
    return { name, expected: `sha256:${expected.replace(/^sha256:/u, '')}`, actual }
  }))
  return { ok: entries.length > 0 && entries.every(({ expected, actual }) => expected === actual), roots, entries }
}

export async function verifyV3PreLiveGate({ root = process.cwd(), manifest, provenance, tmdbCredentialPresent = Boolean(process.env.TMDB_READ_ACCESS_TOKEN), runnerVersion = V3_STAGE1_RUNNER_VERSION, stage1aCheckpoint = V3_STAGE1A_CHECKPOINT, stage1bCheckpoint = V3_STAGE1B_CHECKPOINT, loadSpec = loadRegisteredV3Spec } = {}) {
  let frozen
  try { frozen = await loadSpec({ root }) } catch (error) { return { ok: false, reason: error.code ?? 'SPECIFICATION_TAMPER', checks: { registeredSpec: false } } }
  const protocolRaw = await readFile(resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json'), 'utf8')
  const contractsRaw = await readFile(resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.contracts.json'), 'utf8')
  const acceptanceRaw = await readFile(resolve(root, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.acceptance-tests.md'), 'utf8')
  let manifestValid = false; let provenanceValid = false
  try { verifyV3ExclusionManifest(manifest); manifestValid = true; await verifyV3ExclusionProvenance(provenance, { root, manifest }); provenanceValid = true } catch { /* captured below */ }
  const v2 = await verifyV2ForensicIntegrity(root)
  const bindings = await implementationBindings(root)
  const cells = frozen.cells
  const dateCount = cells.reduce((sum, cell) => sum + (Date.parse(`${cell.releaseDateLte}T00:00:00Z`) - Date.parse(`${cell.releaseDateGte}T00:00:00Z`)) / 86_400_000 + 1, 0)
  const specPaths = [
    'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json',
    'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.contracts.json',
    'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.acceptance-tests.md',
  ]
  const checks = {
    protocolRawHash: rawSha256(protocolRaw) === EXPECTED.protocolRaw,
    protocolJcsHash: canonicalSha256(frozen.protocol) === EXPECTED.protocolJcs,
    contractsRawHash: rawSha256(contractsRaw) === EXPECTED.contractsRaw,
    contractsBundleHash: frozen.bundle.contractsBundleHash === EXPECTED.contractsBundle,
    stage1ContractHash: frozen.contract.contentHash === EXPECTED.stage1Contract,
    partitionManifestHash: frozen.content.partitionManifestHash === EXPECTED.partition,
    acceptancePlanRawHash: rawSha256(acceptanceRaw) === EXPECTED.acceptanceRaw,
    exactAnnualCells: cells.length === 45 && cells.every((cell, index) => cell.year === 1980 + index),
    exactDateCoverage: dateCount === 16_437,
    runnerVersion: runnerVersion === V3_STAGE1_RUNNER_VERSION,
    stage1aCheckpointAncestor: gitPassed(root, ['merge-base', '--is-ancestor', stage1aCheckpoint, 'HEAD']),
    stage1bCheckpointAncestor: gitPassed(root, ['merge-base', '--is-ancestor', stage1bCheckpoint, 'HEAD']),
    implementationBytesBoundToRegisteredCheckpoints: bindings.every(({ exact }) => exact),
    registeredSpecUnmodified: gitPassed(root, ['diff', '--quiet', '--', ...specPaths]),
    v2ForensicArtifactsByteIdentical: v2.ok,
    exclusionManifestValid: manifestValid,
    exclusionProvenanceValid: provenanceValid,
    stagingAreaEmpty: gitPassed(root, ['diff', '--cached', '--quiet']),
  }
  return { ok: Object.values(checks).every(Boolean), checks, v2ForensicRoots: v2.roots, v2ForensicArtifacts: v2.entries, implementationBindings: bindings, tmdbCredentialPresent: Boolean(tmdbCredentialPresent), networkCallsDuringGate: 0 }
}

async function persistOnceOrVerify(path, value, { replace = false } = {}) {
  if (await pathExists(path)) {
    const stored = parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))
    if (canonicalize(stored) !== canonicalize(value)) {
      if (replace) { await atomicWriteArtifact(path, value); return }
      fail('Existing pre-live artifact differs from deterministic value.', 'PRELIVE_ARTIFACT_MISMATCH', { path })
    }
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await atomicWriteArtifact(path, value)
}

export async function prepareV3PreLiveGate({ root = process.cwd(), outputDir = resolve(root, V3_PRELIVE_RELATIVE), env = process.env } = {}) {
  const preparationBaseHead = gitHead(root)
  if (preparationBaseHead !== V3_STAGE1B_CHECKPOINT) fail('Pre-live preparation requires the exact Stage 1B checkpoint.', 'PREPARATION_HEAD_MISMATCH', { preparationBaseHead })
  const { manifest, provenance } = await buildV3PreLiveExclusions({ root })
  const tmdbCredentialPresent = typeof env.TMDB_READ_ACCESS_TOKEN === 'string' && env.TMDB_READ_ACCESS_TOKEN.length > 0
  const verification = await verifyV3PreLiveGate({ root, manifest, provenance, tmdbCredentialPresent })
  if (!verification.ok) fail('Offline V3 pre-live verification failed.', 'PRELIVE_GATE_FAILED', verification)
  const paths = { manifest: join(outputDir, 'exclusion-manifest.json'), provenance: join(outputDir, 'exclusion-provenance.json'), gate: join(outputDir, 'phase5c-c1b-v3-stage1-pre-live-gate.v1.json') }
  await persistOnceOrVerify(paths.manifest, manifest)
  await persistOnceOrVerify(paths.provenance, provenance, { replace: true })
  const manifestRawSha256 = await rawFileSha256(paths.manifest)
  if (manifestRawSha256 !== EXPECTED_EXCLUSION_MANIFEST_RAW_SHA256) fail('The registered V3 exclusion manifest bytes changed.', 'EXCLUSION_UNION_CHANGED')
  const provenanceRawSha256 = await rawFileSha256(paths.provenance)
  const gate = {
    artifactId: V3_PRELIVE_ARTIFACT_VERSION,
    protocolId: V3_PROTOCOL_ID,
    stage: 1,
    specificationHashes: EXPECTED,
    stage1aCheckpoint: V3_STAGE1A_CHECKPOINT,
    stage1bCheckpoint: V3_STAGE1B_CHECKPOINT,
    preparationBaseHead,
    runnerVersion: V3_STAGE1_RUNNER_VERSION,
    exclusionManifestHash: manifest.exclusionManifestHash,
    exclusionManifestRawSha256: manifestRawSha256,
    exclusionProvenanceRawSha256: provenanceRawSha256,
    intendedLiveOutputDirectory: V3_FUTURE_LIVE_RELATIVE,
    invocationId: V3_FUTURE_INVOCATION_ID,
    tmdbCredentialPresent,
    networkCallsDuringGate: 0,
    providerWalIntentRecordsCreated: 0,
    gateStatus: 'PRE-LIVE GATE — PASS',
    futureAuthorizationStatus: tmdbCredentialPresent ? 'PENDING INDEPENDENT AUTHORIZATION' : 'BLOCKED — TMDB CREDENTIAL NOT PRESENT',
    noV3ProviderRequestHasYetBeenMade: true,
    liveExecutionRequiresIndependentAuthorization: true,
    checks: verification.checks,
    implementationBindings: verification.implementationBindings,
    v2ForensicRoots: verification.v2ForensicRoots,
    v2ForensicArtifacts: verification.v2ForensicArtifacts,
  }
  await persistOnceOrVerify(paths.gate, gate, { replace: true })
  return { manifest, provenance, gate, paths, rawSha256: { manifest: manifestRawSha256, provenance: provenanceRawSha256, gate: await rawFileSha256(paths.gate) } }
}

// This is configuration only. It deliberately does not import or invoke a transport.
// A later independently authorized execution must consume this exact object.
export async function loadFrozenV3Stage1RunConfiguration({ root = process.cwd(), preLiveDir = resolve(root, V3_PRELIVE_RELATIVE) } = {}) {
  const manifestPath = join(preLiveDir, 'exclusion-manifest.json')
  const provenancePath = join(preLiveDir, 'exclusion-provenance.json')
  const gatePath = join(preLiveDir, 'phase5c-c1b-v3-stage1-pre-live-gate.v1.json')
  const [manifest, provenance, gate] = await Promise.all([manifestPath, provenancePath, gatePath].map(async (path) => parseJsonRejectingDuplicateKeys(await readFile(path, 'utf8'))))
  const verification = await verifyV3PreLiveGate({ root, manifest, provenance, tmdbCredentialPresent: gate.tmdbCredentialPresent })
  const expectedAuthorization = gate.tmdbCredentialPresent === true ? 'PENDING INDEPENDENT AUTHORIZATION' : 'BLOCKED — TMDB CREDENTIAL NOT PRESENT'
  if (!verification.ok || gate.gateStatus !== 'PRE-LIVE GATE — PASS' || gate.protocolId !== V3_PROTOCOL_ID || gate.stage !== 1 || gate.runnerVersion !== V3_STAGE1_RUNNER_VERSION || gate.stage1aCheckpoint !== V3_STAGE1A_CHECKPOINT || gate.stage1bCheckpoint !== V3_STAGE1B_CHECKPOINT || gate.preparationBaseHead !== V3_STAGE1B_CHECKPOINT || canonicalize(gate.specificationHashes) !== canonicalize(EXPECTED) || canonicalize(gate.implementationBindings) !== canonicalize(verification.implementationBindings) || canonicalize(gate.v2ForensicRoots) !== canonicalize(verification.v2ForensicRoots) || canonicalize(gate.checks) !== canonicalize(verification.checks) || typeof gate.tmdbCredentialPresent !== 'boolean' || gate.futureAuthorizationStatus !== expectedAuthorization || gate.invocationId !== V3_FUTURE_INVOCATION_ID || gate.intendedLiveOutputDirectory !== V3_FUTURE_LIVE_RELATIVE || gate.exclusionManifestHash !== EXPECTED_EXCLUSION_MANIFEST_HASH || manifest.exclusions.length !== EXPECTED_EXCLUSION_COUNT || gate.exclusionManifestHash !== manifest.exclusionManifestHash || gate.exclusionManifestRawSha256 !== EXPECTED_EXCLUSION_MANIFEST_RAW_SHA256 || gate.exclusionManifestRawSha256 !== await rawFileSha256(manifestPath) || gate.exclusionProvenanceRawSha256 !== await rawFileSha256(provenancePath) || gate.networkCallsDuringGate !== 0 || gate.providerWalIntentRecordsCreated !== 0 || gate.noV3ProviderRequestHasYetBeenMade !== true || gate.liveExecutionRequiresIndependentAuthorization !== true) {
    fail('Frozen V3 pre-live run configuration is invalid.', 'FROZEN_RUN_CONFIGURATION_MISMATCH')
  }
  if (await pathExists(resolve(root, V3_FUTURE_LIVE_RELATIVE))) fail('Future V3 live output directory already exists.', 'FUTURE_LIVE_DIRECTORY_EXISTS')
  return Object.freeze({
    protocolId: V3_PROTOCOL_ID,
    stage: 1,
    runnerVersion: V3_STAGE1_RUNNER_VERSION,
    invocationId: V3_FUTURE_INVOCATION_ID,
    artifactDir: resolve(root, V3_FUTURE_LIVE_RELATIVE),
    exclusionManifest: manifest,
    exclusionManifestHash: manifest.exclusionManifestHash,
    preLiveGatePath: gatePath,
    liveExecutionRequiresIndependentAuthorization: true,
  })
}
