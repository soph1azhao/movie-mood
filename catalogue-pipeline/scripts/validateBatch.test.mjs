import { describe, expect, it } from 'vitest'
import {
  validateCandidateBatch,
  validateCriticOutput,
  validateCuratedMovie,
  validateEditorialOutput,
  validateMovieFacts,
  validateOneToOneMapping,
  validateReviewQueue,
  validateSemanticOutput,
} from './validateBatch.mjs'
import { buildReviewQueue } from './buildReviewQueue.mjs'

const longText = 'This line is specific enough for Movie Mood validation and carries a clear editorial shape.'

function validCuratedMovie(overrides = {}) {
  return {
    id: 'example-movie',
    tmdbId: 123,
    moods: ['relaxing'],
    situations: ['family'],
    filterLanguages: ['Japanese'],
    pace: 'medium',
    emotionalWeight: 'light',
    attentionDemand: 'easy',
    discoveryStyle: 'different',
    description: `${longText} It orients the viewer without drifting into summary.`,
    whyWatch: 'Choose this for a gentle, specific watch with enough texture to feel memorable.',
    curiosityHook: 'A small discovery opens into a tender night with quiet visual charm.',
    vibeSummary: 'Gentle, bright, and easy to settle into without feeling bland.',
    palette: ['#123456', '#abcdef'],
    ...overrides,
  }
}

function validFacts(overrides = {}) {
  return {
    tmdbId: 123,
    title: 'Example Movie',
    year: 2001,
    director: 'Example Director',
    countries: ['Japan'],
    spokenLanguages: ['Japanese'],
    genres: ['Animation', 'Family'],
    runtimeMinutes: 96,
    posterPath: '/abc.jpg',
    ...overrides,
  }
}

describe('V8.1 deterministic catalogue validators', () => {
it('candidate batch validation rejects duplicate TMDB IDs deterministically', () => {
  const result = validateCandidateBatch({
    batchId: 'pilot-100',
    schemaVersion: 'candidate.v1',
    createdAt: '2026-09-01T00:00:00.000Z',
    sourcePolicy: { description: 'Balanced pilot.', licensingNotes: [] },
    candidates: [
      { candidateId: 'a', title: 'A', year: 2000, tmdbId: 1, sourceTags: ['manual'], inclusionRationale: 'Adds range.' },
      { candidateId: 'b', title: 'B', year: 2001, tmdbId: 1, sourceTags: ['manual'], inclusionRationale: 'Adds range.' },
    ],
  })

  expect(result.ok).toBe(false)
  expect(result.hardFailures.some((issue) => issue.code === 'DUPLICATE_TMDB_ID')).toBe(true)
})

it('curated validation rejects invalid enums and malformed palettes as hard failures', () => {
  const result = validateCuratedMovie(validCuratedMovie({
    moods: ['cozy'],
    palette: ['#12345g', '#ffffff'],
  }))

  expect(result.ok).toBe(false)
  expect(result.hardFailures.some((issue) => issue.code === 'INVALID_ENUM')).toBe(true)
  expect(result.hardFailures.some((issue) => issue.code === 'MALFORMED_PALETTE')).toBe(true)
})

it('curated validation flags semantic anomalies without hard-failing them', () => {
  const result = validateCuratedMovie(validCuratedMovie({
    moods: ['funny'],
    emotionalWeight: 'heavy',
    description: `${longText} It keeps the setup readable and spoiler safe.`,
    whyWatch: 'A strange comic edge gives the night bite without losing its human shape.',
    curiosityHook: 'A comic premise keeps revealing sharper pressure underneath the surface.',
    vibeSummary: 'Funny on the surface, heavier underneath, and worth a closer look.',
  }))

  expect(result.ok).toBe(true)
  expect(result.reviewFlags.some((issue) => issue.code === 'FUNNY_HEAVY')).toBe(true)
})

it('movie facts allow null poster as review flag but not hard failure', () => {
  const result = validateMovieFacts(validFacts({ posterPath: null }))

  expect(result.ok).toBe(true)
  expect(result.reviewFlags.some((issue) => issue.code === 'POSTER_UNAVAILABLE')).toBe(true)
})

it('one-to-one mapping validation catches missing facts', () => {
  const movie = validCuratedMovie()
  const result = validateOneToOneMapping(
    [movie],
    [{ id: movie.id, tmdbId: movie.tmdbId }],
    {},
  )

  expect(result.ok).toBe(false)
  expect(result.hardFailures.some((issue) => issue.code === 'MISSING_FACTUAL_SNAPSHOT')).toBe(true)
})

it('semantic output validates taxonomy shape and rejects writer copy fields', () => {
  const result = validateSemanticOutput({
    schemaVersion: 'semantic-output.v1',
    promptVersion: 'semantic-classifier.v1',
    taxonomyVersion: 'taxonomy.v1',
    movie: { candidateId: 'pilot-001', tmdbId: 123 },
    classification: {
      moods: ['relaxing'],
      situations: ['family'],
      filterLanguages: ['Japanese'],
      pace: 'medium',
      emotionalWeight: 'light',
      attentionDemand: 'easy',
      discoveryStyle: 'different',
    },
    evidence: {},
  })

  expect(result.ok).toBe(true)
})

it('editorial output requires voice guide version and copy limits', () => {
  const result = validateEditorialOutput({
    schemaVersion: 'editorial-output.v1',
    promptVersion: 'editorial-writer.v1',
    voiceGuideVersion: 'voice.v1',
    movie: { candidateId: 'pilot-001', tmdbId: 123 },
    copy: {
      description: `${longText} It orients the viewer without drifting into summary.`,
      whyWatch: 'Choose this for a gentle, specific watch with enough texture to feel memorable.',
      curiosityHook: 'A small discovery opens into a tender night with quiet visual charm.',
      vibeSummary: 'Gentle, bright, and easy to settle into without feeling bland.',
    },
  })

  expect(result.ok).toBe(true)
})

it('critic output rejects writer hidden reasoning dependency', () => {
  const result = validateCriticOutput({
    schemaVersion: 'critic-output.v1',
    promptVersion: 'critic.v1',
    voiceGuideVersion: 'voice.v1',
    movie: { candidateId: 'pilot-001', tmdbId: 123 },
    verdict: 'needs_review',
    issues: [],
    copyAssessment: {},
    writerReasoning: 'Do not include this.',
  })

  expect(result.ok).toBe(false)
  expect(result.hardFailures.some((issue) => issue.code === 'CRITIC_DEPENDS_ON_WRITER_REASONING')).toBe(true)
})

it('review queue builder turns hard failures into P0 blocked items', () => {
  const hardFailure = { severity: 'hard_fail', code: 'INVALID_ENUM', message: 'Bad enum.', field: 'moods' }
  const queue = buildReviewQueue({
    batchId: 'pilot-100',
    candidates: [
      {
        candidateId: 'pilot-001',
        tmdbId: 123,
        title: 'Example Movie',
        validationResults: [{ ok: false, hardFailures: [hardFailure], reviewFlags: [] }],
      },
    ],
  })

  expect(queue.items[0].priority).toBe('P0')
  expect(queue.items[0].status).toBe('blocked')
  expect(queue.items[0].reviewReasons[0].code).toBe('INVALID_ENUM')
  expect(validateReviewQueue(queue).ok).toBe(true)
})
})
