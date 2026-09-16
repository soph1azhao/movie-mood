import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const V13_RISK_CATEGORIES = Object.freeze([
  'SPOILER_OR_LATER_REVEAL',
  'HIDDEN_IDENTITY_OR_ORIGIN',
  'RELATIONSHIP_OR_CHARACTER_MOTIVE',
  'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
  'FRANCHISE_OR_EXTERNAL_LORE',
  'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
  'MATERIAL_FACTUAL_CONFLICT',
  'UNRESOLVED_SOURCE_GROUNDING_CONFLICT',
  'UNSUPPORTED_COMPARATIVE_OR_META_CLAIM',
  'SPECULATIVE_HOOK_PREMISE',
  'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
])

export const V13_CLAIM_TYPES = Object.freeze([
  'DIRECT_PACKET_FACT',
  'LANGUAGE_CLAIM',
  'NATIONALITY_OR_PRODUCTION_COUNTRY',
  'GENRE_OR_SUBGENRE',
  'STORY_SETUP_FACT',
  'LOCATION_OR_SETTING',
  'CHARACTER_RELATIONSHIP',
  'CHARACTER_MOTIVE_OR_GOAL',
  'CAUSAL_OR_STORY_MECHANISM',
  'TEMPORAL_OR_DURATION_CONSTRAINT',
  'QUANTITATIVE_CLAIM',
  'FRANCHISE_OR_EXTERNAL_LORE',
  'SPOILER_OR_LATER_REVEAL',
  'HIDDEN_IDENTITY_OR_ORIGIN',
  'VIEWING_EXPERIENCE_INFERENCE',
  'ATMOSPHERIC_OR_STYLISTIC_LANGUAGE',
  'SPECULATIVE_HOOK_PREMISE',
])

export const V13_AUTHORITY_RESOLUTIONS = Object.freeze([
  'UNSUPPORTED_MISSING_AUTHORITY',
  'CONTRADICTED_BY_AUTHORITY',
  'DISALLOWED_AUTHORITY_SOURCE',
  'UNRESOLVED',
  'SUPPORTED',
])

export const V13_COPY_FIELDS = Object.freeze([
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
])

export const V13_LOW_RISK_COVERAGE_FIELDS = Object.freeze([
  'allVisibleFieldsAudited',
  'interrogativePremisesAudited',
  'factualModifiersAudited',
  'packetFactsAudited',
  'settingAndLocationAudited',
  'characterMotivesAndRelationshipsAudited',
  'storyMechanismsAndConstraintsAudited',
  'externalLoreAndBackstoryAudited',
  'spoilerAndRevealBoundariesAudited',
  'viewingExperienceInferenceAudited',
])

export const DISALLOWED_PROVIDER_SCHEMA_KEYWORDS = Object.freeze([
  '$schema',
  'allOf',
  'if',
  'then',
  'else',
  'const',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  '$ref',
  '$defs',
])

export const ALLOWED_PROVIDER_SCHEMA_KEYWORDS = Object.freeze([
  '$id',
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'enum',
  'items',
  'minItems',
  'maxItems',
  'anyOf',
])

/**
 * Recursively audits a provider schema object against the documented Gemini responseJsonSchema allowlist.
 */
export function auditProviderSchemaKeywords(schema, pathTrace = '$') {
  const violations = []
  if (!schema || typeof schema !== 'object') return violations

  if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      violations.push(...auditProviderSchemaKeywords(schema[i], `${pathTrace}[${i}]`))
    }
    return violations
  }

  for (const key of Object.keys(schema)) {
    if (DISALLOWED_PROVIDER_SCHEMA_KEYWORDS.includes(key)) {
      violations.push({
        path: `${pathTrace}.${key}`,
        disallowedKeyword: key,
        reason: 'Keyword is not in provider-supported structured output subset',
      })
    }
    if (!ALLOWED_PROVIDER_SCHEMA_KEYWORDS.includes(key)) {
      violations.push({
        path: `${pathTrace}.${key}`,
        unrecognizedKeyword: key,
        reason: 'Keyword is not in approved allowlist',
      })
    }
  }

  // Recurse into sub-schemas
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      violations.push(...auditProviderSchemaKeywords(propSchema, `${pathTrace}.properties.${propName}`))
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    violations.push(...auditProviderSchemaKeywords(schema.items, `${pathTrace}.items`))
  }
  if (Array.isArray(schema.anyOf)) {
    for (let i = 0; i < schema.anyOf.length; i++) {
      violations.push(...auditProviderSchemaKeywords(schema.anyOf[i], `${pathTrace}.anyOf[${i}]`))
    }
  }

  return violations
}

/**
 * Validates model output against Verifier v1.3 candidate schema & deterministic semantic invariants.
 */
export function validateVerifierV13SemanticPayload(payload) {
  const failures = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, failures: ['MALFORMED_PAYLOAD'] }
  }

  if (payload.riskLevel !== 'LOW_RISK' && payload.riskLevel !== 'HIGH_RISK') {
    failures.push('INVALID_RISK_LEVEL')
  }

  if (typeof payload.sourceBoundarySatisfied !== 'boolean') {
    failures.push('INVALID_SOURCE_BOUNDARY_SATISFIED')
  }

  if (!Array.isArray(payload.riskCategories)) {
    failures.push('INVALID_RISK_CATEGORIES')
  } else {
    const catSet = new Set(payload.riskCategories)
    if (catSet.size !== payload.riskCategories.length) failures.push('DUPLICATE_RISK_CATEGORIES')
    for (const cat of payload.riskCategories) {
      if (!V13_RISK_CATEGORIES.includes(cat)) failures.push(`UNKNOWN_RISK_CATEGORY:${cat}`)
    }
  }

  if (!Array.isArray(payload.issues)) {
    failures.push('INVALID_ISSUES')
  } else {
    for (let i = 0; i < payload.issues.length; i++) {
      const issue = payload.issues[i]
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
        failures.push(`MALFORMED_ISSUE_AT_${i}`)
        continue
      }
      if (!V13_RISK_CATEGORIES.includes(issue.category)) {
        failures.push(`INVALID_ISSUE_CATEGORY_AT_${i}`)
      }
      if (!V13_COPY_FIELDS.includes(issue.field)) {
        failures.push(`INVALID_ISSUE_FIELD_AT_${i}`)
      }
      if (typeof issue.claimSpan !== 'string' || issue.claimSpan.length < 1) {
        failures.push(`INVALID_ISSUE_CLAIM_SPAN_AT_${i}`)
      }
      if (typeof issue.normalizedClaim !== 'string' || issue.normalizedClaim.length < 1) {
        failures.push(`INVALID_ISSUE_NORMALIZED_CLAIM_AT_${i}`)
      }
      if (!V13_CLAIM_TYPES.includes(issue.claimType)) {
        failures.push(`INVALID_ISSUE_CLAIM_TYPE_AT_${i}`)
      }
      if (!Array.isArray(issue.checkedAuthoritySources) || issue.checkedAuthoritySources.length < 1) {
        failures.push(`INVALID_ISSUE_CHECKED_SOURCES_AT_${i}`)
      }
      if (!V13_AUTHORITY_RESOLUTIONS.includes(issue.authorityResolution)) {
        failures.push(`INVALID_ISSUE_AUTHORITY_RESOLUTION_AT_${i}`)
      }
      if (typeof issue.materialityRationale !== 'string' || issue.materialityRationale.length < 1) {
        failures.push(`INVALID_ISSUE_MATERIALITY_RATIONALE_AT_${i}`)
      }

      // Source evidence validation
      if (!Array.isArray(issue.sourceEvidence) || issue.sourceEvidence.length < 1) {
        failures.push(`INVALID_ISSUE_SOURCE_EVIDENCE_AT_${i}`)
      } else {
        let hasConflictingEvidence = false
        let hasPositiveEvidence = false

        for (let j = 0; j < issue.sourceEvidence.length; j++) {
          const ev = issue.sourceEvidence[j]
          if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
            failures.push(`MALFORMED_SOURCE_EVIDENCE_AT_${i}_${j}`)
            continue
          }
          if (typeof ev.source !== 'string' || ev.source.length < 1) {
            failures.push(`MISSING_SOURCE_IN_EVIDENCE_AT_${i}_${j}`)
          }
          if (typeof ev.supportFound !== 'boolean') {
            failures.push(`MISSING_SUPPORT_FOUND_IN_EVIDENCE_AT_${i}_${j}`)
          }

          if (ev.conflictingValue !== undefined || (ev.value !== undefined && ev.supportFound === false)) {
            hasConflictingEvidence = true
          }
          if (ev.value !== undefined && ev.supportFound === true) {
            hasPositiveEvidence = true
          }
        }

        // Tri-state logical coherence checks
        const allSupportFound = issue.sourceEvidence.length > 0 && issue.sourceEvidence.every((ev) => ev?.supportFound === true)
        const anySupportFound = issue.sourceEvidence.some((ev) => ev?.supportFound === true)

        if (issue.authorityResolution === 'SUPPORTED') {
          if (!allSupportFound) {
            failures.push(`RESOLUTION_EVIDENCE_INCOHERENT_SUPPORTED_REQUIRES_TRUE_AT_${i}`)
          }
          if (!hasPositiveEvidence) {
            failures.push(`SUPPORTED_REQUIRES_POSITIVE_EVIDENCE_AT_${i}`)
          }
          if (
            issue.category === 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM' ||
            issue.category === 'MATERIAL_FACTUAL_CONFLICT' ||
            issue.category === 'UNSUPPORTED_COMPARATIVE_OR_META_CLAIM'
          ) {
            failures.push(`SUPPORTED_RESOLUTION_INCOMPATIBLE_WITH_DEFECT_CATEGORY_AT_${i}`)
          }
        }
        if (issue.authorityResolution === 'UNSUPPORTED_MISSING_AUTHORITY') {
          for (let j = 0; j < issue.sourceEvidence.length; j++) {
            if (issue.sourceEvidence[j]?.supportFound !== false) {
              failures.push(`RESOLUTION_EVIDENCE_INCOHERENT_UNSUPPORTED_REQUIRES_FALSE_AT_${i}_${j}`)
            }
          }
        }
        if (issue.authorityResolution === 'CONTRADICTED_BY_AUTHORITY') {
          if (anySupportFound) {
            failures.push(`RESOLUTION_EVIDENCE_INCOHERENT_CONFLICT_CANNOT_HAVE_TRUE_AT_${i}`)
          }
          if (!hasConflictingEvidence) {
            failures.push(`CONTRADICTED_REQUIRES_CONFLICTING_EVIDENCE_AT_${i}`)
          }
        }
      }
    }
  }

  if (payload.riskLevel === 'LOW_RISK') {
    if (payload.sourceBoundarySatisfied !== true) failures.push('LOW_RISK_REQUIRES_SATISFIED_TRUE')
    if (payload.riskCategories && payload.riskCategories.length !== 0) failures.push('LOW_RISK_REQUIRES_EMPTY_CATEGORIES')
    if (payload.issues && payload.issues.length !== 0) failures.push('LOW_RISK_REQUIRES_EMPTY_ISSUES')

    if (!payload.lowRiskCoverage || typeof payload.lowRiskCoverage !== 'object' || Array.isArray(payload.lowRiskCoverage)) {
      failures.push('LOW_RISK_REQUIRES_COVERAGE_OBJECT')
    } else {
      for (const field of V13_LOW_RISK_COVERAGE_FIELDS) {
        if (payload.lowRiskCoverage[field] !== true) {
          failures.push(`LOW_RISK_COVERAGE_FIELD_NOT_TRUE:${field}`)
        }
      }
      if (typeof payload.lowRiskCoverage.summaryRationale !== 'string' || payload.lowRiskCoverage.summaryRationale.length < 1) {
        failures.push('LOW_RISK_COVERAGE_MISSING_SUMMARY_RATIONALE')
      }
    }
  }

  if (payload.riskLevel === 'HIGH_RISK') {
    if (payload.sourceBoundarySatisfied !== false) failures.push('HIGH_RISK_REQUIRES_SATISFIED_FALSE')
    if (!payload.riskCategories || payload.riskCategories.length < 1) failures.push('HIGH_RISK_REQUIRES_NON_EMPTY_CATEGORIES')
    if (!payload.issues || payload.issues.length < 1) failures.push('HIGH_RISK_REQUIRES_NON_EMPTY_ISSUES')
    if (payload.lowRiskCoverage !== null && payload.lowRiskCoverage !== undefined) {
      failures.push('HIGH_RISK_REQUIRES_NULL_COVERAGE')
    }

    if (Array.isArray(payload.riskCategories) && Array.isArray(payload.issues)) {
      const catSet = new Set(payload.riskCategories)
      const issueCatSet = new Set(payload.issues.map((iss) => iss?.category).filter(Boolean))
      if (catSet.size !== issueCatSet.size || [...catSet].some((c) => !issueCatSet.has(c))) {
        failures.push('CATEGORY_SET_MISMATCH')
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  }
}

export const validateVerifierV13CandidatePayload = validateVerifierV13SemanticPayload

/**
 * Offline routing simulation using candidate outputs.
 * Pure simulation only — does NOT mutate production routing.
 */
export function simulateCandidateV13Routing(payload) {
  const validation = validateVerifierV13CandidatePayload(payload)
  if (!validation.ok) {
    return {
      routed: false,
      riskRoutingStatus: 'REJECTED_BEFORE_ROUTING',
      rejectionFailures: validation.failures,
      simulationMode: 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION',
    }
  }

  if (payload.riskLevel === 'HIGH_RISK' || payload.riskCategories.includes('UNRESOLVED_SOURCE_GROUNDING_CONFLICT')) {
    return {
      routed: true,
      riskRoutingStatus: 'HUMAN_REVIEW_REQUIRED',
      promotionAuthorized: false,
      simulationMode: 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION',
    }
  }

  if (payload.riskLevel === 'LOW_RISK' && payload.sourceBoundarySatisfied === true) {
    return {
      routed: true,
      riskRoutingStatus: 'AUTO_ELIGIBLE',
      promotionAuthorized: false,
      simulationMode: 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION',
    }
  }

  return {
    routed: false,
    riskRoutingStatus: 'QUARANTINED',
    simulationMode: 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION',
  }
}

/**
 * Candidate replay persistence wrapper helper.
 */
export function createCandidateV13ReplayArtifactWrapper({
  candidateId,
  tmdbId,
  output,
  sourceHashes,
  candidate = true,
  active = false,
  contractVersion = 'source-boundary-risk-verifier.v1.3-candidate',
}) {
  if (candidate !== true || active !== false || contractVersion === 'source-boundary-risk-verifier.v1.1') {
    throw new Error('SECURITY_GATE_VIOLATION: Candidate artifact cannot masquerade as active v1.1')
  }

  return {
    schemaVersion: 'source-boundary-risk-artifact.v1.3-candidate',
    contractVersion,
    candidate: true,
    active: false,
    productionAuthorized: false,
    candidateId,
    tmdbId,
    output,
    sourceHashes,
  }
}
