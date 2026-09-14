import { createHash } from 'node:crypto'

import { checkEditorialVoice } from './checkEditorialVoice.mjs'
import {
  validateCriticOutput,
  validateCuratedMovie,
  validateEditorialOutput,
  validateMovieFacts,
  validateSemanticOutput,
} from './validateBatch.mjs'

export const REQUIRED_REVIEW_HASHES = [
  'semanticArtifact',
  'evidencePacket',
  'factsRecord',
  'editorialArtifact',
  'criticArtifact',
  'paletteArtifact',
  'completeRecord',
]

export const REQUIRED_PRODUCTION_PROVENANCE = [
  'promotionCandidateHash',
  'semanticArtifactHash',
  'evidencePacketHash',
  'factsRecordHash',
  'editorialArtifactHash',
  'criticArtifactHash',
  'paletteArtifactHash',
  'humanReviewDecisionHash',
]

export const REQUIRED_RUNTIME_SOURCE_HASHES = ['curatedMovies', 'tmdbMovieMappings', 'tmdbMovies']

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const ACCEPTABLE_CRITIC_VERDICTS = new Set(['approve_for_review', 'candidate_for_auto_accept'])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function issue(code, message, details = {}) {
  return { severity: 'hard_fail', code, message, ...details }
}

function result(hardFailures, reviewFlags = []) {
  return { ok: hardFailures.length === 0, hardFailures, reviewFlags }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validDateTime(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value))
}

function checkHashFields(value, fields, hardFailures, prefix) {
  if (!isObject(value)) {
    hardFailures.push(issue('MISSING_HASH_BINDINGS', `${prefix} must be an object.`))
    return
  }
  for (const field of fields) {
    if (!HASH_PATTERN.test(value[field] ?? '')) hardFailures.push(issue('INVALID_HASH', `${prefix}.${field} must be a sha256 hash.`, { field: `${prefix}.${field}` }))
  }
}

function appendValidation(hardFailures, validation, prefix) {
  for (const failure of validation.hardFailures ?? []) hardFailures.push({ ...failure, code: `${prefix}_${failure.code}` })
}

export function stableSerialize(value) {
  if (value === undefined) return '"__movie_mood_undefined__"'
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function serializeArtifactForPersistence(value) {
  return `${stableSerialize(value)}\n`
}

export function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function hashArtifact(value) {
  return hashBytes(serializeArtifactForPersistence(value))
}

export function hashReviewedProductionBytes(record) {
  const { humanReviewDecisionHash: _decisionHash, ...upstreamProvenance } = record?.provenance ?? {}
  return hashArtifact({
    candidateId: record?.candidateId,
    tmdbId: record?.tmdbId,
    curatedMovie: record?.curatedMovie,
    facts: record?.facts,
    upstreamProvenance,
  })
}

export function validatePromotionCandidate(candidate) {
  const hardFailures = []
  if (!isObject(candidate)) return result([issue('INVALID_PROMOTION_CANDIDATE', 'Promotion candidate must be an object.')])
  if (candidate.schemaVersion !== 'promotion-candidate.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Promotion candidate schemaVersion must be promotion-candidate.v1.'))
  if (!nonEmptyString(candidate.candidateId)) hardFailures.push(issue('MISSING_CANDIDATE_ID', 'candidateId is required.'))
  if (!Number.isInteger(candidate.tmdbId) || candidate.tmdbId < 1) hardFailures.push(issue('INVALID_TMDB_ID', 'tmdbId must be a positive integer.'))
  if (!nonEmptyString(candidate.cohortId)) hardFailures.push(issue('MISSING_COHORT_ID', 'cohortId is required.'))
  if (!HASH_PATTERN.test(candidate.candidateCohortHash ?? '')) hardFailures.push(issue('INVALID_COHORT_HASH', 'candidateCohortHash must be a sha256 hash.'))
  checkHashFields(candidate.sourceHashes, ['semanticArtifact', 'evidencePacket', 'factsRecord'], hardFailures, 'sourceHashes')
  return result(hardFailures)
}

export function validateHumanReviewDecision(decision) {
  const hardFailures = []
  if (!isObject(decision)) return result([issue('INVALID_HUMAN_REVIEW', 'Human review decision must be an object.')])
  if (decision.schemaVersion !== 'human-review.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Human review schemaVersion must be human-review.v1.'))
  if (!nonEmptyString(decision.candidateId)) hardFailures.push(issue('MISSING_CANDIDATE_ID', 'candidateId is required.'))
  if (!Number.isInteger(decision.tmdbId) || decision.tmdbId < 1) hardFailures.push(issue('INVALID_TMDB_ID', 'tmdbId must be a positive integer.'))
  if (!['approve', 'revise', 'reject'].includes(decision.decision)) hardFailures.push(issue('INVALID_REVIEW_DECISION', 'decision must be approve, revise, or reject.'))
  if (!nonEmptyString(decision.reviewer)) hardFailures.push(issue('MISSING_REVIEWER', 'reviewer is required.'))
  if (!validDateTime(decision.reviewedAt)) hardFailures.push(issue('INVALID_REVIEWED_AT', 'reviewedAt must be a valid date-time.'))
  if (decision.notes !== null && typeof decision.notes !== 'string') hardFailures.push(issue('INVALID_REVIEW_NOTES', 'notes must be a string or null.'))
  if (!isObject(decision.revisions)) hardFailures.push(issue('INVALID_REVISIONS', 'revisions must be an object.'))
  if (decision.decision === 'approve' && isObject(decision.revisions) && Object.keys(decision.revisions).length > 0) {
    hardFailures.push(issue('UNAPPLIED_REVISIONS', 'An approval cannot carry unapplied revisions; revise the complete record and approve its new hash.'))
  }
  checkHashFields(decision.sourceHashes, REQUIRED_REVIEW_HASHES, hardFailures, 'sourceHashes')
  return result(hardFailures)
}

export function validatePaletteArtifact(artifact) {
  const hardFailures = []
  if (!isObject(artifact)) return result([issue('INVALID_PALETTE_ARTIFACT', 'Palette artifact must be an object.')])
  if (artifact.schemaVersion !== 'palette-artifact.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Palette schemaVersion must be palette-artifact.v1.'))
  if (!nonEmptyString(artifact.candidateId)) hardFailures.push(issue('MISSING_CANDIDATE_ID', 'candidateId is required.'))
  if (!Number.isInteger(artifact.tmdbId) || artifact.tmdbId < 1) hardFailures.push(issue('INVALID_TMDB_ID', 'tmdbId must be a positive integer.'))
  if (!Array.isArray(artifact.palette) || artifact.palette.length !== 2 || !artifact.palette.every((color) => COLOR_PATTERN.test(color))) hardFailures.push(issue('INVALID_PALETTE', 'palette must contain exactly two six-digit hex colors.'))
  if (!['poster-algorithm', 'human-override'].includes(artifact.method)) hardFailures.push(issue('INVALID_PALETTE_METHOD', 'method must be poster-algorithm or human-override.'))
  if (!isObject(artifact.sourcePosterIdentity) || !Object.hasOwn(artifact.sourcePosterIdentity, 'posterPath')) hardFailures.push(issue('MISSING_POSTER_IDENTITY', 'sourcePosterIdentity.posterPath is required.'))
  if (artifact.sourcePosterHash !== null && !HASH_PATTERN.test(artifact.sourcePosterHash ?? '')) hardFailures.push(issue('INVALID_POSTER_HASH', 'sourcePosterHash must be null or a sha256 hash.'))
  if (!nonEmptyString(artifact.algorithmVersion)) hardFailures.push(issue('MISSING_ALGORITHM_VERSION', 'algorithmVersion is required.'))
  if (artifact.method === 'poster-algorithm') {
    if (!nonEmptyString(artifact.sourcePosterIdentity?.posterPath)) hardFailures.push(issue('MISSING_POSTER_PATH', 'poster-algorithm requires a non-empty source posterPath.'))
    if (!HASH_PATTERN.test(artifact.sourcePosterHash ?? '')) hardFailures.push(issue('MISSING_POSTER_HASH', 'poster-algorithm requires a sourcePosterHash.'))
    if (artifact.override !== null) hardFailures.push(issue('UNEXPECTED_PALETTE_OVERRIDE', 'poster-algorithm artifacts cannot contain override metadata.'))
  }
  if (artifact.method === 'human-override') {
    if (!isObject(artifact.override)) hardFailures.push(issue('MISSING_PALETTE_OVERRIDE', 'human-override requires override metadata.'))
    else {
      if (!nonEmptyString(artifact.override.reviewer) || !validDateTime(artifact.override.reviewedAt) || !nonEmptyString(artifact.override.notes)) hardFailures.push(issue('INVALID_PALETTE_OVERRIDE', 'Override reviewer, reviewedAt, and notes are required.'))
      if (!HASH_PATTERN.test(artifact.override.replacesPaletteArtifactHash ?? '')) hardFailures.push(issue('INVALID_PALETTE_OVERRIDE_HASH', 'Override must bind the replaced palette artifact hash.'))
    }
  }
  return result(hardFailures)
}

export function validateEditorialArtifact(artifact, boundArtifacts = {}) {
  const hardFailures = []
  const reviewFlags = []
  if (!isObject(artifact)) return result([issue('INVALID_EDITORIAL_ARTIFACT', 'Editorial artifact must be an object.')])
  if (artifact.schemaVersion !== 'editorial-artifact.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Editorial artifact schemaVersion must be editorial-artifact.v1.'))
  if (!nonEmptyString(artifact.candidateId) || !Number.isInteger(artifact.tmdbId)) hardFailures.push(issue('INVALID_EDITORIAL_IDENTITY', 'Editorial artifact candidateId and tmdbId are required.'))
  const outputValidation = validateEditorialOutput(artifact.output)
  appendValidation(hardFailures, outputValidation, 'OUTPUT')
  reviewFlags.push(...outputValidation.reviewFlags)
  if (artifact.output?.movie?.candidateId !== artifact.candidateId || artifact.output?.movie?.tmdbId !== artifact.tmdbId) hardFailures.push(issue('EDITORIAL_OUTPUT_IDENTITY_MISMATCH', 'Editorial output identity must match its artifact envelope.'))
  checkHashFields(artifact.sourceHashes, ['semanticArtifact', 'evidencePacket', 'factsRecord'], hardFailures, 'sourceHashes')
  for (const field of ['semanticArtifact', 'evidencePacket', 'factsRecord']) {
    if (boundArtifacts[field] && artifact.sourceHashes?.[field] !== hashArtifact(boundArtifacts[field])) hardFailures.push(issue('EDITORIAL_SOURCE_HASH_MISMATCH', `Editorial ${field} binding is stale.`, { field }))
  }
  const voiceFlags = checkEditorialVoice(artifact.output?.copy)
  if (voiceFlags.length) hardFailures.push(issue('EDITORIAL_VOICE_REVIEW_REQUIRED', 'Editorial voice checks must pass before production eligibility.', { flags: voiceFlags }))
  return result(hardFailures, reviewFlags)
}

export function validateCriticArtifact(artifact, boundArtifacts = {}) {
  const hardFailures = []
  if (!isObject(artifact)) return result([issue('INVALID_CRITIC_ARTIFACT', 'Critic artifact must be an object.')])
  if (artifact.schemaVersion !== 'critic-artifact.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Critic artifact schemaVersion must be critic-artifact.v1.'))
  if (!nonEmptyString(artifact.candidateId) || !Number.isInteger(artifact.tmdbId)) hardFailures.push(issue('INVALID_CRITIC_IDENTITY', 'Critic artifact candidateId and tmdbId are required.'))
  appendValidation(hardFailures, validateCriticOutput(artifact.output), 'OUTPUT')
  if (artifact.output?.movie?.candidateId !== artifact.candidateId || artifact.output?.movie?.tmdbId !== artifact.tmdbId) hardFailures.push(issue('CRITIC_OUTPUT_IDENTITY_MISMATCH', 'Critic output identity must match its artifact envelope.'))
  checkHashFields(artifact.sourceHashes, ['semanticArtifact', 'evidencePacket', 'factsRecord', 'editorialArtifact'], hardFailures, 'sourceHashes')
  for (const field of ['semanticArtifact', 'evidencePacket', 'factsRecord', 'editorialArtifact']) {
    if (boundArtifacts[field] && artifact.sourceHashes?.[field] !== hashArtifact(boundArtifacts[field])) hardFailures.push(issue('CRITIC_SOURCE_HASH_MISMATCH', `Critic ${field} binding is stale.`, { field }))
  }
  if (artifact.independence?.writerHiddenReasoningProvided !== false) hardFailures.push(issue('CRITIC_INDEPENDENCE_VIOLATION', 'Critic execution must explicitly exclude writer hidden reasoning.'))
  const assessments = Object.values(artifact.output?.copyAssessment ?? {})
  if (artifact.output?.verdict === 'approve_for_review' && assessments.includes('fail')) hardFailures.push(issue('CRITIC_VERDICT_ASSESSMENT_CONTRADICTION', 'approve_for_review cannot contain a failing copy assessment.'))
  if (artifact.output?.verdict === 'candidate_for_auto_accept') {
    if (assessments.length === 0 || assessments.some((assessment) => assessment !== 'pass')) hardFailures.push(issue('CRITIC_AUTO_ACCEPT_REQUIRES_ALL_PASS', 'candidate_for_auto_accept requires every copy assessment to pass.'))
    if ((artifact.output?.issues?.length ?? 0) !== 0) hardFailures.push(issue('CRITIC_AUTO_ACCEPT_REQUIRES_NO_ISSUES', 'candidate_for_auto_accept requires an empty issues array.'))
  }
  return result(hardFailures)
}

function artifactIdentity(name, artifact) {
  if (name === 'semanticArtifact') return artifact?.movie
  if (name === 'editorialArtifact' || name === 'criticArtifact') return artifact
  if (name === 'productionRecord') return artifact
  return artifact
}

export function validateCrossArtifactIdentity(artifacts) {
  const hardFailures = []
  if (!isObject(artifacts)) return result([issue('INVALID_ARTIFACT_SET', 'Artifacts must be an object.')])
  const identities = Object.entries(artifacts).filter(([, artifact]) => artifact !== null && artifact !== undefined).map(([name, artifact]) => ({ name, identity: artifactIdentity(name, artifact) }))
  const reference = identities.find(({ identity }) => nonEmptyString(identity?.candidateId) && Number.isInteger(identity?.tmdbId))
  if (!reference) return result([issue('MISSING_REFERENCE_IDENTITY', 'No complete candidateId/TMDB identity was supplied.')])
  for (const { name, identity } of identities) {
    if (identity?.candidateId !== reference.identity.candidateId || identity?.tmdbId !== reference.identity.tmdbId) {
      hardFailures.push(issue('CROSS_ARTIFACT_IDENTITY_MISMATCH', `${name} does not match ${reference.name}.`, { artifact: name }))
    }
  }
  for (const name of ['editorialArtifact', 'criticArtifact']) {
    const artifact = artifacts[name]
    if (artifact && (artifact.output?.movie?.candidateId !== artifact.candidateId || artifact.output?.movie?.tmdbId !== artifact.tmdbId)) hardFailures.push(issue('CROSS_ARTIFACT_IDENTITY_MISMATCH', `${name} output identity does not match its envelope.`, { artifact: name }))
  }
  const productionRecord = artifacts.productionRecord
  if (productionRecord && (productionRecord.curatedMovie?.tmdbId !== reference.identity.tmdbId || productionRecord.facts?.tmdbId !== reference.identity.tmdbId)) hardFailures.push(issue('PRODUCTION_RECORD_TMDB_MISMATCH', 'Curated and factual TMDB IDs must match the artifact identity.'))
  return result(hardFailures)
}

export function validateApprovalFreshness(decision, actualHashes) {
  const hardFailures = []
  appendValidation(hardFailures, validateHumanReviewDecision(decision), 'HUMAN_REVIEW')
  if (!isObject(actualHashes)) hardFailures.push(issue('MISSING_ACTUAL_HASHES', 'Actual artifact hashes are required.'))
  else {
    for (const field of REQUIRED_REVIEW_HASHES) {
      if (decision?.sourceHashes?.[field] !== actualHashes[field]) hardFailures.push(issue('STALE_APPROVAL', `Human approval is stale for ${field}.`, { field }))
    }
  }
  return result(hardFailures)
}

export function getActualReviewHashes(record, artifacts) {
  return {
    semanticArtifact: hashArtifact(artifacts.semanticArtifact),
    evidencePacket: hashArtifact(artifacts.evidencePacket),
    factsRecord: hashArtifact(artifacts.factsRecord),
    editorialArtifact: hashArtifact(artifacts.editorialArtifact),
    criticArtifact: hashArtifact(artifacts.criticArtifact),
    paletteArtifact: hashArtifact(artifacts.paletteArtifact),
    completeRecord: hashReviewedProductionBytes(record),
  }
}

function runtimeFactsFromArtifact(factsRecord) {
  return Object.fromEntries(['tmdbId', 'title', 'year', 'director', 'countries', 'spokenLanguages', 'genres', 'runtimeMinutes', 'posterPath'].map((field) => [field, factsRecord?.[field]]))
}

export function validateProductionRecord(record, artifacts = {}) {
  const hardFailures = []
  const reviewFlags = []
  if (!isObject(record)) return result([issue('INVALID_PRODUCTION_RECORD', 'Production record must be an object.')])
  if (record.schemaVersion !== 'production-record.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Production record schemaVersion must be production-record.v1.'))
  if (!nonEmptyString(record.candidateId)) hardFailures.push(issue('MISSING_CANDIDATE_ID', 'candidateId is required.'))
  if (!Number.isInteger(record.tmdbId) || record.tmdbId < 1) hardFailures.push(issue('INVALID_TMDB_ID', 'tmdbId must be a positive integer.'))
  appendValidation(hardFailures, validateCuratedMovie(record.curatedMovie), 'CURATED')
  appendValidation(hardFailures, validateMovieFacts(record.facts), 'FACTS')
  checkHashFields(record.provenance, REQUIRED_PRODUCTION_PROVENANCE, hardFailures, 'provenance')

  const requiredArtifacts = ['promotionCandidate', 'semanticArtifact', 'evidencePacket', 'factsRecord', 'editorialArtifact', 'criticArtifact', 'paletteArtifact', 'humanReviewDecision']
  for (const name of requiredArtifacts) if (!artifacts[name]) hardFailures.push(issue('MISSING_BOUND_ARTIFACT', `${name} is required to validate a production record.`, { artifact: name }))
  if (artifacts.promotionCandidate) appendValidation(hardFailures, validatePromotionCandidate(artifacts.promotionCandidate), 'PROMOTION_CANDIDATE')
  if (artifacts.semanticArtifact) appendValidation(hardFailures, validateSemanticOutput(artifacts.semanticArtifact), 'SEMANTIC')
  if (artifacts.editorialArtifact) {
    const editorialValidation = validateEditorialArtifact(artifacts.editorialArtifact, artifacts)
    appendValidation(hardFailures, editorialValidation, 'EDITORIAL')
    reviewFlags.push(...editorialValidation.reviewFlags)
  }
  if (artifacts.criticArtifact) {
    appendValidation(hardFailures, validateCriticArtifact(artifacts.criticArtifact, artifacts), 'CRITIC')
    if (!ACCEPTABLE_CRITIC_VERDICTS.has(artifacts.criticArtifact.output?.verdict)) hardFailures.push(issue('CRITIC_NOT_ACCEPTED_FOR_HUMAN_REVIEW', 'Critic verdict must be approve_for_review or candidate_for_auto_accept.'))
  }
  if (artifacts.paletteArtifact) appendValidation(hardFailures, validatePaletteArtifact(artifacts.paletteArtifact), 'PALETTE')
  if (artifacts.humanReviewDecision) {
    appendValidation(hardFailures, validateHumanReviewDecision(artifacts.humanReviewDecision), 'HUMAN_REVIEW')
    if (artifacts.humanReviewDecision.decision !== 'approve') hardFailures.push(issue('HUMAN_APPROVAL_REQUIRED', 'Only an explicit approve decision authorizes promotion.'))
  }

  const identityArtifacts = {
    promotionCandidate: artifacts.promotionCandidate,
    semanticArtifact: artifacts.semanticArtifact,
    evidencePacket: artifacts.evidencePacket,
    factsRecord: artifacts.factsRecord,
    editorialArtifact: artifacts.editorialArtifact,
    criticArtifact: artifacts.criticArtifact,
    paletteArtifact: artifacts.paletteArtifact,
    humanReviewDecision: artifacts.humanReviewDecision,
    productionRecord: record,
  }
  appendValidation(hardFailures, validateCrossArtifactIdentity(identityArtifacts), 'IDENTITY')

  if (requiredArtifacts.every((name) => artifacts[name])) {
    const expectedProvenance = {
      promotionCandidateHash: hashArtifact(artifacts.promotionCandidate),
      semanticArtifactHash: hashArtifact(artifacts.semanticArtifact),
      evidencePacketHash: hashArtifact(artifacts.evidencePacket),
      factsRecordHash: hashArtifact(artifacts.factsRecord),
      editorialArtifactHash: hashArtifact(artifacts.editorialArtifact),
      criticArtifactHash: hashArtifact(artifacts.criticArtifact),
      paletteArtifactHash: hashArtifact(artifacts.paletteArtifact),
      humanReviewDecisionHash: hashArtifact(artifacts.humanReviewDecision),
    }
    for (const [field, expectedHash] of Object.entries(expectedProvenance)) {
      if (record.provenance?.[field] !== expectedHash) hardFailures.push(issue('PROVENANCE_HASH_MISMATCH', `${field} does not match the supplied artifact.`, { field }))
    }
    const actualReviewHashes = getActualReviewHashes(record, artifacts)
    appendValidation(hardFailures, validateApprovalFreshness(artifacts.humanReviewDecision, actualReviewHashes), 'APPROVAL')
    for (const field of ['semanticArtifact', 'evidencePacket', 'factsRecord']) {
      if (artifacts.promotionCandidate.sourceHashes?.[field] !== actualReviewHashes[field]) hardFailures.push(issue('PROMOTION_CANDIDATE_SOURCE_HASH_MISMATCH', `Promotion candidate ${field} hash is stale.`, { field }))
    }
    if (record.curatedMovie?.palette && stableSerialize(record.curatedMovie.palette) !== stableSerialize(artifacts.paletteArtifact.palette)) hardFailures.push(issue('PALETTE_VALUE_MISMATCH', 'Curated palette must equal the approved palette artifact.'))
    if (artifacts.paletteArtifact.sourcePosterIdentity?.posterPath !== artifacts.factsRecord.posterPath) hardFailures.push(issue('PALETTE_POSTER_IDENTITY_MISMATCH', 'Palette poster identity must match the approved facts posterPath.'))
    if (record.curatedMovie && artifacts.editorialArtifact?.output?.copy) {
      for (const field of ['description', 'whyWatch', 'curiosityHook', 'vibeSummary']) {
        if (record.curatedMovie[field] !== artifacts.editorialArtifact.output.copy[field]) hardFailures.push(issue('EDITORIAL_VALUE_MISMATCH', `curatedMovie.${field} must equal the approved editorial artifact.`, { field }))
      }
    }
    if (record.facts && stableSerialize(record.facts) !== stableSerialize(runtimeFactsFromArtifact(artifacts.factsRecord))) hardFailures.push(issue('FACTS_VALUE_MISMATCH', 'Production facts must equal the runtime factual fields in the approved facts artifact.'))
    const semantic = artifacts.semanticArtifact?.classification
    if (semantic && record.curatedMovie) {
      for (const field of ['moods', 'situations', 'filterLanguages', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) {
        if (stableSerialize(record.curatedMovie[field]) !== stableSerialize(semantic[field])) hardFailures.push(issue('SEMANTIC_VALUE_MISMATCH', `curatedMovie.${field} must equal the accepted semantic artifact.`, { field }))
      }
    }
  }
  return result(hardFailures, reviewFlags)
}

function duplicateValues(records, field) {
  const counts = new Map()
  for (const record of records) counts.set(record[field], (counts.get(record[field]) ?? 0) + 1)
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value)
}

function validateRuntimeSourceHashes(value, prefix) {
  const hardFailures = []
  checkHashFields(value, REQUIRED_RUNTIME_SOURCE_HASHES, hardFailures, prefix)
  if (isObject(value)) {
    const extras = Object.keys(value).filter((field) => !REQUIRED_RUNTIME_SOURCE_HASHES.includes(field))
    if (extras.length) hardFailures.push(issue('UNKNOWN_RUNTIME_SOURCE_HASH', `${prefix} contains unknown runtime source hash names.`, { fields: extras }))
  }
  return result(hardFailures)
}

export function assemblePromotionTransaction({ promotionVersion, baseline, candidates, proposedSourceHashes }) {
  const hardFailures = []
  const accepted = []
  if (!nonEmptyString(promotionVersion)) hardFailures.push(issue('MISSING_PROMOTION_VERSION', 'promotionVersion is required.'))
  if (!isObject(baseline) || !Array.isArray(baseline.records)) hardFailures.push(issue('INVALID_BASELINE', 'baseline.records is required.'))
  appendValidation(hardFailures, validateRuntimeSourceHashes(baseline?.sourceHashes, 'baseline.sourceHashes'), 'BASELINE')
  appendValidation(hardFailures, validateRuntimeSourceHashes(proposedSourceHashes, 'proposedSourceHashes'), 'PROPOSED')
  if (!Array.isArray(candidates)) hardFailures.push(issue('INVALID_CANDIDATES', 'candidates must be an array.'))
  const baselineRecords = Array.isArray(baseline?.records) ? baseline.records : []
  const candidateEntries = Array.isArray(candidates) ? candidates : []
  const baselineIds = new Set(baselineRecords.map((record) => record.id))
  const baselineTmdbIds = new Set(baselineRecords.map((record) => record.tmdbId))
  const acceptedIds = new Set()
  const acceptedTmdbIds = new Set()
  const acceptedCandidateIds = new Set()

  for (const [index, entry] of candidateEntries.entries()) {
    const validation = validateProductionRecord(entry.record, entry.artifacts)
    for (const failure of validation.hardFailures) hardFailures.push({ ...failure, candidateIndex: index })
    const id = entry.record?.curatedMovie?.id
    const tmdbId = entry.record?.tmdbId
    const candidateId = entry.record?.candidateId
    if (acceptedCandidateIds.has(candidateId)) hardFailures.push(issue('CANDIDATE_ID_COLLISION', `Candidate ID collision: ${String(candidateId)}.`, { candidateIndex: index, candidateId }))
    if (baselineIds.has(id) || acceptedIds.has(id)) hardFailures.push(issue('LOCAL_ID_COLLISION', `Local ID collision: ${String(id)}.`, { candidateIndex: index, id }))
    if (baselineTmdbIds.has(tmdbId) || acceptedTmdbIds.has(tmdbId)) hardFailures.push(issue('TMDB_ID_COLLISION', `TMDB ID collision: ${String(tmdbId)}.`, { candidateIndex: index, tmdbId }))
    acceptedIds.add(id)
    acceptedTmdbIds.add(tmdbId)
    acceptedCandidateIds.add(candidateId)
    accepted.push({
      candidateId: entry.record?.candidateId,
      tmdbId,
      id,
      productionRecordHash: hashArtifact(entry.record),
      humanReviewDecisionHash: hashArtifact(entry.artifacts?.humanReviewDecision),
      sourceHashes: entry.record?.provenance ?? {},
    })
  }

  const proposedRuntime = [
    ...baselineRecords,
    ...accepted.map((entry) => ({ id: entry.id, tmdbId: entry.tmdbId, recordHash: entry.productionRecordHash })),
  ]
  const duplicateLocalIds = duplicateValues(proposedRuntime, 'id')
  const duplicateTmdbIds = duplicateValues(proposedRuntime, 'tmdbId')
  if (duplicateLocalIds.length && !hardFailures.some((failure) => failure.code === 'LOCAL_ID_COLLISION')) hardFailures.push(issue('LOCAL_ID_COLLISION', 'Proposed runtime contains duplicate local IDs.', { values: duplicateLocalIds }))
  if (duplicateTmdbIds.length && !hardFailures.some((failure) => failure.code === 'TMDB_ID_COLLISION')) hardFailures.push(issue('TMDB_ID_COLLISION', 'Proposed runtime contains duplicate TMDB IDs.', { values: duplicateTmdbIds }))
  const transaction = {
    schemaVersion: 'promotion-transaction.v1',
    promotionVersion,
    baseline,
    proposedSourceHashes,
    accepted,
    proposedRuntime,
    identityReconciliation: {
      duplicateLocalIds,
      duplicateTmdbIds,
      existingRuntimeIdsPreserved: baselineRecords.every((record, index) => stableSerialize(record) === stableSerialize(proposedRuntime[index])),
    },
    beforeCount: baselineRecords.length,
    afterCount: proposedRuntime.length,
    validationResult: { ok: hardFailures.length === 0, hardFailures },
  }
  return transaction
}

export function validatePromotionTransaction(transaction) {
  const hardFailures = []
  if (!isObject(transaction)) return result([issue('INVALID_PROMOTION_TRANSACTION', 'Promotion transaction must be an object.')])
  if (transaction.schemaVersion !== 'promotion-transaction.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Transaction schemaVersion must be promotion-transaction.v1.'))
  if (!Array.isArray(transaction.baseline?.records) || !Array.isArray(transaction.accepted) || !Array.isArray(transaction.proposedRuntime)) hardFailures.push(issue('MISSING_TRANSACTION_COLLECTION', 'Baseline, accepted, and proposed runtime collections are required.'))
  const baselineRecords = transaction.baseline?.records ?? []
  const proposedRuntime = transaction.proposedRuntime ?? []
  if (!nonEmptyString(transaction.promotionVersion)) hardFailures.push(issue('MISSING_PROMOTION_VERSION', 'promotionVersion is required.'))
  if (!nonEmptyString(transaction.baseline?.commit)) hardFailures.push(issue('MISSING_BASELINE_COMMIT', 'baseline.commit is required.'))
  appendValidation(hardFailures, validateRuntimeSourceHashes(transaction.baseline?.sourceHashes, 'baseline.sourceHashes'), 'BASELINE')
  appendValidation(hardFailures, validateRuntimeSourceHashes(transaction.proposedSourceHashes, 'proposedSourceHashes'), 'PROPOSED')
  for (const [index, record] of baselineRecords.entries()) if (!nonEmptyString(record?.id) || !Number.isInteger(record?.tmdbId) || !HASH_PATTERN.test(record?.recordHash ?? '')) hardFailures.push(issue('INVALID_BASELINE_RECORD', `baseline.records[${index}] is invalid.`))
  for (const [index, accepted] of (transaction.accepted ?? []).entries()) {
    if (!nonEmptyString(accepted?.candidateId) || !nonEmptyString(accepted?.id) || !Number.isInteger(accepted?.tmdbId)) hardFailures.push(issue('INVALID_ACCEPTED_IDENTITY', `accepted[${index}] has an invalid identity.`))
    if (!HASH_PATTERN.test(accepted?.productionRecordHash ?? '') || !HASH_PATTERN.test(accepted?.humanReviewDecisionHash ?? '')) hardFailures.push(issue('INVALID_ACCEPTED_HASH', `accepted[${index}] has an invalid record or decision hash.`))
    checkHashFields(accepted?.sourceHashes, REQUIRED_PRODUCTION_PROVENANCE, hardFailures, `accepted[${index}].sourceHashes`)
  }
  if (transaction.beforeCount !== baselineRecords.length) hardFailures.push(issue('INVALID_BEFORE_COUNT', 'beforeCount must derive from baseline records.'))
  if (transaction.afterCount !== proposedRuntime.length) hardFailures.push(issue('INVALID_AFTER_COUNT', 'afterCount must derive from proposed runtime records.'))
  if (transaction.afterCount !== transaction.beforeCount + (transaction.accepted?.length ?? 0)) hardFailures.push(issue('INVALID_ACCEPTED_COUNT', 'afterCount must equal beforeCount plus accepted records.'))
  if (duplicateValues(proposedRuntime, 'id').length) hardFailures.push(issue('DUPLICATE_LOCAL_ID', 'Proposed runtime contains duplicate local IDs.'))
  if (duplicateValues(proposedRuntime, 'tmdbId').length) hardFailures.push(issue('DUPLICATE_TMDB_ID', 'Proposed runtime contains duplicate TMDB IDs.'))
  if (duplicateValues(transaction.accepted ?? [], 'candidateId').length) hardFailures.push(issue('DUPLICATE_CANDIDATE_ID', 'Accepted transaction entries contain duplicate candidate IDs.'))
  const derivedDuplicateIds = duplicateValues(proposedRuntime, 'id')
  const derivedDuplicateTmdbIds = duplicateValues(proposedRuntime, 'tmdbId')
  if (stableSerialize(transaction.identityReconciliation?.duplicateLocalIds) !== stableSerialize(derivedDuplicateIds) || stableSerialize(transaction.identityReconciliation?.duplicateTmdbIds) !== stableSerialize(derivedDuplicateTmdbIds)) hardFailures.push(issue('INVALID_IDENTITY_RECONCILIATION', 'Identity reconciliation must derive from proposed runtime identities.'))
  if (!baselineRecords.every((record, index) => stableSerialize(record) === stableSerialize(proposedRuntime[index]))) hardFailures.push(issue('EXISTING_RUNTIME_ID_NOT_PRESERVED', 'Every baseline identity and record hash must be preserved exactly.'))
  if (transaction.identityReconciliation?.existingRuntimeIdsPreserved !== baselineRecords.every((record, index) => stableSerialize(record) === stableSerialize(proposedRuntime[index]))) hardFailures.push(issue('INVALID_PRESERVATION_SUMMARY', 'existingRuntimeIdsPreserved must derive from baseline comparison.'))
  for (const accepted of transaction.accepted ?? []) {
    const proposed = proposedRuntime.find((record) => record.id === accepted.id && record.tmdbId === accepted.tmdbId)
    if (!proposed || proposed.recordHash !== accepted.productionRecordHash) hardFailures.push(issue('ACCEPTED_RECORD_NOT_IN_PROPOSED_RUNTIME', `Accepted record ${accepted.candidateId} is not represented exactly in proposed runtime.`))
  }
  if (transaction.validationResult?.ok !== true || (transaction.validationResult?.hardFailures?.length ?? 0) > 0) hardFailures.push(issue('FAILED_DRY_RUN', 'Transaction dry-run validation must pass before promotion.'))
  return result(hardFailures)
}

export function buildPromotionManifest({ transaction, candidateCohortHash, candidateRoster, rejected = [], deferred = [], validationReportHash, benchmarkReportHashes = [], createdAt }) {
  const sortedRoster = [...candidateRoster].sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'))
  return {
    schemaVersion: 'promotion-manifest.v1',
    promotionVersion: transaction.promotionVersion,
    baselineCommit: transaction.baseline.commit,
    baselineRuntimeCount: transaction.baseline.records.length,
    candidateCohortHash,
    candidateRosterHash: hashArtifact(sortedRoster),
    candidateRoster: sortedRoster,
    accepted: transaction.accepted,
    rejected,
    deferred,
    unchanged: transaction.baseline.records,
    outputRuntimeCount: transaction.proposedRuntime.length,
    sourceHashes: transaction.baseline.sourceHashes,
    outputHashes: transaction.proposedSourceHashes,
    validationReportHash,
    benchmarkReportHashes,
    createdAt,
  }
}

export function validatePromotionManifest(manifest, authoritative = {}) {
  const hardFailures = []
  if (!isObject(manifest)) return result([issue('INVALID_PROMOTION_MANIFEST', 'Promotion manifest must be an object.')])
  if (manifest.schemaVersion !== 'promotion-manifest.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Manifest schemaVersion must be promotion-manifest.v1.'))
  for (const field of ['promotionVersion', 'baselineCommit']) if (!nonEmptyString(manifest[field])) hardFailures.push(issue('MISSING_MANIFEST_FIELD', `${field} is required.`, { field }))
  for (const field of ['accepted', 'rejected', 'deferred', 'unchanged', 'benchmarkReportHashes']) if (!Array.isArray(manifest[field])) hardFailures.push(issue('MISSING_MANIFEST_COLLECTION', `${field} must be an array.`, { field }))
  if (!HASH_PATTERN.test(manifest.candidateCohortHash ?? '')) hardFailures.push(issue('INVALID_COHORT_HASH', 'candidateCohortHash must be a sha256 hash.'))
  if (!Array.isArray(manifest.candidateRoster)) hardFailures.push(issue('MISSING_CANDIDATE_ROSTER', 'candidateRoster must be an array.'))
  const roster = manifest.candidateRoster ?? []
  if (manifest.candidateRosterHash !== hashArtifact(roster)) hardFailures.push(issue('INVALID_CANDIDATE_ROSTER_HASH', 'candidateRosterHash must match the canonical persisted roster bytes.'))
  const sortedRoster = [...roster].sort((left, right) => String(left?.candidateId).localeCompare(String(right?.candidateId), 'en'))
  if (stableSerialize(roster) !== stableSerialize(sortedRoster)) hardFailures.push(issue('UNSORTED_CANDIDATE_ROSTER', 'candidateRoster must be sorted by candidateId.'))
  if (authoritative.candidateCohortHash && manifest.candidateCohortHash !== authoritative.candidateCohortHash) hardFailures.push(issue('CANDIDATE_COHORT_HASH_MISMATCH', 'Manifest cohort hash does not match the authoritative cohort.'))
  if (authoritative.candidateRoster && stableSerialize(roster) !== stableSerialize(authoritative.candidateRoster)) hardFailures.push(issue('CANDIDATE_ROSTER_MISMATCH', 'Manifest roster does not match the authoritative cohort roster.'))
  if (!HASH_PATTERN.test(manifest.validationReportHash ?? '')) hardFailures.push(issue('INVALID_VALIDATION_REPORT_HASH', 'validationReportHash must be a sha256 hash.'))
  if (!validDateTime(manifest.createdAt)) hardFailures.push(issue('INVALID_CREATED_AT', 'createdAt must be a valid date-time.'))
  appendValidation(hardFailures, validateRuntimeSourceHashes(manifest.sourceHashes, 'sourceHashes'), 'SOURCE')
  appendValidation(hardFailures, validateRuntimeSourceHashes(manifest.outputHashes, 'outputHashes'), 'OUTPUT')
  for (const [index, benchmarkHash] of (manifest.benchmarkReportHashes ?? []).entries()) if (!HASH_PATTERN.test(benchmarkHash)) hardFailures.push(issue('INVALID_BENCHMARK_HASH', `benchmarkReportHashes[${index}] must be a sha256 hash.`))
  const accepted = manifest.accepted ?? []
  const unchanged = manifest.unchanged ?? []
  if (manifest.baselineRuntimeCount !== unchanged.length) hardFailures.push(issue('INVALID_BASELINE_COUNT', 'baselineRuntimeCount must derive from unchanged baseline records.'))
  if (manifest.outputRuntimeCount !== unchanged.length + accepted.length) hardFailures.push(issue('INVALID_OUTPUT_COUNT', 'outputRuntimeCount must derive from unchanged plus accepted records.'))
  for (const [index, entry] of accepted.entries()) {
    if (!nonEmptyString(entry?.candidateId) || !nonEmptyString(entry?.id) || !Number.isInteger(entry?.tmdbId)) hardFailures.push(issue('INVALID_ACCEPTED_IDENTITY', `accepted[${index}] has an invalid identity.`))
    for (const field of ['productionRecordHash', 'humanReviewDecisionHash']) if (!HASH_PATTERN.test(entry?.[field] ?? '')) hardFailures.push(issue('INVALID_ACCEPTED_HASH', `accepted[${index}].${field} must be a sha256 hash.`, { field }))
    checkHashFields(entry?.sourceHashes, REQUIRED_PRODUCTION_PROVENANCE, hardFailures, `accepted[${index}].sourceHashes`)
  }
  for (const field of ['rejected', 'deferred']) {
    for (const [index, entry] of (manifest[field] ?? []).entries()) {
      if (!nonEmptyString(entry?.candidateId) || !Number.isInteger(entry?.tmdbId) || !nonEmptyString(entry?.reason)) hardFailures.push(issue('INVALID_DISPOSITION', `${field}[${index}] must contain candidateId, tmdbId, and reason.`))
    }
  }
  const dispositions = [
    ...(manifest.accepted ?? []).map((entry) => ({ ...entry, disposition: 'accepted' })),
    ...(manifest.rejected ?? []).map((entry) => ({ ...entry, disposition: 'rejected' })),
    ...(manifest.deferred ?? []).map((entry) => ({ ...entry, disposition: 'deferred' })),
  ]
  const rosterByCandidate = new Map(roster.map((entry) => [entry.candidateId, entry.tmdbId]))
  const dispositionCounts = new Map()
  for (const entry of dispositions) {
    dispositionCounts.set(entry.candidateId, (dispositionCounts.get(entry.candidateId) ?? 0) + 1)
    if (!rosterByCandidate.has(entry.candidateId)) hardFailures.push(issue('DISPOSITION_NOT_IN_ROSTER', `${entry.candidateId} is not in candidateRoster.`))
    else if (rosterByCandidate.get(entry.candidateId) !== entry.tmdbId) hardFailures.push(issue('DISPOSITION_TMDB_ID_MISMATCH', `${entry.candidateId} changed TMDB identity in ${entry.disposition}.`))
  }
  for (const [candidateId, count] of dispositionCounts) if (count > 1) hardFailures.push(issue('DUPLICATE_OR_OVERLAPPING_DISPOSITION', `${candidateId} appears ${count} times across dispositions.`))
  for (const rosterEntry of roster) if (!dispositionCounts.has(rosterEntry.candidateId)) hardFailures.push(issue('CANDIDATE_DISPOSITION_MISSING', `${rosterEntry.candidateId} has no disposition.`))
  if (new Set(roster.map((entry) => entry.candidateId)).size !== roster.length) hardFailures.push(issue('DUPLICATE_CANDIDATE_ROSTER_ENTRY', 'candidateRoster contains duplicate candidate IDs.'))
  if (Object.hasOwn(manifest, 'declaredTargetCount')) hardFailures.push(issue('PLANNING_TARGET_NOT_AUTHORITATIVE', 'A planning target cannot determine deployed count.'))
  const identities = [...unchanged, ...accepted]
  if (duplicateValues(identities, 'id').length) hardFailures.push(issue('DUPLICATE_LOCAL_ID', 'Manifest output identities contain duplicate local IDs.'))
  if (duplicateValues(identities, 'tmdbId').length) hardFailures.push(issue('DUPLICATE_TMDB_ID', 'Manifest output identities contain duplicate TMDB IDs.'))
  return result(hardFailures)
}

export function validateProductionValidationReport(reportValue) {
  const hardFailures = []
  if (!isObject(reportValue)) return result([issue('INVALID_VALIDATION_REPORT', 'Production validation report must be an object.')])
  if (reportValue.schemaVersion !== 'production-validation-report.v1') hardFailures.push(issue('INVALID_SCHEMA_VERSION', 'Validation report schemaVersion must be production-validation-report.v1.'))
  if (!nonEmptyString(reportValue.promotionVersion)) hardFailures.push(issue('MISSING_PROMOTION_VERSION', 'promotionVersion is required.'))
  if (!HASH_PATTERN.test(reportValue.transactionHash ?? '')) hardFailures.push(issue('INVALID_TRANSACTION_HASH', 'transactionHash must be a sha256 hash.'))
  if (!validDateTime(reportValue.generatedAt)) hardFailures.push(issue('INVALID_GENERATED_AT', 'generatedAt must be a valid date-time.'))
  if (!Array.isArray(reportValue.checks) || reportValue.checks.some((check) => !nonEmptyString(check?.name) || typeof check?.ok !== 'boolean')) hardFailures.push(issue('INVALID_VALIDATION_CHECKS', 'checks must contain named boolean results.'))
  const derivedOk = Array.isArray(reportValue.checks) && reportValue.checks.every((check) => check.ok) && Array.isArray(reportValue.hardFailures) && reportValue.hardFailures.length === 0
  if (reportValue.ok !== derivedOk) hardFailures.push(issue('INVALID_VALIDATION_SUMMARY', 'ok must derive from checks and hardFailures.'))
  return result(hardFailures)
}
