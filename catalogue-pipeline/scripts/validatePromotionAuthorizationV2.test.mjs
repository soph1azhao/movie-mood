import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  GOVERNANCE_ARTIFACT_HASH_V2,
  GOVERNANCE_VERSION_V2,
  validatePromotionAuthorizationV2,
  validatePromotionAuthorizationV2Freshness,
} from './validatePromotionAuthorizationV2.mjs'

const hash = (character) => `sha256:${character.repeat(64)}`
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function authorization(overrides = {}) {
  return {
    schemaVersion: 'promotion-authorization.v2',
    candidateId: 'candidate-1',
    tmdbId: 1,
    governanceVersion: GOVERNANCE_VERSION_V2,
    validationStatus: 'PASS',
    structuralValidationStatus: 'PASS',
    provenanceStatus: 'COMPLETE',
    finalEditorialArtifactStatus: 'VALID',
    riskRoutingStatus: 'AUTO_ELIGIBLE',
    riskLayer: { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false },
    humanReviewStatus: 'NOT_REQUIRED',
    auditStatus: 'NOT_SAMPLED',
    editorialClosureStatus: 'CLEARED',
    productionValidationStatus: 'PASS',
    promotionDisposition: 'ELIGIBLE',
    authorizationMode: 'RISK_BASED_AUTO_ELIGIBLE',
    trancheGate: { severeAuditMissCount: 0, pauseCurrentTranche: false },
    sourceHashes: { governanceArtifact: GOVERNANCE_ARTIFACT_HASH_V2, promotionCandidate: hash('a'), finalEditorialArtifact: hash('b'), riskLayerArtifact: hash('c'), productionRecord: hash('d'), criticArtifact: null },
    ...overrides,
  }
}

function humanAuthorization(reviewBasis, overrides = {}) {
  const finalEditorialArtifact = hash('b')
  const unavailable = reviewBasis === 'VERIFIER_UNAVAILABLE'
  const audit = reviewBasis === 'AUDIT_SAMPLE'
  const targeted = reviewBasis === 'TARGETED_REPAIR_CLOSURE'
  return authorization({
    riskRoutingStatus: audit ? 'AUTO_ELIGIBLE' : 'HUMAN_REVIEW_REQUIRED',
    riskLayer: unavailable
      ? { semanticResult: 'UNAVAILABLE', sourceBoundarySatisfied: false, unresolvedGroundingConflict: false }
      : audit || targeted
        ? { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false }
        : { semanticResult: 'HIGH_RISK', sourceBoundarySatisfied: false, unresolvedGroundingConflict: true },
    humanReviewStatus: targeted ? 'REVISED_APPROVED' : 'APPROVED',
    auditStatus: audit ? 'AUDITED_PASS' : 'NOT_SAMPLED',
    authorizationMode: 'HUMAN_APPROVED',
    reviewBasis,
    humanApproval: { approvalArtifactHash: hash('e'), reviewedEditorialArtifactHash: finalEditorialArtifact, approvalKind: targeted ? 'TARGETED_REPAIR_HUMAN_CLOSURE' : 'HUMAN_REVIEW_DECISION' },
    sourceHashes: { governanceArtifact: GOVERNANCE_ARTIFACT_HASH_V2, promotionCandidate: hash('a'), finalEditorialArtifact, riskLayerArtifact: hash('c'), productionRecord: hash('d') },
    ...overrides,
  })
}

function expectInvalid(value, code) {
  const result = validatePromotionAuthorizationV2(value)
  assert.equal(result.ok, false)
  if (code) assert.ok(result.hardFailures.some((item) => item.code === code), `Expected ${code}: ${JSON.stringify(result.hardFailures)}`)
}

test('valid AUTO path passes without human approval or critic', () => {
  assert.equal(validatePromotionAuthorizationV2(authorization()).ok, true)
})

for (const reviewBasis of ['HIGH_RISK', 'VERIFIER_UNAVAILABLE', 'AUDIT_SAMPLE', 'TARGETED_REPAIR_CLOSURE']) {
  test(`AUTO rejects present reviewBasis ${reviewBasis}`, () => {
    expectInvalid(authorization({ reviewBasis }), 'AUTO_REVIEW_BASIS_FORBIDDEN')
  })
}

test('AUTO rejects a human approval object', () => {
  expectInvalid(authorization({ humanApproval: { approvalArtifactHash: hash('e'), reviewedEditorialArtifactHash: hash('b'), approvalKind: 'HUMAN_REVIEW_DECISION' } }), 'AUTO_HUMAN_APPROVAL_FORBIDDEN')
})

test('valid HIGH_RISK human path passes', () => {
  assert.equal(validatePromotionAuthorizationV2(humanAuthorization('HIGH_RISK')).ok, true)
})

test('HIGH_RISK rejects AUTO_ELIGIBLE routing', () => {
  expectInvalid(humanAuthorization('HIGH_RISK', { riskRoutingStatus: 'AUTO_ELIGIBLE' }))
})

test('HIGH_RISK rejects LOW_RISK semantic evidence', () => {
  expectInvalid(humanAuthorization('HIGH_RISK', { riskLayer: { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false } }), 'HIGH_RISK_EVIDENCE_MISMATCH')
})

test('valid VERIFIER_UNAVAILABLE human path passes', () => {
  assert.equal(validatePromotionAuthorizationV2(humanAuthorization('VERIFIER_UNAVAILABLE')).ok, true)
})

test('VERIFIER_UNAVAILABLE rejects LOW_RISK semantic evidence', () => {
  expectInvalid(humanAuthorization('VERIFIER_UNAVAILABLE', { riskLayer: { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: false } }), 'VERIFIER_UNAVAILABLE_EVIDENCE_MISMATCH')
})

test('valid AUDIT_SAMPLE human path passes', () => {
  assert.equal(validatePromotionAuthorizationV2(humanAuthorization('AUDIT_SAMPLE')).ok, true)
})

for (const [label, riskLayer] of [
  ['HIGH_RISK', { semanticResult: 'HIGH_RISK', sourceBoundarySatisfied: false, unresolvedGroundingConflict: true }],
  ['UNAVAILABLE', { semanticResult: 'UNAVAILABLE', sourceBoundarySatisfied: false, unresolvedGroundingConflict: false }],
  ['sourceBoundarySatisfied=false', { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: false, unresolvedGroundingConflict: false }],
  ['unresolvedGroundingConflict=true', { semanticResult: 'LOW_RISK', sourceBoundarySatisfied: true, unresolvedGroundingConflict: true }],
]) {
  test(`AUDIT_SAMPLE rejects ${label} evidence`, () => {
    expectInvalid(humanAuthorization('AUDIT_SAMPLE', { riskLayer }), 'AUDIT_SAMPLE_EVIDENCE_MISMATCH')
  })
}

for (const auditStatus of ['NOT_SAMPLED', 'SAMPLED_PENDING', 'AUDITED_FAIL']) {
  test(`AUDIT_SAMPLE rejects ${auditStatus}`, () => {
    expectInvalid(humanAuthorization('AUDIT_SAMPLE', { auditStatus }), 'AUDIT_SAMPLE_NOT_PASSED')
  })
}

for (const reviewBasis of ['HIGH_RISK', 'VERIFIER_UNAVAILABLE']) {
  for (const auditStatus of ['AUDITED_PASS', 'SAMPLED_PENDING', 'AUDITED_FAIL']) {
    test(`${reviewBasis} rejects audit status ${auditStatus}`, () => {
      expectInvalid(humanAuthorization(reviewBasis, { auditStatus }))
    })
  }
}

for (const riskRoutingStatus of ['AUTO_ELIGIBLE', 'HUMAN_REVIEW_REQUIRED']) {
  test(`valid TARGETED_REPAIR_CLOSURE preserves ${riskRoutingStatus} routing`, () => {
    const auditStatus = riskRoutingStatus === 'AUTO_ELIGIBLE' ? 'AUDITED_PASS' : 'NOT_SAMPLED'
    assert.equal(validatePromotionAuthorizationV2(humanAuthorization('TARGETED_REPAIR_CLOSURE', { riskRoutingStatus, auditStatus })).ok, true)
  })
}

for (const semanticResult of ['HIGH_RISK', 'UNAVAILABLE']) {
  test(`TARGETED_REPAIR_CLOSURE rejects final ${semanticResult} evidence`, () => {
    expectInvalid(humanAuthorization('TARGETED_REPAIR_CLOSURE', { riskLayer: { semanticResult, sourceBoundarySatisfied: false, unresolvedGroundingConflict: semanticResult === 'HIGH_RISK' } }), 'TARGETED_REPAIR_FINAL_RISK_MISMATCH')
  })
}

for (const auditStatus of ['SAMPLED_PENDING', 'AUDITED_FAIL', 'NOT_SAMPLED']) {
  test(`TARGETED_REPAIR_CLOSURE with AUTO_ELIGIBLE rejects ${auditStatus}`, () => {
    expectInvalid(humanAuthorization('TARGETED_REPAIR_CLOSURE', { riskRoutingStatus: 'AUTO_ELIGIBLE', auditStatus }), 'TARGETED_REPAIR_AUDIT_STATE_MISMATCH')
  })
}

test('TARGETED_REPAIR_CLOSURE with HUMAN_REVIEW_REQUIRED rejects AUDITED_PASS', () => {
  expectInvalid(humanAuthorization('TARGETED_REPAIR_CLOSURE', { riskRoutingStatus: 'HUMAN_REVIEW_REQUIRED', auditStatus: 'AUDITED_PASS' }), 'TARGETED_REPAIR_AUDIT_STATE_MISMATCH')
})

test('TARGETED_REPAIR_CLOSURE rejects ordinary pre-repair human decision', () => {
  const value = humanAuthorization('TARGETED_REPAIR_CLOSURE')
  value.humanApproval.approvalKind = 'HUMAN_REVIEW_DECISION'
  expectInvalid(value, 'TARGETED_REPAIR_CLOSURE_REQUIRED')
})

test('TARGETED_REPAIR_CLOSURE rejects stale repaired-artifact binding', () => {
  const value = humanAuthorization('TARGETED_REPAIR_CLOSURE')
  value.humanApproval.reviewedEditorialArtifactHash = hash('f')
  expectInvalid(value, 'STALE_HUMAN_APPROVAL')
})

test('TARGETED_REPAIR_CLOSURE requires REVISED_APPROVED', () => {
  expectInvalid(humanAuthorization('TARGETED_REPAIR_CLOSURE', { humanReviewStatus: 'APPROVED' }))
})

for (const mode of ['AUTO', 'HUMAN']) {
  const fixture = () => mode === 'AUTO' ? authorization() : humanAuthorization('HIGH_RISK')
  test(`${mode} rejects missing trancheGate`, () => {
    const value = fixture()
    delete value.trancheGate
    expectInvalid(value, 'MISSING_TRANCHE_GATE')
  })
  test(`${mode} rejects severe audit miss`, () => {
    expectInvalid({ ...fixture(), trancheGate: { severeAuditMissCount: 1, pauseCurrentTranche: false } }, 'SEVERE_AUDIT_MISS_BLOCKS_AUTHORIZATION')
  })
  test(`${mode} rejects paused tranche`, () => {
    expectInvalid({ ...fixture(), trancheGate: { severeAuditMissCount: 0, pauseCurrentTranche: true } }, 'PAUSED_TRANCHE_BLOCKS_AUTHORIZATION')
  })
}

test('arbitrary non-empty governance version is rejected', () => {
  expectInvalid(authorization({ governanceVersion: 'arbitrary-but-non-empty' }), 'INVALID_GOVERNANCE_VERSION')
})

test('wrong governance artifact hash is rejected', () => {
  const value = authorization()
  value.sourceHashes.governanceArtifact = hash('f')
  expectInvalid(value, 'STALE_GOVERNANCE_HASH')
})

test('missing riskLayer is rejected', () => {
  const value = humanAuthorization('HIGH_RISK')
  delete value.riskLayer
  expectInvalid(value, 'MISSING_RISK_LAYER')
})

for (const [field, malformed] of [
  ['semanticResult', 'UNKNOWN'],
  ['sourceBoundarySatisfied', 'yes'],
  ['unresolvedGroundingConflict', null],
]) {
  test(`malformed riskLayer.${field} is rejected`, () => {
    const value = humanAuthorization('HIGH_RISK')
    value.riskLayer[field] = malformed
    expectInvalid(value)
  })
}

test('malformed trancheGate fields are rejected', () => {
  expectInvalid(authorization({ trancheGate: { severeAuditMissCount: -1, pauseCurrentTranche: 'no' } }))
})

test('missing humanApproval is rejected on human path', () => {
  const value = humanAuthorization('HIGH_RISK')
  delete value.humanApproval
  expectInvalid(value, 'MISSING_HUMAN_APPROVAL')
})

for (const [field, malformed] of [
  ['approvalArtifactHash', 'not-a-hash'],
  ['reviewedEditorialArtifactHash', null],
  ['approvalKind', 'UNKNOWN'],
]) {
  test(`malformed humanApproval.${field} is rejected`, () => {
    const value = humanAuthorization('HIGH_RISK')
    value.humanApproval[field] = malformed
    expectInvalid(value)
  })
}

for (const field of ['auditStatus', 'riskRoutingStatus', 'humanReviewStatus', 'editorialClosureStatus', 'promotionDisposition']) {
  test(`unknown ${field} enum is rejected`, () => {
    expectInvalid(authorization({ [field]: 'UNKNOWN' }), 'INVALID_ENUM_VALUE')
  })
}

test('unknown root and nested fields are rejected consistently with the schema', () => {
  const value = authorization({ unexpected: true })
  value.riskLayer.unexpected = true
  expectInvalid(value, 'UNKNOWN_FIELD')
})

test('LOW_RISK alone cannot replace deterministic validation or provenance', () => {
  expectInvalid(authorization({ provenanceStatus: 'INCOMPLETE' }))
})

test('deferred and quarantined candidates never authorize', () => {
  expectInvalid(authorization({ promotionDisposition: 'DEFERRED', editorialClosureStatus: 'DEFERRED' }), 'NON_AUTHORIZABLE_DISPOSITION')
  expectInvalid(authorization({ promotionDisposition: 'QUARANTINED', riskRoutingStatus: 'QUARANTINED' }), 'NON_AUTHORIZABLE_DISPOSITION')
})

test('freshness helper accepts exact required hashes without critic', () => {
  const value = authorization()
  const actual = { ...value.sourceHashes }
  assert.equal(validatePromotionAuthorizationV2Freshness(value, actual).ok, true)
})

test('freshness helper compares optional critic when supplied', () => {
  const value = authorization()
  value.sourceHashes.criticArtifact = hash('e')
  assert.equal(validatePromotionAuthorizationV2Freshness(value, { ...value.sourceHashes }).ok, true)
  const stale = validatePromotionAuthorizationV2Freshness(value, { ...value.sourceHashes, criticArtifact: hash('f') })
  assert.equal(stale.ok, false)
  assert.ok(stale.hardFailures.some(({ field }) => field === 'sourceHashes.criticArtifact'))
})

test('freshness helper rejects mismatched required loaded-artifact hashes', () => {
  const value = authorization()
  const result = validatePromotionAuthorizationV2Freshness(value, { ...value.sourceHashes, finalEditorialArtifact: hash('f') })
  assert.equal(result.ok, false)
  assert.ok(result.hardFailures.some(({ field }) => field === 'sourceHashes.finalEditorialArtifact'))
})

test('freshness helper rejects missing actual hashes', () => {
  const result = validatePromotionAuthorizationV2Freshness(authorization(), null)
  assert.equal(result.ok, false)
  assert.ok(result.hardFailures.some(({ code }) => code === 'MISSING_ACTUAL_HASHES'))
})

test('schema mirrors governance lock, required governance hash, and conditional state machine', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/schemas/promotion-authorization.v2.schema.json'), 'utf8'))
  assert.equal(schema.properties.governanceVersion.const, GOVERNANCE_VERSION_V2)
  assert.equal(schema.properties.validationStatus.const, 'PASS')
  assert.equal(schema.properties.productionValidationStatus.const, 'PASS')
  assert.ok(schema.properties.sourceHashes.required.includes('governanceArtifact'))
  assert.equal(schema.properties.sourceHashes.properties.governanceArtifact.const, GOVERNANCE_ARTIFACT_HASH_V2)
  assert.deepEqual(schema.properties.authorizationMode.enum, ['RISK_BASED_AUTO_ELIGIBLE', 'HUMAN_APPROVED'])
  assert.ok(schema.allOf.length >= 6)
})
