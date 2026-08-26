import type { Mood, Movie, MovieFilters, RuntimeFilter, ViewingSituation } from '../types/movie'

export interface FilterResult {
  exactMatches: Movie[]
  fallbackMatches: Movie[]
  recommendationPool: Movie[]
  usedSituationFallback: boolean
}

export const emptyFilters: MovieFilters = {
  genres: [],
  runtime: null,
  language: null,
  pace: null,
  emotionalWeight: null,
}

function matchesRuntime(movie: Movie, runtime: RuntimeFilter | null) {
  if (!runtime) {
    return true
  }

  if (runtime === 'short') {
    return movie.runtimeMinutes < 100
  }

  if (runtime === 'medium') {
    return movie.runtimeMinutes >= 100 && movie.runtimeMinutes <= 130
  }

  return movie.runtimeMinutes > 130
}

function matchesPracticalFilters(movie: Movie, filters: MovieFilters) {
  const matchesGenres = filters.genres.every((genre) => movie.genres.includes(genre))
  const matchesLanguage = !filters.language || movie.languages.includes(filters.language)
  const matchesPace = !filters.pace || movie.pace === filters.pace
  const matchesEmotionalWeight = !filters.emotionalWeight || movie.emotionalWeight === filters.emotionalWeight

  return (
    matchesGenres
    && matchesRuntime(movie, filters.runtime)
    && matchesLanguage
    && matchesPace
    && matchesEmotionalWeight
  )
}

function matchesMoodAndFilters(movie: Movie, mood: Mood, filters: MovieFilters) {
  return movie.moods.includes(mood) && matchesPracticalFilters(movie, filters)
}

function getExactMatches(
  movies: Movie[],
  mood: Mood,
  situation: ViewingSituation | null,
  filters: MovieFilters,
) {
  return movies.filter((movie) => (
    matchesMoodAndFilters(movie, mood, filters)
    && (!situation || movie.situations.includes(situation))
  ))
}

function getSituationFallbackMatches(
  movies: Movie[],
  exactMatches: Movie[],
  mood: Mood,
  filters: MovieFilters,
) {
  const exactMatchIds = new Set(exactMatches.map((movie) => movie.id))

  return movies.filter((movie) => (
    !exactMatchIds.has(movie.id)
    && matchesMoodAndFilters(movie, mood, filters)
  ))
}

export function filterMovies(
  movies: Movie[],
  mood: Mood | null,
  situation: ViewingSituation | null,
  filters: MovieFilters = emptyFilters,
): FilterResult {
  if (!mood) {
    return {
      exactMatches: [],
      fallbackMatches: [],
      recommendationPool: [],
      usedSituationFallback: false,
    }
  }

  const exactMatches = getExactMatches(movies, mood, situation, filters)
  const shouldRelaxSituation = Boolean(situation) && exactMatches.length < 3
  const fallbackMatches = shouldRelaxSituation
    ? getSituationFallbackMatches(movies, exactMatches, mood, filters)
    : []
  const recommendationPool = [...exactMatches, ...fallbackMatches]

  return {
    exactMatches,
    fallbackMatches,
    recommendationPool,
    usedSituationFallback: fallbackMatches.length > 0,
  }
}
