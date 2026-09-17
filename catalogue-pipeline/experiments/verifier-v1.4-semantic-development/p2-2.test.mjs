import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateJsonSchema } from '../../scripts/jsonSchemaValidator.mjs'

function validateAgainstSchema(schemaPath, data) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  return validateJsonSchema(data, schema)
}
import { serializeArtifactForPersistence } from '../../scripts/validatePromotionContract.mjs'
import {
  CANDIDATE_STATES,
  ALLOWED_TRANSITIONS,
  assertValidTransition,
  AUTHORITATIVE_HUMAN_ADJUDICATOR,
  STOPPING_TARGETS,
  checkStoppingRule,
  deriveAgreementPattern,
  normalizeAgreementPattern,
  validateAgreementPattern,
  createReviewSessionLedger,
  loadReviewSessionLedger,
  validateReviewSessionLedger,
  persistReviewSessionLedger,
  reconcileReviewSessionFromDisk,
  getNextReviewCandidate,
  updateLedgerWithHumanAdjudication,
  atomicWriteJson,
  atomicWriteText,
} from '../../scripts/verifierV14ReviewState.mjs'
import {
  FROZEN_BINDINGS,
  loadGovernedReviewerPrompt,
  loadGovernedMaterialityPolicy,
  FORBIDDEN_ADAPTER_KEYS,
  ALLOWED_OPERATIONAL_METADATA_KEYS,
  filterOperationalMetadata,
  sanitizeTransportMetadata,
  createIsolatedReviewerRequest,
  validateAndBuildAdvisoryEnvelope,
  reviewBlindPacket,
  verifyPromptAndPolicyHashes,
  createMockGeminiReviewer,
  createMockClaudeReviewer,
} from '../../scripts/verifierV14ReviewerAdapter.mjs'
import {
  prepareCandidateExecution,
  collectModelAdvisories,
  resolveOrExecuteReviewerAttempt,
  createHumanReviewBundle,
  verifyCandidateReviewEvidenceChain,
  verifyHumanReviewBundleIntegrity,
  recordHumanAdjudication,
  executeCandidateReviewWorkflow,
  resumeCandidateReviewWorkflow,
} from '../../scripts/runVerifierV14BlindReview.mjs'

const p2Dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(p2Dir, '../../..')

function sha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(p2Dir, relPath), 'utf8'))
}

// Frozen baseline constants
const FROZEN_MANIFEST_SHA = 'sha256:eac6fa41efa1fb36c85b150417782e6a74cfdb57a0122945be0489118c31d9cd'
const FROZEN_REVIEW_ORDER_SHA = 'sha256:758c9775e7e3171c68a50313c2720d4b8f696e6467f9801f12332391dc6213ed'
const FROZEN_P1_PROMPT_SHA = 'sha256:a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f'
const FROZEN_P1_PROTOCOL_SHA = 'sha256:7ccef839cc7bf434156881f6d8c12130a8d5e444e6038a95c50df8572c7c0f4d'
const FROZEN_P21_PROTOCOL_SHA = 'sha256:dd6873615efbdd2d2014cc6b54e17aadf1c60fb9f33d68fefc2e5bd457b24120'
const FROZEN_RETIREMENT_SHA = 'sha256:f3b8d6a0dd58cdfa1ed772e925ab297169ef6191771cad118bd4c522fed67d5f'
const FROZEN_FIREWALL_AUDIT_SHA = 'sha256:ce523484b1a3b7033958828634de5fc2d5317cc168e49a726c3fa4b39b3496b7'

// 1. Frozen Baseline Invariants
test('1. Frozen baseline P1 and P2.1 cryptographic hashes match disk bytes exactly', () => {
  const manifestBytes = fs.readFileSync(path.join(p2Dir, 'p2-1-freeze-manifest.v1.json'))
  assert.equal(sha256(manifestBytes), FROZEN_MANIFEST_SHA)

  const reviewOrderBytes = fs.readFileSync(path.join(p2Dir, 'blind-review-order.v1.json'))
  assert.equal(sha256(reviewOrderBytes), FROZEN_REVIEW_ORDER_SHA)

  const p1PromptBytes = fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md'))
  assert.equal(sha256(p1PromptBytes), FROZEN_P1_PROMPT_SHA)

  const p1ProtocolBytes = fs.readFileSync(path.join(p2Dir, 'protocol.v1.json'))
  assert.equal(sha256(p1ProtocolBytes), FROZEN_P1_PROTOCOL_SHA)

  const p21ProtocolBytes = fs.readFileSync(path.join(p2Dir, 'p2-1-protocol.v1.json'))
  assert.equal(sha256(p21ProtocolBytes), FROZEN_P21_PROTOCOL_SHA)

  const retirementBytes = fs.readFileSync(path.join(p2Dir, 'legacy-prospective-holdout-retirement.v1.json'))
  assert.equal(sha256(retirementBytes), FROZEN_RETIREMENT_SHA)

  const firewallAuditBytes = fs.readFileSync(path.join(p2Dir, 'sealed-holdout-identity-firewall-audit.v1.json'))
  assert.equal(sha256(firewallAuditBytes), FROZEN_FIREWALL_AUDIT_SHA)
})

// 2. Frozen Review Order & Pool Invariants
test('2. Frozen review order contains exactly 184 candidates without duplicate IDs or order mutations', () => {
  const reviewOrder = readJson('blind-review-order.v1.json')
  assert.equal(reviewOrder.totalOrderedCandidates, 184)
  assert.equal(reviewOrder.orderedCandidates.length, 184)

  const seen = new Set()
  for (let i = 0; i < reviewOrder.orderedCandidates.length; i++) {
    const entry = reviewOrder.orderedCandidates[i]
    assert.equal(entry.reviewSequenceIndex, i + 1)
    assert.match(entry.candidateId, /^(?:scale500|exp100)-tmdb-\d+$/)
    assert.equal(seen.has(entry.candidateId), false, `Duplicate candidateId: ${entry.candidateId}`)
    seen.add(entry.candidateId)
  }

  // Candidate #1 is reviewSequenceIndex = 1
  assert.equal(reviewOrder.orderedCandidates[0].reviewSequenceIndex, 1)
})

// 3. Candidate Review State Model & Allowed Transitions
test('3. Candidate state machine allows valid transitions and rejects invalid regressions', () => {
  assert.deepEqual([...CANDIDATE_STATES], [
    'PENDING',
    'PACKET_FROZEN',
    'GEMINI_PENDING',
    'GEMINI_VALID',
    'GEMINI_INVALID',
    'CLAUDE_PENDING',
    'CLAUDE_VALID',
    'CLAUDE_INVALID',
    'REVIEW_PAUSED_PENDING_ADVISORY',
    'READY_FOR_HUMAN_ADJUDICATION',
    'HUMAN_ADJUDICATION_PENDING',
    'HUMAN_ADJUDICATED',
    'QA_PENDING',
    'COMPLETE',
  ])

  // Allowed transitions
  assert.doesNotThrow(() => assertValidTransition('PENDING', 'PACKET_FROZEN'))
  assert.doesNotThrow(() => assertValidTransition('PACKET_FROZEN', 'GEMINI_PENDING'))
  assert.doesNotThrow(() => assertValidTransition('GEMINI_PENDING', 'GEMINI_VALID'))
  assert.doesNotThrow(() => assertValidTransition('GEMINI_VALID', 'CLAUDE_PENDING'))
  assert.doesNotThrow(() => assertValidTransition('CLAUDE_PENDING', 'CLAUDE_VALID'))
  assert.doesNotThrow(() => assertValidTransition('CLAUDE_VALID', 'READY_FOR_HUMAN_ADJUDICATION'))
  assert.doesNotThrow(() => assertValidTransition('READY_FOR_HUMAN_ADJUDICATION', 'HUMAN_ADJUDICATION_PENDING'))
  assert.doesNotThrow(() => assertValidTransition('HUMAN_ADJUDICATION_PENDING', 'HUMAN_ADJUDICATED'))

  // Pausing & Resuming
  assert.doesNotThrow(() => assertValidTransition('GEMINI_PENDING', 'GEMINI_INVALID'))
  assert.doesNotThrow(() => assertValidTransition('GEMINI_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY'))
  assert.doesNotThrow(() => assertValidTransition('REVIEW_PAUSED_PENDING_ADVISORY', 'GEMINI_PENDING'))
  assert.doesNotThrow(() => assertValidTransition('CLAUDE_PENDING', 'CLAUDE_INVALID'))
  assert.doesNotThrow(() => assertValidTransition('CLAUDE_INVALID', 'REVIEW_PAUSED_PENDING_ADVISORY'))
  assert.doesNotThrow(() => assertValidTransition('REVIEW_PAUSED_PENDING_ADVISORY', 'CLAUDE_PENDING'))

  // Disallowed / invalid transitions
  assert.throws(() => assertValidTransition('PENDING', 'HUMAN_ADJUDICATED'), /INVALID_STATE_TRANSITION/)
  assert.throws(() => assertValidTransition('COMPLETE', 'PENDING'), /INVALID_STATE_TRANSITION/)
  assert.throws(() => assertValidTransition('HUMAN_ADJUDICATED', 'GEMINI_PENDING'), /INVALID_STATE_TRANSITION/)
})

// 4. Sequential Selection with 1-based reviewSequenceIndex
test('4. getNextReviewCandidate enforces strict sequential ordering and 1-based sequence index', () => {
  const reviewOrder = readJson('blind-review-order.v1.json')
  const ledger = createReviewSessionLedger({
    p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
    reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
  })

  // First candidate: sequence index 1, array index 0
  const first = getNextReviewCandidate({ ledger, reviewOrder })
  assert.equal(first.sequenceIndex, 1)
  assert.equal(first.arrayIndex, 0)
  assert.equal(first.candidate.candidateId, reviewOrder.orderedCandidates[0].candidateId)
  assert.equal(first.candidate.reviewSequenceIndex, 1)
  assert.equal(first.paused, false)

  // Attempting out of order selection throws
  ledger.currentReviewArrayIndex = 1
  ledger.currentReviewSequenceIndex = 2
  assert.throws(
    () => getNextReviewCandidate({ ledger, reviewOrder }),
    /OUT_OF_ORDER_SELECTION/
  )
})

// 5. Stopping Rule Mechanics
test('5. Stopping rule requires >=30 CLEAN, >=30 DEFECT_POSITIVE, and >=6 SEVERE', () => {
  assert.equal(checkStoppingRule({ cleanCount: 30, defectPositiveCount: 30, severeCount: 5 }).stoppingRuleSatisfied, false)
  assert.equal(checkStoppingRule({ cleanCount: 30, defectPositiveCount: 29, severeCount: 6 }).stoppingRuleSatisfied, false)
  assert.equal(checkStoppingRule({ cleanCount: 29, defectPositiveCount: 30, severeCount: 6 }).stoppingRuleSatisfied, false)
  assert.equal(checkStoppingRule({ cleanCount: 30, defectPositiveCount: 30, severeCount: 6 }).stoppingRuleSatisfied, true)
  assert.equal(checkStoppingRule({ cleanCount: 35, defectPositiveCount: 32, severeCount: 8 }).stoppingRuleSatisfied, true)
})

// 6. Exhausted Pool Handling
test('6. Exhausted pool returns VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT if stopping rule not met', () => {
  const reviewOrder = readJson('blind-review-order.v1.json')
  const ledger = createReviewSessionLedger({
    p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
    reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
  })

  for (let i = 0; i < reviewOrder.orderedCandidates.length; i++) {
    const entry = reviewOrder.orderedCandidates[i]
    ledger.candidateStates[entry.candidateId] = {
      status: 'HUMAN_ADJUDICATED',
      finalDecision: 'APPROVE',
      reviewSequenceIndex: entry.reviewSequenceIndex,
    }
  }
  ledger.completedCount = 184
  ledger.cleanCount = 184
  ledger.defectPositiveCount = 0
  ledger.severeCount = 0
  ledger.currentReviewSequenceIndex = 185
  ledger.currentReviewArrayIndex = 184

  const next = getNextReviewCandidate({ ledger, reviewOrder })
  assert.equal(next.exhaustedPool, true)
  assert.equal(next.status, 'VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT')
})

// 7. Reviewer Request Builder Independence
test('7. Reviewer request builder strictly forbids quota, other model outputs, and verifier data', () => {
  const dummyPacket = Buffer.from(JSON.stringify({ candidateId: 'scale500-tmdb-1', facts: {} }), 'utf8')

  for (const forbiddenKey of FORBIDDEN_ADAPTER_KEYS) {
    assert.throws(
      () =>
        createIsolatedReviewerRequest({
          reviewer: 'GEMINI',
          reviewerModel: 'mock-gemini-v1',
          promptText: 'Review prompt',
          blindPacketBytes: dummyPacket,
          options: { [forbiddenKey]: 'forbidden' },
        }),
      /INDEPENDENCE_VIOLATION/
    )
  }
})

// 8. createIsolatedReviewerRequest Blind Packet Projection
test('8. createIsolatedReviewerRequest provides byte-identical blindPacketJson and matching SHA-256', () => {
  const packetObj = { candidateId: 'scale500-tmdb-10', testField: 'value' }
  const packetBuf = Buffer.from(JSON.stringify(packetObj, null, 2), 'utf8')
  const expectedSha = sha256(packetBuf)

  const req = createIsolatedReviewerRequest({
    reviewer: 'CLAUDE',
    reviewerModel: 'mock-claude-v1',
    promptText: loadGovernedReviewerPrompt('CLAUDE').promptText,
    blindPacketBytes: packetBuf,
  })

  assert.equal(req.blindPacketSha256, expectedSha)
  assert.equal(req.blindPacketJson, packetBuf.toString('utf8'))
})

// 9. Advisory Response Validation
test('9. Advisory response validation rejects malformed JSON and schema invalid opinions', () => {
  const validOpinion = {
    preliminaryDecision: 'APPROVE',
    preliminarySeverity: null,
    affectedFields: [],
    issueSummaries: [],
    claimSpan: 'no material defect observed',
    sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
    sourceBoundaryReason: 'Candidate copy stays within verified factual boundary.',
    confidence: 'HIGH',
    advisoryOnly: true,
    uncertaintyNotes: null,
  }

  // Valid parsing and envelope creation
  const built = validateAndBuildAdvisoryEnvelope({
    rawResponseText: JSON.stringify(validOpinion, null, 2),
    reviewer: 'GEMINI',
    reviewerModel: 'mock-gemini-v1',
    candidateId: 'scale500-tmdb-1',
    blindPacketSha256: sha256('packet'),
    reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
  })
  assert.equal(built.envelope.reviewer, 'GEMINI')
  assert.equal(built.envelope.rawResponseSha256, sha256(JSON.stringify(validOpinion, null, 2)))

  // Malformed JSON throws
  assert.throws(
    () =>
      validateAndBuildAdvisoryEnvelope({
        rawResponseText: '{"preliminaryDecision": "APPROVE", broken json...',
        reviewer: 'GEMINI',
        reviewerModel: 'mock-gemini-v1',
        candidateId: 'scale500-tmdb-1',
        blindPacketSha256: sha256('packet'),
        reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
        materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
      }),
    /MALFORMED_ADVISORY_JSON/
  )

  // Schema invalid throws (e.g. APPROVE with preliminarySeverity = 'MINOR')
  const invalidOpinion = { ...validOpinion, preliminarySeverity: 'MINOR' }
  assert.throws(
    () =>
      validateAndBuildAdvisoryEnvelope({
        rawResponseText: JSON.stringify(invalidOpinion),
        reviewer: 'GEMINI',
        reviewerModel: 'mock-gemini-v1',
        candidateId: 'scale500-tmdb-1',
        blindPacketSha256: sha256('packet'),
        reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
        materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
      }),
    /SCHEMA_INVALID_ADVISORY_OPINION/
  )
})

// 10. Advisory Envelope Schema Compliance
test('10. Advisory envelope conforms to frozen schema and cryptographically binds all inputs', () => {
  const opinion = {
    preliminaryDecision: 'REVISE',
    preliminarySeverity: 'SEVERE',
    affectedFields: ['description'],
    issueSummaries: ['Factual hallucination'],
    claimSpan: 'invented claim',
    sourceEvidence: [{ source: 'facts.overview', supportFound: false, notes: 'Missing from reference' }],
    sourceBoundaryReason: 'Hallucination beyond factual boundary',
    confidence: 'HIGH',
    advisoryOnly: true,
  }

  const envelope = {
    candidateId: 'scale500-tmdb-1',
    blindPacketSha256: sha256('packet-data'),
    reviewer: 'CLAUDE',
    reviewerModel: 'mock-claude-v1',
    reviewPromptSha256: FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256,
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    rawResponseSha256: sha256('raw-response'),
    validatedOpinion: opinion,
  }

  const validation = validateAgainstSchema(
    path.join(p2Dir, 'preliminary-advisory-record.schema.v1.json'),
    envelope
  )
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join('; ')}`)
})

// 11. Mechanical Agreement Pattern Derivation & Normalization
test('11. deriveAgreementPattern and normalizeAgreementPattern enforce canonical enums and normalize aliases', () => {
  assert.equal(
    deriveAgreementPattern({ geminiDecision: 'APPROVE', claudeDecision: 'APPROVE', humanDecision: 'APPROVE' }),
    'BOTH_AI_AGREE_WITH_HUMAN'
  )
  assert.equal(
    deriveAgreementPattern({ geminiDecision: 'REVISE', claudeDecision: 'REVISE', humanDecision: 'APPROVE' }),
    'BOTH_AI_DISAGREE_WITH_HUMAN'
  )
  assert.equal(
    deriveAgreementPattern({ geminiDecision: 'APPROVE', claudeDecision: 'REVISE', humanDecision: 'APPROVE' }),
    'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI'
  )
  assert.equal(
    deriveAgreementPattern({ geminiDecision: 'APPROVE', claudeDecision: 'REVISE', humanDecision: 'REVISE' }),
    'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE'
  )

  // Alias normalization
  assert.equal(
    normalizeAgreementPattern('GEMINI_ONLY_AGREES', {
      geminiDecision: 'APPROVE',
      claudeDecision: 'REVISE',
      humanDecision: 'APPROVE',
    }),
    'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI'
  )
  assert.equal(
    normalizeAgreementPattern('CLAUDE_ONLY_AGREES', {
      geminiDecision: 'APPROVE',
      claudeDecision: 'REVISE',
      humanDecision: 'REVISE',
    }),
    'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE'
  )

  // Inconsistent pattern throws
  assert.throws(
    () =>
      normalizeAgreementPattern('BOTH_AI_AGREE_WITH_HUMAN', {
        geminiDecision: 'APPROVE',
        claudeDecision: 'REVISE',
        humanDecision: 'APPROVE',
      }),
    /AGREEMENT_PATTERN_MISMATCH/
  )
})

// 12. Human Review Bundle Isolation
test('12. Human review bundle strictly hides quota pressure and verifier outcomes', () => {
  const bundle = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'human-review-bundle.v1',
    status: 'READY_FOR_HUMAN_ADJUDICATION',
    candidateId: 'scale500-tmdb-1',
    blindPacketSha256: sha256('packet'),
    geminiAdvisoryEnvelopeSha256: sha256('gemini-env'),
    claudeAdvisoryEnvelopeSha256: sha256('claude-env'),
    materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    blindPacket: {
      candidateId: 'scale500-tmdb-1',
      editorial: { title: 'Test', description: 'Test description' },
      facts: {},
    },
    geminiAdvisory: {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Safe',
      confidence: 'HIGH',
      advisoryOnly: true,
    },
    claudeAdvisory: {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Safe',
      confidence: 'HIGH',
      advisoryOnly: true,
    },
    validationStatus: {
      geminiValidated: true,
      claudeValidated: true,
      packetHashMatched: true,
    },
  }

  const validation = validateAgainstSchema(
    path.join(p2Dir, 'human-review-bundle.schema.v1.json'),
    bundle
  )
  assert.equal(validation.valid, true, `Bundle validation errors: ${validation.errors.join('; ')}`)

  const serialized = JSON.stringify(bundle)
  assert.equal(serialized.includes('quota'), false)
  assert.equal(serialized.includes('cleanCount'), false)
  assert.equal(serialized.includes('defectPositiveCount'), false)
  assert.equal(serialized.includes('candidateVerifierOutput'), false)
})

// 13. Authoritative Human Adjudication Enforcement
test('13. recordHumanAdjudication enforces Sophia Zhao as sole authoritative adjudicator', () => {
  const dummyBundle = {
    blindPacketSha256: sha256('packet'),
    geminiAdvisoryEnvelopeSha256: sha256('gemini'),
    claudeAdvisoryEnvelopeSha256: sha256('claude'),
    geminiAdvisory: { preliminaryDecision: 'APPROVE' },
    claudeAdvisory: { preliminaryDecision: 'APPROVE' },
  }
  const dummyLedger = createReviewSessionLedger({
    p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
    reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
  })

  assert.throws(
    () =>
      recordHumanAdjudication({
        candidateId: 'scale500-tmdb-1',
        candidateDir: path.join(p2Dir, 'temp-fake-dir'),
        reviewSequenceIndex: 1,
        bundle: dummyBundle,
        adjudicationData: {
          adjudicator: 'Unauthorized Person',
          candidateId: 'scale500-tmdb-1',
          finalDecision: 'APPROVE',
          affectedFields: [],
          materialIssues: [],
          humanRationale: 'Test',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: dummyBundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: dummyBundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: dummyBundle.claudeAdvisoryEnvelopeSha256,
        },
        ledger: dummyLedger,
      }),
    /UNAUTHORIZED_ADJUDICATOR/
  )
})

// 14. Operational Metadata Sanitization & Positive Whitelist
test('14. filterOperationalMetadata positively whitelists allowed keys and strips secrets', () => {
  const rawMetadata = {
    provider: 'google',
    model: 'gemini-2.5-pro',
    promptTokens: 500,
    completionTokens: 120,
    apiKey: 'AIzaSySecretApiKey123',
    authorization: 'Bearer sk-ant-secretToken456',
    secretToken: 'sk-abcdef1234567890',
    headers: { Authorization: 'Bearer token' },
    requestObject: { prompt: '...' },
    statusCategory: 'OK',
    latencyMs: 345,
  }

  const sanitized = filterOperationalMetadata(rawMetadata)
  assert.equal(sanitized.provider, 'google')
  assert.equal(sanitized.model, 'gemini-2.5-pro')
  assert.equal(sanitized.promptTokens, 500)
  assert.equal(sanitized.completionTokens, 120)
  assert.equal(sanitized.statusCategory, 'OK')
  assert.equal(sanitized.latencyMs, 345)
  assert.equal(sanitized.apiKey, undefined)
  assert.equal(sanitized.authorization, undefined)
  assert.equal(sanitized.secretToken, undefined)
  assert.equal(sanitized.headers, undefined)
  assert.equal(sanitized.requestObject, undefined)
})

// 15. Persisted Session Ledger Validation and True Reload
test('15. Persisted session ledger survives true atomic disk reload', () => {
  const tempDir = path.join(p2Dir, 'temp-ledger-reload-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  const ledgerPath = path.join(tempDir, 'review-session-ledger.json')

  try {
    const ledger = createReviewSessionLedger({
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      totalEligiblePoolCount: 184,
    })

    ledger.candidateStates['scale500-tmdb-1'] = {
      candidateId: 'scale500-tmdb-1',
      reviewSequenceIndex: 1,
      status: 'HUMAN_ADJUDICATED',
      blindPacketSha256: sha256('packet-1'),
      geminiAdvisoryRecordSha256: sha256('gemini-1'),
      claudeAdvisoryRecordSha256: sha256('claude-1'),
      humanAdjudicationSha256: sha256('human-1'),
      finalDecision: 'APPROVE',
      finalSeverity: null,
    }
    ledger.completedCount = 1
    ledger.cleanCount = 1
    ledger.currentReviewSequenceIndex = 2
    ledger.currentReviewArrayIndex = 1

    persistReviewSessionLedger(ledgerPath, ledger)
    assert.equal(fs.existsSync(ledgerPath), true)

    const reloaded = loadReviewSessionLedger(ledgerPath)
    assert.deepEqual(reloaded, ledger)
    assert.equal(validateReviewSessionLedger(reloaded), true)
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 16. Comprehensive Mock Matrix Scenarios A through N
test('16. Comprehensive Mock Matrix Scenarios A through N execute cleanly', async () => {
  const tempExecDir = path.join(p2Dir, 'temp-mock-matrix')
  if (!fs.existsSync(tempExecDir)) fs.mkdirSync(tempExecDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const testCandidate = reviewOrder.orderedCandidates[0]
    const cId = testCandidate.candidateId

    // Scenario A: Both APPROVE, Sophia APPROVE -> BOTH_AI_AGREE_WITH_HUMAN
    {
      const ledgerA = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirA = path.join(tempExecDir, 'case-a')

      const resA = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirA,
        eligiblePool,
        reviewOrder,
        ledger: ledgerA,
        geminiReviewer: createMockGeminiReviewer(),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'APPROVE',
          finalSeverity: null,
          affectedFields: [],
          materialIssues: [],
          humanRationale: 'Clean factual copy confirmed.',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resA.status, 'HUMAN_ADJUDICATED')
      assert.equal(resA.ledger.cleanCount, 1)
      assert.equal(resA.ledger.defectPositiveCount, 0)
      assert.equal(resA.ledger.completedCount, 1)
      assert.equal(resA.ledger.currentReviewSequenceIndex, 2)
      assert.equal(resA.ledger.currentReviewArrayIndex, 1)
    }

    // Scenario B: Both REVISE/MINOR, Sophia REVISE/MINOR -> BOTH_AI_AGREE_WITH_HUMAN
    {
      const ledgerB = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirB = path.join(tempExecDir, 'case-b')

      const minorOpinion = {
        preliminaryDecision: 'REVISE',
        preliminarySeverity: 'MINOR',
        affectedFields: ['description'],
        issueSummaries: ['Minor factual detail mismatch'],
        claimSpan: 'span',
        sourceEvidence: [{ source: 'facts.overview', supportFound: false }],
        sourceBoundaryReason: 'Minor boundary breach',
        confidence: 'HIGH',
        advisoryOnly: true,
      }

      const resB = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirB,
        eligiblePool,
        reviewOrder,
        ledger: ledgerB,
        geminiReviewer: createMockGeminiReviewer({ cannedOpinion: minorOpinion }),
        claudeReviewer: createMockClaudeReviewer({ cannedOpinion: minorOpinion }),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'REVISE',
          finalSeverity: 'MINOR',
          affectedFields: ['description'],
          materialIssues: ['Minor factual detail mismatch'],
          humanRationale: 'Minor defect verified.',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resB.status, 'HUMAN_ADJUDICATED')
      assert.equal(resB.ledger.cleanCount, 0)
      assert.equal(resB.ledger.defectPositiveCount, 1)
      assert.equal(resB.ledger.severeCount, 0)
    }

    // Scenario C: Both REVISE/SEVERE, Sophia REVISE/SEVERE -> severeCount incremented
    {
      const ledgerC = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirC = path.join(tempExecDir, 'case-c')

      const severeOpinion = {
        preliminaryDecision: 'REVISE',
        preliminarySeverity: 'SEVERE',
        affectedFields: ['description'],
        issueSummaries: ['Severe factual hallucination'],
        claimSpan: 'span',
        sourceEvidence: [{ source: 'facts.overview', supportFound: false }],
        sourceBoundaryReason: 'Severe hallucination breach',
        confidence: 'HIGH',
        advisoryOnly: true,
      }

      const resC = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirC,
        eligiblePool,
        reviewOrder,
        ledger: ledgerC,
        geminiReviewer: createMockGeminiReviewer({ cannedOpinion: severeOpinion }),
        claudeReviewer: createMockClaudeReviewer({ cannedOpinion: severeOpinion }),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'REVISE',
          finalSeverity: 'SEVERE',
          affectedFields: ['description'],
          materialIssues: ['Severe factual hallucination'],
          humanRationale: 'Severe hallucination confirmed.',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resC.status, 'HUMAN_ADJUDICATED')
      assert.equal(resC.ledger.cleanCount, 0)
      assert.equal(resC.ledger.defectPositiveCount, 1)
      assert.equal(resC.ledger.severeCount, 1)
    }

    // Scenario D: Gemini APPROVE / Claude REVISE / Sophia APPROVE -> AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI
    {
      const ledgerD = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirD = path.join(tempExecDir, 'case-d')

      const reviseOpinion = {
        preliminaryDecision: 'REVISE',
        preliminarySeverity: 'MINOR',
        affectedFields: ['description'],
        issueSummaries: ['Disputed claim'],
        claimSpan: 'span',
        sourceEvidence: [{ source: 'facts.overview', supportFound: false }],
        sourceBoundaryReason: 'Boundary test',
        confidence: 'HIGH',
        advisoryOnly: true,
      }

      const resD = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirD,
        eligiblePool,
        reviewOrder,
        ledger: ledgerD,
        geminiReviewer: createMockGeminiReviewer(), // APPROVE
        claudeReviewer: createMockClaudeReviewer({ cannedOpinion: reviseOpinion }), // REVISE
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'APPROVE',
          finalSeverity: null,
          affectedFields: [],
          materialIssues: [],
          humanRationale: 'Claude false alarm, candidate factually clean.',
          agreementPattern: 'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resD.status, 'HUMAN_ADJUDICATED')
      assert.equal(resD.record.agreementPattern, 'AI_MODELS_DISAGREE_HUMAN_MATCHES_GEMINI')
    }

    // Scenario E: Gemini APPROVE / Claude REVISE / Sophia REVISE -> AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE
    {
      const ledgerE = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirE = path.join(tempExecDir, 'case-e')

      const reviseOpinion = {
        preliminaryDecision: 'REVISE',
        preliminarySeverity: 'MINOR',
        affectedFields: ['description'],
        issueSummaries: ['Valid catch by Claude'],
        claimSpan: 'span',
        sourceEvidence: [{ source: 'facts.overview', supportFound: false }],
        sourceBoundaryReason: 'Boundary test',
        confidence: 'HIGH',
        advisoryOnly: true,
      }

      const resE = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirE,
        eligiblePool,
        reviewOrder,
        ledger: ledgerE,
        geminiReviewer: createMockGeminiReviewer(), // APPROVE
        claudeReviewer: createMockClaudeReviewer({ cannedOpinion: reviseOpinion }), // REVISE
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'REVISE',
          finalSeverity: 'MINOR',
          affectedFields: ['description'],
          materialIssues: ['Valid catch by Claude'],
          humanRationale: 'Sophia confirms Claude defect catch.',
          agreementPattern: 'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resE.status, 'HUMAN_ADJUDICATED')
      assert.equal(resE.record.agreementPattern, 'AI_MODELS_DISAGREE_HUMAN_MATCHES_CLAUDE')
    }

    // Scenario F: Malformed Gemini output -> REVIEW_PAUSED_PENDING_ADVISORY & raw output preserved in attempt-001
    {
      const ledgerF = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirF = path.join(tempExecDir, 'case-f')

      const resF = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirF,
        eligiblePool,
        reviewOrder,
        ledger: ledgerF,
        geminiReviewer: createMockGeminiReviewer({ failMode: 'MALFORMED_JSON' }),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
      })

      assert.equal(resF.status, 'REVIEW_PAUSED_PENDING_ADVISORY')
      assert.equal(resF.failedReviewer, 'GEMINI')
      assert.equal(resF.failureCategory, 'MALFORMED_JSON')

      const geminiAttemptRaw = path.join(cDirF, cId, 'gemini/attempts/attempt-001/raw-response.txt')
      assert.equal(fs.existsSync(geminiAttemptRaw), true)
      assert.match(fs.readFileSync(geminiAttemptRaw, 'utf8'), /malformed/)
    }

    // Scenario G: Malformed Claude output -> REVIEW_PAUSED_PENDING_ADVISORY
    {
      const ledgerG = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirG = path.join(tempExecDir, 'case-g')

      const resG = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirG,
        eligiblePool,
        reviewOrder,
        ledger: ledgerG,
        geminiReviewer: createMockGeminiReviewer(),
        claudeReviewer: createMockClaudeReviewer({ failMode: 'MALFORMED_JSON' }),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
      })

      assert.equal(resG.status, 'REVIEW_PAUSED_PENDING_ADVISORY')
      assert.equal(resG.failedReviewer, 'CLAUDE')
      assert.equal(resG.failureCategory, 'MALFORMED_JSON')
    }

    // Scenario H: Schema-invalid Gemini output -> REVIEW_PAUSED_PENDING_ADVISORY
    {
      const ledgerH = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })
      const cDirH = path.join(tempExecDir, 'case-h')

      const resH = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirH,
        eligiblePool,
        reviewOrder,
        ledger: ledgerH,
        geminiReviewer: createMockGeminiReviewer({ failMode: 'SCHEMA_INVALID' }),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
      })

      assert.equal(resH.status, 'REVIEW_PAUSED_PENDING_ADVISORY')
      assert.equal(resH.failedReviewer, 'GEMINI')
      assert.equal(resH.failureCategory, 'SCHEMA_INVALID')
    }

    // Scenario I: Packet hash mismatch -> hard fail in human review bundle creation
    {
      const cDirI = path.join(tempExecDir, 'case-i')
      const prepI = prepareCandidateExecution({
        candidateId: cId,
        eligiblePool,
        reviewOrder,
        executionRoot: cDirI,
      })

      const mismatchedEnvelope = {
        candidateId: cId,
        blindPacketSha256: sha256('different-packet'),
        validatedOpinion: { preliminaryDecision: 'APPROVE' },
      }

      assert.throws(
        () =>
          createHumanReviewBundle({
            candidateId: cId,
            candidateDir: cDirI,
            projectedPacket: prepI.projectedPacket,
            blindPacketSha256: prepI.blindPacketSha256,
            geminiEnvelope: mismatchedEnvelope,
            geminiEnvelopeSha256: sha256('g'),
            claudeEnvelope: mismatchedEnvelope,
            claudeEnvelopeSha256: sha256('c'),
          }),
        /PACKET_HASH_MISMATCH/
      )
    }

    // Scenario J: Advisory envelope hash mismatch in human adjudication ingest
    {
      const cDirJ = path.join(tempExecDir, 'case-j')
      const prepJ = prepareCandidateExecution({
        candidateId: cId,
        eligiblePool,
        reviewOrder,
        executionRoot: cDirJ,
      })

      const dummyBundle = {
        blindPacketSha256: prepJ.blindPacketSha256,
        geminiAdvisoryEnvelopeSha256: sha256('actual-gemini'),
        claudeAdvisoryEnvelopeSha256: sha256('actual-claude'),
        geminiAdvisory: { preliminaryDecision: 'APPROVE' },
        claudeAdvisory: { preliminaryDecision: 'APPROVE' },
      }

      const ledgerJ = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })

      assert.throws(
        () =>
          recordHumanAdjudication({
            candidateId: cId,
            candidateDir: cDirJ,
            reviewSequenceIndex: 1,
            bundle: dummyBundle,
            adjudicationData: {
              adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
              candidateId: cId,
              finalDecision: 'APPROVE',
              affectedFields: [],
              materialIssues: [],
              humanRationale: 'Rationale',
              agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
              blindPacketHash: prepJ.blindPacketSha256,
              geminiAdvisoryRecordSha256: sha256('corrupted-gemini-hash'),
              claudeAdvisoryRecordSha256: dummyBundle.claudeAdvisoryEnvelopeSha256,
            },
            ledger: ledgerJ,
          }),
        /GEMINI_ENVELOPE_HASH_MISMATCH/
      )
    }

    // Scenario K: Inconsistent human agreementPattern -> rejected
    {
      const cDirK = path.join(tempExecDir, 'case-k')
      const prepK = prepareCandidateExecution({
        candidateId: cId,
        eligiblePool,
        reviewOrder,
        executionRoot: cDirK,
      })

      const bundleK = {
        blindPacketSha256: prepK.blindPacketSha256,
        geminiAdvisoryEnvelopeSha256: sha256('g'),
        claudeAdvisoryEnvelopeSha256: sha256('c'),
        geminiAdvisory: { preliminaryDecision: 'APPROVE' },
        claudeAdvisory: { preliminaryDecision: 'APPROVE' },
      }

      const ledgerK = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })

      assert.throws(
        () =>
          recordHumanAdjudication({
            candidateId: cId,
            candidateDir: cDirK,
            reviewSequenceIndex: 1,
            bundle: bundleK,
            adjudicationData: {
              adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
              candidateId: cId,
              finalDecision: 'APPROVE',
              affectedFields: [],
              materialIssues: [],
              humanRationale: 'Rationale',
              agreementPattern: 'BOTH_AI_DISAGREE_WITH_HUMAN', // Inconsistent with both APPROVE + human APPROVE!
              blindPacketHash: bundleK.blindPacketSha256,
              geminiAdvisoryRecordSha256: bundleK.geminiAdvisoryEnvelopeSha256,
              claudeAdvisoryRecordSha256: bundleK.claudeAdvisoryEnvelopeSha256,
            },
            ledger: ledgerK,
          }),
        /AGREEMENT_PATTERN_MISMATCH/
      )
    }

    // Scenario L: Attempt human adjudication with missing advisory -> blocked at advisory collection
    {
      const cDirL = path.join(tempExecDir, 'case-l')
      const ledgerL = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })

      const resL = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirL,
        eligiblePool,
        reviewOrder,
        ledger: ledgerL,
        geminiReviewer: createMockGeminiReviewer({ failMode: 'UNAVAILABLE' }),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
      })

      assert.equal(resL.status, 'REVIEW_PAUSED_PENDING_ADVISORY')
      assert.equal(resL.failureCategory, 'PROVIDER_UNAVAILABLE')
      assert.equal(ledgerL.candidateStates[cId].status, 'REVIEW_PAUSED_PENDING_ADVISORY')
    }

    // Scenario M: Attempt out-of-order candidate review -> rejected
    {
      const cDirM = path.join(tempExecDir, 'case-m')
      const ledgerM = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })

      const outOfOrderCandidate = reviewOrder.orderedCandidates[5].candidateId

      await assert.rejects(
        async () =>
          executeCandidateReviewWorkflow({
            candidateId: outOfOrderCandidate, // Skipped candidates 0..4
            executionRoot: cDirM,
            eligiblePool,
            reviewOrder,
            ledger: ledgerM,
            geminiReviewer: createMockGeminiReviewer(),
            claudeReviewer: createMockClaudeReviewer(),
            geminiModel: 'mock-gemini-v1',
            claudeModel: 'mock-claude-v1',
          }),
        /OUT_OF_ORDER_EXECUTION/
      )
    }

    // Scenario N: Duplicate human adjudication without correction protocol -> rejected
    {
      const cDirN = path.join(tempExecDir, 'case-n')
      const ledgerN = createReviewSessionLedger({
        p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
        reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      })

      const resN = await executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: cDirN,
        eligiblePool,
        reviewOrder,
        ledger: ledgerN,
        geminiReviewer: createMockGeminiReviewer(),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: 'mock-gemini-v1',
        claudeModel: 'mock-claude-v1',
        humanAdjudicatorCallback: async (bundle) => ({
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'APPROVE',
          finalSeverity: null,
          affectedFields: [],
          materialIssues: [],
          humanRationale: 'Clean factual copy',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }),
      })

      assert.equal(resN.status, 'HUMAN_ADJUDICATED')

      // Duplicate adjudication with conflicting decision without correction protocol throws
      const conflictingAdjudication = {
        adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
        candidateId: cId,
        finalDecision: 'REVISE',
        finalSeverity: 'MINOR',
        affectedFields: ['description'],
        materialIssues: ['Altered defect decision'],
        humanRationale: 'Attempting to change decision without correction protocol',
        agreementPattern: 'BOTH_AI_DISAGREE_WITH_HUMAN',
        blindPacketHash: resN.bundle.blindPacketSha256,
        geminiAdvisoryRecordSha256: resN.bundle.geminiAdvisoryEnvelopeSha256,
        claudeAdvisoryRecordSha256: resN.bundle.claudeAdvisoryEnvelopeSha256,
      }

      assert.throws(
        () =>
          recordHumanAdjudication({
            candidateId: cId,
            candidateDir: path.join(cDirN, cId),
            reviewSequenceIndex: 1,
            bundle: resN.bundle,
            adjudicationData: conflictingAdjudication,
            ledger: resN.ledger,
            geminiModel: 'mock-gemini-v1',
            claudeModel: 'mock-claude-v1',
          }),
        /DUPLICATE_ADJUDICATION/
      )

      // Direct ledger update on already adjudicated candidate also throws DUPLICATE_ADJUDICATION
      assert.throws(
        () =>
          updateLedgerWithHumanAdjudication({
            ledger: resN.ledger,
            candidateId: cId,
            reviewSequenceIndex: 1,
            humanAdjudication: conflictingAdjudication,
            humanAdjudicationSha256: sha256('human'),
            blindPacketSha256: resN.bundle.blindPacketSha256,
            geminiAdvisoryRecordSha256: resN.bundle.geminiAdvisoryEnvelopeSha256,
            claudeAdvisoryRecordSha256: resN.bundle.claudeAdvisoryEnvelopeSha256,
          }),
        /DUPLICATE_ADJUDICATION/
      )
    }
  } finally {
    if (fs.existsSync(tempExecDir)) fs.rmSync(tempExecDir, { recursive: true, force: true })
  }
})

// 17. Versioned Advisory Attempts: Malformed Attempt #1 remains immutable while Attempt #2 succeeds
test('17. Malformed attempt #1 remains immutable and Attempt #2 succeeds without overwriting', async () => {
  const tempDir = path.join(p2Dir, 'temp-versioned-attempts-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const candidateDir = path.join(tempDir, cId)

    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool,
      reviewOrder,
      executionRoot: tempDir,
    })

    // Attempt #1: Fails with malformed JSON
    const res1 = await resolveOrExecuteReviewerAttempt({
      reviewer: 'GEMINI',
      reviewerModel: 'mock-gemini-v1',
      candidateId: cId,
      candidateDir,
      packetBytes: prep.packetBytes,
      blindPacketSha256: prep.blindPacketSha256,
      transportHandler: createMockGeminiReviewer({ failMode: 'MALFORMED_JSON' }),
    })

    assert.equal(res1.success, false)
    assert.equal(res1.attemptNumber, 1)
    assert.equal(res1.failureCategory, 'MALFORMED_JSON')

    const att1RawPath = path.join(candidateDir, 'gemini/attempts/attempt-001/raw-response.txt')
    assert.equal(fs.existsSync(att1RawPath), true)
    const att1RawContent = fs.readFileSync(att1RawPath, 'utf8')

    // Attempt #2: Succeeds with valid output
    const res2 = await resolveOrExecuteReviewerAttempt({
      reviewer: 'GEMINI',
      reviewerModel: 'mock-gemini-v1',
      candidateId: cId,
      candidateDir,
      packetBytes: prep.packetBytes,
      blindPacketSha256: prep.blindPacketSha256,
      transportHandler: createMockGeminiReviewer(),
    })

    assert.equal(res2.success, true)
    assert.equal(res2.attemptNumber, 2)

    // Verify Attempt #1 was NOT overwritten
    const att1RawAfter = fs.readFileSync(att1RawPath, 'utf8')
    assert.equal(att1RawAfter, att1RawContent)

    // Verify Attempt #2 exists and is active
    const att2EnvPath = path.join(candidateDir, 'gemini/attempts/attempt-002/advisory-envelope.v1.json')
    assert.equal(fs.existsSync(att2EnvPath), true)
    const activeEnvPath = path.join(candidateDir, 'gemini/active-advisory-envelope.v1.json')
    assert.equal(fs.existsSync(activeEnvPath), true)
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 18. Versioned Advisory Attempts: Schema-Invalid Attempt #1 remains immutable while Attempt #2 succeeds
test('18. Schema-invalid attempt #1 remains immutable and Attempt #2 succeeds', async () => {
  const tempDir = path.join(p2Dir, 'temp-schema-invalid-attempts-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const candidateDir = path.join(tempDir, cId)

    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool,
      reviewOrder,
      executionRoot: tempDir,
    })

    // Attempt #1: Schema invalid
    const res1 = await resolveOrExecuteReviewerAttempt({
      reviewer: 'CLAUDE',
      reviewerModel: 'mock-claude-v1',
      candidateId: cId,
      candidateDir,
      packetBytes: prep.packetBytes,
      blindPacketSha256: prep.blindPacketSha256,
      transportHandler: createMockClaudeReviewer({ failMode: 'SCHEMA_INVALID' }),
    })

    assert.equal(res1.success, false)
    assert.equal(res1.attemptNumber, 1)
    assert.equal(res1.failureCategory, 'SCHEMA_INVALID')

    const att1ValResult = JSON.parse(fs.readFileSync(path.join(candidateDir, 'claude/attempts/attempt-001/validation-result.json'), 'utf8'))
    assert.equal(att1ValResult.valid, false)
    assert.equal(att1ValResult.category, 'SCHEMA_INVALID')

    // Attempt #2: Valid
    const res2 = await resolveOrExecuteReviewerAttempt({
      reviewer: 'CLAUDE',
      reviewerModel: 'mock-claude-v1',
      candidateId: cId,
      candidateDir,
      packetBytes: prep.packetBytes,
      blindPacketSha256: prep.blindPacketSha256,
      transportHandler: createMockClaudeReviewer(),
    })

    assert.equal(res2.success, true)
    assert.equal(res2.attemptNumber, 2)
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 19. Both-Valid Resume Performs Zero Model Calls
test('19. Both-valid resume performs zero model calls and continues directly to human bundle', async () => {
  const tempDir = path.join(p2Dir, 'temp-zero-model-calls-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const ledger = createReviewSessionLedger({
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
    })

    let geminiCalls = 0
    let claudeCalls = 0

    const geminiReviewer = async () => {
      geminiCalls++
      return { rawResponseText: JSON.stringify({
        preliminaryDecision: 'APPROVE',
        preliminarySeverity: null,
        affectedFields: [],
        issueSummaries: [],
        claimSpan: 'none',
        sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
        sourceBoundaryReason: 'Safe',
        confidence: 'HIGH',
        advisoryOnly: true,
      }) }
    }
    const claudeReviewer = async () => {
      claudeCalls++
      return { rawResponseText: JSON.stringify({
        preliminaryDecision: 'APPROVE',
        preliminarySeverity: null,
        affectedFields: [],
        issueSummaries: [],
        claimSpan: 'none',
        sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
        sourceBoundaryReason: 'Safe',
        confidence: 'HIGH',
        advisoryOnly: true,
      }) }
    }

    // First call: both models called
    const res1 = await executeCandidateReviewWorkflow({
      candidateId: cId,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
      ledger,
      geminiReviewer,
      claudeReviewer,
      geminiModel: 'mock-gemini-v1',
      claudeModel: 'mock-claude-v1',
    })
    assert.equal(res1.status, 'READY_FOR_HUMAN_ADJUDICATION')
    assert.equal(geminiCalls, 1)
    assert.equal(claudeCalls, 1)

    // Second call: zero model calls
    const res2 = await executeCandidateReviewWorkflow({
      candidateId: cId,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
      ledger,
      geminiReviewer,
      claudeReviewer,
      geminiModel: 'mock-gemini-v1',
      claudeModel: 'mock-claude-v1',
    })
    assert.equal(res2.status, 'READY_FOR_HUMAN_ADJUDICATION')
    assert.equal(geminiCalls, 1, 'Zero Gemini model calls on replay')
    assert.equal(claudeCalls, 1, 'Zero Claude model calls on replay')
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 20. Prompt Text and Materiality Policy Hash Mismatch & Missing File Hard Fails
test('20. Prompt text/hash mismatch and missing materiality policy hard fail before transport call', async () => {
  let transportCalled = false
  const fakeTransport = async () => {
    transportCalled = true
    return { rawResponseText: '{}' }
  }

  // 1. Missing materiality policy file hard fails
  assert.throws(
    () =>
      verifyPromptAndPolicyHashes({
        reviewer: 'GEMINI',
        promptText: loadGovernedReviewerPrompt('GEMINI').promptText,
        registeredPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
        materialityPolicyPath: 'missing/nonexistent-policy.json',
      }),
    /FILE_NOT_FOUND/
  )

  // 2. Mismatched prompt hash against frozen authority
  assert.throws(
    () =>
      verifyPromptAndPolicyHashes({
        reviewer: 'GEMINI',
        promptText: 'real-prompt-bytes',
        registeredPromptSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      }),
    /PROMPT_AUTHORITY_VIOLATION/
  )

  // 3. Mismatched policy hash against frozen authority
  assert.throws(
    () =>
      verifyPromptAndPolicyHashes({
        reviewer: 'GEMINI',
        promptText: loadGovernedReviewerPrompt('GEMINI').promptText,
        registeredPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
        registeredMaterialityPolicySha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      }),
    /POLICY_AUTHORITY_VIOLATION/
  )

  // 4. Arbitrary prompt text even with self-consistent hash fails closed
  const arbitraryPrompt = 'Arbitrary prompt text that is not frozen'
  assert.throws(
    () =>
      verifyPromptAndPolicyHashes({
        reviewer: 'GEMINI',
        promptText: arbitraryPrompt,
        registeredPromptSha256: sha256(arbitraryPrompt),
      }),
    /PROMPT_AUTHORITY_VIOLATION/
  )

  assert.equal(transportCalled, false, 'Transport was never called')
})

// 21. Blind-Packet Display Body Tampering Detection (Requirement 7)
test('21. Tampered bundle.blindPacket body with unchanged hash string is rejected', () => {
  const tempDir = path.join(p2Dir, 'temp-packet-tampering-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const cDir = path.join(tempDir, cId)

    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool,
      reviewOrder,
      executionRoot: tempDir,
    })

    const gOpinion = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Safe',
      confidence: 'HIGH',
      advisoryOnly: true,
    }

    const gBuilt = validateAndBuildAdvisoryEnvelope({
      rawResponseText: JSON.stringify(gOpinion),
      reviewer: 'GEMINI',
      reviewerModel: 'mock-gemini-v1',
      candidateId: cId,
      blindPacketSha256: prep.blindPacketSha256,
      reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
      materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    })
    const cBuilt = validateAndBuildAdvisoryEnvelope({
      rawResponseText: JSON.stringify(gOpinion),
      reviewer: 'CLAUDE',
      reviewerModel: 'mock-claude-v1',
      candidateId: cId,
      blindPacketSha256: prep.blindPacketSha256,
      reviewPromptSha256: FROZEN_BINDINGS.CLAUDE_PROMPT_SHA256,
      materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
    })

    const geminiDir = path.join(cDir, 'gemini')
    const claudeDir = path.join(cDir, 'claude')
    fs.mkdirSync(geminiDir, { recursive: true })
    fs.mkdirSync(claudeDir, { recursive: true })

    fs.writeFileSync(path.join(geminiDir, 'raw-response.v1.txt'), JSON.stringify(gOpinion), 'utf8')
    fs.writeFileSync(path.join(claudeDir, 'raw-response.v1.txt'), JSON.stringify(gOpinion), 'utf8')
    atomicWriteJson(path.join(geminiDir, 'advisory-envelope.v1.json'), gBuilt.envelope)
    atomicWriteJson(path.join(claudeDir, 'advisory-envelope.v1.json'), cBuilt.envelope)

    const bundleRes = createHumanReviewBundle({
      candidateId: cId,
      candidateDir: cDir,
      projectedPacket: prep.projectedPacket,
      blindPacketSha256: prep.blindPacketSha256,
      geminiEnvelope: gBuilt.envelope,
      geminiEnvelopeSha256: gBuilt.envelopeSha256,
      claudeEnvelope: cBuilt.envelope,
      claudeEnvelopeSha256: cBuilt.envelopeSha256,
    })

    // Valid bundle passes
    assert.equal(
      verifyCandidateReviewEvidenceChain({
        candidateId: cId,
        candidateDir: cDir,
        bindings: { geminiModel: 'mock-gemini-v1', claudeModel: 'mock-claude-v1' },
      }).valid,
      true
    )

    // Tamper bundle's embedded blind packet body while keeping hash string identical
    const tamperedPacketBundle = {
      ...bundleRes.bundle,
      blindPacket: {
        ...bundleRes.bundle.blindPacket,
        editorial: {
          ...bundleRes.bundle.blindPacket.editorial,
          description: 'Tampered description inserted into display packet',
        },
      },
    }
    fs.writeFileSync(bundleRes.bundlePath, serializeArtifactForPersistence(tamperedPacketBundle), 'utf8')

    assert.throws(
      () =>
        verifyCandidateReviewEvidenceChain({
          candidateId: cId,
          candidateDir: cDir,
          bindings: { geminiModel: 'mock-gemini-v1', claudeModel: 'mock-claude-v1' },
        }),
      /INTEGRITY_FAILURE: Bundle embedded blindPacket differs from authoritative disk blind packet content/
    )
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 22. Reused Envelope from Wrong Prompt, Policy, or Model is Rejected
test('22. Reused envelope from wrong prompt, wrong policy, or wrong model is rejected', () => {
  const tempDir = path.join(p2Dir, 'temp-wrong-envelope-bindings-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const cDir = path.join(tempDir, cId)

    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool,
      reviewOrder,
      executionRoot: tempDir,
    })

    const opinion = {
      preliminaryDecision: 'APPROVE',
      preliminarySeverity: null,
      affectedFields: [],
      issueSummaries: [],
      claimSpan: 'none',
      sourceEvidence: [{ source: 'facts.overview', supportFound: true }],
      sourceBoundaryReason: 'Safe',
      confidence: 'HIGH',
      advisoryOnly: true,
    }

    const geminiDir = path.join(cDir, 'gemini')
    fs.mkdirSync(geminiDir, { recursive: true })
    fs.writeFileSync(path.join(geminiDir, 'raw-response.v1.txt'), JSON.stringify(opinion), 'utf8')

    // Wrong prompt SHA
    const wrongPromptEnvelope = {
      candidateId: cId,
      blindPacketSha256: prep.blindPacketSha256,
      reviewer: 'GEMINI',
      reviewerModel: 'mock-gemini-v1',
      reviewPromptSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      materialityPolicySha256: FROZEN_BINDINGS.MATERIALITY_POLICY_SHA256,
      rawResponseSha256: sha256(JSON.stringify(opinion)),
      validatedOpinion: opinion,
    }
    atomicWriteJson(path.join(geminiDir, 'active-advisory-envelope.v1.json'), wrongPromptEnvelope)

    assert.throws(
      () =>
        verifyCandidateReviewEvidenceChain({
          candidateId: cId,
          candidateDir: cDir,
          bindings: { geminiModel: 'mock-gemini-v1', claudeModel: 'mock-claude-v1' },
        }),
      /INTEGRITY_FAILURE: Gemini envelope reviewPromptSha256 does not match frozen prompt SHA/
    )

    // Wrong model
    const wrongModelEnvelope = {
      ...wrongPromptEnvelope,
      reviewPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
      reviewerModel: 'other-model-v2',
    }
    fs.rmSync(path.join(geminiDir, 'active-advisory-envelope.v1.json'))
    atomicWriteJson(path.join(geminiDir, 'active-advisory-envelope.v1.json'), wrongModelEnvelope)

    assert.throws(
      () =>
        verifyCandidateReviewEvidenceChain({
          candidateId: cId,
          candidateDir: cDir,
          bindings: { geminiModel: 'mock-gemini-v1', claudeModel: 'mock-claude-v1' },
        }),
      /INTEGRITY_FAILURE: Gemini envelope reviewerModel 'other-model-v2' does not match registered 'mock-gemini-v1'/
    )
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 23. Transactional Human-Record / Ledger Crash Recovery
test('23. Human record written but ledger not updated reconciles idempotently and advances sequence', async () => {
  const tempDir = path.join(p2Dir, 'temp-crash-reconcile-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  const ledgerPath = path.join(tempDir, 'review-session-ledger.json')

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const cDir = path.join(tempDir, cId)

    const ledger = createReviewSessionLedger({
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
    })
    persistReviewSessionLedger(ledgerPath, ledger)

    let humanCallbackCalls = 0

    // Run review workflow to completion
    await executeCandidateReviewWorkflow({
      candidateId: cId,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
      ledger,
      ledgerPath,
      geminiReviewer: createMockGeminiReviewer(),
      claudeReviewer: createMockClaudeReviewer(),
      geminiModel: 'mock-gemini-v1',
      claudeModel: 'mock-claude-v1',
      humanAdjudicatorCallback: async (bundle) => {
        humanCallbackCalls++
        return {
          adjudicator: AUTHORITATIVE_HUMAN_ADJUDICATOR,
          candidateId: cId,
          finalDecision: 'APPROVE',
          finalSeverity: null,
          affectedFields: [],
          materialIssues: [],
          humanRationale: 'Clean copy confirmed.',
          agreementPattern: 'BOTH_AI_AGREE_WITH_HUMAN',
          blindPacketHash: bundle.blindPacketSha256,
          geminiAdvisoryRecordSha256: bundle.geminiAdvisoryEnvelopeSha256,
          claudeAdvisoryRecordSha256: bundle.claudeAdvisoryEnvelopeSha256,
        }
      },
    })

    assert.equal(humanCallbackCalls, 1)

    // Simulate crash where ledger on disk was reverted to initial state, but human record remains on disk
    const blankLedger = createReviewSessionLedger({
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
    })
    persistReviewSessionLedger(ledgerPath, blankLedger)

    // Reconcile from disk
    const reconciled = reconcileReviewSessionFromDisk({
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
      ledgerPath,
      bindings: { geminiModel: 'mock-gemini-v1', claudeModel: 'mock-claude-v1' },
    })

    assert.equal(reconciled.completedCount, 1)
    assert.equal(reconciled.cleanCount, 1)
    assert.equal(reconciled.currentReviewSequenceIndex, 2)
    assert.equal(reconciled.currentReviewArrayIndex, 1)
    assert.equal(reconciled.candidateStates[cId].status, 'HUMAN_ADJUDICATED')

    // Calling execute again on already adjudicated candidate does NOT call human callback again
    const reExecute = await executeCandidateReviewWorkflow({
      candidateId: cId,
      executionRoot: tempDir,
      eligiblePool,
      reviewOrder,
      ledger: reconciled,
      ledgerPath,
      geminiReviewer: createMockGeminiReviewer(),
      claudeReviewer: createMockClaudeReviewer(),
      geminiModel: 'mock-gemini-v1',
      claudeModel: 'mock-claude-v1',
      humanAdjudicatorCallback: async () => {
        humanCallbackCalls++
        throw new Error('Sophia should not be asked again!')
      },
    })

    assert.equal(reExecute.status, 'HUMAN_ADJUDICATED')
    assert.equal(reExecute.resumed, true)
    assert.equal(humanCallbackCalls, 1, 'Sophia was NOT called again on resume')
    assert.equal(reExecute.ledger.completedCount, 1, 'Count did not double-increment')
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

// 24. Missing Model Identity Hard Fails at Master Workflow
test('24. Missing or empty model identity hard fails before transport call', async () => {
  const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
  const reviewOrder = readJson('blind-review-order.v1.json')
  const cId = reviewOrder.orderedCandidates[0].candidateId
  const ledger = createReviewSessionLedger({
    p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
    reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
  })

  await assert.rejects(
    async () =>
      executeCandidateReviewWorkflow({
        candidateId: cId,
        executionRoot: path.join(p2Dir, 'temp-missing-model'),
        eligiblePool,
        reviewOrder,
        ledger,
        geminiReviewer: createMockGeminiReviewer(),
        claudeReviewer: createMockClaudeReviewer(),
        geminiModel: '', // Empty model
        claudeModel: 'mock-claude-v1',
      }),
    /INVALID_REVIEWER_MODEL/
  )
})

// 25. Live Review-Execution Root Directory Is Not Created in P2.2
test('25. Live review-execution root directory is not created in P2.2', () => {
  const liveRoot = path.join(p2Dir, 'review-execution')
  assert.equal(fs.existsSync(liveRoot), false, 'Live review-execution directory must NOT exist in P2.2')
})

// 26. P2.2 Freeze Manifest Integrity
test('26. P2.2 freeze manifest binds all governed files, hashes match disk bytes, and does not bind itself', () => {
  const manifestPath = path.join(p2Dir, 'p2-2-freeze-manifest.v1.json')
  assert.equal(fs.existsSync(manifestPath), true, 'p2-2-freeze-manifest.v1.json must exist')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  assert.equal(manifest.activity, 'VERIFIER_V14_P2_2_REVIEW_EXECUTION_HARNESS_FREEZE')
  assert.equal(manifest.governanceState, 'PAUSED_FOR_SEVERE_AUDIT_MISS')
  assert.ok(manifest.totalBoundFiles >= 20)

  for (const [relPath, boundHash] of Object.entries(manifest.frozenBindings)) {
    assert.notEqual(relPath, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-2-freeze-manifest.v1.json', 'Manifest must not bind itself')
    const fullPath = path.join(repoRoot, relPath)
    assert.equal(fs.existsSync(fullPath), true, `Bound file must exist: ${relPath}`)
    const currentHash = sha256(fs.readFileSync(fullPath))
    assert.equal(boundHash, currentHash, `Hash mismatch for bound file: ${relPath}`)
  }
})

// 27. Adversarial Proof: Prompt and Policy Substitution Attempts Cannot Execute
test('27. Adversarial proof: arbitrary prompt text or modified materiality policy with self-consistent hashes cannot execute and transport calls remain zero', async () => {
  const tempDir = path.join(p2Dir, 'temp-adversarial-proof-test')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  try {
    const eligiblePool = readJson('blind-review-eligible-pool.v1.json')
    const reviewOrder = readJson('blind-review-order.v1.json')
    const cId = reviewOrder.orderedCandidates[0].candidateId
    const cDir = path.join(tempDir, cId)

    const prep = prepareCandidateExecution({
      candidateId: cId,
      eligiblePool,
      reviewOrder,
      executionRoot: tempDir,
    })

    let geminiCalls = 0
    let claudeCalls = 0
    const mockGemini = async () => {
      geminiCalls++
      return { rawResponseText: '{}' }
    }
    const mockClaude = async () => {
      claudeCalls++
      return { rawResponseText: '{}' }
    }

    // A. Arbitrary Gemini prompt text + SHA256(that arbitrary prompt)
    const arbitraryGeminiPrompt = 'Arbitrary unapproved Gemini prompt text for testing'
    const arbitraryGeminiSha = sha256(arbitraryGeminiPrompt)

    // A.1: Lower-level helper verifyPromptAndPolicyHashes rejects self-consistent arbitrary Gemini prompt
    assert.throws(
      () =>
        verifyPromptAndPolicyHashes({
          reviewer: 'GEMINI',
          promptText: arbitraryGeminiPrompt,
          registeredPromptSha256: arbitraryGeminiSha,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )

    // A.2: createIsolatedReviewerRequest rejects arbitrary prompt bytes
    assert.throws(
      () =>
        createIsolatedReviewerRequest({
          reviewer: 'GEMINI',
          reviewerModel: 'mock-gemini-v1',
          promptText: arbitraryGeminiPrompt,
          blindPacketBytes: prep.packetBytes,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )

    // A.3: reviewBlindPacket rejects arbitrary prompt and transport is never invoked
    await assert.rejects(
      async () =>
        reviewBlindPacket({
          reviewer: 'GEMINI',
          reviewerModel: 'mock-gemini-v1',
          promptText: arbitraryGeminiPrompt,
          blindPacketBytes: prep.packetBytes,
          transportHandler: mockGemini,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )
    assert.equal(geminiCalls, 0, 'Gemini transport call count must remain ZERO after attempted prompt substitution')

    // A.4: Execution API rejects caller prompt overrides and transport is never called
    await assert.rejects(
      async () =>
        resolveOrExecuteReviewerAttempt({
          reviewer: 'GEMINI',
          reviewerModel: 'mock-gemini-v1',
          candidateId: cId,
          candidateDir: cDir,
          packetBytes: prep.packetBytes,
          blindPacketSha256: prep.blindPacketSha256,
          transportHandler: mockGemini,
          reviewerPromptText: arbitraryGeminiPrompt,
          reviewerPromptSha256: arbitraryGeminiSha,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )
    assert.equal(geminiCalls, 0, 'Gemini transport call count must remain ZERO after resolveOrExecuteReviewerAttempt prompt override')

    // B. Arbitrary Claude prompt text + SHA256(that arbitrary prompt)
    const arbitraryClaudePrompt = 'Arbitrary unapproved Claude prompt text for testing'
    const arbitraryClaudeSha = sha256(arbitraryClaudePrompt)

    // B.1: Lower-level helper verifyPromptAndPolicyHashes rejects self-consistent arbitrary Claude prompt
    assert.throws(
      () =>
        verifyPromptAndPolicyHashes({
          reviewer: 'CLAUDE',
          promptText: arbitraryClaudePrompt,
          registeredPromptSha256: arbitraryClaudeSha,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )

    // B.2: createIsolatedReviewerRequest rejects arbitrary prompt bytes
    assert.throws(
      () =>
        createIsolatedReviewerRequest({
          reviewer: 'CLAUDE',
          reviewerModel: 'mock-claude-v1',
          promptText: arbitraryClaudePrompt,
          blindPacketBytes: prep.packetBytes,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )

    // B.3: reviewBlindPacket rejects arbitrary prompt and transport is never invoked
    await assert.rejects(
      async () =>
        reviewBlindPacket({
          reviewer: 'CLAUDE',
          reviewerModel: 'mock-claude-v1',
          promptText: arbitraryClaudePrompt,
          blindPacketBytes: prep.packetBytes,
          transportHandler: mockClaude,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )
    assert.equal(claudeCalls, 0, 'Claude transport call count must remain ZERO after attempted prompt substitution')

    // B.4: Execution API rejects caller prompt overrides and transport is never called
    await assert.rejects(
      async () =>
        resolveOrExecuteReviewerAttempt({
          reviewer: 'CLAUDE',
          reviewerModel: 'mock-claude-v1',
          candidateId: cId,
          candidateDir: cDir,
          packetBytes: prep.packetBytes,
          blindPacketSha256: prep.blindPacketSha256,
          transportHandler: mockClaude,
          reviewerPromptText: arbitraryClaudePrompt,
          reviewerPromptSha256: arbitraryClaudeSha,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )
    assert.equal(claudeCalls, 0, 'Claude transport call count must remain ZERO after resolveOrExecuteReviewerAttempt prompt override')

    // C. Modified materiality-policy bytes + SHA256(modified bytes)
    const modifiedPolicyBytes = Buffer.from('{"modifiedPolicy": true, "fake": 123}', 'utf8')
    const modifiedPolicySha = sha256(modifiedPolicyBytes)
    const modifiedPolicyPath = path.join(tempDir, 'modified-materiality-policy.json')
    fs.writeFileSync(modifiedPolicyPath, modifiedPolicyBytes)

    // C.1: Lower-level helper verifyPromptAndPolicyHashes rejects self-consistent modified policy
    assert.throws(
      () =>
        verifyPromptAndPolicyHashes({
          reviewer: 'GEMINI',
          promptText: loadGovernedReviewerPrompt('GEMINI').promptText,
          registeredPromptSha256: FROZEN_BINDINGS.GEMINI_PROMPT_SHA256,
          materialityPolicyPath: modifiedPolicyPath,
          registeredMaterialityPolicySha256: modifiedPolicySha,
        }),
      /POLICY_AUTHORITY_VIOLATION/
    )

    // C.2: loadGovernedMaterialityPolicy rejects modified policy file
    assert.throws(
      () => loadGovernedMaterialityPolicy(modifiedPolicyPath),
      /MATERIALITY_POLICY_HASH_MISMATCH/
    )

    // C.3: Execution API rejects caller policy overrides and transport is never called
    await assert.rejects(
      async () =>
        resolveOrExecuteReviewerAttempt({
          reviewer: 'GEMINI',
          reviewerModel: 'mock-gemini-v1',
          candidateId: cId,
          candidateDir: cDir,
          packetBytes: prep.packetBytes,
          blindPacketSha256: prep.blindPacketSha256,
          transportHandler: mockGemini,
          materialityPolicySha256: modifiedPolicySha,
        }),
      /POLICY_AUTHORITY_VIOLATION/
    )
    assert.equal(geminiCalls, 0, 'Gemini transport call count must remain ZERO after resolveOrExecuteReviewerAttempt policy override')

    // C.4: Master workflow rejects caller prompt and policy overrides and transport is never called
    const ledger = createReviewSessionLedger({
      p21FreezeManifestSha256: FROZEN_MANIFEST_SHA,
      reviewOrderSha256: FROZEN_REVIEW_ORDER_SHA,
    })
    await assert.rejects(
      async () =>
        executeCandidateReviewWorkflow({
          candidateId: cId,
          executionRoot: tempDir,
          eligiblePool,
          reviewOrder,
          ledger,
          geminiReviewer: mockGemini,
          claudeReviewer: mockClaude,
          geminiModel: 'mock-gemini-v1',
          claudeModel: 'mock-claude-v1',
          geminiPromptText: arbitraryGeminiPrompt,
          geminiPromptSha256: arbitraryGeminiSha,
        }),
      /PROMPT_AUTHORITY_VIOLATION/
    )
    assert.equal(geminiCalls, 0, 'Gemini transport call count must remain ZERO after executeCandidateReviewWorkflow prompt override')
    assert.equal(claudeCalls, 0, 'Claude transport call count must remain ZERO after executeCandidateReviewWorkflow prompt override')

    await assert.rejects(
      async () =>
        executeCandidateReviewWorkflow({
          candidateId: cId,
          executionRoot: tempDir,
          eligiblePool,
          reviewOrder,
          ledger,
          geminiReviewer: mockGemini,
          claudeReviewer: mockClaude,
          geminiModel: 'mock-gemini-v1',
          claudeModel: 'mock-claude-v1',
          materialityPolicySha256: modifiedPolicySha,
        }),
      /POLICY_AUTHORITY_VIOLATION/
    )
    assert.equal(geminiCalls, 0, 'Gemini transport call count must remain ZERO after executeCandidateReviewWorkflow policy override')
    assert.equal(claudeCalls, 0, 'Claude transport call count must remain ZERO after executeCandidateReviewWorkflow policy override')

    // C.5: Evidence chain verifier rejects caller policy override
    assert.throws(
      () =>
        verifyCandidateReviewEvidenceChain({
          candidateId: cId,
          candidateDir: cDir,
          bindings: {
            geminiModel: 'mock-gemini-v1',
            claudeModel: 'mock-claude-v1',
            materialityPolicySha256: modifiedPolicySha,
          },
        }),
      /AUTHORITY_VIOLATION/
    )
  } finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  }
})


