import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const expDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')
const protocolPath = path.join(expDir, 'protocol.v1.json')
const exposurePolicyPath = path.join(expDir, 'development-exposure-policy.v1.json')
const lintReportPath = path.join(expDir, 'prompt-exposure-lint.v1.json')

function sha(filePath) {
  const buf = fs.readFileSync(filePath)
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

test('1. Governance state is exactly PAUSED_FOR_SEVERE_AUDIT_MISS', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
})

test('2. Classification is exactly RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.classification, 'RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION')
})

test('3. Lineage commit and hash bindings are valid', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.lineage.v13ExecutionEvidenceCommit, '4fb22ef')
  assert.equal(proto.lineage.v13RetrospectiveReconciliationCommit, '196b08089e0faa02b4841a6ef4f2ebc4ed13da31')
  assert.equal(proto.lineage.lowThinkingTechnicalReconciliationCommit, 'eade852')
  assert.equal(proto.lineage.semanticFnTaxonomyCommit, '3e7c803')
})

test('4. Taxonomy SHA-256 matches exact frozen artifact', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const expectedSha = 'sha256:b551f5b7aff4ebb8552308858af832e2fc216d5d7eb7d3afc748ad2113e4bf8a'
  assert.equal(proto.lineage.semanticFnTaxonomySha256, expectedSha)
  assert.equal(sha(path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json')), expectedSha)
})

test('5. v1.3 prompt, schema, and validator hashes match exact disk artifacts', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const expectedPromptSha = 'sha256:93c9a185620012609998ad8e58e4c68c9c945fd100820f2cc93c64385cdd402b'
  const expectedSchemaSha = 'sha256:aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc'
  const expectedValidatorSha = 'sha256:258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6'

  assert.equal(proto.lineage.v13Prompt.sha256, expectedPromptSha)
  assert.equal(sha(path.join(repoRoot, proto.lineage.v13Prompt.path)), expectedPromptSha)

  assert.equal(proto.lineage.v13Schema.sha256, expectedSchemaSha)
  assert.equal(sha(path.join(repoRoot, proto.lineage.v13Schema.path)), expectedSchemaSha)

  assert.equal(proto.lineage.v13Validator.sha256, expectedValidatorSha)
  assert.equal(sha(path.join(repoRoot, proto.lineage.v13Validator.path)), expectedValidatorSha)
})

test('6. v1.4 candidate prompt exists on disk', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const v14Path = path.join(repoRoot, proto.lineage.v14Prompt.path)
  assert.ok(fs.existsSync(v14Path))
  assert.equal(sha(v14Path), proto.lineage.v14Prompt.sha256)
})

test('7. Mechanical proof: removing bounded v1.4 semantic block leaves exact frozen v1.3 bytes', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const v13Content = fs.readFileSync(path.join(repoRoot, proto.lineage.v13Prompt.path), 'utf8')
  const v14Content = fs.readFileSync(path.join(repoRoot, proto.lineage.v14Prompt.path), 'utf8')

  const startMarker = '<!-- V1_4_SEMANTIC_GUIDANCE_START -->'
  const endMarker = '<!-- V1_4_SEMANTIC_GUIDANCE_END -->'

  const startMatches = (v14Content.match(new RegExp(startMarker, 'g')) || []).length
  const endMatches = (v14Content.match(new RegExp(endMarker, 'g')) || []).length
  assert.equal(startMatches, 1, 'v1.4 prompt must contain exactly one START marker')
  assert.equal(endMatches, 1, 'v1.4 prompt must contain exactly one END marker')

  const startIndex = v14Content.indexOf(startMarker)
  const endIndex = v14Content.indexOf(endMarker) + endMarker.length
  assert.ok(startIndex < endIndex, 'START marker must precede END marker')

  // Remove the bounded intervention block and its surrounding newline delimiter
  const stripped = v14Content.slice(0, startIndex) + v14Content.slice(endIndex + 2)
  assert.strictEqual(
    stripped,
    v13Content,
    'v1.4 prompt outside the bounded semantic guidance block must be byte-identical to frozen v1.3 prompt'
  )
})

test('8. v1.4 output schema and contract expectations remain unchanged from v1.3', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.controlledVariables.schemaPath, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json')
  assert.equal(proto.controlledVariables.validatorPath, 'catalogue-pipeline/scripts/validateVerifierV13Contract.mjs')
})

test('9. Provider, model, temperature, maxOutputTokens, and timeout are fixed', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.controlledVariables.provider, 'google-gemini-developer-api')
  assert.equal(proto.controlledVariables.modelId, 'gemini-3.8-flash')
  assert.equal(proto.controlledVariables.temperature, 0.0)
  assert.equal(proto.controlledVariables.maxOutputTokens, 6144)
  assert.equal(proto.controlledVariables.timeoutMs, 30000)
})

test('10. thinkingLevel is low in Arm A, Arm A_PRIME, and Arm B', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.arms.armA.thinkingLevel, 'low')
  assert.equal(proto.experimentalDesign.arms.armAPrime.thinkingLevel, 'low')
  assert.equal(proto.experimentalDesign.arms.armB.thinkingLevel, 'low')
})

test('11. Arm A and Arm A_PRIME semantic prompt bindings are identical', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.arms.armA.promptPath, proto.experimentalDesign.arms.armAPrime.promptPath)
  assert.equal(proto.experimentalDesign.arms.armA.promptSha256, proto.experimentalDesign.arms.armAPrime.promptSha256)
})

test('12. Only A-vs-B prompt binding differs semantically', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.notEqual(proto.experimentalDesign.arms.armA.promptPath, proto.experimentalDesign.arms.armB.promptPath)
  assert.notEqual(proto.experimentalDesign.arms.armA.promptSha256, proto.experimentalDesign.arms.armB.promptSha256)
  assert.equal(proto.controlledVariables.semanticRequestDelta, 'v1.3 prompt bytes vs v1.4 prompt bytes. Arm A_PRIME uses byte-identical prompt/request construction to Arm A.')
})

test('13. Automatic retries are strictly 0', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.controlledVariables.automaticRetries, 0)
  assert.equal(proto.experimentalDesign.cohortSpecification.automaticRetries, 0)
  assert.equal(proto.technicalCompletenessGate.automaticRetries, 0)
})

test('14. Target N = 60', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.targetCohortSize, 60)
})

test('15. Defect-positive count = 30', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.defectPositiveCount, 30)
})

test('16. Clean count = 30', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.cleanCount, 30)
})

test('17. Minimum severe defect-positive count = 6', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.minimumSevereCount, 6)
  assert.equal(proto.advancementGates.gateG_SevereSafety.minCohortSevereCount, 6)
})

test('18. Planned total primary calls = 180 (60 x 3)', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.plannedTotalCalls, 180)
})

test('19. Repeatability gates are all 0.90', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const rep = proto.evaluationFramework.repeatabilityControl
  assert.equal(rep.overallAgreementFloor, 0.90)
  assert.equal(rep.defectPositiveAgreementFloor, 0.90)
  assert.equal(rep.cleanAgreementFloor, 0.90)
  assert.equal(proto.advancementGates.gateA_Repeatability.overallAgreementMin, 0.90)
  assert.equal(proto.advancementGates.gateA_Repeatability.defectPositiveAgreementMin, 0.90)
  assert.equal(proto.advancementGates.gateA_Repeatability.cleanAgreementMin, 0.90)
})

test('20. A_PRIME technical completeness thresholds are preregistered', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const rep = proto.evaluationFramework.repeatabilityControl
  assert.equal(rep.armAPrimeTechnicalInvalidMax, 0.05)
  assert.equal(rep.minPairwiseValidAAPrimeDefectPositives, 28)
  assert.equal(rep.minPairwiseValidAAPrimeCleans, 28)
  assert.equal(rep.failureDisposition, 'INCONCLUSIVE_TECHNICAL_OR_STOCHASTIC_INSTABILITY')

  assert.equal(proto.technicalCompletenessGate.armAPrimeTechnicalInvalidMax, 0.05)
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidAAPrimeDefectPositives, 28)
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidAAPrimeCleans, 28)
  assert.equal(proto.technicalCompletenessGate.repeatabilityControlFailureDisposition, 'INCONCLUSIVE_TECHNICAL_OR_STOCHASTIC_INSTABILITY')

  assert.equal(proto.advancementGates.gateA_Repeatability.armAPrimeTechnicalInvalidMax, 0.05)
  assert.equal(proto.advancementGates.gateA_Repeatability.minPairwiseValidAAPrimePositives, 28)
  assert.equal(proto.advancementGates.gateA_Repeatability.minPairwiseValidAAPrimeCleans, 28)
})

test('21. Technical-invalid ceiling rate is 0.05 (5%) for Arm A, Arm B, and Arm A_PRIME', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.technicalCompletenessGate.armATechnicalInvalidMax, 0.05)
  assert.equal(proto.technicalCompletenessGate.armBTechnicalInvalidMax, 0.05)
  assert.equal(proto.technicalCompletenessGate.armAPrimeTechnicalInvalidMax, 0.05)
  assert.equal(proto.advancementGates.gateB_TechnicalIntegrity.armATechnicalInvalidMax, 0.05)
  assert.equal(proto.advancementGates.gateB_TechnicalIntegrity.armBTechnicalInvalidMax, 0.05)
})

test('22. Minimum pairwise-valid defect-positive count is 28 / 30 for A/B and A/A_PRIME', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidABDefectPositives, 28)
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidAAPrimeDefectPositives, 28)
  assert.equal(proto.advancementGates.gateB_TechnicalIntegrity.minPairwiseValidPositives, 28)
})

test('23. Minimum pairwise-valid clean count is 28 / 30 for A/B and A/A_PRIME', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidABCleans, 28)
  assert.equal(proto.technicalCompletenessGate.minPairwiseValidAAPrimeCleans, 28)
  assert.equal(proto.advancementGates.gateB_TechnicalIntegrity.minPairwiseValidCleans, 28)
})

test('24. Arm B sensitivity floor is 0.75', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateC_SensitivityFloor.armBValidPairSensitivityMin, 0.75)
})

test('25. Paired net defect gain threshold is >= 5', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateD_PairedDefectImprovement.minNetDefectGain, 5)
})

test('26. Exact McNemar requires strict LT comparator with p < 0.05', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const statDefect = proto.statisticalPlan.defectPositiveComparison
  assert.equal(statDefect.alpha, 0.05)
  assert.equal(statDefect.pValueComparator, 'LT')
  assert.equal(statDefect.requiredPValueStrictlyLessThan, 0.05)
  assert.ok(statDefect.alternative.includes('rescues > regressions'))

  const gateD = proto.advancementGates.gateD_PairedDefectImprovement
  assert.equal(gateD.pValueComparator, 'LT')
  assert.equal(gateD.requiredPValueStrictlyLessThan, 0.05)

  // Verify strict LT evaluation logic
  const isPassingP = (p) => gateD.pValueComparator === 'LT' && p < gateD.requiredPValueStrictlyLessThan
  assert.equal(isPassingP(0.049), true)
  assert.equal(isPassingP(0.050), false)
  assert.equal(isPassingP(0.051), false)
})

test('27. Specificity floor is 0.85', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateE_SpecificityFloor.armBValidPairSpecificityMin, 0.85)
})

test('28. Introduced false positives ceiling is <= 2', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateF_AntiOverflagging.maxIntroducedFalsePositives, 2)
})

test('29. Net clean harm ceiling is <= 2', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateF_AntiOverflagging.maxNetCleanHarm, 2)
})

test('30. Arm B severe semantic escapes ceiling is 0', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.gateG_SevereSafety.maxArmBSevereSemanticEscapes, 0)
})

test('31. All advancement gates combine with strict logical AND', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.advancementGates.combinationRule, 'STRICT_LOGICAL_AND')
  assert.equal(proto.advancementGates.compensatoryPassingPermitted, false)
})

test('32. Technical-invalid outcomes cannot become semantic true positives', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.evaluationFramework.layerA.invalidHandling, 'Technical-invalid outcomes are NEVER semantic TPs.')
})

test('33. Layer A (Valid Paired Semantics) and Layer B (Fail-Closed Routing) are explicitly separate', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.ok(proto.evaluationFramework.layerA)
  assert.ok(proto.evaluationFramework.layerB)
  assert.notEqual(proto.evaluationFramework.layerA.title, proto.evaluationFramework.layerB.title)
  assert.equal(proto.evaluationFramework.layerB.inflationProhibition, 'Layer B must never be used to inflate semantic sensitivity.')
})

test('34. Seven taxonomy cases are marked DEVELOPMENT_EXPOSED', () => {
  const policy = JSON.parse(fs.readFileSync(exposurePolicyPath, 'utf8'))
  assert.equal(policy.exposedCohorts.sevenSemanticFalseNegatives.exposureStatus, 'DEVELOPMENT_EXPOSED')
  assert.equal(policy.exposedCohorts.sevenSemanticFalseNegatives.cohortSize, 7)
  assert.equal(policy.exposedCohorts.sevenSemanticFalseNegatives.candidateIds.length, 7)
})

test('35. Historical v1.3 replay cohort is excluded from future independent evaluation', () => {
  const policy = JSON.parse(fs.readFileSync(exposurePolicyPath, 'utf8'))
  assert.equal(policy.exposedCohorts.v13ReplayCohort.exposureStatus, 'DEVELOPMENT_EXPOSED')
  assert.equal(policy.exposedCohorts.v13ReplayCohort.cohortSize, 30)
})

test('36. Four technical-ablation candidates are excluded as development-exposed', () => {
  const policy = JSON.parse(fs.readFileSync(exposurePolicyPath, 'utf8'))
  assert.equal(policy.exposedCohorts.fourTechnicalAblationCandidates.exposureStatus, 'DEVELOPMENT_EXPOSED')
  assert.equal(policy.exposedCohorts.fourTechnicalAblationCandidates.cohortSize, 4)
})

test('37. Prospective holdout is marked reserved and inaccessible', () => {
  const policy = JSON.parse(fs.readFileSync(exposurePolicyPath, 'utf8'))
  assert.equal(policy.prospectiveHoldoutFirewall.status, 'RESERVED_PROSPECTIVE_DO_NOT_ACCESS')
})

test('38. Prompt-exposure lint verdict is PROMPT_EXPOSURE_LINT_PASS with exactly 0 blocking and 0 review-required matches', () => {
  const lintReport = JSON.parse(fs.readFileSync(lintReportPath, 'utf8'))
  assert.equal(lintReport.verdict, 'PROMPT_EXPOSURE_LINT_PASS')
  assert.equal(lintReport.blockingMatchCount, 0)
  assert.equal(lintReport.blockingMatches.length, 0)
  assert.equal(lintReport.reviewRequiredMatchCount, 0)
  assert.equal(lintReport.reviewRequiredMatches.length, 0)
})

test('39. No few-shot examples are registered in controlled variables', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.controlledVariables.fewShotExamples, 'none')
})

test('40. Bundled-intervention limitation is explicitly stated', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.ok(proto.methodologicalLimitations.bundledIntervention.includes('bundled semantic prompt intervention'))
})

test('41. Thinking-level interaction limitation is explicitly stated', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.ok(proto.methodologicalLimitations.thinkingLevelInteraction.includes('thinkingLevel=low'))
})

test('42. Balanced-cohort prevalence caveat is explicitly stated', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.ok(proto.methodologicalLimitations.balancedCohortPrevalenceCaveat.includes('CONSTRUCTED_COHORT_DESCRIPTIVE_ONLY'))
})

test('43. Positive development outcome cannot unpause governance', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.ok(proto.governanceConsequence.unpausePolicy.includes('Governance does not unpause even if all development gates pass'))
  assert.equal(proto.governanceConsequence.strongestPossibleAdvancement, 'ELIGIBLE_TO_PREREGISTER_PROSPECTIVE_SEMANTIC_VALIDATION')
})

test('44. Phase P1 contains NO evaluation cohort candidate selection', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.experimentalDesign.cohortSpecification.p1CandidateSelectionStatus, 'NO_EVALUATION_COHORT_SELECTED_IN_P1')
  assert.ok(proto.experimentalDesign.cohortSpecification.p1SelectionNotice.includes('Candidates are not yet selected or inspected'))
  assert.equal(fs.existsSync(path.join(expDir, 'evaluation-cohort.v1.json')), false)
})

test('45. Exact triplet balance: six permutations x 10 = 60 candidates', () => {
  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const sched = proto.providerExecutionControl.schedulePermutations
  assert.equal(sched.totalPermutations, 6)
  assert.equal(sched.exactAllocationPerPermutation, 10)
  assert.equal(sched.totalPlannedRecords, 60)

  const expectedPermutations = [
    'A-A_PRIME-B',
    'A-B-A_PRIME',
    'A_PRIME-A-B',
    'A_PRIME-B-A',
    'B-A-A_PRIME',
    'B-A_PRIME-A',
  ]
  let sum = 0
  for (const p of expectedPermutations) {
    assert.equal(sched.quotas[p], 10, `Quota for permutation ${p} must be exactly 10`)
    sum += sched.quotas[p]
  }
  assert.equal(sum, 60, 'Sum of all permutation quotas must equal exactly 60')
})

test('46. Full exposure-ledger reconciliation is explicitly deferred to P2', () => {
  const policy = JSON.parse(fs.readFileSync(exposurePolicyPath, 'utf8'))
  assert.equal(policy.p2ExposureLedgerReconciliationRequired, true)
  assert.equal(policy.exposedCohorts.developmentFixtures.p2ExposureLedgerReconciliationRequired, true)
  assert.ok(policy.exposedCohorts.developmentFixtures.policy.includes('No candidate may become evaluation-eligible until P2 reconciles'))

  const proto = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(proto.cohortFirewall.p2ExposureLedgerReconciliationRequired, true)
  assert.ok(proto.cohortFirewall.reconciliationPolicy.includes('No candidate may become evaluation-eligible until P2 reconciles'))
})

test('47. Deterministic canonical JSON serialization matches disk bytes for all governed JSON artifacts', () => {
  const files = [protocolPath, exposurePolicyPath, lintReportPath]
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8')
    const parsed = JSON.parse(raw)
    const formatted = JSON.stringify(parsed, null, 2) + '\n'
    assert.equal(raw, formatted, `Canonical serialization mismatch for ${path.basename(f)}`)
  }
})
