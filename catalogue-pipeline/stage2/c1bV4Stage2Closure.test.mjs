import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { canonicalSha256 } from '../scripts/c1bV2Stage0.mjs'
import { V4_STAGE2_CLOSURE_PATH, deriveV4Stage2Closure, verifyV4Stage2Closure } from './c1bV4Stage2Closure.mjs'

describe('C1b-V4 Stage-2 forensic closure', () => {
  it('derives and verifies the preserved fail-closed 429 evidence without raw prose', async () => {
    const closure = JSON.parse(await readFile(V4_STAGE2_CLOSURE_PATH, 'utf8'))
    const derived = await deriveV4Stage2Closure()
    expect(verifyV4Stage2Closure({ closure, derived })).toEqual({ ok: true, canonicalSha256: canonicalSha256(closure) })
    expect(closure).toMatchObject({ classification: 'OPERATIONALLY_INCONCLUSIVE', protocolStageStatus: 'BLOCKED — COVERAGE EXECUTION INCOMPLETE', execution: { determinateCandidateCount: 3, viableCount: 0, nonViableCount: 3, coverageResultEmitted: false }, blocker: { candidateTmdbId: 14924, httpStatus: 429, failureCode: 'FETCH_FAILED' }, wal: { recordCount: 33, INTENT: 11, RESPONSE: 11, TERMINAL: 11, completedAttemptCount: 11, unknownInFlightCount: 0 } })
    expect(JSON.stringify(closure)).not.toMatch(/rawMediaWikiSection|"text"|"html"|0\/3 coverage estimate[^\"]*coverage/i)
  })

  it('rejects a closure whose forensic facts do not derive from preserved evidence', async () => {
    const derived = await deriveV4Stage2Closure(); const altered = structuredClone(derived); altered.blocker.httpStatus = 500
    expect(() => verifyV4Stage2Closure({ closure: altered, derived })).toThrowError(expect.objectContaining({ code: 'CLOSURE_DERIVATION_MISMATCH' }))
  })
})
