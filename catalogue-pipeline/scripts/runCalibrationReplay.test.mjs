import { describe, expect, it } from 'vitest'
import { assertCalibrationResult, resolveCalibrationModel } from './runCalibrationReplay.mjs'

describe('Phase 5A replay model selection', () => {
  it('uses an explicit environment model without changing classifier logic', () => {
    expect(resolveCalibrationModel({ GEMINI_MODEL: 'gemini-3.6-flash' })).toBe('gemini-3.6-flash')
  })

  it('keeps the compatibility default and rejects unsafe model path input', () => {
    expect(resolveCalibrationModel({})).toBe('gemini-3.7-flash')
    expect(() => resolveCalibrationModel({ GEMINI_MODEL: '../other-model' })).toThrow(/unsupported characters/i)
  })

  it('rejects an absent result instead of treating it as zero calls', () => {
    expect(() => assertCalibrationResult(undefined, 'paddington-2')).toThrow(/missing/i)
    expect(() => assertCalibrationResult({ modelCalls: 0, cacheHit: true, retries: 0, classificationsCompleted: 1 }, 'paddington-2')).toThrow(/providerUsageMetadata/i)
  })
})
