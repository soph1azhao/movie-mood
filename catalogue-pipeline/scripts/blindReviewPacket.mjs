import crypto from 'node:crypto'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const FORBIDDEN_KEY_PATTERN = /(verifier|risk|history|decision|severity|repair|quota|cohort|target)/i

// Whitelist of allowed top-level keys in a blind packet
export const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'candidateId',
  'facts',
  'allowedSourceMaterial',
  'acceptedSemanticClassification',
  'semanticBoundaryRules',
  'spoilerBoundaryRules',
  'copyConstraints',
  'visibleEditorialCopy',
  'sourcePacketHash',
])

export const ALLOWED_FACT_KEYS = new Set([
  'title',
  'year',
  'director',
  'genres',
  'countries',
  'spokenLanguages',
  'runtimeMinutes',
  'overview',
  'posterPath',
  'keywords',
])

export const ALLOWED_EDITORIAL_COPY_KEYS = new Set([
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
])

export const ALLOWED_SOURCE_MATERIAL_KEYS = new Set([
  'overview',
  'keywords',
])

/**
 * Recursively scans all object keys in value. Throws an Error if any key matches forbidden pattern.
 */
export function assertNoForbiddenKeys(value, path = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoForbiddenKeys(value[i], `${path}[${i}]`)
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const currentPath = path ? `${path}.${key}` : key
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        throw new Error(`BLIND_PACKET_FORBIDDEN_KEY_DETECTED: Forbidden key '${key}' at path '${currentPath}'`)
      }
      assertNoForbiddenKeys(child, currentPath)
    }
  }
}

/**
 * Deterministically projects a raw risk-input object into a strict blind packet.
 * Only explicitly whitelisted keys survive.
 */
export function projectBlindPacket(rawRiskInput, candidateId) {
  if (!rawRiskInput || typeof rawRiskInput !== 'object') {
    throw new Error('BLIND_PACKET_INVALID_INPUT: riskInput must be an object')
  }

  // 1. Facts projection
  const rawFacts = rawRiskInput.facts || {}
  const facts = {
    title: rawFacts.title ?? '',
    year: rawFacts.year ?? null,
    director: rawFacts.director ?? null,
    genres: Array.isArray(rawFacts.genres) ? [...rawFacts.genres] : [],
    countries: Array.isArray(rawFacts.countries) ? [...rawFacts.countries] : [],
    spokenLanguages: Array.isArray(rawFacts.spokenLanguages) ? [...rawFacts.spokenLanguages] : [],
    runtimeMinutes: rawFacts.runtimeMinutes ?? null,
    overview: rawFacts.overview ?? null,
    posterPath: rawFacts.posterPath ?? null,
    keywords: Array.isArray(rawFacts.keywords) ? [...rawFacts.keywords] : [],
  }

  // 2. Allowed source material projection
  const rawAllowed = rawRiskInput.allowedSourceMaterial || {}
  const allowedSourceMaterial = {
    overview: rawAllowed.overview ?? null,
    keywords: Array.isArray(rawAllowed.keywords) ? [...rawAllowed.keywords] : [],
  }

  // 3. Accepted semantic classification projection
  const rawSemantic = rawRiskInput.acceptedSemanticClassification || {}
  const acceptedSemanticClassification = {
    moods: Array.isArray(rawSemantic.moods) ? [...rawSemantic.moods] : [],
    situations: Array.isArray(rawSemantic.situations) ? [...rawSemantic.situations] : [],
    pace: rawSemantic.pace ?? null,
    emotionalWeight: rawSemantic.emotionalWeight ?? null,
    attentionDemand: rawSemantic.attentionDemand ?? null,
    discoveryStyle: rawSemantic.discoveryStyle ?? null,
    filterLanguages: Array.isArray(rawSemantic.filterLanguages) ? [...rawSemantic.filterLanguages] : [],
  }

  // 4. Visible editorial copy projection
  const rawCopy = rawRiskInput.visibleEditorialCopy || {}
  const visibleEditorialCopy = {
    description: rawCopy.description ?? '',
    whyWatch: rawCopy.whyWatch ?? '',
    curiosityHook: rawCopy.curiosityHook ?? '',
    vibeSummary: rawCopy.vibeSummary ?? '',
  }

  // 5. Spoiler boundary rules projection
  const rawSpoiler = rawRiskInput.spoilerBoundaryRules || null
  const spoilerBoundaryRules = rawSpoiler ? {
    allowed: Array.isArray(rawSpoiler.allowed) ? [...rawSpoiler.allowed] : [],
    excluded: Array.isArray(rawSpoiler.excluded) ? [...rawSpoiler.excluded] : [],
  } : null

  // 6. Copy constraints projection
  const rawConstraints = rawRiskInput.copyConstraints || null
  const copyConstraints = rawConstraints ? {
    description: {
      minChars: rawConstraints.description?.minChars ?? null,
      maxChars: rawConstraints.description?.maxChars ?? null,
    },
    whyWatch: {
      minChars: rawConstraints.whyWatch?.minChars ?? null,
      maxChars: rawConstraints.whyWatch?.maxChars ?? null,
    },
    curiosityHook: {
      minChars: rawConstraints.curiosityHook?.minChars ?? null,
      maxChars: rawConstraints.curiosityHook?.maxChars ?? null,
    },
    vibeSummary: {
      minChars: rawConstraints.vibeSummary?.minChars ?? null,
      maxChars: rawConstraints.vibeSummary?.maxChars ?? null,
    },
  } : null

  // 7. Semantic boundary rules (null if not explicitly provided as an object)
  const semanticBoundaryRules = (rawRiskInput.semanticBoundaryRules && typeof rawRiskInput.semanticBoundaryRules === 'object')
    ? {}
    : null

  // 8. Canonical packet assembly
  const projected = {
    candidateId: candidateId || rawRiskInput.candidateId,
    facts,
    allowedSourceMaterial,
    acceptedSemanticClassification,
    ...(semanticBoundaryRules !== null ? { semanticBoundaryRules } : {}),
    ...(spoilerBoundaryRules !== null ? { spoilerBoundaryRules } : {}),
    ...(copyConstraints !== null ? { copyConstraints } : {}),
    visibleEditorialCopy,
    sourcePacketHash: 'sha256:' + crypto.createHash('sha256').update(serializeArtifactForPersistence(rawRiskInput)).digest('hex'),
  }

  // 9. Fail-closed recursive assertions
  assertNoForbiddenKeys(projected)
  assertOnlyWhitelistedPaths(projected)

  return projected
}

/**
 * Returns canonical byte buffer for packet ensuring Gemini, Claude, and Sophia receive byte-identical representation.
 */
export function getCanonicalBlindPacketBytes(packet) {
  assertNoForbiddenKeys(packet)
  assertOnlyWhitelistedPaths(packet)
  return Buffer.from(serializeArtifactForPersistence(packet), 'utf8')
}

export const WHITELISTED_PATHS = new Set([
  'candidateId',
  'facts',
  'facts.title',
  'facts.year',
  'facts.director',
  'facts.genres',
  'facts.countries',
  'facts.spokenLanguages',
  'facts.runtimeMinutes',
  'facts.overview',
  'facts.posterPath',
  'facts.keywords',
  'allowedSourceMaterial',
  'allowedSourceMaterial.overview',
  'allowedSourceMaterial.keywords',
  'acceptedSemanticClassification',
  'acceptedSemanticClassification.moods',
  'acceptedSemanticClassification.situations',
  'acceptedSemanticClassification.pace',
  'acceptedSemanticClassification.emotionalWeight',
  'acceptedSemanticClassification.attentionDemand',
  'acceptedSemanticClassification.discoveryStyle',
  'acceptedSemanticClassification.filterLanguages',
  'semanticBoundaryRules',
  'spoilerBoundaryRules',
  'spoilerBoundaryRules.allowed',
  'spoilerBoundaryRules.excluded',
  'copyConstraints',
  'copyConstraints.description',
  'copyConstraints.description.minChars',
  'copyConstraints.description.maxChars',
  'copyConstraints.whyWatch',
  'copyConstraints.whyWatch.minChars',
  'copyConstraints.whyWatch.maxChars',
  'copyConstraints.curiosityHook',
  'copyConstraints.curiosityHook.minChars',
  'copyConstraints.curiosityHook.maxChars',
  'copyConstraints.vibeSummary',
  'copyConstraints.vibeSummary.minChars',
  'copyConstraints.vibeSummary.maxChars',
  'visibleEditorialCopy',
  'visibleEditorialCopy.description',
  'visibleEditorialCopy.whyWatch',
  'visibleEditorialCopy.curiosityHook',
  'visibleEditorialCopy.vibeSummary',
  'sourcePacketHash',
])

export function assertOnlyWhitelistedPaths(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    if (!WHITELISTED_PATHS.has(fullPath)) {
      throw new Error(`BLIND_PACKET_NON_WHITELISTED_PATH: Property path '${fullPath}' is not in approved whitelist`)
    }
    assertOnlyWhitelistedPaths(obj[key], fullPath)
  }
}
