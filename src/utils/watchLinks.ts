// Movie Mood V5.1 — Tonight's Action URL helpers.
//
// Centralized, deterministic outbound lookup links so URL construction is not
// scattered across components. All external links open safely and do not
// require any API key, do not call a backend, and do not claim verified
// streaming availability.
export const TMDB_WEB_BASE_URL = 'https://www.themoviedb.org'
export const TMDB_WEB_BASE_URL_NO_PROTOCOL = TMDB_WEB_BASE_URL.replace(/^https?:\/\//, '')

export function buildTmdbWebUrl(tmdbId: number | null | undefined): string | null {
  if (!Number.isInteger(tmdbId as number) || (tmdbId as number) <= 0) {
    return null
  }
  return `${TMDB_WEB_BASE_URL}/movie/${tmdbId}`
}

// A safe, encoded general web search for where to watch a movie.
export function buildWhereToWatchSearchUrl(title: string | null | undefined, year: number | null | undefined): string | null {
  const terms: string[] = []
  const cleanTitle = title ? String(title).trim() : ''
  if (cleanTitle) {
    terms.push(cleanTitle)
  }
  if (typeof year === 'number' && Number.isInteger(year) && year > 0) {
    terms.push(String(year))
  }

  if (terms.length === 0) {
    return null
  }

  const query = terms.join(' ')
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', `${query} where to watch`)
  return url.toString()
}

export function buildLetterboxdSearchUrl(title: string | null | undefined): string | null {
  const cleanTitle = title ? String(title).trim() : ''
  if (!cleanTitle) {
    return null
  }
  const url = new URL('https://letterboxd.com/search')
  url.searchParams.set('q', cleanTitle)
  return url.toString()
}

export function buildJustWatchSearchUrl(title: string | null | undefined, country = 'US'): string | null {
  const cleanTitle = title ? String(title).trim() : ''
  if (!cleanTitle) {
    return null
  }
  const url = new URL(`https://www.justwatch.com/${country}/search`)
  url.searchParams.set('q', cleanTitle)
  return url.toString()
}

export const WATCH_LINKS_LABEL = 'Find where to watch'
