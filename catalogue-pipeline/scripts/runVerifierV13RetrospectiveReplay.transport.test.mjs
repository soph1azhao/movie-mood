import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldRetryError,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
  FROZEN_CALL_LIMITS,
} from './runVerifierV13RetrospectiveReplay.mjs'

test('Transport retryable error codes match authorized set', () => {
  const authorized = [
    'HTTP_429',
    'HTTP_429_RATE_LIMIT',
    'HTTP_500',
    'HTTP_500_SERVER_ERROR',
    'HTTP_503',
    'HTTP_503_SERVICE_UNAVAILABLE',
    'NETWORK_TIMEOUT',
    'CONNECTION_RESET',
    'MALFORMED_JSON',
    'MALFORMED_JSON_STRING',
  ]

  for (const code of authorized) {
    assert.ok(RETRYABLE_ERROR_CODES.has(code), `Code ${code} must be retryable`)
    assert.equal(
      shouldRetryError({
        errorCode: code,
        candidateRetries: 0,
        batchRetries: 0,
        totalCalls: 1,
      }),
      true,
      `Code ${code} should permit retry when budgets are available`
    )
  }
})

test('Non-retryable error codes match protocol specifications', () => {
  const nonRetryable = [
    'HTTP_502',
    'HTTP_502_BAD_GATEWAY',
    'HTTP_504',
    'HTTP_504_GATEWAY_TIMEOUT',
    'NETWORK_ERROR',
    'SCHEMA_INVALID',
    'SEMANTICALLY_INVALID',
    'VALID_LOW_RISK_ON_DEFECT',
    'VALID_HIGH_RISK_ON_CLEAN',
  ]

  for (const code of nonRetryable) {
    assert.ok(NON_RETRYABLE_ERROR_CODES.has(code), `Code ${code} must be non-retryable`)
    assert.equal(
      shouldRetryError({
        errorCode: code,
        candidateRetries: 0,
        batchRetries: 0,
        totalCalls: 1,
      }),
      false,
      `Code ${code} must never be retried`
    )
  }
})

test('Retry budgets: candidate limit (2), batch limit (10), and total cap (40)', () => {
  // Candidate retry exhausted
  assert.equal(
    shouldRetryError({
      errorCode: 'HTTP_503',
      candidateRetries: 2, // limit is 2
      batchRetries: 0,
      totalCalls: 5,
    }),
    false,
    'Candidate retries exhausted must block retry'
  )

  // Batch retry exhausted
  assert.equal(
    shouldRetryError({
      errorCode: 'HTTP_503',
      candidateRetries: 0,
      batchRetries: 10, // limit is 10
      totalCalls: 20,
    }),
    false,
    'Batch retries exhausted must block retry'
  )

  // Total call cap reached
  assert.equal(
    shouldRetryError({
      errorCode: 'HTTP_503',
      candidateRetries: 0,
      batchRetries: 0,
      totalCalls: 40, // limit is 40
    }),
    false,
    'Total call cap reached must block retry'
  )
})
