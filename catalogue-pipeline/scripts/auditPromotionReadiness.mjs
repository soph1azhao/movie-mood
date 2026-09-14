import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  validateEditorialOutput,
  validateMovieFacts,
  validateSemanticOutput,
} from './validateBatch.mjs'

const VALID_MANIFEST_STATUSES = new Set(['IMPORTED_VALID', 'LOW_VALID', 'HIGH_VALID', 'MAX_VALID'])
const COPY_FIELDS = ['description', 'whyWatch', 'curiosityHook', 'vibeSummary']
const SEMANTIC_FIELDS = ['moods', 'situations', 'filterLanguages', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function stableSort(values, selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right)), 'en'))
}

function indexBy(values, selector) {
  const result = new Map()
  for (const value of values) {
    const key = selector(value)
    const current = result.get(key) ?? []
    current.push(value)
    result.set(key, current)
  }
  return result
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim().length > 0
}

function paletteIsReady(value) {
  return Array.isArray(value) && value.length === 2 && value.every((color) => /^#[0-9a-f]{6}$/i.test(color))
}

function titleKey(value) {
  return String(value ?? '').normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function eraFor(year) {
  if (year < 1970) return 'pre-1970'
  if (year < 1990) return '1970-1989'
  if (year < 2010) return '1990-2009'
  return '2010-present'
}

function runtimeBand(minutes) {
  if (minutes < 90) return 'under-90'
  if (minutes <= 120) return '90-120'
  return 'over-120'
}

export function selectDeterministicPilot(records, size = 16) {
  const eligible = stableSort(records.filter((record) => record.semanticReady && record.factsReady && !record.identityConflict), (record) => record.candidateId)
  const selected = []
  const covered = new Set()

  const features = (record) => [
    ...(record.semantic?.moods ?? []).map((value) => `mood:${value}`),
    ...(record.facts?.spokenLanguages ?? []).map((value) => `language:${value}`),
    `era:${eraFor(record.facts?.year ?? 0)}`,
    `attention:${record.semantic?.attentionDemand}`,
    `weight:${record.semantic?.emotionalWeight}`,
    `discovery:${record.semantic?.discoveryStyle}`,
    `runtime:${runtimeBand(record.facts?.runtimeMinutes ?? 0)}`,
    ...(record.facts?.genres ?? []).map((value) => `genre:${value}`),
  ]

  while (selected.length < Math.min(size, eligible.length)) {
    const remaining = eligible.filter((record) => !selected.includes(record))
    remaining.sort((left, right) => {
      const leftGain = features(left).filter((feature) => !covered.has(feature)).length
      const rightGain = features(right).filter((feature) => !covered.has(feature)).length
      return rightGain - leftGain || left.candidateId.localeCompare(right.candidateId, 'en')
    })
    const next = remaining[0]
    selected.push(next)
    for (const feature of features(next)) covered.add(feature)
  }

  return selected.map((record, index) => ({
    order: index + 1,
    candidateId: record.candidateId,
    tmdbId: record.tmdbId,
    title: record.facts.title,
    year: record.facts.year,
    structuralCoverage: stableSort(features(record)),
  }))
}

export function buildPromotionReadinessAudit(input) {
  const {
    cohortManifest,
    semanticManifest,
    semanticArtifactsByCandidateId = {},
    evidencePacketsByCandidateId = {},
    facts = [],
    runtimeMappings = [],
    runtimeCuratedIdentities = runtimeMappings,
    runtimeFactsByLocalId = {},
    editorialByCandidateId = {},
    palettesByCandidateId = {},
    humanDecisionReadinessByCandidateId = {},
    infrastructure = {},
    sources = {},
    generatedAt = semanticManifest?.lastInvocation?.completedAt ?? null,
    pilotSize = 16,
  } = input

  const cohortEntries = [...(cohortManifest?.importedCandidates ?? []), ...(cohortManifest?.newCandidates ?? [])]
  const semanticStates = semanticManifest?.states ?? {}
  const cohortByCandidate = indexBy(cohortEntries, (entry) => entry.candidateId)
  const cohortByTmdb = indexBy(cohortEntries, (entry) => entry.tmdbId)
  const factsByTmdb = indexBy(facts, (entry) => entry.tmdbId)
  const runtimeByTmdb = indexBy(runtimeMappings, (entry) => entry.tmdbId)
  const sourceAmbiguities = []
  const runtimeSourceConflicts = []

  if (!cohortManifest || !semanticManifest) sourceAmbiguities.push('Required cohort and semantic manifests must both exist.')
  if (cohortManifest?.cohortId !== semanticManifest?.runId) sourceAmbiguities.push('Cohort ID does not match semantic run ID.')
  if (cohortManifest?.cohortHash !== semanticManifest?.cohortHash) sourceAmbiguities.push('Cohort hash does not match semantic manifest hash.')
  if (cohortEntries.length !== cohortManifest?.totalCandidates || cohortEntries.length !== cohortManifest?.targetCount) sourceAmbiguities.push('Cohort member count does not match declared total and target counts.')
  if (cohortEntries.length !== semanticManifest?.candidateCount) sourceAmbiguities.push('Cohort member count does not match semantic manifest candidateCount.')
  if (Object.keys(semanticStates).length !== cohortEntries.length) sourceAmbiguities.push('Semantic manifest state count does not match the cohort.')
  for (const candidateId of new Set([...cohortByCandidate.keys(), ...Object.keys(semanticStates)])) {
    if (!cohortByCandidate.has(candidateId) || !semanticStates[candidateId]) sourceAmbiguities.push(`Cohort/state membership mismatch for ${candidateId}.`)
  }

  const duplicateCandidateIds = stableSort([...cohortByCandidate.entries()].filter(([, entries]) => entries.length > 1).map(([candidateId, entries]) => ({ candidateId, count: entries.length })), (entry) => entry.candidateId)
  const duplicateSemanticIdentities = stableSort([...cohortByTmdb.entries()].filter(([, entries]) => entries.length > 1).map(([tmdbId, entries]) => ({ tmdbId, candidateIds: stableSort(entries.map((entry) => entry.candidateId)) })), (entry) => entry.tmdbId)
  if (duplicateCandidateIds.length) sourceAmbiguities.push('The declared cohort contains duplicate candidate IDs.')
  const curatedById = indexBy(runtimeCuratedIdentities, (entry) => entry.id)
  const mappingsById = indexBy(runtimeMappings, (entry) => entry.id)
  for (const localId of new Set([...curatedById.keys(), ...mappingsById.keys(), ...Object.keys(runtimeFactsByLocalId)])) {
    const curated = curatedById.get(localId) ?? []
    const mappings = mappingsById.get(localId) ?? []
    const runtimeFacts = runtimeFactsByLocalId[localId]
    if (curated.length !== 1 || mappings.length !== 1 || !runtimeFacts) runtimeSourceConflicts.push({ localId, code: 'runtime-source-membership-mismatch' })
    else if (curated[0].tmdbId !== mappings[0].tmdbId || runtimeFacts.tmdbId !== mappings[0].tmdbId) runtimeSourceConflicts.push({ localId, code: 'runtime-source-tmdb-mismatch' })
  }

  const identityConflicts = []
  const records = stableSort(cohortEntries, (entry) => entry.candidateId).map((entry) => {
    const state = semanticStates[entry.candidateId]
    const artifact = semanticArtifactsByCandidateId[entry.candidateId]
    const evidencePacket = evidencePacketsByCandidateId[entry.candidateId]
    const factualMatches = factsByTmdb.get(entry.tmdbId) ?? []
    const factualRecord = factualMatches.length === 1 ? factualMatches[0] : null
    const runtimeMatches = runtimeByTmdb.get(entry.tmdbId) ?? []
    const conflicts = []
    const recordedArtifactHash = state?.lifetimeProvenance?.artifactHash ?? state?.artifactHash ?? null
    const recordedEvidenceHash = state?.evidencePacketHash ?? null

    if (state && state.tmdbId !== entry.tmdbId) conflicts.push('semantic-manifest-tmdb-mismatch')
    if (artifact?.movie && (artifact.movie.candidateId !== entry.candidateId || artifact.movie.tmdbId !== entry.tmdbId)) conflicts.push('semantic-artifact-identity-mismatch')
    if (evidencePacket && (evidencePacket.candidateId !== entry.candidateId || evidencePacket.tmdbId !== entry.tmdbId)) conflicts.push('evidence-packet-identity-mismatch')
    if (recordedArtifactHash && artifact?.outputHash && recordedArtifactHash !== artifact.outputHash) conflicts.push('semantic-artifact-hash-mismatch')
    if (recordedEvidenceHash && artifact?.evidencePacketHash && recordedEvidenceHash !== artifact.evidencePacketHash) conflicts.push('semantic-evidence-hash-mismatch')
    if (recordedEvidenceHash && evidencePacket?.inputHash && recordedEvidenceHash !== evidencePacket.inputHash) conflicts.push('evidence-packet-content-hash-mismatch')
    if (factualMatches.length > 1) conflicts.push('multiple-factual-records-for-tmdb-id')
    if (factualRecord && evidencePacket?.facts) {
      if (titleKey(factualRecord.title) !== titleKey(evidencePacket.facts.title) || factualRecord.year !== evidencePacket.facts.year) conflicts.push('factual-evidence-title-year-mismatch')
    }
    for (const runtimeMatch of runtimeMatches) {
      const runtimeFacts = runtimeFactsByLocalId[runtimeMatch.id]
      if (!runtimeFacts || runtimeFacts.tmdbId !== runtimeMatch.tmdbId) conflicts.push('runtime-mapping-facts-mismatch')
    }

    const semanticValidation = artifact ? validateSemanticOutput(artifact) : { ok: false, hardFailures: [{ code: 'SEMANTIC_ARTIFACT_MISSING' }], reviewFlags: [] }
    const manifestAccepted = VALID_MANIFEST_STATUSES.has(state?.status)
    const semanticReady = Boolean(manifestAccepted && artifact && semanticValidation.ok && evidencePacket)
    const factsValidation = factualRecord ? validateMovieFacts(factualRecord) : { ok: false, hardFailures: [{ code: 'FACTS_MISSING' }], reviewFlags: [] }
    const factsReady = Boolean(factualRecord && factsValidation.ok)
    const editorial = editorialByCandidateId[entry.candidateId] ?? null
    const editorialValidation = editorial ? validateEditorialOutput(editorial) : { ok: false, hardFailures: [{ code: 'EDITORIAL_MISSING' }], reviewFlags: [] }
    const editorialReady = Boolean(editorial && editorialValidation.ok && COPY_FIELDS.every((field) => present(editorial.copy?.[field])))
    const palette = palettesByCandidateId[entry.candidateId] ?? null
    const paletteReady = paletteIsReady(palette)
    // Temporary Phase 0 input: callers may mark only decisions already validated
    // outside this audit. Phase 1 replaces this with a hash-bound decision contract.
    const humanDecisionReady = humanDecisionReadinessByCandidateId[entry.candidateId] === true
    const alreadyInRuntime = runtimeMatches.length > 0
    const identityConflict = conflicts.length > 0
    const provenanceMatches = Boolean(
      recordedArtifactHash && artifact?.outputHash === recordedArtifactHash &&
      recordedEvidenceHash && artifact?.evidencePacketHash === recordedEvidenceHash &&
      evidencePacket?.inputHash === recordedEvidenceHash
    )
    const promotionReady = semanticReady && factsReady && editorialReady && paletteReady && humanDecisionReady && !identityConflict && !alreadyInRuntime
    const categories = []
    if (semanticReady) categories.push('semantic-ready')
    if (factsReady) categories.push('facts-ready')
    if (!editorialReady) categories.push('editorial-missing')
    if (!paletteReady) categories.push('palette-missing')
    if (!humanDecisionReady) categories.push('human-decision-missing')
    if (identityConflict) categories.push('identity-review')
    if (!evidencePacket) categories.push('evidence-incomplete')
    if (alreadyInRuntime) categories.push('already-in-runtime')
    if (!promotionReady) categories.push('promotion-blocked')
    if (identityConflict) identityConflicts.push({ candidateId: entry.candidateId, tmdbId: entry.tmdbId, conflicts })

    return {
      candidateId: entry.candidateId,
      tmdbId: entry.tmdbId,
      manifestStatus: state?.status ?? 'MISSING',
      sourceRunId: state?.lifetimeProvenance?.sourceRunId ?? semanticManifest?.runId ?? null,
      artifactPath: state?.lifetimeProvenance?.artifactPath ?? state?.artifactPath ?? null,
      artifactHash: recordedArtifactHash,
      evidencePacketHash: recordedEvidenceHash,
      schemaVersion: artifact?.schemaVersion ?? null,
      taxonomyVersion: artifact?.taxonomyVersion ?? null,
      promptVersion: artifact?.promptVersion ?? null,
      providerId: artifact?.modelProvider ?? artifact?.providerMetadata?.providerId ?? null,
      modelId: artifact?.modelId ?? artifact?.providerMetadata?.modelId ?? null,
      reasoningEffort: artifact?.providerConfiguration?.reasoningEffort ?? state?.validatedEffort ?? state?.lifetimeProvenance?.validatedEffort ?? null,
      outputMode: artifact?.providerConfiguration?.outputMode ?? null,
      semanticFieldsPresent: Object.fromEntries(SEMANTIC_FIELDS.map((field) => [field, present(artifact?.classification?.[field])])),
      evidencePacketAvailable: Boolean(evidencePacket),
      semanticOutputAvailable: Boolean(artifact),
      semanticValidatorPassed: semanticValidation.ok,
      semanticReady,
      semanticHardFailures: semanticValidation.hardFailures.map((issue) => issue.code),
      provenanceMatches,
      factsAvailable: Boolean(factualRecord),
      factsReady,
      factsHardFailures: factsValidation.hardFailures.map((issue) => issue.code),
      factsReviewFlags: factsValidation.reviewFlags.map((issue) => issue.code),
      editorialReady,
      paletteReady,
      humanDecisionReady,
      alreadyInRuntime,
      runtimeLocalIds: stableSort(runtimeMatches.map((match) => match.id)),
      identityConflict,
      promotionReady,
      categories,
      semantic: artifact?.classification ?? null,
      facts: factualRecord ? {
        title: factualRecord.title,
        year: factualRecord.year,
        director: factualRecord.director,
        countries: factualRecord.countries,
        spokenLanguages: factualRecord.spokenLanguages,
        genres: factualRecord.genres,
        runtimeMinutes: factualRecord.runtimeMinutes,
        posterPath: factualRecord.posterPath,
      } : null,
    }
  })

  const runtimeAbsent = stableSort(runtimeMappings.filter((mapping) => !cohortByTmdb.has(mapping.tmdbId)).map((mapping) => ({ id: mapping.id, tmdbId: mapping.tmdbId })), (entry) => entry.id)
  const alreadyInRuntime = records.filter((record) => record.alreadyInRuntime).map((record) => ({ candidateId: record.candidateId, tmdbId: record.tmdbId, runtimeLocalIds: record.runtimeLocalIds }))
  const duplicateTmdbIds = new Set(duplicateSemanticIdentities.map((entry) => entry.tmdbId))
  const conflictedCandidates = new Set(identityConflicts.map((entry) => entry.candidateId))
  const newUniqueCandidates = records.filter((record) => !record.alreadyInRuntime && !duplicateTmdbIds.has(record.tmdbId) && !conflictedCandidates.has(record.candidateId)).map((record) => ({ candidateId: record.candidateId, tmdbId: record.tmdbId }))
  const traceableRecords = records.filter((record) => VALID_MANIFEST_STATUSES.has(record.manifestStatus) && record.semanticOutputAvailable && record.evidencePacketAvailable && record.provenanceMatches)
  const cohortAmbiguous = sourceAmbiguities.length > 0
  const pilot = cohortAmbiguous ? [] : selectDeterministicPilot(records, pilotSize)

  const blockersByCategory = {
    ambiguousCohortSource: cohortAmbiguous ? cohortEntries.length : 0,
    semanticInvalidOrMissing: records.filter((record) => !record.semanticValidatorPassed || !record.semanticOutputAvailable).length,
    evidenceIncomplete: records.filter((record) => !record.evidencePacketAvailable).length,
    factsMissingOrInvalid: records.filter((record) => !record.factsReady).length,
    editorialMissingOrInvalid: records.filter((record) => !record.editorialReady).length,
    paletteMissingOrInvalid: records.filter((record) => !record.paletteReady).length,
    identityConflict: identityConflicts.length,
    humanDecisionMissing: records.filter((record) => !record.humanDecisionReady).length,
    promotionInfrastructureMissing: Object.values(infrastructure).filter((entry) => entry?.status === 'missing').length,
  }
  const reportRecords = records.map(({ semantic: _semantic, facts: factualRecord, ...record }) => ({
    ...record,
    factualTitle: factualRecord?.title ?? null,
    factualYear: factualRecord?.year ?? null,
  }))

  return {
    auditVersion: 'v8-2-promotion-readiness.v1',
    generatedAt,
    deterministicTimestampSource: 'semantic manifest lastInvocation.completedAt',
    externalCallsDuringAudit: { gemini: 0, kimi: 0, tmdb: 0, wikipedia: 0, total: 0 },
    sources,
    semanticCheckpoint: {
      cohortId: cohortManifest?.cohortId ?? null,
      cohortHash: cohortManifest?.cohortHash ?? null,
      declaredCount: cohortManifest?.targetCount ?? null,
      verifiedCount: cohortAmbiguous ? 0 : records.filter((record) => record.semanticValidatorPassed).length,
      memberCount: records.length,
      uniqueCandidateIdCount: cohortByCandidate.size,
      uniqueTmdbIdCount: cohortByTmdb.size,
      schemaVersions: stableSort([...new Set(records.map((record) => record.schemaVersion).filter(Boolean))]),
      taxonomyVersions: stableSort([...new Set(records.map((record) => record.taxonomyVersion).filter(Boolean))]),
      promptVersion: semanticManifest?.promptVersion ?? null,
      providerId: semanticManifest?.providerId ?? null,
      modelId: semanticManifest?.modelId ?? null,
      outputMode: semanticManifest?.outputMode ?? null,
      semanticPolicyVersion: semanticManifest?.semanticPolicyVersion ?? null,
      evidencePacketAvailableCount: records.filter((record) => record.evidencePacketAvailable).length,
      semanticOutputAvailableCount: records.filter((record) => record.semanticOutputAvailable).length,
      acceptedManifestStatusCount: records.filter((record) => VALID_MANIFEST_STATUSES.has(record.manifestStatus)).length,
      manifestStatusCounts: Object.fromEntries(stableSort([...new Set(records.map((record) => record.manifestStatus))]).map((status) => [status, records.filter((record) => record.manifestStatus === status).length])),
      traceableAcceptedProvenanceCount: traceableRecords.length,
      everyRecordTraceableToAcceptedProvenance: !cohortAmbiguous && traceableRecords.length === records.length,
      sourceAmbiguities,
    },
    runtimeBaseline: {
      movieCount: runtimeMappings.length,
      uniqueTmdbIdCount: runtimeByTmdb.size,
      curatedIdentityCount: runtimeCuratedIdentities.length,
      mappingCount: runtimeMappings.length,
      factualRecordCount: Object.keys(runtimeFactsByLocalId).length,
      sourceConflicts: stableSort(runtimeSourceConflicts, (entry) => entry.localId),
    },
    identityReconciliation: {
      semanticCohortTotal: records.length,
      alreadyInRuntime,
      newUniqueCandidates,
      duplicateCandidateIds,
      duplicateSemanticIdentities,
      identityConflicts: stableSort(identityConflicts, (entry) => entry.candidateId),
      semanticRecordsLackingUsableFactualRecord: records.filter((record) => !record.factsReady).map((record) => ({ candidateId: record.candidateId, tmdbId: record.tmdbId })),
      runtimeFilmsAbsentFromSemantic400: runtimeAbsent,
    },
    readiness: {
      completeSemantic: records.filter((record) => record.semanticReady).length,
      factsReady: records.filter((record) => record.factsReady).length,
      factsPartiallyAvailable: records.filter((record) => record.factsAvailable && !record.factsReady).length,
      factsRequireLaterTmdbAcquisition: records.filter((record) => !record.factsAvailable).length,
      factsConflictingAcrossArtifacts: records.filter((record) => record.identityConflict).length,
      editorialReady: records.filter((record) => record.editorialReady).length,
      paletteReady: records.filter((record) => record.paletteReady).length,
      humanDecisionReady: records.filter((record) => record.humanDecisionReady).length,
      promotionReadyNow: cohortAmbiguous ? 0 : records.filter((record) => record.promotionReady).length,
      blocked: records.filter((record) => !record.promotionReady).length,
    },
    missingRequirements: blockersByCategory,
    infrastructure,
    reviewQueueAssessment: {
      inputContract: 'buildReviewQueue({ batchId, candidates }) using candidate.validationResults and optional proposedCuratedMovie/facts metadata',
      currentScope: 'Generic validation-summary queue builder; existing generated use is semantic/factual readiness, not a complete editorial review transaction.',
      reusable: true,
      laterChanges: ['Add complete editorial and critic provenance.', 'Validate and persist explicit approve/revise/reject decisions.', 'Present compact reviewer-friendly evidence and poster context.', 'Bind accepted decisions to immutable candidate/artifact hashes.'],
      phase0Modified: false,
    },
    pilotSelection: {
      requestedSize: pilotSize,
      actualSize: pilot.length,
      rule: 'Greedy set-cover over mood, spoken language, era, attention demand, emotional weight, discovery style, runtime band, and genre; ties break by candidateId.',
      cohort: pilot,
    },
    records: reportRecords,
    blockers: [
      ...sourceAmbiguities.map((message) => ({ category: 'cohort-source', message })),
      ...(runtimeSourceConflicts.length ? [{ category: 'runtime-identity', message: `${runtimeSourceConflicts.length} runtime source identities conflict.` }] : []),
      ...(blockersByCategory.editorialMissingOrInvalid ? [{ category: 'editorial', message: `${blockersByCategory.editorialMissingOrInvalid} records lack validated editorial copy.` }] : []),
      ...(blockersByCategory.paletteMissingOrInvalid ? [{ category: 'palette', message: `${blockersByCategory.paletteMissingOrInvalid} records lack validated palettes.` }] : []),
      ...(blockersByCategory.humanDecisionMissing ? [{ category: 'human-review', message: `${blockersByCategory.humanDecisionMissing} promotion candidates lack an accepted human decision.` }] : []),
      ...(blockersByCategory.promotionInfrastructureMissing ? [{ category: 'infrastructure', message: `${blockersByCategory.promotionInfrastructureMissing} required executable infrastructure capabilities are missing.` }] : []),
    ],
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function parseCuratedIdentities(source) {
  return [...source.matchAll(/\{\s*id:\s*["']([^"']+)["'],\s*tmdbId:\s*(\d+),/g)].map((match) => ({ id: match[1], tmdbId: Number(match[2]) }))
}

async function describeSource(repoRoot, relativePath) {
  const bytes = await readFile(path.join(repoRoot, relativePath))
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length }
}

function repoRelativeArtifactPath(repoRoot, state, candidateId) {
  const recorded = state?.lifetimeProvenance?.artifactPath ?? state?.artifactPath
  if (recorded) {
    const marker = `${path.sep}catalogue-pipeline${path.sep}`
    const markerIndex = recorded.indexOf(marker)
    const resolved = markerIndex >= 0 ? path.join(repoRoot, recorded.slice(markerIndex + 1)) : recorded
    if (existsSync(resolved)) return resolved
  }
  const sourceRunId = state?.lifetimeProvenance?.sourceRunId
  if (sourceRunId) return path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches', sourceRunId, 'artifacts', `${candidateId}.json`)
  return null
}

function executableInfrastructure(repoRoot) {
  const has = (relativePath) => existsSync(path.join(repoRoot, relativePath))
  return {
    editorialWriter: { status: has('catalogue-pipeline/scripts/writeEditorial.mjs') ? 'implemented' : 'missing', evidence: [] },
    editorialHardValidator: { status: 'implemented', evidence: ['catalogue-pipeline/scripts/validateBatch.mjs#validateEditorialOutput', 'catalogue-pipeline/scripts/checkEditorialVoice.mjs'] },
    criticRunner: { status: has('catalogue-pipeline/scripts/runCritic.mjs') ? 'implemented' : 'missing', evidence: [] },
    criticIndependenceBoundary: { status: 'validator-only', evidence: ['catalogue-pipeline/scripts/validateBatch.mjs#validateCriticOutput'] },
    reviewPacketOrReport: { status: 'partial', evidence: ['catalogue-pipeline/scripts/buildReviewQueue.mjs'], limitation: 'No complete editorial/critic review packet or local review UI.' },
    humanAcceptanceRecord: { status: 'scaffold-only', evidence: ['catalogue-pipeline/scripts/buildReviewQueue.mjs#humanReview'], limitation: 'No acceptance validator, immutable decision binding, or persistence workflow.' },
    paletteGenerator: { status: has('catalogue-pipeline/scripts/generatePalette.mjs') ? 'implemented' : 'missing', evidence: [] },
    promotionBuilder: { status: has('catalogue-pipeline/scripts/promoteReviewedBatch.mjs') ? 'implemented' : 'missing', evidence: [] },
    promotionValidator: { status: 'partial', evidence: ['catalogue-pipeline/scripts/validateBatch.mjs#validateCuratedMovie', 'catalogue-pipeline/scripts/validateBatch.mjs#validateOneToOneMapping'], limitation: 'Validation primitives exist, but no merged promotion transaction validator exists.' },
    productionRollbackReproducibilityManifest: { status: 'missing', evidence: [] },
    recommendationAtScaleBenchmark: { status: has('catalogue-pipeline/scripts/benchmarkRecommendations.mjs') ? 'implemented' : 'missing', evidence: [] },
    staticCatalogueBenchmark: { status: has('catalogue-pipeline/scripts/benchmarkStaticCatalogue.mjs') ? 'implemented' : 'missing', evidence: [] },
  }
}

export async function auditRepository(repoRoot, { outputPath = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-readiness-v1.json' } = {}) {
  const cohortPath = 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/cohort-manifest.json'
  const semanticManifestPath = 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json'
  const expansionFactsPath = 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json'
  const scaleFactsPath = 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/factual-snapshot.json'
  const mappingPath = 'src/data/tmdbMovieMappings.json'
  const runtimeFactsPath = 'src/data/generated/tmdbMovies.json'
  const cohortManifest = await readJson(path.join(repoRoot, cohortPath))
  const semanticManifest = await readJson(path.join(repoRoot, semanticManifestPath))
  const expansionFacts = await readJson(path.join(repoRoot, expansionFactsPath))
  const scaleFacts = await readJson(path.join(repoRoot, scaleFactsPath))
  const runtimeMappings = await readJson(path.join(repoRoot, mappingPath))
  const runtimeFactsByLocalId = await readJson(path.join(repoRoot, runtimeFactsPath))
  const runtimeCuratedIdentities = parseCuratedIdentities(await readFile(path.join(repoRoot, 'src/data/curatedMovies.ts'), 'utf8'))
  const semanticArtifactsByCandidateId = {}
  const evidencePacketsByCandidateId = {}

  for (const entry of [...cohortManifest.importedCandidates, ...cohortManifest.newCandidates]) {
    const state = semanticManifest.states[entry.candidateId]
    const artifactPath = repoRelativeArtifactPath(repoRoot, state, entry.candidateId)
    if (artifactPath && existsSync(artifactPath)) semanticArtifactsByCandidateId[entry.candidateId] = await readJson(artifactPath)
    const evidenceRoot = entry.candidateId.startsWith('exp100-') ? 'expansion-100-v1' : 'scale-500-v1'
    const evidencePath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-expansion', evidenceRoot, 'evidence-packets', `${entry.candidateId}.json`)
    if (existsSync(evidencePath)) evidencePacketsByCandidateId[entry.candidateId] = await readJson(evidencePath)
  }

  const sourcePaths = [
    cohortPath,
    semanticManifestPath,
    expansionFactsPath,
    scaleFactsPath,
    mappingPath,
    runtimeFactsPath,
    'src/data/curatedMovies.ts',
    'src/data/movies.ts',
    'catalogue-pipeline/schemas/semantic.schema.json',
    'catalogue-pipeline/schemas/editorial.schema.json',
    'catalogue-pipeline/schemas/critic.schema.json',
    'catalogue-pipeline/calibration/voice-guide.md',
    'docs/V8_1_CATALOGUE_SCALE_IMPLEMENTATION_SPEC.md',
    'docs/V8_1_CATALOGUE_SCALING_CLOSURE.md',
  ]
  const sourceEntries = await Promise.all(sourcePaths.map((sourcePath) => describeSource(repoRoot, sourcePath)))
  const sources = Object.fromEntries(sourceEntries.map((source) => [source.path, source]))
  const report = buildPromotionReadinessAudit({
    cohortManifest,
    semanticManifest,
    semanticArtifactsByCandidateId,
    evidencePacketsByCandidateId,
    facts: [...expansionFacts.facts, ...scaleFacts.facts],
    runtimeCuratedIdentities,
    runtimeMappings,
    runtimeFactsByLocalId,
    infrastructure: executableInfrastructure(repoRoot),
    sources,
  })
  const absoluteOutputPath = path.join(repoRoot, outputPath)
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true })
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`)
  return { report, outputPath: absoluteOutputPath }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDirectory, '../..')
  const { report, outputPath } = await auditRepository(repoRoot)
  console.log(JSON.stringify({
    outputPath,
    verifiedSemanticRecords: report.semanticCheckpoint.verifiedCount,
    runtimeMovies: report.runtimeBaseline.movieCount,
    overlap: report.identityReconciliation.alreadyInRuntime.length,
    newUniqueCandidates: report.identityReconciliation.newUniqueCandidates.length,
    factsReady: report.readiness.factsReady,
    editorialReady: report.readiness.editorialReady,
    paletteReady: report.readiness.paletteReady,
    humanDecisionReady: report.readiness.humanDecisionReady,
    promotionReadyNow: report.readiness.promotionReadyNow,
    externalCalls: report.externalCallsDuringAudit.total,
  }, null, 2))
}
