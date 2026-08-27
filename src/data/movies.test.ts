import { describe, expect, it } from 'vitest'
import { movies } from './movies'
import tmdbMovieMappings from './tmdbMovieMappings.json'
import type { AttentionDemand, DiscoveryStyle } from '../types/movie'

const validAttentionDemands: AttentionDemand[] = ['easy', 'engaged', 'immersive']
const validDiscoveryStyles: DiscoveryStyle[] = ['familiar', 'different', 'adventurous']

describe('movies data', () => {
  it('contains at least 36 curated films', () => {
    expect(movies.length).toBeGreaterThanOrEqual(36)
  })

  it('tags every movie with valid V3 experience fields', () => {
    for (const movie of movies) {
      expect(validAttentionDemands, `${movie.title} attentionDemand`).toContain(movie.attentionDemand)
      expect(validDiscoveryStyles, `${movie.title} discoveryStyle`).toContain(movie.discoveryStyle)
    }
  })

  it('has one valid TMDB mapping for every curated movie', () => {
    const movieIds = new Set(movies.map((movie) => movie.id))
    const mappingIds = new Set(tmdbMovieMappings.map((mapping) => mapping.id))
    const tmdbIds = new Set(tmdbMovieMappings.map((mapping) => mapping.tmdbId))

    expect(tmdbMovieMappings).toHaveLength(movies.length)
    expect(mappingIds.size).toBe(movies.length)
    expect(tmdbIds.size).toBe(movies.length)

    for (const mapping of tmdbMovieMappings) {
      expect(movieIds.has(mapping.id), `${mapping.id} belongs to curated movies`).toBe(true)
      expect(Number.isInteger(mapping.tmdbId), `${mapping.id} tmdbId is an integer`).toBe(true)
      expect(mapping.tmdbId, `${mapping.id} tmdbId is positive`).toBeGreaterThan(0)
    }
  })
})
