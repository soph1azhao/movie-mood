import { describe, expect, it } from 'vitest'
import type { Movie } from '../types/movie'
import {
  applyDealbreakers,
  emptyDiscoveryPreferences,
  getDiscoveryPool,
  getSimilarMovies,
  rankByExperiencePreferences,
} from './discovery'

const baseMovie: Movie = {
  id: 'base',
  tmdbId: 1,
  title: 'Base Movie',
  year: 2000,
  director: 'Director',
  countries: ['United States'],
  filterLanguages: ['English'],
  languages: ['English'],
  spokenLanguages: ['English'],
  genres: ['Drama'],
  runtimeMinutes: 100,
  posterPath: null,
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

function makeMovie(overrides: Partial<Movie>): Movie {
  return {
    ...baseMovie,
    ...overrides,
  }
}

describe('applyDealbreakers', () => {
  it('removes movies that violate active hard boundaries', () => {
    const movies = [
      makeMovie({ id: 'easy-fit', runtimeMinutes: 95, pace: 'medium', emotionalWeight: 'light' }),
      makeMovie({ id: 'heavy', emotionalWeight: 'heavy' }),
      makeMovie({ id: 'slow', pace: 'slow' }),
      makeMovie({ id: 'long', runtimeMinutes: 120 }),
    ]

    const result = applyDealbreakers(movies, {
      avoidHeavy: true,
      avoidSlow: true,
      underTwoHours: true,
    })

    expect(result.map((movie) => movie.id)).toEqual(['easy-fit'])
  })

  it('leaves the dataset order unchanged when no boundaries are active', () => {
    const movies = [
      makeMovie({ id: 'first', emotionalWeight: 'heavy' }),
      makeMovie({ id: 'second', pace: 'slow' }),
      makeMovie({ id: 'third', runtimeMinutes: 150 }),
    ]

    const result = applyDealbreakers(movies, emptyDiscoveryPreferences.dealbreakers)

    expect(result.map((movie) => movie.id)).toEqual(['first', 'second', 'third'])
  })
})

describe('rankByExperiencePreferences', () => {
  it('orders matching experience preferences first and keeps stable order for ties', () => {
    const movies = [
      makeMovie({ id: 'no-match', attentionDemand: 'easy', discoveryStyle: 'familiar' }),
      makeMovie({ id: 'attention-match', attentionDemand: 'immersive', discoveryStyle: 'familiar' }),
      makeMovie({ id: 'both-match', attentionDemand: 'immersive', discoveryStyle: 'adventurous' }),
      makeMovie({ id: 'style-match', attentionDemand: 'engaged', discoveryStyle: 'adventurous' }),
    ]

    const result = rankByExperiencePreferences(movies, {
      ...emptyDiscoveryPreferences,
      attentionDemand: 'immersive',
      discoveryStyle: 'adventurous',
    })

    expect(result.map((movie) => movie.id)).toEqual([
      'both-match',
      'attention-match',
      'style-match',
      'no-match',
    ])
  })

  it('does not remove movies when soft preferences do not match', () => {
    const movies = [
      makeMovie({ id: 'first', attentionDemand: 'easy', discoveryStyle: 'familiar' }),
      makeMovie({ id: 'second', attentionDemand: 'engaged', discoveryStyle: 'different' }),
    ]

    const result = rankByExperiencePreferences(movies, {
      ...emptyDiscoveryPreferences,
      attentionDemand: 'immersive',
      discoveryStyle: 'adventurous',
    })

    expect(result.map((movie) => movie.id)).toEqual(['first', 'second'])
  })
})

describe('getDiscoveryPool', () => {
  it('keeps exact matches ahead of fallback matches after V3 ordering', () => {
    const exactMatch = makeMovie({
      id: 'exact',
      attentionDemand: 'easy',
      discoveryStyle: 'familiar',
    })
    const fallbackMatch = makeMovie({
      id: 'fallback',
      attentionDemand: 'immersive',
      discoveryStyle: 'adventurous',
    })

    const result = getDiscoveryPool(
      {
        exactMatches: [exactMatch],
        fallbackMatches: [fallbackMatch],
        recommendationPool: [exactMatch, fallbackMatch],
        usedSituationFallback: true,
      },
      {
        ...emptyDiscoveryPreferences,
        attentionDemand: 'immersive',
        discoveryStyle: 'adventurous',
      },
    )

    expect(result.map((movie) => movie.id)).toEqual(['exact', 'fallback'])
  })
})

describe('getSimilarMovies', () => {
  it('excludes the seed movie and returns up to the requested limit', () => {
    const movies = [
      makeMovie({ id: 'seed', moods: ['funny'], genres: ['Comedy'] }),
      makeMovie({ id: 'first', moods: ['funny'], genres: ['Comedy'] }),
      makeMovie({ id: 'second', moods: ['funny'], genres: ['Drama'] }),
      makeMovie({ id: 'third', moods: ['thoughtful'], genres: ['Drama'] }),
    ]

    const result = getSimilarMovies(movies, 'seed', 2)

    expect(result).toHaveLength(2)
    expect(result.map((movie) => movie.id)).not.toContain('seed')
  })

  it('orders by local metadata similarity and uses dataset order as the final tie-breaker', () => {
    const movies = [
      makeMovie({
        id: 'seed',
        moods: ['funny'],
        genres: ['Comedy'],
        situations: ['friends'],
        pace: 'fast',
        emotionalWeight: 'light',
        attentionDemand: 'easy',
        discoveryStyle: 'familiar',
      }),
      makeMovie({
        id: 'tie-one',
        moods: ['funny'],
        genres: ['Comedy'],
        situations: ['alone'],
        pace: 'medium',
        emotionalWeight: 'moderate',
        attentionDemand: 'engaged',
        discoveryStyle: 'different',
      }),
      makeMovie({
        id: 'strong-match',
        moods: ['funny'],
        genres: ['Comedy'],
        situations: ['friends'],
        pace: 'fast',
        emotionalWeight: 'light',
        attentionDemand: 'easy',
        discoveryStyle: 'familiar',
      }),
      makeMovie({
        id: 'tie-two',
        moods: ['funny'],
        genres: ['Comedy'],
        situations: ['alone'],
        pace: 'medium',
        emotionalWeight: 'moderate',
        attentionDemand: 'engaged',
        discoveryStyle: 'different',
      }),
    ]

    const result = getSimilarMovies(movies, 'seed')

    expect(result.map((movie) => movie.id)).toEqual(['strong-match', 'tie-one', 'tie-two'])
  })

  it('is deterministic across repeated calls', () => {
    const movies = [
      makeMovie({ id: 'seed', moods: ['suspenseful'], genres: ['Thriller'] }),
      makeMovie({ id: 'first', moods: ['suspenseful'], genres: ['Mystery'] }),
      makeMovie({ id: 'second', moods: ['thoughtful'], genres: ['Thriller'] }),
      makeMovie({ id: 'third', moods: ['relaxing'], genres: ['Drama'] }),
    ]

    const firstRun = getSimilarMovies(movies, 'seed')
    const secondRun = getSimilarMovies(movies, 'seed')

    expect(secondRun.map((movie) => movie.id)).toEqual(firstRun.map((movie) => movie.id))
  })
})
