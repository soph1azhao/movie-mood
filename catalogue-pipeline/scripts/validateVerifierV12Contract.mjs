import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashBytes, hashArtifact } from './validatePromotionContract.mjs'

export const V12_RISK_CATEGORIES = Object.freeze([
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

export const V12_CLAIM_TYPES = Object.freeze([
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

export const V12_AUTHORITY_RESOLUTIONS = Object.freeze([
  'UNSUPPORTED_MISSING_AUTHORITY',
  'CONTRADICTED_BY_AUTHORITY',
  'DISALLOWED_AUTHORITY_SOURCE',
  'UNRESOLVED',
  'SUPPORTED',
])

export const V12_COPY_FIELDS = Object.freeze([
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
])

export const V12_LOW_RISK_COVERAGE_FIELDS = Object.freeze([
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

/**
 * Validates model output against Verifier v1.2 candidate schema & semantic invariants.
 */
export function validateVerifierV12SemanticPayload(payload) {
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
      if (!V12_RISK_CATEGORIES.includes(cat)) failures.push(`UNKNOWN_RISK_CATEGORY:${cat}`)
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
      if (!V12_RISK_CATEGORIES.includes(issue.category)) {
        failures.push(`INVALID_ISSUE_CATEGORY_AT_${i}`)
      }
      if (!V12_COPY_FIELDS.includes(issue.field)) {
        failures.push(`INVALID_ISSUE_FIELD_AT_${i}`)
      }
      if (typeof issue.claimSpan !== 'string' || issue.claimSpan.length < 1) {
        failures.push(`INVALID_ISSUE_CLAIM_SPAN_AT_${i}`)
      }
      if (typeof issue.normalizedClaim !== 'string' || issue.normalizedClaim.length < 1) {
        failures.push(`INVALID_ISSUE_NORMALIZED_CLAIM_AT_${i}`)
      }
      if (!V12_CLAIM_TYPES.includes(issue.claimType)) {
        failures.push(`INVALID_ISSUE_CLAIM_TYPE_AT_${i}`)
      }
      if (!Array.isArray(issue.checkedAuthoritySources) || issue.checkedAuthoritySources.length < 1) {
        failures.push(`INVALID_ISSUE_CHECKED_SOURCES_AT_${i}`)
      }
      if (!V12_AUTHORITY_RESOLUTIONS.includes(issue.authorityResolution)) {
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

        // Logical coherence checks
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
      for (const field of V12_LOW_RISK_COVERAGE_FIELDS) {
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

/**
 * Candidate-only semantic validator export.
 */
export const validateVerifierV12CandidatePayload = validateVerifierV12SemanticPayload

/**
 * Offline routing simulation using candidate outputs.
 * Pure simulation only — does NOT mutate production routing.
 */
export function simulateCandidateRouting(payload) {
  const validation = validateVerifierV12CandidatePayload(payload)
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
 * Cannot masquerade as active v1.1 production artifact.
 */
export function createCandidateReplayArtifactWrapper({
  candidateId,
  tmdbId,
  output,
  sourceHashes,
  candidate = true,
  active = false,
  contractVersion = 'source-boundary-risk-verifier.v1.2-candidate',
}) {
  if (candidate !== true || active !== false || contractVersion === 'source-boundary-risk-verifier.v1.1') {
    throw new Error('SECURITY_GATE_VIOLATION: Candidate artifact cannot masquerade as active v1.1')
  }

  return {
    schemaVersion: 'source-boundary-risk-artifact.v1.2-candidate',
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

/**
 * Exact 8-stage boundary compatibility matrix between active v1.1 and candidate v1.2.
 */
export const CANDIDATE_OUTPUT_COMPATIBILITY_MATRIX = Object.freeze([
  {
    boundary: '1. Input Builder',
    v11Expectation: 'buildRiskVerifierInput({ writerPacket, visibleEditorialCopy }) yields 7 surfaces',
    candidateV12Shape: 'Consumes identical 7 surfaces; optionally supports deterministicLintFindings',
    compatible: true,
    adapterRequired: false,
    reason: 'Candidate v1.2 input schema is a pure non-breaking extension; absent optional fields are safely handled.',
  },
  {
    boundary: '2. Prompt Dispatch',
    v11Expectation: 'Passes prompt text + JSON schema to provider (Gemini developer API)',
    candidateV12Shape: 'Passes candidate prompt markdown + candidate JSON schema to provider',
    compatible: true,
    adapterRequired: false,
    reason: 'Provider dispatch infrastructure is model- and schema-agnostic.',
  },
  {
    boundary: '3. JSON Parse',
    v11Expectation: 'JSON.parse() of raw response string',
    candidateV12Shape: 'JSON.parse() of raw response string',
    compatible: true,
    adapterRequired: false,
    reason: 'Standard valid JSON output.',
  },
  {
    boundary: '4. Schema Validation',
    v11Expectation: 'Validates against source-boundary-risk-verifier.v1.1.schema.json',
    candidateV12Shape: 'Validates against source-boundary-risk-verifier.v1.2.schema.json',
    compatible: false,
    adapterRequired: true,
    reason: 'v1.1 schema rejects new categories (UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM, SPECULATIVE_HOOK_PREMISE), structured issue fields, and lowRiskCoverage.',
  },
  {
    boundary: '5. Semantic Validation',
    v11Expectation: 'validateVerifierSemanticPayload checks [category, explanation, fields]',
    candidateV12Shape: 'validateVerifierV12CandidatePayload checks 8 issue fields + sourceEvidence + lowRiskCoverage',
    compatible: false,
    adapterRequired: true,
    reason: 'Active v1.1 validator strictly checks issue keys === [category, explanation, fields] and rejects v1.2 issues.',
  },
  {
    boundary: '6. Persistence',
    v11Expectation: 'Persists artifact.json with contractVersion: source-boundary-risk-verifier.v1.1',
    candidateV12Shape: 'createCandidateReplayArtifactWrapper sets contractVersion: source-boundary-risk-verifier.v1.2-candidate, active: false',
    compatible: false,
    adapterRequired: true,
    reason: 'Candidate replay artifacts must not overwrite or masquerade as active v1.1 artifacts.',
  },
  {
    boundary: '7. Artifact Reload',
    v11Expectation: 'Reads output.riskLevel and output.riskCategories from artifact.json',
    candidateV12Shape: 'output maintains riskLevel and riskCategories at root',
    compatible: true,
    adapterRequired: false,
    reason: 'Top-level output keys are identical.',
  },
  {
    boundary: '8. Routing Read',
    v11Expectation: 'routeProductionRecord consumes riskVerifierResult and unresolvedSourceGroundingConflict',
    candidateV12Shape: 'simulateCandidateRouting maps riskLevel and categories in offline simulation',
    compatible: true,
    adapterRequired: true,
    reason: 'Top-level semantics map cleanly in simulation, but production routing must not be modified directly.',
  },
])

/**
 * 6 Synthetic contract fixtures testing semantic rules and source evidence without model calls.
 */
export const SYNTHETIC_CONTRACT_FIXTURES = Object.freeze([
  {
    id: 'fixture-1-authorized-language',
    description: 'Spoken language explicitly present in facts.spokenLanguages is authorized',
    input: {
      facts: { spokenLanguages: ['Russian'] },
      copy: { whyWatch: 'A thrilling Russian-language action film.' },
    },
    expectedContractResult: {
      isAuthorized: true,
      claimType: 'LANGUAGE_CLAIM',
      authoritySurface: 'facts.spokenLanguages',
      sourceEvidence: [
        {
          source: 'facts.spokenLanguages',
          value: ['Russian'],
          supportFound: true,
        },
      ],
    },
  },
  {
    id: 'fixture-2-unauthorized-setting-inference',
    description: 'Production country in facts.countries does NOT authorize in-story setting',
    input: {
      facts: { countries: ['FR'] },
      allowedSourceMaterial: { overview: 'A tense psychological thriller.' },
      copy: { description: 'Set in France, two rivals clash.' },
    },
    expectedContractResult: {
      isAuthorized: false,
      claimType: 'LOCATION_OR_SETTING',
      authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
      category: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
      sourceEvidence: [
        {
          source: 'allowedSourceMaterial.overview',
          supportFound: false,
        },
      ],
    },
  },
  {
    id: 'fixture-3-factual-contradiction',
    description: 'Asserting a runtime contrary to facts.runtimeMinutes is a material factual conflict',
    input: {
      facts: { runtimeMinutes: 90 },
      copy: { description: 'A two-hour epic unfolding over 120 minutes.' },
    },
    expectedContractResult: {
      isAuthorized: false,
      claimType: 'QUANTITATIVE_CLAIM',
      authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
      category: 'MATERIAL_FACTUAL_CONFLICT',
      sourceEvidence: [
        {
          source: 'facts.runtimeMinutes',
          value: 90,
          conflictingValue: 120,
          supportFound: false,
        },
      ],
    },
  },
  {
    id: 'fixture-4-hook-presupposition',
    description: 'Interrogative curiosity hook presupposing ungrounded creation secret',
    input: {
      allowedSourceMaterial: { overview: 'A crafted violin journeys across continents.' },
      copy: { curiosityHook: 'What dark secret from its creation left a curse in its wake?' },
    },
    expectedContractResult: {
      isAuthorized: false,
      claimType: 'SPECULATIVE_HOOK_PREMISE',
      authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
      category: 'SPECULATIVE_HOOK_PREMISE',
      sourceEvidence: [
        {
          source: 'allowedSourceMaterial.overview',
          supportFound: false,
        },
      ],
    },
  },
  {
    id: 'fixture-5-semantic-classification-misuse',
    description: 'Tense mood in semantic classification does not authorize a concrete 10-minute deadline',
    input: {
      acceptedSemanticClassification: { moods: ['tense'] },
      allowedSourceMaterial: { overview: 'Characters attempt a daring escape.' },
      copy: { description: 'Characters race to escape before the bomb explodes in 10 minutes.' },
    },
    expectedContractResult: {
      isAuthorized: false,
      claimType: 'TEMPORAL_OR_DURATION_CONSTRAINT',
      authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
      category: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
      sourceEvidence: [
        {
          source: 'acceptedSemanticClassification',
          value: { moods: ['tense'] },
          supportFound: false,
          notes: 'Semantic classification cannot authorize story plot mechanisms or deadlines.',
        },
        {
          source: 'allowedSourceMaterial.overview',
          supportFound: false,
        },
      ],
    },
  },
  {
    id: 'fixture-6-supported-viewing-inference',
    description: 'High attention demand authorizes characterization as demanding close viewer attention',
    input: {
      acceptedSemanticClassification: { attentionDemand: 'high' },
      copy: { vibeSummary: 'A deliberate puzzle that demands close attention.' },
    },
    expectedContractResult: {
      isAuthorized: true,
      claimType: 'VIEWING_EXPERIENCE_INFERENCE',
      authoritySurface: 'acceptedSemanticClassification.attentionDemand',
      sourceEvidence: [
        {
          source: 'acceptedSemanticClassification.attentionDemand',
          value: 'high',
          supportFound: true,
        },
      ],
    },
  },
])

/**
 * Positive and negative schema validation fixtures.
 */
export const SCHEMA_FIXTURES = Object.freeze({
  positive: [
    {
      name: 'valid_low_risk_complete_coverage',
      payload: {
        riskLevel: 'LOW_RISK',
        riskCategories: [],
        issues: [],
        sourceBoundarySatisfied: true,
        lowRiskCoverage: {
          allVisibleFieldsAudited: true,
          interrogativePremisesAudited: true,
          factualModifiersAudited: true,
          packetFactsAudited: true,
          settingAndLocationAudited: true,
          characterMotivesAndRelationshipsAudited: true,
          storyMechanismsAndConstraintsAudited: true,
          externalLoreAndBackstoryAudited: true,
          spoilerAndRevealBoundariesAudited: true,
          viewingExperienceInferenceAudited: true,
          summaryRationale: 'All fields strictly stay within authorized facts and validated tokens.',
        },
      },
    },
    {
      name: 'valid_high_risk_unsupported_claim',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
        issues: [
          {
            category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
            field: 'whyWatch',
            claimSpan: 'Russian-language action-fantasy',
            normalizedClaim: 'The film dialogue is in Russian.',
            claimType: 'LANGUAGE_CLAIM',
            checkedAuthoritySources: ['facts.spokenLanguages'],
            sourceEvidence: [
              {
                source: 'facts.spokenLanguages',
                value: [],
                supportFound: false,
              },
            ],
            authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
            materialityRationale: 'Spoken language claim is missing from facts.spokenLanguages.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
    },
    {
      name: 'valid_high_risk_factual_conflict',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'runtime of 120 minutes',
            normalizedClaim: 'The film runtime is 120 minutes.',
            claimType: 'QUANTITATIVE_CLAIM',
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            sourceEvidence: [
              {
                source: 'facts.runtimeMinutes',
                value: 90,
                conflictingValue: 120,
                supportFound: false,
              },
            ],
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Directly contradicts facts.runtimeMinutes which is 90.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
    },
    {
      name: 'valid_high_risk_speculative_hook_premise',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['SPECULATIVE_HOOK_PREMISE'],
        issues: [
          {
            category: 'SPECULATIVE_HOOK_PREMISE',
            field: 'curiosityHook',
            claimSpan: 'what dark secret from its 1681 creation left a trail of misfortune?',
            normalizedClaim: 'The instrument 1681 creation is tied to a hidden dark secret.',
            claimType: 'SPECULATIVE_HOOK_PREMISE',
            checkedAuthoritySources: ['allowedSourceMaterial.overview'],
            sourceEvidence: [
              {
                source: 'allowedSourceMaterial.overview',
                supportFound: false,
              },
            ],
            authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
            materialityRationale: 'Presupposes ungrounded secret at creation.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
    },
  ],
  negative: [
    {
      name: 'low_risk_with_boolean_false',
      payload: {
        riskLevel: 'LOW_RISK',
        riskCategories: [],
        issues: [],
        sourceBoundarySatisfied: true,
        lowRiskCoverage: {
          allVisibleFieldsAudited: true,
          interrogativePremisesAudited: false, // INVALID
          factualModifiersAudited: true,
          packetFactsAudited: true,
          settingAndLocationAudited: true,
          characterMotivesAndRelationshipsAudited: true,
          storyMechanismsAndConstraintsAudited: true,
          externalLoreAndBackstoryAudited: true,
          spoilerAndRevealBoundariesAudited: true,
          viewingExperienceInferenceAudited: true,
          summaryRationale: 'Rationale here.',
        },
      },
      expectedFailureSubstring: 'LOW_RISK_COVERAGE_FIELD_NOT_TRUE:interrogativePremisesAudited',
    },
    {
      name: 'low_risk_missing_rationale',
      payload: {
        riskLevel: 'LOW_RISK',
        riskCategories: [],
        issues: [],
        sourceBoundarySatisfied: true,
        lowRiskCoverage: {
          allVisibleFieldsAudited: true,
          interrogativePremisesAudited: true,
          factualModifiersAudited: true,
          packetFactsAudited: true,
          settingAndLocationAudited: true,
          characterMotivesAndRelationshipsAudited: true,
          storyMechanismsAndConstraintsAudited: true,
          externalLoreAndBackstoryAudited: true,
          spoilerAndRevealBoundariesAudited: true,
          viewingExperienceInferenceAudited: true,
          summaryRationale: '', // INVALID
        },
      },
      expectedFailureSubstring: 'LOW_RISK_COVERAGE_MISSING_SUMMARY_RATIONALE',
    },
    {
      name: 'high_risk_missing_claim_span',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: '', // INVALID
            normalizedClaim: 'Some claim',
            claimType: 'QUANTITATIVE_CLAIM',
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, supportFound: false }],
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'INVALID_ISSUE_CLAIM_SPAN_AT_0',
    },
    {
      name: 'high_risk_missing_source_evidence',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'runtime of 120 minutes',
            normalizedClaim: 'Some claim',
            claimType: 'QUANTITATIVE_CLAIM',
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            // sourceEvidence missing!
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'INVALID_ISSUE_SOURCE_EVIDENCE_AT_0',
    },
    {
      name: 'high_risk_semantic_contradiction_unsupported_with_true',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
        issues: [
          {
            category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
            field: 'whyWatch',
            claimSpan: 'Russian-language action-fantasy',
            normalizedClaim: 'The film dialogue is in Russian.',
            claimType: 'LANGUAGE_CLAIM',
            checkedAuthoritySources: ['facts.spokenLanguages'],
            sourceEvidence: [
              {
                source: 'facts.spokenLanguages',
                value: ['Russian'],
                supportFound: true, // INVALID: claims UNSUPPORTED but says supportFound=true!
              },
            ],
            authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
            materialityRationale: 'Spoken language claim is missing.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'RESOLUTION_EVIDENCE_INCOHERENT_UNSUPPORTED_REQUIRES_FALSE_AT_0_0',
    },
    {
      name: 'unsupported_missing_support_found',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
        issues: [
          {
            category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
            field: 'description',
            claimSpan: 'ahead of auction',
            normalizedClaim: 'Appraisal occurs ahead of auction',
            claimType: 'STORY_SETUP_FACT',
            checkedAuthoritySources: ['allowedSourceMaterial.overview'],
            sourceEvidence: [
              {
                source: 'allowedSourceMaterial.overview',
                // supportFound missing!
              },
            ],
            authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
            materialityRationale: 'Missing supportFound boolean.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'MISSING_SUPPORT_FOUND_IN_EVIDENCE_AT_0_0',
    },
    {
      name: 'deprecated_conflicts_with_authority_rejected',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'runtime 120m',
            normalizedClaim: 'Runtime is 120m',
            claimType: 'QUANTITATIVE_CLAIM',
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
            authorityResolution: 'CONFLICTS_WITH_AUTHORITY', // DEPRECATED DUPLICATE!
            materialityRationale: 'Contradiction asserted with deprecated enum.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'INVALID_ISSUE_AUTHORITY_RESOLUTION_AT_0',
    },
    {
      name: 'unknown_claim_type',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'some span',
            normalizedClaim: 'Some claim',
            claimType: 'INVALID_UNKNOWN_CLAIM_TYPE', // INVALID
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, supportFound: false }],
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'INVALID_ISSUE_CLAIM_TYPE_AT_0',
    },
    {
      name: 'unknown_risk_category',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['TOTALLY_FAKE_CATEGORY'], // INVALID
        issues: [
          {
            category: 'TOTALLY_FAKE_CATEGORY', // INVALID
            field: 'description',
            claimSpan: 'some span',
            normalizedClaim: 'Some claim',
            claimType: 'STORY_SETUP_FACT',
            checkedAuthoritySources: ['allowedSourceMaterial.overview'],
            sourceEvidence: [{ source: 'allowedSourceMaterial.overview', supportFound: false }],
            authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'UNKNOWN_RISK_CATEGORY:TOTALLY_FAKE_CATEGORY',
    },
    {
      name: 'malformed_authority_resolution',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'some span',
            normalizedClaim: 'Some claim',
            claimType: 'STORY_SETUP_FACT',
            checkedAuthoritySources: ['allowedSourceMaterial.overview'],
            sourceEvidence: [{ source: 'allowedSourceMaterial.overview', supportFound: false }],
            authorityResolution: 'MAYBE_FALSE', // INVALID
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'INVALID_ISSUE_AUTHORITY_RESOLUTION_AT_0',
    },
    {
      name: 'category_set_mismatch',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT', 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'], // Extra category
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'some span',
            normalizedClaim: 'Some claim',
            claimType: 'STORY_SETUP_FACT',
            checkedAuthoritySources: ['allowedSourceMaterial.overview'],
            sourceEvidence: [{ source: 'allowedSourceMaterial.overview', supportFound: false, conflictingValue: 'conflict' }],
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Some rationale',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'CATEGORY_SET_MISMATCH',
    },
    {
      name: 'contradicted_without_conflicting_evidence',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
        issues: [
          {
            category: 'MATERIAL_FACTUAL_CONFLICT',
            field: 'description',
            claimSpan: 'runtime 120m',
            normalizedClaim: 'Runtime is 120m',
            claimType: 'QUANTITATIVE_CLAIM',
            checkedAuthoritySources: ['facts.runtimeMinutes'],
            sourceEvidence: [{ source: 'facts.runtimeMinutes', supportFound: false }], // No conflicting value!
            authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
            materialityRationale: 'Contradiction asserted without evidence.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'CONTRADICTED_REQUIRES_CONFLICTING_EVIDENCE_AT_0',
    },
    {
      name: 'supported_with_unauthorized_defect_category',
      payload: {
        riskLevel: 'HIGH_RISK',
        riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
        issues: [
          {
            category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
            field: 'whyWatch',
            claimSpan: 'Russian-language action',
            normalizedClaim: 'Dialogue is in Russian.',
            claimType: 'LANGUAGE_CLAIM',
            checkedAuthoritySources: ['facts.spokenLanguages'],
            sourceEvidence: [{ source: 'facts.spokenLanguages', value: ['Russian'], supportFound: true }],
            authorityResolution: 'SUPPORTED', // Cannot be SUPPORTED while classified as defect!
            materialityRationale: 'Claim is actually supported.',
          },
        ],
        sourceBoundarySatisfied: false,
      },
      expectedFailureSubstring: 'SUPPORTED_RESOLUTION_INCOMPATIBLE_WITH_DEFECT_CATEGORY_AT_0',
    },
  ],
})

/**
 * Inspects persisted Scale Tranche 2 risk inputs to determine structural compatibility.
 * Strictly separates input compatibility from output pipeline compatibility.
 */
export async function evaluatePersistedT2InputsCompatibility({ repoRoot }) {
  const dir = path.join(
    repoRoot,
    'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/execution/scale-tranche-2/risk-verifiers'
  )
  const entries = await readdir(dir)
  const requiredSurfaces = [
    'facts',
    'acceptedSemanticClassification',
    'semanticBoundaryFlags',
    'allowedSourceMaterial',
    'spoilerBoundaryRules',
    'copyConstraints',
    'visibleEditorialCopy',
  ]

  let compatibleCount = 0
  let incompatibleCount = 0

  for (const entry of entries) {
    const inputPath = path.join(dir, entry, 'risk-input.json')
    try {
      const data = JSON.parse(await readFile(inputPath, 'utf8'))
      const missing = requiredSurfaces.filter((s) => data[s] === undefined)
      if (missing.length === 0 && data.visibleEditorialCopy && typeof data.visibleEditorialCopy === 'object') {
        compatibleCount++
      } else {
        incompatibleCount++
      }
    } catch {
      incompatibleCount++
    }
  }

  return {
    inputCompatibility: {
      totalInputs: entries.length,
      compatibleInputs: compatibleCount,
      incompatibleInputs: incompatibleCount,
      isFullyCompatible: compatibleCount === entries.length && incompatibleCount === 0,
      adapterRequired: false,
    },
    outputPipelineCompatibility: {
      requiresCandidateValidator: true,
      requiresCandidatePersistenceWrapper: true,
      requiresCandidateRoutingSimulator: true,
      directActivePipelineCompatible: false,
      reason: 'Active v1.1 validator and persistence wrapper hardcode v1.1 issue shapes and contractVersion.',
    },
  }
}

/**
 * Evaluates severe case contract representability using source-only data and explicit source evidence.
 */
export function evaluateSevereCaseContractWalkthrough() {
  const candidateId = 'scale500-tmdb-14283'
  const title = 'The Red Violin'

  // Source-only contract walkthrough with explicit source evidence
  const curiosityHookDefect = {
    claimSpan: 'what dark secret from its 1681 creation left a trail of misfortune?',
    normalizedClaim: 'The instrument 1681 creation is tied to a hidden dark secret.',
    claimType: 'SPECULATIVE_HOOK_PREMISE',
    checkedAuthoritySources: ['allowedSourceMaterial.overview'],
    sourceEvidence: [
      {
        source: 'allowedSourceMaterial.overview',
        supportFound: false,
        notes: 'Overview establishes 1681 creation date and subsequent travels, but contains no hidden-origin secret premise.',
      },
    ],
    authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
    category: 'SPECULATIVE_HOOK_PREMISE',
    materialityRationale: 'CuriosityHook presupposes that a hidden secret exists and is connected to 1681 creation; overview establishes creation date and journey but no secret premise.',
  }

  const descriptionDefect = {
    claimSpan: 'ahead of auction',
    normalizedClaim: 'The violin appraisal occurs in advance of an auction.',
    claimType: 'STORY_SETUP_FACT',
    checkedAuthoritySources: ['allowedSourceMaterial.overview', 'allowedSourceMaterial.keywords'],
    sourceEvidence: [
      {
        source: 'allowedSourceMaterial.overview',
        supportFound: false,
        notes: 'Overview does not state an appraisal ahead of auction.',
      },
      {
        source: 'allowedSourceMaterial.keywords',
        value: [],
        supportFound: false,
        notes: 'Allowed keywords array is empty.',
      },
    ],
    authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
    category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
    materialityRationale: 'Ahead of auction introduces a concrete story-context/event detail not authorized by overview or keywords.',
  }

  const hookValid = validateVerifierV12CandidatePayload({
    riskLevel: 'HIGH_RISK',
    riskCategories: [curiosityHookDefect.category],
    issues: [{ ...curiosityHookDefect, field: 'curiosityHook' }],
    sourceBoundarySatisfied: false,
  })

  const descValid = validateVerifierV12CandidatePayload({
    riskLevel: 'HIGH_RISK',
    riskCategories: [descriptionDefect.category],
    issues: [{ ...descriptionDefect, field: 'description' }],
    sourceBoundarySatisfied: false,
  })

  const combinedValid = validateVerifierV12CandidatePayload({
    riskLevel: 'HIGH_RISK',
    riskCategories: [curiosityHookDefect.category, descriptionDefect.category],
    issues: [
      { ...curiosityHookDefect, field: 'curiosityHook' },
      { ...descriptionDefect, field: 'description' },
    ],
    sourceBoundarySatisfied: false,
  })

  return {
    candidateId,
    title,
    curiosityHookDefect,
    descriptionDefect,
    hookValid: hookValid.ok,
    descValid: descValid.ok,
    combinedValid: combinedValid.ok,
    status: 'CANDIDATE_CONTRACT_CAN_REPRESENT_KNOWN_SEVERE_FAILURE',
  }
}

/**
 * Checks representability of the 16 development-set misses in candidate v1.2 contract.
 */
export async function evaluateDevelopmentMissesRepresentability({ repoRoot }) {
  const { DEVELOPMENT_MISS_SPEC_MAPPINGS } = await import('./auditVerifierV12SpecificationCoverage.mjs')

  const results = DEVELOPMENT_MISS_SPEC_MAPPINGS.map((mapping) => {
    const claimTypeValid = V12_CLAIM_TYPES.includes(mapping.proposedV12ClaimClass)
    const riskCategoryValid = V12_RISK_CATEGORIES.includes(mapping.proposedV12RiskCategory)

    const representable = claimTypeValid && riskCategoryValid
    return {
      candidateId: mapping.candidateId,
      title: mapping.title,
      claimType: mapping.proposedV12ClaimClass,
      riskCategory: mapping.proposedV12RiskCategory,
      status: representable ? 'REPRESENTABLE' : 'NOT_REPRESENTABLE',
    }
  })

  const representableCount = results.filter((r) => r.status === 'REPRESENTABLE').length

  return {
    total: results.length,
    representableCount,
    allRepresentable: representableCount === results.length,
    results,
  }
}
