import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  V13_RISK_CATEGORIES,
  V13_CLAIM_TYPES,
  V13_AUTHORITY_RESOLUTIONS,
  V13_COPY_FIELDS,
  V13_LOW_RISK_COVERAGE_FIELDS,
  validateVerifierV13CandidatePayload,
  auditProviderSchemaKeywords,
} from './validateVerifierV13Contract.mjs'
import {
  V12_RISK_CATEGORIES,
  V12_CLAIM_TYPES,
  V12_AUTHORITY_RESOLUTIONS,
  V12_COPY_FIELDS,
  V12_LOW_RISK_COVERAGE_FIELDS,
} from './validateVerifierV12Contract.mjs'
import {
  validateVerifierV13OutputPipeline,
  validateJsonSchema,
  CANDIDATE_SCHEMA_PATH,
} from './runVerifierV13RetrospectiveReplay.mjs'

test('Exact semantic parity between v1.2 and v1.3 enums and field lists', () => {
  assert.deepEqual(V13_RISK_CATEGORIES, V12_RISK_CATEGORIES, 'Risk categories must match v1.2 exactly')
  assert.deepEqual(V13_CLAIM_TYPES, V12_CLAIM_TYPES, 'Claim types must match v1.2 exactly')
  assert.deepEqual(V13_AUTHORITY_RESOLUTIONS, V12_AUTHORITY_RESOLUTIONS, 'Authority resolutions must match v1.2 exactly')
  assert.deepEqual(V13_COPY_FIELDS, V12_COPY_FIELDS, 'Copy fields must match v1.2 exactly')
  assert.deepEqual(V13_LOW_RISK_COVERAGE_FIELDS, V12_LOW_RISK_COVERAGE_FIELDS, 'LOW coverage fields must match v1.2 exactly')
})

test('Provider schema keyword audit passes on v1.3 schema and rejects disallowed keywords', async () => {
  const schemaRaw = await readFile(CANDIDATE_SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(schemaRaw)

  const violations = auditProviderSchemaKeywords(schema)
  assert.equal(violations.length, 0, `Schema has disallowed keywords: ${JSON.stringify(violations)}`)

  // Check rejection on mock schemas with disallowed keywords
  assert.ok(auditProviderSchemaKeywords({ allOf: [] }).length > 0)
  assert.ok(auditProviderSchemaKeywords({ if: {}, then: {} }).length > 0)
  assert.ok(auditProviderSchemaKeywords({ const: 'test' }).length > 0)
  assert.ok(auditProviderSchemaKeywords({ uniqueItems: true }).length > 0)
  assert.ok(auditProviderSchemaKeywords({ minLength: 1 }).length > 0)
  assert.ok(auditProviderSchemaKeywords({ $schema: 'http://...' }).length > 0)
})

test('sourceEvidence preserves permissive arbitrary JSON types (number, array, object)', () => {
  const payloadNumber = {
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
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction of runtime.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  assert.equal(validateVerifierV13CandidatePayload(payloadNumber).ok, true)

  const payloadArray = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
    issues: [
      {
        category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
        field: 'whyWatch',
        claimSpan: 'Russian-language action',
        normalizedClaim: 'Language is Russian',
        claimType: 'LANGUAGE_CLAIM',
        checkedAuthoritySources: ['facts.spokenLanguages'],
        sourceEvidence: [{ source: 'facts.spokenLanguages', value: ['Russian'], supportFound: false }],
        authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
        materialityRationale: 'Language unsupported.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  assert.equal(validateVerifierV13CandidatePayload(payloadArray).ok, true)

  const payloadObject = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM'],
    issues: [
      {
        category: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
        field: 'description',
        claimSpan: '10-minute bomb',
        normalizedClaim: 'Bomb explodes in 10 minutes',
        claimType: 'TEMPORAL_OR_DURATION_CONSTRAINT',
        checkedAuthoritySources: ['acceptedSemanticClassification'],
        sourceEvidence: [{ source: 'acceptedSemanticClassification', value: { moods: ['tense'] }, supportFound: false }],
        authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
        materialityRationale: 'Temporal deadline unsupported.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  assert.equal(validateVerifierV13CandidatePayload(payloadObject).ok, true)
})

test('Complete sourceEvidence tri-state contract validation', () => {
  // 1. SUPPORTED requires all supportFound === true and positive evidence
  const validSupported = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL'],
    issues: [
      {
        category: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
        field: 'description',
        claimSpan: 'some scene detail',
        normalizedClaim: 'Scene detail claim',
        claimType: 'STORY_SETUP_FACT',
        checkedAuthoritySources: ['allowedSourceMaterial.overview'],
        sourceEvidence: [{ source: 'allowedSourceMaterial.overview', value: 'detail in overview', supportFound: true }],
        authorityResolution: 'SUPPORTED',
        materialityRationale: 'Detail is authorized.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  assert.equal(validateVerifierV13CandidatePayload(validSupported).ok, true)

  // Incompatible with defect category
  const invalidDefectWithSupported = {
    ...validSupported,
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [{ ...validSupported.issues[0], category: 'MATERIAL_FACTUAL_CONFLICT' }],
  }
  const defectRes = validateVerifierV13CandidatePayload(invalidDefectWithSupported)
  assert.equal(defectRes.ok, false)
  assert.ok(defectRes.failures.includes('SUPPORTED_RESOLUTION_INCOMPATIBLE_WITH_DEFECT_CATEGORY_AT_0'))

  // 2. UNSUPPORTED requires all supportFound === false
  const invalidUnsupportedWithTrue = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'],
    issues: [
      {
        category: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
        field: 'whyWatch',
        claimSpan: 'Russian action',
        normalizedClaim: 'Language is Russian',
        claimType: 'LANGUAGE_CLAIM',
        checkedAuthoritySources: ['facts.spokenLanguages'],
        sourceEvidence: [{ source: 'facts.spokenLanguages', supportFound: true }], // Invalid!
        authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
        materialityRationale: 'Unsupported claim.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  const unsuppRes = validateVerifierV13CandidatePayload(invalidUnsupportedWithTrue)
  assert.equal(unsuppRes.ok, false)
  assert.ok(unsuppRes.failures.includes('RESOLUTION_EVIDENCE_INCOHERENT_UNSUPPORTED_REQUIRES_FALSE_AT_0_0'))

  // 3. CONTRADICTED requires conflicting evidence and no supportFound === true
  const invalidContradictedWithoutConflict = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', supportFound: false }], // No conflicting value!
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction asserted.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  }
  const conflictRes = validateVerifierV13CandidatePayload(invalidContradictedWithoutConflict)
  assert.equal(conflictRes.ok, false)
  assert.ok(conflictRes.failures.includes('CONTRADICTED_REQUIRES_CONFLICTING_EVIDENCE_AT_0'))
})

test('LOW_RISK and HIGH_RISK semantic validation contracts', () => {
  const validLow = {
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
      summaryRationale: 'Clean copy grounded strictly in packet facts.',
    },
  }
  assert.equal(validateVerifierV13CandidatePayload(validLow).ok, true)

  // LOW null coverage fails
  const lowNullCoverage = { ...validLow, lowRiskCoverage: null }
  assert.equal(validateVerifierV13CandidatePayload(lowNullCoverage).ok, false)

  // LOW false flag fails
  const lowFalseFlag = {
    ...validLow,
    lowRiskCoverage: { ...validLow.lowRiskCoverage, settingAndLocationAudited: false },
  }
  const falseFlagRes = validateVerifierV13CandidatePayload(lowFalseFlag)
  assert.equal(falseFlagRes.ok, false)
  assert.ok(falseFlagRes.failures.includes('LOW_RISK_COVERAGE_FIELD_NOT_TRUE:settingAndLocationAudited'))

  // HIGH non-null coverage fails
  const highWithCoverage = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: validLow.lowRiskCoverage, // Invalid!
  }
  const highCoverageRes = validateVerifierV13CandidatePayload(highWithCoverage)
  assert.equal(highCoverageRes.ok, false)
  assert.ok(highCoverageRes.failures.includes('HIGH_RISK_REQUIRES_NULL_COVERAGE'))

  // Duplicate category fails
  const duplicateCategory = {
    ...highWithCoverage,
    lowRiskCoverage: null,
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT', 'MATERIAL_FACTUAL_CONFLICT'],
  }
  const dupRes = validateVerifierV13CandidatePayload(duplicateCategory)
  assert.equal(dupRes.ok, false)
  assert.ok(dupRes.failures.includes('DUPLICATE_RISK_CATEGORIES'))

  // Category-set mismatch fails
  const categoryMismatch = {
    ...highWithCoverage,
    lowRiskCoverage: null,
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT', 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'], // extra category!
  }
  const mismatchRes = validateVerifierV13CandidatePayload(categoryMismatch)
  assert.equal(mismatchRes.ok, false)
  assert.ok(mismatchRes.failures.includes('CATEGORY_SET_MISMATCH'))

  // Empty string in claimSpan fails
  const emptyClaimSpan = {
    ...highWithCoverage,
    lowRiskCoverage: null,
    issues: [{ ...highWithCoverage.issues[0], claimSpan: '' }],
  }
  assert.equal(validateVerifierV13CandidatePayload(emptyClaimSpan).ok, false)
})
