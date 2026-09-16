import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyCalibrationAuthorization,
  runVerifierV13TokenizerCalibration,
  buildCandidateV13GeminiRequest,
  buildVerifierV13ReplayPacket,
  scanForForbiddenKeys,
  CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
  FORBIDDEN_LEAKAGE_KEYS,
} from './calibrateVerifierV13Tokens.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testTempManifestPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/test-tokencounts.tmp.json')

test('verifyCalibrationAuthorization fails closed when env variable is missing or wrong', () => {
  const empty = verifyCalibrationAuthorization({ env: {} })
  assert.equal(empty.authorized, false)
  assert.equal(empty.reason, 'CALIBRATION_NOT_AUTHORIZED')

  const wrong = verifyCalibrationAuthorization({ env: { CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: 'WRONG' } })
  assert.equal(wrong.authorized, false)

  const correct = verifyCalibrationAuthorization({ env: { CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN } })
  assert.equal(correct.authorized, true)
})

test('runVerifierV13TokenizerCalibration fails closed without network calls if unauthorized', async () => {
  let fetchCalled = false
  const mockFetch = async () => {
    fetchCalled = true
    throw new Error('Should not be called')
  }

  const res = await runVerifierV13TokenizerCalibration({
    env: {},
    fetchImpl: mockFetch,
    tokenManifestPath: testTempManifestPath,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'CALIBRATION_BLOCKED')
  assert.equal(fetchCalled, false)
})

test('runVerifierV13TokenizerCalibration fails closed if API key is missing', async () => {
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
    tokenManifestPath: testTempManifestPath,
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'MISSING_API_KEY')
  assert.equal(fetchCalled, false)
})

test('runVerifierV13TokenizerCalibration successfully executes mock countTokens and creates manifest', async () => {
  let callsMade = 0
  const interceptedBodies = []

  const mockFetch = async (url, options) => {
    callsMade += 1
    assert.match(url, /models\/gemini-3.8-flash:countTokens/)
    const body = JSON.parse(options.body)
    interceptedBodies.push(body)
    return {
      ok: true,
      json: async () => ({ totalTokens: 3450 }),
    }
  }

  try {
    const res = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-not-real',
      },
      fetchImpl: mockFetch,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
    })

    assert.equal(res.ok, true)
    assert.equal(res.status, 'CALIBRATION_COMPLETED')
    assert.equal(res.totalRecords, 30)
    assert.equal(callsMade, 30)

    // Verify manifest was written
    const manifest = JSON.parse(await readFile(testTempManifestPath, 'utf8'))
    assert.equal(manifest.totalRecords, 30)
    assert.equal(manifest.records.length, 30)
    assert.equal(manifest.records[0].countedInputTokens, 3450)
    assert.match(manifest.records[0].requestHash, /^sha256:[a-f0-9]{64}$/)

    // Leakage check: inspect all intercepted countTokens bodies for forbidden keys
    for (const b of interceptedBodies) {
      const leakage = scanForForbiddenKeys(b)
      assert.equal(leakage.length, 0, `Forbidden leakage key detected: ${JSON.stringify(leakage)}`)
    }

    // Test resume behavior: running again with existing manifest should make 0 calls
    callsMade = 0
    const resumeRes = await runVerifierV13TokenizerCalibration({
      env: {
        CALIBRATE_VERIFIER_V13_TOKENS_AUTHORIZATION: CALIBRATE_V13_TOKENS_AUTHORIZATION_TOKEN,
        GEMINI_API_KEY: 'test-key-not-real',
      },
      fetchImpl: mockFetch,
      tokenManifestPath: testTempManifestPath,
      repoRoot,
    })

    assert.equal(resumeRes.ok, true)
    assert.equal(callsMade, 0, 'Safe resume should not make network calls for cached entries')
    assert.equal(resumeRes.records.every((r) => r.cached === true), true)
  } finally {
    try {
      await rm(testTempManifestPath, { force: true })
    } catch {}
  }
})
