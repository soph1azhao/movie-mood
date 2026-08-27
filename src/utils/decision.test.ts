import { describe, expect, it } from 'vitest'
import type { Movie } from '../types/movie'
import { whyItFitsTonight, compareMoviesForDuel } from './decision'

const baseMovie: Movie = {
  id: 'base',
  title: 'Base Movie',
  year: 2020,
  director: 'Director',
  countries: ['United States'],
  languages: ['English'],
  genres: ['Drama', 'Comedy'],
  runtimeMinutes: 100,
  moods: ['thoughtful'],
  situations: ['alone'],
  pace: 'medium',
  emotionalWeight: 'moderate',
  attentionDemand: 'engaged',
  discoveryStyle: 'familiar',
  description: 'A test movie.',
  whyWatch: 'Useful for tests.',
  curiosityHook: 'A simple hook.',
  vibeSummary: 'A simple vibe.',
  palette: ['#111111', '#eeeeee'],
}

function makeMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    ...baseMovie,
    ...overrides,
    id: overrides.id || `movie-${Math.random().toString(36).substr(2, 5)}`,
  }
}

describe('whyItFitsTonight', () => {
  it('returns reasons for mood match', () => {
    const movie = makeMovie({ moods: ['funny', 'relaxing'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('fits your funny mood')
  })

  it('returns reasons for situation match', () => {
    const movie = makeMovie({ moods: ['funny'], situations: ['friends', 'date-night'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: 'friends',
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('perfect for friends')
  })

  it('returns reasons for attention demand match', () => {
    const movie = makeMovie({ moods: ['funny'], attentionDemand: 'engaged' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: 'engaged',
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('matches your engaged vibe')
  })

  it('returns reasons for discovery style match', () => {
    const movie = makeMovie({ moods: ['funny'], discoveryStyle: 'different' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: 'different',
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('offers a different feel vibe')
  })

  it('returns reasons for pace match', () => {
    const movie = makeMovie({ moods: ['funny'], pace: 'fast' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: 'fast',
      emotionalWeight: null,
    })

    expect(reasons).toContain('has a fast pace')
  })

  it('returns reasons for emotional weight match', () => {
    const movie = makeMovie({ moods: ['funny'], emotionalWeight: 'light' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: 'light',
    })

    expect(reasons).toContain('has light emotional weight')
  })

  it('returns multiple reasons when multiple preferences match', () => {
    const movie = makeMovie({
      moods: ['funny'],
      situations: ['friends'],
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
      pace: 'fast',
      emotionalWeight: 'light',
    })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: 'friends',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
      pace: 'fast',
      emotionalWeight: 'light',
    })

    expect(reasons).toHaveLength(6)
    expect(reasons).toContain('fits your funny mood')
    expect(reasons).toContain('perfect for friends')
    expect(reasons).toContain('matches your engaged vibe')
    expect(reasons).toContain('offers a familiar feel vibe')
    expect(reasons).toContain('has a fast pace')
    expect(reasons).toContain('has light emotional weight')
  })

  it('returns empty array when no preferences match', () => {
    const movie = makeMovie({ moods: ['thoughtful'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toEqual([])
  })
})

describe('compareMoviesForDuel', () => {
  it('shows mood differences', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny', 'relaxing'],
      genres: ['Comedy'],
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['suspenseful'],
      genres: ['Thriller'],
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toHaveLength(2) // mood and genre
    expect(result.differences.map((d) => d.category)).toContain('mood')
    expect(result.differences.map((d) => d.category)).toContain('genre')
  })

  it('shows pace differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], pace: 'fast' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], pace: 'slow' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'pace',
        firstValue: 'fast',
        secondValue: 'slow',
      }),
    ])
  })

  it('shows emotional weight differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], emotionalWeight: 'light' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], emotionalWeight: 'heavy' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'emotional weight',
        firstValue: 'light',
        secondValue: 'heavy emotional weight',
      }),
    ])
  })

  it('shows attention demand differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], attentionDemand: 'easy' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], attentionDemand: 'immersive' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'attention',
        firstValue: 'easy',
        secondValue: 'immersive',
      }),
    ])
  })

  it('shows discovery style differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], discoveryStyle: 'familiar' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], discoveryStyle: 'adventurous' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'style',
        firstValue: 'familiar',
        secondValue: 'adventurous',
      }),
    ])
  })

  it('returns empty differences when movies are identical', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny'],
      genres: ['Comedy'],
      pace: 'fast',
      emotionalWeight: 'light',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['funny'],
      genres: ['Comedy'],
      pace: 'fast',
      emotionalWeight: 'light',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([])
  })

  it('excludes shared moods from difference display', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny', 'relaxing'],
      genres: ['Comedy'],
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['funny', 'suspenseful'],
      genres: ['Thriller'],
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    // Both share 'funny' mood, so moods only differ in unique values (relaxing vs suspenseful)
    // But we're not comparing mood values directly in the current implementation
    expect(result.differences).toHaveLength(2) // mood unique values + genres
  })
})