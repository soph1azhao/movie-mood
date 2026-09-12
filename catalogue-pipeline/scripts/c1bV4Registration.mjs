import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, posix, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LanguageVariant, SyntaxKind, createScanner } from 'typescript/unstable/ast'
import { canonicalize } from './c1bV2Stage0.mjs'

export const V4_IMPLEMENTATION_COMMIT = '0308ca0b2fb8c54315384d41da8871edcd2e0a84'
export const V4_PROTOCOL_ID = 'phase-5c-c1b-v-confirmatory.v4'
export const V4_ROOT_ENTRYPOINT = 'catalogue-pipeline/adapters/wikipediaDescriptiveEvidenceV2.mjs'
export const EXECUTABLE_CLOSURE_PATH = 'catalogue-pipeline/calibration/diagnostics/wikipedia-executable-closure.v1.json'
export const TRIAGE_AUDIT_PATH = 'catalogue-pipeline/calibration/diagnostics/c1b-v4-triage-exposure-audit.v1.json'
export const V4_CONTRACTS_PATH = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.contracts.json'
export const V4_PROTOCOL_PATH = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4.json'
const V3_CONTRACTS_PATH = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.contracts.json'
const V3_PROTOCOL_PATH = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json'
const V3_COHORT_PATH = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/stage1-recruitment-live-v1/candidate-registry.json'
const TRIAGE_STANDARD = 'No adverse evidence of candidate-specific exposure was found across available logs, scripts, and Git history. This is an absence-of-adverse-evidence standard accepted as sufficient for this study.'
const SUPPORTED_LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'])
const SOURCE_EXTENSIONS = ['', '.mjs', '.js', '.ts', '.mts', '.cjs', '.cts', '.tsx', '.jsx', '.json']

export class V4RegistrationError extends Error {
  constructor(message, code = 'V4_REGISTRATION_ERROR', details) { super(message); this.name = 'V4RegistrationError'; this.code = code; this.details = details }
}
const fail = (message, code, details) => { throw new V4RegistrationError(message, code, details) }
export const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export const canonicalSha256 = (value) => rawSha256(Buffer.from(canonicalize(value), 'utf8'))
const git = (root, args, { encoding = null } = {}) => {
  const result = spawnSync('git', args, { cwd: root, encoding, stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) fail(`Git command failed: git ${args.join(' ')}`, 'GIT_COMMAND_FAILED', result.stderr?.toString())
  return result.stdout
}
const gitFile = (root, commit, path) => git(root, ['show', `${commit}:${path}`])
const gitPaths = (root, commit) => git(root, ['ls-tree', '-r', '--name-only', commit], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)

function runtimeSpecifiers(source, path) {
  const scanner = createScanner(true, LanguageVariant.Standard, source)
  const tokens = []
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) tokens.push({ kind, value: scanner.getTokenValue() })
  const result = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== SyntaxKind.ImportKeyword && token.kind !== SyntaxKind.ExportKeyword) continue
    const next = tokens[index + 1]
    if (next?.kind === SyntaxKind.TypeKeyword) continue
    if (token.kind === SyntaxKind.ImportKeyword && next?.kind === SyntaxKind.OpenParenToken && tokens[index + 2]?.kind === SyntaxKind.StringLiteral) {
      result.push(tokens[index + 2].value)
      continue
    }
    if (token.kind === SyntaxKind.ImportKeyword && next?.kind === SyntaxKind.StringLiteral) {
      result.push(next.value)
      continue
    }
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].kind !== SyntaxKind.SemicolonToken; cursor += 1) {
      if (tokens[cursor].kind === SyntaxKind.FromKeyword && tokens[cursor + 1]?.kind === SyntaxKind.StringLiteral) {
        result.push(tokens[cursor + 1].value)
        break
      }
    }
  }
  return [...new Set(result)]
}

function resolveLocalSpecifier(importer, specifier, available) {
  if (!specifier.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier))
  const candidates = extname(base) ? [base] : SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`).concat(SOURCE_EXTENSIONS.map((extension) => posix.join(base, `index${extension}`)))
  const match = candidates.find((candidate) => available.has(candidate))
  if (!match) fail(`Reachable local runtime dependency is absent: ${specifier} from ${importer}`, 'MISSING_RUNTIME_DEPENDENCY', { importer, specifier })
  return match
}

export function deriveDependencyPaths({ root = process.cwd(), commit = V4_IMPLEMENTATION_COMMIT, entrypoint = V4_ROOT_ENTRYPOINT } = {}) {
  const paths = gitPaths(root, commit)
  const available = new Set(paths)
  if (!available.has(entrypoint)) fail('Root semantic entrypoint is absent from frozen implementation commit.', 'MISSING_ROOT_ENTRYPOINT')
  const visited = new Set()
  const edges = []
  const pending = [entrypoint]
  while (pending.length) {
    const importer = pending.pop()
    if (visited.has(importer)) continue
    visited.add(importer)
    const source = gitFile(root, commit, importer).toString('utf8')
    for (const specifier of runtimeSpecifiers(source, importer)) {
      const imported = resolveLocalSpecifier(importer, specifier, available)
      if (!imported) continue
      edges.push({ importer, specifier, imported })
      if (!visited.has(imported)) pending.push(imported)
    }
  }
  return { paths: [...visited].sort(), edges: edges.sort((a, b) => `${a.importer}\0${a.imported}`.localeCompare(`${b.importer}\0${b.imported}`)) }
}

export function buildExecutableClosureManifest({ root = process.cwd(), commit = V4_IMPLEMENTATION_COMMIT } = {}) {
  const graph = deriveDependencyPaths({ root, commit })
  const repositoryPaths = gitPaths(root, commit)
  const packageMetadata = JSON.parse(gitFile(root, commit, 'package.json').toString('utf8'))
  const lockfiles = repositoryPaths.filter((path) => SUPPORTED_LOCKFILES.has(posix.basename(path))).sort().map((path) => ({ path, rawSha256: rawSha256(gitFile(root, commit, path)) }))
  const materialLocalSources = graph.paths.map((path) => ({ path, gitTracked: true, rawSha256: rawSha256(gitFile(root, commit, path)) }))
  return {
    manifestId: 'wikipedia-executable-closure.v1',
    rootSemanticEntrypoint: V4_ROOT_ENTRYPOINT,
    dependencyDerivation: { method: 'recursive-static-runtime-import-analysis-typescript-compiler-api', membershipAuthority: 'derived-import-graph', typeOnlyImportsExcluded: true },
    materialLocalSources,
    importEdges: graph.edges,
    frozenImplementationCommit: commit,
    packageManager: packageMetadata.packageManager,
    dependencyLockfiles: lockfiles,
    nodeEngine: `>=${process.versions.node.split('.')[0]}.0.0`,
  }
}

async function filesUnder(path) {
  const output = []
  const walk = async (current) => {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) output.push(child)
    }
  }
  await walk(path)
  return output
}

export async function buildTriageExposureAudit({ root = process.cwd() } = {}) {
  const registry = JSON.parse(await readFile(resolve(root, V3_COHORT_PATH), 'utf8'))
  const candidateIds = registry.candidates.map(({ id }) => String(id)).sort((a, b) => Number(a) - Number(b))
  if (candidateIds.length !== 180 || new Set(candidateIds).size !== 180) fail('Imported V3 cohort is not exactly 180 unique candidates.', 'COHORT_IDENTITY_MISMATCH')
  const candidateIdSet = new Set(candidateIds)
  const candidateIdentityPatterns = [
    /\b(?:candidateId|tmdbId)\s*[:=]\s*['"]?(\d+)\b/gu,
    /["']id["']\s*:\s*(\d+)\b/gu,
  ]
  const findCandidateIdentityMatches = (text) => {
    const matches = []
    for (const pattern of candidateIdentityPatterns) {
      pattern.lastIndex = 0
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        if (candidateIdSet.has(match[1])) matches.push(match[1])
      }
    }
    return [...new Set(matches)]
  }
  const currentRoots = [
    'catalogue-pipeline/calibration/diagnostics',
    'catalogue-pipeline/scripts',
    'catalogue-pipeline/generated/semantic/diagnostics',
  ]
  const excludedPrefixes = [
    'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/',
    'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v4/stage2-wikipedia-viability-live-v1/',
    'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v4',
    'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v4-stage2-closure.v1.json',
    EXECUTABLE_CLOSURE_PATH,
    TRIAGE_AUDIT_PATH,
  ]
  const currentFiles = (await Promise.all(currentRoots.map((path) => filesUnder(resolve(root, path))))).flat()
    .map((path) => relative(root, path).split('\\').join('/'))
    .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)))
    .sort()
  const currentMatches = []
  for (const path of currentFiles) {
    let text
    try { text = await readFile(resolve(root, path), 'utf8') } catch { continue }
    for (const candidateId of findCandidateIdentityMatches(text)) currentMatches.push({ candidateId, path })
  }
  const historyPatch = git(root, ['log', '--all', '-p', '--', ...currentRoots], { encoding: 'utf8' })
  const historyMatches = findCandidateIdentityMatches(historyPatch).map((candidateId) => ({ candidateId, source: 'git-history-patch' }))
  const adverseEvidence = [...currentMatches, ...historyMatches]
  if (adverseEvidence.length) fail('Candidate-specific exposure evidence was found.', 'ADVERSE_TRIAGE_EXPOSURE_EVIDENCE', adverseEvidence)
  return {
    reportId: 'c1b-v4-triage-exposure-audit.v1',
    protocolId: V4_PROTOCOL_ID,
    importedCohort: { sourceProtocolId: 'phase-5c-c1b-v-confirmatory.v3', candidateCount: 180, candidateRegistryRawSha256: 'sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f' },
    evidenceSourcesInspected: [
      { category: 'repository-diagnostic-definitions-and-reports', fileCount: currentFiles.filter((path) => path.includes('/calibration/diagnostics/')).length },
      { category: 'repository-scripts', fileCount: currentFiles.filter((path) => path.includes('/scripts/')).length },
      { category: 'historical-generated-diagnostics', fileCount: currentFiles.filter((path) => path.includes('/generated/semantic/diagnostics/')).length },
      { category: 'git-history', method: 'identity-field-aware comparison of all 180 numeric TMDB candidate IDs against every local Git revision patch over diagnostic, script, and generated-diagnostic paths' },
    ],
    candidateIdComparisonMethod: 'Exact comparison of each of the 180 imported V3 numeric TMDB candidate IDs in candidateId, tmdbId, or JSON id identity-field contexts against inspected repository files and Git patch history. Identity-field scoping prevents unrelated numeric literals from becoming false exposure evidence. V3 cohort/live artifacts were excluded as source-cohort records, not exposure evidence.',
    inspectedRepositoryFileCount: currentFiles.length,
    adverseEvidenceFound: false,
    adverseEvidence: [],
    triageExposureStatus: 'VERIFIED_NO_ADVERSE_EVIDENCE',
    epistemicStandard: TRIAGE_STANDARD,
    scopeLimitations: [
      'The audit is limited to available repository diagnostics, scripts, historical reports, and Git history.',
      'No shell history, filesystem atime, DNS logs, proxy logs, browser history, or unrelated machine telemetry was inspected.',
      'The finding is absence of adverse evidence, not proof of absolute non-exposure.',
    ],
    networkCallsDuringAudit: 0,
  }
}

function contract(id, canonicalContent) { return { id, version: 1, canonicalContent, contentHash: canonicalSha256(canonicalContent) } }

export function buildV4Contracts({ v3Bundle, executableClosureHash, triageAuditHash }) {
  const inheritedIds = ['shared-covariate-contract.v2', 'friends-classification-contract.v2', 'semantic-taxonomy.v2', 'arm0-input-projection.v2', 'arm1-evidence-projection.v2', 'wikipedia-excerpt-projection.v2', 'literal-grounding-validator.v2', 'identity-canary-contract.v2']
  const imported = contract('imported-v3-cohort-contract.v4', {
    sourceProtocolId: 'phase-5c-c1b-v-confirmatory.v3', sourceClosureCommit: '2013e0f50df5ce8dc6fadd79bbf25cc63f54316e',
    stage1Closure: { path: 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-stage1-closure.v1.json', rawSha256: 'sha256:d7ebf19f03486da8faa3d907924fab4c10176d3c5150c9cba8273497bd5a348c' },
    candidateRegistry: { path: V3_COHORT_PATH, rawSha256: 'sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f', candidateCount: 180 },
    carryForwardOnly: true, tmdbRecruitmentRequests: 0, rerankingAllowed: false, replenishmentAllowed: false, substitutionAllowed: false, factualRefreshAllowed: false,
  })
  const closure = contract('wikipedia-executable-closure-contract.v1', {
    manifestPath: EXECUTABLE_CLOSURE_PATH, manifestCanonicalSha256: executableClosureHash, frozenImplementationCommit: V4_IMPLEMENTATION_COMMIT,
    rootSemanticEntrypoint: V4_ROOT_ENTRYPOINT, dependencyMembershipMustBeRecursivelyDerived: true, manuallyCuratedDependencyMembershipAuthoritative: false,
    everyMaterialLocalDependencyMustBeGitTrackedAndHashPinned: true, everySupportedLockfileMustBeHashPinned: true,
    jitExecutionOrder: ['acquire-stage2-RUN_LOCK', 'verify-executable-closure-and-provenance-under-same-lock', 'permit-no-mutable-semantic-policy-operation', 'dispatch-first-stage2-http-request', 'durably-complete-first-request-under-same-lock'],
  })
  const zeroOverfitting = contract('wikipedia-zero-overfitting-contract.v1', {
    triageAuditReportPath: TRIAGE_AUDIT_PATH, triageAuditReportHash: triageAuditHash, triageExposureStatus: 'VERIFIED_NO_ADVERSE_EVIDENCE', epistemicStandard: TRIAGE_STANDARD,
    fixtureProvenancePath: 'tests/fixtures/wikipedia/provenance.json', importedV3Stage2OutcomeInformationUsed: false,
    substantivePolicy: { identityResolution: 'wikipedia-film-identity-resolution.v1', sectionFamily: 'wikipedia-reception-sections.v2', extraction: 'wikipedia-reception-extraction.v2', normalizationFilter: 'wikipedia-reception-normalization-filter.v1', minimumEligibleNormalizedWords: 150 },
    forbiddenTuning: ['rule', 'regex', 'section-hierarchy', 'paragraph-filter', 'normalization', 'threshold', 'fallback'],
  })
  const inherited = inheritedIds.map((id) => {
    const source = v3Bundle.contracts.find((entry) => entry.id === id)
    if (!source) fail(`Missing inherited V3 contract: ${id}`, 'MISSING_INHERITED_CONTRACT')
    return contract(id, source.canonicalContent)
  })
  const contracts = [imported, closure, zeroOverfitting, ...inherited]
  const orderedContractManifest = contracts.map(({ id, version, contentHash }) => ({ id, version, contentHash }))
  return {
    bundleId: 'phase-5c-c1b-v-confirmatory.v4.contracts', bundleVersion: 1,
    canonicalization: 'RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8, SHA-256',
    hashingSemantics: v3Bundle.hashingSemantics,
    inheritedContractPolicy: { sourceBundleId: v3Bundle.bundleId, sourceBundleHash: v3Bundle.contractsBundleHash, rule: 'The eight explicitly re-adopted V3 canonicalContent values have identical RFC-8785/JCS UTF-8 canonical serialization.' },
    contracts, orderedContractManifest, contractsBundleHash: canonicalSha256(orderedContractManifest), registrationStatus: 'REGISTERED',
  }
}

export function buildV4Protocol({ v3Protocol, bundle, executableClosureHash, triageAuditHash }) {
  const protocol = structuredClone(v3Protocol)
  protocol.protocolId = V4_PROTOCOL_ID
  protocol.protocolVersion = 4
  protocol.historicalProvenance = {
    predecessorProtocol: 'phase-5c-c1b-v-confirmatory.v3', predecessorClosureCommit: '2013e0f50df5ce8dc6fadd79bbf25cc63f54316e',
    predecessorConclusion: 'BLOCKED — STAGE-2 FROZEN POLICY DEPENDENCY NOT FORENSICALLY REPRODUCIBLE',
    relationship: 'prospective-successor-study-with-explicit-v3-cohort-import',
    triageExposureStatus: 'VERIFIED_NO_ADVERSE_EVIDENCE', triageAuditReportPath: TRIAGE_AUDIT_PATH, triageAuditReportHash: triageAuditHash,
    epistemicStandard: TRIAGE_STANDARD,
  }
  protocol.requiredDesignDisclosures = {
    independentSuccessor: true,
    exactImmutableV3CohortImport: { candidateCount: 180, sourceProtocolId: 'phase-5c-c1b-v-confirmatory.v3' },
    newTmdbRecruitment: false,
    rerankingAllowed: false,
    replenishmentAllowed: false,
    substitutionAllowed: false,
    factualRefreshAllowed: false,
    v3Stage2Executed: false,
    v3HumanGoldOutcomesExistedAtCarryForwardDecision: false,
    v3SemanticEfficacyOutcomesExistedAtCarryForwardDecision: false,
    coverageInference: 'descriptive-for-exact-imported-180-only',
    downstreamProtocolIdNamespace: 'V4 protocol-ID namespaces apply only to V4 downstream deterministic selections; Stage 1 is not reselected.',
  }
  protocol.studyEstimands.coverage.coverageByFriendsGold = 'NOT_IDENTIFIABLE_IN_MAIN_V4_DESIGN'
  const stage0 = protocol.stages.find(({ stage }) => stage === 0)
  stage0.wikipediaExecutableClosure = { path: EXECUTABLE_CLOSURE_PATH, canonicalSha256: executableClosureHash, frozenImplementationCommit: V4_IMPLEMENTATION_COMMIT, dependencyMembershipAutomaticallyDerived: true }
  stage0.stage2JitExecutionInvariant = { sameRunLockRequired: true, orderedSteps: ['acquire-stage2-RUN_LOCK', 'JIT-hash-and-provenance-verification', 'no-mutable-semantic-policy-operation', 'first-stage2-HTTP-dispatch', 'first-request-durable-completion'], lockRetainedThroughFirstRequestDurableCompletion: true }
  protocol.stages[1] = {
    stage: 1, id: 'imported-v3-frozen-factual-candidate-universe', candidateCount: 180,
    sourceProtocolId: 'phase-5c-c1b-v-confirmatory.v3', sourceClosureCommit: '2013e0f50df5ce8dc6fadd79bbf25cc63f54316e',
    sourceStage1ClosureRawSha256: 'sha256:d7ebf19f03486da8faa3d907924fab4c10176d3c5150c9cba8273497bd5a348c',
    candidateRegistryRawSha256: 'sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f',
    tmdbRecruitmentRequests: 0, rerankingAllowed: false, replenishmentAllowed: false, substitutionAllowed: false, factualRefreshAllowed: false,
  }
  const stage2 = protocol.stages.find(({ stage }) => stage === 2)
  stage2.fixtureProvenancePath = 'tests/fixtures/wikipedia/provenance.json'
  stage2.substantivePolicyFrozenUnchangedFromV3 = true
  stage2.forbiddenProspectiveTuning = ['rule', 'regex', 'section-hierarchy', 'paragraph-filter', 'normalization', 'threshold', 'additional-fallback']
  const stage3 = protocol.stages.find(({ stage }) => stage === 3)
  stage3.lowConfidenceArchive.path = 'c1b-v4-boundary-pool.json'
  const futureStrictBandStudy = protocol.stages.find(({ futureStrictBandStudy }) => futureStrictBandStudy)?.futureStrictBandStudy
  if (futureStrictBandStudy) {
    delete futureStrictBandStudy.automaticallyExecutedByV3
    futureStrictBandStudy.automaticallyExecutedByV4 = false
  }
  protocol.forbiddenAdaptationsAfterExecutionBegins = [
    'changing the exact imported V3 180-film cohort',
    'performing new TMDB recruitment or factual refresh',
    'reranking, replenishing, substituting, or replacing imported-cohort films',
    'changing the frozen Wikipedia identity-resolution policy',
    'changing the frozen Wikipedia section-family, extraction, or normalization-filter policy',
    'changing the Wikipedia 150-word viability gate',
    'adding Wikipedia headings, other-language Wikipedia, external-source, or replacement-candidate fallbacks',
  ]
  protocol.protocolFreeze = {
    immutableOnceExecutionBegins: true,
    stage2PolicyImplementationFrozenByReference: true,
    frozenImplementationCommit: V4_IMPLEMENTATION_COMMIT,
    networkExecutionAuthorizedBySpecificationAlone: false,
  }
  protocol.contractBundle = { bundleId: bundle.bundleId, bundleVersion: 1, contractsBundleHash: bundle.contractsBundleHash, requiredContracts: bundle.orderedContractManifest.map(({ id, contentHash }) => ({ id, contentHash })) }
  protocol.specificationStatus = 'registered-frozen'
  protocol.registrationStatus = 'REGISTERED'
  return protocol
}

export async function generateV4Registration({ root = process.cwd() } = {}) {
  const closure = buildExecutableClosureManifest({ root })
  const triage = await buildTriageExposureAudit({ root })
  const executableClosureHash = canonicalSha256(closure)
  const triageAuditHash = canonicalSha256(triage)
  const triageAuditRawSha256 = rawSha256(Buffer.from(`${JSON.stringify(triage, null, 2)}\n`, 'utf8'))
  const v3Bundle = JSON.parse(await readFile(resolve(root, V3_CONTRACTS_PATH), 'utf8'))
  const v3Protocol = JSON.parse(await readFile(resolve(root, V3_PROTOCOL_PATH), 'utf8'))
  const bundle = buildV4Contracts({ v3Bundle, executableClosureHash, triageAuditHash })
  const protocol = buildV4Protocol({ v3Protocol, bundle, executableClosureHash, triageAuditHash })
  const artifacts = [[EXECUTABLE_CLOSURE_PATH, closure], [TRIAGE_AUDIT_PATH, triage], [V4_CONTRACTS_PATH, bundle], [V4_PROTOCOL_PATH, protocol]]
  for (const [path, value] of artifacts) await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`)
  return { executableClosureHash, triageAuditHash, triageAuditRawSha256, contractsBundleHash: bundle.contractsBundleHash, protocolJcsSha256: canonicalSha256(protocol), dependencyCount: closure.materialLocalSources.length }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  generateV4Registration().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1 })
}
