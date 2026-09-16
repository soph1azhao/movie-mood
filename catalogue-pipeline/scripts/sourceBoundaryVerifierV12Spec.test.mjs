import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'
import {
  auditVerifierV12SpecificationCoverage,
  VERIFIER_V12_SPEC_LINEAGE,
} from './auditVerifierV12SpecificationCoverage.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const specsDir = path.join(repoRoot, 'catalogue-pipeline/specs')
const outDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

test('1. Active verifier v1.1 prompt is byte-for-byte unchanged', async () => {
  const promptPath = path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md')
  const promptBytes = await readFile(promptPath)
  const h = hashBytes(promptBytes)
  assert.equal(h, VERIFIER_V12_SPEC_LINEAGE.activeVerifierV11PromptHash)
  assert.equal(h, 'sha256:361df6c2f5ca6feb3567c092e3f7bc5de7396f48b52e7a6c8afc9dbf00768123')
})

test('2. Active verifier v1.1 schema is byte-for-byte unchanged', async () => {
  const schemaPath = path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json')
  const schemaBytes = await readFile(schemaPath)
  const h = hashBytes(schemaBytes)
  assert.equal(h, 'sha256:13edfc9ac97edf4f34739658b388706e8025727512e4fdb0671042c81d423947')
  assert.equal(hashArtifact(JSON.parse(schemaBytes.toString('utf8'))), VERIFIER_V12_SPEC_LINEAGE.activeVerifierV11SchemaHash)
})

test('3. No external severe-case plot knowledge across all specification artifacts', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')
  const modelDoc = await readFile(path.join(specsDir, 'source-boundary-authority-model.v1.json'), 'utf8')
  const schemaDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.schema-spec.json'), 'utf8')
  const auditDoc = await readFile(path.join(repoRoot, 'catalogue-pipeline/scripts/auditVerifierV12SpecificationCoverage.mjs'), 'utf8')

  const combined = [specDoc, modelDoc, schemaDoc, auditDoc].join('\n')

  // Prohibit external plot/reveal knowledge regarding The Red Violin
  assert.equal(combined.toLowerCase().includes('wife'), false, 'Must not reference wife or Bussotti\'s wife')
  assert.equal(combined.toLowerCase().includes('blood'), false, 'Must not reference blood in varnish or creation')
  assert.equal(combined.toLowerCase().includes('samuel l. jackson'), false, 'Must not reference external actors')
  assert.equal(combined.toLowerCase().includes('morritz'), false, 'Must not reference character names absent from synopsis')
})

test('4. Severe curiosityHook coverage is source-only', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  assert.ok(
    specDoc.includes("The curiosityHook presupposes that a hidden secret exists and is connected to the instrument's 1681 creation"),
    'Must contain exact source-only curiosityHook premise analysis'
  )
  assert.ok(
    specDoc.includes("The authorized source establishes the creation date and subsequent journey, but does not establish any hidden-origin secret or causal secret-at-creation premise"),
    'Must establish authorized journey vs ungrounded secret-at-creation premise'
  )
})

test('5. "Ahead of auction" is not misclassified as auction-house LOCATION', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  // Prohibit misclassification as auction house location
  assert.equal(specDoc.toLowerCase().includes('auction house setting'), false, 'Must not classify as auction house setting')
  assert.equal(specDoc.toLowerCase().includes('auction house location'), false, 'Must not classify as auction house location')

  assert.ok(
    specDoc.includes('"Ahead of auction" introduces a concrete story-context/event detail not authorized by the applicable story-source surface'),
    'Must classify ahead of auction as concrete story-context/event detail'
  )
  assert.ok(specDoc.includes('Claim Type: `STORY_SETUP_FACT`'), 'Must classify ahead of auction under STORY_SETUP_FACT')
})

test('6. Observable contract defects separated from causal hypotheses', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  // Prohibit unobservable causal model claims
  assert.equal(specDoc.includes('parsed copy as isolated declarative sentences'), false, 'Must not make unobservable internal parser claims')
  assert.equal(specDoc.includes('served as an open-ended loophole'), false, 'Must not use loophole causal language')
  assert.equal(specDoc.includes('caused the model to hallucinate'), false, 'Must not hypothesize model hallucination causes')

  assert.ok(
    specDoc.includes('Verifier v1.1 did not explicitly require extraction and verification of factual presuppositions embedded in interrogative sentences'),
    'Must use evidence-grounded contract defect formulation for interrogatives'
  )
  assert.ok(
    specDoc.includes('The v1.1 carve-out was compatible with known false negatives involving deadline, genre, and atmospheric specificity'),
    'Must use evidence-grounded contract defect formulation for carve-outs'
  )
})

test('7. Premature numeric replay thresholds removed and replaced by threshold-setting principles', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  // Prohibit unjustified numeric replay targets
  assert.equal(specDoc.includes('Target \\ge 80%'), false, 'Must not contain premature numeric 80% target')
  assert.equal(specDoc.includes('Target 100% (zero severe misses'), false, 'Must not contain premature 100% severe target')
  assert.equal(specDoc.includes('>= 80%'), false, 'Must not contain numeric thresholds')

  // Verify threshold-setting principles
  assert.ok(specDoc.includes('Threshold-Setting Principles'), 'Must include threshold-setting principles')
  assert.ok(specDoc.includes('Holdout Size'), 'Must consider holdout size')
  assert.ok(specDoc.includes('Statistical Uncertainty'), 'Must consider statistical uncertainty')
  assert.ok(specDoc.includes('Governance Tolerance for Severe Misses'), 'Must consider governance tolerance')
  assert.ok(specDoc.includes('Economic Constraints'), 'Must consider economic constraints')
})

test('8. Severe miss represented as governance safety gate, not 100% sensitivity claim', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  assert.ok(
    specDoc.includes('Any observed SEVERE human miss that passed automated AUTO eligibility triggers fail-closed escalation under the applicable governance policy'),
    'Must define severe safety gate'
  )
  assert.ok(
    specDoc.includes('This is a deterministic governance safety gate, not a claim of statistically measured 100% severe sensitivity'),
    'Must state that safety rule is a governance gate, not a 100% sensitivity claim'
  )
})

test('9. Option B/A interaction marked PROVISIONAL_INTERACTION_POLICY', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  assert.ok(specDoc.includes('PROVISIONAL_INTERACTION_POLICY'), 'Must label policy PROVISIONAL_INTERACTION_POLICY')
  assert.ok(specDoc.includes('Neither mode is authorized for production routing'), 'Must confirm not authorized for production')
})

test('10. Both evidence-supplier and hard-gate replay modes specified', async () => {
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  assert.ok(specDoc.includes('MODE A — EVIDENCE SUPPLIER'), 'Must specify Mode A')
  assert.ok(specDoc.includes('MODE B — HARD GATE SIMULATION'), 'Must specify Mode B')
  assert.ok(specDoc.includes('deterministicLintFindings'), 'Must include structured findings for Mode A')
  assert.ok(specDoc.includes('Mandatory HUMAN_REVIEW route'), 'Must include hard gate for Mode B')
})

test('11. 16/16 coverage explicitly marked DEVELOPMENT_SET_STATIC_SPECIFICATION_COVERAGE', async () => {
  const audit = await auditVerifierV12SpecificationCoverage({ repoRoot })
  assert.equal(audit.coverageClassification, 'DEVELOPMENT_SET_STATIC_SPECIFICATION_COVERAGE')
  assert.equal(audit.totalMisses, 16)
  assert.equal(audit.coveredCount, 16)
  assert.equal(audit.allCovered, true)

  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')
  assert.ok(specDoc.includes('DEVELOPMENT_SET_STATIC_SPECIFICATION_COVERAGE'))
  assert.ok(specDoc.includes('What this does NOT mean'))
  assert.ok(specDoc.includes('MUST NOT be expressed as empirical recall or precision'))
})

test('12. Unsupported claims distinguished from conflicting claims', async () => {
  const model = await readJson(path.join(specsDir, 'source-boundary-authority-model.v1.json'))
  const schemaSpec = await readJson(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.schema-spec.json'))
  const specDoc = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  assert.ok(schemaSpec.properties.riskCategories.items.enum.includes('UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'))
  assert.ok(schemaSpec.properties.issues.items.properties.category.enum.includes('UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'))

  assert.equal(
    model.claimClassDefinitions.LANGUAGE_CLAIM.materialityConsequence,
    'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'
  )
  assert.equal(
    model.claimClassDefinitions.NATIONALITY_OR_PRODUCTION_COUNTRY.materialityConsequence,
    'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM'
  )

  assert.ok(specDoc.includes('Unsupported Claim != Conflicting Claim'))
})

test('13. LOW_RISK contract covers all material claim groups', async () => {
  const schemaSpec = await readJson(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.schema-spec.json'))
  const lowRisk = schemaSpec.properties.lowRiskCoverage

  const expectedFields = [
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
    'summaryRationale'
  ]

  for (const f of expectedFields) {
    assert.ok(lowRisk.required.includes(f), `Missing required lowRiskCoverage field: ${f}`)
    assert.ok(lowRisk.properties[f], `Missing property definition: ${f}`)
  }
})

test('14. Source-authority matrix covers all 17 defined claim classes', async () => {
  const model = await readJson(path.join(specsDir, 'source-boundary-authority-model.v1.json'))
  const claimClasses = Object.keys(model.claimClassDefinitions)

  assert.equal(claimClasses.length, 17)
  const expectedClasses = [
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
    'SPECULATIVE_HOOK_PREMISE'
  ]

  for (const c of expectedClasses) {
    assert.ok(claimClasses.includes(c), `Missing claim class ${c}`)
  }
})

test('15. Governance pause remains unchanged with all gates locked', async () => {
  const pause = await readJson(path.join(outDir, 'scale-tranche-2-governance-pause.v1.json'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
})

test('16. Deterministic artifact replay across repeated evaluations', async () => {
  const run1 = await auditVerifierV12SpecificationCoverage({ repoRoot })
  const run2 = await auditVerifierV12SpecificationCoverage({ repoRoot })

  assert.deepEqual(run1, run2, 'Audit results must be deterministically identical')
})

test('17. No wall-clock timestamps in specification artifacts', async () => {
  const modelRaw = await readFile(path.join(specsDir, 'source-boundary-authority-model.v1.json'), 'utf8')
  const schemaRaw = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.schema-spec.json'), 'utf8')
  const specRaw = await readFile(path.join(specsDir, 'source-boundary-risk-verifier.v1.2.spec.md'), 'utf8')

  const timeRegex = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
  assert.equal(timeRegex.test(modelRaw), false, 'Authority model must contain no timestamps')
  assert.equal(timeRegex.test(schemaRaw), false, 'Schema spec must contain no timestamps')
  assert.equal(timeRegex.test(specRaw), false, 'Spec doc must contain no timestamps')
})
