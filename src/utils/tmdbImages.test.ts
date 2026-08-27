import { describe, expect, it } from 'vitest'
import { getTmdbPosterUrl } from './tmdbImages'

describe('TMDB image helpers', () => {
  it('builds deterministic medium poster URLs', () => {
    expect(getTmdbPosterUrl('/example.jpg')).toBe('https://image.tmdb.org/t/p/w500/example.jpg')
  })

  it('keeps missing posters in fallback mode', () => {
    expect(getTmdbPosterUrl(null)).toBeNull()
  })
})
