import { describe, expect, it } from 'vitest'
import { canonicalize } from './c1bV2Stage0.mjs'
import { buildV3Stage1ClosureRecord, verifyV3Stage1Closure } from './c1bV3Stage1Closure.mjs'

describe('C1b-V3 Stage 1F offline forensic closure', () => {
  it('verifies the immutable live run and reproduces the deterministic registry', async () => {
    const verified = await verifyV3Stage1Closure({ root: process.cwd() })
    expect(verified).toMatchObject({ walRecordCount: 1626, walAttemptCount: 542, lifecycleCounts: { INTENT: 542, RESPONSE: 542, TERMINAL: 542 }, page1RequestCount: 45, page2RequestCount: 497, totalRequiredPages: 542, candidateQuotaCounts: { '1980-1989': 24, '1990-1999': 24, '2000-2009': 33, '2010-2019': 45, '2020-2024': 54 } })
    expect(Object.values(verified.checks).every(Boolean)).toBe(true)
    const first = buildV3Stage1ClosureRecord(verified)
    expect(canonicalize(first)).toBe(canonicalize(buildV3Stage1ClosureRecord(verified)))
    expect(first).toMatchObject({ sourceSnapshotHash: 'sha256:9422ffa827f2e1d4f18e2fa8550302af0da28bfb9915b9eb67d81512a2e1b7d9', finalCandidateCount: 180, networkCallsDuringClosure: 0 })
  })
})
