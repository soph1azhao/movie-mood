import { describe, expect, it } from 'vitest'
import { movies } from './movies'
import type { AttentionDemand, DiscoveryStyle } from '../types/movie'

const validAttentionDemands: AttentionDemand[] = ['easy', 'engaged', 'immersive']
const validDiscoveryStyles: DiscoveryStyle[] = ['familiar', 'different', 'adventurous']

describe('movies data', () => {
  it('contains at least 36 curated films', () => {
    expect(movies.length).toBeGreaterThanOrEqual(36)
  })

  it('tags every movie with valid V3 experience fields', () => {
    for (const movie of movies) {
      expect(validAttentionDemands, `${movie.title} attentionDemand`).toContain(movie.attentionDemand)
      expect(validDiscoveryStyles, `${movie.title} discoveryStyle`).toContain(movie.discoveryStyle)
    }
  })
})
