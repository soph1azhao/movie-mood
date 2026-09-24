import { describe, expect, it } from 'vitest'
import { assertCalibrationResult, resolveCalibrationModel, resolveKimiModel, resolveReplayStorage, resolveSemanticProvider } from './runCalibrationReplay.mjs'

describe('Phase 5A replay model selection', () => {
  it('uses an explicit environment model without changing classifier logic', () => {
    expect(resolveCalibrationModel({ GEMINI_MODEL: 'gemini-3.5-flash' })).toBe('gemini-3.5-flash')
    expect(resolveCalibrationModel({ GEMINI_MODEL: 'gemini-3.6-flash' })).toBe('gemini-3.6-flash')
  })

  it('keeps the compatibility default and rejects unsafe model path input', () => {
    expect(resolveCalibrationModel({})).toBe('gemini-3.7-flash')
    expect(() => resolveCalibrationModel({ GEMINI_MODEL: '../other-model' })).toThrow(/unsupported characters/i)
  })

  it('selects Kimi explicitly while leaving Gemini as the compatibility default', () => {
    expect(resolveSemanticProvider({})).toBe('gemini')
    expect(resolveSemanticProvider({ SEMANTIC_PROVIDER: 'kimi' })).toBe('kimi')
    expect(resolveKimiModel({ KIMI_MODEL: 'k3-256k' })).toBe('k3-256k')
    expect(resolveKimiModel({ KIMI_MODEL: 'kimi-for-coding' })).toBe('kimi-for-coding')
    expect(resolveKimiModel({})).toBe('k3-256k')
    expect(() => resolveSemanticProvider({ SEMANTIC_PROVIDER: 'unknown' })).toThrow(/gemini or kimi/i)
    expect(() => resolveKimiModel({ KIMI_MODEL: '../k3' })).toThrow(/unsupported characters/i)
    expect(() => resolveKimiModel({ KIMI_MODEL: 'k2.7' })).toThrow(/Unsupported KIMI_MODEL/i)
  })

  it('keeps Kimi replay artifacts separate from Gemini artifacts', () => {
    const replay = { outputNamespace: 'diagnostics/phase-5c0-generalization', promptVersion: 'semantic-classifier.v3' }
    const gemini = resolveReplayStorage(replay, 'gemini-3.6-flash')
    const kimi = resolveReplayStorage(replay, 'k3-256k', 'kimi-code-openai-compatible')
    expect(kimi).not.toEqual(gemini)
    expect(kimi.outputRoot).toContain('providers/kimi-code-openai-compatible/k3-256k')
    expect(kimi.cacheRoot).toContain('providers/kimi-code-openai-compatible/k3-256k')
  })

  it('rejects an absent result instead of treating it as zero calls', () => {
    expect(() => assertCalibrationResult(undefined, 'paddington-2')).toThrow(/missing/i)
    expect(() => assertCalibrationResult({ modelCalls: 0, cacheHit: true, retries: 0, classificationsCompleted: 1 }, 'paddington-2')).toThrow(/providerUsageMetadata/i)
  })
})
