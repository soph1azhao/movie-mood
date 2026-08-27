import { curatedMovies } from './curatedMovies.js'
import tmdbMovies from './generated/tmdbMovies.json' with { type: 'json' }
import type { Movie, MovieFacts } from '../types/movie'

const factsByMovieId: Record<string, MovieFacts> = tmdbMovies

function resolveMovies(): Movie[] {
  const seenMovieIds = new Set<string>()
  const seenTmdbIds = new Set<number>()

  return curatedMovies.map((curatedMovie) => {
    if (seenMovieIds.has(curatedMovie.id)) {
      throw new Error(`Duplicate curated movie ID: ${curatedMovie.id}`)
    }

    if (seenTmdbIds.has(curatedMovie.tmdbId)) {
      throw new Error(`Duplicate curated TMDB ID: ${curatedMovie.tmdbId}`)
    }

    seenMovieIds.add(curatedMovie.id)
    seenTmdbIds.add(curatedMovie.tmdbId)

    const facts = factsByMovieId[curatedMovie.id]

    if (!facts) {
      throw new Error(`Missing TMDB facts for ${curatedMovie.id}`)
    }

    if (facts.tmdbId !== curatedMovie.tmdbId) {
      throw new Error(`TMDB ID mismatch for ${curatedMovie.id}`)
    }

    return {
      ...curatedMovie,
      ...facts,
      languages: curatedMovie.filterLanguages,
    }
  })
}

export const movies: Movie[] = resolveMovies()
