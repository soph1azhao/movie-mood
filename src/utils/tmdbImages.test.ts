import { describe, expect, it } from 'vitest'
import { getTmdbPosterUrl, posterAspectRatio } from './tmdbImages'

describe('TMDB image helpers — poster fallback resilience', () => {
  it('builds deterministic medium poster URLs', () => {
    expect(getTmdbPosterUrl('/example.jpg')).toBe('https://image.tmdb.org/t/p/w500/example.jpg')
  })

  it('keeps missing posters in fallback mode (null path)', () => {
    expect(getTmdbPosterUrl(null)).toBeNull()
  })

  it('keeps empty-string posters in fallback mode', () => {
    expect(getTmdbPosterUrl('')).toBeNull()
  })

  it('keeps whitespace-only posters in fallback mode', () => {
    expect(getTmdbPosterUrl('   ')).toBeNull()
  })
})

describe('poster aspect ratio', () => {
  it('exposes a deterministic aspect ratio for layout reservation', () => {
    expect(posterAspectRatio()).toBe('1 / 1.5')
  })
})
