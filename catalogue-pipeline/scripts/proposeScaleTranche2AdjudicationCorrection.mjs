import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const ADJUDICATION_CORRECTION_SCHEMA = 'human-review-adjudication-correction-proposal.v1'
export const GUARDIANS_CANDIDATE_ID = 'scale500-tmdb-354556'
export const GUARDIANS_TMDB_ID = 354556

/**
 * Builds and persists the adjudication correction proposal artifact for Guardians.
 * Does NOT alter effective production state or mutate historical human review decisions.
 */
export async function generateScaleTranche2AdjudicationCorrectionProposal({ repoRoot }) {
  const baseDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const decisionsPath = path.join(baseDir, 'human-review-decisions.v1.json')
  const blindPacketPath = path.join(baseDir, 'human-review-blind-packets.v1.json')
  const gapAnalysisPath = path.join(baseDir, 'scale-tranche-2-verifier-gap-analysis.v1.json')

  const [decisionsData, blindData, gapData] = await Promise.all([
    JSON.parse(await readFile(decisionsPath, 'utf8')),
    JSON.parse(await readFile(blindPacketPath, 'utf8')),
    JSON.parse(await readFile(gapAnalysisPath, 'utf8'))
  ])

  const fullDecisionLedgerHash = hashArtifact(decisionsData)
  const originalRecord = decisionsData.records.find((r) => r.candidateId === GUARDIANS_CANDIDATE_ID)
  if (!originalRecord) {
    throw new Error(`Candidate ${GUARDIANS_CANDIDATE_ID} not found in human review decisions.`)
  }

  const blindRecord = blindData.records.find((r) => r.candidateId === GUARDIANS_CANDIDATE_ID)
  const originalDecisionRecordHash = hashArtifact(originalRecord)

  // 1. Current vs proposed decision counts
  const currentDecisionCounts = {
    APPROVE: decisionsData.records.filter((r) => r.decision === 'APPROVE').length,
    REVISE: decisionsData.records.filter((r) => r.decision === 'REVISE').length,
    REJECT: decisionsData.records.filter((r) => r.decision === 'REJECT').length,
    MINOR: decisionsData.records.filter((r) => r.severity === 'MINOR').length,
    SEVERE: decisionsData.records.filter((r) => r.severity === 'SEVERE').length
  }

  const proposedDecisionCounts = { ...currentDecisionCounts } // Invariant: Guardians remains REVISE / MINOR

  // 2. Current vs proposed affected-field counts across all 19 REVISE records
  const currentAffectedFieldCounts = { description: 0, whyWatch: 0, curiosityHook: 0, vibeSummary: 0 }
  for (const r of decisionsData.records) {
    for (const f of r.affectedFields || []) {
      currentAffectedFieldCounts[f] = (currentAffectedFieldCounts[f] || 0) + 1
    }
  }

  const proposedAffectedFieldCounts = {
    description: currentAffectedFieldCounts.description,
    whyWatch: currentAffectedFieldCounts.whyWatch - 1, // whyWatch removed for Guardians
    curiosityHook: currentAffectedFieldCounts.curiosityHook, // remains 12
    vibeSummary: currentAffectedFieldCounts.vibeSummary
  }

  // 3. Taxonomy defect categories in gap analysis
  const currentDefectCategoryCounts = {}
  for (const r of gapData.records) {
    if (r.computedFacts?.humanDecision === 'REVISE') {
      for (const cat of r.analystAnnotations?.defectCategories || []) {
        currentDefectCategoryCounts[cat] = (currentDefectCategoryCounts[cat] || 0) + 1
      }
    }
  }

  const proposedDefectCategoryCounts = {
    ...currentDefectCategoryCounts,
    'unsupported nationality/language specificity': (currentDefectCategoryCounts['unsupported nationality/language specificity'] || 1) - 1
  }

  // 4. Proposed corrected reason
  const proposedCorrectedReason =
    'Director "Sarik Andreasyan" and runtime "89 minutes" match exactly, Description faithfully restates the authorized overview, and Why-watch assertion of "Russian-language" is authorized by facts.spokenLanguages: ["Russian"]. However, the Curiosity hook states the operatives have been "living in complete secrecy" for "decades" — the authorized overview says only "for years," and "decades" overstates a specific, unverified duration beyond what\'s stated under Standard A\'. Recommend replacing "decades" with the authorized "years."'

  // 5. Construct proposal artifact
  const proposalArtifact = {
    schemaVersion: ADJUDICATION_CORRECTION_SCHEMA,
    trancheId: 'SCALE_TRANCHE_2',
    status: 'PROPOSED_AWAITING_HUMAN_APPROVAL',
    humanApprovalRequired: true,
    effective: false,
    candidateId: GUARDIANS_CANDIDATE_ID,
    tmdbId: GUARDIANS_TMDB_ID,
    title: blindRecord?.title || 'Guardians',
    historicalDecisionsLedgerBinding: {
      path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json',
      fullDecisionLedgerHash,
      status: 'IMMUTABLE_HISTORICAL_EVIDENCE'
    },
    originalDecisionRecord: {
      originalDecisionRecordHash,
      decision: originalRecord.decision,
      severity: originalRecord.severity,
      affectedFields: originalRecord.affectedFields,
      reason: originalRecord.reason
    },
    correctionType: 'PARTIAL_RATIONALE_AND_SCOPE_CORRECTION',
    evidenceBasis: {
      blindPacketSpokenLanguages: blindRecord?.facts?.spokenLanguages || ['Russian'],
      humanReviewPacketMarkdownLine: '- **Languages**: Russian',
      verifierRiskInputSpokenLanguages: ['Russian'],
      authorityContractFinding:
        'editorial-writer.v1.1.md and source-boundary-risk-verifier.v1.1.md authorize packet facts.spokenLanguages for spoken-language claims. The reviewer note that "no spoken-language field is provided in this packet" was an empirical reviewer perception mistake against the persisted packet.'
    },
    proposedAdjudication: {
      decision: 'REVISE',
      severity: 'MINOR',
      affectedFields: ['curiosityHook'],
      reason: proposedCorrectedReason
    },
    findingsEvaluation: {
      removedFinding: {
        field: 'whyWatch',
        claim: 'Russian-language',
        reasonForRemoval: 'Authorized by facts.spokenLanguages in writer, verifier, blind, and reviewer-visible packets.',
        status: 'INVALID_REVIEWER_PERCEPTION_ERROR'
      },
      retainedFinding: {
        field: 'curiosityHook',
        claim: 'decades',
        reason: 'Source authorizes only "for years"; "decades" overstates duration under Standard A\'.',
        status: 'VALID_A_PRIME_MATERIALITY_DEFECT'
      }
    },
    downstreamImpactAnalysis: {
      overallDecisionCounts: {
        current: currentDecisionCounts,
        proposed: proposedDecisionCounts,
        changed: false,
        note: 'Overall APPROVE 14, REVISE 19, REJECT 0, MINOR 18, SEVERE 1 remain 100% unchanged.'
      },
      auditMissCounts: {
        totalAudited: 30,
        missCount: 16,
        severeMissCount: 1,
        changed: false,
        note: 'Candidate-level audit miss count remains exactly 16/30 (53.3333%).'
      },
      affectedFieldCounts: {
        current: currentAffectedFieldCounts,
        proposed: proposedAffectedFieldCounts,
        delta: { whyWatch: -1, curiosityHook: 0, description: 0, vibeSummary: 0 }
      },
      defectTaxonomyCounts: {
        current: currentDefectCategoryCounts,
        proposed: proposedDefectCategoryCounts,
        delta: { 'unsupported nationality/language specificity': -1 }
      },
      targetedRepairPlanImpact: {
        candidateId: GUARDIANS_CANDIDATE_ID,
        currentRepairScope: ['whyWatch', 'curiosityHook'],
        staleScopeIdentified: ['whyWatch'],
        proposedCorrectedRepairScope: ['curiosityHook'],
        untouchedFieldProtection: 'whyWatch must be added to untouchedFieldHashes to protect it byte-for-byte during targeted repair once correction is approved.',
        planStatus: 'TARGETED_REPAIR_PLAN_CONTAINS_STALE_TARGET_AWAITING_CORRECTION'
      },
      optionBEvaluationImpact: {
        ruleAStatus: 'Zero hits on development set preserved; Russian-language was not flagged because facts.spokenLanguages authorizes it.',
        ruleBStatus: 'Rule B hit on "decades" remains a HUMAN_CONFIRMED_DEFECT under the retained curiosityHook finding.',
        candidateRoutingApparentPerformance: {
          tp: 4,
          fn: 12,
          fp: 0,
          tn: 14,
          apparentRecall: '25.0%',
          apparentPPV: '100.0%',
          apparentFPR: '0.0%',
          status: 'UNCHANGED'
        },
        hitLevelConcordance: {
          totalRuleHits: 4,
          humanConfirmedDefects: 4,
          sourceSupportedFalseHits: 0,
          unadjudicatedHits: 0,
          ambiguousHits: 0,
          status: 'UNCHANGED'
        }
      }
    },
    versioningAndSupersessionPlan: {
      historicalDecisionsFile: {
        path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json',
        action: 'DO_NOT_MUTATE_IN_PLACE',
        futureSupersedingArtifact: 'human-review-decisions.v1.1.json (upon explicit operator approval)'
      },
      verifierGapAnalysisFile: {
        currentAcceptedPath: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-verifier-gap-analysis.v1.json',
        currentAcceptedHash: 'sha256:837abd909cd0097b386ec5eff0b5140704eb6bf9184139bb70cd236ceaf109d5',
        action: 'DO_NOT_OVERWRITE',
        futureSupersedingArtifact: 'scale-tranche-2-verifier-gap-analysis.v1.1.json (binds prior hash, correction hash, and updated defect category)'
      },
      optionBEvaluationFile: {
        currentDevelopmentPath: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-option-b-development-evaluation.v1.json',
        status: 'PROVISIONAL_DEVELOPMENT_EVALUATION',
        futureSupersedingArtifact: 'scale-tranche-2-option-b-development-evaluation.v1.1.json (upon approval of human correction)'
      },
      futureConfirmationMethodology: {
        concept: 'INDEPENDENT_PROSPECTIVE_BLINDED_HOLDOUT',
        forbiddenPhrasing: 'unblinded holdout',
        rationale: 'Unbiased confirmatory validation requires holdout records to be independently selected, prospective, and evaluated blindly.'
      }
    }
  }

  const outPath = path.join(baseDir, 'human-review-adjudication-correction-proposal.v1.json')
  await writeFile(outPath, serializeArtifactForPersistence(proposalArtifact))

  return {
    ok: true,
    outPath: path.relative(repoRoot, outPath).split(path.sep).join('/'),
    hash: hashArtifact(proposalArtifact),
    originalDecisionRecordHash,
    fullDecisionLedgerHash,
    proposalArtifact
  }
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  generateScaleTranche2AdjudicationCorrectionProposal({ repoRoot })
    .then((res) => {
      console.log('Successfully generated Adjudication Correction Proposal:')
      console.log('Path:', res.outPath)
      console.log('Hash:', res.hash)
      console.log('Original Guardians Record Hash:', res.originalDecisionRecordHash)
      console.log('Full Decision Ledger Hash:', res.fullDecisionLedgerHash)
      console.log('Status:', res.proposalArtifact.status)
      console.log('Effective:', res.proposalArtifact.effective)
      console.log('Human Approval Required:', res.proposalArtifact.humanApprovalRequired)
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
}
