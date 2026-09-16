import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyCalibrationAuthorization,
  runVerifierV13TokenizerCalibration,
  buildCandidateV13GeminiRequest,
  buildVerifierV13ReplayPacket,
  scanForForbiddenKeys,
  atomicWriteJson,
  main,
  CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
  FROZEN_CALIBRATION_TIMEOUT_MS,
  FORBIDDEN_LEAKAGE_KEYS,
  COHORT_MANIFEST_PATH,
  V13_CANDIDATE_PROMPT_PATH,
  V13_CANDIDATE_SCHEMA_PATH,
} from './calibrateVerifierV13Tokens.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testTempCalibrationDir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-token-calibration.tmp')
const testTempManifestPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-tokencounts.tmp.json')

test('1. verifyCalibrationAuthorization fails closed when env variable is missing or wrong', () => {
  const empty = verifyCalibrationAuthorization({ env: {} })
  assert.equal(empty.authorized, false)
  assert.equal(empty.reason, 'CALIBRATION_NOT_AUTHORIZED')

  const wrong = verifyCalibrationAuthorization({ env: { CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: 'WRONG' } })
  assert.equal(wrong.authorized, false)

  const correct = verifyCalibrationAuthorization({ env: { CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN } })
  assert.equal(correct.authorized, true)
})

test('2. runVerifierV13TokenizerCalibration fails closed without network calls if unauthorized', async () => {
  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not be called')
  }

  const res = await runVerifierV13TokenizerCalibration({
    env: {},
    fetchImpl: mockFetch,
    calibrationDir: testTempCalibrationDir,
    tokenManifestPath: testTempManifestPath,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'CALIBRATION_BLOCKED')
  assert.equal(fetchCalled, false)
})

test('3. runVerifierV13TokenizerCalibration fails closed if API key is missing', async () => {
  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not be called')
  }

  const res = await runVerifierV13TokenizerCalibration({
    env: {
      CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
      GEMINI_API_KEY: '',
    },
    fetchImpl: mockFetch,
    calibrationDir: testTempCalibrationDir,
    tokenManifestPath: testTempManifestPath,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'MISSING_API_KEY')
  assert.equal(fetchCalled, false)
})

test('4. CLI entrypoint: wrong or missing subcommand fails closed with 0 calls', async () => {
  const originalArgv = process.argv
  const originalExitCode = process.exitCode

  try {
    process.argv = ['node', 'calibrateVerifierV13Tokens.mjs', 'invalid_subcommand']
    const res = await main()
    assert.equal(res.ok, false)
    assert.equal(res.status, 'INVALID_CLI_COMMAND')
    assert.equal(process.exitCode, 1)

    process.argv = ['node', 'calibrateVerifierV13Tokens.mjs']
    const resNoArg = await main()
    assert.equal(resNoArg.ok, false)
    assert.equal(resNoArg.status, 'INVALID_CLI_COMMAND')
  } finally {
    process.argv = originalArgv
    process.exitCode = originalExitCode
  }
})

test('5. CLI entrypoint: unauthorized invocation fails closed with 0 calls', async () => {
  const originalArgv = process.argv
  const originalEnv = process.env
  const originalExitCode = process.exitCode

  try {
    process.argv = ['node', 'calibrateVerifierV13Tokens.mjs', 'run']
    process.env = { ...originalEnv, CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: '' }
    const res = await main()
    assert.equal(res.ok, false)
    assert.equal(res.status, 'CALIBRATION_BLOCKED')
    assert.equal(process.exitCode, 1)
  } finally {
    process.argv = originalArgv
    process.env = originalEnv
    process.exitCode = originalExitCode
  }
})

export function assertCountTokensProviderContract(requestBody) {
  assert.ok(requestBody && typeof requestBody === 'object', 'CountTokens request body must be an object')
  assert.ok(requestBody.generateContentRequest, 'CountTokens request body must contain generateContentRequest')
  const genReq = requestBody.generateContentRequest
  assert.equal(
    genReq.model,
    'models/gemini-3.8-flash',
    'CountTokensRequest.generate_content_request.model must be specified as models/gemini-3.8-flash'
  )
  assert.ok(Array.isArray(genReq.contents), 'generateContentRequest must contain contents array')
  assert.ok(genReq.systemInstruction, 'generateContentRequest must contain systemInstruction')
  assert.ok(genReq.generationConfig, 'generateContentRequest must contain generationConfig')
}

test('6. Complete calibration run: per-record persistence before next dispatch, manifest correctness, leakage zero', async () => {
  let callsMade = 0
  const interceptedBodies = []
  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)

  const mockFetch = async (url, options) => {
    callsMade += 1
    assert.match(url, /models\/gemini-3.8-flash:countTokens/, 'Must only call countTokens endpoint')
    assert.ok(!url.includes(':generateContent'), 'generateContent must never be called')

    const body = JSON.parse(options.body)
    assertCountTokensProviderContract(body)
    interceptedBodies.push(body)

    // Verification of per-record persistence before subsequent dispatch:
    // If this is call > 1, the previous candidate must already have COMPLETED state on disk
    if (callsMade > 1) {
      const prevCandidateId = cohort.records[callsMade - 2].candidateId
      const prevStatePath = path.join(testTempCalibrationDir, prevCandidateId, 'calibration-state.json')
      const prevRawPath = path.join(testTempCalibrationDir, prevCandidateId, 'raw-count-response.json')
      assert.ok(existsSync(prevStatePath), `Previous candidate ${prevCandidateId} state must exist before next call`)
      assert.ok(existsSync(prevRawPath), `Previous candidate ${prevCandidateId} raw response must exist before next call`)
      const prevState = JSON.parse(await readFile(prevStatePath, 'utf8'))
      assert.equal(prevState.calibrationState, 'COMPLETED')
    }

    // Current candidate state must already be DISPATCH_STARTED on disk
    const currentCandidateId = cohort.records[callsMade - 1].candidateId
    const currentStatePath = path.join(testTempCalibrationDir, currentCandidateId, 'calibration-state.json')
    assert.ok(existsSync(currentStatePath), `Current candidate ${currentCandidateId} state must exist at dispatch`)
    const currentState = JSON.parse(await readFile(currentStatePath, 'utf8'))
    assert.equal(currentState.calibrationState, 'DISPATCH_STARTED')

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ totalTokens: 3200 + callsMade }),
      json: async () => ({ totalTokens: 3200 + callsMade }),
    }
  }

  try {
    const res = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: mockFetch,
      calibrationDir: testTempCalibrationDir,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
    })

    assert.equal(res.ok, true)
    assert.equal(res.status, 'CALIBRATION_COMPLETED')
    assert.equal(res.totalRecords, 30)
    assert.equal(callsMade, 30)

    // Final manifest verified
    assert.ok(existsSync(testTempManifestPath), 'Manifest must be written after all 30 completed')
    const manifest = JSON.parse(await readFile(testTempManifestPath, 'utf8'))
    assert.equal(manifest.totalRecords, 30)
    assert.equal(manifest.records.length, 30)
    assert.equal(manifest.records[0].countedInputTokens, 3201)
    assert.match(manifest.records[0].requestHash, /^sha256:[a-f0-9]{64}$/)

    // Leakage check
    for (const b of interceptedBodies) {
      const leakage = scanForForbiddenKeys(b)
      assert.equal(leakage.length, 0, `Forbidden leakage key detected: ${JSON.stringify(leakage)}`)
    }

    // Safe resume check: running again skips all 30 completed records
    callsMade = 0
    const resumeRes = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: mockFetch,
      calibrationDir: testTempCalibrationDir,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
    })

    assert.equal(resumeRes.ok, true)
    assert.equal(callsMade, 0, 'Safe resume must make zero network calls for already completed records')
    assert.equal(resumeRes.records.every((r) => r.cached === true), true)
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
      await rm(testTempManifestPath, { force: true })
    } catch {}
  }
})

test('7. Interruption recovery: completed records survive and resume continues from interruption point', async () => {
  let callsMade = 0

  const successfulMockFetch = async () => {
    callsMade += 1
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ totalTokens: 3500 }),
      json: async () => ({ totalTokens: 3500 }),
    }
  }

  try {
    // First run completes 2 records, then pauses/interrupts before completing cohort
    const res1 = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: successfulMockFetch,
      calibrationDir: testTempCalibrationDir,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
      maxRecords: 2,
    })

    assert.equal(res1.ok, false)
    assert.equal(res1.status, 'CALIBRATION_INTERRUPTED')
    assert.equal(res1.completedRecords, 2)
    assert.equal(callsMade, 2)

    // Manifest must NOT exist because cohort was interrupted
    assert.equal(existsSync(testTempManifestPath), false, 'Manifest must not be written if cohort interrupted')

    // Second run: resumes. Records 1 and 2 must be skipped (cached), 28 calls remaining
    callsMade = 0
    const resumeRes = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: successfulMockFetch,
      calibrationDir: testTempCalibrationDir,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
    })

    assert.equal(resumeRes.ok, true)
    assert.equal(callsMade, 28, 'Must only call remaining 28 candidates after resume')
    assert.equal(resumeRes.totalRecords, 30)
    assert.ok(existsSync(testTempManifestPath), 'Manifest must be written after all 30 completed')
    const manifest = JSON.parse(await readFile(testTempManifestPath, 'utf8'))
    assert.equal(manifest.records.length, 30)
    assert.equal(manifest.records[0].cached, true)
    assert.equal(manifest.records[1].cached, true)
    assert.equal(manifest.records[2].cached, false)
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
      await rm(testTempManifestPath, { force: true })
    } catch {}
  }
})

test('8. Ambiguous DISPATCH_STARTED state halts closed and refuses redispatch', async () => {
  try {
    const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
    const cohort = JSON.parse(cohortRaw)
    const firstCandidateId = cohort.records[0].candidateId

    await mkdir(path.join(testTempCalibrationDir, firstCandidateId), { recursive: true })
    const stateFile = path.join(testTempCalibrationDir, firstCandidateId, 'calibration-state.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        candidateId: firstCandidateId,
        calibrationState: 'DISPATCH_STARTED', // Ambiguous dispatch without raw response!
      })
    )

    let fetchCalled = false
    const mockFetch = async () => {
      fetchCalled = true
      return { ok: true, text: async () => JSON.stringify({ totalTokens: 100 }) }
    }

    await assert.rejects(
      async () => {
        await runVerifierV13TokenizerCalibration({
          env: {
            CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
            GEMINI_API_KEY: 'test-key-mock',
          },
          fetchImpl: mockFetch,
          calibrationDir: testTempCalibrationDir,
          tokenManifestPath: testTempManifestPath,
          repoRoot,
        })
      },
      (err) => {
        assert.equal(err.code, 'STOP_AMBIGUOUS_DISPATCH_STATE')
        return true
      }
    )

    assert.equal(fetchCalled, false, 'Must never redispatch on ambiguous dispatch state')
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('9. requestHash mismatch halts closed with STOP_IF_CALIBRATED_HASH_MISMATCH', async () => {
  try {
    const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
    const cohort = JSON.parse(cohortRaw)
    const firstCandidateId = cohort.records[0].candidateId

    await mkdir(path.join(testTempCalibrationDir, firstCandidateId), { recursive: true })
    const stateFile = path.join(testTempCalibrationDir, firstCandidateId, 'calibration-state.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        candidateId: firstCandidateId,
        requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', // Stale mismatching hash!
        calibrationState: 'COMPLETED',
        countedInputTokens: 3000,
      })
    )

    let fetchCalled = false
    const mockFetch = async () => {
      fetchCalled = true
      return { ok: true, text: async () => JSON.stringify({ totalTokens: 100 }) }
    }

    await assert.rejects(
      async () => {
        await runVerifierV13TokenizerCalibration({
          env: {
            CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
            GEMINI_API_KEY: 'test-key-mock',
          },
          fetchImpl: mockFetch,
          calibrationDir: testTempCalibrationDir,
          tokenManifestPath: testTempManifestPath,
          repoRoot,
        })
      },
      (err) => {
        assert.equal(err.code, 'STOP_IF_CALIBRATED_HASH_MISMATCH')
        return true
      }
    )

    assert.equal(fetchCalled, false, 'Must never silently recalibrate under hash mismatch')
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('10. Missing totalTokens or malformed countTokens response fails closed', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ wrongField: 123 }), // Missing totalTokens!
  })

  try {
    await assert.rejects(
      async () => {
        await runVerifierV13TokenizerCalibration({
          env: {
            CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
            GEMINI_API_KEY: 'test-key-mock',
          },
          fetchImpl: mockFetch,
          calibrationDir: testTempCalibrationDir,
          tokenManifestPath: testTempManifestPath,
          repoRoot,
        })
      },
      (err) => {
        assert.equal(err.code, 'INVALID_COUNT_TOKENS_RESPONSE')
        return true
      }
    )
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('11. Timeout behavior triggers post-dispatch STOP_CALIBRATION_TIMEOUT', async () => {
  const mockFetch = async (url, options) => {
    // Simulate slow network exceeding timeout
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }

  try {
    await assert.rejects(
      async () => {
        await runVerifierV13TokenizerCalibration({
          env: {
            CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
            GEMINI_API_KEY: 'test-key-mock',
          },
          fetchImpl: mockFetch,
          calibrationDir: testTempCalibrationDir,
          tokenManifestPath: testTempManifestPath,
          timeoutMs: 50, // 50ms fast timeout
          repoRoot,
        })
      },
      (err) => {
        assert.equal(err.code, 'STOP_CALIBRATION_TIMEOUT')
        return true
      }
    )
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('12. atomicWriteJson refuses accidental overwrite when refuseOverwrite: true', async () => {
  const testFile = path.join(testTempCalibrationDir, 'atomic-test.json')
  try {
    await atomicWriteJson(testFile, { test: 1 })
    assert.ok(existsSync(testFile))

    // Second write with refuseOverwrite should reject
    await assert.rejects(
      async () => {
        await atomicWriteJson(testFile, { test: 2 }, { refuseOverwrite: true })
      },
      (err) => {
        assert.equal(err.code, 'REFUSE_OVERWRITE')
        return true
      }
    )
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('13. Corrupt or partial artifact fails closed', async () => {
  try {
    const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
    const cohort = JSON.parse(cohortRaw)
    const firstCandidateId = cohort.records[0].candidateId

    await mkdir(path.join(testTempCalibrationDir, firstCandidateId), { recursive: true })
    const stateFile = path.join(testTempCalibrationDir, firstCandidateId, 'calibration-state.json')
    // Corrupt JSON syntax on disk
    await writeFile(stateFile, '{"candidateId": "incomplete-broken-json...')

    const mockFetch = async () => ({ ok: true, text: async () => JSON.stringify({ totalTokens: 100 }) })

    await assert.rejects(
      async () => {
        await runVerifierV13TokenizerCalibration({
          env: {
            CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
            GEMINI_API_KEY: 'test-key-mock',
          },
          fetchImpl: mockFetch,
          calibrationDir: testTempCalibrationDir,
          tokenManifestPath: testTempManifestPath,
          repoRoot,
        })
      },
      SyntaxError
    )
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
    } catch {}
  }
})

test('14. Final manifest is deterministic across independent runs with identical inputs', async () => {
  const frozenIso = '2026-09-16T12:00:00.000Z'
  const dir1 = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/det-calib-1.tmp')
  const dir2 = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/det-calib-2.tmp')
  const manifest1 = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/det-manifest-1.tmp.json')
  const manifest2 = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/det-manifest-2.tmp.json')

  const deterministicMockFetch = async (url, options) => {
    const body = JSON.parse(options.body)
    // Deterministic token count based on contents length
    const len = JSON.stringify(body).length
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ totalTokens: 3000 + (len % 500) }),
    }
  }

  try {
    const res1 = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: deterministicMockFetch,
      calibrationDir: dir1,
      tokenManifestPath: manifest1,
      nowIso: frozenIso,
      repoRoot,
    })
    assert.equal(res1.ok, true)

    const res2 = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: deterministicMockFetch,
      calibrationDir: dir2,
      tokenManifestPath: manifest2,
      nowIso: frozenIso,
      repoRoot,
    })
    assert.equal(res2.ok, true)

    const content1 = await readFile(manifest1, 'utf8')
    const content2 = await readFile(manifest2, 'utf8')
    assert.equal(content1, content2, 'Manifest output must be byte-for-byte deterministic')
  } finally {
    try {
      await rm(dir1, { recursive: true, force: true })
      await rm(dir2, { recursive: true, force: true })
      await rm(manifest1, { force: true })
      await rm(manifest2, { force: true })
    } catch {}
  }
})

test('15. Cross-runner request-hash parity: 30/30 canonical requests and requestHash values identical across calibration and replay runners', async () => {
  const replay = await import('./runVerifierV13RetrospectiveReplay.mjs')

  const cohortRaw = await readFile(COHORT_MANIFEST_PATH, 'utf8')
  const cohort = JSON.parse(cohortRaw)
  assert.equal(cohort.records.length, 30, 'Cohort must contain exactly 30 records')

  const promptText = await readFile(V13_CANDIDATE_PROMPT_PATH, 'utf8')
  const schemaRaw = await readFile(V13_CANDIDATE_SCHEMA_PATH, 'utf8')
  const schema = JSON.parse(schemaRaw)

  let parityCount = 0

  for (const item of cohort.records) {
    const fullInputPath = path.isAbsolute(item.sourceRiskInputPath)
      ? item.sourceRiskInputPath
      : path.join(repoRoot, item.sourceRiskInputPath)

    const riskInputRaw = await readFile(fullInputPath, 'utf8')
    const riskInput = JSON.parse(riskInputRaw)

    const packetCalib = buildVerifierV13ReplayPacket(riskInput)
    const packetReplay = replay.buildVerifierV13ReplayPacket(riskInput)
    assert.deepEqual(packetCalib, packetReplay, `Packet mismatch for ${item.candidateId}`)

    const reqCalib = buildCandidateV13GeminiRequest({
      promptText,
      packet: packetCalib,
      schema,
    })

    const reqReplay = replay.buildCandidateV13GeminiRequest({
      promptText,
      packet: packetReplay,
      schema,
    })

    assert.deepEqual(reqCalib.body, reqReplay.body, `Request body mismatch for ${item.candidateId}`)
    assert.equal(reqCalib.endpoint, reqReplay.endpoint, `Endpoint mismatch for ${item.candidateId}`)
    assert.deepEqual(reqCalib.requestMetadata, reqReplay.requestMetadata, `Metadata mismatch for ${item.candidateId}`)

    assert.equal(
      reqCalib.requestMetadata.requestHash,
      reqReplay.requestMetadata.requestHash,
      `requestHash mismatch for ${item.candidateId}`
    )
    assert.match(reqCalib.requestMetadata.requestHash, /^sha256:[a-f0-9]{64}$/)
    parityCount += 1
  }

  assert.equal(parityCount, 30, 'All 30 cohort records must match exactly across calibration and replay runners')
})

test('16. Provider contract mock enforces model in generateContentRequest and fails closed if omitted', async () => {
  // 1. Direct negative assertion: omission of model fails contract check
  const invalidBodyWithoutModel = {
    generateContentRequest: {
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      systemInstruction: { parts: [{ text: 'prompt' }] },
      generationConfig: { temperature: 0 },
    },
  }

  assert.throws(
    () => assertCountTokensProviderContract(invalidBodyWithoutModel),
    /CountTokensRequest\.generate_content_request\.model must be specified/
  )

  // 2. Mock fetch simulating live Google API contract (rejects HTTP 400 when model is missing)
  const strictGoogleApiMockFetch = async (url, options) => {
    const body = JSON.parse(options.body)
    if (!body?.generateContentRequest?.model) {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              code: 400,
              message: '* CountTokensRequest.generate_content_request.model: model is not specified\n',
              status: 'INVALID_ARGUMENT',
            },
          }),
      }
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ totalTokens: 3200 }),
    }
  }

  // The corrected runner must satisfy the strict Google API mock
  try {
    const res = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-mock',
      },
      fetchImpl: strictGoogleApiMockFetch,
      calibrationDir: testTempCalibrationDir,
      tokenManifestPath: testTempManifestPath,
      maxRecords: 1,
      repoRoot,
    })

    assert.equal(res.ok, false)
    assert.equal(res.status, 'CALIBRATION_INTERRUPTED')
    assert.equal(res.completedRecords, 1)

    // Verify candidate state on disk is COMPLETED, not HTTP_ERROR_TERMINAL
    const candidateDir = path.join(testTempCalibrationDir, 'scale500-tmdb-2604')
    const state = JSON.parse(await readFile(path.join(candidateDir, 'calibration-state.json'), 'utf8'))
    assert.equal(state.calibrationState, 'COMPLETED')
    assert.equal(state.countedInputTokens, 3200)
  } finally {
    try {
      await rm(testTempCalibrationDir, { recursive: true, force: true })
      await rm(testTempManifestPath, { force: true })
    } catch {}
  }
})
