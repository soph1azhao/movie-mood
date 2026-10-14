import type { Movie } from '../types/movie'

/**
 * Optional, local-only preference signal from saved films.
 * It reorders existing eligible candidates; it never changes hard filters.
 * Genre cosine similarity is a heuristic, NOT a learned ML model.
 */
export function rankForYou(
  candidates: Movie[],
  catalogue: Movie[],
  favoriteIds: string[],
): Movie[] {
  const saved = new Set(favoriteIds)
  const favorites = catalogue.filter(movie => saved.has(movie.id))
  if (favorites.length === 0) return candidates

  const counts = new Map<string, number>()
  for (const movie of favorites) {
    for (const genre of new Set(movie.genres)) counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  const norm = Math.sqrt([...counts.values()].reduce((sum, n) => sum + n * n, 0))
  if (norm === 0) return candidates

  return candidates.map((movie, index) => {
    const uniqueGenres = [...new Set(movie.genres)]
    const overlap = uniqueGenres.reduce((sum, genre) => sum + (counts.get(genre) ?? 0), 0)
    const score = uniqueGenres.length ? overlap / (Math.sqrt(uniqueGenres.length) * norm) : 0
    return { movie, score, index }
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.movie)
}

/** Preserve released exact-situation-before-fallback priority. */
export function rankForYouWithinSituationTiers(
  rankedCandidates: Movie[],
  exactIds: Set<string>,
  catalogue: Movie[],
  favoriteIds: string[],
): Movie[] {
  const exact = rankedCandidates.filter(m => exactIds.has(m.id))
  const fallback = rankedCandidates.filter(m => !exactIds.has(m.id))
  return [
    ...rankForYou(exact, catalogue, favoriteIds),
    ...rankForYou(fallback, catalogue, favoriteIds),
  ]
}
