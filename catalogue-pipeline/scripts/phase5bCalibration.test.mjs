import { describe, expect, it } from 'vitest'
import examples from '../calibration/phase5b-experiential-examples.json' with { type: 'json' }
import { getDealbreakerRisk, summarizeCalibrationReplay } from './runCalibrationReplay.mjs'
import { validatePhase5bGrounding } from './validatePhase5bGrounding.mjs'

function directEvidence(sourceRef = 'tmdb-overview') {
  return { rationale: `Direct evidence: The source states the practical trait. Cues: [${sourceRef}: stated practical trait].`, sourceRefs: [sourceRef] }
}

function phase5bOutput(overrides = {}) {
  const evidence = directEvidence()
  return {
    evidence: {
      moods: { relaxing: evidence },
      situations: { 'easy-watch': evidence },
      pace: evidence,
      emotionalWeight: evidence,
      attentionDemand: evidence,
      discoveryStyle: evidence,
    },
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

  it('accepts a supported inference grounded by multiple declared source cues', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'Supported inference: The experience is relaxing. Cues: [tmdb-overview: gentle routine; tmdb-facts: family comedy]. Bridge: Together these cues support a restorative, low-friction viewing experience.',
            sourceRefs: ['tmdb-overview', 'tmdb-facts'],
          },
        },
      },
    })
    expect(validatePhase5bGrounding(output).ok).toBe(true)
  })

  it('does not require the literal taxonomy label in factual cues', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'Supported inference: A calm viewing fit follows. Cues: [tmdb-overview: quiet daily routine; tmdb-facts: 95 minute drama]. Bridge: The routine-led premise and modest runtime jointly support a restorative viewing fit.',
            sourceRefs: ['tmdb-overview', 'tmdb-facts'],
          },
        },
      },
    })
    expect(validatePhase5bGrounding(output).ok).toBe(true)
  })

  it('rejects unsupported model-memory assertions and weak inference structure', () => {
    const output = phase5bOutput({
      evidence: {
        ...phase5bOutput().evidence,
        moods: {
          relaxing: {
            rationale: 'Supported inference: I know this is relaxing from pretrained knowledge. Cues: [tmdb-overview: routine]. Bridge: It feels soothing.',
            sourceRefs: ['tmdb-overview'],
          },
        },
      },
    })
    const validation = validatePhase5bGrounding(output)
    expect(validation.ok).toBe(false)
    expect(validation.hardFailures.map((failure) => failure.code)).toContain('UNSUPPORTED_MODEL_MEMORY_ASSERTION')
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
