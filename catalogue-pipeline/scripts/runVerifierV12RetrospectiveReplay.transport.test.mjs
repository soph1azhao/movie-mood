import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  CANDIDATE_STATES,
  createVerifierV12ProviderDispatch,
  executeSingleCandidateAttempt,
  inspectCandidateResumeState,
  markCandidateCompleted,
  normalizeTransportOutcome,
  buildSevenSurfacePacket,
  verifyHashes,
  FROZEN_EXPECTED_HASHES,
  FROZEN_MODEL_CONFIG,
  AUTHORIZED_SURFACES,
  FORBIDDEN_LEAKAGE_KEYS,
  EXECUTION_DIR,
} from './runVerifierV12RetrospectiveReplay.mjs'
import { validateVerifierV12CandidatePayload } from './validateVerifierV12Contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function createIsolatedTestDir() {
  return path.join(
    os.tmpdir(),
    `movie-mood-test-transport-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
}

const SAMPLE_RECORD = Object.freeze({
  candidateId: 'scale500-tmdb-101',
  tmdbId: 101,
  title: 'Test Movie',
  humanDecision: 'APPROVE',
  riskCategory: 'CLEAN',
})

const SAMPLE_RISK_INPUT = Object.freeze({
  candidateId: 'scale500-tmdb-101',
  tmdbId: 101,
  movie: {
    candidateId: 'scale500-tmdb-101',
    tmdbId: 101,
    title: 'Test Movie',
  },
  facts: {
    plotKeywords: ['drama', 'journey'],
    characterNames: ['Hero', 'Guide'],
    criticalPremisePoints: ['A journey begins'],
    majorSettingElements: ['Coastal town'],
    endingResolutionElements: ['Peace is restored'],
  },
  acceptedSemanticClassification: {
    primaryMood: 'Contemplative',
  },
  semanticBoundaryFlags: {
    spoilerStrictness: 'SETUP_ONLY',
  },
  allowedSourceMaterial: {
    permittedTopics: ['General premise', 'Tone and pacing'],
  },
  spoilerBoundaryRules: {
    setupOnlyAllowed: true,
  },
  copyConstraints: {
    maxCharacters: 500,
  },
  visibleEditorialCopy: {
    description: 'A thoughtful journey across the coastal landscape.',
  },
})

const VALID_VERIFIER_PAYLOAD = Object.freeze({
  riskLevel: 'LOW_RISK',
  riskCategories: [],
  issues: [],
  sourceBoundarySatisfied: true,
  lowRiskCoverage: {
    allVisibleFieldsAudited: true,
    interrogativePremisesAudited: true,
    factualModifiersAudited: true,
    packetFactsAudited: true,
    settingAndLocationAudited: true,
    characterMotivesAndRelationshipsAudited: true,
    storyMechanismsAndConstraintsAudited: true,
    externalLoreAndBackstoryAudited: true,
    spoilerAndRevealBoundariesAudited: true,
    viewingExperienceInferenceAudited: true,
    summaryRationale: 'All fields strictly stay within authorized facts and validated tokens.',
  },
})

const VALID_VERIFIER_RESPONSE_BODY = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify(VALID_VERIFIER_PAYLOAD),
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 1200,
    candidatesTokenCount: 350,
    totalTokenCount: 1550,
  },
}

test('1. Provider dependency injection makes zero real calls', async () => {
  const testDir = createIsolatedTestDir()
  let dispatchCallCount = 0

  const mockDispatch = async () => {
    dispatchCallCount += 1
    return {
      ok: true,
      status: 200,
      rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
      usageMetadata: VALID_VERIFIER_RESPONSE_BODY.usageMetadata,
      transportOutcome: 'SUCCESS',
      transportCategory: 'HTTP_200',
      retryable: false,
    }
  }

  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  const result = await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  assert.equal(dispatchCallCount, 1)
  assert.equal(result.state, CANDIDATE_STATES.RESPONSE_PERSISTED)
  assert.equal(result.transportResult.ok, true)
})

test('2. Real provider factory binds candidate v1.2 assets', async () => {
  let capturedRequest = null
  const fakeApiKey = 'TEST_API_KEY_BINDING_VALIDATION'

  const fakeFetch = async (endpoint, options) => {
    capturedRequest = { endpoint, options }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    }
  }

  const dispatch = createVerifierV12ProviderDispatch({
    apiKey: fakeApiKey,
    fetchImpl: fakeFetch,
  })

  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  const outcome = await dispatch(packet)

  assert.equal(outcome.ok, true)
  assert.ok(capturedRequest !== null)
  assert.ok(capturedRequest.endpoint.includes('gemini-3.8-flash'))
  assert.equal(capturedRequest.options.headers['x-goog-api-key'], fakeApiKey)

  const parsedBody = JSON.parse(capturedRequest.options.body)
  assert.equal(parsedBody.generationConfig.temperature, 0.0)
  assert.equal(parsedBody.generationConfig.maxOutputTokens, 4096)
  assert.equal(parsedBody.generationConfig.thinkingConfig.thinkingLevel, 'medium')
  assert.ok(parsedBody.generationConfig.responseJsonSchema)
  assert.equal(parsedBody.generationConfig.responseJsonSchema.title, 'Source Boundary Risk Verifier Semantic Output v1.2')
  assert.ok(parsedBody.systemInstruction.parts[0].text.includes('source-boundary-risk-verifier.v1.2'))
})

test('3. Seven-surface packet remains leakage-clean', () => {
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  const keys = Object.keys(packet)

  assert.equal(keys.length, AUTHORIZED_SURFACES.length)
  for (const surface of AUTHORIZED_SURFACES) {
    assert.ok(surface in packet, `Expected surface ${surface} to be present`)
  }

  const packetJson = JSON.stringify(packet)
  for (const forbidden of FORBIDDEN_LEAKAGE_KEYS) {
    assert.equal(forbidden in packet, false, `Forbidden key ${forbidden} must not be in packet root`)
  }
  assert.equal(packetJson.includes('APPROVE'), false)
  assert.equal(packetJson.includes('humanDecision'), false)
})

test('4. NOT_STARTED -> PRE_DISPATCH', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  let capturedPreDispatchState = null

  const mockDispatch = async () => {
    // Read ledger while dispatch is underway
    const ledgerPath = path.join(testDir, candidateId, 'ledger.json')
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    capturedPreDispatchState = ledger.state
    return {
      ok: true,
      status: 200,
      rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
      transportOutcome: 'SUCCESS',
      transportCategory: 'HTTP_200',
      retryable: false,
    }
  }

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  // Captured state during provider invocation was DISPATCH_STARTED (which followed PRE_DISPATCH)
  assert.equal(capturedPreDispatchState, CANDIDATE_STATES.DISPATCH_STARTED)
})

test('5. PRE_DISPATCH -> DISPATCH_STARTED', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  let stateDuringDispatch = null
  const mockDispatch = async () => {
    const ledger = JSON.parse(await readFile(path.join(testDir, candidateId, 'ledger.json'), 'utf8'))
    stateDuringDispatch = ledger.state
    return {
      ok: true,
      status: 200,
      rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
      transportOutcome: 'SUCCESS',
      transportCategory: 'HTTP_200',
      retryable: false,
    }
  }

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  assert.equal(stateDuringDispatch, CANDIDATE_STATES.DISPATCH_STARTED)
})

test('6. Successful response persisted before interpretation', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  const result = await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  const attemptFilePath = path.join(testDir, candidateId, 'attempts', 'attempt-001.raw.json')
  assert.ok(existsSync(attemptFilePath))
  const rawContent = await readFile(attemptFilePath, 'utf8')
  assert.equal(rawContent, JSON.stringify(VALID_VERIFIER_RESPONSE_BODY))
  assert.equal(result.state, CANDIDATE_STATES.RESPONSE_PERSISTED)
})

test('7. Response artifact is attempt-specific', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: '{"attempt": 1}',
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  const result = await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  assert.ok(result.artifactPath.endsWith('attempts/attempt-001.raw.json'))
  assert.ok(existsSync(path.join(testDir, candidateId, 'attempts', 'attempt-001.raw.json')))
})

test('8. Retry attempt 2 does not overwrite attempt 1', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const dispatchAttempt1 = async () => ({
    ok: false,
    status: 500,
    rawText: '{"error": "Internal Server Error"}',
    transportOutcome: 'HTTP_ERROR',
    transportCategory: 'HTTP_500',
    retryable: true,
  })

  const dispatchAttempt2 = async () => ({
    ok: true,
    status: 200,
    rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: dispatchAttempt1,
  })

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 2,
    executionDir: testDir,
    providerDispatch: dispatchAttempt2,
  })

  const attempt1Path = path.join(testDir, candidateId, 'attempts', 'attempt-001.raw.json')
  const attempt2Path = path.join(testDir, candidateId, 'attempts', 'attempt-002.raw.json')

  assert.ok(existsSync(attempt1Path))
  assert.ok(existsSync(attempt2Path))

  const content1 = await readFile(attempt1Path, 'utf8')
  const content2 = await readFile(attempt2Path, 'utf8')

  assert.equal(content1, '{"error": "Internal Server Error"}')
  assert.equal(content2, JSON.stringify(VALID_VERIFIER_RESPONSE_BODY))
  assert.notEqual(content1, content2)
})

test('9. Existing attempt artifact refuses overwrite', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: '{"first": true}',
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  await assert.rejects(
    async () => {
      await executeSingleCandidateAttempt({
        record: SAMPLE_RECORD,
        packet,
        attemptNumber: 1,
        executionDir: testDir,
        providerDispatch: mockDispatch,
      })
    },
    (err) => err.code === 'ATTEMPT_ARTIFACT_EXISTS',
  )
})

test('10. COMPLETED candidate cannot redispatch', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  await markCandidateCompleted({
    candidateId,
    executionDir: testDir,
    terminalAttempt: 1,
    disposition: 'VALID_LOW_RISK',
  })

  await assert.rejects(
    async () => {
      await executeSingleCandidateAttempt({
        record: SAMPLE_RECORD,
        packet,
        attemptNumber: 2,
        executionDir: testDir,
        providerDispatch: mockDispatch,
      })
    },
    (err) => err.code === 'ALREADY_COMPLETED',
  )
})

test('11. DISPATCH_STARTED without durable response becomes ambiguous on resume', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const candidateDir = path.join(testDir, candidateId)
  await mkdir(candidateDir, { recursive: true })

  // Write crashed ledger state
  const crashedLedger = {
    candidateId,
    state: CANDIDATE_STATES.DISPATCH_STARTED,
    currentAttempt: 1,
    terminalAttempt: null,
    attempts: [],
    ambiguous: false,
  }
  await writeFile(path.join(candidateDir, 'ledger.json'), JSON.stringify(crashedLedger, null, 2))

  const resume = await inspectCandidateResumeState({
    candidateId,
    executionDir: testDir,
  })

  assert.equal(resume.state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
  assert.equal(resume.canDispatch, false)
  assert.equal(resume.resumeAction, 'STOP_AMBIGUOUS')

  // Check ledger on disk was durably marked ambiguous
  const savedLedger = JSON.parse(await readFile(path.join(candidateDir, 'ledger.json'), 'utf8'))
  assert.equal(savedLedger.state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
  assert.equal(savedLedger.ambiguous, true)
})

test('12. Ambiguous candidate cannot redispatch', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const candidateDir = path.join(testDir, candidateId)
  await mkdir(candidateDir, { recursive: true })

  const ambiguousLedger = {
    candidateId,
    state: CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE,
    currentAttempt: 1,
    terminalAttempt: null,
    attempts: [],
    ambiguous: true,
  }
  await writeFile(path.join(candidateDir, 'ledger.json'), JSON.stringify(ambiguousLedger, null, 2))

  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  await assert.rejects(
    async () => {
      await executeSingleCandidateAttempt({
        record: SAMPLE_RECORD,
        packet,
        attemptNumber: 1,
        executionDir: testDir,
        providerDispatch: async () => assert.fail('Provider must not be called'),
      })
    },
    (err) => err.code === 'AMBIGUOUS_DISPATCH_STATE',
  )
})

test('13. Confirmed HTTP 500 is known transport failure, not ambiguous', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: false,
    status: 500,
    rawText: '{"error": {"code": 500, "message": "Internal error encountered"}}',
    transportOutcome: 'HTTP_ERROR',
    transportCategory: 'HTTP_500',
    retryable: true,
  })

  const result = await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  assert.equal(result.transportResult.ok, false)
  assert.equal(result.transportResult.status, 500)
  assert.equal(result.transportResult.retryable, true)
  assert.equal(result.transportResult.transportCategory, 'HTTP_500')
  assert.equal(result.state, CANDIDATE_STATES.RESPONSE_PERSISTED)
  assert.equal(result.ledger.ambiguous, false)
})

test('14. Confirmed HTTP 502 normalized as non-retryable provider failure', () => {
  const outcome = normalizeTransportOutcome({
    status: 502,
    ok: false,
    rawText: 'Bad Gateway',
  })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.status, 502)
  assert.equal(outcome.retryable, false)
  assert.equal(outcome.transportCategory, 'HTTP_502')
  assert.equal(outcome.transportOutcome, 'HTTP_ERROR')
})

test('15. Confirmed HTTP 504 normalized as non-retryable provider failure', () => {
  const outcome = normalizeTransportOutcome({
    status: 504,
    ok: false,
    rawText: 'Gateway Timeout',
  })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.status, 504)
  assert.equal(outcome.retryable, false)
  assert.equal(outcome.transportCategory, 'HTTP_504')
  assert.equal(outcome.transportOutcome, 'HTTP_ERROR')
})

test('16. Successful 200 verifier body is returned for later validation', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    usageMetadata: VALID_VERIFIER_RESPONSE_BODY.usageMetadata,
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  const result = await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  const rawJson = JSON.parse(result.transportResult.rawText)
  const candidateOutputText = rawJson.candidates[0].content.parts[0].text
  const parsedCandidateOutput = JSON.parse(candidateOutputText)

  const validation = validateVerifierV12CandidatePayload(parsedCandidateOutput)
  assert.equal(validation.ok, true)
  assert.equal(parsedCandidateOutput.riskLevel, 'LOW_RISK')
})

test('17. Test execution directory is isolated', () => {
  const testDir = createIsolatedTestDir()
  assert.notEqual(testDir, EXECUTION_DIR)
  assert.ok(!testDir.includes('catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay'))
  assert.equal(existsSync(EXECUTION_DIR), false)
})

test('18. Credential value is never persisted', async () => {
  const testDir = createIsolatedTestDir()
  const candidateId = 'scale500-tmdb-101'
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  const secretKey = 'CRITICAL_SECRET_GEMINI_KEY_DO_NOT_PERSIST_987654321'

  const mockDispatch = async () => ({
    ok: true,
    status: 200,
    rawText: JSON.stringify(VALID_VERIFIER_RESPONSE_BODY),
    providerMetadata: {
      provider: FROZEN_MODEL_CONFIG.provider,
      modelId: FROZEN_MODEL_CONFIG.modelId,
    },
    transportOutcome: 'SUCCESS',
    transportCategory: 'HTTP_200',
    retryable: false,
  })

  await executeSingleCandidateAttempt({
    record: SAMPLE_RECORD,
    packet,
    attemptNumber: 1,
    executionDir: testDir,
    providerDispatch: mockDispatch,
  })

  // Recursively inspect all files in testDir
  function scanDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...scanDir(fullPath))
      } else {
        files.push(fullPath)
      }
    }
    return files
  }

  const allFiles = scanDir(testDir)
  assert.ok(allFiles.length > 0)
  for (const file of allFiles) {
    const content = await readFile(file, 'utf8')
    assert.equal(content.includes(secretKey), false, `Secret key leaked to ${file}`)
  }
})

test('19. Mode 2 data is never included', () => {
  const packet = buildSevenSurfacePacket(SAMPLE_RISK_INPUT)
  const packetText = JSON.stringify(packet)
  assert.equal(packetText.includes('MODE_2'), false)
  assert.equal(packetText.includes('mode2'), false)
  assert.equal(packetText.includes('holdout'), false)
})

test('20. Frozen protocol/candidate hashes remain unchanged', async () => {
  const hashCheck = await verifyHashes()
  assert.equal(hashCheck.ok, true)
  assert.equal(hashCheck.results.protocol.canonicalHash, FROZEN_EXPECTED_HASHES.protocol.canonical)
  assert.equal(hashCheck.results.cohort.canonicalHash, FROZEN_EXPECTED_HASHES.cohort.canonical)
  assert.equal(hashCheck.results.candidatePrompt.rawHash, FROZEN_EXPECTED_HASHES.candidatePrompt.raw)
  assert.equal(hashCheck.results.candidateSchema.rawHash, FROZEN_EXPECTED_HASHES.candidateSchema.raw)
})
