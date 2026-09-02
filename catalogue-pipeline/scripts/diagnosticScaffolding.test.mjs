import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BASELINE_PROMPT_SHA256,
  auditGeneralizationSample,
  getDiagnosticDefinition,
  namedClassifierExampleExclusions,
  sha256,
  summarizeGeneralizationCoverage,
  summarizeMultilabelDiagnostics,
  summarizeOrderedDiagnostics,
} from './diagnosticScaffolding.mjs'
import { getDealbreakerRisk, resolveReplayDefinition, resolveReplayStorage } from './runCalibrationReplay.mjs'

describe('Phase 5B-H and Phase 5C-0 diagnostic scaffolding', () => {
  it('keeps semantic-classifier.v3 byte-for-byte frozen', async () => {
    const prompt = await readFile(new URL('../prompts/semantic-classifier.v3.md', import.meta.url), 'utf8')
    expect(sha256(prompt)).toBe(BASELINE_PROMPT_SHA256)
  })

  it('adds ordinal anti-hedging guidance only after otherwise identical v3 instructions', async () => {
    const [baseline, diagnostic] = await Promise.all([
      readFile(new URL('../prompts/semantic-classifier.v3.md', import.meta.url), 'utf8'),
      readFile(new URL('../prompts/semantic-classifier.v3-ordinal-diagnostic.md', import.meta.url), 'utf8'),
    ])
    const [diagnosticCore, overlay] = diagnostic.split('\n## Ordinal Diagnostic Guidance Only\n')
    expect(diagnosticCore.replace('semantic-classifier.v3-ordinal-diagnostic', 'semantic-classifier.v3').trimEnd()).toBe(baseline.trimEnd())
    expect(overlay).toContain('middle value only when')
    expect(overlay).not.toMatch(/moods|situations/i)
  })

  it('uses distinct prompt and cache/artifact identities without changing the baseline definition', () => {
    const baseline = resolveReplayDefinition()
    const diagnostic = resolveReplayDefinition('ordinal-hedging')
    expect(baseline.promptVersion).toBe('semantic-classifier.v3')
    expect(diagnostic.promptVersion).toBe('semantic-classifier.v3-ordinal-diagnostic')
    expect(resolveReplayStorage(baseline, 'gemini-3.6-flash')).not.toEqual(resolveReplayStorage(diagnostic, 'gemini-3.6-flash'))
  })

  it('allows middle predictions only when supported; it does not structurally force endpoints', () => {
    const metric = summarizeOrderedDiagnostics([{ id: 'supported-middle', human: { pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, model: { pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' } }])
    expect(metric.pace.exact).toBe(1)
    expect(metric.pace.centerRegressionCount).toBe(0)
    expect(metric.pace.middlePredictionRate).toBe(1)
  })

  it('reports endpoint-to-middle center hedging directionally and keeps dealbreaker risk asymmetric', () => {
    const metric = summarizeOrderedDiagnostics([{ id: 'center', human: { pace: 'slow', emotionalWeight: 'heavy', attentionDemand: 'immersive', discoveryStyle: 'adventurous' }, model: { pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' } }])
    expect(metric.pace.centerRegressionCount).toBe(1)
    expect(metric.emotionalWeight.transitions).toHaveProperty('heavy -> moderate', 1)
    expect(getDealbreakerRisk('emotionalWeight', 'heavy', 'moderate')).toBe('DEALBREAKER_UNDERSHOOT')
    expect(getDealbreakerRisk('emotionalWeight', 'light', 'heavy')).toBe('DEALBREAKER_OVERSHOOT')
  })

  it('builds a deterministic clean 12-film generalization diagnostic sample', () => {
    const definition = getDiagnosticDefinition('generalization')
    const first = auditGeneralizationSample(definition)
    const second = auditGeneralizationSample(definition)
    expect(first).toEqual(second)
    expect(first.clean).toBe(true)
    expect(first.selectedCount).toBe(12)
    expect(first.duplicates).toEqual([])
    expect(first.leaked).toEqual([])
    const exclusions = namedClassifierExampleExclusions()
    expect(exclusions.get('paddington-2')).toContain('phase-5 evaluation target')
    expect(exclusions.get('grand-budapest')).toContain('Phase 5B experiential positive example')
    expect(exclusions.get('tampopo')).toContain('Phase 5B experiential boundary/counterexample')
  })

  it('summarizes broad semantic and genre-coverage scaffolding without mutating human labels', () => {
    const definition = getDiagnosticDefinition('generalization')
    const before = structuredClone(definition)
    const coverage = summarizeGeneralizationCoverage(definition)
    expect(coverage.sampleSize).toBe(12)
    expect(coverage.semanticExtremes.pace.slow).toBeGreaterThan(0)
    expect(coverage.semanticExtremes.pace.medium).toBeGreaterThan(0)
    expect(coverage.semanticExtremes.pace.fast).toBeGreaterThan(0)
    expect(coverage.coverageTags.animationFamily).toContain('spirited-away')
    expect(definition).toEqual(before)
  })

  it('reports multilabel exact-set, Jaccard, and per-label precision/recall/F1 without mutating human records', () => {
    const records = [{ id: 'record', human: { moods: ['relaxing', 'thoughtful'], situations: ['friends', 'easy-watch'] }, model: { moods: ['thoughtful'], situations: ['friends', 'date-night'] } }]
    const before = structuredClone(records)
    const report = summarizeMultilabelDiagnostics(records)
    expect(report.moods.perFilm[0].jaccard).toBe(0.5)
    expect(report.moods.perLabel.relaxing.fn).toBe(1)
    expect(report.situations.perLabel['date-night'].fp).toBe(1)
    expect(records).toEqual(before)
  })
})
