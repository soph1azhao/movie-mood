import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { canonicalSha256 } from './c1bV2Stage0.mjs'
import { CLOSURE_PATH } from './closeKimiAdaptiveScale50.mjs'

describe('adaptive Kimi Scale-50 closure', () => {
  it('freezes the completed operational outcome with explicitly incomplete provider-usage accounting', async () => {
    const closure = JSON.parse(await readFile(CLOSURE_PATH, 'utf8')); const { closureCanonicalSha256, ...body } = closure
    expect(closureCanonicalSha256).toBe(canonicalSha256(body))
    expect(closure).toMatchObject({
      status: 'CLOSED',
      outcome: { candidateCount: 50, completedValid: 50, unresolved: 0, originalHighFirstPassValid: 47, highFirstPassValidityRate: 0.94, highSemanticValidationFailures: 2, maxEscalations: 2, maxRecoveries: 2, maxRecoveryRate: 1, manualUncertainRedispatches: 1, transportUnknownEvents: 1, unresolvedTransportUnknown: 0, totalHttpRequests: 53, requestsPerCompletedFilm: 1.06, meanBoundaryFlagsPerValidFilm: 1.94 },
      usageAccounting: { knownObservedTokens: 374105, unrecoveredUsageDispatches: 1, actualProviderTokenConsumptionFullyKnown: false },
      recovery: { candidateId: 'exp100-tmdb-1071806', originalOutcome: 'TRANSPORT_OUTCOME_UNKNOWN', authorizationEvent: 'MANUAL_REDISPATCH_AUTHORIZED', highSemanticAttempts: 2, finalStatus: 'HIGH_VALID' },
      externalCallsDuringClosure: { kimi: 0, gemini: 0, tmdb: 0, wikipedia: 0 },
    })
  })
})
