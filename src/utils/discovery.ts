import type { FilterResult } from './filterMovies'
import type { Dealbreakers, DiscoveryPreferences, Movie } from '../types/movie'

export const emptyDiscoveryPreferences: DiscoveryPreferences = {
  attentionDemand: null,
  discoveryStyle: null,
  dealbreakers: {
    avoidHeavy: false,
    avoidSlow: false,
    underTwoHours: false,
  },
}

export function applyDealbreakers(movies: Movie[], dealbreakers: Dealbreakers) {
  return movies.filter((movie) => {
    if (dealbreakers.avoidHeavy && movie.emotionalWeight === 'heavy') {
      return false
    }

    if (dealbreakers.avoidSlow && movie.pace === 'slow') {
      return false
    }

    if (dealbreakers.underTwoHours && movie.runtimeMinutes >= 120) {
      return false
    }

    return true
  })
}

function getExperienceScore(movie: Movie, preferences: DiscoveryPreferences) {
  let score = 0

  if (preferences.attentionDemand && movie.attentionDemand === preferences.attentionDemand) {
    score += 1
  }

  if (preferences.discoveryStyle && movie.discoveryStyle === preferences.discoveryStyle) {
    score += 1
  }

  return score
}

export function rankByExperiencePreferences(movies: Movie[], preferences: DiscoveryPreferences) {
  return movies
    .map((movie, index) => ({ movie, index, score: getExperienceScore(movie, preferences) }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map(({ movie }) => movie)
}

export function getDiscoveryPool(filterResult: FilterResult, preferences: DiscoveryPreferences) {
  const exactMatches = rankByExperiencePreferences(
    applyDealbreakers(filterResult.exactMatches, preferences.dealbreakers),
    preferences,
  )
  const fallbackMatches = rankByExperiencePreferences(
    applyDealbreakers(filterResult.fallbackMatches, preferences.dealbreakers),
    preferences,
  )

  return [...exactMatches, ...fallbackMatches]
}

function countSharedValues(firstValues: string[], secondValues: string[]) {
  const secondSet = new Set(secondValues)

  return firstValues.filter((value) => secondSet.has(value)).length
}

function getSimilarityScore(seedMovie: Movie, candidate: Movie) {
  return (
    countSharedValues(seedMovie.moods, candidate.moods) * 2
    + countSharedValues(seedMovie.genres, candidate.genres) * 2
    + (seedMovie.pace === candidate.pace ? 1 : 0)
    + (seedMovie.emotionalWeight === candidate.emotionalWeight ? 1 : 0)
    + (seedMovie.attentionDemand === candidate.attentionDemand ? 1 : 0)
    + (seedMovie.discoveryStyle === candidate.discoveryStyle ? 1 : 0)
    + countSharedValues(seedMovie.situations, candidate.situations)
  )
}

export function getSimilarMovies(movies: Movie[], seedMovieId: string, limit = 3) {
  const seedMovie = movies.find((movie) => movie.id === seedMovieId)

  if (!seedMovie) {
    return []
  }

  return movies
    .filter((movie) => movie.id !== seedMovieId)
    .map((movie, index) => ({ movie, index, score: getSimilarityScore(seedMovie, movie) }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, limit)
    .map(({ movie }) => movie)
}
