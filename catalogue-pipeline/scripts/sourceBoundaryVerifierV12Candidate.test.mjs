import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'
import {
  V12_RISK_CATEGORIES,
  V12_AUTHORITY_RESOLUTIONS,
  validateVerifierV12SemanticPayload,
  validateVerifierV12CandidatePayload,
  simulateCandidateRouting,
  createCandidateReplayArtifactWrapper,
  CANDIDATE_OUTPUT_COMPATIBILITY_MATRIX,
  SYNTHETIC_CONTRACT_FIXTURES,
  SCHEMA_FIXTURES,
  evaluatePersistedT2InputsCompatibility,
  evaluateSevereCaseContractWalkthrough,
  evaluateDevelopmentMissesRepresentability,
} from './validateVerifierV12Contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const candidatesDir = path.join(repoRoot, 'catalogue-pipeline/candidates')
const specsDir = path.join(repoRoot, 'catalogue-pipeline/specs')
const outDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

test('1. Exactly one contradiction authority-resolution enum exists', async () => {
  const schema = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'))
  const schemaResolutions = schema.properties.issues.items.properties.authorityResolution.enum

  assert.ok(schemaResolutions.includes('CONTRADICTED_BY_AUTHORITY'), 'Schema enum must include CONTRADICTED_BY_AUTHORITY')
  assert.ok(V12_AUTHORITY_RESOLUTIONS.includes('CONTRADICTED_BY_AUTHORITY'), 'Validator must include CONTRADICTED_BY_AUTHORITY')

  // Check that only ONE contradiction-concept enum exists
  const contradictionResolutions = V12_AUTHORITY_RESOLUTIONS.filter(
    (r) => r.includes('CONTRADICT') || r.includes('CONFLICT')
  )
  assert.deepEqual(contradictionResolutions, ['CONTRADICTED_BY_AUTHORITY'], 'Must have exactly one canonical contradiction resolution')
})

test('2. Deprecated duplicate enum rejected', async () => {
  const schema = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'))
  const prompt = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.md'), 'utf8')

  assert.equal(schema.properties.issues.items.properties.authorityResolution.enum.includes('CONFLICTS_WITH_AUTHORITY'), false)
  assert.equal(V12_AUTHORITY_RESOLUTIONS.includes('CONFLICTS_WITH_AUTHORITY'), false)
  assert.equal(prompt.includes('CONFLICTS_WITH_AUTHORITY'), false)

  const deprecatedFixture = SCHEMA_FIXTURES.negative.find((f) => f.name === 'deprecated_conflicts_with_authority_rejected')
  const res = validateVerifierV12CandidatePayload(deprecatedFixture.payload)
  assert.equal(res.ok, false)
  assert.ok(res.failures.includes('INVALID_ISSUE_AUTHORITY_RESOLUTION_AT_0'))
})

test('3. MATERIAL_FACTUAL_CONFLICT remains a risk category', async () => {
  const schema = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'))
  assert.ok(V12_RISK_CATEGORIES.includes('MATERIAL_FACTUAL_CONFLICT'), 'Validator categories must contain MATERIAL_FACTUAL_CONFLICT')
  assert.ok(schema.properties.riskCategories.items.enum.includes('MATERIAL_FACTUAL_CONFLICT'), 'Schema categories must contain MATERIAL_FACTUAL_CONFLICT')
})

test('4. Materialization addendum binds all accepted spec hashes', async () => {
  const addendum = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'))
  const modelBytes = await readFile(path.join(specsDir, 'source-boundary-authority-model.v1.json'))
  const schemaSpecBytes = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.schema-spec.json'))
  const specDocBytes = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'))

  assert.equal(hashBytes(modelBytes), addendum.boundSpecifications.authorityModel.byteHash)
  assert.equal(hashArtifact(JSON.parse(modelBytes.toString('utf8'))), addendum.boundSpecifications.authorityModel.canonicalArtifactHash)
  assert.equal(hashBytes(schemaSpecBytes), addendum.boundSpecifications.schemaSpec.byteHash)
  assert.equal(hashArtifact(JSON.parse(schemaSpecBytes.toString('utf8'))), addendum.boundSpecifications.schemaSpec.canonicalArtifactHash)
  assert.equal(hashBytes(specDocBytes), addendum.boundSpecifications.contractSpec.byteHash)
})

test('5. Addendum explicitly says policy unchanged', async () => {
  const addendum = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'))
  assert.equal(addendum.status, 'MATERIALIZATION_CLARIFICATION')
  assert.equal(addendum.clarificationScope.isPolicyChange, false)
  assert.equal(addendum.clarificationScope.isSpecificationReplacement, false)
  assert.equal(addendum.nonEffects.noNewRiskCategory, true)
  assert.equal(addendum.nonEffects.noNewClaimClass, true)
  assert.equal(addendum.nonEffects.noRoutingChange, true)
  assert.equal(addendum.nonEffects.noMaterialityPolicyChange, true)
  assert.equal(addendum.nonEffects.noModelBehaviorClaim, true)
})

test('6. Candidate manifest binds addendum', async () => {
  const manifest = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.manifest.json'))
  const addendumBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'))

  assert.ok(manifest.candidateArtifacts.materializationAddendum, 'Manifest must include materializationAddendum binding')
  assert.equal(manifest.candidateArtifacts.materializationAddendum.path, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json')
  assert.equal(hashBytes(addendumBytes), manifest.candidateArtifacts.materializationAddendum.byteHash)
  assert.equal(hashArtifact(JSON.parse(addendumBytes.toString('utf8'))), manifest.candidateArtifacts.materializationAddendum.canonicalArtifactHash)
})

test('7. Unsupported issue requires explicit supportFound:false', async () => {
  const validUnsupportedPayload = {
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
            supportFound: false,
          },
        ],
        authorityResolution: 'UNSUPPORTED_MISSING_AUTHORITY',
        materialityRationale: 'Source does not state auction.',
      },
    ],
    sourceBoundarySatisfied: false,
  }
  const res = validateVerifierV12CandidatePayload(validUnsupportedPayload)
  assert.ok(res.ok, `Expected valid unsupported payload to pass: ${res.failures?.join(', ')}`)
})

test('8. Unsupported evidence with omitted supportFound rejected', () => {
  const missingSupportFoundFixture = SCHEMA_FIXTURES.negative.find((f) => f.name === 'unsupported_missing_support_found')
  const res = validateVerifierV12CandidatePayload(missingSupportFoundFixture.payload)
  assert.equal(res.ok, false)
  assert.ok(res.failures.includes('MISSING_SUPPORT_FOUND_IN_EVIDENCE_AT_0_0'))
})

test('9. Unsupported evidence with supportFound:true rejected', () => {
  const contradictionFixture = SCHEMA_FIXTURES.negative.find((f) => f.name === 'high_risk_semantic_contradiction_unsupported_with_true')
  const res = validateVerifierV12CandidatePayload(contradictionFixture.payload)
  assert.equal(res.ok, false)
  assert.ok(res.failures.includes('RESOLUTION_EVIDENCE_INCOHERENT_UNSUPPORTED_REQUIRES_FALSE_AT_0_0'))
})

test('10. Contradiction requires explicit conflicting evidence', () => {
  const withoutEvidenceFixture = SCHEMA_FIXTURES.negative.find((f) => f.name === 'contradicted_without_conflicting_evidence')
  const res = validateVerifierV12CandidatePayload(withoutEvidenceFixture.payload)
  assert.equal(res.ok, false)
  assert.ok(res.failures.includes('CONTRADICTED_REQUIRES_CONFLICTING_EVIDENCE_AT_0'))

  // Also test contradiction with supportFound: true is rejected
  const conflictWithTrue = {
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
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: true }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction asserted with supportFound=true.',
      },
    ],
    sourceBoundarySatisfied: false,
  }
  const conflictRes = validateVerifierV12CandidatePayload(conflictWithTrue)
  assert.equal(conflictRes.ok, false)
  assert.ok(conflictRes.failures.includes('RESOLUTION_EVIDENCE_INCOHERENT_CONFLICT_CANNOT_HAVE_TRUE_AT_0'))

  // Valid contradiction passes
  const validContradiction = SCHEMA_FIXTURES.positive.find((f) => f.name === 'valid_high_risk_factual_conflict')
  assert.ok(validateVerifierV12CandidatePayload(validContradiction.payload).ok)
})

test('11. Supported resolution requires positive evidence', () => {
  // Supported without positive value fails
  const supportedWithoutValue = {
    riskLevel: 'HIGH_RISK',
    riskCategories: ['VIEWING_EXPERIENCE_INFERENCE'],
    issues: [
      {
        category: 'VIEWING_EXPERIENCE_INFERENCE',
        field: 'vibeSummary',
        claimSpan: 'demands close attention',
        normalizedClaim: 'High attention demand',
        claimType: 'VIEWING_EXPERIENCE_INFERENCE',
        checkedAuthoritySources: ['acceptedSemanticClassification.attentionDemand'],
        sourceEvidence: [{ source: 'acceptedSemanticClassification.attentionDemand', supportFound: true }], // No value!
        authorityResolution: 'SUPPORTED',
        materialityRationale: 'Viewing inference claim.',
      },
    ],
    sourceBoundarySatisfied: false,
  }
  const res = validateVerifierV12CandidatePayload(supportedWithoutValue)
  assert.equal(res.ok, false)
  assert.ok(res.failures.includes('SUPPORTED_REQUIRES_POSITIVE_EVIDENCE_AT_0'))

  // Supported with defect category fails
  const supportedDefect = SCHEMA_FIXTURES.negative.find((f) => f.name === 'supported_with_unauthorized_defect_category')
  const defectRes = validateVerifierV12CandidatePayload(supportedDefect.payload)
  assert.equal(defectRes.ok, false)
  assert.ok(defectRes.failures.includes('SUPPORTED_RESOLUTION_INCOMPATIBLE_WITH_DEFECT_CATEGORY_AT_0'))
})

test('12. Severe-case two issues still validate', () => {
  const severe = evaluateSevereCaseContractWalkthrough()
  assert.equal(severe.status, 'CANDIDATE_CONTRACT_CAN_REPRESENT_KNOWN_SEVERE_FAILURE')
  assert.equal(severe.candidateId, 'scale500-tmdb-14283')
  assert.equal(severe.title, 'The Red Violin')
  assert.equal(severe.hookValid, true)
  assert.equal(severe.descValid, true)
  assert.equal(severe.combinedValid, true)
})

test('13. 16/16 representability preserved', async () => {
  const rep = await evaluateDevelopmentMissesRepresentability({ repoRoot })
  assert.equal(rep.total, 16)
  assert.equal(rep.representableCount, 16)
  assert.equal(rep.allRepresentable, true)
})

test('14. 149/149 input compatibility preserved', async () => {
  const comp = await evaluatePersistedT2InputsCompatibility({ repoRoot })
  assert.equal(comp.inputCompatibility.totalInputs, 149)
  assert.equal(comp.inputCompatibility.compatibleInputs, 149)
  assert.equal(comp.inputCompatibility.incompatibleInputs, 0)
  assert.equal(comp.inputCompatibility.isFullyCompatible, true)
  assert.equal(comp.inputCompatibility.adapterRequired, false)
})

test('15. Offline routing simulation unchanged', () => {
  const validLowRisk = SCHEMA_FIXTURES.positive.find((f) => f.name === 'valid_low_risk_complete_coverage')
  const lowRes = simulateCandidateRouting(validLowRisk.payload)
  assert.equal(lowRes.routed, true)
  assert.equal(lowRes.riskRoutingStatus, 'AUTO_ELIGIBLE')
  assert.equal(lowRes.promotionAuthorized, false)
  assert.equal(lowRes.simulationMode, 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION')

  const validHighRisk = SCHEMA_FIXTURES.positive.find((f) => f.name === 'valid_high_risk_factual_conflict')
  const highRes = simulateCandidateRouting(validHighRisk.payload)
  assert.equal(highRes.routed, true)
  assert.equal(highRes.riskRoutingStatus, 'HUMAN_REVIEW_REQUIRED')
  assert.equal(highRes.promotionAuthorized, false)
  assert.equal(highRes.simulationMode, 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION')

  const malformed = { riskLevel: 'UNKNOWN' }
  const malRes = simulateCandidateRouting(malformed)
  assert.equal(malRes.routed, false)
  assert.equal(malRes.riskRoutingStatus, 'REJECTED_BEFORE_ROUTING')
  assert.equal(malRes.simulationMode, 'OFFLINE_ROUTING_COMPATIBILITY_SIMULATION')
})

test('16. Active v1.1 prompt unchanged', async () => {
  const promptBytes = await readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md'))
  assert.equal(hashBytes(promptBytes), 'sha256:361df6c2f5ca6feb3567c092e3f7bc5de7396f48b52e7a6c8afc9dbf00768123')
})

test('17. Active v1.1 schema unchanged', async () => {
  const schemaBytes = await readFile(path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json'))
  assert.equal(hashBytes(schemaBytes), 'sha256:13edfc9ac97edf4f34739658b388706e8025727512e4fdb0671042c81d423947')
})

test('18. No production routing integration', async () => {
  const routing = await readJson(path.join(outDir, 'routing-manifest.json'))
  assert.equal(routing.trancheId, 'SCALE_TRANCHE_2')

  const liveScript = await readFile(path.join(repoRoot, 'catalogue-pipeline/scripts/scaleTranche2Live.mjs'), 'utf8')
  assert.ok(liveScript.includes("contractVersion: 'source-boundary-risk-verifier.v1.1'"))
  assert.ok(!liveScript.includes('candidates/source-boundary-risk-verifier.v1.2'))
})

test('19. Deterministic candidate artifacts', async () => {
  const manifest = await readJson(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.manifest.json'))
  const promptBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.md'))
  const schemaBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'))
  const validatorBytes = await readFile(path.join(repoRoot, 'catalogue-pipeline/scripts/validateVerifierV12Contract.mjs'))
  const addendumBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'))

  assert.equal(manifest.status, 'CANDIDATE_ONLY')
  assert.equal(manifest.operationalFlags.active, false)
  assert.equal(manifest.operationalFlags.productionAuthorized, false)
  assert.equal(manifest.operationalFlags.modelCalls, 0)
  assert.equal(manifest.operationalFlags.empiricalBehaviorValidated, false)

  assert.equal(hashBytes(promptBytes), manifest.candidateArtifacts.prompt.byteHash)
  assert.equal(hashBytes(schemaBytes), manifest.candidateArtifacts.schema.byteHash)
  assert.equal(hashArtifact(JSON.parse(schemaBytes.toString('utf8'))), manifest.candidateArtifacts.schema.canonicalArtifactHash)
  assert.equal(hashBytes(validatorBytes), manifest.contractValidator.byteHash)
  assert.equal(hashBytes(addendumBytes), manifest.candidateArtifacts.materializationAddendum.byteHash)
  assert.equal(hashArtifact(JSON.parse(addendumBytes.toString('utf8'))), manifest.candidateArtifacts.materializationAddendum.canonicalArtifactHash)
})

test('20. No timestamps', async () => {
  const promptRaw = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.md'), 'utf8')
  const schemaRaw = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'), 'utf8')
  const addendumRaw = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'), 'utf8')
  const manifestRaw = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.manifest.json'), 'utf8')

  const timeRegex = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
  assert.equal(timeRegex.test(promptRaw), false, 'Prompt must contain no timestamps')
  assert.equal(timeRegex.test(schemaRaw), false, 'Schema must contain no timestamps')
  assert.equal(timeRegex.test(addendumRaw), false, 'Addendum must contain no timestamps')
  assert.equal(timeRegex.test(manifestRaw), false, 'Manifest must contain no timestamps')
})

test('21. Governance pause unchanged', async () => {
  const pause = await readJson(path.join(outDir, 'scale-tranche-2-governance-pause.v1.json'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
})
