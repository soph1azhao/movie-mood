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
  createGovernancePauseArtifact,
  prepareScaleTranche2HumanReview,
  recordHumanDecision,
  validateBlindPackets,
  validateHumanReviewDecisions,
} from './scaleTranche2HumanReview.mjs'
import { hashArtifact } from './validatePromotionContract.mjs'

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
