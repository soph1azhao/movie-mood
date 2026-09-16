import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyRuleHit,
  evaluateDeterministicBoundaryRules,
  GENERIC_VOCABULARIES,
  RULE_AUTHORITY_DECLARATIONS,
  runScaleTranche2OptionBEvaluation
} from './evaluateScaleTranche2DeterministicBoundaryRules.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const baseDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')

test('1. Deterministic output replay: two runs produce identical bytes and hashes', async () => {
  const res1 = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const bytes1 = await readFile(path.join(repoRoot, res1.outPath))

  const res2 = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const bytes2 = await readFile(path.join(repoRoot, res2.outPath))

  assert.equal(res1.hash, res2.hash)
  assert.equal(Buffer.compare(bytes1, bytes2), 0, 'Bytes must be 100% identical on repeated runs')
})

test('2. No wall-clock timestamps in evaluation artifact', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))
  assert.equal(parsed.timestamp, undefined)
})

test('3. Anti-overfit controls: no development film IDs, titles, or character names in rules/vocabularies', async () => {
  const ruleFile = (await readFile(path.join(repoRoot, 'catalogue-pipeline/scripts/evaluateScaleTranche2DeterministicBoundaryRules.mjs'))).toString('utf8')

  const forbiddenIdentifiers = [
    'scale500', 'exp100', 'tmdb-14283', 'tmdb-354556', 'tmdb-445', 'tmdb-11866',
    'tmdb-18129', 'tmdb-22824', 'Red Violin', 'Bussotti', 'Guardians', 'Andreasyan',
    'Caché', 'Haneke', 'Grifters', 'Frears', 'Fourth Kind', 'Osunsanmi', 'Ron Kovic'
  ]

  for (const id of forbiddenIdentifiers) {
    assert.equal(ruleFile.includes(id), false, `Rule source must not contain film identifier '${id}'`)
  }
})

test('4. Candidate labels are derived strictly from human review decisions', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const gapAnalysis = JSON.parse(
    await readFile(path.join(baseDir, 'scale-tranche-2-verifier-gap-analysis.v1.json'), 'utf8')
  )

  for (const cand of parsed.candidateResults) {
    const orig = gapAnalysis.records.find((r) => r.candidateId === cand.candidateId)
    assert.equal(cand.humanDecision, orig.computedFacts.humanDecision)
    assert.equal(cand.humanSeverity, orig.computedFacts.humanSeverity)
  }
})

test('5. Rule hits bind exact source and copy fields with non-empty reasons', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const flagged = parsed.candidateResults.filter((c) => c.deterministicFlagged)
  assert.equal(flagged.length, 4)

  for (const f of flagged) {
    assert.ok(f.ruleHits.length > 0)
    for (const h of f.ruleHits) {
      assert.ok(['curiosityHook', 'description', 'whyWatch', 'vibeSummary'].includes(h.field))
      assert.ok(h.matchedText && h.matchedText.length > 0)
      assert.ok(h.sourceAnchor && h.sourceAnchor.length > 0)
      assert.ok(h.reason && h.reason.length > 0)
      assert.ok(h.concordanceClassification && h.concordanceClassification.length > 0)
      assert.ok(h.concordanceRationale && h.concordanceRationale.length > 0)
    }
  }
})

test('6. Candidate-routing metrics separated from rule-hit metrics and computed correctly', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  // Candidate routing level
  const routing = parsed.candidateRoutingApparentPerformance
  const { tp, fn, fp, tn, total } = routing.confusionMatrix
  assert.equal(total, 30)
  assert.equal(tp + fn + fp + tn, 30)
  assert.equal(tp, 4)
  assert.equal(fp, 0)
  assert.equal(tn, 14)
  assert.equal(fn, 12)
  assert.equal(routing.flaggedReviseCandidatesCount, 4)
  assert.equal(routing.flaggedApproveCandidatesCount, 0)

  assert.equal(routing.metrics.apparentRoutingPPV, '100.0% (4/4 flagged were misses)')
  assert.equal(routing.metrics.apparentRoutingFalsePositiveRate, '0.0% (0/14 clean flagged)')
  assert.equal(routing.metrics.apparentRoutingSpecificity, '100.0% (14/14 clean preserved)')
  assert.equal(routing.metrics.apparentRoutingRecall, '25.0% (4/16 misses caught)')

  // Hit level concordance
  const hitLevel = parsed.hitLevelConcordance
  assert.equal(hitLevel.concordanceCounts.totalRuleHits, 4)
  assert.equal(hitLevel.concordanceCounts.humanConfirmedDefects, 4)
  assert.equal(hitLevel.concordanceCounts.sourceSupportedFalseHits, 0)
  assert.equal(hitLevel.concordanceCounts.unadjudicatedHits, 0)
  assert.equal(hitLevel.concordanceCounts.ambiguousHits, 0)
  assert.equal(hitLevel.concordanceRate, '100.0% (4/4 rule hits human-confirmed defects)')
})

test('7. Per-rule contribution accurately provides both candidate routing and hit concordance views', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const contrib = parsed.perRuleContribution

  // Rule B
  assert.equal(contrib.RULE_B_DURATION_OVERSTATEMENT.candidateRouting.candidatesFlaggedCount, 1)
  assert.equal(contrib.RULE_B_DURATION_OVERSTATEMENT.candidateRouting.missesCaughtCount, 1)
  assert.equal(contrib.RULE_B_DURATION_OVERSTATEMENT.candidateRouting.cleanApprovalsFlaggedCount, 0)
  assert.equal(contrib.RULE_B_DURATION_OVERSTATEMENT.hitLevelConcordance.humanConfirmedDefects, 1)
  assert.equal(contrib.RULE_B_DURATION_OVERSTATEMENT.hitLevelConcordance.sourceSupportedFalseHits, 0)

  // Rule C
  assert.equal(contrib.RULE_C_SUBGENRE_ASSERTION.candidateRouting.candidatesFlaggedCount, 1)
  assert.equal(contrib.RULE_C_SUBGENRE_ASSERTION.candidateRouting.missesCaughtCount, 1)
  assert.equal(contrib.RULE_C_SUBGENRE_ASSERTION.candidateRouting.cleanApprovalsFlaggedCount, 0)
  assert.equal(contrib.RULE_C_SUBGENRE_ASSERTION.hitLevelConcordance.humanConfirmedDefects, 1)

  // Rule D
  assert.equal(contrib.RULE_D_NATIONALITY_GENRE_COLLAPSE.candidateRouting.candidatesFlaggedCount, 1)
  assert.equal(contrib.RULE_D_NATIONALITY_GENRE_COLLAPSE.candidateRouting.missesCaughtCount, 1)
  assert.equal(contrib.RULE_D_NATIONALITY_GENRE_COLLAPSE.candidateRouting.cleanApprovalsFlaggedCount, 0)
  assert.equal(contrib.RULE_D_NATIONALITY_GENRE_COLLAPSE.hitLevelConcordance.humanConfirmedDefects, 1)

  // Rule E
  assert.equal(contrib.RULE_E_EXPLICIT_DEADLINE_CLAIM.candidateRouting.candidatesFlaggedCount, 1)
  assert.equal(contrib.RULE_E_EXPLICIT_DEADLINE_CLAIM.candidateRouting.missesCaughtCount, 1)
  assert.equal(contrib.RULE_E_EXPLICIT_DEADLINE_CLAIM.candidateRouting.cleanApprovalsFlaggedCount, 0)
  assert.equal(contrib.RULE_E_EXPLICIT_DEADLINE_CLAIM.hitLevelConcordance.humanConfirmedDefects, 1)

  // Rule A (0 hits on this cohort)
  assert.equal(contrib.RULE_A_LANGUAGE_CLAIM_SUPPORT.candidateRouting.candidatesFlaggedCount, 0)
  assert.equal(contrib.RULE_A_LANGUAGE_CLAIM_SUPPORT.candidateRouting.missesCaughtCount, 0)
  assert.equal(contrib.RULE_A_LANGUAGE_CLAIM_SUPPORT.hitLevelConcordance.totalHits, 0)
})

test('8. Leave-one-rule-out ablation confirms non-redundancy across all 4 detecting rules', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const abl = parsed.ablationStudy
  assert.equal(abl.without_RULE_B_DURATION_OVERSTATEMENT.deltaTP, -1)
  assert.equal(abl.without_RULE_C_SUBGENRE_ASSERTION.deltaTP, -1)
  assert.equal(abl.without_RULE_D_NATIONALITY_GENRE_COLLAPSE.deltaTP, -1)
  assert.equal(abl.without_RULE_E_EXPLICIT_DEADLINE_CLAIM.deltaTP, -1)
  assert.equal(abl.without_RULE_A_LANGUAGE_CLAIM_SUPPORT.deltaTP, 0)
})

test('9. Development-set terminology enforced and conservative rule statuses applied', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const rawText = (await readFile(path.join(repoRoot, res.outPath))).toString('utf8')
  const parsed = JSON.parse(rawText)

  assert.equal(parsed.datasetClassification, 'RETROSPECTIVE_DEVELOPMENT_SET')
  assert.equal(parsed.dataset.developmentSet, true)
  assert.equal(parsed.dataset.independentValidation, false)

  assert.equal(rawText.includes('validation accuracy'), false)
  assert.equal(rawText.includes('test accuracy'), false)
  assert.equal(rawText.includes('production performance'), false)
  assert.equal(rawText.includes('KEEP_HIGH_CONFIDENCE'), false)
  assert.equal(rawText.includes('PRODUCTION_READY'), false)

  const df = parsed.decisionFramework.ruleClassifications
  assert.equal(df.RULE_A_LANGUAGE_CLAIM_SUPPORT.disposition, 'RETAIN_EXPERIMENTAL')
  assert.equal(df.RULE_B_DURATION_OVERSTATEMENT.disposition, 'PROMISING_DEVELOPMENT_RULE')
  assert.equal(df.RULE_C_SUBGENRE_ASSERTION.disposition, 'PROMISING_DEVELOPMENT_RULE')
  assert.equal(df.RULE_D_NATIONALITY_GENRE_COLLAPSE.disposition, 'PROMISING_DEVELOPMENT_RULE')
  assert.equal(df.RULE_E_EXPLICIT_DEADLINE_CLAIM.disposition, 'PROMISING_DEVELOPMENT_RULE')
})

test('10. False-negative claim does not assert impossibility', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const fnText = parsed.errorAnalysis.falseNegatives.explanation
  assert.equal(fnText.includes('fundamentally unsuited'), false)
  assert.ok(fnText.includes('The current narrow Option B v1 rule families do not cover these 12 human misses.'))
})

test('11. Issue 1 regression: Russian-language authorization-surface semantics', () => {
  // If spokenLanguages contains Russian, Rule A must NOT flag Russian-language
  const recAuthorized = {
    visibleEditorialCopy: { whyWatch: 'It is a Russian-language action-fantasy.' },
    sourceFacts: { spokenLanguages: ['Russian'], countries: ['Russia'] }
  }
  const hitsAuthorized = evaluateDeterministicBoundaryRules(recAuthorized, { activeRules: ['RULE_A'] })
  assert.equal(hitsAuthorized.length, 0, 'Russian-language is authorized when spokenLanguages contains Russian')

  // If spokenLanguages does NOT contain Russian, Rule A MUST flag Russian-language
  const recUnauthorized = {
    visibleEditorialCopy: { whyWatch: 'It is a Russian-language action-fantasy.' },
    sourceFacts: { spokenLanguages: ['English'], countries: ['Russia'] }
  }
  const hitsUnauthorized = evaluateDeterministicBoundaryRules(recUnauthorized, { activeRules: ['RULE_A'] })
  assert.equal(hitsUnauthorized.length, 1, 'Russian-language must be flagged when spokenLanguages lacks Russian')
  assert.equal(hitsUnauthorized[0].ruleId, 'RULE_A_LANGUAGE_CLAIM_SUPPORT')
  assert.equal(hitsUnauthorized[0].matchedText, 'Russian-language')

  // Country of origin does NOT authorize language claim (no cross-field leaking)
  const recCountryOnly = {
    visibleEditorialCopy: { whyWatch: 'It is a Russian-language action-fantasy.' },
    sourceFacts: { spokenLanguages: [], countries: ['Russia'] }
  }
  const hitsCountryOnly = evaluateDeterministicBoundaryRules(recCountryOnly, { activeRules: ['RULE_A'] })
  assert.equal(hitsCountryOnly.length, 1, 'Country of origin alone must not authorize language claim')
})

test('12. Issue 2 regression: "Since the 1960s" vs "decades" generic temporal grounding', () => {
  // Pattern 1: Calendar decade anchor "Since the 1960s" authorizes "decades"
  const rec1960s = {
    visibleEditorialCopy: { description: 'In Nome, Alaska, decades of unsolved disappearances puzzle authorities.' },
    sourceFacts: { overview: 'Since the 1960s, a disproportionate number of the population in and around Nome, Alaska, have gone missing.' }
  }
  const hits1960s = evaluateDeterministicBoundaryRules(rec1960s, { activeRules: ['RULE_B'] })
  assert.equal(hits1960s.length, 0, '"Since the 1960s" semantically authorizes multi-decade term "decades"')

  // Pattern 2: Calendar decade anchor "in the 1980s" authorizes "decades"
  const rec1980s = {
    visibleEditorialCopy: { description: 'For decades, rumors persisted.' },
    sourceFacts: { overview: 'Starting in the 1980s, rumors began spreading.' }
  }
  const hits1980s = evaluateDeterministicBoundaryRules(rec1980s, { activeRules: ['RULE_B'] })
  assert.equal(hits1980s.length, 0, '"1980s" authorizes "decades"')

  // Pattern 3: Multi-decade numeral "40 years" authorizes "decades"
  const rec40Years = {
    visibleEditorialCopy: { description: 'Over decades of conflict, few survived.' },
    sourceFacts: { overview: 'After 40 years of continuous conflict, few survived.' }
  }
  const hits40Years = evaluateDeterministicBoundaryRules(rec40Years, { activeRules: ['RULE_B'] })
  assert.equal(hits40Years.length, 0, '"40 years" authorizes "decades"')

  // Negative case: "For years" does NOT authorize "decades"
  const recYears = {
    visibleEditorialCopy: { curiosityHook: 'After decades living in complete secrecy, can they return?' },
    sourceFacts: { overview: 'For years, the heroes had to hide their identities.' }
  }
  const hitsYears = evaluateDeterministicBoundaryRules(recYears, { activeRules: ['RULE_B'] })
  assert.equal(hitsYears.length, 1, '"For years" must not authorize "decades"')
  assert.equal(hitsYears[0].ruleId, 'RULE_B_DURATION_OVERSTATEMENT')
  assert.equal(hitsYears[0].matchedText, 'decades')
})

test('13. Hit-level concordance classifies defect vs false hit independently from candidate REVISE label', () => {
  // A hit on an approved record is UNADJUDICATED_HIT
  const hitApprove = { ruleId: 'RULE_B_DURATION_OVERSTATEMENT', field: 'curiosityHook', matchedText: 'decades' }
  const recApprove = { humanDecision: 'APPROVE', affectedFields: [], humanReason: '' }
  const resApprove = classifyRuleHit(hitApprove, recApprove)
  assert.equal(resApprove.classification, 'UNADJUDICATED_HIT')

  // A hit on a REVISE record where human reason specifically flagged the defect is HUMAN_CONFIRMED_DEFECT
  const hitConfirmed = { ruleId: 'RULE_B_DURATION_OVERSTATEMENT', field: 'curiosityHook', matchedText: 'decades' }
  const recConfirmed = {
    humanDecision: 'REVISE',
    affectedFields: ['curiosityHook'],
    humanReason: "The hook asserts 'decades' when overview says 'years'; replace 'decades' with 'years'."
  }
  const resConfirmed = classifyRuleHit(hitConfirmed, recConfirmed)
  assert.equal(resConfirmed.classification, 'HUMAN_CONFIRMED_DEFECT')

  // A hit on a REVISE record where the term is source-supported and human flagged other fields is SOURCE_SUPPORTED_FALSE_HIT
  const hitFalse = { ruleId: 'RULE_B_DURATION_OVERSTATEMENT', field: 'description', matchedText: 'decades' }
  const recFalse = {
    humanDecision: 'REVISE',
    affectedFields: ['whyWatch', 'curiosityHook'],
    humanReason: 'Flagged real-world cases in whyWatch and nighttime traumas in curiosityHook. Description faithfully restates overview.',
    sourceFacts: { overview: 'Since the 1960s, a disproportionate number have gone missing.' }
  }
  const resFalse = classifyRuleHit(hitFalse, recFalse)
  assert.equal(resFalse.classification, 'SOURCE_SUPPORTED_FALSE_HIT')
})

test('14. Stage 7: Rule authority surface declarations are complete and forbid external leaks', () => {
  const declarations = RULE_AUTHORITY_DECLARATIONS
  assert.ok(declarations.RULE_A_LANGUAGE_CLAIM_SUPPORT)
  assert.ok(declarations.RULE_B_DURATION_OVERSTATEMENT)
  assert.ok(declarations.RULE_C_SUBGENRE_ASSERTION)
  assert.ok(declarations.RULE_D_NATIONALITY_GENRE_COLLAPSE)
  assert.ok(declarations.RULE_E_EXPLICIT_DEADLINE_CLAIM)

  for (const [id, decl] of Object.entries(declarations)) {
    assert.equal(decl.ruleId, id)
    assert.ok(Array.isArray(decl.copyFieldsInspected) && decl.copyFieldsInspected.length > 0)
    assert.ok(Array.isArray(decl.authorizedSourceFields) && decl.authorizedSourceFields.length > 0)
    assert.ok(Array.isArray(decl.explicitlyForbiddenAuthoritySources) && decl.explicitlyForbiddenAuthoritySources.length > 0)
  }

  // Verify keywords cannot authorize duration or deadline rules
  assert.equal(declarations.RULE_B_DURATION_OVERSTATEMENT.authorizedSourceFields.includes('facts.keywords'), false)
  assert.equal(declarations.RULE_E_EXPLICIT_DEADLINE_CLAIM.authorizedSourceFields.includes('facts.keywords'), false)
})

test('15. Severe case is handled transparently as not detected by deterministic rules', async () => {
  const res = await runScaleTranche2OptionBEvaluation({ repoRoot })
  assert.equal(res.severeDetected, false)

  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))
  assert.equal(parsed.candidateRoutingApparentPerformance.severeCaseStatus.detectedByOptionB, false)
  assert.ok(parsed.candidateRoutingApparentPerformance.severeCaseStatus.finding.includes('Expected non-detection'))
})

test('16. Production routing manifest and queue remain untouched', async () => {
  const routing = JSON.parse(await readFile(path.join(baseDir, 'routing-manifest.json'), 'utf8'))
  assert.equal(routing.records.length, 150)

  for (const cid of ['scale500-tmdb-11866', 'scale500-tmdb-445', 'exp100-tmdb-18129']) {
    const rec = routing.records.find((r) => r.candidateId === cid)
    assert.equal(rec.routingStatus, 'AUTO_ELIGIBLE')
  }
})

test('17. Governance pause artifact remains PAUSED with all gates locked', async () => {
  const pause = JSON.parse(await readFile(path.join(baseDir, 'scale-tranche-2-governance-pause.v1.json'), 'utf8'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.trigger, 'SEVERE_RANDOM_AUDIT_MISS')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
})
