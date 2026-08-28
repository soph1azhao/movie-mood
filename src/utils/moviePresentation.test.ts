import { describe, expect, it } from 'vitest'
import type { Movie } from '../types/movie'
import {
  formatCompactFacts,
  formatGenreSummary,
  getEmotionalWeightDetailLabel,
  getExperientialCue,
  getPaceDetailLabel,
} from './moviePresentation'

const baseMovie: Movie = {
  id: 'base',
  tmdbId: 1,
  title: 'Base Movie',
  year: 2000,
  director: 'Director',
  countries: ['United States'],
  filterLanguages: ['English'],
  languages: ['English'],
  spokenLanguages: ['English'],
  genres: ['Drama', 'Mystery', 'Thriller'],
  runtimeMinutes: 104,
  posterPath: null,
  moods: ['thoughtful'],
  situations: ['alone'],
  pace: 'medium',
  emotionalWeight: 'moderate',
  attentionDemand: 'engaged',
  discoveryStyle: 'familiar',
  description: 'A test movie.',
  whyWatch: 'Useful for tests.',
  curiosityHook: 'A simple hook.',
  vibeSummary: 'A simple vibe.',
  palette: ['#111111', '#eeeeee'],
}

function makeMovie(overrides: Partial<Movie>): Movie {
  return {
    ...baseMovie,
    ...overrides,
  }
}

describe('movie presentation helpers', () => {
  it('formats compact facts and genre summaries for full cards', () => {
    expect(formatCompactFacts(baseMovie)).toBe('2000 · 104 min')
    expect(formatGenreSummary(baseMovie)).toBe('Drama · Mystery')
  })

  it('avoids showing neutral experiential cues', () => {
    expect(getExperientialCue(baseMovie)).toBe('Keeps you engaged')
    expect(getExperientialCue(makeMovie({ attentionDemand: 'easy' }))).toBe('Easygoing')
  })

  it('prioritizes notable emotional and pace cues over attention labels', () => {
    expect(getExperientialCue(makeMovie({ emotionalWeight: 'heavy', pace: 'medium' }))).toBe('Emotionally weighty')
    expect(getExperientialCue(makeMovie({ emotionalWeight: 'moderate', pace: 'fast' }))).toBe('Moves quickly')
  })

  it('uses human detail labels for pace and emotional weight', () => {
    expect(getPaceDetailLabel('medium')).toBe('Balanced pace')
    expect(getEmotionalWeightDetailLabel('moderate')).toBe('Moderate')
  })
})
