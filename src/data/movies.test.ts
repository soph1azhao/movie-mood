import { describe, expect, it } from 'vitest'
import { curatedMovies } from './curatedMovies'
import tmdbMovies from './generated/tmdbMovies.json'
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
    const movieIds = new Set(curatedMovies.map((movie) => movie.id))
    const mappingIds = new Set(tmdbMovieMappings.map((mapping) => mapping.id))
    const tmdbIds = new Set(tmdbMovieMappings.map((mapping) => mapping.tmdbId))

    expect(tmdbMovieMappings).toHaveLength(curatedMovies.length)
    expect(mappingIds.size).toBe(curatedMovies.length)
    expect(tmdbIds.size).toBe(curatedMovies.length)

    for (const mapping of tmdbMovieMappings) {
      expect(movieIds.has(mapping.id), `${mapping.id} belongs to curated movies`).toBe(true)
      expect(Number.isInteger(mapping.tmdbId), `${mapping.id} tmdbId is an integer`).toBe(true)
      expect(mapping.tmdbId, `${mapping.id} tmdbId is positive`).toBeGreaterThan(0)
    }
  })

  it('resolves every curated movie with its generated TMDB facts', () => {
    expect(movies).toHaveLength(curatedMovies.length)

    for (const curatedMovie of curatedMovies) {
      const movie = movies.find((currentMovie) => currentMovie.id === curatedMovie.id)
      const facts = tmdbMovies[curatedMovie.id as keyof typeof tmdbMovies]

      expect(movie, `${curatedMovie.id} resolves`).toBeDefined()
      expect(facts, `${curatedMovie.id} has generated facts`).toBeDefined()
      expect(movie?.tmdbId).toBe(curatedMovie.tmdbId)
      expect(movie?.tmdbId).toBe(facts.tmdbId)
      expect(movie?.title).toBe(facts.title)
      expect(movie?.genres).toEqual(facts.genres)
      expect(movie?.runtimeMinutes).toBe(facts.runtimeMinutes)
      expect(movie?.spokenLanguages).toEqual(facts.spokenLanguages)
    }
  })

  it('keeps filter languages curated for V4 language filter compatibility', () => {
    for (const movie of movies) {
      expect(movie.languages).toBe(movie.filterLanguages)
    }
  })
})
