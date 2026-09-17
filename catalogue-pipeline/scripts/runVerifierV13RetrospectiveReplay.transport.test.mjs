import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldRetryError,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
  FROZEN_CALL_LIMITS,
} from './runVerifierV13RetrospectiveReplay.mjs'

test('Transport retryable error codes match authorized exact set', () => {
  const authorized = [
    'HTTP_429_RATE_LIMIT',
    'HTTP_500_SERVER_ERROR',
    'HTTP_503_SERVICE_UNAVAILABLE',
    'NETWORK_TIMEOUT',
    'CONNECTION_RESET',
    'MALFORMED_JSON_STRING',
  ]

  assert.equal(RETRYABLE_ERROR_CODES.size, authorized.length, 'Exact count of retryable error codes')

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

  // Broadened aliases must NOT be in retryable set
  const unauthorizedAliases = ['HTTP_429', 'HTTP_500', 'HTTP_503', 'TIMEOUT', 'MALFORMED_JSON']
  for (const alias of unauthorizedAliases) {
    assert.ok(!RETRYABLE_ERROR_CODES.has(alias), `Alias ${alias} must not be in retryable set`)
    assert.equal(
      shouldRetryError({
        errorCode: alias,
        candidateRetries: 0,
        batchRetries: 0,
        totalCalls: 1,
      }),
      false,
      `Alias ${alias} must not be retryable`
    )
  }
})

test('Non-retryable error codes match protocol specifications exact set', () => {
  const nonRetryable = [
    'HTTP_502_BAD_GATEWAY',
    'HTTP_504_GATEWAY_TIMEOUT',
    'NETWORK_ERROR',
    'SCHEMA_INVALID',
    'SEMANTICALLY_INVALID',
  ]

  assert.equal(NON_RETRYABLE_ERROR_CODES.size, nonRetryable.length, 'Exact count of non-retryable error codes')

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

  // Broadened aliases must NOT be in non-retryable set
  const unauthorizedAliases = ['HTTP_502', 'HTTP_504']
  for (const alias of unauthorizedAliases) {
    assert.ok(!NON_RETRYABLE_ERROR_CODES.has(alias), `Alias ${alias} must not be in non-retryable set`)
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
