const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p'
const POSTER_SIZE = 'w500'

// Aspect ratio of a standard TMDB poster (width:height ≈ 2:3). Exposed so the
// UI can reserve space before a poster image loads, preventing layout shift.
export const TMDB_POSTER_ASPECT_RATIO = 1.5

export function posterAspectRatio(): string {
  return `1 / ${TMDB_POSTER_ASPECT_RATIO}`
}

export function getTmdbPosterUrl(posterPath: string | null): string | null {
  if (!posterPath || !posterPath.trim()) {
    return null
  }

  return `${TMDB_IMAGE_BASE_URL}/${POSTER_SIZE}${posterPath}`
}
