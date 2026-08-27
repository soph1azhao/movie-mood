import { describe, expect, it } from 'vitest'
import {
  BEHAVIOR_IMPACTING_COMPARISONS,
  buildSnapshot,
  getFieldDifferences,
  normalizeTmdbMovieResponse,
  serializeSnapshot,
  TmdbSyncError,
} from './tmdbCore.mjs'

const movies = [
  {
    id: 'example',
    title: 'Example',
    runtimeMinutes: 100,
    genres: ['Drama'],
    languages: ['English'],
  },
]

const mappings = [{ id: 'example', tmdbId: 123 }]

function validResponse(overrides = {}) {
  return {
    id: 123,
    title: 'Example Movie',
    release_date: '2024-01-02',
    runtime: 108,
    genres: [{ name: 'Drama' }],
    spoken_languages: [{ english_name: 'English', name: 'English' }],
    production_countries: [{ name: 'United States' }],
    poster_path: '/poster.jpg',
    credits: {
      crew: [{ job: 'Director', name: 'Example Director' }],
    },
    ...overrides,
  }
}

describe('tmdb sync core', () => {
  it('normalizes a valid TMDB response deterministically', () => {
    const facts = normalizeTmdbMovieResponse(validResponse({
      genres: [{ name: 'Thriller' }, { name: 'Drama' }, { name: 'Drama' }],
      spoken_languages: [
        { english_name: 'Spanish', name: 'Español' },
        { english_name: 'English', name: 'English' },
      ],
      production_countries: [{ name: 'Canada' }, { name: 'United States' }],
    }), 123)

    expect(facts).toEqual({
      tmdbId: 123,
      title: 'Example Movie',
      year: 2024,
      director: 'Example Director',
      countries: ['Canada', 'United States'],
      spokenLanguages: ['English', 'Spanish'],
      genres: ['Drama', 'Thriller'],
      runtimeMinutes: 108,
      posterPath: '/poster.jpg',
    })
  })

  it('requires the response ID to match the requested TMDB ID', () => {
    expect(() => normalizeTmdbMovieResponse(validResponse({ id: 456 }), 123)).toThrow(TmdbSyncError)
  })

  it('rejects invalid required facts', () => {
    expect(() => normalizeTmdbMovieResponse(validResponse({ title: '' }), 123)).toThrow(TmdbSyncError)
    expect(() => normalizeTmdbMovieResponse(validResponse({ release_date: '' }), 123)).toThrow(TmdbSyncError)
    expect(() => normalizeTmdbMovieResponse(validResponse({ runtime: 0 }), 123)).toThrow(TmdbSyncError)
    expect(() => normalizeTmdbMovieResponse(validResponse({ genres: [] }), 123)).toThrow(TmdbSyncError)
    expect(() => normalizeTmdbMovieResponse(validResponse({ spoken_languages: [] }), 123)).toThrow(TmdbSyncError)
    expect(() => normalizeTmdbMovieResponse(validResponse({ credits: { crew: [] } }), 123)).toThrow(TmdbSyncError)
  })

  it('accepts a null poster path', () => {
    expect(normalizeTmdbMovieResponse(validResponse({ poster_path: null }), 123).posterPath).toBeNull()
  })

  it('rejects duplicate local IDs and duplicate TMDB IDs', () => {
    expect(() => buildSnapshot(
      [...movies, { ...movies[0] }],
      mappings,
      { example: { tmdbId: 123 } },
    )).toThrow(TmdbSyncError)

    expect(() => buildSnapshot(
      [...movies, { ...movies[0], id: 'other' }],
      [...mappings, { id: 'other', tmdbId: 123 }],
      { example: { tmdbId: 123 }, other: { tmdbId: 123 } },
    )).toThrow(TmdbSyncError)
  })

  it('requires one generated fact entry for every curated movie using local IDs', () => {
    expect(() => buildSnapshot(movies, [], {})).toThrow(TmdbSyncError)

    expect(buildSnapshot(movies, mappings, {
      example: { tmdbId: 123, title: 'Example Movie' },
    })).toEqual({
      example: { tmdbId: 123, title: 'Example Movie' },
    })
  })

  it('serializes snapshots deterministically', () => {
    expect(serializeSnapshot({ example: { tmdbId: 123 } })).toBe('{\n  "example": {\n    "tmdbId": 123\n  }\n}\n')
  })

  it('compares behavior-impacting arrays as normalized sets', () => {
    const differences = getFieldDifferences(movies, {
      example: {
        runtimeMinutes: 101,
        genres: ['Drama'],
        languages: ['English'],
      },
    }, BEHAVIOR_IMPACTING_COMPARISONS)

    expect(differences).toEqual([
      {
        id: 'example',
        title: 'Example',
        field: 'runtimeMinutes',
        oldValue: 100,
        newValue: 101,
      },
    ])
  })
})
