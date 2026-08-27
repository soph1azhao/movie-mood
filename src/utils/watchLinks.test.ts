import { describe, expect, it } from 'vitest'
import {
  buildTmdbWebUrl,
  buildWhereToWatchSearchUrl,
  buildLetterboxdSearchUrl,
  buildJustWatchSearchUrl,
} from './watchLinks'

describe('watch links — URL helpers', () => {
  describe('buildWhereToWatchSearchUrl', () => {
    it('encodes the title and year into a where-to-watch search', () => {
      const url = buildWhereToWatchSearchUrl('Amélie', 2001)
      expect(url).toContain('q=Am%C3%A9lie+2001+where+to+watch')
    })

    it('handles punctuation in titles safely', () => {
      const url = buildWhereToWatchSearchUrl("Who's Afraid of Virginia Woolf?", 1966)
      const parsed = new URL(url ?? '')
      expect(parsed.searchParams.get('q')).toBe("Who's Afraid of Virginia Woolf? 1966 where to watch")
    })

    it('returns null when neither title nor year is usable', () => {
      expect(buildWhereToWatchSearchUrl('', null)).toBeNull()
      expect(buildWhereToWatchSearchUrl('   ', null)).toBeNull()
      expect(buildWhereToWatchSearchUrl(null, null)).toBeNull()
    })

    it('builds a URL from title alone', () => {
      const url = buildWhereToWatchSearchUrl('Parasite', null)
      expect(new URL(url ?? '').searchParams.get('q')).toBe('Parasite where to watch')
    })
  })

  describe('buildTmdbWebUrl', () => {
    it('constructs a deterministic TMDB web URL from tmdbId', () => {
      expect(buildTmdbWebUrl(4893)).toBe('https://www.themoviedb.org/movie/4893')
    })

    it('returns null for missing or invalid tmdbId', () => {
      expect(buildTmdbWebUrl(null)).toBeNull()
      expect(buildTmdbWebUrl(undefined)).toBeNull()
      expect(buildTmdbWebUrl(0)).toBeNull()
      expect(buildTmdbWebUrl(-1)).toBeNull()
      expect(buildTmdbWebUrl(2.5)).toBeNull()
    })
  })

  describe('buildLetterboxdSearchUrl', () => {
    it('encodes the title for a Letterboxd search', () => {
      const url = buildLetterboxdSearchUrl('Spirited Away')
      expect(new URL(url ?? '').searchParams.get('q')).toBe('Spirited Away')
    })

    it('returns null for empty titles', () => {
      expect(buildLetterboxdSearchUrl('')).toBeNull()
      expect(buildLetterboxdSearchUrl(null)).toBeNull()
      expect(buildLetterboxdSearchUrl('   ')).toBeNull()
    })
  })

  describe('buildJustWatchSearchUrl', () => {
    it('encodes the title for a JustWatch search', () => {
      const url = buildJustWatchSearchUrl('Roma')
      expect(new URL(url ?? '').searchParams.get('q')).toBe('Roma')
      expect(url).toContain('justwatch.com')
    })

    it('returns null for empty titles', () => {
      expect(buildJustWatchSearchUrl('')).toBeNull()
      expect(buildJustWatchSearchUrl(null)).toBeNull()
    })
  })

  describe('non-English and special-character safety', () => {
    it('does not break on accented titles', () => {
      const url = buildWhereToWatchSearchUrl('Café', 2010)
      expect(url).toContain('Caf%C3%A9')
      const parsed = new URL(url ?? '')
      expect(parsed.searchParams.get('q')).toBe('Café 2010 where to watch')
    })

    it('does not break on CJK titles', () => {
      const url = buildWhereToWatchSearchUrl('your name', 2016)
      const parsed = new URL(url ?? '')
      expect(parsed.searchParams.get('q')).toBe('your name 2016 where to watch')
    })
  })
})
