import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FROZEN_BINDINGS,
  MATERIALITY_POLICY,
  analyzeScaleTranche2HumanDecisions,
  buildDecisionTemplate,
  buildHumanReviewMarkdown,
  buildScaleTranche2TargetedRepairPlan,
  createGovernancePauseArtifact,
  getHistoricalScaleTranche2HumanDecisions,
  prepareScaleTranche2HumanReview,
  recordHumanDecision,
  resolveEffectiveScaleTranche2HumanDecisions,
  validateBlindPackets,
  validateHumanReviewDecisions,
} from './scaleTranche2HumanReview.mjs'
import {
  createApprovedCorrectionArtifact,
  verifyApprovalTarget,
} from './applyScaleTranche2AdjudicationCorrection.mjs'
import { buildScaleTranche2GapAnalysisV11 } from './generateScaleTranche2GapAnalysis.mjs'
import { runScaleTranche2OptionBEvaluationV11 } from './evaluateScaleTranche2DeterministicBoundaryRules.mjs'
import { hashArtifact, hashBytes } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

test('1. Exact 33-person review roster and blind packet <-> queue identity equality', async () => {
  const blindPackets = await readJson(path.join(outDir, 'human-review-blind-packets.v1.json'))
  const queue = await readJson(path.join(outDir, 'human-review-queue.json'))

  assert.equal(blindPackets.recordCount, 33)
  assert.equal(blindPackets.records.length, 33)
  assert.equal(queue.count, 33)
  assert.equal(queue.records.length, 33)

  const blindIds = new Set(blindPackets.records.map((r) => r.candidateId))
  const queueIds = new Set(queue.records.map((r) => r.candidateId))
  assert.equal(blindIds.size, 33)
  assert.equal(queueIds.size, 33)

  for (const id of blindIds) {
    assert.ok(queueIds.has(id), `Candidate ${id} in blind packets must be in queue`)
  }

  assert.equal(hashArtifact(blindPackets), FROZEN_BINDINGS.blindPacketHash)
  assert.equal(hashArtifact(queue), FROZEN_BINDINGS.queueHash)
})

test('2. No forbidden blind fields leaked into reviewer packets or markdown guide', async () => {
  const blindPackets = await readJson(path.join(outDir, 'human-review-blind-packets.v1.json'))
  const validation = validateBlindPackets(blindPackets)
  assert.equal(validation.ok, true, `Validation failed: ${validation.failures.join('; ')}`)

  const markdown = await readFile(path.join(outDir, 'HUMAN_REVIEW_PACKET.md'), 'utf8')
  assert.equal(markdown.includes('AUTO_ELIGIBLE'), false, 'Markdown must not contain AUTO_ELIGIBLE')
  assert.equal(markdown.includes('HIGH_RISK'), false, 'Markdown must not contain HIGH_RISK')
  assert.equal(markdown.includes('AUDIT_SAMPLE'), false, 'Markdown must not contain AUDIT_SAMPLE')
  assert.equal(markdown.includes('routingStatus'), false, 'Markdown must not contain routingStatus')
  assert.equal(markdown.includes('riskLevel'), false, 'Markdown must not contain riskLevel')
})

test('3. Decision template conforms to schema, bounds all 33 records, and binds exact hashes', async () => {
  const decisions = await readJson(path.join(outDir, 'human-review-decisions.v1.json'))
  const blindPackets = await readJson(path.join(outDir, 'human-review-blind-packets.v1.json'))

  const validation = validateHumanReviewDecisions(decisions, blindPackets)
  assert.equal(validation.ok, true, `Decisions validation failed: ${validation.failures.join('; ')}`)
  assert.equal(decisions.records.length, 33)

  for (let idx = 0; idx < 33; idx += 1) {
    const dec = decisions.records[idx]
    const blind = blindPackets.records[idx]
    assert.equal(dec.blindOrdinal, idx + 1)
    assert.equal(dec.candidateId, blind.candidateId)
    assert.equal(dec.tmdbId, blind.tmdbId)
    assert.equal(dec.reviewedArtifactHash, hashArtifact(blind))
    assert.equal(dec.reviewedRecordHash, hashArtifact(blind))
    assert.equal(dec.blindPacketHash, hashArtifact(blindPackets))
    assert.equal(dec.policyVersion, MATERIALITY_POLICY.policyId)
  }
})

test('4. APPROVE cannot contain replacement copy or affected fields', () => {
  const dummyBlind = {
    recordCount: 1,
    records: [{ blindOrdinal: 1, candidateId: 'cand-1', tmdbId: 101, visibleEditorialCopy: {} }],
  }
  const dummyLedger = {
    recordCount: 1,
    blindPacketBinding: { hash: hashArtifact(dummyBlind) },
    records: [
      {
        blindOrdinal: 1,
        candidateId: 'cand-1',
        tmdbId: 101,
        decision: 'APPROVE',
        severity: 'NONE',
        materialitySeverity: 'NONE',
        affectedFields: ['description'],
        fieldsToRevise: ['description'],
        reason: null,
        replacementCopy: 'some copy',
        reviewedArtifactHash: hashArtifact(dummyBlind.records[0]),
        reviewedRecordHash: hashArtifact(dummyBlind.records[0]),
      },
    ],
  }

  const res = validateHumanReviewDecisions(dummyLedger, dummyBlind)
  assert.equal(res.ok, false)
  assert.ok(res.failures.some((f) => f.includes('APPROVE_CANNOT_HAVE_REPLACEMENT_COPY')))
  assert.ok(res.failures.some((f) => f.includes('APPROVE_CANNOT_HAVE_AFFECTED_FIELDS')))
})

test('5. REVISE requires affected fields and concise reason', () => {
  const dummyBlind = {
    recordCount: 1,
    records: [{ blindOrdinal: 1, candidateId: 'cand-1', tmdbId: 101, visibleEditorialCopy: {} }],
  }
  const dummyLedger = {
    recordCount: 1,
    blindPacketBinding: { hash: hashArtifact(dummyBlind) },
    records: [
      {
        blindOrdinal: 1,
        candidateId: 'cand-1',
        tmdbId: 101,
        decision: 'REVISE',
        severity: 'MINOR',
        materialitySeverity: 'MINOR',
        affectedFields: [],
        fieldsToRevise: [],
        reason: '',
        replacementCopy: null,
        reviewedArtifactHash: hashArtifact(dummyBlind.records[0]),
        reviewedRecordHash: hashArtifact(dummyBlind.records[0]),
      },
    ],
  }

  const res = validateHumanReviewDecisions(dummyLedger, dummyBlind)
  assert.equal(res.ok, false)
  assert.ok(res.failures.some((f) => f.includes('REVISE_REQUIRES_AFFECTED_FIELDS')))
  assert.ok(res.failures.some((f) => f.includes('REVISE_REQUIRES_NON_EMPTY_REASON')))
})

test('6. REJECT requires reason', () => {
  const dummyBlind = {
    recordCount: 1,
    records: [{ blindOrdinal: 1, candidateId: 'cand-1', tmdbId: 101, visibleEditorialCopy: {} }],
  }
  const dummyLedger = {
    recordCount: 1,
    blindPacketBinding: { hash: hashArtifact(dummyBlind) },
    records: [
      {
        blindOrdinal: 1,
        candidateId: 'cand-1',
        tmdbId: 101,
        decision: 'REJECT',
        severity: 'SEVERE',
        materialitySeverity: 'SEVERE',
        affectedFields: [],
        fieldsToRevise: [],
        reason: null,
        replacementCopy: null,
        reviewedArtifactHash: hashArtifact(dummyBlind.records[0]),
        reviewedRecordHash: hashArtifact(dummyBlind.records[0]),
      },
    ],
  }

  const res = validateHumanReviewDecisions(dummyLedger, dummyBlind)
  assert.equal(res.ok, false)
  assert.ok(res.failures.some((f) => f.includes('REJECT_REQUIRES_NON_EMPTY_REASON')))
})

test('7. Duplicate human decisions fail validation', () => {
  const dummyBlind = {
    recordCount: 2,
    records: [
      { blindOrdinal: 1, candidateId: 'cand-1', tmdbId: 101 },
      { blindOrdinal: 2, candidateId: 'cand-2', tmdbId: 102 },
    ],
  }
  const dummyLedger = {
    recordCount: 2,
    blindPacketBinding: { hash: hashArtifact(dummyBlind) },
    records: [
      {
        blindOrdinal: 1,
        candidateId: 'cand-1',
        tmdbId: 101,
        decision: 'APPROVE',
        severity: 'NONE',
        materialitySeverity: 'NONE',
        affectedFields: [],
        fieldsToRevise: [],
        reason: null,
        replacementCopy: null,
        reviewedArtifactHash: hashArtifact(dummyBlind.records[0]),
        reviewedRecordHash: hashArtifact(dummyBlind.records[0]),
      },
      {
        blindOrdinal: 2,
        candidateId: 'cand-1',
        tmdbId: 102,
        decision: 'APPROVE',
        severity: 'NONE',
        materialitySeverity: 'NONE',
        affectedFields: [],
        fieldsToRevise: [],
        reason: null,
        replacementCopy: null,
        reviewedArtifactHash: hashArtifact(dummyBlind.records[1]),
        reviewedRecordHash: hashArtifact(dummyBlind.records[1]),
      },
    ],
  }

  const res = validateHumanReviewDecisions(dummyLedger, dummyBlind)
  assert.equal(res.ok, false)
  assert.ok(res.failures.some((f) => f.includes('DUPLICATE_DECISION_RECORD') || f.includes('RECORD_IDENTITY_MISMATCH')))
})

test('8. Reviewed artifact freshness rejects mutated visible records', () => {
  const dummyBlind = {
    recordCount: 1,
    records: [{ blindOrdinal: 1, candidateId: 'cand-1', tmdbId: 101, visibleEditorialCopy: { description: 'orig' } }],
  }
  const dummyLedger = {
    recordCount: 1,
    blindPacketBinding: { hash: hashArtifact(dummyBlind) },
    records: [
      {
        blindOrdinal: 1,
        candidateId: 'cand-1',
        tmdbId: 101,
        decision: 'APPROVE',
        severity: 'NONE',
        materialitySeverity: 'NONE',
        affectedFields: [],
        fieldsToRevise: [],
        reason: null,
        replacementCopy: null,
        reviewedArtifactHash: 'sha256:stalehash',
        reviewedRecordHash: 'sha256:stalehash',
      },
    ],
  }

  const res = validateHumanReviewDecisions(dummyLedger, dummyBlind)
  assert.equal(res.ok, false)
  assert.ok(res.failures.some((f) => f.includes('REVIEWED_ARTIFACT_HASH_DRIFT')))
})

test('9. Audit denominator is exactly 30 and HIGH_RISK records are excluded from audit miss rate', async () => {
  const analysis = await analyzeScaleTranche2HumanDecisions({ repoRoot })

  assert.equal(analysis.auditSampleAnalysis.denominator, 30)
  assert.equal(analysis.auditSampleAnalysis.counts.total, 30)
  assert.equal(analysis.auditSampleAnalysis.counts.approve, 14)
  assert.equal(analysis.auditSampleAnalysis.counts.reviseMinor, 15)
  assert.equal(analysis.auditSampleAnalysis.counts.reviseSevere, 1)
  assert.equal(analysis.auditSampleAnalysis.counts.reject, 0)

  // Severe miss rate in random audit
  assert.equal(analysis.auditSampleAnalysis.rates.severeMissRatePercent, (1 / 30) * 100)

  // High risk denominator is exactly 3 and strictly separate
  assert.equal(analysis.highRiskAnalysis.denominator, 3)
  assert.equal(analysis.highRiskAnalysis.counts.total, 3)
  assert.equal(analysis.highRiskAnalysis.counts.reviseMinor, 3)
  assert.equal(analysis.highRiskAnalysis.counts.reviseSevere, 0)
})

test('10. Severe audit miss triggers governance pause and blocks promotion and repair execution', async () => {
  const pause = await createGovernancePauseArtifact({ repoRoot })
  assert.equal(pause.ok, true)
  assert.equal(pause.artifact.status, 'PAUSED')
  assert.equal(pause.artifact.trigger, 'SEVERE_RANDOM_AUDIT_MISS')
  assert.equal(pause.artifact.triggeringCandidateId, 'scale500-tmdb-14283')
  assert.equal(pause.artifact.severeMissCount, 1)
  assert.equal(pause.artifact.severeMissRate, 1 / 30)
  assert.equal(pause.artifact.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.artifact.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.artifact.governanceEffects.runtimePromotionAllowed, false)

  const analysis = await analyzeScaleTranche2HumanDecisions({ repoRoot })
  assert.equal(analysis.auditSampleAnalysis.severeRandomAuditMiss, true)
  assert.equal(analysis.auditSampleAnalysis.governanceStatus, 'PAUSED')
})

test('11. Rounders diagnostic lengths are derived directly from persisted artifacts, not hardcoded prose', async () => {
  const analysis = await analyzeScaleTranche2HumanDecisions({ repoRoot })
  const diag = analysis.quarantinedDiagnosis

  assert.equal(diag.candidateId, 'scale500-tmdb-10220')
  assert.equal(diag.title, 'Rounders')

  // Read actual persisted files directly to verify
  const writerOutput = await readJson(
    path.join(outDir, 'execution/scale-tranche-2/writers/scale500-tmdb-10220/output.json')
  )
  const repairOutput = await readJson(
    path.join(outDir, 'execution/scale-tranche-2/structural-repairs/scale500-tmdb-10220/output.json')
  )

  const expectedWriterLen = writerOutput.copy.description.length
  const expectedRepairLen = repairOutput.copy.description.length

  assert.equal(expectedWriterLen, 222)
  assert.equal(expectedRepairLen, 224)
  assert.equal(diag.initialDescriptionLength, 222)
  assert.equal(diag.structuralRepairDescriptionLength, 224)
  assert.equal(diag.maxAllowedChars, 220)

  // Ensure diagnosis string contains 222 and 224, not stale 228 or 227
  assert.ok(diag.diagnosis.includes('222 > 220'), `Diagnosis must contain actual length 222: ${diag.diagnosis}`)
  assert.ok(diag.diagnosis.includes('224 chars'), `Diagnosis must contain actual repair length 224: ${diag.diagnosis}`)
  assert.equal(diag.diagnosis.includes('228'), false, 'Diagnosis must not contain stale length 228')
  assert.equal(diag.diagnosis.includes('227'), false, 'Diagnosis must not contain stale length 227')
})

test('12. Targeted repair plan contains exactly 19 records with untouched field hashes and closure requirements', async () => {
  const analysis = await analyzeScaleTranche2HumanDecisions({ repoRoot })
  const plan = analysis.targetedRepairPlan

  assert.equal(plan.revisionCount, 19)
  assert.equal(plan.records.length, 19)

  const minorCount = plan.records.filter((r) => r.severity === 'MINOR').length
  const severeCount = plan.records.filter((r) => r.severity === 'SEVERE').length
  assert.equal(minorCount, 18)
  assert.equal(severeCount, 1)

  for (const r of plan.records) {
    assert.ok(r.affectedFields.length > 0)
    assert.ok(r.humanCorrectionInstruction && r.humanCorrectionInstruction.length > 0)
    assert.equal(r.postRepairHumanClosureRequired, true)
    assert.notEqual(r.candidateId, 'scale500-tmdb-10220') // Rounders must not be in repair plan

    // Check untouched field hashes
    for (const f of MATERIALITY_POLICY.allowedEditorialFields) {
      if (!r.affectedFields.includes(f)) {
        assert.ok(r.untouchedFieldHashes[f], `Untouched field ${f} must have hash`)
      } else {
        assert.equal(r.untouchedFieldHashes[f], undefined)
      }
    }
  }
})

test('13. Verifier gap analysis: deterministic byte-for-byte replay and no timestamp', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res1 = await buildScaleTranche2GapAnalysis({ repoRoot })
  const bytes1 = await readFile(path.join(repoRoot, res1.outPath))

  const res2 = await buildScaleTranche2GapAnalysis({ repoRoot })
  const bytes2 = await readFile(path.join(repoRoot, res2.outPath))

  assert.equal(res1.hash, res2.hash)
  assert.equal(Buffer.compare(bytes1, bytes2), 0, 'Artifact bytes must be 100% identical on repeated generation')

  const parsed = JSON.parse(bytes1.toString('utf8'))
  assert.equal(parsed.timestamp, undefined, 'Canonical artifact must not contain wall-clock timestamp')
})

test('14. Verifier gap analysis: structural-repair origin derived correctly (25 direct, 5 repair)', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res = await buildScaleTranche2GapAnalysis({ repoRoot })

  assert.equal(res.summary.directWriterCount, 25)
  assert.equal(res.summary.structuralRepairCount, 5)
  assert.equal(res.summary.totalRecords, 30)

  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))
  const repairs = parsed.records.filter((r) => r.computedFacts.finalEditorialOrigin === 'STRUCTURAL_REPAIR')
  assert.equal(repairs.length, 5)
  for (const r of repairs) {
    assert.ok(r.computedFacts.finalEditorialArtifactPath.includes('structural-repairs'))
  }
})

test('15. Verifier gap analysis: computed facts vs analyst annotations separation and provenance', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res = await buildScaleTranche2GapAnalysis({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  assert.ok(parsed.annotationProvenance)
  assert.equal(parsed.annotationProvenance.annotationPolicy, 'A_PRIME_PRODUCTION_MATERIALITY_V1_RETROSPECTIVE_AUDIT')

  for (const r of parsed.records) {
    assert.ok(r.computedFacts, `Candidate ${r.candidateId} must have computedFacts`)
    assert.ok(r.analystAnnotations, `Candidate ${r.candidateId} must have analystAnnotations`)
    assert.ok(r.computedFacts.routingDisposition)
    assert.ok(r.computedFacts.humanDecision)
    assert.ok(r.computedFacts.sourceFacts)
  }
})

test('16. Verifier gap analysis: no external-film contamination in severe case or explanations', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res = await buildScaleTranche2GapAnalysis({ repoRoot })
  const rawText = (await readFile(path.join(repoRoot, res.outPath))).toString('utf8')
  const parsed = JSON.parse(rawText)

  // Scope to severe case study text and all analyst annotations
  const severeText = JSON.stringify(parsed.severeCaseStudy)
  const annotationsText = JSON.stringify(parsed.records.map((r) => r.analystAnnotations))

  assert.equal(severeText.includes('blood'), false, 'Must not reference blood in Red Violin analysis')
  assert.equal(severeText.includes('wife'), false, 'Must not reference dead wife in Red Violin analysis')
  assert.equal(severeText.includes('Samuel L. Jackson'), false, 'Must not reference actor names in Red Violin analysis')
  assert.equal(annotationsText.includes('Battousai'), false, 'Must not reference manga character names in annotations')
  assert.equal(annotationsText.includes('Sandor'), false, 'Must not reference real-world letter author names in annotations')

  const severe = parsed.severeCaseStudy
  assert.equal(severe.candidateId, 'scale500-tmdb-14283')
  assert.ok(severe.sourceOnlyFindings.darkSecretFinding.includes('dark secret'))
  assert.ok(severe.sourceOnlyFindings.auctionFinding.includes('auction'))
})

test('17. Verifier gap analysis: causal mechanisms marked explicitly as hypotheses', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res = await buildScaleTranche2GapAnalysis({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  const misses = parsed.records.filter((r) => r.analystAnnotations.status === 'REVISED_MISS')
  assert.equal(misses.length, 16)

  for (const m of misses) {
    const diag = m.analystAnnotations.diagnosis
    assert.ok(diag.observedFailure, `Miss ${m.candidateId} must have observedFailure`)
    assert.ok(diag.contractEvidence, `Miss ${m.candidateId} must have contractEvidence`)
    assert.ok(Array.isArray(diag.possibleMechanisms) && diag.possibleMechanisms.length > 0)
    for (const h of diag.possibleMechanisms) {
      assert.ok(h.startsWith('Hypothesis:'), `Mechanism "${h}" must start with "Hypothesis:"`)
    }
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(diag.causalConfidence))
  }
})

test('18. Verifier gap analysis: prompt strategy empirical evaluation status and development set semantics', async () => {
  const { buildScaleTranche2GapAnalysis } = await import('./generateScaleTranche2GapAnalysis.mjs')
  const res = await buildScaleTranche2GapAnalysis({ repoRoot })
  const parsed = JSON.parse(await readFile(path.join(repoRoot, res.outPath), 'utf8'))

  assert.equal(parsed.datasetClassification, 'RETROSPECTIVE_DEVELOPMENT_SET')

  // Strategy A (prompt hardening) must be specification-evaluable, not empirical zero-call
  const stratA = parsed.containmentStrategies.find((s) => s.id === 'STRATEGY_A_VERIFIER_CONTRACT_HARDENING')
  assert.equal(stratA.evaluationStatus, 'OFFLINE_SPECIFICATION_EVALUABLE')
  assert.equal(stratA.empiricalStatus, 'EMPIRICAL_MODEL_BEHAVIOR_REQUIRES_CONTROLLED_REPLAY')

  // Strategy B (deterministic rules) can be empirically replayed
  const stratB = parsed.containmentStrategies.find((s) => s.id === 'STRATEGY_B_DETERMINISTIC_PRE_VERIFIER_BOUNDARY_CHECKS')
  assert.equal(stratB.evaluationStatus, 'EMPIRICALLY_EVALUABLE_OFFLINE_ZERO_CALL')

  // Development set notes must acknowledge lack of untouched validation status
  const devSet = parsed.retrospectiveDevelopmentSetDesign
  assert.ok(devSet.natureOfEvaluation.includes('APPARENT_RETROSPECTIVE_PERFORMANCE'))
  assert.ok(devSet.validationRequirement.includes('independent blinded validation records'))
})

test('19. Governance pause artifact remains PAUSED and blocking', async () => {
  const pausePath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-governance-pause.v1.json')
  const pause = JSON.parse(await readFile(pausePath, 'utf8'))
  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.trigger, 'SEVERE_RANDOM_AUDIT_MISS')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
})

test('20. Historical human decision ledger remains immutable with exact committed hash', async () => {
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const ledger = JSON.parse(await readFile(decisionPath, 'utf8'))
  const ledgerHash = hashArtifact(ledger)
  assert.equal(ledgerHash, 'sha256:60b9b6ab4ce7b56925f8715414ac8d634febe23f289ca3fc50baa38dc001f9bf')

  const guardians = ledger.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
  assert.ok(guardians)
  assert.equal(hashArtifact(guardians), 'sha256:454998b817d9c3a07277a14b55b6731bf3a875f10d60a15caed7d43d1c49524f')
  assert.deepEqual(guardians.affectedFields, ['whyWatch', 'curiosityHook'])
  assert.equal(guardians.decision, 'REVISE')
  assert.equal(guardians.severity, 'MINOR')
})

test('21. Correction proposal binds original decision hash, has effective=false, and requires human approval', async () => {
  const { generateScaleTranche2AdjudicationCorrectionProposal } = await import('./proposeScaleTranche2AdjudicationCorrection.mjs')
  const res = await generateScaleTranche2AdjudicationCorrectionProposal({ repoRoot })

  const proposal = res.proposalArtifact
  assert.equal(proposal.status, 'PROPOSED_AWAITING_HUMAN_APPROVAL')
  assert.equal(proposal.effective, false)
  assert.equal(proposal.humanApprovalRequired, true)
  assert.equal(proposal.candidateId, 'scale500-tmdb-354556')
  assert.equal(proposal.originalDecisionRecord.originalDecisionRecordHash, 'sha256:454998b817d9c3a07277a14b55b6731bf3a875f10d60a15caed7d43d1c49524f')
  assert.equal(proposal.historicalDecisionsLedgerBinding.fullDecisionLedgerHash, 'sha256:60b9b6ab4ce7b56925f8715414ac8d634febe23f289ca3fc50baa38dc001f9bf')
})

test('22. Facts.spokenLanguages authority is consistently authorized across writer and verifier contracts', async () => {
  const writerPrompt = (await readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-writer.v1.1.md'))).toString('utf8')
  const verifierPrompt = (await readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md'))).toString('utf8')

  assert.ok(writerPrompt.includes('Packet-provided director names, locations, languages, genres, runtime, and other facts may be used'))
  assert.ok(verifierPrompt.includes('The supplied facts, accepted semantic classification, semantic boundary flags, allowed source material'))

  const blindPath = path.join(outDir, 'human-review-blind-packets.v1.json')
  const blind = JSON.parse(await readFile(blindPath, 'utf8'))
  const guardiansBlind = blind.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
  assert.deepEqual(guardiansBlind.facts.spokenLanguages, ['Russian'])

  const md = (await readFile(path.join(outDir, 'HUMAN_REVIEW_PACKET.md'))).toString('utf8')
  assert.ok(md.includes('- **Languages**: Russian'))
})

test('23. Russian-language finding is removed only in proposal while decades finding is retained', async () => {
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))

  assert.equal(proposal.findingsEvaluation.removedFinding.field, 'whyWatch')
  assert.equal(proposal.findingsEvaluation.removedFinding.claim, 'Russian-language')
  assert.equal(proposal.findingsEvaluation.retainedFinding.field, 'curiosityHook')
  assert.equal(proposal.findingsEvaluation.retainedFinding.claim, 'decades')

  assert.deepEqual(proposal.proposedAdjudication.affectedFields, ['curiosityHook'])
  assert.equal(proposal.proposedAdjudication.decision, 'REVISE')
  assert.equal(proposal.proposedAdjudication.severity, 'MINOR')
})

test('24. Proposed correction preserves overall decision and severity counts identically', async () => {
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))

  const counts = proposal.downstreamImpactAnalysis.overallDecisionCounts
  assert.equal(counts.changed, false)
  assert.equal(counts.proposed.APPROVE, 14)
  assert.equal(counts.proposed.REVISE, 19)
  assert.equal(counts.proposed.REJECT, 0)
  assert.equal(counts.proposed.MINOR, 18)
  assert.equal(counts.proposed.SEVERE, 1)

  const audit = proposal.downstreamImpactAnalysis.auditMissCounts
  assert.equal(audit.changed, false)
  assert.equal(audit.missCount, 16)
  assert.equal(audit.severeMissCount, 1)
})

test('25. Downstream affected-field impact is computed accurately (whyWatch drops from 6 to 5)', async () => {
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))

  const fields = proposal.downstreamImpactAnalysis.affectedFieldCounts
  assert.equal(fields.current.whyWatch, 6)
  assert.equal(fields.proposed.whyWatch, 5)
  assert.equal(fields.current.curiosityHook, 12)
  assert.equal(fields.proposed.curiosityHook, 12)
  assert.equal(fields.current.description, 6)
  assert.equal(fields.proposed.description, 6)
  assert.equal(fields.current.vibeSummary, 1)
  assert.equal(fields.proposed.vibeSummary, 1)
})

test('26. Targeted repair impact correctly identifies stale whyWatch target for Guardians', async () => {
  // In uncorrected historical plan, whyWatch is targeted and not in untouchedFieldHashes
  const uncorrectedAnalysis = await analyzeScaleTranche2HumanDecisions({ repoRoot, useEffective: false })
  const uncorrectedRecord = uncorrectedAnalysis.targetedRepairPlan.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
  assert.ok(uncorrectedRecord.affectedFields.includes('whyWatch'))
  assert.equal(uncorrectedRecord.untouchedFieldHashes.whyWatch, undefined)

  // In effective corrected plan, whyWatch is protected in untouchedFieldHashes
  const effectiveAnalysis = await analyzeScaleTranche2HumanDecisions({ repoRoot, useEffective: true })
  const effectiveRecord = effectiveAnalysis.targetedRepairPlan.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
  assert.deepEqual(effectiveRecord.affectedFields, ['curiosityHook'])
  assert.equal(
    effectiveRecord.untouchedFieldHashes.whyWatch,
    'sha256:6629a58c81f4942118216a391a50989f4f46904ee5fe379d03df1bf20d18d31c'
  )

  // In proposal, whyWatch was identified as stale target to be preserved
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))
  const repairImpact = proposal.downstreamImpactAnalysis.targetedRepairPlanImpact
  assert.deepEqual(repairImpact.staleScopeIdentified, ['whyWatch'])
  assert.deepEqual(repairImpact.proposedCorrectedRepairScope, ['curiosityHook'])
})

test('27. Accepted v1 retrospective artifact is not overwritten and versioning plan binds prior hash', async () => {
  const gapPath = path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.json')
  const gapData = JSON.parse(await readFile(gapPath, 'utf8'))
  assert.equal(hashArtifact(gapData), 'sha256:837abd909cd0097b386ec5eff0b5140704eb6bf9184139bb70cd236ceaf109d5')

  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))
  const vPlan = proposal.versioningAndSupersessionPlan.verifierGapAnalysisFile
  assert.equal(vPlan.action, 'DO_NOT_OVERWRITE')
  assert.equal(vPlan.currentAcceptedHash, 'sha256:837abd909cd0097b386ec5eff0b5140704eb6bf9184139bb70cd236ceaf109d5')
})

test('28. Future confirmatory holdout methodology requires BLINDED holdout', async () => {
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))
  const method = proposal.versioningAndSupersessionPlan.futureConfirmationMethodology

  assert.equal(method.concept, 'INDEPENDENT_PROSPECTIVE_BLINDED_HOLDOUT')
  assert.equal(method.forbiddenPhrasing, 'unblinded holdout')
})

test('29. Historical human decision ledger bytes and hash are 100% unchanged', async () => {
  const ledgerPath = path.join(outDir, 'human-review-decisions.v1.json')
  const ledgerData = await readJson(ledgerPath)
  assert.equal(hashArtifact(ledgerData), 'sha256:60b9b6ab4ce7b56925f8715414ac8d634febe23f289ca3fc50baa38dc001f9bf')

  const historicalGuardians = ledgerData.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
  assert.equal(hashArtifact(historicalGuardians), 'sha256:454998b817d9c3a07277a14b55b6731bf3a875f10d60a15caed7d43d1c49524f')
})

test('30. Approved correction binds exact proposal hash and historical Guardians decision hash', async () => {
  const correctionPath = path.join(outDir, 'human-review-adjudication-correction.v1.json')
  const correction = await readJson(correctionPath)

  assert.equal(
    correction.proposalBinding.proposalHash,
    'sha256:833fc4fcba7f69d7fbdb187f2ec78aa8e93f6a7d50182adc1021556676e13d9a'
  )
  assert.equal(
    correction.historicalDecisionsLedgerBinding.fullDecisionLedgerHash,
    'sha256:60b9b6ab4ce7b56925f8715414ac8d634febe23f289ca3fc50baa38dc001f9bf'
  )
  assert.equal(
    correction.historicalDecisionsLedgerBinding.historicalDecisionRecordHash,
    'sha256:454998b817d9c3a07277a14b55b6731bf3a875f10d60a15caed7d43d1c49524f'
  )
})

test('31. Approved correction has approvalStatus=APPROVED, effective=true, authority=HUMAN_OPERATOR', async () => {
  const correctionPath = path.join(outDir, 'human-review-adjudication-correction.v1.json')
  const correction = await readJson(correctionPath)

  assert.equal(correction.approvalStatus, 'APPROVED')
  assert.equal(correction.effective, true)
  assert.equal(correction.approvalAuthority, 'HUMAN_OPERATOR')
  assert.equal(correction.approvalStatement, 'Approve Guardians adjudication correction.')
  assert.equal(correction.governanceStateAfterCorrection, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
})

test('32. Effective resolver overlays only Guardians, leaving all other 32 candidates unchanged', async () => {
  const rawLedger = await getHistoricalScaleTranche2HumanDecisions({ repoRoot })
  const effective = await resolveEffectiveScaleTranche2HumanDecisions({ repoRoot })

  assert.equal(effective.records.length, 33)
  for (const effRec of effective.records) {
    const rawRec = rawLedger.records.find((r) => r.candidateId === effRec.candidateId)
    assert.ok(rawRec, `Candidate ${effRec.candidateId} not found in raw ledger`)

    if (effRec.candidateId === 'scale500-tmdb-354556') {
      assert.equal(effRec.isCorrected, true)
      assert.deepEqual(effRec.affectedFields, ['curiosityHook'])
      assert.deepEqual(rawRec.affectedFields, ['whyWatch', 'curiosityHook'])
      assert.deepEqual(effRec.historicalAdjudication.affectedFields, ['whyWatch', 'curiosityHook'])
      assert.deepEqual(effRec.effectiveAdjudication.affectedFields, ['curiosityHook'])
    } else {
      assert.equal(effRec.isCorrected, false)
      assert.equal(effRec.decision, rawRec.decision)
      assert.equal(effRec.severity, rawRec.severity)
      assert.deepEqual(effRec.affectedFields, rawRec.affectedFields)
      assert.equal(effRec.reason, rawRec.reason)
    }
  }
})

test('33. Historical adjudication remains queryable unchanged', async () => {
  const rawLedger = await getHistoricalScaleTranche2HumanDecisions({ repoRoot })
  const guardians = rawLedger.records.find((r) => r.candidateId === 'scale500-tmdb-354556')

  assert.equal(guardians.decision, 'REVISE')
  assert.equal(guardians.severity, 'MINOR')
  assert.deepEqual(guardians.affectedFields, ['whyWatch', 'curiosityHook'])
  assert.ok(guardians.reason.includes('Russian-language'))
})

test('34. Stale/unauthorized corrections fail closed in effective resolver', async () => {
  const rawLedger = await getHistoricalScaleTranche2HumanDecisions({ repoRoot })
  const validCorrection = await readJson(path.join(outDir, 'human-review-adjudication-correction.v1.json'))

  // 1. Missing operator approval
  await assert.rejects(
    async () => {
      await resolveEffectiveScaleTranche2HumanDecisions({
        repoRoot,
        decisionsData: rawLedger,
        correctionData: { ...validCorrection, approvalStatus: 'PENDING' },
      })
    },
    /Adjudication correction rejected/
  )

  // 2. Stale ledger hash
  await assert.rejects(
    async () => {
      await resolveEffectiveScaleTranche2HumanDecisions({
        repoRoot,
        decisionsData: rawLedger,
        correctionData: {
          ...validCorrection,
          historicalDecisionsLedgerBinding: {
            ...validCorrection.historicalDecisionsLedgerBinding,
            fullDecisionLedgerHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          },
        },
      })
    },
    /Stale decision ledger hash/
  )

  // 3. Unauthorized candidate target
  await assert.rejects(
    async () => {
      await resolveEffectiveScaleTranche2HumanDecisions({
        repoRoot,
        decisionsData: rawLedger,
        correctionData: { ...validCorrection, candidateId: 'scale500-tmdb-999999' },
      })
    },
    /Correction touches unauthorized candidate/
  )
})

test('35. Effective Guardians affected fields = curiosityHook only', async () => {
  const effective = await resolveEffectiveScaleTranche2HumanDecisions({ repoRoot })
  const guardians = effective.records.find((r) => r.candidateId === 'scale500-tmdb-354556')

  assert.deepEqual(guardians.affectedFields, ['curiosityHook'])
  assert.deepEqual(guardians.effectiveAdjudication.affectedFields, ['curiosityHook'])
  assert.equal(guardians.effectiveAdjudication.decision, 'REVISE')
  assert.equal(guardians.effectiveAdjudication.severity, 'MINOR')
})

test('36. Targeted repair plan protects whyWatch byte-for-byte in untouchedFieldHashes', async () => {
  const plan = await readJson(path.join(outDir, 'targeted-editorial-repair-plan.v1.json'))
  const guardians = plan.records.find((r) => r.candidateId === 'scale500-tmdb-354556')

  assert.deepEqual(guardians.affectedFields, ['curiosityHook'])
  assert.equal(
    guardians.untouchedFieldHashes.whyWatch,
    'sha256:6629a58c81f4942118216a391a50989f4f46904ee5fe379d03df1bf20d18d31c'
  )
  assert.equal(guardians.postRepairHumanClosureRequired, true)
  assert.equal(plan.revisionCount, 19)
  assert.equal(plan.repairExecutionAllowed, false)
  assert.equal(plan.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
})

test('37. Aggregate decision counts remain strictly 14 APPROVE, 19 REVISE, 0 REJECT, 18 MINOR, 1 SEVERE', async () => {
  const effective = await resolveEffectiveScaleTranche2HumanDecisions({ repoRoot })
  const counts = {
    APPROVE: effective.records.filter((r) => r.decision === 'APPROVE').length,
    REVISE: effective.records.filter((r) => r.decision === 'REVISE').length,
    REJECT: effective.records.filter((r) => r.decision === 'REJECT').length,
    MINOR: effective.records.filter((r) => r.severity === 'MINOR').length,
    SEVERE: effective.records.filter((r) => r.severity === 'SEVERE').length,
  }

  assert.equal(counts.APPROVE, 14)
  assert.equal(counts.REVISE, 19)
  assert.equal(counts.REJECT, 0)
  assert.equal(counts.MINOR, 18)
  assert.equal(counts.SEVERE, 1)
})

test('38. Gap analysis v1.1 has whyWatch count 5, language category 1, and total tranche field instances 24', async () => {
  const gapV11 = await readJson(path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.1.json'))

  assert.equal(gapV11.defectCharacterization.affectedFieldCounts.whyWatch, 5)
  assert.equal(gapV11.defectCharacterization.affectedFieldCounts.curiosityHook, 10)
  assert.equal(gapV11.defectCharacterization.affectedFieldCounts.description, 5)
  assert.equal(gapV11.defectCharacterization.affectedFieldCounts.vibeSummary, 1)

  assert.equal(
    gapV11.defectCharacterization.totalTrancheRevisionAffectedFieldCounts.whyWatch,
    5
  )
  assert.equal(
    gapV11.defectCharacterization.totalTrancheRevisionAffectedFieldCounts.curiosityHook,
    12
  )
  assert.equal(
    gapV11.defectCharacterization.totalTrancheRevisionAffectedFieldCounts.description,
    6
  )
  assert.equal(
    gapV11.defectCharacterization.totalTrancheRevisionAffectedFieldCounts.vibeSummary,
    1
  )
  assert.equal(
    gapV11.defectCharacterization.totalTrancheRevisionAffectedFieldCounts.totalFieldInstances,
    24
  )

  assert.equal(
    gapV11.defectCharacterization.categoryCounts['unsupported nationality/language specificity'],
    1
  )
})

test('39. Supersession bindings in gap analysis v1.1 and Option B v1.1 are exact', async () => {
  const gapV11 = await readJson(path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.1.json'))
  assert.equal(
    gapV11.supersedes.hash,
    'sha256:837abd909cd0097b386ec5eff0b5140704eb6bf9184139bb70cd236ceaf109d5'
  )
  assert.equal(
    gapV11.approvedCorrectionBinding.hash,
    'sha256:3a3b486dc8d39a3fa49d3aa907b4718674ce1b0d7907e67f47e4f00fe963783e'
  )

  const optBV11 = await readJson(path.join(outDir, 'scale-tranche-2-option-b-development-evaluation.v1.1.json'))
  assert.equal(
    optBV11.supersedes.hash,
    'sha256:6950ec7d2b1659b8784887c0186f8cb01261a6c78c33e1dc9fc8ba7de1b04949'
  )
  assert.equal(
    optBV11.verifierGapAnalysisBinding.hash,
    'sha256:70a0adb731f9a3bdb00be18e6fde58590c9922312f342ef926488b39819bf0ae'
  )
  assert.equal(
    optBV11.approvedCorrectionBinding.hash,
    'sha256:3a3b486dc8d39a3fa49d3aa907b4718674ce1b0d7907e67f47e4f00fe963783e'
  )
})

test('40. Option B evaluation v1.1 metrics remain TP=4, FN=12, FP=0, TN=14 and 100% concordance', async () => {
  const optBV11 = await readJson(path.join(outDir, 'scale-tranche-2-option-b-development-evaluation.v1.1.json'))
  const conf = optBV11.candidateRoutingApparentPerformance.confusionMatrix || optBV11.candidateRoutingApparentPerformance.confusion

  assert.equal(conf.tp, 4)
  assert.equal(conf.fn, 12)
  assert.equal(conf.fp, 0)
  assert.equal(conf.tn, 14)

  const conc = optBV11.hitLevelConcordance?.concordanceCounts || optBV11.ruleHitDefectConcordance?.counts
  assert.equal(conc.totalRuleHits, 4)
  assert.equal(conc.humanConfirmedDefects, 4)
  assert.equal(conc.sourceSupportedFalseHits, 0)
  assert.equal(conc.unadjudicatedHits, 0)
  assert.equal(conc.ambiguousHits, 0)
})

test('41. Deterministic replay across all four canonical artifacts produces byte equality', async () => {
  const res1 = {
    correction: (await createApprovedCorrectionArtifact({ repoRoot })).hash,
    gapV11: (await buildScaleTranche2GapAnalysisV11({ repoRoot })).hash,
    optionBV11: (await runScaleTranche2OptionBEvaluationV11({ repoRoot })).hash,
    repairPlan: (await buildScaleTranche2TargetedRepairPlan({ repoRoot })).hash,
  }

  const bytes1 = {
    correction: await readFile(path.join(outDir, 'human-review-adjudication-correction.v1.json')),
    gapV11: await readFile(path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.1.json')),
    optionBV11: await readFile(path.join(outDir, 'scale-tranche-2-option-b-development-evaluation.v1.1.json')),
    repairPlan: await readFile(path.join(outDir, 'targeted-editorial-repair-plan.v1.json')),
  }

  const res2 = {
    correction: (await createApprovedCorrectionArtifact({ repoRoot })).hash,
    gapV11: (await buildScaleTranche2GapAnalysisV11({ repoRoot })).hash,
    optionBV11: (await runScaleTranche2OptionBEvaluationV11({ repoRoot })).hash,
    repairPlan: (await buildScaleTranche2TargetedRepairPlan({ repoRoot })).hash,
  }

  const bytes2 = {
    correction: await readFile(path.join(outDir, 'human-review-adjudication-correction.v1.json')),
    gapV11: await readFile(path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.1.json')),
    optionBV11: await readFile(path.join(outDir, 'scale-tranche-2-option-b-development-evaluation.v1.1.json')),
    repairPlan: await readFile(path.join(outDir, 'targeted-editorial-repair-plan.v1.json')),
  }

  for (const key of ['correction', 'gapV11', 'optionBV11', 'repairPlan']) {
    assert.equal(res1[key], res2[key], `Hash mismatch on deterministic replay for ${key}`)
    assert.ok(bytes1[key].equals(bytes2[key]), `Byte mismatch on deterministic replay for ${key}`)
  }
})

test('42. Pause governance remains blocking and final state is PAUSED_FOR_SEVERE_AUDIT_MISS', async () => {
  const pause = await readJson(path.join(outDir, 'scale-tranche-2-governance-pause.v1.json'))

  assert.equal(pause.status, 'PAUSED')
  assert.equal(pause.governanceEffects.promotionFinalizationAllowed, false)
  assert.equal(pause.governanceEffects.targetedRepairExecutionAllowed, false)
  assert.equal(pause.governanceEffects.runtimePromotionAllowed, false)
  assert.equal(pause.severeMissCount, 1)
  assert.equal(pause.triggeringCandidateId, 'scale500-tmdb-14283')
})

test('43. Blinded holdout terminology is strictly enforced', async () => {
  const correction = await readJson(path.join(outDir, 'human-review-adjudication-correction.v1.json'))
  const gapV11 = await readJson(path.join(outDir, 'scale-tranche-2-verifier-gap-analysis.v1.1.json'))
  const optBV11 = await readJson(path.join(outDir, 'scale-tranche-2-option-b-development-evaluation.v1.1.json'))

  assert.equal(correction.confirmationMethodology.concept, 'INDEPENDENT_PROSPECTIVE_BLINDED_HOLDOUT')
  assert.equal(correction.confirmationMethodology.forbiddenPhrasing, 'unblinded holdout')

  assert.ok(
    gapV11.retrospectiveDevelopmentSetDesign.validationRequirement.includes('independent prospective blinded holdout')
  )
  assert.ok(
    optBV11.methodologicalCaveats.some((c) => c.includes('independent prospective blinded holdout'))
  )
})
