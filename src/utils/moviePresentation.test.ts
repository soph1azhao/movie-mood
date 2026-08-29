import { describe, expect, it } from 'vitest'
import type { Movie } from '../types/movie'
import {
  formatCompactFacts,
  formatGenreSummary,
  getEmotionalWeightDetailLabel,
  getExperientialCue,
  getFinishTimeLabel,
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
describe('getFinishTimeLabel', () => {
  it('returns same-day finish time for a typical runtime', () => {
    // 9:00 PM + 116 min = 10:56 PM
    const now = new Date(2024, 0, 1, 21, 0, 0)
    expect(getFinishTimeLabel(116, now)).toBe('Ends around 10:56 PM')
  })

  it('handles after-midnight finish time correctly', () => {
    // 11:10 PM + 140 min = 1:30 AM
    const now = new Date(2024, 0, 1, 23, 10, 0)
    expect(getFinishTimeLabel(140, now)).toBe('Ends around 1:30 AM')
  })

  it('handles noon boundary correctly (11:00 AM + 90 min = 12:30 PM)', () => {
    const now = new Date(2024, 0, 1, 11, 0, 0)
    expect(getFinishTimeLabel(90, now)).toBe('Ends around 12:30 PM')
  })

  it('handles midnight exactly (11:00 PM + 60 min = 12:00 AM)', () => {
    const now = new Date(2024, 0, 1, 23, 0, 0)
    expect(getFinishTimeLabel(60, now)).toBe('Ends around 12:00 AM')
  })
})
