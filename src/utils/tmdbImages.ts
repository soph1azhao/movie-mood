const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p'
const POSTER_SIZE = 'w500'

export function getTmdbPosterUrl(posterPath: string | null): string | null {
  if (!posterPath) {
    return null
  }

  return `${TMDB_IMAGE_BASE_URL}/${POSTER_SIZE}${posterPath}`
}
