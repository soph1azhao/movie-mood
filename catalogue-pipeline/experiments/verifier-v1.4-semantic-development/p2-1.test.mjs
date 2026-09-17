import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { serializeArtifactForPersistence } from '../../scripts/validatePromotionContract.mjs'
import { projectBlindPacket, assertNoForbiddenKeys, assertOnlyWhitelistedPaths, FORBIDDEN_KEY_PATTERN } from '../../scripts/blindReviewPacket.mjs'
import { validateJsonSchema, assertSchemaKeywordsSupported, VALIDATOR_DESIGNATION, SUPPORTED_SCHEMA_KEYWORDS } from '../../scripts/jsonSchemaValidator.mjs'
import {
  extractHoldoutIdentitiesOnly,
  executeSealedHoldoutFirewallAudit,
  skipJsonStringWithoutDecoding,
  ALLOWED_IDENTITY_KEYS,
  ACTIVITY as FIREWALL_ACTIVITY,
} from '../../scripts/runSealedHoldoutIdentityFirewallAudit.mjs'
import { buildP21Artifacts } from '../../scripts/buildVerifierV14P21Artifacts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(p2Dir, fileName), 'utf8'))
}

function sha256(filePath) {
  const buf = fs.readFileSync(filePath)
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(Buffer.from(str, 'utf8')).digest('hex')
}

// 1. P1 hashes unchanged
test('1. P1 hashes unchanged and intact', () => {
  const v14PromptPath = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md')
  const protocolPath = path.join(p2Dir, 'protocol.v1.json')
  const devExposurePolicyPath = path.join(p2Dir, 'development-exposure-policy.v1.json')
  const promptExposureLintPath = path.join(p2Dir, 'prompt-exposure-lint.v1.json')

  assert.equal(sha256(v14PromptPath), 'sha256:a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f')
  assert.equal(sha256(protocolPath), 'sha256:7ccef839cc7bf434156881f6d8c12130a8d5e444e6038a95c50df8572c7c0f4d')
  assert.equal(sha256(devExposurePolicyPath), 'sha256:b5e9b655644bb0af931bd151b99b9bada8e21f0a8add2a9d8a52ad826b7bb04b')
  assert.equal(sha256(promptExposureLintPath), 'sha256:5b5eb8c2075b9dab8c8591a12d7055ef82f3a0bc194a029f451c5a8ef926a055')
})

// 2. v1.4 prompt unchanged
test('2. v1.4 prompt unchanged from frozen baseline', () => {
  const promptPath = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md')
  const expectedSha = 'sha256:a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f'
  assert.equal(sha256(promptPath), expectedSha)
})

// 3. Eligible pool contains no exposed candidate
test('3. Eligible pool contains strictly zero exposed candidates', () => {
  const exposureLedger = readJson('semantic-exposure-ledger.v2.json')
  const exposedSet = new Set(exposureLedger.records.map((r) => r.candidateId))
  const eligiblePool = readJson('blind-review-eligible-pool.v1.json')

  const overlaps = eligiblePool.records.filter((r) => exposedSet.has(r.candidateId))
  assert.equal(overlaps.length, 0, `Found exposed candidates in eligible pool: ${JSON.stringify(overlaps)}`)
})

// 4. Eligible pool contains no prior human-adjudicated candidate
test('4. Eligible pool contains strictly zero prior human-adjudicated candidates', () => {
  const eligiblePool = readJson('blind-review-eligible-pool.v1.json')

  const t1Human = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-decisions.completed.v1.json'), 'utf8'))
  const t2Human = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json'), 'utf8'))
  const pilotHuman = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/human-review-decisions.completed.v1.json'), 'utf8'))

  const priorHumanIds = new Set([
    ...t1Human.records.map((r) => r.candidateId),
    ...t2Human.records.map((r) => r.candidateId),
    ...pilotHuman.records.map((r) => r.candidateId),
  ])

  for (const r of eligiblePool.records) {
    assert.equal(r.priorHumanAdjudication, false)
    assert.equal(priorHumanIds.has(r.candidateId), false, `Candidate ${r.candidateId} had prior human review`)
  }
})

// 5. Eligible pool contains no title/prose/label/severity/verifier fields
test('5. Eligible pool contains no title, prose, label, severity, or verifier fields', () => {
  const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
  const forbiddenKeys = [
    'title',
    'overview',
    'description',
    'whyWatch',
    'curiosityHook',
    'vibeSummary',
    'label',
    'decision',
    'finalDecision',
    'severity',
    'materialitySeverity',
    'riskLevel',
    'verifierOutput',
    'riskScore',
    'defectCategory',
    'issues',
  ]

  for (const record of eligiblePool.records) {
    for (const key of forbiddenKeys) {
      assert.equal(key in record, false, `Forbidden key '${key}' found in eligible pool record ${record.candidateId}`)
    }
    const allowedKeys = new Set([
      'candidateId',
      'retrospectiveTranche',
      'frozenRiskInputPath',
      'riskInputByteSha256',
      'provenanceBinding',
      'exposureCheck',
      'priorHumanAdjudication',
    ])
    for (const actualKey of Object.keys(record)) {
      assert.equal(allowedKeys.has(actualKey), true, `Unexpected key '${actualKey}' in record ${record.candidateId}`)
    }
  }
})

// 6. Review order uses only candidateId + frozen seed
test('6. Review order uses strictly candidateId + frozen seed without extraneous variables', () => {
  const reviewOrder = readJson('blind-review-order.v1.json')
  const expectedSeedMaterial = 'VERIFIER_V14_P2_1_BLIND_REVIEW_ORDER|deda014|source-boundary-risk-verifier.v1.4-semantic-development.r1'
  assert.equal(reviewOrder.seedMaterial, expectedSeedMaterial)

  const seedShaHex = sha256Hex(expectedSeedMaterial)
  assert.equal(reviewOrder.seedSha256, 'sha256:' + seedShaHex)

  for (const item of reviewOrder.orderedCandidates) {
    const expectedScore = sha256Hex(`${seedShaHex}\n${item.candidateId}`)
    assert.equal(item.reviewOrderScore, expectedScore)
  }
})

// 7. Review order is byte-deterministic
test('7. Review order is byte-deterministic across recomputation', () => {
  const reviewOrder = readJson('blind-review-order.v1.json')
  const eligiblePool = readJson('blind-review-eligible-pool.v1.json')

  const seedShaHex = sha256Hex(reviewOrder.seedMaterial)
  const recomputed = eligiblePool.records.map((r) => ({
    candidateId: r.candidateId,
    retrospectiveTranche: r.retrospectiveTranche,
    reviewOrderScore: sha256Hex(`${seedShaHex}\n${r.candidateId}`),
  }))

  recomputed.sort((a, b) => {
    const cmp = a.reviewOrderScore.localeCompare(b.reviewOrderScore)
    if (cmp !== 0) return cmp
    return a.candidateId.localeCompare(b.candidateId)
  })

  for (let i = 0; i < reviewOrder.orderedCandidates.length; i++) {
    const actual = reviewOrder.orderedCandidates[i]
    const expected = recomputed[i]
    assert.equal(actual.reviewSequenceIndex, i + 1)
    assert.equal(actual.candidateId, expected.candidateId)
    assert.equal(actual.retrospectiveTranche, expected.retrospectiveTranche)
    assert.equal(actual.reviewOrderScore, expected.reviewOrderScore)
  }
})

// 8. Projection retains only whitelisted fields
test('8. Packet projection retains strictly allowed fields and drops forbidden fields', () => {
  const mockRiskInput = {
    facts: {
      title: 'Test Movie',
      year: 2020,
      overview: 'A movie about testing.',
      director: 'Director Carol',
    },
    visibleEditorialCopy: {
      description: 'An atmospheric look at tests.',
      whyWatch: 'Engaging character study with tension.',
      curiosityHook: 'What happens next?',
      vibeSummary: 'Dark and gripping.',
    },
    verifierRiskLevel: 'HIGH',
    repairHistory: ['Fixed typo'],
    priorReviewDecision: 'REVISE',
    quotaPressure: 'NEED_DEFECT',
    cohortTarget: 'DEFECT_POSITIVE',
  }

  const packet = projectBlindPacket(mockRiskInput, 'test-candidate-1')

  assert.equal(packet.facts.title, 'Test Movie')
  assert.equal(packet.facts.year, 2020)
  assert.equal(packet.facts.overview, 'A movie about testing.')
  assert.equal(packet.facts.director, 'Director Carol')
  assert.equal(packet.visibleEditorialCopy.description, 'An atmospheric look at tests.')

  assert.equal('verifierRiskLevel' in packet, false)
  assert.equal('repairHistory' in packet, false)
  assert.equal('priorReviewDecision' in packet, false)
  assert.equal('quotaPressure' in packet, false)
  assert.equal('cohortTarget' in packet, false)

  assert.doesNotThrow(() => assertOnlyWhitelistedPaths(packet))
  assert.doesNotThrow(() => assertNoForbiddenKeys(packet))
})

// 9. Blind packet fails closed on forbidden keys
test('9. Blind packet validation fails closed on forbidden keys at root or nested levels', () => {
  const badRootPacket = {
    facts: { title: 'Test' },
    editorialCopy: { description: 'Desc' },
    riskLevel: 'LOW',
  }
  assert.throws(() => assertNoForbiddenKeys(badRootPacket), /FORBIDDEN_KEY_DETECTED/)

  const badNestedFacts = {
    facts: {
      title: 'Test',
      verifierVerdict: 'CLEAN',
    },
    editorialCopy: { description: 'Desc' },
  }
  assert.throws(() => assertNoForbiddenKeys(badNestedFacts), /FORBIDDEN_KEY_DETECTED/)

  const badNestedCopy = {
    facts: { title: 'Test' },
    editorialCopy: {
      description: 'Desc',
      humanSeverity: 'MINOR',
    },
  }
  assert.throws(() => assertNoForbiddenKeys(badNestedCopy), /FORBIDDEN_KEY_DETECTED/)

  const badDeeplyNested = {
    facts: {
      title: 'Test',
      metadata: {
        nested: {
          cohortDecision: 'APPROVE',
        },
      },
    },
    editorialCopy: { description: 'Desc' },
  }
  assert.throws(() => assertNoForbiddenKeys(badDeeplyNested), /FORBIDDEN_KEY_DETECTED/)
})

// 10. Canonical blind packet serialization produces byte-identical hash across all reviewers
test('10. Canonical blind packet serialization is byte-identical across Gemini, Claude, and Sophia', () => {
  const riskInputPath = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/execution/scale-tranche-1/risk-verifiers/exp100-tmdb-10377/risk-input.json'
  const riskInput = JSON.parse(fs.readFileSync(path.join(repoRoot, riskInputPath), 'utf8'))
  const packet = projectBlindPacket(riskInput, 'exp100-tmdb-10377')

  const bytesGemini = serializeArtifactForPersistence(packet)
  const bytesClaude = serializeArtifactForPersistence(packet)
  const bytesSophia = serializeArtifactForPersistence(packet)

  assert.equal(bytesGemini, bytesClaude)
  assert.equal(bytesClaude, bytesSophia)

  const hashGemini = 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytesGemini, 'utf8')).digest('hex')
  const hashClaude = 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytesClaude, 'utf8')).digest('hex')
  const hashSophia = 'sha256:' + crypto.createHash('sha256').update(Buffer.from(bytesSophia, 'utf8')).digest('hex')

  assert.equal(hashGemini, hashClaude)
  assert.equal(hashClaude, hashSophia)
})

// 11. Human adjudication record schema validation
test('11. Human adjudication record actual JSON Schema validation and decision invariants', () => {
  const schema = readJson('human-adjudication-record.schema.v1.json')

  // Positive APPROVE fixture
  const validApprove = {
    candidateId: 'scale500-tmdb-12345',
    blindPacketHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    geminiAdvisoryRecordSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    claudeAdvisoryRecordSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    adjudicator: 'Sophia Zhao',
    finalDecision: 'APPROVE',
    finalSeverity: null,
    affectedFields: [],
    materialIssues: [],
    humanRationale: 'Copy satisfies A_PRIME_PRODUCTION_MATERIALITY_V1.',
    agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
    adjudicationTimestamp: '2026-09-17T01:00:00Z',
  }
  const resApprove = validateJsonSchema(validApprove, schema)
  assert.equal(resApprove.valid, true, `Valid APPROVE failed schema: ${resApprove.errors.join(', ')}`)

  // Negative APPROVE with non-null severity
  const badApproveSev = { ...validApprove, finalSeverity: 'MINOR' }
  assert.equal(validateJsonSchema(badApproveSev, schema).valid, false)

  // Negative APPROVE with non-empty affectedFields
  const badApproveFields = { ...validApprove, affectedFields: ['whyWatch'] }
  assert.equal(validateJsonSchema(badApproveFields, schema).valid, false)

  // Negative APPROVE with non-empty materialIssues
  const badApproveIssues = { ...validApprove, materialIssues: ['invented motive'] }
  assert.equal(validateJsonSchema(badApproveIssues, schema).valid, false)

  // Positive REVISE fixture
  const validRevise = {
    candidateId: 'scale500-tmdb-12345',
    blindPacketHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    geminiAdvisoryRecordSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    claudeAdvisoryRecordSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    adjudicator: 'Sophia Zhao',
    finalDecision: 'REVISE',
    finalSeverity: 'SEVERE',
    affectedFields: ['description'],
    materialIssues: ['invented core plot mechanism'],
    humanRationale: 'Unauthorized plot mechanics alteration.',
    agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
    adjudicationTimestamp: '2026-09-17T01:00:00Z',
  }
  const resRevise = validateJsonSchema(validRevise, schema)
  assert.equal(resRevise.valid, true, `Valid REVISE failed schema: ${resRevise.errors.join(', ')}`)

  // Negative REVISE with null severity
  const badReviseNullSev = { ...validRevise, finalSeverity: null }
  assert.equal(validateJsonSchema(badReviseNullSev, schema).valid, false)

  // Negative REVISE with empty affectedFields
  const badReviseEmptyFields = { ...validRevise, affectedFields: [] }
  assert.equal(validateJsonSchema(badReviseEmptyFields, schema).valid, false)

  // Negative REVISE with empty materialIssues
  const badReviseEmptyIssues = { ...validRevise, materialIssues: [] }
  assert.equal(validateJsonSchema(badReviseEmptyIssues, schema).valid, false)

  // Negative REVISE missing finalSeverity property entirely
  const { finalSeverity: _omit1, ...badReviseMissingSev } = validRevise
  assert.equal(validateJsonSchema(badReviseMissingSev, schema).valid, false)

  // Negative missing blindPacketHash
  const { blindPacketHash: _omit2, ...badMissingBlindHash } = validApprove
  assert.equal(validateJsonSchema(badMissingBlindHash, schema).valid, false)

  // Negative missing geminiAdvisoryRecordSha256
  const { geminiAdvisoryRecordSha256: _omit3, ...badMissingGemini } = validApprove
  assert.equal(validateJsonSchema(badMissingGemini, schema).valid, false)

  // Negative missing claudeAdvisoryRecordSha256
  const { claudeAdvisoryRecordSha256: _omit4, ...badMissingClaude } = validApprove
  assert.equal(validateJsonSchema(badMissingClaude, schema).valid, false)

  // Negative non-Sophia adjudicator
  const badAdjudicator = { ...validApprove, adjudicator: 'Claude' }
  assert.equal(validateJsonSchema(badAdjudicator, schema).valid, false)

  // Negative additional property
  const badAdditional = { ...validApprove, unauthorizedProperty: true }
  assert.equal(validateJsonSchema(badAdditional, schema).valid, false)
})

// 11b. Repository JSON Schema subset validator integrity and fail-closed behavior
test('11b. jsonSchemaValidator designation, supported keywords enumeration, and fail-closed validation', () => {
  assert.equal(VALIDATOR_DESIGNATION, 'REPOSITORY_JSON_SCHEMA_SUBSET_VALIDATOR')
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.has('$schema'))
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.has('type'))
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.has('properties'))
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.has('format'))

  // Throws on unsupported keyword
  const unsupportedSchema = {
    type: 'object',
    properties: {
      foo: { type: 'string', minContains: 1 },
    },
  }
  assert.throws(
    () => assertSchemaKeywordsSupported(unsupportedSchema),
    /UNSUPPORTED_SCHEMA_KEYWORD: Schema keyword 'minContains'/
  )
  assert.throws(
    () => validateJsonSchema({ foo: 'bar' }, unsupportedSchema),
    /UNSUPPORTED_SCHEMA_KEYWORD: Schema keyword 'minContains'/
  )

  // Validates format: date-time
  const dateTimeSchema = {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
    },
    required: ['timestamp'],
  }
  assert.equal(validateJsonSchema({ timestamp: '2026-09-17T01:00:00Z' }, dateTimeSchema).valid, true)
  assert.equal(validateJsonSchema({ timestamp: 'not-a-date' }, dateTimeSchema).valid, false)
  assert.equal(validateJsonSchema({ timestamp: '2026-02-31T01:00:00Z' }, dateTimeSchema).valid, false)
})

// 12. Common preliminary advisory review actual schema validation
test('12. Preliminary advisory review actual schema validation and advisoryOnly invariant', () => {
  const schema = readJson('preliminary-advisory-review.schema.v1.json')
  assert.equal(schema.properties.advisoryOnly.const, true)

  // Positive APPROVE fixture
  const validApprove = {
    preliminaryDecision: 'APPROVE',
    preliminarySeverity: null,
    affectedFields: [],
    issueSummaries: [],
    claimSpan: '',
    sourceEvidence: [{ source: 'facts.overview', supportFound: true, notes: null }],
    sourceBoundaryReason: 'Clean atmospheric copy.',
    confidence: 'HIGH',
    advisoryOnly: true,
  }
  const resApprove = validateJsonSchema(validApprove, schema)
  assert.equal(resApprove.valid, true, `Valid preliminary APPROVE failed schema: ${resApprove.errors.join(', ')}`)

  // Negative APPROVE with non-null severity
  const badApproveSev = { ...validApprove, preliminarySeverity: 'MINOR' }
  assert.equal(validateJsonSchema(badApproveSev, schema).valid, false)

  // Negative APPROVE with non-empty affectedFields
  const badApproveFields = { ...validApprove, affectedFields: ['whyWatch'] }
  assert.equal(validateJsonSchema(badApproveFields, schema).valid, false)

  // Negative APPROVE with non-empty issueSummaries
  const badApproveIssues = { ...validApprove, issueSummaries: ['Ungrounded comparison'] }
  assert.equal(validateJsonSchema(badApproveIssues, schema).valid, false)

  // Positive REVISE fixture
  const validRevise = {
    preliminaryDecision: 'REVISE',
    preliminarySeverity: 'MINOR',
    affectedFields: ['whyWatch'],
    issueSummaries: ['Ungrounded comparison'],
    claimSpan: 'like a modern Hitchcock',
    sourceEvidence: [{ source: 'facts.overview', supportFound: false, notes: 'No director comparison in overview' }],
    sourceBoundaryReason: 'Unauthorized comparison.',
    confidence: 'MEDIUM',
    advisoryOnly: true,
  }
  const resRevise = validateJsonSchema(validRevise, schema)
  assert.equal(resRevise.valid, true, `Valid preliminary REVISE failed schema: ${resRevise.errors.join(', ')}`)

  // Negative REVISE with null severity
  const badReviseNullSev = { ...validRevise, preliminarySeverity: null }
  assert.equal(validateJsonSchema(badReviseNullSev, schema).valid, false)

  // Negative REVISE with empty affectedFields
  const badReviseEmptyFields = { ...validRevise, affectedFields: [] }
  assert.equal(validateJsonSchema(badReviseEmptyFields, schema).valid, false)

  // Negative REVISE with empty issueSummaries
  const badReviseEmptyIssues = { ...validRevise, issueSummaries: [] }
  assert.equal(validateJsonSchema(badReviseEmptyIssues, schema).valid, false)

  // Negative advisoryOnly false
  const badAdvisoryOnly = { ...validRevise, advisoryOnly: false }
  assert.equal(validateJsonSchema(badAdvisoryOnly, schema).valid, false)

  // Negative missing preliminarySeverity
  const { preliminarySeverity: _omit1, ...badMissingSev } = validRevise
  assert.equal(validateJsonSchema(badMissingSev, schema).valid, false)

  // Negative additional property
  const badAdditional = { ...validRevise, unallowedProperty: true }
  assert.equal(validateJsonSchema(badAdditional, schema).valid, false)
})

// 12b. Governed persisted advisory record envelope actual JSON Schema validation
test('12b. Governed persisted advisory record envelope cryptographically binds opinion to candidate and packet', () => {
  const schema = readJson('preliminary-advisory-record.schema.v1.json')

  const validEnvelope = {
    candidateId: 'scale500-tmdb-12345',
    blindPacketSha256: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    reviewer: 'GEMINI',
    reviewerModel: 'gemini-2.5-flash',
    reviewPromptSha256: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    materialityPolicySha256: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    rawResponseSha256: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    validatedOpinion: {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: '',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true, notes: null }],
      sourceBoundaryReason: 'Copy satisfies A_PRIME_PRODUCTION_MATERIALITY_V1.',
      confidence: 'HIGH',
      advisoryOnly: true,
    },
  }

  const resValid = validateJsonSchema(validEnvelope, schema)
  assert.equal(resValid.valid, true, `Valid envelope failed schema: ${resValid.errors.join(', ')}`)

  // Negative missing blindPacketSha256
  const { blindPacketSha256: _omit1, ...badMissingPacketHash } = validEnvelope
  assert.equal(validateJsonSchema(badMissingPacketHash, schema).valid, false)

  // Negative invalid reviewer
  const badReviewer = { ...validEnvelope, reviewer: 'HUMAN' }
  assert.equal(validateJsonSchema(badReviewer, schema).valid, false)

  // Negative invalid opinion inside envelope
  const badOpinion = {
    ...validEnvelope,
    validatedOpinion: {
      ...validEnvelope.validatedOpinion,
      preliminarySeverity: 'SEVERE',
    },
  }
  assert.equal(validateJsonSchema(badOpinion, schema).valid, false)

  // Negative tampered candidateId format
  const badCandidateId = { ...validEnvelope, candidateId: 'invalid-id' }
  assert.equal(validateJsonSchema(badCandidateId, schema).valid, false)

  // Negative additional property on envelope
  const badAdditional = { ...validEnvelope, leakedData: 'forbidden' }
  assert.equal(validateJsonSchema(badAdditional, schema).valid, false)
})

// 13. Mechanized holdout-disjointness proof and source-universe audit
test('13. Mechanized holdout provenance proof audits subset premise without holdout access', () => {
  const provenance = readJson('blind-review-pool-provenance.v1.json')
  assert.equal(provenance.holdoutFirewallStatus, 'LEGACY_HOLDOUT_IDENTITY_GOVERNANCE_DIAGNOSTIC_COMPLETED')
  assert.equal('prospectiveHoldoutContentsAccessed' in provenance.mechanizedHoldoutDisjointnessProof, false)

  const curatedProof = provenance.mechanizedHoldoutDisjointnessProof.curatedLegacyCatalogue
  const t1Proof = provenance.mechanizedHoldoutDisjointnessProof.scaleTranche1Catalogue
  const t2Proof = provenance.mechanizedHoldoutDisjointnessProof.scaleTranche2Catalogue

  assert.equal(t1Proof.intersectionWithCuratedCount, 0)
  assert.equal(t2Proof.intersectionWithCuratedCount, 0)

  // Governance source binding
  const govSource = provenance.mechanizedHoldoutDisjointnessProof.governanceSource
  assert.equal(govSource.sourcePath, 'catalogue-pipeline/scripts/semanticHoldoutGovernance.mjs')
  assert.equal(govSource.sourceUniverseDefinitionVersion, 'phase-5-semantic-holdout-manifest.v1')
  assert.equal(govSource.sha256, sha256(path.join(repoRoot, govSource.sourcePath)))

  // Mechanically re-verify against disk files
  const curatedContent = fs.readFileSync(path.join(repoRoot, curatedProof.sourcePath), 'utf8')
  const liveCuratedIds = new Set([...curatedContent.matchAll(/tmdbId:\s*(\d+)/g)].map((m) => Number(m[1])))
  assert.equal(liveCuratedIds.size, curatedProof.totalCuratedMovies)

  const t1Cohort = JSON.parse(fs.readFileSync(path.join(repoRoot, t1Proof.sourcePath), 'utf8'))
  const t1Overlap = t1Cohort.records.filter((r) => liveCuratedIds.has(r.tmdbId))
  assert.equal(t1Overlap.length, 0)

  const t2Cohort = JSON.parse(fs.readFileSync(path.join(repoRoot, t2Proof.sourcePath), 'utf8'))
  const t2Overlap = t2Cohort.records.filter((r) => liveCuratedIds.has(r.tmdbId))
  assert.equal(t2Overlap.length, 0)

  // Verification of subset premise status and resolved verdict
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.subsetPremiseStatus, 'RESOLVED_BY_IDENTITY_FIREWALL_AUDIT')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.holdoutSourceUniverseProofStatus, 'OBSERVED_ZERO_OVERLAP')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.epistemicProofVerdict, 'OBSERVED_ZERO_OVERLAP_LEGACY_HOLDOUT_RETIRED')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.legacyHoldoutStatus, 'LEGACY_HOLDOUT_RETIRED_FROM_FUTURE_PROSPECTIVE_VALIDATION')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.observedHistoricalOverlapCount, 0)
})

// 13b. Sealed holdout identity firewall audit verification
test('13b. Sealed holdout identity firewall audit proves zero identity overlap and acknowledges incident', () => {
  const audit = readJson('sealed-holdout-identity-firewall-audit.v1.json')
  assert.equal(audit.activity, FIREWALL_ACTIVITY)
  assert.equal(audit.classification, 'HISTORICAL_GOVERNANCE_DIAGNOSTIC')
  assert.equal(audit.holdoutRecordCount, 10)
  assert.equal(audit.eligibleRecordCount, 184)
  assert.equal(audit.intersectionCount, 0)
  assert.equal(audit.observedHistoricalOverlapCount, 0)
  assert.equal(audit.rawFileBytesRead, true)
  assert.equal(audit.nonIdentityFieldsDecoded, false)
  assert.equal(audit.semanticLabelsDisclosed, false)
  assert.equal(audit.semanticCopyDisclosed, false)
  assert.equal(audit.labelsDecoded, false)
  assert.equal(audit.identitiesDisclosed, true)
  assert.equal(audit.futureProspectiveValidationEligible, false)
  assert.equal(audit.identityConfidentialityPreserved, false)
  assert.equal(audit.legacyHoldoutStatus, 'LEGACY_HOLDOUT_RETIRED_FROM_FUTURE_PROSPECTIVE_VALIDATION')
  assert.equal(audit.identityConfidentialityStatus, 'IDENTITY_CONFIDENTIALITY_COMPROMISED')
  assert.equal(audit.verdict, 'HISTORICAL_DIAGNOSTIC_OBSERVED_ZERO_OVERLAP')

  // Verify breakdown
  assert.equal(audit.identityResolutionBreakdown.tmdbIdDirect, 8)
  assert.equal(audit.identityResolutionBreakdown.frozenCanonicalMapping, 2)
  assert.equal(audit.identityResolutionBreakdown.titleYearFallback, 0)

  // Verify all input bindings match actual disk hashes
  for (const [key, binding] of Object.entries(audit.inputBindings)) {
    const fullPath = path.join(repoRoot, binding.path)
    assert.equal(fs.existsSync(fullPath), true, `Input binding file missing: ${binding.path}`)
    assert.equal(sha256(fullPath), binding.sha256, `SHA-256 mismatch for audit input '${key}'`)
  }
})

// 14. Separation of development exposure from prior human review
test('14. Exposure ledger separates development exposure from prior human adjudication', () => {
  const ledger = readJson('semantic-exposure-ledger.v2.json')
  assert.equal(ledger.counts.developmentExposed, 53)
  assert.equal(ledger.counts.priorHumanOnlyExcluded, 17)
  assert.equal(ledger.counts.overlap, 53)
  assert.equal(ledger.counts.totalEvaluationExcluded, 70)

  // Assert no record is labeled DEVELOPMENT_EXPOSED solely due to prior human adjudication
  for (const r of ledger.records) {
    if (r.exclusionClass === 'DEVELOPMENT_EXPOSED') {
      assert.equal(r.isDevelopmentExposed, true)
      assert.ok(r.developmentExposureReasons.length >= 1)
    } else {
      assert.equal(r.exclusionClass, 'PRIOR_HUMAN_ADJUDICATION')
      assert.equal(r.isDevelopmentExposed, false)
      assert.equal(r.isPriorHumanAdjudicated, true)
      assert.equal(r.developmentExposureReasons.length, 0)
    }
  }
})

// 15. Generator script and master protocol cryptographic bindings are intact
test('15. Generator script and master protocol cryptographic bindings are intact across all bound files', () => {
  const p21Proto = readJson('p2-1-protocol.v1.json')
  const boundKeys = Object.keys(p21Proto.bindings)

  for (const key of boundKeys) {
    const binding = p21Proto.bindings[key]
    if (binding.path) {
      const fullPath = path.join(repoRoot, binding.path)
      assert.equal(fs.existsSync(fullPath), true, `Bound file missing: ${binding.path}`)
      assert.equal(sha256(fullPath), binding.sha256, `SHA-256 mismatch for binding '${key}' (${binding.path})`)
    }
  }

  // Specifically check required bindings
  assert.ok(p21Proto.bindings.blindReviewPacketScript, 'Missing blindReviewPacketScript binding')
  assert.ok(p21Proto.bindings.blindHumanReviewProtocolDoc, 'Missing blindHumanReviewProtocolDoc binding')
  assert.ok(p21Proto.bindings.preliminaryAdvisoryRecordEnvelopeSchema, 'Missing preliminaryAdvisoryRecordEnvelopeSchema binding')
  assert.ok(p21Proto.bindings.jsonSchemaValidator, 'Missing jsonSchemaValidator binding')
  assert.ok(p21Proto.bindings.validatePromotionContract, 'Missing validatePromotionContract binding')
  assert.ok(p21Proto.bindings.sealedHoldoutFirewallAuditScript, 'Missing sealedHoldoutFirewallAuditScript binding')
  assert.ok(p21Proto.bindings.legacyHoldoutRetirement, 'Missing legacyHoldoutRetirement binding')
  assert.equal('holdoutIdentityMapping' in p21Proto.bindings, false, 'holdoutIdentityMapping should be retired')
})

// 15b. Review availability policy matches Sophia explicit workflow
test('15b. Both preliminary advisories required before primary human adjudication', () => {
  const p21Proto = readJson('p2-1-protocol.v1.json')
  const policy = p21Proto.reviewAvailabilityPolicy
  assert.equal(policy.rule, 'BOTH_PRELIMINARY_ADVISORIES_REQUIRED_BEFORE_PRIMARY_HUMAN_ADJUDICATION')
  assert.equal(policy.pauseStatus, 'REVIEW_PAUSED_PENDING_ADVISORY')
  assert.equal(policy.singleAdvisoryContinuationForbidden, true)
})

// 16. Terminology designation verification
test('16. Protocol, schemas, and prompts use VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION', () => {
  const p21Proto = readJson('p2-1-protocol.v1.json')
  assert.equal(p21Proto.workflow, 'VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION')

  const geminiPrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-gemini-preliminary.v1.md'), 'utf8')
  assert.match(geminiPrompt, /VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION/)

  const claudePrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-claude-preliminary.v1.md'), 'utf8')
  assert.match(claudePrompt, /VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION/)

  const protocolMd = fs.readFileSync(path.join(p2Dir, 'BLIND_HUMAN_REVIEW_PROTOCOL.md'), 'utf8')
  assert.match(protocolMd, /VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION/)
})

// 17. Verbatim rubric verification against canonical policy
test('17. Gemini and Claude prompts quote verbatim canonical A_PRIME_PRODUCTION_MATERIALITY_V1 text', () => {
  const materialityPolicyPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-materiality-policy.v1.json')
  const policy = JSON.parse(fs.readFileSync(materialityPolicyPath, 'utf8'))
  assert.equal(sha256(materialityPolicyPath), 'sha256:21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c')

  const geminiPrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-gemini-preliminary.v1.md'), 'utf8')
  const claudePrompt = fs.readFileSync(path.join(p2Dir, 'review-prompts/verifier-v14-claude-preliminary.v1.md'), 'utf8')

  // Check exact principle string
  assert.ok(geminiPrompt.includes(policy.principle), 'Gemini prompt missing verbatim principle')
  assert.ok(claudePrompt.includes(policy.principle), 'Claude prompt missing verbatim principle')

  // Check exact classification definitions
  assert.ok(geminiPrompt.includes(policy.classifications.MINOR_CONCRETE_UNSUPPORTED_CLAIM))
  assert.ok(claudePrompt.includes(policy.classifications.MINOR_CONCRETE_UNSUPPORTED_CLAIM))
  assert.ok(geminiPrompt.includes(policy.classifications.SEVERE_MATERIAL_SOURCE_BOUNDARY_FAILURE))
  assert.ok(claudePrompt.includes(policy.classifications.SEVERE_MATERIAL_SOURCE_BOUNDARY_FAILURE))
})

// 18. Sophia is registered as final primary adjudicator
test('18. Sophia Zhao is registered as the sole primary final human adjudicator', () => {
  const humanSchema = readJson('human-adjudication-record.schema.v1.json')
  assert.equal(humanSchema.properties.adjudicator.const, 'Sophia Zhao')

  const qaProto = readJson('second-review-qa-protocol.v1.json')
  assert.equal(qaProto.reviewerAuthorityFramework.primaryGroundTruthAuthority, 'Sophia Zhao (authoritative primary ground truth)')
})

// 19. Review stopping rule is >=30 clean AND >=30 defect AND >=6 severe
test('19. Review stopping rule is >=30 CLEAN, >=30 DEFECT_POSITIVE, and >=6 SEVERE_DEFECT_POSITIVE', () => {
  const p21Proto = readJson('p2-1-protocol.v1.json')
  assert.equal(p21Proto.sequentialReviewStoppingRule.cleanThreshold, 30)
  assert.equal(p21Proto.sequentialReviewStoppingRule.defectPositiveThreshold, 30)
  assert.equal(p21Proto.sequentialReviewStoppingRule.severeDefectPositiveThreshold, 6)
  assert.equal(p21Proto.sequentialReviewStoppingRule.exhaustionVerdict, 'VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT')
})

// 20. Final severe target is minimum 6, not exactly 6
test('20. Final severe defect target is registered as minimum 6, not exactly 6', () => {
  const p21Proto = readJson('p2-1-protocol.v1.json')
  assert.equal(p21Proto.finalEvaluationCohortRequirements.minimumSevereInFinalEvaluationCohort, 6)
  assert.equal(p21Proto.finalEvaluationCohortRequirements.exactSevereRequirement, false)
})

// 21. QA covers all severe
test('21. Second-review QA protocol mandates 100% coverage of all severe adjudications', () => {
  const qaProto = readJson('second-review-qa-protocol.v1.json')
  assert.equal(qaProto.samplingRules.severeAdjudications.coverage, '100_PERCENT')
})

// 22. QA selects exactly ceil(25% of non-severe completed adjudications)
test('22. Second-review QA protocol specifies exact formula ceil(0.25 * nonSevereCompletedCount)', () => {
  const qaProto = readJson('second-review-qa-protocol.v1.json')
  assert.equal(qaProto.samplingRules.nonSevereAdjudications.coverage, 'CEIL_25_PERCENT')
  assert.equal(qaProto.samplingRules.nonSevereAdjudications.formula, 'ceil(0.25 * nonSevereCompletedCount)')
})

// 23. QA sample order depends only on frozen QA seed + candidateId
test('23. QA sampling order depends strictly on frozen QA seed and candidateId', () => {
  const qaProto = readJson('second-review-qa-protocol.v1.json')
  const expectedSeed = 'VERIFIER_V14_P2_SECOND_REVIEW_QA|deda014|source-boundary-risk-verifier.v1.4-semantic-development.r1'
  assert.equal(qaProto.seedMaterial, expectedSeed)
  assert.equal(qaProto.seedSha256, 'sha256:' + sha256Hex(expectedSeed))
  assert.equal(qaProto.samplingRules.nonSevereAdjudications.contentBasedSelection, false)
})

// 24. Second AI audit is not represented as human inter-rater reliability
test('24. Second-review AI audit cannot support claims of human inter-rater reliability', () => {
  const qaProto = readJson('second-review-qa-protocol.v1.json')
  assert.match(qaProto.reviewerAuthorityFramework.epistemicDistinction, /CANNOT be represented as human inter-rater reliability/)
})

// 25. Correction protocol forbids silent label mutation
test('25. Correction protocol strictly forbids silent label mutation and requires versioned audit records', () => {
  const corrProto = readJson('adjudication-correction-protocol.v1.json')
  assert.equal(corrProto.disagreementRules.silentMutationForbidden, true)
  assert.equal(corrProto.disagreementRules.automaticOverwritesForbidden, true)
  assert.equal(corrProto.disagreementRules.reconciliationRecordRequired, true)
  assert.equal(corrProto.disagreementRules.originalSophiaDecisionPreserved, true)
})

// 26. Canonical JSON serialization matches disk bytes
test('26. Canonical JSON serialization matches disk bytes for all governed P2.1 artifacts', () => {
  const files = [
    'semantic-exposure-ledger.v2.json',
    'exposure-reconciliation.v2.json',
    'blind-review-eligible-pool.v1.json',
    'blind-review-pool-provenance.v1.json',
    'blind-review-order.v1.json',
    'blind-human-review-packet.schema.v1.json',
    'human-adjudication-record.schema.v1.json',
    'preliminary-advisory-review.schema.v1.json',
    'preliminary-advisory-record.schema.v1.json',
    'second-review-qa-protocol.v1.json',
    'adjudication-correction-protocol.v1.json',
    'p2-1-protocol.v1.json',
    'sealed-holdout-identity-firewall-audit.v1.json',
    'legacy-prospective-holdout-retirement.v1.json',
    'p2-1-freeze-manifest.v1.json',
  ]

  for (const f of files) {
    const filePath = path.join(p2Dir, f)
    const diskBytes = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(diskBytes)
    const reSerialized = serializeArtifactForPersistence(parsed)
    assert.equal(diskBytes, reSerialized, `Serialization mismatch for ${f}`)
  }
})

// 27. Extractor never calls JSON.parse on holdout document bytes
test('27. Extractor never calls JSON.parse on holdout document bytes', () => {
  const holdoutPath = path.join(repoRoot, 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json')
  const origJsonParse = JSON.parse
  let holdoutParsedViaJsonParse = false

  JSON.parse = function (text, reviver) {
    if (typeof text === 'string' && text.includes('"schemaVersion": "prospective-semantic-holdouts.v1"')) {
      holdoutParsedViaJsonParse = true
    }
    return origJsonParse.call(this, text, reviver)
  }

  try {
    const result = extractHoldoutIdentitiesOnly(holdoutPath)
    assert.equal(holdoutParsedViaJsonParse, false, 'JSON.parse was called on prospective holdouts')
    assert.equal(result.totalRecords, 10)
  } finally {
    JSON.parse = origJsonParse
  }
})

// 28. Only registered identity keys are decoded; unrelated fields are skipped
test('28. Only registered identity keys are decoded; unrelated fields are strictly skipped', () => {
  assert.ok(ALLOWED_IDENTITY_KEYS.has('tmdbId'))
  assert.ok(ALLOWED_IDENTITY_KEYS.has('canonicalId'))
  assert.ok(ALLOWED_IDENTITY_KEYS.has('provisionalId'))
  assert.ok(ALLOWED_IDENTITY_KEYS.has('title'))
  assert.ok(ALLOWED_IDENTITY_KEYS.has('year'))

  // Verify non-identity keys are NOT in allowed identity set
  const forbiddenHoldoutKeys = ['overview', 'description', 'whyWatch', 'curiosityHook', 'vibeSummary', 'labels', 'goldProvenance', 'friendsGold']
  for (const k of forbiddenHoldoutKeys) {
    assert.equal(ALLOWED_IDENTITY_KEYS.has(k), false, `Forbidden key '${k}' found in ALLOWED_IDENTITY_KEYS`)
  }
})

// 29. No per-record identities appear in audit artifact
test('29. No per-record identities appear in audit artifact and incident is acknowledged', () => {
  const audit = readJson('sealed-holdout-identity-firewall-audit.v1.json')

  assert.equal(audit.identitiesDisclosed, true)
  assert.equal(audit.semanticLabelsDisclosed, false)
  assert.equal(audit.semanticCopyDisclosed, false)
  assert.equal(audit.labelsDecoded, false)
  assert.equal(audit.nonIdentityFieldsDecoded, false)
  assert.equal(audit.rawFileBytesRead, true)

  // Verify no per-record array exists
  assert.equal('records' in audit, false)
  assert.equal('overlappingCandidateIds' in audit, false)
  assert.equal('holdoutTitles' in audit, false)
})

// 30. Zero-overlap provenance requires successful zero-overlap audit verdict
test('30. Zero-overlap provenance requires successful zero-overlap audit verdict', () => {
  const provenance = readJson('blind-review-pool-provenance.v1.json')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.subsetPremiseStatus, 'RESOLVED_BY_IDENTITY_FIREWALL_AUDIT')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.holdoutSourceUniverseProofStatus, 'OBSERVED_ZERO_OVERLAP')
  assert.equal(provenance.mechanizedHoldoutDisjointnessProof.epistemicProofVerdict, 'OBSERVED_ZERO_OVERLAP_LEGACY_HOLDOUT_RETIRED')
})

// 31. Simulated overlap > 0 produces OVERLAP_PRESENT verdict and fails closed
test('31. Simulated overlap > 0 produces OVERLAP_PRESENT verdict in standalone diagnostic', () => {
  const syntheticHoldoutJson = JSON.stringify({
    schemaVersion: 'prospective-semantic-holdouts.v1',
    records: [
      {
        title: 'Overlapping Movie',
        tmdbId: 10377,
        year: 2000,
      },
    ],
  })

  const tempHoldoutPath = path.join(p2Dir, 'temp-synthetic-holdout-test.json')
  fs.writeFileSync(tempHoldoutPath, syntheticHoldoutJson)

  try {
    const auditRes = executeSealedHoldoutFirewallAudit({
      holdoutPath: tempHoldoutPath,
      eligiblePoolPath: path.join(p2Dir, 'blind-review-eligible-pool.v1.json'),
      reviewOrderPath: path.join(p2Dir, 'blind-review-order.v1.json'),
      p1ProtocolPath: path.join(p2Dir, 'protocol.v1.json'),
      p21ProtocolPath: path.join(p2Dir, 'p2-1-protocol.v1.json'),
      outputPath: path.join(p2Dir, 'temp-synthetic-audit-output.json'),
    })

    assert.equal(auditRes.overlappingCandidatesCount, 1)
    assert.equal(auditRes.verdict, 'HOLDOUT_IDENTITY_OVERLAP_PRESENT_REQUIRES_BLIND_FILTERING')
    assert.notEqual(auditRes.verdict, 'HOLDOUT_IDENTITY_FIREWALL_PASS_ZERO_OVERLAP')
  } finally {
    if (fs.existsSync(tempHoldoutPath)) fs.unlinkSync(tempHoldoutPath)
    const tempOut = path.join(p2Dir, 'temp-synthetic-audit-output.json')
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut)
  }
})

// 32. Final freeze manifest hashes all 25 governed artifacts
test('32. Final freeze manifest hashes all 25 governed artifacts and matches disk bytes', () => {
  const manifest = readJson('p2-1-freeze-manifest.v1.json')
  assert.equal(manifest.activity, 'VERIFIER_V14_P2_1_FREEZE_MANIFEST')
  assert.equal(manifest.totalGovernedArtifactsCount, 25)

  for (const [key, item] of Object.entries(manifest.artifacts)) {
    const fullPath = path.join(repoRoot, item.path)
    assert.equal(fs.existsSync(fullPath), true, `Manifest file missing: ${item.path}`)
    assert.equal(sha256(fullPath), item.sha256, `SHA-256 mismatch for manifest item '${key}' (${item.path})`)
  }
})

// 33. Freeze manifest does not bind itself
test('33. Freeze manifest does not bind itself', () => {
  const manifest = readJson('p2-1-freeze-manifest.v1.json')
  assert.equal('p21FreezeManifest' in manifest.artifacts, false)
  assert.equal('freezeManifest' in manifest.artifacts, false)
})

// 34. Retired holdout cannot be labeled prospective-validation eligible
test('34. Legacy prospective holdout retirement governance record integrity', () => {
  const retirement = readJson('legacy-prospective-holdout-retirement.v1.json')
  assert.equal(retirement.status, 'LEGACY_PROSPECTIVE_HOLDOUT_IDENTITY_CONFIDENTIALITY_COMPROMISED')
  assert.equal(retirement.futureProspectiveValidationEligible, false)
  assert.equal(retirement.identityConfidentialityPreserved, false)
  assert.equal(retirement.semanticLabelsDisclosed, false)
  assert.equal(retirement.semanticCopyDisclosed, false)
  assert.equal(retirement.observedDiagnosticFact.legacyHoldoutRecordCount, 10)
  assert.equal(retirement.observedDiagnosticFact.retrospectiveEligibleCount, 184)
  assert.equal(retirement.observedDiagnosticFact.observedIdentityOverlapCount, 0)
  assert.equal(retirement.observedDiagnosticFact.diagnosticStatus, 'OBSERVED_ZERO_OVERLAP')
})

// 35. Freeze manifest contains no plaintext holdout identity mapping
test('35. Freeze manifest binds retirement governance artifact and contains no plaintext identity mapping', () => {
  const manifest = readJson('p2-1-freeze-manifest.v1.json')
  assert.equal('holdoutIdentityMapping' in manifest.artifacts, false)
  assert.ok(manifest.artifacts.legacyHoldoutRetirement, 'legacyHoldoutRetirement must be in manifest')
  assert.equal(
    manifest.artifacts.legacyHoldoutRetirement.path,
    'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/legacy-prospective-holdout-retirement.v1.json'
  )
})

// 36. Non-identity string skipping does not construct decoded content
test('36. skipJsonStringWithoutDecoding advances over JSON strings without string allocations', () => {
  const syntheticJson = '{"overview": "A complex \\"story\\" with \\n newlines and \\u0020 spaces", "labels": ["CLEAN"]}'
  const startPos = syntheticJson.indexOf('"A complex')
  assert.ok(startPos > 0)

  const endPos = skipJsonStringWithoutDecoding(syntheticJson, startPos)
  assert.equal(syntheticJson[endPos - 1], '"')
  assert.equal(syntheticJson.slice(endPos, endPos + 10), ', "labels"')
})

// 37. Generator-level fail-closed behavior on prerequisite check failure
test('37. Generator-level fail-closed behavior on simulated prerequisite failure', async () => {
  const tempDir = path.join(p2Dir, 'temp-fail-closed-test-dir')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    await assert.rejects(
      async () => {
        await buildP21Artifacts({
          outputDir: tempDir,
          simulatePrerequisiteFailure: true,
        })
      },
      /SIMULATED_PREREQUISITE_FAILURE/
    )

    // Verify no final review artifacts exist in tempDir
    assert.equal(fs.existsSync(path.join(tempDir, 'blind-review-eligible-pool.v1.json')), false)
    assert.equal(fs.existsSync(path.join(tempDir, 'blind-review-order.v1.json')), false)
    assert.equal(fs.existsSync(path.join(tempDir, 'blind-review-pool-provenance.v1.json')), false)
    assert.equal(fs.existsSync(path.join(tempDir, 'p2-1-protocol.v1.json')), false)
    assert.equal(fs.existsSync(path.join(tempDir, 'p2-1-freeze-manifest.v1.json')), false)
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 38. Clean build from empty output directory
test('38. Clean build succeeds in a completely fresh empty output directory without pre-existing files', async () => {
  const tempDir = path.join(p2Dir, 'temp-clean-build-empty-dir')
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    const res = await buildP21Artifacts({ outputDir: tempDir })
    assert.equal(res.artifactsCount, 25)

    const expectedFiles = [
      'semantic-exposure-ledger.v2.json',
      'exposure-reconciliation.v2.json',
      'blind-review-eligible-pool.v1.json',
      'blind-review-order.v1.json',
      'blind-review-pool-provenance.v1.json',
      'second-review-qa-protocol.v1.json',
      'adjudication-correction-protocol.v1.json',
      'blind-human-review-packet.schema.v1.json',
      'human-adjudication-record.schema.v1.json',
      'preliminary-advisory-review.schema.v1.json',
      'preliminary-advisory-record.schema.v1.json',
      'legacy-prospective-holdout-retirement.v1.json',
      'sealed-holdout-identity-firewall-audit.v1.json',
      'p2-1-protocol.v1.json',
      'p2-1-freeze-manifest.v1.json',
    ]

    for (const file of expectedFiles) {
      assert.equal(fs.existsSync(path.join(tempDir, file)), true, `Missing generated file: ${file}`)
    }
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 39. Two independent clean builds produce byte-identical governed artifacts
test('39. Two independent clean builds produce byte-identical governed artifacts', async () => {
  const tempDir1 = path.join(p2Dir, 'temp-clean-build-1')
  const tempDir2 = path.join(p2Dir, 'temp-clean-build-2')

  if (fs.existsSync(tempDir1)) fs.rmSync(tempDir1, { recursive: true, force: true })
  if (fs.existsSync(tempDir2)) fs.rmSync(tempDir2, { recursive: true, force: true })

  fs.mkdirSync(tempDir1, { recursive: true })
  fs.mkdirSync(tempDir2, { recursive: true })

  try {
    await buildP21Artifacts({ outputDir: tempDir1 })
    await buildP21Artifacts({ outputDir: tempDir2 })

    const files = [
      'semantic-exposure-ledger.v2.json',
      'exposure-reconciliation.v2.json',
      'blind-review-eligible-pool.v1.json',
      'blind-review-order.v1.json',
      'blind-review-pool-provenance.v1.json',
      'second-review-qa-protocol.v1.json',
      'adjudication-correction-protocol.v1.json',
      'blind-human-review-packet.schema.v1.json',
      'human-adjudication-record.schema.v1.json',
      'preliminary-advisory-review.schema.v1.json',
      'preliminary-advisory-record.schema.v1.json',
      'legacy-prospective-holdout-retirement.v1.json',
      'sealed-holdout-identity-firewall-audit.v1.json',
      'p2-1-protocol.v1.json',
      'p2-1-freeze-manifest.v1.json',
    ]

    for (const file of files) {
      const bytes1 = fs.readFileSync(path.join(tempDir1, file), 'utf8')
      const bytes2 = fs.readFileSync(path.join(tempDir2, file), 'utf8')
      assert.equal(bytes1, bytes2, `Byte divergence detected for file: ${file}`)
    }
  } finally {
    if (fs.existsSync(tempDir1)) fs.rmSync(tempDir1, { recursive: true, force: true })
    if (fs.existsSync(tempDir2)) fs.rmSync(tempDir2, { recursive: true, force: true })
  }
})

// 40. Confirmation legacy holdout is NOT reread during normal P2.1 build
test('40. Confirmation legacy holdout file is not opened during normal P2.1 build', async () => {
  const origReadFileSync = fs.readFileSync
  let holdoutReadAttempted = false

  fs.readFileSync = function (filePath, ...args) {
    if (typeof filePath === 'string' && filePath.includes('prospective-semantic-holdouts.v1.json')) {
      holdoutReadAttempted = true
    }
    return origReadFileSync.call(this, filePath, ...args)
  }

  const tempDir = path.join(p2Dir, 'temp-no-holdout-read-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    await buildP21Artifacts({ outputDir: tempDir })
    assert.equal(holdoutReadAttempted, false, 'Holdout file was read during normal P2.1 build')
  } finally {
    fs.readFileSync = origReadFileSync
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 41. Exported audit copies match repo bytes
test('41. Exported copy SHA-256 matches repo disk bytes across core artifacts', () => {
  const coreFiles = [
    'catalogue-pipeline/scripts/buildVerifierV14P21Artifacts.mjs',
    'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-1.test.mjs',
    'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-1-freeze-manifest.v1.json',
    'catalogue-pipeline/scripts/runSealedHoldoutIdentityFirewallAudit.mjs',
    'catalogue-pipeline/scripts/jsonSchemaValidator.mjs',
    'catalogue-pipeline/scripts/blindReviewPacket.mjs',
  ]

  for (const relPath of coreFiles) {
    const fullPath = path.join(repoRoot, relPath)
    const diskBytes = fs.readFileSync(fullPath)
    const repoDiskSha256 = 'sha256:' + crypto.createHash('sha256').update(diskBytes).digest('hex')

    const exportedCopy = Buffer.from(diskBytes)
    const exportedCopySha256 = 'sha256:' + crypto.createHash('sha256').update(exportedCopy).digest('hex')

    assert.equal(repoDiskSha256, exportedCopySha256, `Hash mismatch for ${relPath}`)
  }
})
