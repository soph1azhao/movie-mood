import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import {
  serializeArtifactForPersistence,
  hashArtifact,
} from '../../scripts/validatePromotionContract.mjs'
import {
  buildVerifierV13ReplayPacket,
  buildCandidateV13GeminiRequest,
  CANDIDATE_PROMPT_PATH,
  CANDIDATE_SCHEMA_PATH,
  CANDIDATE_VALIDATOR_PATH,
  scanForForbiddenKeys,
} from '../../scripts/runVerifierV13RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const expDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-low-thinking-technical-ablation')
const protocolPath = path.join(expDir, 'protocol.v1.json')
const cohortPath = path.join(expDir, 'ablation-cohort.v1.json')

function sha(filePath) {
  const buf = fs.readFileSync(filePath)
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

test('1. Cohort manifest contains exactly four target candidates in expected order', () => {
  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'))
  assert.equal(cohort.cohortSize, 4)
  assert.equal(cohort.records.length, 4)
  const expectedIds = [
    'scale500-tmdb-13398',
    'scale500-tmdb-1563',
    'scale500-tmdb-127533',
    'scale500-tmdb-9725',
  ]
  assert.deepEqual(cohort.records.map((r) => r.candidateId), expectedIds)
})

test('2. Zero human-label leakage in cohort manifest and input packets', () => {
  const cohortRaw = fs.readFileSync(cohortPath, 'utf8')
  const cohort = JSON.parse(cohortRaw)

  // Verify cohort document contains zero human decision / review labels
  const humanReviewKeys = [
    'humanDecision',
    'decision',
    'humanSeverity',
    'severity',
    'humanReason',
    'affectedFields',
    'retrospectiveDefectTaxonomy',
    'verifierGapAnnotations',
    'expectedAnswer',
  ]
  for (const labelKey of humanReviewKeys) {
    assert.equal(cohortRaw.includes(`"${labelKey}"`), false, `Cohort manifest must not leak ${labelKey}`)
  }

  // Verify candidate input packets contain zero model-forbidden leakage keys
  for (const record of cohort.records) {
    const fullPath = path.resolve(repoRoot, record.sourceRiskInputPath)
    const riskInput = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    const packet = buildVerifierV13ReplayPacket(riskInput)
    const leakage = scanForForbiddenKeys(packet)
    assert.equal(leakage.length, 0, `No leakage allowed for ${record.candidateId}`)
  }
})

test('3. Complete parent-evidence bindings and byte hashes match protocol.v1.json', () => {
  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const bindings = protocol.boundParentEvidence

  // 1. Candidate Prompt
  const promptHash = sha(path.resolve(repoRoot, bindings.candidatePrompt.path))
  assert.equal(promptHash, 'sha256:93c9a185620012609998ad8e58e4c68c9c945fd100820f2cc93c64385cdd402b')
  assert.equal(promptHash, bindings.candidatePrompt.byteHash)

  // 2. Candidate Schema
  const schemaHash = sha(path.resolve(repoRoot, bindings.candidateSchema.path))
  assert.equal(schemaHash, 'sha256:aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc')
  assert.equal(schemaHash, bindings.candidateSchema.byteHash)

  // 3. Candidate Validator
  const validatorHash = sha(path.resolve(repoRoot, bindings.candidateValidator.path))
  assert.equal(validatorHash, 'sha256:258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6')
  assert.equal(validatorHash, bindings.candidateValidator.byteHash)

  // 4. v1.3 Protocol
  const v13ProtocolHash = sha(path.resolve(repoRoot, bindings.v13Protocol.path))
  assert.equal(v13ProtocolHash, 'sha256:d481ed8ba04473fda7b5a39c34a5592d2faa98af06501f782d965268aed5cdf5')
  assert.equal(v13ProtocolHash, bindings.v13Protocol.byteHash)

  // 5. v1.3 Execution Ledger
  const ledgerHash = sha(path.resolve(repoRoot, bindings.v13ExecutionLedger.path))
  assert.equal(ledgerHash, 'sha256:9a1e0098935807935d9124a148b92f5363bade6516d80f742f3e160fead76888')
  assert.equal(ledgerHash, bindings.v13ExecutionLedger.byteHash)

  // 6. v1.3 Evidence Freeze
  const freezeHash = sha(path.resolve(repoRoot, bindings.v13ExecutionEvidenceFreeze.path))
  assert.equal(freezeHash, 'sha256:8b738b05c4f35b7ff2e3d11592ef683e0b79e6f3ebf1004d9f0bf791be6d03a5')
  assert.equal(freezeHash, bindings.v13ExecutionEvidenceFreeze.byteHash)

  // 7. v1.3 Retrospective Reconciliation
  const reconHash = sha(path.resolve(repoRoot, bindings.v13RetrospectiveReconciliation.path))
  assert.equal(reconHash, 'sha256:553682aba547787787c65e6bfa2f7fb96e531d0d0d690f0737f08659dce1c18a')
  assert.equal(reconHash, bindings.v13RetrospectiveReconciliation.byteHash)
  assert.equal(reconHash, bindings.v13RetrospectiveReconciliation.canonicalHash)

  // Reconciliation commit metadata check
  assert.equal(bindings.v13RetrospectiveReconciliation.commit, '196b08089e0faa02b4841a6ef4f2ebc4ed13da31')
  assert.equal(bindings.v13RetrospectiveReconciliation.shortCommit, '196b080')
})

test('4. Source input byte-hash test for all cohort records', () => {
  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'))
  for (const record of cohort.records) {
    const fullPath = path.resolve(repoRoot, record.sourceRiskInputPath)
    const computedHash = sha(fullPath)
    assert.equal(computedHash, record.sourceRiskInputByteHash, `Source input hash mismatch for ${record.candidateId}`)
  }
})

test('5. Only registered request delta is thinkingLevel medium -> low', () => {
  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'))
  const promptText = fs.readFileSync(path.resolve(repoRoot, CANDIDATE_PROMPT_PATH), 'utf8')
  const schema = JSON.parse(fs.readFileSync(path.resolve(repoRoot, CANDIDATE_SCHEMA_PATH), 'utf8'))

  for (const record of cohort.records) {
    const riskInput = JSON.parse(fs.readFileSync(path.resolve(repoRoot, record.sourceRiskInputPath), 'utf8'))
    const packet = buildVerifierV13ReplayPacket(riskInput)

    const mediumReq = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
      modelConfig: {
        provider: 'google-gemini-developer-api',
        modelId: 'gemini-3.8-flash',
        thinkingLevel: 'medium',
        maxOutputTokens: 6144,
        temperature: 0.0,
        timeoutMs: 30000,
      },
    })

    const lowReq = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
      modelConfig: {
        provider: 'google-gemini-developer-api',
        modelId: 'gemini-3.8-flash',
        thinkingLevel: 'low',
        maxOutputTokens: 6144,
        temperature: 0.0,
        timeoutMs: 30000,
      },
    })

    assert.equal(mediumReq.requestMetadata.requestHash, record.baselineMediumRequestHash)
    assert.equal(lowReq.requestMetadata.requestHash, record.ablationLowRequestHash)

    // Verify bodies are identical except for thinkingConfig.thinkingLevel
    assert.equal(mediumReq.body.generationConfig.thinkingConfig.thinkingLevel, 'medium')
    assert.equal(lowReq.body.generationConfig.thinkingConfig.thinkingLevel, 'low')

    const mediumClone = JSON.parse(JSON.stringify(mediumReq.body))
    mediumClone.generationConfig.thinkingConfig.thinkingLevel = 'low'
    assert.deepEqual(mediumClone, lowReq.body)
  }
})

test('6. Failure-enriched cohort interpretation constraint & primary endpoint separation', () => {
  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))

  // Cohort selection & interpretation constraint
  assert.equal(protocol.boundCohort.cohortSelection, 'FAILURE_ENRICHED_POST_OUTCOME_TECHNICAL_COHORT')
  assert.ok(protocol.boundCohort.interpretationConstraint.includes('conditional on prior failure'))
  assert.ok(protocol.boundCohort.interpretationConstraint.includes('not an estimate of general verifier serialization reliability'))

  // Primary endpoint separation statement
  assert.ok(protocol.endpoints.endpointSeparation.includes('Schema validity and semantic validity do not determine the primary technicalSerializationSuccess endpoint'))
})

test('7. Model configuration preserves maxOutputTokens=6144 and temperature=0.0', () => {
  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(protocol.modelConfiguration.maxOutputTokens, 6144)
  assert.equal(protocol.modelConfiguration.temperature, 0.0)
  assert.equal(protocol.modelConfiguration.modelId, 'gemini-3.8-flash')
  assert.equal(protocol.modelConfiguration.thinkingLevel, 'low')
})

test('8. Call limits enforce plannedCalls=4, maxRetries=0, maxTotalCalls=4', () => {
  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  assert.equal(protocol.callLimitsAndExecutionPlan.plannedPrimaryCalls, 4)
  assert.equal(protocol.callLimitsAndExecutionPlan.maxRetries, 0)
  assert.equal(protocol.callLimitsAndExecutionPlan.maxTotalCalls, 4)
})

test('9. Cost governance arithmetic and ceiling', () => {
  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'))
  const gov = protocol.costGovernance

  assert.equal(gov.cohortPromptTokensSum, 13139)
  assert.equal(gov.totalInputCostUsd, 0.00985425)
  assert.equal(gov.maxTotalOutputCostUsd, 0.09216000)
  assert.equal(gov.theoreticalMaxTotalCostUsd, 0.10201425)
  assert.equal(gov.governedCostCeilingUsd, 0.150000)

  // Ceiling must strictly exceed theoretical maximum
  assert.ok(gov.governedCostCeilingUsd > gov.theoreticalMaxTotalCostUsd)
})

test('10. Prospective holdout material is untouched and unreferenced', () => {
  const protocolRaw = fs.readFileSync(protocolPath, 'utf8')
  const cohortRaw = fs.readFileSync(cohortPath, 'utf8')

  assert.equal(protocolRaw.includes('holdout-facts'), false)
  assert.equal(cohortRaw.includes('holdout-facts'), false)
})

test('11. Deterministic artifact persistence matches serializeArtifactForPersistence', () => {
  const protocolRaw = fs.readFileSync(protocolPath, 'utf8')
  const protocolObj = JSON.parse(protocolRaw)
  assert.equal(protocolRaw, serializeArtifactForPersistence(protocolObj))

  const cohortRaw = fs.readFileSync(cohortPath, 'utf8')
  const cohortObj = JSON.parse(cohortRaw)
  assert.equal(cohortRaw, serializeArtifactForPersistence(cohortObj))
})
