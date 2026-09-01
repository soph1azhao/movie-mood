import { describe, expect, it } from 'vitest'
import examples from '../calibration/phase5b-experiential-examples.json' with { type: 'json' }
import { getDealbreakerRisk, summarizeCalibrationReplay } from './runCalibrationReplay.mjs'
import { validateSemanticOutput } from './validateBatch.mjs'

function directEvidence(sourceRef = 'tmdb-overview') {
  return {
    rationale: 'A human-readable explanation remains useful for review.',
    sourceRefs: [sourceRef],
    grounding: { mode: 'direct', cues: [{ sourceRef, cue: 'The factual source supplies a concrete trait.' }] },
  }
}

function phase5bOutput(overrides = {}) {
  const evidence = directEvidence()
  return {
    schemaVersion: 'semantic-output.v2',
    promptVersion: 'semantic-classifier.v3',
    taxonomyVersion: 'taxonomy.v2',
    movie: { candidateId: 'example', tmdbId: 1 },
    classification: {
      moods: ['relaxing'], situations: ['easy-watch'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'light', attentionDemand: 'easy', discoveryStyle: 'familiar',
    },
    evidence: {
      moods: { relaxing: evidence },
      situations: { 'easy-watch': evidence },
      pace: evidence,
      emotionalWeight: evidence,
      attentionDemand: evidence,
      discoveryStyle: evidence,
    },
    boundaryFlags: [],
    ...overrides,
  }
}

function result(candidateId, classification) {
  return {
    result: {
      artifact: {
        movie: { candidateId },
        modelProvider: 'mock-provider',
        modelId: 'gemini-3.5-flash',
        classification,
        outputHash: `sha256:${candidateId}`,
      },
      modelCalls: 1,
      cacheHit: false,
      retries: 0,
      classificationsCompleted: 1,
      providerUsageMetadata: null,
      wroteArtifact: true,
    },
  }
}

describe('Phase 5B experiential inference and directional risk', () => {
  it('uses only non-evaluation human examples for experiential calibration', () => {
    const evaluationIds = new Set(['paddington-2', 'whiplash', 'perfect-days', 'arrival', 'mad-max', 'edge-of-tomorrow', 'before-sunrise', 'rye-lane-2023', 'petite-maman-2021', 'truman-show'])
    for (const example of [...examples.positiveExamples, ...examples.boundaryAndCounterexamples]) expect(evaluationIds.has(example.movieId)).toBe(false)
  })

  it('accepts direct evidence and supported inference grounded by structured factual cues', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'The two factual cues jointly support a restorative viewing fit.',
            sourceRefs: ['tmdb-overview', 'tmdb-facts'],
            grounding: {
              mode: 'supported-inference',
              cues: [{ sourceRef: 'tmdb-overview', cue: 'A gentle routine structures the premise.' }, { sourceRef: 'tmdb-facts', cue: 'The film is a family comedy.' }],
              bridge: 'Together these cues support a restorative, low-friction viewing experience.',
            },
          },
        },
      },
    })
    expect(validateSemanticOutput(output).ok).toBe(true)
  })

  it('does not require literal taxonomy wording or rationale punctuation for machine validation', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'Calm viewing fit follows from the stated facts, without a templated sentence.',
            sourceRefs: ['tmdb-overview', 'tmdb-facts'],
            grounding: {
              mode: 'supported-inference',
              cues: [{ sourceRef: 'tmdb-overview', cue: 'A quiet daily routine leads the premise.' }, { sourceRef: 'tmdb-facts', cue: 'The runtime is ninety-five minutes.' }],
              bridge: 'The routine-led premise and modest runtime jointly support a restorative viewing fit.',
            },
          },
        },
      },
    })
    expect(validateSemanticOutput(output).ok).toBe(true)
  })

  it('reports distinct structured inference failures', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'The result needs review.',
            sourceRefs: ['tmdb-overview'],
            grounding: { mode: 'supported-inference', cues: [{ sourceRef: 'tmdb-overview', cue: 'A quiet routine is described.' }] },
          },
        },
      },
    })
    const validation = validateSemanticOutput(output)
    expect(validation.ok).toBe(false)
    expect(validation.hardFailures.map((failure) => failure.code)).toEqual(expect.arrayContaining(['TOO_FEW_SUPPORTED_INFERENCE_CUES', 'MISSING_SUPPORTED_INFERENCE_BRIDGE']))
  })

  it('reports missing direct-evidence cues separately', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        pace: {
          rationale: 'The pace is stated clearly.',
          sourceRefs: ['tmdb-overview'],
          grounding: { mode: 'direct', cues: [] },
        },
      },
    })
    const validation = validateSemanticOutput(output)
    expect(validation.hardFailures.map((failure) => failure.code)).toContain('TOO_FEW_DIRECT_EVIDENCE_CUES')
  })

  it('classifies directional dealbreaker risks without collapsing soft order changes', () => {
    expect(getDealbreakerRisk('emotionalWeight', 'heavy', 'moderate')).toBe('DEALBREAKER_UNDERSHOOT')
    expect(getDealbreakerRisk('emotionalWeight', 'light', 'heavy')).toBe('DEALBREAKER_OVERSHOOT')
    expect(getDealbreakerRisk('pace', 'slow', 'fast')).toBe('DEALBREAKER_UNDERSHOOT')
    expect(getDealbreakerRisk('pace', 'medium', 'slow')).toBe('DEALBREAKER_OVERSHOOT')
    expect(getDealbreakerRisk('attentionDemand', 'easy', 'engaged')).toBeNull()
  })

  it('reports eligibility changes, directional risks, and soft order-only disagreements separately', () => {
    const paddington = result('paddington-2', {
      moods: ['funny'], situations: ['family'], filterLanguages: ['English'], pace: 'slow', emotionalWeight: 'heavy', attentionDemand: 'easy', discoveryStyle: 'familiar',
    })
    const whiplash = result('whiplash', {
      moods: ['emotional'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'immersive', discoveryStyle: 'different',
    })
    const packets = [
      { candidateId: 'paddington-2', facts: { title: 'Paddington 2', overview: 'overview', keywords: [] } },
      { candidateId: 'whiplash', facts: { title: 'Whiplash', overview: 'overview', keywords: [] } },
    ]
    const report = summarizeCalibrationReplay([paddington, whiplash], [paddington, whiplash], packets)
    expect(report.productImpact.hardDealbreakerOvershoots.count).toBe(2)
    expect(report.productImpact.hardDealbreakerUndershoots.count).toBe(1)
    expect(report.productImpact.moodEligibilityChanges.count).toBeGreaterThan(0)
    expect(report.productImpact.situationEligibilityChanges.count).toBeGreaterThan(0)
    expect(report.productImpact.softOrderOnlyDisagreements.count).toBeGreaterThan(0)
    expect(report.productImpact.precisionDiscipline.extraLabels).toBeGreaterThanOrEqual(0)
  })
})
