export const VALID_VALUES = {
  moods: ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'],
  situations: ['alone', 'date-night', 'friends', 'family', 'easy-watch'],
  pace: ['slow', 'medium', 'fast'],
  emotionalWeight: ['light', 'moderate', 'heavy'],
  attentionDemand: ['easy', 'engaged', 'immersive'],
  discoveryStyle: ['familiar', 'different', 'adventurous'],
  reviewPriority: ['P0', 'P1', 'P2', 'P3', 'P4'],
  reviewStatus: ['needs_review', 'blocked', 'ready_for_review', 'candidate_for_batch_approval'],
}

export const COPY_LIMITS = {
  description: { minChars: 80, maxChars: 220 },
  whyWatch: { minChars: 60, maxChars: 180 },
  curiosityHook: { minChars: 50, maxChars: 170 },
  vibeSummary: { minChars: 45, maxChars: 150 },
}

const REQUIRED_CURATED_FIELDS = [
  'id',
  'tmdbId',
  'moods',
  'situations',
  'filterLanguages',
  'pace',
  'emotionalWeight',
  'attentionDemand',
  'discoveryStyle',
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
  'palette',
]

const REQUIRED_FACT_FIELDS = [
  'tmdbId',
  'title',
  'year',
  'director',
  'countries',
  'spokenLanguages',
  'genres',
  'runtimeMinutes',
  'posterPath',
]

const HARD_META_COPY_PATTERNS = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bI (cannot|can't|generated|was asked)\b/i,
  /\bconfidence (score|level)\b/i,
]

const GENERIC_COPY_PATTERNS = [
  /\btour de force\b/i,
  /\brich tapestry\b/i,
  /\bmasterful blend\b/i,
  /\bstellar ensemble\b/i,
  /\bheartwarming tale\b/i,
  /\ba love letter to\b/i,
  /\bdeeply moving\b/i,
  /\bbreathtaking cinematography\b/i,
  /\bkeeps you on the edge of your seat\b/i,
  /\bmust[- ]watch\b/i,
  /\bfor fans of cinema\b/i,
  /\brollercoaster of emotions\b/i,
  /\bdelves into\b/i,
  /\bexplores themes of\b/i,
  /\bat its core\b/i,
  /\btestament to\b/i,
  /\bwill leave you\b/i,
]

export const SPOILER_PATTERNS = [
  /\bending reveals\b/i,
  /\bfinal twist\b/i,
  /\bturns out\b/i,
  /\bin the end\b/i,
]

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field)
}

function addIssue(issues, severity, code, message, details = {}) {
  issues.push({ severity, code, message, ...details })
}

function addHardFailure(issues, code, message, details = {}) {
  addIssue(issues, 'hard_fail', code, message, details)
}

function addReviewFlag(issues, code, message, details = {}) {
  addIssue(issues, 'review', code, message, details)
}

function validateString(value, field, issues) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', `${field} must be a non-empty string.`, { field })
  }
}

function validateInteger(value, field, issues, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) {
    addHardFailure(issues, 'INVALID_NUMBER', `${field} must be an integer >= ${minimum}.`, { field })
  }
}

function validateStringArray(value, field, issues, { minItems = 1, allowed = null } = {}) {
  if (!Array.isArray(value) || value.length < minItems) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', `${field} must be a non-empty array.`, { field })
    return
  }

  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      addHardFailure(issues, 'INVALID_ARRAY_VALUE', `${field} contains an invalid value.`, { field, value: item })
    } else if (allowed && !allowed.includes(item)) {
      addHardFailure(issues, 'INVALID_ENUM', `${field} contains invalid enum value "${item}".`, { field, value: item })
    }
  }
}

function validateEnum(value, field, allowed, issues) {
  if (!allowed.includes(value)) {
    addHardFailure(issues, 'INVALID_ENUM', `${field} must be one of: ${allowed.join(', ')}.`, { field, value })
  }
}

function validatePalette(value, issues) {
  if (!Array.isArray(value) || value.length !== 2) {
    addHardFailure(issues, 'MALFORMED_PALETTE', 'palette must be a two-color tuple.', { field: 'palette' })
    return
  }

  for (const color of value) {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      addHardFailure(issues, 'MALFORMED_PALETTE', `Invalid palette color: ${String(color)}.`, { field: 'palette', value: color })
    }
  }
}

function validateCopyField(copy, field, issues, reviewFlags = []) {
  validateString(copy, field, issues)
  if (typeof copy !== 'string') return

  const trimmed = copy.trim()
  const limits = COPY_LIMITS[field]
  if (trimmed.length < limits.minChars) {
    addHardFailure(issues, 'COPY_TOO_SHORT', `${field} is shorter than ${limits.minChars} characters.`, { field })
  }
  if (trimmed.length > limits.maxChars) {
    addHardFailure(issues, 'COPY_TOO_LONG', `${field} is longer than ${limits.maxChars} characters.`, { field })
  }
  if (/\bTODO\b|placeholder/i.test(trimmed)) {
    addHardFailure(issues, 'PLACEHOLDER_COPY', `${field} contains placeholder text.`, { field })
  }
  if (SPOILER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    addReviewFlag(reviewFlags, 'SPOILER_PATTERN_REVIEW', `${field} contains a spoiler-sensitive phrase that needs semantic review.`, { field })
  }
  if (HARD_META_COPY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    addHardFailure(issues, 'MODEL_OR_META_LANGUAGE', `${field} contains hard-invalid model or meta language.`, { field })
  }
  if (GENERIC_COPY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    addReviewFlag(reviewFlags, 'GENERIC_LANGUAGE_REVIEW', `${field} contains generic critical language that needs review.`, { field })
  }
}

function validateEvidenceItem(item, field, issues, { requireStructuredGrounding = false } = {}) {
  if (!isObject(item)) {
    addHardFailure(issues, 'INVALID_SEMANTIC_EVIDENCE', `${field} must be a structured evidence object.`, { field })
    return
  }
  validateString(item.rationale, `${field}.rationale`, issues)
  if (typeof item.rationale === 'string' && item.rationale.trim().length < 12) {
    addHardFailure(issues, 'EVIDENCE_RATIONALE_TOO_SHORT', `${field}.rationale must be a meaningful explanation of at least 12 characters.`, { field: `${field}.rationale` })
  }
  validateStringArray(item.sourceRefs, `${field}.sourceRefs`, issues)
  if (!requireStructuredGrounding) return

  if (!isObject(item.grounding)) {
    addHardFailure(issues, 'MISSING_EVIDENCE_GROUNDING', `${field}.grounding is required for semantic-output.v2.`, { field })
    return
  }
  validateEnum(item.grounding.mode, `${field}.grounding.mode`, ['direct', 'supported-inference'], issues)
  if (!Array.isArray(item.grounding.cues)) {
    addHardFailure(issues, 'INVALID_EVIDENCE_CUES', `${field}.grounding.cues must be an array.`, { field })
    return
  }
  for (const [index, cue] of item.grounding.cues.entries()) {
    if (!isObject(cue)) {
      addHardFailure(issues, 'EVIDENCE_CUE_NOT_OBJECT', `${field}.grounding.cues[${index}] must be an object.`, { field: `${field}.grounding.cues[${index}]` })
      continue
    }
    if (typeof cue.sourceRef !== 'string' || cue.sourceRef.trim().length === 0) addHardFailure(issues, 'EVIDENCE_CUE_SOURCE_REF_INVALID', `${field}.grounding.cues[${index}].sourceRef must be a non-empty string.`, { field: `${field}.grounding.cues[${index}].sourceRef` })
    if (typeof cue.cue !== 'string' || cue.cue.trim().length < 8) addHardFailure(issues, 'EVIDENCE_CUE_TOO_SHORT', `${field}.grounding.cues[${index}].cue must be a specific factual phrase of at least 8 characters.`, { field: `${field}.grounding.cues[${index}].cue` })
  }
  if (item.grounding.mode === 'direct' && item.grounding.cues.length < 1) addHardFailure(issues, 'TOO_FEW_DIRECT_EVIDENCE_CUES', `${field} direct evidence requires at least one grounded factual cue.`, { field })
  if (item.grounding.mode === 'supported-inference') {
    if (item.grounding.cues.length < 2) addHardFailure(issues, 'TOO_FEW_SUPPORTED_INFERENCE_CUES', `${field} supported inference requires multiple grounded factual cues.`, { field })
    if (typeof item.grounding.bridge !== 'string' || item.grounding.bridge.trim().length === 0) addHardFailure(issues, 'MISSING_SUPPORTED_INFERENCE_BRIDGE', `${field} supported inference requires a bridge to the taxonomy judgment.`, { field: `${field}.grounding.bridge` })
    else if (item.grounding.bridge.trim().length < 12) addHardFailure(issues, 'EVIDENCE_BRIDGE_TOO_SHORT', `${field}.grounding.bridge must be a meaningful explanation of at least 12 characters.`, { field: `${field}.grounding.bridge` })
  }
}

function validateTagEvidence(evidence, field, selectedValues, issues, options) {
  if (!isObject(evidence)) {
    addHardFailure(issues, 'INVALID_SEMANTIC_EVIDENCE', `${field} evidence must map each selected value to evidence.`, { field })
    return
  }
  for (const value of selectedValues) validateEvidenceItem(evidence[value], `${field}.${value}`, issues, options)
}

function validateBoundaryFlags(flags, issues) {
  if (!Array.isArray(flags)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'boundaryFlags must be an array.', { field: 'boundaryFlags' })
    return
  }
  for (const [index, flag] of flags.entries()) {
    if (!isObject(flag)) {
      addHardFailure(issues, 'INVALID_BOUNDARY_FLAG', `boundaryFlags[${index}] must be an object.`, { field: 'boundaryFlags' })
      continue
    }
    validateString(flag.code, `boundaryFlags[${index}].code`, issues)
    validateStringArray(flag.fields, `boundaryFlags[${index}].fields`, issues)
    validateString(flag.message, `boundaryFlags[${index}].message`, issues)
    if (typeof flag.message === 'string' && flag.message.trim().length < 12) addHardFailure(issues, 'INVALID_BOUNDARY_FLAG', 'Boundary flag message must be meaningful.', { field: 'boundaryFlags' })
    if (typeof flag.reviewRequired !== 'boolean') addHardFailure(issues, 'INVALID_BOUNDARY_FLAG', 'Boundary flag reviewRequired must be boolean.', { field: 'boundaryFlags' })
  }
}

function validateSelfConfidence(value, issues) {
  if (value === undefined) return
  if (!isObject(value)) {
    addHardFailure(issues, 'INVALID_SELF_CONFIDENCE', 'selfConfidence must be an object when provided.', { field: 'selfConfidence' })
    return
  }
  for (const [field, confidence] of Object.entries(value)) {
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) addHardFailure(issues, 'INVALID_SELF_CONFIDENCE', `${field} self-confidence must be between 0 and 1.`, { field: `selfConfidence.${field}` })
  }
}

function normalizedWords(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

export function isDescriptionHookDuplicate(description, curiosityHook) {
  const descriptionWords = normalizedWords(description)
  const hookWords = normalizedWords(curiosityHook)
  if (descriptionWords.size === 0 || hookWords.size === 0) return false
  const overlap = [...descriptionWords].filter((word) => hookWords.has(word)).length
  const union = new Set([...descriptionWords, ...hookWords]).size
  return overlap / union >= 0.72
}

function validateSpoilerBoundary(value, issues) {
  if (!isObject(value)) {
    addHardFailure(issues, 'INVALID_SPOILER_BOUNDARY', 'writerNotes.spoilerBoundary must be a structured audit object.', { field: 'writerNotes.spoilerBoundary' })
    return
  }
  validateStringArray(value.allowedMaterial, 'writerNotes.spoilerBoundary.allowedMaterial', issues)
  validateStringArray(value.excludedMaterial, 'writerNotes.spoilerBoundary.excludedMaterial', issues)
  validateStringArray(value.sourceRefs, 'writerNotes.spoilerBoundary.sourceRefs', issues)
}

export function validateCandidateBatch(batch) {
  const issues = []

  if (!isObject(batch)) {
    addHardFailure(issues, 'INVALID_BATCH', 'Candidate batch must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags: [] }
  }

  validateString(batch.batchId, 'batchId', issues)
  if (batch.schemaVersion !== 'candidate.v1') {
    addHardFailure(issues, 'INVALID_SCHEMA_VERSION', 'Candidate batch schemaVersion must be candidate.v1.', { field: 'schemaVersion' })
  }

  if (!isObject(batch.sourcePolicy)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'sourcePolicy is required.', { field: 'sourcePolicy' })
  } else {
    validateString(batch.sourcePolicy.description, 'sourcePolicy.description', issues)
    if (!Array.isArray(batch.sourcePolicy.licensingNotes)) {
      addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'sourcePolicy.licensingNotes must be an array.', { field: 'sourcePolicy.licensingNotes' })
    }
  }

  if (!Array.isArray(batch.candidates) || batch.candidates.length === 0) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'candidates must be a non-empty array.', { field: 'candidates' })
    return { ok: issues.length === 0, hardFailures: issues, reviewFlags: [] }
  }

  const candidateIds = new Set()
  const tmdbIds = new Set()

  for (const [index, candidate] of batch.candidates.entries()) {
    const path = `candidates[${index}]`
    if (!isObject(candidate)) {
      addHardFailure(issues, 'INVALID_CANDIDATE', `${path} must be an object.`, { path })
      continue
    }

    validateString(candidate.candidateId, `${path}.candidateId`, issues)
    validateString(candidate.title, `${path}.title`, issues)
    validateInteger(candidate.year, `${path}.year`, issues, 1878)
    validateInteger(candidate.tmdbId, `${path}.tmdbId`, issues)
    validateStringArray(candidate.sourceTags, `${path}.sourceTags`, issues)
    validateString(candidate.inclusionRationale, `${path}.inclusionRationale`, issues)

    if (candidateIds.has(candidate.candidateId)) {
      addHardFailure(issues, 'DUPLICATE_CANDIDATE_ID', `Duplicate candidateId: ${candidate.candidateId}.`, { path, value: candidate.candidateId })
    }
    if (tmdbIds.has(candidate.tmdbId)) {
      addHardFailure(issues, 'DUPLICATE_TMDB_ID', `Duplicate tmdbId: ${candidate.tmdbId}.`, { path, value: candidate.tmdbId })
    }
    candidateIds.add(candidate.candidateId)
    tmdbIds.add(candidate.tmdbId)
  }

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags: [] }
}

export function validateCuratedMovie(movie, context = {}) {
  const issues = []
  const reviewFlags = []

  if (!isObject(movie)) {
    addHardFailure(issues, 'INVALID_CURATED_MOVIE', 'Curated movie must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  for (const field of REQUIRED_CURATED_FIELDS) {
    if (!hasOwn(movie, field)) {
      addHardFailure(issues, 'MISSING_REQUIRED_FIELD', `${field} is required.`, { field })
    }
  }

  validateString(movie.id, 'id', issues)
  validateInteger(movie.tmdbId, 'tmdbId', issues)
  validateStringArray(movie.moods, 'moods', issues, { allowed: VALID_VALUES.moods })
  validateStringArray(movie.situations, 'situations', issues, { allowed: VALID_VALUES.situations })
  validateStringArray(movie.filterLanguages, 'filterLanguages', issues)
  validateEnum(movie.pace, 'pace', VALID_VALUES.pace, issues)
  validateEnum(movie.emotionalWeight, 'emotionalWeight', VALID_VALUES.emotionalWeight, issues)
  validateEnum(movie.attentionDemand, 'attentionDemand', VALID_VALUES.attentionDemand, issues)
  validateEnum(movie.discoveryStyle, 'discoveryStyle', VALID_VALUES.discoveryStyle, issues)
  validatePalette(movie.palette, issues)

  for (const field of Object.keys(COPY_LIMITS)) {
    validateCopyField(movie[field], field, issues, reviewFlags)
  }

  for (const flag of getSemanticAnomalies(movie)) {
    addReviewFlag(reviewFlags, flag.code, flag.message, { fields: flag.fields })
  }

  if (context.existingIds?.has(movie.id)) {
    addHardFailure(issues, 'DUPLICATE_LOCAL_ID', `Duplicate local ID: ${movie.id}.`, { field: 'id', value: movie.id })
  }
  if (context.existingTmdbIds?.has(movie.tmdbId)) {
    addHardFailure(issues, 'DUPLICATE_TMDB_ID', `Duplicate TMDB ID: ${movie.tmdbId}.`, { field: 'tmdbId', value: movie.tmdbId })
  }

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function validateMovieFacts(facts) {
  const issues = []
  const reviewFlags = []

  if (!isObject(facts)) {
    addHardFailure(issues, 'INVALID_FACTS', 'Movie facts must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  for (const field of REQUIRED_FACT_FIELDS) {
    if (!hasOwn(facts, field)) {
      addHardFailure(issues, 'MISSING_REQUIRED_FIELD', `${field} is required by the production resolver.`, { field })
    }
  }

  validateInteger(facts.tmdbId, 'tmdbId', issues)
  validateString(facts.title, 'title', issues)
  validateInteger(facts.year, 'year', issues, 1878)
  validateString(facts.director, 'director', issues)
  validateStringArray(facts.countries, 'countries', issues)
  validateStringArray(facts.spokenLanguages, 'spokenLanguages', issues)
  validateStringArray(facts.genres, 'genres', issues)
  validateInteger(facts.runtimeMinutes, 'runtimeMinutes', issues)

  if (facts.posterPath !== null && typeof facts.posterPath !== 'string') {
    addHardFailure(issues, 'INVALID_POSTER_PATH', 'posterPath must be a string or null.', { field: 'posterPath' })
  }
  if (facts.posterPath === null) {
    addReviewFlag(reviewFlags, 'POSTER_UNAVAILABLE', 'TMDB posterPath is null; poster suitability requires fallback review.', { field: 'posterPath' })
  }

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function validateOneToOneMapping(curatedMovies, mappings, factsById) {
  const hardFailures = []
  const reviewFlags = []

  if (!Array.isArray(curatedMovies)) {
    addHardFailure(hardFailures, 'INVALID_CURATED_COLLECTION', 'curatedMovies must be an array.')
    return { ok: false, hardFailures, reviewFlags }
  }
  if (!Array.isArray(mappings)) {
    addHardFailure(hardFailures, 'INVALID_MAPPING_COLLECTION', 'mappings must be an array.')
    return { ok: false, hardFailures, reviewFlags }
  }
  if (!isObject(factsById)) {
    addHardFailure(hardFailures, 'INVALID_FACT_COLLECTION', 'factsById must be an object.')
    return { ok: false, hardFailures, reviewFlags }
  }

  const curatedIds = new Set()
  const curatedTmdbIds = new Set()
  const mappingIds = new Set()
  const mappingTmdbIds = new Set()

  for (const movie of curatedMovies) {
    if (curatedIds.has(movie.id)) addHardFailure(hardFailures, 'DUPLICATE_LOCAL_ID', `Duplicate curated movie ID: ${movie.id}.`, { value: movie.id })
    if (curatedTmdbIds.has(movie.tmdbId)) addHardFailure(hardFailures, 'DUPLICATE_TMDB_ID', `Duplicate curated TMDB ID: ${movie.tmdbId}.`, { value: movie.tmdbId })
    curatedIds.add(movie.id)
    curatedTmdbIds.add(movie.tmdbId)
  }

  for (const mapping of mappings) {
    if (!mapping?.id || !Number.isInteger(mapping.tmdbId)) {
      addHardFailure(hardFailures, 'INVALID_TMDB_MAPPING', 'Each mapping needs id and integer tmdbId.', { value: mapping })
      continue
    }
    if (mappingIds.has(mapping.id)) addHardFailure(hardFailures, 'DUPLICATE_MAPPING_ID', `Duplicate mapping ID: ${mapping.id}.`, { value: mapping.id })
    if (mappingTmdbIds.has(mapping.tmdbId)) addHardFailure(hardFailures, 'DUPLICATE_TMDB_ID', `Duplicate mapped TMDB ID: ${mapping.tmdbId}.`, { value: mapping.tmdbId })
    if (!curatedIds.has(mapping.id)) addHardFailure(hardFailures, 'INVALID_TMDB_MAPPING', `Mapping does not belong to curated movie: ${mapping.id}.`, { value: mapping.id })
    mappingIds.add(mapping.id)
    mappingTmdbIds.add(mapping.tmdbId)
  }

  for (const movie of curatedMovies) {
    const mapping = mappings.find((item) => item.id === movie.id)
    const facts = factsById[movie.id]

    if (!mapping) addHardFailure(hardFailures, 'BROKEN_ONE_TO_ONE_MAPPING', `Missing mapping for ${movie.id}.`, { id: movie.id })
    if (!facts) addHardFailure(hardFailures, 'MISSING_FACTUAL_SNAPSHOT', `Missing factual snapshot for ${movie.id}.`, { id: movie.id })
    if (mapping && mapping.tmdbId !== movie.tmdbId) {
      addHardFailure(hardFailures, 'INVALID_TMDB_MAPPING', `Mapping TMDB ID differs from curated movie for ${movie.id}.`, { id: movie.id })
    }
    if (facts && facts.tmdbId !== movie.tmdbId) {
      addHardFailure(hardFailures, 'BROKEN_ONE_TO_ONE_MAPPING', `Facts TMDB ID differs from curated movie for ${movie.id}.`, { id: movie.id })
    }
  }

  if (mappings.length !== curatedMovies.length || Object.keys(factsById).length !== curatedMovies.length) {
    addHardFailure(hardFailures, 'BROKEN_ONE_TO_ONE_MAPPING', 'Curated, mapping, and facts counts must match.')
  }

  return { ok: hardFailures.length === 0, hardFailures, reviewFlags }
}

export function getSemanticAnomalies(movie) {
  const anomalies = []
  const moods = Array.isArray(movie?.moods) ? movie.moods : []
  const situations = Array.isArray(movie?.situations) ? movie.situations : []

  if (moods.includes('funny') && movie.emotionalWeight === 'heavy') {
    anomalies.push({
      code: 'FUNNY_HEAVY',
      fields: ['moods', 'emotionalWeight'],
      message: 'funny + heavy may be valid but should be reviewed.',
    })
  }
  if (moods.includes('relaxing') && movie.attentionDemand === 'immersive') {
    anomalies.push({
      code: 'RELAXING_IMMERSIVE',
      fields: ['moods', 'attentionDemand'],
      message: 'relaxing + immersive may be valid but should be reviewed.',
    })
  }
  if (moods.includes('exciting') && movie.pace === 'slow') {
    anomalies.push({
      code: 'SLOW_EXCITING',
      fields: ['moods', 'pace'],
      message: 'slow + exciting may be valid but should be reviewed.',
    })
  }
  if (moods.includes('suspenseful') && situations.includes('family')) {
    anomalies.push({
      code: 'SUSPENSEFUL_FAMILY',
      fields: ['moods', 'situations'],
      message: 'suspenseful + family may be valid but should be reviewed.',
    })
  }
  if (situations.includes('easy-watch') && movie.emotionalWeight === 'heavy') {
    anomalies.push({
      code: 'EASY_WATCH_HEAVY',
      fields: ['situations', 'emotionalWeight'],
      message: 'easy-watch + heavy may be valid but should be reviewed.',
    })
  }

  return anomalies
}

export function getCardinalityFlags(classification) {
  const flags = []
  const moods = Array.isArray(classification?.moods) ? classification.moods : []
  const situations = Array.isArray(classification?.situations) ? classification.situations : []

  if (moods.length === 1 || moods.length === 3) {
    flags.push({ code: 'MOOD_CARDINALITY_REVIEW', fields: ['moods'], message: `${moods.length} selected mood(s) is human-approved but requires per-tag evidence review.` })
  } else if (moods.length > 3) {
    flags.push({ code: 'MOOD_CARDINALITY_UNUSUAL', fields: ['moods'], message: `${moods.length} selected moods exceed the current human-approved range and require review.` })
  }

  if (situations.length === 1 || situations.length === 4) {
    flags.push({ code: 'SITUATION_CARDINALITY_REVIEW', fields: ['situations'], message: `${situations.length} selected situation(s) is human-approved but requires context review.` })
  } else if (situations.length > 4) {
    flags.push({ code: 'SITUATION_CARDINALITY_UNUSUAL', fields: ['situations'], message: `${situations.length} selected situations exceed the current human-approved range and require review.` })
  }

  return flags
}

export function shouldRequestIndependentReclassification({
  isGoldSubset = false,
  lowConfidence = false,
  hasBoundaryFlags = false,
  hasAnomalyFlags = false,
  classifierCriticDisagreement = false,
  randomAudit = false,
} = {}) {
  return isGoldSubset || lowConfidence || hasBoundaryFlags || hasAnomalyFlags || classifierCriticDisagreement || randomAudit
}

export function validateSemanticOutput(output) {
  const issues = []
  const reviewFlags = []

  if (!isObject(output)) {
    addHardFailure(issues, 'INVALID_SEMANTIC_OUTPUT', 'Semantic output must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  if (!['semantic-output.v1', 'semantic-output.v2'].includes(output.schemaVersion)) {
    addHardFailure(issues, 'INVALID_SCHEMA_VERSION', 'Semantic output schemaVersion must be semantic-output.v1 or semantic-output.v2.', { field: 'schemaVersion' })
  }
  validateString(output.promptVersion, 'promptVersion', issues)
  validateString(output.taxonomyVersion, 'taxonomyVersion', issues)
  if (!isObject(output.movie)) addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'movie is required.', { field: 'movie' })
  if (!isObject(output.classification)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'classification is required.', { field: 'classification' })
  } else {
    validateStringArray(output.classification.moods, 'classification.moods', issues, { allowed: VALID_VALUES.moods })
    validateStringArray(output.classification.situations, 'classification.situations', issues, { allowed: VALID_VALUES.situations })
    validateStringArray(output.classification.filterLanguages, 'classification.filterLanguages', issues)
    validateEnum(output.classification.pace, 'classification.pace', VALID_VALUES.pace, issues)
    validateEnum(output.classification.emotionalWeight, 'classification.emotionalWeight', VALID_VALUES.emotionalWeight, issues)
    validateEnum(output.classification.attentionDemand, 'classification.attentionDemand', VALID_VALUES.attentionDemand, issues)
    validateEnum(output.classification.discoveryStyle, 'classification.discoveryStyle', VALID_VALUES.discoveryStyle, issues)
    for (const flag of [...getSemanticAnomalies(output.classification), ...getCardinalityFlags(output.classification)]) {
      addReviewFlag(reviewFlags, flag.code, flag.message, { fields: flag.fields })
    }
  }

  if (!isObject(output.evidence)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'evidence is required.', { field: 'evidence' })
  } else if (isObject(output.classification)) {
    const options = { requireStructuredGrounding: output.schemaVersion === 'semantic-output.v2' }
    validateTagEvidence(output.evidence.moods, 'evidence.moods', output.classification.moods ?? [], issues, options)
    validateTagEvidence(output.evidence.situations, 'evidence.situations', output.classification.situations ?? [], issues, options)
    for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) validateEvidenceItem(output.evidence[field], `evidence.${field}`, issues, options)
  }
  validateBoundaryFlags(output.boundaryFlags, issues)
  validateSelfConfidence(output.selfConfidence, issues)

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function validateEditorialOutput(output) {
  const issues = []
  const reviewFlags = []

  if (!isObject(output)) {
    addHardFailure(issues, 'INVALID_EDITORIAL_OUTPUT', 'Editorial output must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  if (output.schemaVersion !== 'editorial-output.v1') {
    addHardFailure(issues, 'INVALID_SCHEMA_VERSION', 'Editorial output schemaVersion must be editorial-output.v1.', { field: 'schemaVersion' })
  }
  validateString(output.promptVersion, 'promptVersion', issues)
  validateString(output.voiceGuideVersion, 'voiceGuideVersion', issues)
  if (!isObject(output.movie)) addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'movie is required.', { field: 'movie' })
  if (!isObject(output.copy)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'copy is required.', { field: 'copy' })
  } else {
    for (const field of Object.keys(COPY_LIMITS)) {
      validateCopyField(output.copy[field], field, issues, reviewFlags)
    }
    if (typeof output.copy.description === 'string' && typeof output.copy.curiosityHook === 'string' && isDescriptionHookDuplicate(output.copy.description, output.copy.curiosityHook)) {
      addReviewFlag(reviewFlags, 'DESCRIPTION_HOOK_DUPLICATION', 'description and curiosityHook are too similar and need differentiation review.', { fields: ['description', 'curiosityHook'] })
    }
  }
  validateSpoilerBoundary(output.writerNotes?.spoilerBoundary, issues)

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function validateCriticOutput(output) {
  const issues = []
  const reviewFlags = []

  if (!isObject(output)) {
    addHardFailure(issues, 'INVALID_CRITIC_OUTPUT', 'Critic output must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  if (output.schemaVersion !== 'critic-output.v1') {
    addHardFailure(issues, 'INVALID_SCHEMA_VERSION', 'Critic output schemaVersion must be critic-output.v1.', { field: 'schemaVersion' })
  }
  validateString(output.promptVersion, 'promptVersion', issues)
  validateString(output.voiceGuideVersion, 'voiceGuideVersion', issues)
  if (!isObject(output.movie)) addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'movie is required.', { field: 'movie' })
  validateEnum(output.verdict, 'verdict', ['hard_fail', 'needs_review', 'approve_for_review', 'candidate_for_auto_accept'], issues)
  if (!Array.isArray(output.issues)) addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'issues must be an array.', { field: 'issues' })
  if (!isObject(output.copyAssessment)) addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'copyAssessment is required.', { field: 'copyAssessment' })
  else {
    const requiredAssessments = ['taxonomyAlignment', 'voiceConsistency', 'specificity', 'descriptionHookDifferentiation', 'genericLanguageRisk', 'syntacticRepetitionRisk', 'setupOnlySpoilerCompliance', 'synopsisDrift', 'distinctiveness', 'layoutFit']
    for (const field of requiredAssessments) validateEnum(output.copyAssessment[field], `copyAssessment.${field}`, ['pass', 'review', 'fail'], issues)
  }
  if (hasOwn(output, 'writerNotes') || hasOwn(output, 'writerReasoning')) {
    addHardFailure(issues, 'CRITIC_DEPENDS_ON_WRITER_REASONING', 'Critic output must not include writer hidden reasoning.', { field: 'writerReasoning' })
  }

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function validateReviewQueue(queue) {
  const issues = []
  const reviewFlags = []

  if (!isObject(queue)) {
    addHardFailure(issues, 'INVALID_REVIEW_QUEUE', 'Review queue must be an object.')
    return { ok: false, hardFailures: issues, reviewFlags }
  }

  validateString(queue.batchId, 'batchId', issues)
  if (queue.schemaVersion !== 'review-queue.v1') {
    addHardFailure(issues, 'INVALID_SCHEMA_VERSION', 'Review queue schemaVersion must be review-queue.v1.', { field: 'schemaVersion' })
  }
  if (!Array.isArray(queue.items)) {
    addHardFailure(issues, 'MISSING_REQUIRED_FIELD', 'items must be an array.', { field: 'items' })
  }

  return { ok: issues.length === 0, hardFailures: issues, reviewFlags }
}

export function summarizeValidation(results) {
  const hardFailures = results.flatMap((result) => result.hardFailures ?? [])
  const reviewFlags = results.flatMap((result) => result.reviewFlags ?? [])

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    reviewFlags,
  }
}
