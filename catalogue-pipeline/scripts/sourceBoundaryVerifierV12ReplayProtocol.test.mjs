import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const experimentDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay')
const candidatesDir = path.join(repoRoot, 'catalogue-pipeline/candidates')
const outDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

test('1. Valid-output semantic matrix excludes invalid/failure dispositions', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const semanticLayer = protocol.evaluationFramework.layerA_SemanticVerifierPerformance
  assert.equal(semanticLayer.layerId, 'VALID_OUTPUT_APPARENT_RETROSPECTIVE_PERFORMANCE')
  assert.deepEqual(semanticLayer.confusionMatrixDefinitions, {
    TP: 'Human REVISE + VALID_HIGH_RISK',
    FN: 'Human REVISE + VALID_LOW_RISK',
    FP: 'Human APPROVE + VALID_HIGH_RISK',
    TN: 'Human APPROVE + VALID_LOW_RISK',
  })
})

test('2. Failures reported separately with explicit metrics', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const semanticLayer = protocol.evaluationFramework.layerA_SemanticVerifierPerformance
  assert.ok(semanticLayer.reportingRequirements.includes('validOutputCount'))
  assert.ok(semanticLayer.reportingRequirements.includes('invalidOrFailureCount'))
  assert.ok(semanticLayer.reportingRequirements.includes('validOutputRate'))
  assert.ok(semanticLayer.prohibition.includes('Failures must never be counted as TP or TN'))
})

test('3. Operational fail-closed containment routes failures to review', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const operationalLayer = protocol.evaluationFramework.layerB_OperationalFailClosedContainment
  assert.equal(operationalLayer.layerId, 'FAIL_CLOSED_OPERATIONAL_CONTAINMENT')
  assert.equal(operationalLayer.routingSimulation.VALID_HIGH_RISK, 'HUMAN_REVIEW_REQUIRED')
  assert.equal(operationalLayer.routingSimulation.INVALID_OR_PROVIDER_FAILURE, 'HUMAN_REVIEW_REQUIRED / FAIL_CLOSED')
  assert.equal(operationalLayer.routingSimulation.VALID_LOW_RISK, 'AUTO_ELIGIBLE_SIMULATION')
})

test('4. Failures never count as semantic TP', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const operationalLayer = protocol.evaluationFramework.layerB_OperationalFailClosedContainment
  assert.ok(operationalLayer.prohibition.includes('MUST NEVER be described as semantic defect detection or true positive'))
})

test('5. Human APPROVE + failure has explicit operational classification', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const operationalLayer = protocol.evaluationFramework.layerB_OperationalFailClosedContainment
  assert.ok(operationalLayer.reportingRequirements.cleanOverRoutingCountAndRate.includes('Human APPROVE records routed to HUMAN_REVIEW_REQUIRED'))
})

test('6. Exact model identifier frozen to gemini-3.8-flash', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.modelConfiguration.modelId, 'gemini-3.8-flash')
  assert.equal(protocol.modelConfiguration.provider, 'google-gemini-developer-api')
})

test('7. Mismatching GEMINI_MODEL fails closed', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.modelConfiguration.envOverridePolicy, 'FAIL_CLOSED_IF_ENV_GEMINI_MODEL_MISMATCH')
  assert.ok(protocol.callAccounting.hardStopRules.includes('STOP_MODEL_CONFIG_MISMATCH'))
})

test('8. Thinking configuration explicitly resolved and matches historical T2', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.modelConfiguration.thinkingLevel, 'medium')
  assert.equal(protocol.modelConfiguration.maxOutputTokens, 4096)
  assert.ok(protocol.modelConfiguration.thinkingLevelRationale.includes('Historical T2 verifier ran with thinkingLevel medium'))
})

test('9. Temperature 0 not described as deterministic output', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.modelConfiguration.temperature, 0)
  assert.ok(protocol.modelConfiguration.temperatureNote.includes('not assumed byte-deterministic'))
})

test('10. Schema raw byte hash uses actual file bytes', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const rawBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.schema.json'))
  assert.equal(hashBytes(rawBytes), 'sha256:6c21edb0ed18a8febc1c7ec667904719cd9be4e25baf26d3de0ea3284f28b4ff')
  assert.equal(protocol.boundCandidate.schema.byteHash, 'sha256:6c21edb0ed18a8febc1c7ec667904719cd9be4e25baf26d3de0ea3284f28b4ff')
  assert.equal(protocol.boundCandidate.schema.canonicalArtifactHash, 'sha256:3f18f18a458a9dd63767c2bf4bbee1ddeee10828febf609872a0ab7fa51ee14f')
})

test('11. Manifest raw byte hash uses actual file bytes', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const rawBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.manifest.json'))
  assert.equal(hashBytes(rawBytes), 'sha256:c40436b00c8ea4730590fdb9e7922d0bfecdca4c1b79b1dfaad5406599b6fecf')
  assert.equal(protocol.boundCandidate.manifest.byteHash, 'sha256:c40436b00c8ea4730590fdb9e7922d0bfecdca4c1b79b1dfaad5406599b6fecf')
  assert.equal(protocol.boundCandidate.manifest.canonicalArtifactHash, 'sha256:ae55bb5fe4c44b7497669c6b7349acc77468dbe67f04b31865546283c54cfd56')
})

test('12. Addendum raw byte hash uses actual file bytes', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const rawBytes = await readFile(path.join(candidatesDir, 'source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json'))
  assert.equal(hashBytes(rawBytes), 'sha256:f2b6c2313440f5cc8d2c563de23c91ad050f4203383e4c394e8db54bc67c125a')
  assert.equal(protocol.boundCandidate.materializationAddendum.byteHash, 'sha256:f2b6c2313440f5cc8d2c563de23c91ad050f4203383e4c394e8db54bc67c125a')
  assert.equal(protocol.boundCandidate.materializationAddendum.canonicalArtifactHash, 'sha256:acf1e16ce52831880cc295dfb5d1b099b182ee8052c7abf7aa6bc074520a4bb4')
})

test('13. Candidate hashes match accepted checkpoint', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.boundCandidate.prompt.byteHash, 'sha256:f173ba79458c3178e301299632a183fa9cc7138b40f31db0821e9c520af19760')
  assert.equal(protocol.boundCandidate.schema.byteHash, 'sha256:6c21edb0ed18a8febc1c7ec667904719cd9be4e25baf26d3de0ea3284f28b4ff')
  assert.equal(protocol.boundCandidate.schema.canonicalArtifactHash, 'sha256:3f18f18a458a9dd63767c2bf4bbee1ddeee10828febf609872a0ab7fa51ee14f')
  assert.equal(protocol.boundCandidate.validator.byteHash, 'sha256:634cdb4bbb475dc20bc007b090e341cfcee0d956f7ec72c7d908ba238c19b3b6')
  assert.equal(protocol.boundCandidate.materializationAddendum.byteHash, 'sha256:f2b6c2313440f5cc8d2c563de23c91ad050f4203383e4c394e8db54bc67c125a')
  assert.equal(protocol.boundCandidate.materializationAddendum.canonicalArtifactHash, 'sha256:acf1e16ce52831880cc295dfb5d1b099b182ee8052c7abf7aa6bc074520a4bb4')
  assert.equal(protocol.boundCandidate.manifest.byteHash, 'sha256:c40436b00c8ea4730590fdb9e7922d0bfecdca4c1b79b1dfaad5406599b6fecf')
  assert.equal(protocol.boundCandidate.manifest.canonicalArtifactHash, 'sha256:ae55bb5fe4c44b7497669c6b7349acc77468dbe67f04b31865546283c54cfd56')
})

test('14. Systemic failure threshold percentage and count are mathematically consistent', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const rule = protocol.callAccounting.systemicSchemaFailureRule
  assert.equal(rule.ruleId, 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6')
  assert.equal(rule.thresholdCount, 6)
  assert.equal(rule.thresholdPercentage, '>=20% of 30-record cohort')
  assert.equal(6 / 30, 0.20)
})

test('15. Stopping-rule failure classes are explicit', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const rule = protocol.callAccounting.systemicSchemaFailureRule
  assert.deepEqual(rule.includedDispositions, ['SCHEMA_INVALID', 'SEMANTICALLY_INVALID'])
  assert.deepEqual(rule.excludedDispositions, ['PROVIDER_FAILURE', 'MALFORMED_JSON_RETRYABLE_TRANSPORT'])
})

test('16. Cost estimator and pricing binding are explicit', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  const pricing = protocol.callAccounting.costPricingBinding
  assert.equal(pricing.status, 'LOCALLY_FROZEN_BOUND')
  assert.equal(pricing.standardPricesPerMillionTokens.input, 0.75)
  assert.equal(pricing.standardPricesPerMillionTokens.outputIncludingThinking, 3.75)
  assert.equal(pricing.pricingSourceCanonicalHash, 'sha256:6436706662718957e1ede60cecb73896e7af936dbf8abf6fbec4e42eccd10bfc')
  assert.equal(protocol.callAccounting.costCeilingUsd, 0.50)
})

test('17. Replay cannot execute if required pricing binding is absent', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.ok(protocol.callAccounting.costPricingBinding.status !== 'MISSING')
  assert.ok(protocol.callAccounting.hardStopRules.includes('STOP_IF_COST_EXCEEDS_CEILING'))
})

test('18. Cohort manifest never used as model input', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.leakageControl.cohortManifestModelUsage, 'COHORT_MANIFEST_FOR_ANALYSIS_ONLY_NEVER_PASSED_TO_MODEL')
  assert.equal(protocol.leakageControl.modelInputConstructionSource, 'sourceRiskInputPath')
})

test('19. Forbidden human labels absent from model-visible packet', async () => {
  const cohort = await readJson(path.join(experimentDir, 'cohort-manifest.v1.json'))
  const forbiddenKeys = [
    'humanDecision',
    'decision',
    'humanSeverity',
    'severity',
    'humanReason',
    'affectedFields',
    'analystAnnotations',
    'auditMembership',
    'retrospectiveDefectTaxonomy',
    'verifierGapAnnotations',
    'optionBAdjudicationLabels',
    'severeCaseLabels',
  ]

  for (const record of cohort.records) {
    const inputPath = path.join(repoRoot, record.sourceRiskInputPath)
    const rawInput = await readJson(inputPath)

    for (const key of forbiddenKeys) {
      assert.equal(rawInput[key], undefined, `Forbidden key ${key} must not be present in risk-input for ${record.candidateId}`)
    }

    assert.ok(rawInput.facts, `facts must be present for ${record.candidateId}`)
    assert.ok(rawInput.visibleEditorialCopy, `visibleEditorialCopy must be present for ${record.candidateId}`)
    assert.ok(rawInput.allowedSourceMaterial, `allowedSourceMaterial must be present for ${record.candidateId}`)
  }
})

test('20. Cohort remains exactly N=30 / 14 approve / 15 minor / 1 severe', async () => {
  const cohort = await readJson(path.join(experimentDir, 'cohort-manifest.v1.json'))
  assert.equal(cohort.cohortSize, 30)
  assert.equal(cohort.records.length, 30)
  assert.equal(cohort.summary.total, 30)
  assert.equal(cohort.summary.approve, 14)
  assert.equal(cohort.summary.reviseMinor, 15)
  assert.equal(cohort.summary.reviseSevere, 1)
  assert.equal(cohort.summary.reject, 0)
})

test('21. Prospective holdout remains untouched', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.prospectiveHoldoutFirewall.firewallActive, true)
  assert.equal(protocol.datasetClassification, 'RETROSPECTIVE_DEVELOPMENT_SET')
})

test('22. Candidate remains frozen/not active', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.boundCandidate.operationalFlags.active, false)
  assert.equal(protocol.boundCandidate.operationalFlags.productionAuthorized, false)
  assert.equal(protocol.boundCandidate.operationalFlags.empiricalBehaviorValidated, false)
})

test('23. Governance pause unchanged', async () => {
  const pause = await readJson(path.join(outDir, 'scale-tranche-2-governance-pause.v1.json'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
})

test('24. No model execution artifacts exist', async () => {
  const protocol = await readJson(path.join(experimentDir, 'protocol.v1.json'))
  assert.equal(protocol.status, 'PREREGISTERED_NOT_EXECUTED')
  assert.equal(protocol.experimentSafetyConfirmations.modelCallsAuthorized, 0)
  assert.equal(protocol.experimentSafetyConfirmations.networkCallsAuthorized, 0)

  assert.equal(existsSync(path.join(experimentDir, 'execution-ledger.json')), false)
  assert.equal(existsSync(path.join(experimentDir, 'evaluation-results.v1.json')), false)
  assert.equal(existsSync(path.join(experimentDir, 'raw-responses')), false)
  assert.equal(existsSync(path.join(experimentDir, 'parsed-outputs')), false)
})
