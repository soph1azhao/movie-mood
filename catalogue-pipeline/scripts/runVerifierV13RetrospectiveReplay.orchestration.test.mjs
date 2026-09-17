import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  runVerifierV13RetrospectiveReplay,
  runVerifierV13Preflight,
  runVerifierV13DryRun,
  main,
  verifyExecutionAuthorization,
  checkPreDispatchAffordability,
  loadAndValidateTokenManifest,
  atomicWriteJson,
  buildCandidateV13GeminiRequest,
  buildVerifierV13ReplayPacket,
  deriveAttemptRecordFromRaw,
  CANDIDATE_STATES,
  VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
  FROZEN_CALL_LIMITS,
  FROZEN_TOKEN_MANIFEST_BYTE_HASH,
  FROZEN_COHORT_CANONICAL_HASH,
  TOKEN_MANIFEST_PATH,
  COHORT_MANIFEST_PATH,
  CANDIDATE_PROMPT_PATH,
  CANDIDATE_SCHEMA_PATH,
} from './runVerifierV13RetrospectiveReplay.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testExecutionDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-execution.tmp')

test('verifyExecutionAuthorization fails closed without authorization token', () => {
  const res = verifyExecutionAuthorization({ env: {} })
  assert.equal(res.authorized, false)
  assert.equal(res.reason, 'EXECUTION_NOT_AUTHORIZED')

  const valid = verifyExecutionAuthorization({
    env: { VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN },
  })
  assert.equal(valid.authorized, true)
})

test('runVerifierV13RetrospectiveReplay halts closed if unauthorized', async () => {
  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not call fetch')
  }

  const res = await runVerifierV13RetrospectiveReplay({
    env: {},
    fetchImpl: mockFetch,
    executionDir: testExecutionDir,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'BLOCKED')
  assert.equal(fetchCalled, false)
})

test('checkPreDispatchAffordability halts when budget exceeds ceiling', () => {
  // $1.08 + $0.026100 = $1.106100 > $1.10 => should be false
  const blocked = checkPreDispatchAffordability({
    accumulatedCost: 1.08,
    nextCallEstimate: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
  })
  assert.equal(blocked, false)

  // $0.50 + $0.026100 = $0.526100 <= $1.10 => should be true
  const allowed = checkPreDispatchAffordability({
    accumulatedCost: 0.50,
    nextCallEstimate: FROZEN_CALL_LIMITS.frozenNextCallCostReserveUsd,
    costCeiling: FROZEN_CALL_LIMITS.governedPreDispatchCostCeilingUsd,
  })
  assert.equal(allowed, true)
})

test('Token manifest fails closed: missing, malformed, count mismatch, duplicate, and unexpected candidate', async () => {
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)
  const validManifestRaw = await readFile(TOKEN_MANIFEST_PATH, 'utf8')
  const validManifest = JSON.parse(validManifestRaw)

  const tmpDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-manifest.tmp')
  await mkdir(tmpDir, { recursive: true })

  try {
    // 1. Missing manifest
    const missingPath = path.join(tmpDir, 'missing-manifest.json')
    await assert.rejects(
      loadAndValidateTokenManifest({ tokenManifestPath: missingPath, cohort }),
      { code: 'TOKEN_MANIFEST_MISSING' }
    )

    // Replay runner with missing manifest returns BLOCKED and makes 0 network calls
    let fetchCalled = false
    const mockFetch = async () => { fetchCalled = true }
    const missingRes = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      tokenManifestPath: missingPath,
      executionDir: testExecutionDir,
    })
    assert.equal(missingRes.ok, false)
    assert.equal(missingRes.status, 'BLOCKED')
    assert.equal(missingRes.reason, 'TOKEN_MANIFEST_MISSING')
    assert.equal(fetchCalled, false)

    // 2. Malformed JSON
    const malformedPath = path.join(tmpDir, 'malformed-manifest.json')
    await writeFile(malformedPath, '{ "records": [ invalid json', 'utf8')
    await assert.rejects(
      loadAndValidateTokenManifest({ tokenManifestPath: malformedPath, cohort }),
      { code: 'TOKEN_MANIFEST_MALFORMED' }
    )

    // 3. Count mismatch (29 records)
    const incompletePath = path.join(tmpDir, 'incomplete-manifest.json')
    const incompleteManifest = { ...validManifest, records: validManifest.records.slice(0, 29) }
    await writeFile(incompletePath, JSON.stringify(incompleteManifest), 'utf8')
    await assert.rejects(
      loadAndValidateTokenManifest({ tokenManifestPath: incompletePath, cohort }),
      { code: 'TOKEN_MANIFEST_COUNT_MISMATCH' }
    )

    // 4. Duplicate candidate
    const duplicatePath = path.join(tmpDir, 'duplicate-manifest.json')
    const duplicateManifest = {
      ...validManifest,
      records: [validManifest.records[0], ...validManifest.records.slice(0, 29)],
    }
    await writeFile(duplicatePath, JSON.stringify(duplicateManifest), 'utf8')
    await assert.rejects(
      loadAndValidateTokenManifest({ tokenManifestPath: duplicatePath, cohort }),
      { code: 'TOKEN_MANIFEST_DUPLICATE_CANDIDATE' }
    )

    // 5. Unexpected candidate outside cohort
    const unexpectedPath = path.join(tmpDir, 'unexpected-manifest.json')
    const unexpectedRecords = validManifest.records.map((r, i) =>
      i === 0 ? { ...r, candidateId: 'scale500-tmdb-999999' } : r
    )
    await writeFile(unexpectedPath, JSON.stringify({ ...validManifest, records: unexpectedRecords }), 'utf8')
    await assert.rejects(
      loadAndValidateTokenManifest({ tokenManifestPath: unexpectedPath, cohort }),
      { code: 'TOKEN_MANIFEST_UNEXPECTED_CANDIDATE' }
    )
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('requestHash mismatch causes zero dispatch and halts closed', async () => {
  const validManifestRaw = await readFile(TOKEN_MANIFEST_PATH, 'utf8')
  const manifest = JSON.parse(validManifestRaw)

  // Tamper with candidate 0 requestHash
  const tamperedRecords = manifest.records.map((r, idx) =>
    idx === 0
      ? { ...r, requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
      : r
  )

  const tmpDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-hash-mismatch.tmp')
  const tamperedManifestPath = path.join(tmpDir, 'tampered-manifest.json')
  await mkdir(tmpDir, { recursive: true })
  await writeFile(tamperedManifestPath, JSON.stringify({ ...manifest, records: tamperedRecords }), 'utf8')

  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { ok: true, status: 200, text: async () => '{}' }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      tokenManifestPath: tamperedManifestPath,
      enforceFrozenBindings: false,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    assert.equal(res.executionLedger.status, 'STOPPED')
    assert.equal(res.executionLedger.stoppedReason, 'STOP_IF_CALIBRATED_HASH_MISMATCH')
    assert.equal(fetchCalls, 0, 'Must cause zero network dispatches')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
    await rm(testExecutionDir, { recursive: true, force: true })
  }
})

test('Timeout actually aborts signal and classifies NETWORK_TIMEOUT', async () => {
  let callCount = 0
  const mockFetch = async (_url, { signal }) => {
    callCount += 1
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 200)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }
    })
    return { ok: true, status: 200, text: async () => '{}' }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      timeoutMs: 40,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    // Attempt 1 timed out and was retried twice (3 calls total for 1 candidate, max 2 retries)
    assert.equal(callCount, 3)

    // Check attempt 1 raw file
    const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
    const firstCandidateId = JSON.parse(cohortRaw).records[0].candidateId
    const rawPath = path.join(testExecutionDir, firstCandidateId, 'attempt-1.raw.json')
    const rawData = JSON.parse(await readFile(rawPath, 'utf8'))
    assert.equal(rawData.transportError.category, 'NETWORK_TIMEOUT')

    const jsonPath = path.join(testExecutionDir, firstCandidateId, 'attempt-1.json')
    const jsonData = JSON.parse(await readFile(jsonPath, 'utf8'))
    assert.equal(jsonData.attemptDisposition, 'NETWORK_TIMEOUT')
    assert.equal(jsonData.transportRetryable, true)
  } finally {
    await rm(testExecutionDir, { recursive: true, force: true })
  }
})

test('Raw response is durably persisted before interpretation', async () => {
  const lowRiskText = JSON.stringify({
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
      summaryRationale: 'Grounded.',
    },
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: lowRiskText }] } }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
  }
  const rawString = JSON.stringify(envelope)

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => rawString,
  })

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
    const firstCandidateId = JSON.parse(cohortRaw).records[0].candidateId
    const candidateDir = path.join(testExecutionDir, firstCandidateId)

    // Check raw evidence
    const rawPath = path.join(candidateDir, 'attempt-1.raw.json')
    const rawData = JSON.parse(await readFile(rawPath, 'utf8'))
    assert.equal(rawData.rawResponseText, rawString)
    assert.equal(rawData.status, 200)
    assert.equal(
      rawData.rawResponseHash,
      `sha256:${createHash('sha256').update(Buffer.from(rawString, 'utf8')).digest('hex')}`
    )
    assert.equal(rawData.error, null)

    // Check derived attempt record for usageMetadata
    const attemptPath = path.join(candidateDir, 'attempt-1.json')
    const attemptData = JSON.parse(await readFile(attemptPath, 'utf8'))
    assert.deepEqual(attemptData.usageMetadata, envelope.usageMetadata)

    // Check candidate state lifecycle
    const statePath = path.join(candidateDir, 'candidate-state.json')
    const stateData = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(stateData.state, CANDIDATE_STATES.COMPLETED)
    assert.equal(stateData.finalDisposition, 'VALID_LOW_RISK')
  } finally {
    await rm(testExecutionDir, { recursive: true, force: true })
  }
})

test('Ambiguous DISPATCH_STARTED state halts closed and never redispatches', async () => {
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const firstCandidateId = JSON.parse(cohortRaw).records[0].candidateId
  const candidateDir = path.join(testExecutionDir, firstCandidateId)
  await mkdir(candidateDir, { recursive: true })

  // Pre-seed candidate-state.json with DISPATCH_STARTED but no raw response
  const statePath = path.join(candidateDir, 'candidate-state.json')
  await writeFile(
    statePath,
    JSON.stringify({
      candidateId: firstCandidateId,
      state: CANDIDATE_STATES.DISPATCH_STARTED,
      currentAttempt: 1,
      dispatchedAt: new Date().toISOString(),
    }),
    'utf8'
  )

  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not call fetch')
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    assert.equal(res.executionLedger.status, 'STOPPED')
    assert.equal(res.executionLedger.stoppedReason, 'STOP_AMBIGUOUS_DISPATCH_STATE')
    assert.equal(fetchCalled, false, 'Must never redispatch on ambiguous state')

    const updatedState = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(updatedState.state, CANDIDATE_STATES.AMBIGUOUS_DISPATCH_STATE)
  } finally {
    await rm(testExecutionDir, { recursive: true, force: true })
  }
})

test('Completed attempt evidence refuses overwrite', async () => {
  await mkdir(testExecutionDir, { recursive: true })
  const filePath = path.join(testExecutionDir, 'test-attempt.json')
  await atomicWriteJson(filePath, { attempt: 1, data: 'original' })

  await assert.rejects(
    atomicWriteJson(filePath, { attempt: 1, data: 'overwritten' }, { refuseOverwrite: true }),
    { code: 'REFUSE_OVERWRITE' }
  )

  const content = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(content.data, 'original', 'Original file content must not be changed')
  await rm(testExecutionDir, { recursive: true, force: true })
})

test('Resume reconstructs primaryCalls, technicalRetries, totalExternalCalls, cost, and systemicInvalidCount', async () => {
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)
  const c1 = cohort.records[0].candidateId
  const c2 = cohort.records[1].candidateId

  const c1Dir = path.join(testExecutionDir, c1)
  const c2Dir = path.join(testExecutionDir, c2)
  await mkdir(c1Dir, { recursive: true })
  await mkdir(c2Dir, { recursive: true })

  // Candidate 1: 1 attempt, completed, valid, cost $0.012
  await writeFile(path.join(c1Dir, 'attempt-1.raw.json'), JSON.stringify({ usageMetadata: null }), 'utf8')
  await writeFile(
    path.join(c1Dir, 'attempt-1.json'),
    JSON.stringify({ attemptDisposition: 'VALID_LOW_RISK', callCostUsd: 0.012 }),
    'utf8'
  )
  await writeFile(
    path.join(c1Dir, 'candidate-state.json'),
    JSON.stringify({ state: CANDIDATE_STATES.COMPLETED, finalDisposition: 'VALID_LOW_RISK', currentAttempt: 1 }),
    'utf8'
  )

  // Candidate 2: attempt-1 failed (retry), attempt-2 SCHEMA_INVALID, total cost $0.0025 + $0.015 = $0.0175
  await writeFile(path.join(c2Dir, 'attempt-1.raw.json'), JSON.stringify({ usageMetadata: null }), 'utf8')
  await writeFile(
    path.join(c2Dir, 'attempt-1.json'),
    JSON.stringify({ attemptDisposition: 'HTTP_503_SERVICE_UNAVAILABLE', callCostUsd: 0.0025 }),
    'utf8'
  )
  await writeFile(path.join(c2Dir, 'attempt-2.raw.json'), JSON.stringify({ usageMetadata: null }), 'utf8')
  await writeFile(
    path.join(c2Dir, 'attempt-2.json'),
    JSON.stringify({ attemptDisposition: 'SCHEMA_INVALID', callCostUsd: 0.015 }),
    'utf8'
  )
  await writeFile(
    path.join(c2Dir, 'candidate-state.json'),
    JSON.stringify({ state: CANDIDATE_STATES.COMPLETED, finalDisposition: 'SCHEMA_INVALID', currentAttempt: 2 }),
    'utf8'
  )

  let fetchCalls = 0
  const mockFetch = async () => {
    fetchCalls += 1
    return { ok: true, status: 200, text: async () => '{}' }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 2,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(fetchCalls, 0, 'Completed candidates must be skipped without network calls')
    assert.equal(ledger.callAccounting.primaryCalls, 2)
    assert.equal(ledger.callAccounting.technicalRetries, 1)
    assert.equal(ledger.callAccounting.totalExternalCalls, 3)
    assert.equal(Math.round(ledger.callAccounting.accumulatedCostUsd * 10000) / 10000, 0.0295)
    assert.equal(ledger.systemicInvalidCount, 1)
    assert.equal(ledger.candidatesCompletedCount, 2)
  } finally {
    await rm(testExecutionDir, { recursive: true, force: true })
  }
})

test('502, 504, and generic network errors remain strictly terminal with zero retry', async () => {
  for (const status of [502, 504, null]) {
    let callCount = 0
    const mockFetch = async () => {
      callCount += 1
      if (status === null) {
        const netErr = new Error('getaddrinfo ENOTFOUND')
        netErr.code = 'ENOTFOUND'
        throw netErr
      }
      return {
        ok: false,
        status,
        text: async () => (status === 502 ? 'Bad Gateway' : 'Gateway Timeout'),
      }
    }

    try {
      const res = await runVerifierV13RetrospectiveReplay({
        env: {
          VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
          GEMINI_API_KEY: 'mock-key',
        },
        fetchImpl: mockFetch,
        executionDir: testExecutionDir,
        maxCandidates: 1,
      })

      assert.equal(res.ok, true)
      assert.equal(callCount, 1, `Status ${status} must be terminal and never retried`)
      const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
      const firstCandidateId = JSON.parse(cohortRaw).records[0].candidateId
      const attemptJson = JSON.parse(
        await readFile(path.join(testExecutionDir, firstCandidateId, 'attempt-1.json'), 'utf8')
      )
      assert.equal(attemptJson.transportRetryable, false)
    } finally {
      await rm(testExecutionDir, { recursive: true, force: true })
    }
  }
})

test('runVerifierV13Preflight and runVerifierV13DryRun produce zero network calls', async () => {
  // Preflight blocked when unauthorized
  const unauthPreflight = await runVerifierV13Preflight({ env: {} })
  assert.equal(unauthPreflight.ok, false)
  assert.equal(unauthPreflight.status, 'PREFLIGHT_BLOCKED')
  assert.equal(unauthPreflight.networkCallsAttempted, 0)

  // Preflight passed when authorized and credentialed
  const authPreflight = await runVerifierV13Preflight({
    env: {
      VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
      GEMINI_API_KEY: 'mock-key',
    },
  })
  assert.equal(authPreflight.ok, true)
  assert.equal(authPreflight.status, 'PREFLIGHT_PASSED')
  assert.equal(authPreflight.networkCallsAttempted, 0)
  assert.equal(authPreflight.calibratedCandidatesCount, 30)

  // Dry-run blocked when unauthorized
  const unauthDryRun = await runVerifierV13DryRun({ env: {} })
  assert.equal(unauthDryRun.ok, false)
  assert.equal(unauthDryRun.status, 'DRY_RUN_BLOCKED')
  assert.equal(unauthDryRun.networkCallsAttempted, 0)

  // Dry-run passed when authorized
  const authDryRun = await runVerifierV13DryRun({
    env: {
      VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
      GEMINI_API_KEY: 'mock-key',
    },
  })
  assert.equal(authDryRun.ok, true)
  assert.equal(authDryRun.status, 'DRY_RUN_PASSED')
  assert.equal(authDryRun.totalCandidates, 30)
  assert.equal(authDryRun.dispatchesAttempted, 0)
  assert.equal(authDryRun.networkCallsAttempted, 0)
  assert.equal(authDryRun.candidateChecks.length, 30)
  for (const check of authDryRun.candidateChecks) {
    assert.equal(check.nextCallReserveUsd, 0.026100)
  }
  assert.equal(authDryRun.accumulatedEstimatedMaxCostUsd, 0.783)
  assert.ok(authDryRun.accumulatedEstimatedMaxCostUsd <= authDryRun.costCeilingUsd)
})

test('CLI main entrypoint fails closed without exact authorization', async () => {
  const originalArgv = process.argv
  const originalEnv = { ...process.env }
  const originalExitCode = process.exitCode

  try {
    delete process.env.VERIFIER_V13_REPLAY_AUTHORIZATION

    // Invalid subcommand
    process.argv = ['node', 'runVerifierV13RetrospectiveReplay.mjs', 'invalid-subcommand']
    const resInvalid = await main()
    assert.equal(resInvalid.ok, false)
    assert.equal(resInvalid.status, 'INVALID_CLI_COMMAND')
    assert.equal(process.exitCode, 1)

    // Unauthorized 'run'
    process.exitCode = 0
    process.argv = ['node', 'runVerifierV13RetrospectiveReplay.mjs', 'run']
    const resRunUnauth = await main()
    assert.equal(resRunUnauth.ok, false)
    assert.equal(resRunUnauth.status, 'BLOCKED')
    assert.equal(process.exitCode, 1)

    // Preflight unauthorized
    process.exitCode = 0
    process.argv = ['node', 'runVerifierV13RetrospectiveReplay.mjs', 'preflight']
    const resPreflightUnauth = await main()
    assert.equal(resPreflightUnauth.ok, false)
    assert.equal(resPreflightUnauth.status, 'PREFLIGHT_BLOCKED')
    assert.equal(process.exitCode, 1)
  } finally {
    process.argv = originalArgv
    process.env = originalEnv
    process.exitCode = originalExitCode
  }
})

test('30/30 calibrated request parity remains unchanged against token manifest', async () => {
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)
  const tokenManifestRaw = await readFile(TOKEN_MANIFEST_PATH, 'utf8')
  const tokenManifest = JSON.parse(tokenManifestRaw)
  const promptText = await readFile(CANDIDATE_PROMPT_PATH, 'utf8')
  const schemaRaw = await readFile(CANDIDATE_SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(schemaRaw)

  assert.equal(tokenManifest.records.length, 30)
  const manifestMap = new Map(tokenManifest.records.map((r) => [r.candidateId, r]))

  for (const item of cohort.records) {
    const fullInputPath = path.isAbsolute(item.sourceRiskInputPath)
      ? item.sourceRiskInputPath
      : path.join(repoRoot, item.sourceRiskInputPath)
    const riskInput = JSON.parse(await readFile(fullInputPath, 'utf8'))
    const packet = buildVerifierV13ReplayPacket(riskInput)
    const req = buildCandidateV13GeminiRequest({
      promptText,
      packet,
      schema,
    })

    const calibrated = manifestMap.get(item.candidateId)
    assert.ok(calibrated, `Candidate ${item.candidateId} must be present in token manifest`)
    assert.equal(
      req.requestMetadata.requestHash,
      calibrated.requestHash,
      `requestHash mismatch for ${item.candidateId}`
    )
  }
})

test('Severe case scale500-tmdb-14283 LOW_RISK escape triggers immediate halt', async () => {
  const lowRiskText = JSON.stringify({
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
      summaryRationale: 'Clean.',
    },
  })

  const envelope = {
    candidates: [
      {
        content: {
          parts: [{ text: lowRiskText }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 500, thinkingTokenCount: 3500 },
  }

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(envelope),
  })

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.status, 'STOPPED')
    assert.equal(ledger.stoppedReason, 'STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE')
    assert.equal(ledger.severeCaseOutcome, 'KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Batch retry exhaustion (10 retries) disables retries while untouched primaries continue', async () => {
  let callCount = 0

  // First 5 candidates fail with 503 twice (consuming 10 retries = 5 primaries + 10 retries = 15 calls)
  // Subsequent candidates should continue, but cannot retry!
  const mockFetch = async () => {
    callCount += 1
    if (callCount <= 15) {
      return {
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      }
    }
    // After 10 retries exhausted, candidates return a terminal status without retry
    return {
      ok: false,
      status: 502, // 502 is terminal
      text: async () => 'Bad Gateway',
    }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.callAccounting.technicalRetries, 10, 'Technical retries must cap at 10')
    assert.equal(ledger.batchRetryStatus, 'RETRY_DISABLED_FOR_REMAINDER_OF_BATCH')
    assert.ok(ledger.candidatesCompletedCount > 5, 'Untouched primaries must continue after retries disabled')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Systemic invalid stop halts replay when cumulative invalid reaches 6', async () => {
  // Return schema-invalid payload (missing required lowRiskCoverage)
  const schemaInvalidText = JSON.stringify({
    riskLevel: 'LOW_RISK',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
    // lowRiskCoverage missing!
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: schemaInvalidText }] } }],
    usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 100, thinkingTokenCount: 1000 },
  }

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(envelope),
  })

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
    })

    assert.equal(res.ok, true)
    const ledger = res.executionLedger
    assert.equal(ledger.status, 'STOPPED')
    assert.equal(ledger.stoppedReason, 'STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6')
    assert.equal(ledger.systemicInvalidCount, 6)
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Durable response resume: Crash A (after raw response write but before RESPONSE_PERSISTED)', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const requestHash = tokenManifest.records[0].requestHash

  const cDir = path.join(testExecutionDir, firstCandidate.candidateId)
  await mkdir(cDir, { recursive: true })

  const statePath = path.join(cDir, 'candidate-state.json')
  const rawPath = path.join(cDir, 'attempt-1.raw.json')
  const attemptPath = path.join(cDir, 'attempt-1.json')

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
  }
  const rawString = JSON.stringify(envelope)

  // Crash A: state is DISPATCH_STARTED, attempt-1.raw.json exists, attempt-1.json absent
  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.DISPATCH_STARTED,
    attemptIndex: 1,
    requestHash,
    startedAt: new Date().toISOString(),
  })

  await atomicWriteJson(rawPath, {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    status: 200,
    rawResponseText: rawString,
    rawResponseHash: `sha256:${createHash('sha256').update(rawString).digest('hex')}`,
    persistedAt: new Date().toISOString(),
    error: null,
  })

  let fetchCallCount = 0
  const mockFetch = async () => {
    fetchCallCount++
    throw new Error('fetch should not be called during recovery of already-persisted attempt')
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(fetchCallCount, 0, 'Zero network calls must be made while recovering Crash A')
    assert.ok(existsSync(attemptPath), 'attempt-1.json must be derived and created on recovery')

    const persistedState = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(persistedState.state, CANDIDATE_STATES.COMPLETED)
    assert.equal(persistedState.finalDisposition, 'VALID_HIGH_RISK')
    assert.equal(res.executionLedger.callAccounting.primaryCalls, 1, 'Reconstructed call accounting must include persisted attempt')
    assert.equal(res.executionLedger.candidateDispositions[firstCandidate.candidateId], 'VALID_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Durable response resume: Crash B (after RESPONSE_PERSISTED but before attempt-N.json)', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const requestHash = tokenManifest.records[0].requestHash

  const cDir = path.join(testExecutionDir, firstCandidate.candidateId)
  await mkdir(cDir, { recursive: true })

  const statePath = path.join(cDir, 'candidate-state.json')
  const rawPath = path.join(cDir, 'attempt-1.raw.json')
  const attemptPath = path.join(cDir, 'attempt-1.json')

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
  }
  const rawString = JSON.stringify(envelope)

  // Crash B: state is RESPONSE_PERSISTED, attempt-1.raw.json exists, attempt-1.json absent
  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.RESPONSE_PERSISTED,
    attemptIndex: 1,
    requestHash,
    persistedAt: new Date().toISOString(),
  })

  await atomicWriteJson(rawPath, {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    status: 200,
    rawResponseText: rawString,
    rawResponseHash: `sha256:${createHash('sha256').update(rawString).digest('hex')}`,
    persistedAt: new Date().toISOString(),
    error: null,
  })

  let fetchCallCount = 0
  const mockFetch = async () => {
    fetchCallCount++
    throw new Error('fetch should not be called during recovery of already-persisted attempt')
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(fetchCallCount, 0, 'Zero network calls must be made while recovering Crash B')
    assert.ok(existsSync(attemptPath), 'attempt-1.json must be derived and created on recovery')

    const persistedState = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(persistedState.state, CANDIDATE_STATES.COMPLETED)
    assert.equal(persistedState.finalDisposition, 'VALID_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Durable response resume: Crash C (after attempt-N.json but before candidate COMPLETED)', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const requestHash = tokenManifest.records[0].requestHash

  const cDir = path.join(testExecutionDir, firstCandidate.candidateId)
  await mkdir(cDir, { recursive: true })

  const statePath = path.join(cDir, 'candidate-state.json')
  const rawPath = path.join(cDir, 'attempt-1.raw.json')
  const attemptPath = path.join(cDir, 'attempt-1.json')

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
  }
  const rawString = JSON.stringify(envelope)

  // Crash C: state is RESPONSE_PERSISTED, both attempt-1.raw.json and attempt-1.json exist
  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.RESPONSE_PERSISTED,
    attemptIndex: 1,
    requestHash,
    persistedAt: new Date().toISOString(),
  })

  await atomicWriteJson(rawPath, {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    status: 200,
    rawResponseText: rawString,
    rawResponseHash: `sha256:${createHash('sha256').update(rawString).digest('hex')}`,
    persistedAt: new Date().toISOString(),
    error: null,
  })

  await atomicWriteJson(attemptPath, {
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    httpStatus: 200,
    attemptDisposition: 'VALID_HIGH_RISK',
    transportRetryable: false,
    outputRetryEligible: false,
    callCostUsd: 0.005,
    usageMetadata: envelope.usageMetadata,
    rawResponseSha256: `sha256:${createHash('sha256').update(rawString).digest('hex')}`,
    rawTextLength: rawString.length,
    parsed: JSON.parse(validHighRiskText),
    promptDriftExceeded: false,
  })

  let fetchCallCount = 0
  const mockFetch = async () => {
    fetchCallCount++
    throw new Error('fetch should not be called during recovery of already-completed attempt')
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(fetchCallCount, 0, 'Zero network calls must be made while recovering Crash C')

    const persistedState = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(persistedState.state, CANDIDATE_STATES.COMPLETED)
    assert.equal(persistedState.finalDisposition, 'VALID_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Raw-before-parse ordering: raw response must be written to disk before JSON.parse or semantic validation occurs', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]

  const lowRiskText = JSON.stringify({
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
      summaryRationale: 'Grounded in sources.',
    },
  })

  const envelope = {
    candidates: [{ content: { parts: [{ text: lowRiskText }] } }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
  }
  const rawString = JSON.stringify(envelope)

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => rawString,
  })

  const origParse = JSON.parse
  let orderVerified = false
  const rawFileExpected = path.join(testExecutionDir, firstCandidate.candidateId, 'attempt-1.raw.json')

  JSON.parse = function (...args) {
    if (args[0] === rawString || args[0] === lowRiskText) {
      // At the moment JSON.parse is called to interpret the model payload or envelope,
      // attempt-1.raw.json MUST already exist on disk!
      const rawExists = existsSync(rawFileExpected)
      assert.equal(rawExists, true, 'attempt-1.raw.json must be durably written before parsing or interpreting')
      orderVerified = true
    }
    return origParse.apply(this, args)
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(orderVerified, true, 'Parsing was verified to happen strictly after durable raw write')
  } finally {
    JSON.parse = origParse
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Prompt-drift hard stop: >5% prompt drift on otherwise retryable malformed output stops at call count = 1', async () => {
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const calibrated = tokenManifest.records.find((r) => r.candidateId === firstCandidate.candidateId)

  // Prompt token drift: +10% over calibrated count (>5% threshold)
  const driftedPromptTokens = Math.ceil(calibrated.countedInputTokens * 1.10)

  // Otherwise retry-eligible malformed output (not valid JSON)
  const malformedOutputText = '{"brokenJson": true, "unclosed'
  const envelope = {
    candidates: [{ content: { parts: [{ text: malformedOutputText }] } }],
    usageMetadata: {
      promptTokenCount: driftedPromptTokens,
      candidatesTokenCount: 50,
      thinkingTokenCount: 100,
    },
  }

  let callCount = 0
  const mockFetch = async () => {
    callCount++
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(envelope),
    }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(callCount, 1, 'Expected provider call count must be exactly 1')

    const ledger = res.executionLedger
    assert.equal(ledger.status, 'STOPPED')
    assert.equal(ledger.stoppedReason, 'STOP_IF_UNEXPECTED_PROMPT_DRIFT')

    // Persisted attempt evidence must exist
    const attemptRawPath = path.join(testExecutionDir, firstCandidate.candidateId, 'attempt-1.raw.json')
    const attemptJsonPath = path.join(testExecutionDir, firstCandidate.candidateId, 'attempt-1.json')
    assert.ok(existsSync(attemptRawPath), 'attempt-1.raw.json must be persisted')
    assert.ok(existsSync(attemptJsonPath), 'attempt-1.json must be persisted')

    const attemptRecord = JSON.parse(await readFile(attemptJsonPath, 'utf8'))
    assert.equal(attemptRecord.attemptDisposition, 'MALFORMED_JSON_STRING')
    assert.equal(attemptRecord.outputRetryEligible, true)
    assert.equal(attemptRecord.promptDriftExceeded, true)
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Enforce frozen artifact bindings: modifying countedInputTokens alone blocks, reordering cohort blocks, canonical untouched passes', async () => {
  // 1. Canonical untouched passes preflight
  const canonicalPreflight = await runVerifierV13Preflight({
    env: {
      VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
      GEMINI_API_KEY: 'mock-key',
    },
  })
  assert.equal(canonicalPreflight.ok, true, 'Canonical untouched artifacts must pass preflight')

  const tmpDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-bindings.tmp')
  await mkdir(tmpDir, { recursive: true })

  try {
    // 2. Modifying countedInputTokens alone blocks before network
    const validManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
    const modifiedManifest = JSON.parse(JSON.stringify(validManifest))
    modifiedManifest.records[0].countedInputTokens += 1

    const modifiedManifestPath = path.join(tmpDir, 'modified-manifest.json')
    await writeFile(modifiedManifestPath, JSON.stringify(modifiedManifest, null, 2), 'utf8')

    let fetchCalledForModified = false
    const mockFetch = async () => {
      fetchCalledForModified = true
      throw new Error('Network should never be reached')
    }

    const modifiedRes = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      tokenManifestPath: modifiedManifestPath,
    })

    assert.equal(modifiedRes.ok, false)
    assert.equal(modifiedRes.status, 'BLOCKED')
    assert.equal(fetchCalledForModified, false, 'Modifying countedInputTokens alone must block before network')

    // 3. Reordering cohort records blocks before network
    const validCohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
    const reorderedCohort = JSON.parse(JSON.stringify(validCohort))
    const firstRecord = reorderedCohort.records[0]
    reorderedCohort.records[0] = reorderedCohort.records[1]
    reorderedCohort.records[1] = firstRecord

    const reorderedCohortPath = path.join(tmpDir, 'reordered-cohort.json')
    await writeFile(reorderedCohortPath, JSON.stringify(reorderedCohort, null, 2), 'utf8')

    let fetchCalledForReordered = false
    const reorderedRes = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      cohortPath: reorderedCohortPath,
    })

    assert.equal(reorderedRes.ok, false)
    assert.equal(reorderedRes.status, 'BLOCKED')
    assert.equal(fetchCalledForReordered, false, 'Reordering cohort records must block before network')
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {}
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Severe-case outcome mutually exclusive states: NOT_EVALUATED, DETECTED_HIGH_RISK, and CONTAINED_NOT_DETECTED', async () => {
  const lowRiskText = JSON.stringify({
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
      summaryRationale: 'Clean.',
    },
  })

  const highRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  const schemaInvalidText = JSON.stringify({
    riskLevel: 'LOW_RISK',
    riskCategories: [],
    issues: [],
    sourceBoundarySatisfied: true,
    // lowRiskCoverage missing!
  })

  // State 1: NOT_EVALUATED when stopping before scale500-tmdb-14283 (which is index 8)
  try {
    const resNotEvaluated = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: lowRiskText }] } }],
          usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
        }),
      }),
      executionDir: testExecutionDir,
      maxCandidates: 1, // stops after candidate 0, before candidate 8
    })
    assert.equal(resNotEvaluated.ok, true)
    assert.equal(resNotEvaluated.executionLedger.severeCaseOutcome, 'NOT_EVALUATED')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }

  // State 2: DETECTED_HIGH_RISK when scale500-tmdb-14283 yields VALID_HIGH_RISK
  try {
    let callIdx = 0
    const resDetected = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: async () => {
        const isSevere = callIdx === 8
        callIdx++
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: isSevere ? highRiskText : lowRiskText }] } }],
            usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
          }),
        }
      },
      executionDir: testExecutionDir,
      maxCandidates: 9, // reaches candidate index 8
    })
    assert.equal(resDetected.ok, true)
    assert.equal(resDetected.executionLedger.severeCaseOutcome, 'DETECTED_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }

  // State 3: CONTAINED_NOT_DETECTED when scale500-tmdb-14283 encounters a failure (e.g. SCHEMA_INVALID)
  try {
    let callIdx = 0
    const resContained = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: async () => {
        const isSevere = callIdx === 8
        callIdx++
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: isSevere ? schemaInvalidText : lowRiskText }] } }],
            usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
          }),
        }
      },
      executionDir: testExecutionDir,
      maxCandidates: 9, // reaches candidate index 8
    })
    assert.equal(resContained.ok, true)
    assert.equal(resContained.executionLedger.severeCaseOutcome, 'CONTAINED_NOT_DETECTED')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Retryable persisted-response recovery: recovers attempt-1 from raw 503 evidence without redispatch, dispatches attempt-2 once', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const requestHash = tokenManifest.records[0].requestHash

  const cDir = path.join(testExecutionDir, firstCandidate.candidateId)
  await mkdir(cDir, { recursive: true })

  const statePath = path.join(cDir, 'candidate-state.json')
  const rawPath1 = path.join(cDir, 'attempt-1.raw.json')
  const attemptPath1 = path.join(cDir, 'attempt-1.json')
  const rawPath2 = path.join(cDir, 'attempt-2.raw.json')
  const attemptPath2 = path.join(cDir, 'attempt-2.json')

  // Setup: candidate state indicates a dispatched/persisted attempt 1
  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.DISPATCH_STARTED,
    currentAttempt: 1,
    requestHash,
    startedAt: new Date().toISOString(),
    dispatchedAt: new Date().toISOString(),
  })

  // attempt-1.raw.json exists with retryable HTTP_503_SERVICE_UNAVAILABLE
  const raw503Text = JSON.stringify({ error: { code: 503, message: 'Service Unavailable' } })
  const rawEvidence1 = {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    httpStatus: 503,
    status: 503,
    ok: false,
    rawResponseText: raw503Text,
    rawResponseHash: `sha256:${createHash('sha256').update(raw503Text).digest('hex')}`,
    transportError: null,
    error: null,
    dispatchedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  }
  await atomicWriteJson(rawPath1, rawEvidence1)
  const raw1ContentBefore = await readFile(rawPath1, 'utf8')

  // attempt-1.json is absent
  assert.equal(existsSync(attemptPath1), false)

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  let resumeFetchCalls = 0
  let fetchDispatchedAttempt = null
  const mockFetch = async () => {
    resumeFetchCalls++
    const candidateStateDuringFetch = JSON.parse(await readFile(statePath, 'utf8'))
    fetchDispatchedAttempt = candidateStateDuringFetch.currentAttempt
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
        usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thinkingTokenCount: 400 },
      }),
    }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    // Assert exactly:
    // - resume-time fetch calls = 1
    assert.equal(resumeFetchCalls, 1, 'Resume-time fetch calls must equal exactly 1')
    // - new call is attempt 2
    assert.equal(fetchDispatchedAttempt, 2, 'New call must be attempt 2')
    // - attempt-1.raw.json remains unchanged
    const raw1ContentAfter = await readFile(rawPath1, 'utf8')
    assert.equal(raw1ContentAfter, raw1ContentBefore, 'attempt-1.raw.json must remain byte-identical')
    // - attempt-1.json derived from raw evidence
    assert.ok(existsSync(attemptPath1), 'attempt-1.json must be derived from raw evidence')
    const derived1 = JSON.parse(await readFile(attemptPath1, 'utf8'))
    assert.equal(derived1.attemptDisposition, 'HTTP_503_SERVICE_UNAVAILABLE')
    assert.equal(derived1.transportRetryable, true)
    // - attempt 2 artifacts created
    assert.ok(existsSync(rawPath2), 'attempt-2.raw.json must exist')
    assert.ok(existsSync(attemptPath2), 'attempt-2.json must exist')
    // - primaryCalls = 1, technicalRetries = 1, totalExternalCalls = 2
    assert.equal(res.executionLedger.callAccounting.primaryCalls, 1, 'primaryCalls must equal 1')
    assert.equal(res.executionLedger.callAccounting.technicalRetries, 1, 'technicalRetries must equal 1')
    assert.equal(res.executionLedger.callAccounting.totalExternalCalls, 2, 'totalExternalCalls must equal 2')
    // - final candidate state = COMPLETED, final disposition equals mocked attempt-2 result
    const finalState = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(finalState.state, CANDIDATE_STATES.COMPLETED)
    assert.equal(finalState.finalDisposition, 'VALID_HIGH_RISK')
    assert.equal(res.executionLedger.candidateDispositions[firstCandidate.candidateId], 'VALID_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Raw-only cost reconstruction before next dispatch: derives exact callCostUsd from usageMetadata and checks affordability after incorporation', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))
  const requestHash = tokenManifest.records[0].requestHash

  // Case 1: Usable usageMetadata produces exact non-fallback cost and allows retry dispatch
  const cDir = path.join(testExecutionDir, firstCandidate.candidateId)
  await mkdir(cDir, { recursive: true })

  const statePath = path.join(cDir, 'candidate-state.json')
  const rawPath1 = path.join(cDir, 'attempt-1.raw.json')
  const attemptPath1 = path.join(cDir, 'attempt-1.json')

  // usageMetadata: promptTokenCount: 3000, candidatesTokenCount: 200, thinkingTokenCount: 600
  // input cost: (3000 / 1e6) * 0.75 = 0.00225
  // output cost: ((200 + 600) / 1e6) * 3.75 = 0.00300
  // totalCost: 0.00525 (distinct from fallback 0.0025)
  const expectedAttempt1Cost = 0.00525
  const rawResponseWithUsage = JSON.stringify({
    candidates: [],
    usageMetadata: {
      promptTokenCount: 3000,
      candidatesTokenCount: 200,
      thinkingTokenCount: 600,
    },
  })

  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.DISPATCH_STARTED,
    currentAttempt: 1,
    requestHash,
    startedAt: new Date().toISOString(),
    dispatchedAt: new Date().toISOString(),
  })

  await atomicWriteJson(rawPath1, {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    httpStatus: 503,
    status: 503,
    ok: false,
    rawResponseText: rawResponseWithUsage,
    rawResponseHash: `sha256:${createHash('sha256').update(rawResponseWithUsage).digest('hex')}`,
    transportError: null,
    error: null,
    dispatchedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  })

  // attempt-1.json is absent before resume
  assert.equal(existsSync(attemptPath1), false)

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  // Attempt 2 usage: prompt 2000, output 100, thinking 300
  // input cost: (2000 / 1e6) * 0.75 = 0.0015
  // output cost: ((100 + 300) / 1e6) * 3.75 = 0.0015
  // totalCost: 0.003
  const expectedAttempt2Cost = 0.003

  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
        usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100, thinkingTokenCount: 300 },
      }),
    }
  }

  try {
    const res = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(res.ok, true)
    assert.equal(fetchCalled, true)

    // Verify derived attempt-1.json has exact reconstructed cost
    assert.ok(existsSync(attemptPath1))
    const derived1 = JSON.parse(await readFile(attemptPath1, 'utf8'))
    assert.equal(derived1.callCostUsd, expectedAttempt1Cost)
    assert.notEqual(derived1.callCostUsd, 0.0025, 'Must not substitute fallback cost when usageMetadata is present')

    // Verify accumulatedCostUsd includes exact attempt 1 cost + attempt 2 cost
    const expectedTotalCost = expectedAttempt1Cost + expectedAttempt2Cost
    assert.equal(
      Math.abs(res.executionLedger.callAccounting.accumulatedCostUsd - expectedTotalCost) < 1e-9,
      true,
      `accumulatedCostUsd must equal ${expectedTotalCost}, got ${res.executionLedger.callAccounting.accumulatedCostUsd}`
    )
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }

  // Case 2: Reconstructed cost from raw usageMetadata pushes accumulated cost past ceiling; retry dispatch must block
  await mkdir(cDir, { recursive: true })
  const calibratedTokens = tokenManifest.records[0].countedInputTokens
  // Output + thinking tokens produce high cost without triggering prompt drift (>5% on prompt tokens)
  // Input: (calibratedTokens / 1e6) * 0.75 = $0.00150525
  // Output: (288,000 / 1e6) * 3.75 = $1.08000000
  // Total: ~$1.08150525 + $0.026100 (reserve) = $1.10760525 > $1.10
  const expectedHighCost = (calibratedTokens / 1e6 * 0.75) + (288_000 / 1e6 * 3.75)
  const highRawResponse = JSON.stringify({
    candidates: [],
    usageMetadata: {
      promptTokenCount: calibratedTokens,
      candidatesTokenCount: 2000,
      thinkingTokenCount: 286_000,
    },
  })

  await atomicWriteJson(statePath, {
    candidateId: firstCandidate.candidateId,
    state: CANDIDATE_STATES.DISPATCH_STARTED,
    currentAttempt: 1,
    requestHash,
    startedAt: new Date().toISOString(),
    dispatchedAt: new Date().toISOString(),
  })

  await atomicWriteJson(rawPath1, {
    rawVersion: 'v1.3',
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    requestHash,
    httpStatus: 503,
    status: 503,
    ok: false,
    rawResponseText: highRawResponse,
    rawResponseHash: `sha256:${createHash('sha256').update(highRawResponse).digest('hex')}`,
    transportError: null,
    error: null,
    dispatchedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  })

  let blockedFetchCalled = false
  const blockedMockFetch = async () => {
    blockedFetchCalled = true
  }

  try {
    const resBlocked = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: blockedMockFetch,
      executionDir: testExecutionDir,
      maxCandidates: 1,
    })

    assert.equal(resBlocked.executionLedger.status, 'STOPPED')
    assert.equal(resBlocked.executionLedger.stoppedReason, 'STOP_IF_COST_EXCEEDS_CEILING')
    assert.equal(blockedFetchCalled, false, 'Pre-dispatch affordability check must block retry before dispatch')
    assert.ok(
      Math.abs(resBlocked.executionLedger.callAccounting.accumulatedCostUsd - expectedHighCost) < 1e-9,
      'Reconstructed high cost must be in accumulatedCostUsd'
    )
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Pre-dispatch reserve authority: actual production path blocks when accumulatedCost + 0.026100 > 1.10 and permits when <= 1.10', async () => {
  const cohort = JSON.parse(await readFile(COHORT_MANIFEST_PATH, 'utf8'))
  const firstCandidate = cohort.records[0]
  const secondCandidate = cohort.records[1]
  const tokenManifest = JSON.parse(await readFile(TOKEN_MANIFEST_PATH, 'utf8'))

  const c1Dir = path.join(testExecutionDir, firstCandidate.candidateId)
  const c2Dir = path.join(testExecutionDir, secondCandidate.candidateId)

  const validHighRiskText = JSON.stringify({
    riskLevel: 'HIGH_RISK',
    riskCategories: ['MATERIAL_FACTUAL_CONFLICT'],
    issues: [
      {
        category: 'MATERIAL_FACTUAL_CONFLICT',
        field: 'description',
        claimSpan: 'runtime 120m',
        normalizedClaim: 'Runtime 120m',
        claimType: 'QUANTITATIVE_CLAIM',
        checkedAuthoritySources: ['facts.runtimeMinutes'],
        sourceEvidence: [{ source: 'facts.runtimeMinutes', value: 90, conflictingValue: 120, supportFound: false }],
        authorityResolution: 'CONTRADICTED_BY_AUTHORITY',
        materialityRationale: 'Contradiction.',
      },
    ],
    sourceBoundarySatisfied: false,
    lowRiskCoverage: null,
  })

  // Case A: Boundary Blocked
  // accumulatedCost = $1.073901 + reserve $0.026100 = $1.100001 > $1.10 => BLOCKED
  await mkdir(c1Dir, { recursive: true })
  await atomicWriteJson(path.join(c1Dir, 'candidate-state.json'), {
    candidateId: firstCandidate.candidateId,
    tmdbId: firstCandidate.tmdbId,
    state: CANDIDATE_STATES.COMPLETED,
    finalDisposition: 'VALID_HIGH_RISK',
    currentAttempt: 1,
    completedAt: new Date().toISOString(),
  })
  await atomicWriteJson(path.join(c1Dir, 'attempt-1.json'), {
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    attemptDisposition: 'VALID_HIGH_RISK',
    callCostUsd: 1.073901,
  })

  let fetchCalledA = false
  const mockFetchA = async () => {
    fetchCalledA = true
  }

  try {
    const resA = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetchA,
      executionDir: testExecutionDir,
      maxCandidates: 2,
    })

    assert.equal(resA.executionLedger.status, 'STOPPED')
    assert.equal(resA.executionLedger.stoppedReason, 'STOP_IF_COST_EXCEEDS_CEILING')
    assert.equal(fetchCalledA, false, 'Production path must block before dispatching candidate 2')
    assert.ok(Math.abs(resA.executionLedger.callAccounting.accumulatedCostUsd - 1.073901) < 1e-9)
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }

  // Case B: Boundary Permitted
  // accumulatedCost = $1.073900 + reserve $0.026100 = $1.100000 <= $1.10 => PERMITTED
  await mkdir(c1Dir, { recursive: true })
  await atomicWriteJson(path.join(c1Dir, 'candidate-state.json'), {
    candidateId: firstCandidate.candidateId,
    tmdbId: firstCandidate.tmdbId,
    state: CANDIDATE_STATES.COMPLETED,
    finalDisposition: 'VALID_HIGH_RISK',
    currentAttempt: 1,
    completedAt: new Date().toISOString(),
  })
  await atomicWriteJson(path.join(c1Dir, 'attempt-1.json'), {
    candidateId: firstCandidate.candidateId,
    attemptIndex: 1,
    attemptDisposition: 'VALID_HIGH_RISK',
    callCostUsd: 1.073900,
  })

  let fetchCalledB = false
  const mockFetchB = async () => {
    fetchCalledB = true
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: validHighRiskText }] } }],
        usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100, thinkingTokenCount: 300 },
      }),
    }
  }

  try {
    const resB = await runVerifierV13RetrospectiveReplay({
      env: {
        VERIFIER_V13_REPLAY_AUTHORIZATION: VERIFIER_V13_REPLAY_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'mock-key',
      },
      fetchImpl: mockFetchB,
      executionDir: testExecutionDir,
      maxCandidates: 2,
    })

    assert.equal(resB.ok, true)
    assert.equal(fetchCalledB, true, 'Production path must permit dispatch of candidate 2 when sum <= 1.10')
    assert.equal(resB.executionLedger.candidateDispositions[secondCandidate.candidateId], 'VALID_HIGH_RISK')
  } finally {
    try {
      await rm(testExecutionDir, { recursive: true, force: true })
    } catch {}
  }
})
