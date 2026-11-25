import { describe, expect, it } from 'vitest'
import type { Movie } from '../types/movie'
import { rankForYou, rankForYouWithinSituationTiers } from './personalizedRanking'
import { movies } from '../data/movies'

describe('opt-in personalized ordering', () => {
  const catalogue = movies
  it('preserves incoming ordering with no saved films or unknown IDs', () => {
    const candidates = catalogue.slice(0, 12)
    expect(rankForYou(candidates, catalogue, [])).toEqual(candidates)
    expect(rankForYou(candidates, catalogue, ['not-found'])).toEqual(candidates)
  })
  it('never adds, removes, or duplicates eligible movies', () => {
    const candidates = catalogue.slice(4, 20)
    const ranked = rankForYou(candidates, catalogue, [catalogue[0].id, catalogue[2].id])
    expect(ranked.map(movie => movie.id).sort()).toEqual(candidates.map(movie => movie.id).sort())
    expect(rankForYou(candidates, catalogue, [catalogue[0].id])).toEqual(rankForYou(candidates, catalogue, [catalogue[0].id]))
  })
  it('ranks matching genres higher and preserves ties stably', () => {
    const saved = { ...catalogue[0], id: 'saved', genres: ['Comedy'] } as Movie
    const other = { ...catalogue[0], id: 'other', genres: ['Thriller'] } as Movie
    const matching = { ...catalogue[0], id: 'matching', genres: ['Comedy'] } as Movie
    const matchingAgain = { ...catalogue[0], id: 'matching2', genres: ['Comedy'] } as Movie
    expect(rankForYou([other, matching, matchingAgain], [saved], ['saved']).map(m => m.id)).toEqual(['matching', 'matching2', 'other'])
  })
  it('never allows situation fallback to outrank exact situation matches', () => {
    const saved = { ...catalogue[0], id: 'saved', genres: ['Comedy'] } as Movie
    const exact = { ...catalogue[0], id: 'exact', genres: ['Drama'] } as Movie
    const fallback = { ...catalogue[0], id: 'fallback', genres: ['Comedy'] } as Movie
    expect(rankForYouWithinSituationTiers([exact, fallback], new Set(['exact']), [saved], ['saved']).map(m => m.id)).toEqual(['exact', 'fallback'])
  })
})
