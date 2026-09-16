import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const ADJUDICATION_CORRECTION_SCHEMA = 'human-review-adjudication-correction.v1'
export const GUARDIANS_CANDIDATE_ID = 'scale500-tmdb-354556'
export const GUARDIANS_TMDB_ID = 354556

export const EXPECTED_PROPOSAL_HASH = 'sha256:833fc4fcba7f69d7fbdb187f2ec78aa8e93f6a7d50182adc1021556676e13d9a'
export const EXPECTED_DECISION_LEDGER_HASH = 'sha256:60b9b6ab4ce7b56925f8715414ac8d634febe23f289ca3fc50baa38dc001f9bf'
export const EXPECTED_GUARDIANS_DECISION_RECORD_HASH = 'sha256:454998b817d9c3a07277a14b55b6731bf3a875f10d60a15caed7d43d1c49524f'

/**
 * Validates Stage 1 approval target against proposal and immutable ledger.
 */
export async function verifyApprovalTarget({ repoRoot }) {
  const baseDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const proposalPath = path.join(baseDir, 'human-review-adjudication-correction-proposal.v1.json')
  const decisionsPath = path.join(baseDir, 'human-review-decisions.v1.json')

  const [proposalData, decisionsData] = await Promise.all([
    JSON.parse(await readFile(proposalPath, 'utf8')),
    JSON.parse(await readFile(decisionsPath, 'utf8'))
  ])

  const proposalHash = hashArtifact(proposalData)
  if (proposalHash !== EXPECTED_PROPOSAL_HASH) {
    throw new Error(`Proposal hash mismatch: expected ${EXPECTED_PROPOSAL_HASH}, got ${proposalHash}`)
  }

  const ledgerHash = hashArtifact(decisionsData)
  if (ledgerHash !== EXPECTED_DECISION_LEDGER_HASH) {
    throw new Error(`Decision ledger hash mismatch: expected ${EXPECTED_DECISION_LEDGER_HASH}, got ${ledgerHash}`)
  }

  if (proposalData.candidateId !== GUARDIANS_CANDIDATE_ID) {
    throw new Error(`Candidate mismatch: expected ${GUARDIANS_CANDIDATE_ID}, got ${proposalData.candidateId}`)
  }

  if (proposalData.tmdbId !== GUARDIANS_TMDB_ID) {
    throw new Error(`tmdbId mismatch: expected ${GUARDIANS_TMDB_ID}, got ${proposalData.tmdbId}`)
  }

  if (proposalData.correctionType !== 'PARTIAL_RATIONALE_AND_SCOPE_CORRECTION') {
    throw new Error(`Correction type mismatch: expected PARTIAL_RATIONALE_AND_SCOPE_CORRECTION, got ${proposalData.correctionType}`)
  }

  if (proposalData.proposedAdjudication?.decision !== 'REVISE') {
    throw new Error(`Proposed decision mismatch: expected REVISE, got ${proposalData.proposedAdjudication?.decision}`)
  }

  if (proposalData.proposedAdjudication?.severity !== 'MINOR') {
    throw new Error(`Proposed severity mismatch: expected MINOR, got ${proposalData.proposedAdjudication?.severity}`)
  }

  const affected = proposalData.proposedAdjudication?.affectedFields
  if (!Array.isArray(affected) || affected.length !== 1 || affected[0] !== 'curiosityHook') {
    throw new Error(`Proposed affectedFields mismatch: expected ["curiosityHook"], got ${JSON.stringify(affected)}`)
  }

  const removed = proposalData.findingsEvaluation?.removedFinding
  if (removed?.field !== 'whyWatch' || !removed?.claim?.includes('Russian-language')) {
    throw new Error(`Removed finding mismatch: expected whyWatch / Russian-language, got ${JSON.stringify(removed)}`)
  }

  const retained = proposalData.findingsEvaluation?.retainedFinding
  if (retained?.field !== 'curiosityHook' || !retained?.claim?.includes('decades')) {
    throw new Error(`Retained finding mismatch: expected curiosityHook / decades, got ${JSON.stringify(retained)}`)
  }

  const originalRecord = decisionsData.records.find((r) => r.candidateId === GUARDIANS_CANDIDATE_ID)
  if (!originalRecord) {
    throw new Error(`Guardians candidate ${GUARDIANS_CANDIDATE_ID} missing from decision ledger`)
  }

  const originalRecordHash = hashArtifact(originalRecord)
  if (originalRecordHash !== EXPECTED_GUARDIANS_DECISION_RECORD_HASH) {
    throw new Error(`Guardians decision record hash mismatch: expected ${EXPECTED_GUARDIANS_DECISION_RECORD_HASH}, got ${originalRecordHash}`)
  }

  return {
    ok: true,
    proposalHash,
    ledgerHash,
    originalRecordHash,
    proposalData,
    originalRecord
  }
}

/**
 * Creates and persists the deterministic approved correction artifact.
 * Does NOT alter the immutable historical decision ledger.
 */
export async function createApprovedCorrectionArtifact({ repoRoot }) {
  const verified = await verifyApprovalTarget({ repoRoot })
  const { proposalHash, ledgerHash, originalRecordHash, proposalData } = verified

  const baseDir = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const outPath = path.join(baseDir, 'human-review-adjudication-correction.v1.json')

  const approvedArtifact = {
    schemaVersion: ADJUDICATION_CORRECTION_SCHEMA,
    trancheId: 'SCALE_TRANCHE_2',
    approvalStatus: 'APPROVED',
    effective: true,
    approvalAuthority: 'HUMAN_OPERATOR',
    approvalStatement: 'Approve Guardians adjudication correction.',
    candidateId: GUARDIANS_CANDIDATE_ID,
    tmdbId: GUARDIANS_TMDB_ID,
    title: proposalData.title || 'Guardians',
    correctionType: 'PARTIAL_RATIONALE_AND_SCOPE_CORRECTION',
    proposalBinding: {
      path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-adjudication-correction-proposal.v1.json',
      proposalHash
    },
    historicalDecisionsLedgerBinding: {
      path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json',
      fullDecisionLedgerHash: ledgerHash,
      historicalDecisionRecordHash: originalRecordHash,
      historicalRecordPreserved: true
    },
    effectiveAdjudication: {
      decision: proposalData.proposedAdjudication.decision,
      severity: proposalData.proposedAdjudication.severity,
      affectedFields: proposalData.proposedAdjudication.affectedFields,
      reason: proposalData.proposedAdjudication.reason
    },
    findingsEvaluation: {
      removedFinding: proposalData.findingsEvaluation.removedFinding,
      retainedFinding: proposalData.findingsEvaluation.retainedFinding
    },
    effectiveCorrectedReason: proposalData.proposedAdjudication.reason,
    historicalRecordPreserved: true,
    governanceStateAfterCorrection: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    downstreamImpactSummary: {
      overallDecisionCountsUnchanged: true,
      auditMissCountUnchanged: true,
      affectedFieldCountsDelta: { whyWatch: -1, curiosityHook: 0, description: 0, vibeSummary: 0 },
      defectTaxonomyDelta: { 'unsupported nationality/language specificity': -1 },
      targetedRepairScopeForGuardians: ['curiosityHook'],
      whyWatchProtection: 'PROTECTED_BYTE_FOR_BYTE_IN_UNTOUCHED_FIELD_HASHES'
    },
    confirmationMethodology: {
      concept: 'INDEPENDENT_PROSPECTIVE_BLINDED_HOLDOUT',
      forbiddenPhrasing: 'unblinded holdout',
      note: 'Confirmatory evaluation requires independent prospective blinded holdout evaluation.'
    }
  }

  await writeFile(outPath, serializeArtifactForPersistence(approvedArtifact))

  return {
    ok: true,
    outPath: path.relative(repoRoot, outPath).split(path.sep).join('/'),
    hash: hashArtifact(approvedArtifact),
    artifact: approvedArtifact
  }
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  createApprovedCorrectionArtifact({ repoRoot })
    .then((res) => {
      console.log('Successfully generated Approved Adjudication Correction artifact:')
      console.log('Path:', res.outPath)
      console.log('Hash:', res.hash)
      console.log('Approval Status:', res.artifact.approvalStatus)
      console.log('Effective:', res.artifact.effective)
      console.log('Authority:', res.artifact.approvalAuthority)
      console.log('Effective Adjudication:', JSON.stringify(res.artifact.effectiveAdjudication, null, 2))
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
}
