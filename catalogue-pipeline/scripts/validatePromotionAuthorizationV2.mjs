const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

export const GOVERNANCE_VERSION_V2 = 'v8-2-scalable-promotion-governance.v1'
export const GOVERNANCE_ARTIFACT_HASH_V2 = 'sha256:7d6a46d3fde76f4bd578fb17a168f5c87fa65c2fb2d25519fb5d88b72886a43e'

export const AUTHORIZATION_MODES_V2 = Object.freeze([
  'RISK_BASED_AUTO_ELIGIBLE',
  'HUMAN_APPROVED',
])

const ENUMS = Object.freeze({
  validationStatus: ['PASS', 'FAIL'],
  structuralValidationStatus: ['PASS', 'FAIL', 'UNAVAILABLE'],
  provenanceStatus: ['COMPLETE', 'INCOMPLETE'],
  finalEditorialArtifactStatus: ['VALID', 'INVALID', 'UNAVAILABLE'],
  riskRoutingStatus: ['AUTO_ELIGIBLE', 'HUMAN_REVIEW_REQUIRED', 'QUARANTINED'],
  humanReviewStatus: ['NOT_REQUIRED', 'REQUIRED_PENDING', 'APPROVED', 'REVISED_APPROVED', 'REJECTED'],
  auditStatus: ['NOT_SAMPLED', 'SAMPLED_PENDING', 'AUDITED_PASS', 'AUDITED_FAIL'],
  editorialClosureStatus: ['CLEARED', 'PENDING', 'REJECTED', 'DEFERRED'],
  productionValidationStatus: ['PASS', 'FAIL', 'NOT_RUN'],
  promotionDisposition: ['ELIGIBLE', 'DEFERRED', 'QUARANTINED', 'REJECTED'],
  authorizationMode: AUTHORIZATION_MODES_V2,
  reviewBasis: ['HIGH_RISK', 'VERIFIER_UNAVAILABLE', 'AUDIT_SAMPLE', 'TARGETED_REPAIR_CLOSURE'],
  riskSemanticResult: ['LOW_RISK', 'HIGH_RISK', 'UNAVAILABLE'],
  approvalKind: ['HUMAN_REVIEW_DECISION', 'TARGETED_REPAIR_HUMAN_CLOSURE'],
})

const REQUIRED_SOURCE_HASHES = Object.freeze([
  'governanceArtifact',
  'promotionCandidate',
  'finalEditorialArtifact',
  'riskLayerArtifact',
  'productionRecord',
])

function failure(code, message, field) {
  return { severity: 'hard_fail', code, message, ...(field ? { field } : {}) }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isHash(value) {
  return HASH_PATTERN.test(value ?? '')
}

function appendEnumFailure(hardFailures, field, value, allowed) {
  if (!allowed.includes(value)) hardFailures.push(failure('INVALID_ENUM_VALUE', `${field} must be one of: ${allowed.join(', ')}.`, field))
}

function appendUnknownFieldFailures(hardFailures, value, allowed, prefix = '') {
  if (!isObject(value)) return
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      const qualified = prefix ? `${prefix}.${field}` : field
      hardFailures.push(failure('UNKNOWN_FIELD', `${qualified} is not allowed.`, qualified))
    }
  }
}

/**
 * Validates the internal state consistency of promotion-authorization.v2.
 * This does not prove that syntactically valid hashes match loaded artifacts;
 * final assembly must also call validatePromotionAuthorizationV2Freshness.
 */
export function validatePromotionAuthorizationV2(authorization) {
  const hardFailures = []
  const requireValue = (field, expected, code = 'INVALID_AUTHORIZATION_STATE') => {
    if (authorization?.[field] !== expected) hardFailures.push(failure(code, `${field} must be ${expected}.`, field))
  }

  if (!isObject(authorization)) return { ok: false, hardFailures: [failure('INVALID_AUTHORIZATION', 'Promotion authorization must be an object.')] }

  appendUnknownFieldFailures(hardFailures, authorization, ['schemaVersion', 'candidateId', 'tmdbId', 'governanceVersion', 'validationStatus', 'structuralValidationStatus', 'provenanceStatus', 'finalEditorialArtifactStatus', 'riskRoutingStatus', 'riskLayer', 'humanReviewStatus', 'auditStatus', 'editorialClosureStatus', 'productionValidationStatus', 'promotionDisposition', 'authorizationMode', 'reviewBasis', 'humanApproval', 'trancheGate', 'sourceHashes'])

  requireValue('schemaVersion', 'promotion-authorization.v2', 'INVALID_SCHEMA_VERSION')
  if (typeof authorization.candidateId !== 'string' || authorization.candidateId.length === 0) hardFailures.push(failure('MISSING_CANDIDATE_ID', 'candidateId is required.', 'candidateId'))
  if (!Number.isInteger(authorization.tmdbId) || authorization.tmdbId < 1) hardFailures.push(failure('INVALID_TMDB_ID', 'tmdbId must be a positive integer.', 'tmdbId'))
  requireValue('governanceVersion', GOVERNANCE_VERSION_V2, 'INVALID_GOVERNANCE_VERSION')

  for (const field of ['validationStatus', 'structuralValidationStatus', 'provenanceStatus', 'finalEditorialArtifactStatus', 'riskRoutingStatus', 'humanReviewStatus', 'auditStatus', 'editorialClosureStatus', 'productionValidationStatus', 'promotionDisposition', 'authorizationMode']) {
    appendEnumFailure(hardFailures, field, authorization[field], ENUMS[field])
  }

  if (!isObject(authorization.sourceHashes)) hardFailures.push(failure('MISSING_SOURCE_HASHES', 'sourceHashes is required.', 'sourceHashes'))
  else {
    appendUnknownFieldFailures(hardFailures, authorization.sourceHashes, [...REQUIRED_SOURCE_HASHES, 'criticArtifact'], 'sourceHashes')
    for (const field of REQUIRED_SOURCE_HASHES) {
      if (!isHash(authorization.sourceHashes[field])) hardFailures.push(failure('INVALID_SOURCE_HASH', `sourceHashes.${field} must be a sha256 hash.`, `sourceHashes.${field}`))
    }
    if (authorization.sourceHashes.governanceArtifact !== GOVERNANCE_ARTIFACT_HASH_V2) hardFailures.push(failure('STALE_GOVERNANCE_HASH', `sourceHashes.governanceArtifact must bind ${GOVERNANCE_ARTIFACT_HASH_V2}.`, 'sourceHashes.governanceArtifact'))
    if (authorization.sourceHashes.criticArtifact !== null && authorization.sourceHashes.criticArtifact !== undefined && !isHash(authorization.sourceHashes.criticArtifact)) {
      hardFailures.push(failure('INVALID_SOURCE_HASH', 'sourceHashes.criticArtifact must be a sha256 hash, null, or absent.', 'sourceHashes.criticArtifact'))
    }
  }

  if (!isObject(authorization.riskLayer)) hardFailures.push(failure('MISSING_RISK_LAYER', 'riskLayer is required.', 'riskLayer'))
  else {
    appendUnknownFieldFailures(hardFailures, authorization.riskLayer, ['semanticResult', 'sourceBoundarySatisfied', 'unresolvedGroundingConflict'], 'riskLayer')
    appendEnumFailure(hardFailures, 'riskLayer.semanticResult', authorization.riskLayer.semanticResult, ENUMS.riskSemanticResult)
    if (typeof authorization.riskLayer.sourceBoundarySatisfied !== 'boolean') hardFailures.push(failure('INVALID_RISK_LAYER_FIELD', 'riskLayer.sourceBoundarySatisfied must be boolean.', 'riskLayer.sourceBoundarySatisfied'))
    if (typeof authorization.riskLayer.unresolvedGroundingConflict !== 'boolean') hardFailures.push(failure('INVALID_RISK_LAYER_FIELD', 'riskLayer.unresolvedGroundingConflict must be boolean.', 'riskLayer.unresolvedGroundingConflict'))
  }

  if (!isObject(authorization.trancheGate)) hardFailures.push(failure('MISSING_TRANCHE_GATE', 'trancheGate is required.', 'trancheGate'))
  else {
    appendUnknownFieldFailures(hardFailures, authorization.trancheGate, ['severeAuditMissCount', 'pauseCurrentTranche'], 'trancheGate')
    if (!Number.isInteger(authorization.trancheGate.severeAuditMissCount) || authorization.trancheGate.severeAuditMissCount < 0) hardFailures.push(failure('INVALID_SEVERE_AUDIT_MISS_COUNT', 'trancheGate.severeAuditMissCount must be an integer greater than or equal to zero.', 'trancheGate.severeAuditMissCount'))
    if (typeof authorization.trancheGate.pauseCurrentTranche !== 'boolean') hardFailures.push(failure('INVALID_TRANCHE_PAUSE', 'trancheGate.pauseCurrentTranche must be boolean.', 'trancheGate.pauseCurrentTranche'))
    if (authorization.trancheGate.severeAuditMissCount !== 0) hardFailures.push(failure('SEVERE_AUDIT_MISS_BLOCKS_AUTHORIZATION', 'Every authorization mode requires severeAuditMissCount = 0.', 'trancheGate.severeAuditMissCount'))
    if (authorization.trancheGate.pauseCurrentTranche !== false) hardFailures.push(failure('PAUSED_TRANCHE_BLOCKS_AUTHORIZATION', 'Every authorization mode requires pauseCurrentTranche = false.', 'trancheGate.pauseCurrentTranche'))
  }

  requireValue('validationStatus', 'PASS')
  requireValue('structuralValidationStatus', 'PASS')
  requireValue('provenanceStatus', 'COMPLETE')
  requireValue('finalEditorialArtifactStatus', 'VALID')
  requireValue('editorialClosureStatus', 'CLEARED')
  requireValue('productionValidationStatus', 'PASS')
  requireValue('promotionDisposition', 'ELIGIBLE')

  if (authorization.promotionDisposition === 'DEFERRED' || authorization.promotionDisposition === 'QUARANTINED' || authorization.riskRoutingStatus === 'QUARANTINED') {
    hardFailures.push(failure('NON_AUTHORIZABLE_DISPOSITION', 'Deferred and quarantined candidates cannot be production-authorized.'))
  }

  if (authorization.authorizationMode === 'RISK_BASED_AUTO_ELIGIBLE') {
    requireValue('riskRoutingStatus', 'AUTO_ELIGIBLE')
    requireValue('humanReviewStatus', 'NOT_REQUIRED')
    requireValue('auditStatus', 'NOT_SAMPLED')
    if (Object.hasOwn(authorization, 'reviewBasis')) hardFailures.push(failure('AUTO_REVIEW_BASIS_FORBIDDEN', 'Automatic authorization must not contain reviewBasis.', 'reviewBasis'))
    if (authorization.humanApproval !== null && authorization.humanApproval !== undefined) hardFailures.push(failure('AUTO_HUMAN_APPROVAL_FORBIDDEN', 'Automatic authorization must not contain a human approval object.', 'humanApproval'))
    if (authorization.riskLayer?.semanticResult !== 'LOW_RISK') hardFailures.push(failure('RISK_LAYER_NOT_LOW_RISK', 'Automatic authorization requires riskLayer.semanticResult = LOW_RISK.', 'riskLayer.semanticResult'))
    if (authorization.riskLayer?.sourceBoundarySatisfied !== true) hardFailures.push(failure('SOURCE_BOUNDARY_NOT_SATISFIED', 'Automatic authorization requires sourceBoundarySatisfied = true.', 'riskLayer.sourceBoundarySatisfied'))
    if (authorization.riskLayer?.unresolvedGroundingConflict !== false) hardFailures.push(failure('UNRESOLVED_GROUNDING_CONFLICT', 'Automatic authorization requires no unresolved grounding conflict.', 'riskLayer.unresolvedGroundingConflict'))
  }

  if (authorization.authorizationMode === 'HUMAN_APPROVED') {
    appendEnumFailure(hardFailures, 'reviewBasis', authorization.reviewBasis, ENUMS.reviewBasis)
    if (!['APPROVED', 'REVISED_APPROVED'].includes(authorization.humanReviewStatus)) hardFailures.push(failure('FRESH_HUMAN_APPROVAL_REQUIRED', 'Human authorization requires APPROVED or REVISED_APPROVED status.', 'humanReviewStatus'))

    const approval = authorization.humanApproval
    if (!isObject(approval)) hardFailures.push(failure('MISSING_HUMAN_APPROVAL', 'Human authorization requires humanApproval.', 'humanApproval'))
    else {
      appendUnknownFieldFailures(hardFailures, approval, ['approvalArtifactHash', 'reviewedEditorialArtifactHash', 'approvalKind'], 'humanApproval')
      if (!isHash(approval.approvalArtifactHash)) hardFailures.push(failure('INVALID_HUMAN_APPROVAL_HASH', 'A valid human approval artifact hash is required.', 'humanApproval.approvalArtifactHash'))
      if (!isHash(approval.reviewedEditorialArtifactHash)) hardFailures.push(failure('INVALID_REVIEWED_EDITORIAL_HASH', 'A valid reviewed editorial artifact hash is required.', 'humanApproval.reviewedEditorialArtifactHash'))
      appendEnumFailure(hardFailures, 'humanApproval.approvalKind', approval.approvalKind, ENUMS.approvalKind)
      if (approval.reviewedEditorialArtifactHash !== authorization.sourceHashes?.finalEditorialArtifact) hardFailures.push(failure('STALE_HUMAN_APPROVAL', 'Human approval must bind the final editorial artifact being promoted.', 'humanApproval.reviewedEditorialArtifactHash'))
    }

    if (authorization.reviewBasis === 'HIGH_RISK') {
      requireValue('riskRoutingStatus', 'HUMAN_REVIEW_REQUIRED')
      if (authorization.riskLayer?.semanticResult !== 'HIGH_RISK') hardFailures.push(failure('HIGH_RISK_EVIDENCE_MISMATCH', 'HIGH_RISK review requires riskLayer.semanticResult = HIGH_RISK.', 'riskLayer.semanticResult'))
      if (authorization.riskLayer?.sourceBoundarySatisfied !== false) hardFailures.push(failure('HIGH_RISK_EVIDENCE_MISMATCH', 'HIGH_RISK review requires sourceBoundarySatisfied = false.', 'riskLayer.sourceBoundarySatisfied'))
      requireValue('auditStatus', 'NOT_SAMPLED', 'HIGH_RISK_AUDIT_STATE_MISMATCH')
      if (approval?.approvalKind !== 'HUMAN_REVIEW_DECISION') hardFailures.push(failure('NORMAL_HUMAN_DECISION_REQUIRED', 'HIGH_RISK review requires HUMAN_REVIEW_DECISION.', 'humanApproval.approvalKind'))
    }

    if (authorization.reviewBasis === 'VERIFIER_UNAVAILABLE') {
      requireValue('riskRoutingStatus', 'HUMAN_REVIEW_REQUIRED')
      if (authorization.riskLayer?.semanticResult !== 'UNAVAILABLE') hardFailures.push(failure('VERIFIER_UNAVAILABLE_EVIDENCE_MISMATCH', 'VERIFIER_UNAVAILABLE review requires riskLayer.semanticResult = UNAVAILABLE.', 'riskLayer.semanticResult'))
      if (authorization.riskLayer?.sourceBoundarySatisfied !== false) hardFailures.push(failure('VERIFIER_UNAVAILABLE_EVIDENCE_MISMATCH', 'VERIFIER_UNAVAILABLE review requires sourceBoundarySatisfied = false.', 'riskLayer.sourceBoundarySatisfied'))
      requireValue('auditStatus', 'NOT_SAMPLED', 'VERIFIER_UNAVAILABLE_AUDIT_STATE_MISMATCH')
      if (approval?.approvalKind !== 'HUMAN_REVIEW_DECISION') hardFailures.push(failure('NORMAL_HUMAN_DECISION_REQUIRED', 'VERIFIER_UNAVAILABLE review requires HUMAN_REVIEW_DECISION.', 'humanApproval.approvalKind'))
    }

    if (authorization.reviewBasis === 'AUDIT_SAMPLE') {
      requireValue('riskRoutingStatus', 'AUTO_ELIGIBLE')
      requireValue('auditStatus', 'AUDITED_PASS', 'AUDIT_SAMPLE_NOT_PASSED')
      if (authorization.riskLayer?.semanticResult !== 'LOW_RISK') hardFailures.push(failure('AUDIT_SAMPLE_EVIDENCE_MISMATCH', 'AUDIT_SAMPLE requires riskLayer.semanticResult = LOW_RISK.', 'riskLayer.semanticResult'))
      if (authorization.riskLayer?.sourceBoundarySatisfied !== true) hardFailures.push(failure('AUDIT_SAMPLE_EVIDENCE_MISMATCH', 'AUDIT_SAMPLE requires sourceBoundarySatisfied = true.', 'riskLayer.sourceBoundarySatisfied'))
      if (authorization.riskLayer?.unresolvedGroundingConflict !== false) hardFailures.push(failure('AUDIT_SAMPLE_EVIDENCE_MISMATCH', 'AUDIT_SAMPLE requires no unresolved grounding conflict.', 'riskLayer.unresolvedGroundingConflict'))
      if (approval?.approvalKind !== 'HUMAN_REVIEW_DECISION') hardFailures.push(failure('NORMAL_HUMAN_DECISION_REQUIRED', 'AUDIT_SAMPLE review requires HUMAN_REVIEW_DECISION.', 'humanApproval.approvalKind'))
    }

    if (authorization.reviewBasis === 'TARGETED_REPAIR_CLOSURE') {
      if (!['AUTO_ELIGIBLE', 'HUMAN_REVIEW_REQUIRED'].includes(authorization.riskRoutingStatus)) hardFailures.push(failure('TARGETED_REPAIR_ROUTING_MISMATCH', 'Targeted repair must preserve AUTO_ELIGIBLE or HUMAN_REVIEW_REQUIRED routing.', 'riskRoutingStatus'))
      requireValue('humanReviewStatus', 'REVISED_APPROVED')
      if (authorization.riskLayer?.semanticResult !== 'LOW_RISK') hardFailures.push(failure('TARGETED_REPAIR_FINAL_RISK_MISMATCH', 'Targeted repair requires final riskLayer.semanticResult = LOW_RISK.', 'riskLayer.semanticResult'))
      if (authorization.riskLayer?.sourceBoundarySatisfied !== true) hardFailures.push(failure('TARGETED_REPAIR_FINAL_RISK_MISMATCH', 'Targeted repair requires final sourceBoundarySatisfied = true.', 'riskLayer.sourceBoundarySatisfied'))
      if (authorization.riskLayer?.unresolvedGroundingConflict !== false) hardFailures.push(failure('TARGETED_REPAIR_FINAL_RISK_MISMATCH', 'Targeted repair requires no unresolved grounding conflict.', 'riskLayer.unresolvedGroundingConflict'))
      if (authorization.riskRoutingStatus === 'AUTO_ELIGIBLE') requireValue('auditStatus', 'AUDITED_PASS', 'TARGETED_REPAIR_AUDIT_STATE_MISMATCH')
      if (authorization.riskRoutingStatus === 'HUMAN_REVIEW_REQUIRED') requireValue('auditStatus', 'NOT_SAMPLED', 'TARGETED_REPAIR_AUDIT_STATE_MISMATCH')
      if (approval?.approvalKind !== 'TARGETED_REPAIR_HUMAN_CLOSURE') hardFailures.push(failure('TARGETED_REPAIR_CLOSURE_REQUIRED', 'A targeted repair must use a targeted-repair human closure, not its pre-repair decision.', 'humanApproval.approvalKind'))
    }
  }

  return { ok: hardFailures.length === 0, hardFailures }
}

/**
 * Compares authorization bindings to hashes computed from actual loaded artifacts.
 * State validation and freshness must both pass.
 */
export function validatePromotionAuthorizationV2Freshness(authorization, actualHashes) {
  const state = validatePromotionAuthorizationV2(authorization)
  const hardFailures = [...state.hardFailures]
  if (!isObject(actualHashes)) {
    hardFailures.push(failure('MISSING_ACTUAL_HASHES', 'Actual loaded artifact hashes are required for freshness validation.', 'actualHashes'))
    return { ok: false, hardFailures }
  }

  const fields = [...REQUIRED_SOURCE_HASHES]
  if (authorization?.sourceHashes?.criticArtifact !== null && authorization?.sourceHashes?.criticArtifact !== undefined) fields.push('criticArtifact')
  for (const field of fields) {
    if (authorization?.sourceHashes?.[field] !== actualHashes[field]) hardFailures.push(failure('SOURCE_HASH_MISMATCH', `sourceHashes.${field} does not match the loaded artifact hash.`, `sourceHashes.${field}`))
  }
  return { ok: hardFailures.length === 0, hardFailures }
}
