import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const TRANCHE_ID = 'SCALE_TRANCHE_2'
export const ROOT_RELATIVE = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2'

export const FROZEN_BINDINGS = Object.freeze({
  queueHash: 'sha256:e43386ae2d46cf60369c1ebfceed0803446797b1f46e12a43c6653aeb221ba73',
  blindPacketHash: 'sha256:9cf9b37df662510d1326695b72afc67e77c5b952d24671051eb11a63fdc2fb9d',
  routingHash: 'sha256:60d888678cb33db4d656d93f679be5a25a8e3ee7343e48dc18f4490ced7b7244',
  auditHash: 'sha256:484df0dd6b02ac47b1a772558d0945c1b4dbf1cd63bf79199559c677e6b752b2',
  executionPlanHash: 'sha256:5091b0b7c738b22fd1f440e4521714a9a31c9d2e9548f5e9ff7fba9778785828',
  executionClosureHash: 'sha256:56f55a6fcd5049b98d30eb098eed6bbe33f89fc61e1be66731550b890c762b35',
  governanceHash: 'sha256:7d6a46d3fde76f4bd578fb17a168f5c87fa65c2fb2d25519fb5d88b72886a43e',
})

export const MATERIALITY_POLICY = Object.freeze({
  policyId: 'A_PRIME_PRODUCTION_MATERIALITY_V1',
  principle:
    "Editorial inference is acceptable when it does not materially alter a viewer's understanding or expectation. Low-risk figurative language, genre shorthand, atmospheric inference, metaphorical urgency, and minor contextual concretization may be accepted even when not literally stated in the authorized packet, provided they do not function as a meaningful new factual claim. Unsupported additions require intervention when they materially change or falsely specify plot mechanics, identity, relationships, motives, causality, factual attributes, locations, quantities, franchise history, spoiler boundaries, or other decision-relevant expectations.",
  allowedDecisions: ['APPROVE', 'REVISE', 'REJECT'],
  allowedSeverity: ['NONE', 'MINOR', 'SEVERE'],
  allowedEditorialFields: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
})

export const FORBIDDEN_REVIEWER_KEYS = new Set([
  'routingStatus',
  'promotionState',
  'reviewReasons',
  'riskLevel',
  'riskCategories',
  'issues',
  'verifierIssue',
  'auditMembership',
  'reconciliationEligibility',
  'criticOutput',
  'modelCost',
  'tokenUsage',
  'providerProvenanceClass',
  'selectionRationale',
])

const root = (repoRoot) => path.join(repoRoot, ROOT_RELATIVE)
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const rel = (repoRoot, file) => path.relative(repoRoot, file).split(path.sep).join('/')

function collectForbiddenKeys(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenKeys(item, found)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_REVIEWER_KEYS.has(key)) found.push(key)
      collectForbiddenKeys(child, found)
    }
  }
  return found
}

async function writeCanonical(file, value) {
  await writeFile(file, serializeArtifactForPersistence(value))
}

/**
 * Validate blind packets structure and integrity.
 */
export function validateBlindPackets(blindPackets, queueManifest = null) {
  const failures = []
  if (!blindPackets || typeof blindPackets !== 'object') {
    return { ok: false, failures: ['MALFORMED_BLIND_PACKETS'] }
  }

  if (blindPackets.recordCount !== 33 || blindPackets.records?.length !== 33) {
    failures.push(`INVALID_RECORD_COUNT: expected 33, got ${blindPackets.records?.length}`)
  }

  const uniqueCandidateIds = new Set(blindPackets.records?.map((r) => r.candidateId))
  if (uniqueCandidateIds.size !== (blindPackets.records?.length ?? 0)) {
    failures.push('DUPLICATE_CANDIDATE_IDS')
  }

  const uniqueTmdbIds = new Set(blindPackets.records?.map((r) => r.tmdbId))
  if (uniqueTmdbIds.size !== (blindPackets.records?.length ?? 0)) {
    failures.push('DUPLICATE_TMDB_IDS')
  }

  blindPackets.records?.forEach((r, idx) => {
    if (r.blindOrdinal !== idx + 1) {
      failures.push(`ORDINAL_MISMATCH: record at index ${idx} has ordinal ${r.blindOrdinal}`)
    }
  })

  const forbidden = collectForbiddenKeys(blindPackets.records)
  if (forbidden.length > 0) {
    failures.push(`FORBIDDEN_KEYS_LEAKED: ${[...new Set(forbidden)].sort().join(',')}`)
  }

  if (queueManifest) {
    if (queueManifest.count !== 33 || queueManifest.records?.length !== 33) {
      failures.push(`QUEUE_COUNT_MISMATCH: expected 33, got ${queueManifest.records?.length}`)
    }
    const queueIds = new Set(queueManifest.records?.map((r) => r.candidateId))
    if (queueIds.size !== uniqueCandidateIds.size) {
      failures.push('QUEUE_VS_BLIND_SIZE_MISMATCH')
    }
    for (const id of uniqueCandidateIds) {
      if (!queueIds.has(id)) {
        failures.push(`CANDIDATE_IN_BLIND_NOT_IN_QUEUE: ${id}`)
      }
    }
  }

  return { ok: failures.length === 0, failures: [...new Set(failures)] }
}

/**
 * Build the pristine decision template ledger.
 */
export function buildDecisionTemplate(blindPackets) {
  const records = blindPackets.records.map((r) => ({
    blindOrdinal: r.blindOrdinal,
    candidateId: r.candidateId,
    tmdbId: r.tmdbId,
    decision: 'PENDING',
    materialitySeverity: 'PENDING',
    severity: 'PENDING',
    affectedFields: [],
    fieldsToRevise: [],
    reason: null,
    replacementCopy: null,
    reviewedArtifactHash: hashArtifact(r),
    reviewedRecordHash: hashArtifact(r),
    blindPacketHash: hashArtifact(blindPackets),
    policyVersion: MATERIALITY_POLICY.policyId,
  }))

  return {
    schemaVersion: 'scale-tranche-2-human-review-decisions.v1',
    trancheId: TRANCHE_ID,
    policyVersion: MATERIALITY_POLICY.policyId,
    blindPacketBinding: {
      path: `${ROOT_RELATIVE}/human-review-blind-packets.v1.json`,
      hash: hashArtifact(blindPackets),
      orderedCandidateIdsHash: blindPackets.orderedCandidateIdsHash,
      reviewedRecordHashScope: 'EXACT_REVIEWER_VISIBLE_RECORD_ONLY',
    },
    protocol: {
      reviewStandard: MATERIALITY_POLICY.policyId,
      principle: MATERIALITY_POLICY.principle,
      allowedDecisions: MATERIALITY_POLICY.allowedDecisions,
      allowedSeverity: MATERIALITY_POLICY.allowedSeverity,
      allowedEditorialFields: MATERIALITY_POLICY.allowedEditorialFields,
      auditStatisticsAreDescriptiveNotPopulationEstimates: true,
    },
    recordCount: records.length,
    humanDecisionsMade: 0,
    counts: {
      total: records.length,
      decisions: { APPROVE: 0, REVISE: 0, REJECT: 0, PENDING: records.length },
      severity: { NONE: 0, MINOR: 0, SEVERE: 0, PENDING: records.length },
    },
    records,
    accounting: { externalCalls: 0, modelCalls: 0, runtimeChanges: 0 },
  }
}

/**
 * Validate human review decisions ledger.
 */
export function validateHumanReviewDecisions(ledger, blindPackets) {
  const failures = []
  if (!ledger || typeof ledger !== 'object') {
    return { ok: false, failures: ['MALFORMED_LEDGER'] }
  }

  if (ledger.recordCount !== 33 || ledger.records?.length !== 33) {
    failures.push(`INVALID_RECORD_COUNT: expected 33, got ${ledger.records?.length}`)
  }

  if (ledger.blindPacketBinding?.hash !== hashArtifact(blindPackets)) {
    failures.push('BLIND_PACKET_HASH_MISMATCH')
  }

  const forbidden = collectForbiddenKeys(ledger)
  if (forbidden.length > 0) {
    failures.push(`FORBIDDEN_KEYS_IN_LEDGER: ${[...new Set(forbidden)].sort().join(',')}`)
  }

  const seenCandidates = new Set()
  let approveCount = 0
  let reviseCount = 0
  let rejectCount = 0
  let pendingCount = 0
  let noneCount = 0
  let minorCount = 0
  let severeCount = 0
  let severityPendingCount = 0

  for (let idx = 0; idx < (ledger.records?.length ?? 0); idx += 1) {
    const dec = ledger.records[idx]
    const blind = blindPackets.records?.[idx]

    if (!blind) {
      failures.push(`MISSING_BLIND_RECORD_FOR_INDEX_${idx}`)
      continue
    }

    if (dec.candidateId !== blind.candidateId || dec.tmdbId !== blind.tmdbId) {
      failures.push(`RECORD_IDENTITY_MISMATCH_AT_INDEX_${idx}: expected ${blind.candidateId}, got ${dec.candidateId}`)
    }

    if (dec.blindOrdinal !== blind.blindOrdinal) {
      failures.push(`ORDINAL_MISMATCH_AT_INDEX_${idx}`)
    }

    if (seenCandidates.has(dec.candidateId)) {
      failures.push(`DUPLICATE_DECISION_RECORD: ${dec.candidateId}`)
    }
    seenCandidates.add(dec.candidateId)

    const expectedHash = hashArtifact(blind)
    if (dec.reviewedArtifactHash !== expectedHash || dec.reviewedRecordHash !== expectedHash) {
      failures.push(`REVIEWED_ARTIFACT_HASH_DRIFT: ${dec.candidateId}`)
    }

    if (![...MATERIALITY_POLICY.allowedDecisions, 'PENDING'].includes(dec.decision)) {
      failures.push(`INVALID_DECISION_VALUE: ${dec.decision} for ${dec.candidateId}`)
    }

    if (![...MATERIALITY_POLICY.allowedSeverity, 'PENDING'].includes(dec.severity)) {
      failures.push(`INVALID_SEVERITY_VALUE: ${dec.severity} for ${dec.candidateId}`)
    }

    if (dec.decision === 'PENDING') {
      pendingCount += 1
      if (dec.severity !== 'PENDING') failures.push(`PENDING_DECISION_MUST_HAVE_PENDING_SEVERITY: ${dec.candidateId}`)
      severityPendingCount += 1
    } else if (dec.decision === 'APPROVE') {
      approveCount += 1
      noneCount += 1
      if (dec.severity !== 'NONE' || dec.materialitySeverity !== 'NONE') {
        failures.push(`APPROVE_MUST_HAVE_SEVERITY_NONE: ${dec.candidateId}`)
      }
      if (dec.replacementCopy !== null) {
        failures.push(`APPROVE_CANNOT_HAVE_REPLACEMENT_COPY: ${dec.candidateId}`)
      }
      if (dec.affectedFields?.length > 0 || dec.fieldsToRevise?.length > 0) {
        failures.push(`APPROVE_CANNOT_HAVE_AFFECTED_FIELDS: ${dec.candidateId}`)
      }
    } else if (dec.decision === 'REVISE') {
      reviseCount += 1
      if (!['MINOR', 'SEVERE'].includes(dec.severity)) {
        failures.push(`REVISE_MUST_HAVE_MINOR_OR_SEVERE_SEVERITY: ${dec.candidateId}`)
      }
      if (dec.severity === 'MINOR') minorCount += 1
      if (dec.severity === 'SEVERE') severeCount += 1

      const fields = dec.affectedFields?.length ? dec.affectedFields : dec.fieldsToRevise
      if (!fields || fields.length === 0) {
        failures.push(`REVISE_REQUIRES_AFFECTED_FIELDS: ${dec.candidateId}`)
      } else {
        for (const f of fields) {
          if (!MATERIALITY_POLICY.allowedEditorialFields.includes(f)) {
            failures.push(`INVALID_AFFECTED_FIELD_${f}: ${dec.candidateId}`)
          }
        }
      }

      if (!dec.reason || typeof dec.reason !== 'string' || dec.reason.trim().length === 0) {
        failures.push(`REVISE_REQUIRES_NON_EMPTY_REASON: ${dec.candidateId}`)
      }
    } else if (dec.decision === 'REJECT') {
      rejectCount += 1
      if (dec.severity === 'MINOR') minorCount += 1
      else if (dec.severity === 'SEVERE') severeCount += 1
      else noneCount += 1

      if (!dec.reason || typeof dec.reason !== 'string' || dec.reason.trim().length === 0) {
        failures.push(`REJECT_REQUIRES_NON_EMPTY_REASON: ${dec.candidateId}`)
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    counts: {
      total: ledger.records?.length ?? 0,
      decisions: { APPROVE: approveCount, REVISE: reviseCount, REJECT: rejectCount, PENDING: pendingCount },
      severity: { NONE: noneCount, MINOR: minorCount, SEVERE: severeCount, PENDING: severityPendingCount },
    },
  }
}

/**
 * Generate human-friendly markdown review packet.
 */
export function buildHumanReviewMarkdown(blindPackets) {
  const lines = []
  lines.push('# Movie Mood V8.2 — Scale Tranche 2 Human Review Packets')
  lines.push('')
  lines.push('> **Review Standard**: `A_PRIME_PRODUCTION_MATERIALITY_V1`')
  lines.push('>')
  lines.push('> **Core Principle**: Editorial inference is acceptable when it does not materially alter a viewer\'s understanding or expectation. Low-risk figurative language, genre shorthand, atmospheric inference, metaphorical urgency, and minor contextual concretization may be accepted even when not literally stated in the authorized packet, provided they do not function as a meaningful new factual claim.')
  lines.push('>')
  lines.push('> **Unsupported Additions**: Require intervention (`REVISE` or `REJECT`) when they materially change or falsely specify plot mechanics, identity, relationships, motives, causality, factual attributes, locations, quantities, franchise history, spoiler boundaries, or other decision-relevant expectations.')
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const record of blindPackets.records) {
    const facts = record.facts || {}
    const copy = record.visibleEditorialCopy || {}
    const constraints = record.copyConstraints || {}
    const sem = record.acceptedSemanticClassification || {}

    lines.push(`## [${record.blindOrdinal}/33] ${facts.title || record.title || 'Untitled'} (${facts.year || 'Unknown Year'})`)
    lines.push('')
    lines.push(`- **Candidate ID**: \`${record.candidateId}\``)
    lines.push(`- **TMDB ID**: \`${record.tmdbId}\``)
    lines.push(`- **Director**: ${facts.director || 'Unknown'}`)
    lines.push(`- **Genres**: ${(facts.genres || []).join(', ') || 'None'}`)
    lines.push(`- **Countries**: ${(facts.countries || []).join(', ') || 'None'}`)
    lines.push(`- **Runtime**: ${facts.runtimeMinutes ? `${facts.runtimeMinutes} min` : 'Unknown'}`)
    lines.push(`- **Languages**: ${(facts.spokenLanguages || []).join(', ') || 'None'}`)
    if (facts.keywords?.length) {
      lines.push(`- **Keywords**: ${facts.keywords.join(', ')}`)
    }
    lines.push('')
    lines.push('### Authorized Overview & Source Grounding')
    lines.push(`> ${facts.overview || record.allowedSourceMaterial?.overview || 'No overview provided.'}`)
    lines.push('')
    lines.push('### Accepted Semantic Classification')
    lines.push(`- **Attention**: \`${sem.attentionDemand || 'N/A'}\` | **Discovery**: \`${sem.discoveryStyle || 'N/A'}\` | **Emotional Weight**: \`${sem.emotionalWeight || 'N/A'}\` | **Pace**: \`${sem.pace || 'N/A'}\``)
    lines.push(`- **Moods**: ${(sem.moods || []).join(', ') || 'None'}`)
    lines.push(`- **Situations**: ${(sem.situations || []).join(', ') || 'None'}`)
    lines.push('')
    lines.push('### Candidate Editorial Copy for Review')
    lines.push('')
    lines.push(`#### 1. Description (${(copy.description || '').length} chars / max ${constraints.description?.maxChars || 220})`)
    lines.push(`"${copy.description || ''}"`)
    lines.push('')
    lines.push(`#### 2. Why Watch (${(copy.whyWatch || '').length} chars / max ${constraints.whyWatch?.maxChars || 180})`)
    lines.push(`"${copy.whyWatch || ''}"`)
    lines.push('')
    lines.push(`#### 3. Curiosity Hook (${(copy.curiosityHook || '').length} chars / max ${constraints.curiosityHook?.maxChars || 170})`)
    lines.push(`"${copy.curiosityHook || ''}"`)
    lines.push('')
    lines.push(`#### 4. Vibe Summary (${(copy.vibeSummary || '').length} chars / max ${constraints.vibeSummary?.maxChars || 150})`)
    lines.push(`"${copy.vibeSummary || ''}"`)
    lines.push('')
    if (record.semanticBoundaryFlags?.length) {
      lines.push('#### Source & Boundary Flags (Grounding Context)')
      for (const flag of record.semanticBoundaryFlags) {
        lines.push(`- **${flag.code}** (${(flag.fields || []).join(', ')}): ${flag.message}`)
      }
      lines.push('')
    }
    lines.push('### Adjudication Options')
    lines.push('- [ ] **APPROVE**: Copy satisfies `A_PRIME_PRODUCTION_MATERIALITY_V1`. No material plot, identity, or motive inventions.')
    lines.push('- [ ] **REVISE**: Minor or severe fixable issue. Record affected fields (`description`, `whyWatch`, `curiosityHook`, `vibeSummary`), reason, and correction instruction.')
    lines.push('- [ ] **REJECT**: Unsalvageable factual contradiction or total premise failure. Reason required.')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Initialize all human review artifacts:
 * - human-review-decisions.v1.json
 * - HUMAN_REVIEW_PACKET.md
 */
export async function prepareScaleTranche2HumanReview({ repoRoot, force = false } = {}) {
  const outDir = root(repoRoot)
  const blindPacketPath = path.join(outDir, 'human-review-blind-packets.v1.json')
  const queuePath = path.join(outDir, 'human-review-queue.json')
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const markdownPath = path.join(outDir, 'HUMAN_REVIEW_PACKET.md')

  const [blindPackets, queue] = await Promise.all([readJson(blindPacketPath), readJson(queuePath)])

  const validation = validateBlindPackets(blindPackets, queue)
  if (!validation.ok) {
    throw new Error(`Blind packets validation failed: ${validation.failures.join('; ')}`)
  }

  let decisions
  if (!existsSync(decisionPath) || force) {
    decisions = buildDecisionTemplate(blindPackets)
    await writeCanonical(decisionPath, decisions)
  } else {
    decisions = await readJson(decisionPath)
    const decValidation = validateHumanReviewDecisions(decisions, blindPackets)
    if (!decValidation.ok) {
      throw new Error(`Existing decisions ledger invalid: ${decValidation.failures.join('; ')}`)
    }
  }

  const markdown = buildHumanReviewMarkdown(blindPackets)
  await writeFile(markdownPath, markdown, 'utf8')

  return {
    ok: true,
    blindPacketPath: rel(repoRoot, blindPacketPath),
    blindPacketHash: hashArtifact(blindPackets),
    decisionTemplatePath: rel(repoRoot, decisionPath),
    decisionTemplateHash: hashArtifact(decisions),
    markdownPacketPath: rel(repoRoot, markdownPath),
    recordCount: blindPackets.recordCount,
    humanDecisionsMade: decisions.records.filter((r) => r.decision !== 'PENDING').length,
    pendingDecisions: decisions.records.filter((r) => r.decision === 'PENDING').length,
    accounting: { externalCalls: 0, modelCalls: 0, runtimeChanges: 0 },
  }
}

/**
 * Persist a single human decision into the ledger safely.
 */
export async function recordHumanDecision({
  repoRoot,
  candidateId,
  decision,
  materialitySeverity = 'NONE',
  affectedFields = [],
  reason = null,
  replacementCopy = null,
}) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const blindPacketPath = path.join(outDir, 'human-review-blind-packets.v1.json')

  const [ledger, blindPackets] = await Promise.all([readJson(decisionPath), readJson(blindPacketPath)])

  const targetIdx = ledger.records.findIndex((r) => r.candidateId === candidateId)
  if (targetIdx === -1) {
    throw new Error(`Candidate ${candidateId} not found in human review ledger`)
  }

  const target = ledger.records[targetIdx]
  const blind = blindPackets.records[targetIdx]

  if (decision === 'APPROVE') {
    target.decision = 'APPROVE'
    target.materialitySeverity = 'NONE'
    target.severity = 'NONE'
    target.affectedFields = []
    target.fieldsToRevise = []
    target.reason = reason || null
    target.replacementCopy = null
  } else if (decision === 'REVISE') {
    if (!['MINOR', 'SEVERE'].includes(materialitySeverity)) {
      throw new Error(`REVISE decision must have severity MINOR or SEVERE, got ${materialitySeverity}`)
    }
    if (!affectedFields || affectedFields.length === 0) {
      throw new Error('REVISE decision requires at least one affected field')
    }
    for (const f of affectedFields) {
      if (!MATERIALITY_POLICY.allowedEditorialFields.includes(f)) {
        throw new Error(`Invalid affected field: ${f}`)
      }
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('REVISE decision requires a non-empty reason')
    }
    target.decision = 'REVISE'
    target.materialitySeverity = materialitySeverity
    target.severity = materialitySeverity
    target.affectedFields = affectedFields
    target.fieldsToRevise = affectedFields
    target.reason = reason.trim()
    target.replacementCopy = replacementCopy ? replacementCopy.trim() : null
  } else if (decision === 'REJECT') {
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('REJECT decision requires a non-empty reason')
    }
    target.decision = 'REJECT'
    target.materialitySeverity = materialitySeverity || 'SEVERE'
    target.severity = target.materialitySeverity
    target.affectedFields = affectedFields || []
    target.fieldsToRevise = affectedFields || []
    target.reason = reason.trim()
    target.replacementCopy = null
  } else {
    throw new Error(`Unsupported decision: ${decision}`)
  }

  target.reviewedArtifactHash = hashArtifact(blind)
  target.reviewedRecordHash = hashArtifact(blind)
  target.blindPacketHash = hashArtifact(blindPackets)
  target.policyVersion = MATERIALITY_POLICY.policyId

  const validation = validateHumanReviewDecisions(ledger, blindPackets)
  if (!validation.ok) {
    throw new Error(`Ledger validation failed after updating ${candidateId}: ${validation.failures.join('; ')}`)
  }

  ledger.humanDecisionsMade = ledger.records.filter((r) => r.decision !== 'PENDING').length
  ledger.counts = validation.counts

  await writeCanonical(decisionPath, ledger)

  return {
    candidateId,
    decision: target.decision,
    severity: target.severity,
    completed: ledger.humanDecisionsMade,
    remaining: ledger.records.length - ledger.humanDecisionsMade,
  }
}

/**
 * Returns raw immutable historical human decisions without overlays.
 */
export async function getHistoricalScaleTranche2HumanDecisions({ repoRoot }) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  return readJson(decisionPath)
}

/**
 * Resolves effective human review decisions by overlaying approved corrections onto the historical ledger.
 * Fails closed on stale hashes, missing operator approval, duplicate corrections, or out-of-scope changes.
 */
export async function resolveEffectiveScaleTranche2HumanDecisions({
  repoRoot,
  decisionsData = null,
  correctionData = null,
  proposalData = null,
}) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const correctionPath = path.join(outDir, 'human-review-adjudication-correction.v1.json')
  const proposalPath = path.join(outDir, 'human-review-adjudication-correction-proposal.v1.json')

  const ledger = decisionsData || (await readJson(decisionPath))

  if (!correctionData && !existsSync(correctionPath)) {
    return {
      schemaVersion: 'scale-tranche-2-effective-human-adjudications.v1',
      trancheId: TRANCHE_ID,
      historicalLedgerHash: hashArtifact(ledger),
      effectiveResolutionMode: 'PURE_HISTORICAL_NO_CORRECTIONS',
      correctionsApplied: [],
      records: ledger.records.map((r) => ({
        candidateId: r.candidateId,
        tmdbId: r.tmdbId,
        decision: r.decision,
        severity: r.severity,
        affectedFields: [...r.affectedFields],
        reason: r.reason,
        reviewedArtifactHash: r.reviewedArtifactHash,
        replacementCopy: r.replacementCopy,
        historicalAdjudication: {
          decision: r.decision,
          severity: r.severity,
          affectedFields: [...r.affectedFields],
          reason: r.reason,
          reviewedArtifactHash: r.reviewedArtifactHash,
        },
        effectiveAdjudication: {
          decision: r.decision,
          severity: r.severity,
          affectedFields: [...r.affectedFields],
          reason: r.reason,
          reviewedArtifactHash: r.reviewedArtifactHash,
        },
        isCorrected: false,
      })),
      counts: ledger.counts,
      humanDecisionsMade: ledger.humanDecisionsMade,
    }
  }

  const correction = correctionData || (await readJson(correctionPath))
  const proposal = proposalData || (existsSync(proposalPath) ? await readJson(proposalPath) : null)

  // Fail-closed invariant checks
  // 1. Correction must be approved by human operator
  if (
    correction.approvalStatus !== 'APPROVED' ||
    correction.effective !== true ||
    correction.approvalAuthority !== 'HUMAN_OPERATOR'
  ) {
    throw new Error('Adjudication correction rejected: missing explicit human operator approval')
  }

  // 2. Bound decision ledger hash must match current ledger
  const currentLedgerHash = hashArtifact(ledger)
  if (correction.historicalDecisionsLedgerBinding?.fullDecisionLedgerHash !== currentLedgerHash) {
    throw new Error(
      `Stale decision ledger hash in correction: expected ${currentLedgerHash}, got ${correction.historicalDecisionsLedgerBinding?.fullDecisionLedgerHash}`
    )
  }

  // 3. Stale proposal hash check
  if (proposal && correction.proposalBinding?.proposalHash) {
    const currentProposalHash = hashArtifact(proposal)
    if (correction.proposalBinding.proposalHash !== currentProposalHash) {
      throw new Error(
        `Stale proposal hash in correction: expected ${currentProposalHash}, got ${correction.proposalBinding.proposalHash}`
      )
    }
  }

  // 4. Candidate must be recognized and restricted strictly to Guardians
  const targetCandidateId = 'scale500-tmdb-354556'
  if (correction.candidateId !== targetCandidateId) {
    throw new Error(`Correction touches unauthorized candidate: ${correction.candidateId}`)
  }

  const historicalRecord = ledger.records.find((r) => r.candidateId === targetCandidateId)
  if (!historicalRecord) {
    throw new Error(`Correction target candidate ${targetCandidateId} not found in historical decision ledger`)
  }

  // 5. Stale original decision hash check
  const currentRecordHash = hashArtifact(historicalRecord)
  if (correction.historicalDecisionsLedgerBinding?.historicalDecisionRecordHash !== currentRecordHash) {
    throw new Error(
      `Stale original decision record hash: expected ${currentRecordHash}, got ${correction.historicalDecisionsLedgerBinding?.historicalDecisionRecordHash}`
    )
  }

  // 6. Decision and severity cannot exceed authorized proposal
  if (proposal) {
    if (
      correction.effectiveAdjudication?.decision !== proposal.proposedAdjudication?.decision ||
      correction.effectiveAdjudication?.severity !== proposal.proposedAdjudication?.severity
    ) {
      throw new Error('Correction effective decision/severity exceeds authorized proposal')
    }
  }

  // Build effective records view
  const effectiveRecords = ledger.records.map((r) => {
    const isTarget = r.candidateId === targetCandidateId
    const effectiveAdjudication = isTarget
      ? {
          decision: correction.effectiveAdjudication.decision,
          severity: correction.effectiveAdjudication.severity,
          affectedFields: [...correction.effectiveAdjudication.affectedFields],
          reason: correction.effectiveAdjudication.reason,
          reviewedArtifactHash: r.reviewedArtifactHash,
        }
      : {
          decision: r.decision,
          severity: r.severity,
          affectedFields: [...r.affectedFields],
          reason: r.reason,
          reviewedArtifactHash: r.reviewedArtifactHash,
        }

    return {
      candidateId: r.candidateId,
      tmdbId: r.tmdbId,
      decision: effectiveAdjudication.decision,
      severity: effectiveAdjudication.severity,
      affectedFields: effectiveAdjudication.affectedFields,
      reason: effectiveAdjudication.reason,
      reviewedArtifactHash: r.reviewedArtifactHash,
      replacementCopy: r.replacementCopy,
      historicalAdjudication: {
        decision: r.decision,
        severity: r.severity,
        affectedFields: [...r.affectedFields],
        reason: r.reason,
        reviewedArtifactHash: r.reviewedArtifactHash,
      },
      effectiveAdjudication,
      isCorrected: isTarget,
    }
  })

  return {
    schemaVersion: 'scale-tranche-2-effective-human-adjudications.v1',
    trancheId: TRANCHE_ID,
    historicalLedgerHash: currentLedgerHash,
    effectiveResolutionMode: 'OVERLAY_APPROVED_CORRECTIONS',
    correctionBinding: {
      path: rel(repoRoot, correctionPath),
      correctionHash: hashArtifact(correction),
    },
    correctionsApplied: [
      {
        candidateId: targetCandidateId,
        tmdbId: 354556,
        correctionType: correction.correctionType,
        historicalAffectedFields: historicalRecord.affectedFields,
        effectiveAffectedFields: correction.effectiveAdjudication.affectedFields,
      },
    ],
    records: effectiveRecords,
    counts: ledger.counts,
    humanDecisionsMade: ledger.humanDecisionsMade,
  }
}

/**
 * Post-review analysis: Reveals queue bases for analytical evaluation without altering decisions.
 */
export async function analyzeScaleTranche2HumanDecisions({ repoRoot, useEffective = true }) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const blindPacketPath = path.join(outDir, 'human-review-blind-packets.v1.json')
  const queuePath = path.join(outDir, 'human-review-queue.json')
  const routingPath = path.join(outDir, 'routing-manifest.json')
  const auditPath = path.join(outDir, 'audit-manifest.json')

  const [rawLedger, blindPackets, queue, routing, audit] = await Promise.all([
    readJson(decisionPath),
    readJson(blindPacketPath),
    readJson(queuePath),
    readJson(routingPath),
    readJson(auditPath),
  ])

  const validation = validateHumanReviewDecisions(rawLedger, blindPackets)
  if (!validation.ok) {
    throw new Error(`Decisions ledger is invalid: ${validation.failures.join('; ')}`)
  }

  const pending = rawLedger.records.filter((r) => r.decision === 'PENDING')
  if (pending.length > 0) {
    throw new Error(`Cannot finalize review analysis: ${pending.length} decisions are still PENDING`)
  }

  const effectiveView = useEffective
    ? await resolveEffectiveScaleTranche2HumanDecisions({ repoRoot, decisionsData: rawLedger })
    : null
  const activeRecords = effectiveView ? effectiveView.records : rawLedger.records

  const queueById = new Map(queue.records.map((r) => [r.candidateId, r]))
  const decisionsById = new Map(activeRecords.map((r) => [r.candidateId, r]))
  const rawDecisionsById = new Map(rawLedger.records.map((r) => [r.candidateId, r]))
  const routingById = new Map(routing.records.map((r) => [r.candidateId, r]))

  // 1. Audit sample evaluation (exactly 30 candidates)
  const auditCandidateIds = audit.candidateIds
  if (auditCandidateIds.length !== 30) {
    throw new Error(`Audit candidate count must be 30, got ${auditCandidateIds.length}`)
  }

  const auditDecisions = auditCandidateIds.map((id) => decisionsById.get(id)).filter(Boolean)
  if (auditDecisions.length !== 30) {
    throw new Error(`Could not find all 30 audit decisions in review ledger`)
  }

  const auditCounts = {
    total: 30,
    approve: auditDecisions.filter((d) => d.decision === 'APPROVE').length,
    reviseMinor: auditDecisions.filter((d) => d.decision === 'REVISE' && d.severity === 'MINOR').length,
    reviseSevere: auditDecisions.filter((d) => d.decision === 'REVISE' && d.severity === 'SEVERE').length,
    reject: auditDecisions.filter((d) => d.decision === 'REJECT').length,
  }

  const auditRates = {
    approveRatePercent: (auditCounts.approve / 30) * 100,
    minorMissRatePercent: (auditCounts.reviseMinor / 30) * 100,
    severeMissRatePercent: (auditCounts.reviseSevere / 30) * 100,
    rejectRatePercent: (auditCounts.reject / 30) * 100,
  }

  // 2. High risk evaluation (exactly 3 candidates)
  const highRiskQueueRecords = queue.records.filter((r) => r.reviewReasons.includes('HIGH_RISK'))
  if (highRiskQueueRecords.length !== 3) {
    throw new Error(`Expected 3 HIGH_RISK records, got ${highRiskQueueRecords.length}`)
  }

  const highRiskDecisions = highRiskQueueRecords.map((r) => decisionsById.get(r.candidateId)).filter(Boolean)
  const highRiskCounts = {
    total: 3,
    approve: highRiskDecisions.filter((d) => d.decision === 'APPROVE').length,
    reviseMinor: highRiskDecisions.filter((d) => d.decision === 'REVISE' && d.severity === 'MINOR').length,
    reviseSevere: highRiskDecisions.filter((d) => d.decision === 'REVISE' && d.severity === 'SEVERE').length,
    reject: highRiskDecisions.filter((d) => d.decision === 'REJECT').length,
    records: highRiskDecisions.map((d) => ({
      candidateId: d.candidateId,
      tmdbId: d.tmdbId,
      decision: d.decision,
      severity: d.severity,
      reason: d.reason,
    })),
  }

  // 3. Targeted repair plan
  const revisions = activeRecords.filter((d) => d.decision === 'REVISE')
  const targetedRepairPlan = revisions.map((d) => {
    const routeRec = routingById.get(d.candidateId)
    const blindRec = blindPackets.records.find((r) => r.candidateId === d.candidateId)
    const copy = blindRec?.visibleEditorialCopy || {}

    const untouchedFieldHashes = {}
    for (const f of MATERIALITY_POLICY.allowedEditorialFields) {
      if (!d.affectedFields.includes(f)) {
        untouchedFieldHashes[f] = hashBytes(copy[f] || '')
      }
    }

    return {
      candidateId: d.candidateId,
      tmdbId: d.tmdbId,
      severity: d.severity,
      sourceEditorialArtifactPath: routeRec?.finalEditorialArtifactPath || null,
      sourceEditorialArtifactHash: routeRec?.finalEditorialArtifactHash || null,
      affectedFields: d.affectedFields,
      untouchedFieldHashes,
      humanCorrectionInstruction: d.reason,
      replacementCopy: d.replacementCopy,
      postRepairHumanClosureRequired: true,
    }
  })

  // 4. Quarantined candidate diagnosis (derived directly from persisted artifacts)
  const quarantinedCandidateId = 'scale500-tmdb-10220'
  const writerOutputPath = path.join(outDir, 'execution/scale-tranche-2/writers', quarantinedCandidateId, 'output.json')
  const repairOutputPath = path.join(outDir, 'execution/scale-tranche-2/structural-repairs', quarantinedCandidateId, 'output.json')

  let initialDescriptionLength = null
  let structuralRepairDescriptionLength = null
  const maxAllowedChars = 220

  if (existsSync(writerOutputPath) && existsSync(repairOutputPath)) {
    const writerOutput = await readJson(writerOutputPath)
    const repairOutput = await readJson(repairOutputPath)
    initialDescriptionLength = writerOutput.copy?.description?.length ?? null
    structuralRepairDescriptionLength = repairOutput.copy?.description?.length ?? null
  }

  const quarantinedDiagnosis = {
    candidateId: quarantinedCandidateId,
    tmdbId: 10220,
    title: 'Rounders',
    routingStatus: 'QUARANTINED',
    terminalState: 'STRUCTURAL_QUARANTINED',
    status: 'HELD_OUTSIDE_HUMAN_REVIEW_QUEUE',
    initialDescriptionLength,
    structuralRepairDescriptionLength,
    maxAllowedChars,
    diagnosis:
      `Candidate failed initial writer validation with COPY_TOO_LONG (description ${initialDescriptionLength} > ${maxAllowedChars} chars). Structural repair attempt 1 returned description ${structuralRepairDescriptionLength} chars (> ${maxAllowedChars} chars). Under fail-closed policy, it entered STRUCTURAL_QUARANTINED without dispatching a risk-verifier call.`,
    recommendation:
      'Do not retry with model calls in this phase. In Phase C (quarantine resolution), resolve via bounded human condensation or operator-approved structural fix.',
  }

  // 5. Governance pause trigger evaluation
  const severeRandomAuditMiss = auditCounts.reviseSevere > 0
  const pauseStatus = severeRandomAuditMiss ? 'PAUSED' : 'ACTIVE'

  return {
    adjudicationSummary: {
      totalReviewed: 33,
      counts: validation.counts,
    },
    auditSampleAnalysis: {
      denominator: 30,
      counts: auditCounts,
      rates: auditRates,
      severeRandomAuditMiss,
      governanceStatus: pauseStatus,
    },
    highRiskAnalysis: {
      denominator: 3,
      counts: highRiskCounts,
    },
    targetedRepairPlan: {
      revisionCount: targetedRepairPlan.length,
      records: targetedRepairPlan,
    },
    quarantinedDiagnosis,
    accounting: { externalCalls: 0, modelCalls: 0, runtimeChanges: 0 },
  }
}

/**
 * Create deterministic local governance pause artifact if a severe random audit miss occurred.
 */
export async function createGovernancePauseArtifact({ repoRoot }) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const auditPath = path.join(outDir, 'audit-manifest.json')
  const blindPacketPath = path.join(outDir, 'human-review-blind-packets.v1.json')
  const governancePath = path.join(
    repoRoot,
    'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/v8-2-scalable-promotion-governance.v1.json'
  )

  const [ledger, audit, blindPackets, governance] = await Promise.all([
    readJson(decisionPath),
    readJson(auditPath),
    readJson(blindPacketPath),
    readJson(governancePath),
  ])

  const auditSet = new Set(audit.candidateIds)
  const severeAuditRecords = ledger.records.filter((r) => auditSet.has(r.candidateId) && r.severity === 'SEVERE')

  if (severeAuditRecords.length === 0) {
    throw new Error('Cannot create governance pause artifact: zero severe audit misses observed in random audit')
  }

  const triggeringDec = severeAuditRecords[0]
  const triggeringBlind = blindPackets.records.find((r) => r.candidateId === triggeringDec.candidateId)

  const pauseArtifact = {
    schemaVersion: 'scale-tranche-2-governance-pause.v1',
    trancheId: TRANCHE_ID,
    status: 'PAUSED',
    trigger: 'SEVERE_RANDOM_AUDIT_MISS',
    auditDenominator: 30,
    severeMissCount: severeAuditRecords.length,
    severeMissRate: severeAuditRecords.length / 30,
    triggeringCandidateId: triggeringDec.candidateId,
    triggeringRecord: {
      candidateId: triggeringDec.candidateId,
      tmdbId: triggeringDec.tmdbId,
      title: triggeringBlind?.facts?.title || triggeringBlind?.title || 'Unknown',
      reviewedArtifactHash: triggeringDec.reviewedArtifactHash,
      humanDecisionHash: hashArtifact(triggeringDec),
      decision: triggeringDec.decision,
      severity: triggeringDec.severity,
      affectedFields: triggeringDec.affectedFields,
      reason: triggeringDec.reason,
    },
    bindings: {
      auditManifestHash: hashArtifact(audit),
      humanReviewDecisionLedgerHash: hashArtifact(ledger),
      governanceVersion: 'v8-2-scalable-promotion-governance.v1',
      governanceHash: hashArtifact(governance),
    },
    governanceEffects: {
      promotionFinalizationAllowed: false,
      targetedRepairExecutionAllowed: false,
      runtimePromotionAllowed: false,
    },
    nextRequiredDecision: 'GOVERNANCE_REVIEW_OF_SEVERE_AUDIT_MISS_AND_TARGETED_REPAIR_AUTHORIZATION',
    notes: [
      'Under V8.2 scalable promotion governance, a severe miss discovered in the random audit requires PAUSE_CURRENT_TRANCHE and STOP_PROMOTION_FINALIZATION.',
      'Targeted repair execution and palette generation cannot proceed without explicit operator re-authorization.',
      'T3 scaling audit rate cannot be reduced below 20% based on T2 evidence.',
    ],
    accounting: {
      externalCalls: 0,
      modelCalls: 0,
      runtimeChanges: 0,
    },
  }

  const pausePath = path.join(outDir, 'scale-tranche-2-governance-pause.v1.json')
  await writeCanonical(pausePath, pauseArtifact)

  return {
    ok: true,
    pausePath: rel(repoRoot, pausePath),
    pauseHash: hashArtifact(pauseArtifact),
    artifact: pauseArtifact,
  }
}

/**
 * Interactive terminal review workflow for human operator.
 */
export async function runInteractiveReview({ repoRoot }) {
  const outDir = root(repoRoot)
  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const blindPacketPath = path.join(outDir, 'human-review-blind-packets.v1.json')

  await prepareScaleTranche2HumanReview({ repoRoot })

  const [ledger, blindPackets] = await Promise.all([readJson(decisionPath), readJson(blindPacketPath)])

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    console.log('\n============================================================')
    console.log('MOVIE MOOD V8.2 — SCALE TRANCHE 2 HUMAN REVIEW')
    console.log('Standard: A_PRIME_PRODUCTION_MATERIALITY_V1')
    console.log('Total Packets: 33 (Blind Review)')
    console.log('============================================================\n')

    for (let idx = 0; idx < blindPackets.records.length; idx += 1) {
      const blind = blindPackets.records[idx]
      const currentDec = ledger.records[idx]

      if (currentDec.decision !== 'PENDING') {
        console.log(`[${idx + 1}/33] ${blind.facts?.title || blind.candidateId}: Already decided -> ${currentDec.decision} (${currentDec.severity || 'NONE'})`)
        continue
      }

      console.log(`\n------------------------------------------------------------`)
      console.log(`[${idx + 1}/33] ${blind.facts?.title || 'Unknown Title'} (${blind.facts?.year || 'Unknown Year'})`)
      console.log(`Director: ${blind.facts?.director || 'Unknown'}`)
      console.log(`Genres: ${(blind.facts?.genres || []).join(', ')}`)
      console.log(`Countries: ${(blind.facts?.countries || []).join(', ')} | Runtime: ${blind.facts?.runtimeMinutes || '?'} min`)
      console.log(`\nOVERVIEW:`)
      console.log(`  "${blind.facts?.overview || 'None'}"`)
      console.log(`\nEDITORIAL COPY:`)
      console.log(`  DESCRIPTION: "${blind.visibleEditorialCopy?.description || ''}"`)
      console.log(`  WHY WATCH:   "${blind.visibleEditorialCopy?.whyWatch || ''}"`)
      console.log(`  HOOK:        "${blind.visibleEditorialCopy?.curiosityHook || ''}"`)
      console.log(`  VIBE:        "${blind.visibleEditorialCopy?.vibeSummary || ''}"`)

      let answered = false
      while (!answered) {
        const choice = (await rl.question('\nDecision [A: Approve / R: Revise / X: Reject / Q: Quit]: ')).trim().toUpperCase()

        if (choice === 'Q') {
          console.log('\nReview paused. Current decisions are saved on disk.')
          return
        }

        if (choice === 'A') {
          await recordHumanDecision({
            repoRoot,
            candidateId: blind.candidateId,
            decision: 'APPROVE',
            materialitySeverity: 'NONE',
          })
          console.log(`-> Recorded: APPROVE for ${blind.candidateId}`)
          answered = true
        } else if (choice === 'R') {
          let sev = ''
          while (!['1', '2', 'MINOR', 'SEVERE'].includes(sev)) {
            sev = (await rl.question('Severity [1: MINOR / 2: SEVERE]: ')).trim().toUpperCase()
          }
          const materialitySeverity = (sev === '1' || sev === 'MINOR') ? 'MINOR' : 'SEVERE'

          console.log('Available fields: description, whyWatch, curiosityHook, vibeSummary')
          const fieldsStr = await rl.question('Affected fields (comma-separated): ')
          const affectedFields = fieldsStr.split(',').map((s) => s.trim()).filter(Boolean)

          const reason = await rl.question('Reason for revision: ')
          const replacementCopy = await rl.question('Replacement copy or correction instruction (optional, Enter to skip): ')

          await recordHumanDecision({
            repoRoot,
            candidateId: blind.candidateId,
            decision: 'REVISE',
            materialitySeverity,
            affectedFields,
            reason: reason.trim(),
            replacementCopy: replacementCopy.trim() || null,
          })
          console.log(`-> Recorded: REVISE (${materialitySeverity}) for ${blind.candidateId}`)
          answered = true
        } else if (choice === 'X') {
          const reason = await rl.question('Reason for rejection: ')
          await recordHumanDecision({
            repoRoot,
            candidateId: blind.candidateId,
            decision: 'REJECT',
            materialitySeverity: 'SEVERE',
            reason: reason.trim(),
          })
          console.log(`-> Recorded: REJECT for ${blind.candidateId}`)
          answered = true
        } else {
          console.log('Invalid option. Please enter A, R, X, or Q.')
        }
      }
    }

    console.log('\n============================================================')
    console.log('ALL 33 HUMAN REVIEW DECISIONS RECORDED!')
    console.log('============================================================\n')
  } finally {
    rl.close()
  }
}

/**
 * Creates and persists the deterministic 19-record targeted repair plan using effective adjudications.
 * Protects whyWatch for Guardians byte-for-byte in untouchedFieldHashes.
 */
export async function buildScaleTranche2TargetedRepairPlan({ repoRoot }) {
  const analysis = await analyzeScaleTranche2HumanDecisions({ repoRoot, useEffective: true })
  const outDir = root(repoRoot)
  const planPath = path.join(outDir, 'targeted-editorial-repair-plan.v1.json')

  const decisionPath = path.join(outDir, 'human-review-decisions.v1.json')
  const correctionPath = path.join(outDir, 'human-review-adjudication-correction.v1.json')
  const pausePath = path.join(outDir, 'scale-tranche-2-governance-pause.v1.json')

  const [decisionData, correctionData, pauseData] = await Promise.all([
    readJson(decisionPath),
    readJson(correctionPath),
    readJson(pausePath),
  ])

  const repairPlanArtifact = {
    schemaVersion: 'targeted-editorial-repair-plan.v1',
    trancheId: TRANCHE_ID,
    status: 'TARGETED_REPAIR_PLAN_CORRECTED_AWAITING_REPAIR_AUTHORIZATION',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    repairExecutionAllowed: false,
    revisionCount: analysis.targetedRepairPlan.revisionCount,
    bindings: {
      humanReviewDecisionLedgerHash: hashArtifact(decisionData),
      approvedCorrectionHash: hashArtifact(correctionData),
      governancePauseHash: hashArtifact(pauseData),
    },
    invariants: {
      candidateCountMustBe19: analysis.targetedRepairPlan.revisionCount === 19,
      allRecordsRequireHumanClosure: analysis.targetedRepairPlan.records.every(
        (r) => r.postRepairHumanClosureRequired === true
      ),
      guardiansWhyWatchProtected:
        analysis.targetedRepairPlan.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
          ?.untouchedFieldHashes?.whyWatch ===
        'sha256:6629a58c81f4942118216a391a50989f4f46904ee5fe379d03df1bf20d18d31c',
      guardiansAffectedFieldsCuriosityHookOnly:
        JSON.stringify(
          analysis.targetedRepairPlan.records.find((r) => r.candidateId === 'scale500-tmdb-354556')
            ?.affectedFields
        ) === '["curiosityHook"]',
    },
    methodologyNote:
      'Targeted repairs cannot be executed while governance is PAUSED_FOR_SEVERE_AUDIT_MISS. Future confirmatory validation requires independent prospective blinded holdout evaluation.',
    records: analysis.targetedRepairPlan.records,
  }

  await writeCanonical(planPath, repairPlanArtifact)

  return {
    ok: true,
    outPath: rel(repoRoot, planPath),
    hash: hashArtifact(repairPlanArtifact),
    revisionCount: repairPlanArtifact.revisionCount,
    artifact: repairPlanArtifact,
  }
}

// CLI entrypoint
const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
if (isDirectRun) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const args = process.argv.slice(2)

  if (args.includes('--interactive')) {
    runInteractiveReview({ repoRoot }).catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
  } else if (args.includes('--analyze')) {
    analyzeScaleTranche2HumanDecisions({ repoRoot })
      .then((res) => console.log(JSON.stringify(res, null, 2)))
      .catch((err) => {
        console.error(err.stack || err.message)
        process.exitCode = 1
      })
  } else if (args.includes('--repair-plan')) {
    buildScaleTranche2TargetedRepairPlan({ repoRoot })
      .then((res) => {
        console.log('Successfully generated targeted repair plan artifact:')
        console.log('Path:', res.outPath)
        console.log('Hash:', res.hash)
        console.log('Revision count:', res.revisionCount)
      })
      .catch((err) => {
        console.error(err.stack || err.message)
        process.exitCode = 1
      })
  } else if (args.includes('--pause')) {
    createGovernancePauseArtifact({ repoRoot })
      .then((res) => console.log(JSON.stringify(res, null, 2)))
      .catch((err) => {
        console.error(err.stack || err.message)
        process.exitCode = 1
      })
  } else {
    prepareScaleTranche2HumanReview({ repoRoot })
      .then((res) => console.log(JSON.stringify(res, null, 2)))
      .catch((err) => {
        console.error(err.stack || err.message)
        process.exitCode = 1
      })
  }
}
