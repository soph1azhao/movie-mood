import { describe, expect, it } from 'vitest'
import { movies as catalogMovies } from '../data/movies'
import type { Movie } from '../types/movie'
import {
  whyItFitsTonight,
  compareMoviesForDuel,
  getDecisionCompanionCue,
  getPrioritizedDecisionFactors,
  updateDuelFinalistSelection,
} from './decision'

const baseMovie: Movie = {
  id: 'base',
  tmdbId: 1,
  title: 'Base Movie',
  year: 2020,
  director: 'Director',
  countries: ['United States'],
  filterLanguages: ['English'],
  languages: ['English'],
  spokenLanguages: ['English'],
  genres: ['Drama', 'Comedy'],
  runtimeMinutes: 100,
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

function makeMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    ...baseMovie,
    ...overrides,
    id: overrides.id || `movie-${Math.random().toString(36).substr(2, 5)}`,
  }
}

const noCompanionContext = {
  mood: 'funny' as const,
  filters: {
    genres: [],
    runtime: null,
    language: null,
    pace: null,
    emotionalWeight: null,
  },
  discoveryPreferences: {
    attentionDemand: null,
    discoveryStyle: null,
    dealbreakers: {
      avoidHeavy: false,
      avoidSlow: false,
      underTwoHours: false,
    },
  },
}

function getMovieById(id: string) {
  const movie = oracleMovies.find((candidate) => candidate.id === id)

  if (!movie) {
    throw new Error(`Missing oracle fixture ${id}`)
  }

  return movie
}

function oracleSlate(ids: [string, string, string]): [Movie, Movie, Movie] {
  return [getMovieById(ids[0]), getMovieById(ids[1]), getMovieById(ids[2])]
}

function catalogSlate(ids: [string, string, string]): [Movie, Movie, Movie] {
  return ids.map((id) => {
    const movie = catalogMovies.find((candidate) => candidate.id === id)

    if (!movie) {
      throw new Error(`Missing catalog movie ${id}`)
    }

    return movie
  }) as [Movie, Movie, Movie]
}

function permutations<T>(items: [T, T, T]): [T, T, T][] {
  return [
    [items[0], items[1], items[2]],
    [items[0], items[2], items[1]],
    [items[1], items[0], items[2]],
    [items[1], items[2], items[0]],
    [items[2], items[0], items[1]],
    [items[2], items[1], items[0]],
  ]
}

const oracleMovies = [
  makeMovie({ id: 'rear-window', title: 'Rear Window', attentionDemand: 'easy', emotionalWeight: 'moderate', pace: 'slow' }),
  makeMovie({ id: 'children-of-men', title: 'Children of Men', attentionDemand: 'easy', emotionalWeight: 'moderate', pace: 'fast' }),
  makeMovie({ id: 'petite-maman', title: 'Petite Maman', attentionDemand: 'easy', emotionalWeight: 'moderate', pace: 'slow' }),
  makeMovie({ id: 'a-separation', title: 'A Separation', attentionDemand: 'easy', emotionalWeight: 'heavy', pace: 'medium' }),
  makeMovie({ id: 'arrival', title: 'Arrival', attentionDemand: 'immersive', emotionalWeight: 'heavy', pace: 'medium' }),
  makeMovie({ id: 'parasite', title: 'Parasite', attentionDemand: 'easy', emotionalWeight: 'heavy', pace: 'medium' }),
  makeMovie({ id: 'moonlight', title: 'Moonlight', attentionDemand: 'engaged', emotionalWeight: 'heavy', pace: 'slow' }),
  makeMovie({ id: 'shoplifters', title: 'Shoplifters', attentionDemand: 'engaged', emotionalWeight: 'heavy', pace: 'slow' }),
  makeMovie({ id: 'rye-lane', title: 'Rye Lane', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'fast' }),
  makeMovie({ id: 'aftersun', title: 'Aftersun', attentionDemand: 'easy', emotionalWeight: 'heavy', pace: 'medium' }),
  makeMovie({ id: 'spirited-away', title: 'Spirited Away', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'medium' }),
  makeMovie({ id: 'perfect-days', title: 'Perfect Days', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'medium' }),
  makeMovie({ id: 'amelie', title: 'Amelie', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'slow' }),
  makeMovie({ id: 'school-of-rock', title: 'School of Rock', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'slow' }),
  makeMovie({ id: 'edge-of-tomorrow', title: 'Edge of Tomorrow', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'fast' }),
  makeMovie({ id: 'portrait-lady-fire', title: 'Portrait of a Lady on Fire', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'medium' }),
  makeMovie({ id: 'get-out', title: 'Get Out', attentionDemand: 'easy', emotionalWeight: 'heavy', pace: 'medium' }),
  makeMovie({ id: 'inception', title: 'Inception', attentionDemand: 'immersive', emotionalWeight: 'light', pace: 'medium' }),
  makeMovie({ id: 'before-sunrise', title: 'Before Sunrise', attentionDemand: 'engaged', emotionalWeight: 'light', pace: 'medium' }),
  makeMovie({ id: 'my-neighbor-totoro', title: 'My Neighbor Totoro', attentionDemand: 'easy', emotionalWeight: 'light', pace: 'medium' }),
]

describe('getDecisionCompanionCue', () => {
  it('returns null unless exactly three movies are supplied', () => {
    const first = makeMovie({ id: 'first' })
    const second = makeMovie({ id: 'second' })
    const third = makeMovie({ id: 'third' })
    const fourth = makeMovie({ id: 'fourth' })

    expect(getDecisionCompanionCue([first, second], noCompanionContext)).toBeNull()
    expect(getDecisionCompanionCue([first, second, third, fourth], noCompanionContext)).toBeNull()
  })

  it('returns null for uniform dimensions, raw three-way dimensions, and non-collapsed raw categories', () => {
    const uniform = [
      makeMovie({ id: 'first', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 105 }),
      makeMovie({ id: 'second', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 110 }),
      makeMovie({ id: 'third', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 115 }),
    ]
    const threeWay = [
      makeMovie({ id: 'first', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 105 }),
      makeMovie({ id: 'second', attentionDemand: 'engaged', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 110 }),
      makeMovie({ id: 'third', attentionDemand: 'immersive', pace: 'medium', emotionalWeight: 'light', runtimeMinutes: 115 }),
    ]
    const threeWayWeight = [
      makeMovie({ id: 'first', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'light' }),
      makeMovie({ id: 'second', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'third', attentionDemand: 'easy', pace: 'medium', emotionalWeight: 'heavy' }),
    ]

    expect(getDecisionCompanionCue(uniform, noCompanionContext)).toBeNull()
    expect(getDecisionCompanionCue(threeWay, noCompanionContext)).toBeNull()
    expect(getDecisionCompanionCue(threeWayWeight, noCompanionContext)).toBeNull()
  })

  it.each([
    ['easy/easy/engaged', 'engaged', [
      makeMovie({ id: 'easy-1', attentionDemand: 'easy' }),
      makeMovie({ id: 'easy-2', attentionDemand: 'easy' }),
      makeMovie({ id: 'engaged', attentionDemand: 'engaged' }),
    ]],
    ['easy/easy/immersive', 'immersive', [
      makeMovie({ id: 'easy-1', attentionDemand: 'easy' }),
      makeMovie({ id: 'easy-2', attentionDemand: 'easy' }),
      makeMovie({ id: 'immersive', attentionDemand: 'immersive' }),
    ]],
  ])('keeps attention split %s salient', (_label, expectedId, movies) => {
    expect(getDecisionCompanionCue(movies as Movie[], noCompanionContext)?.outlierMovieId).toBe(expectedId)
  })

  it.each([
    ['engaged/engaged/immersive', [
      makeMovie({ id: 'engaged-1', attentionDemand: 'engaged' }),
      makeMovie({ id: 'engaged-2', attentionDemand: 'engaged' }),
      makeMovie({ id: 'immersive', attentionDemand: 'immersive' }),
    ]],
    ['easy/engaged/immersive', [
      makeMovie({ id: 'easy', attentionDemand: 'easy' }),
      makeMovie({ id: 'engaged', attentionDemand: 'engaged' }),
      makeMovie({ id: 'immersive', attentionDemand: 'immersive' }),
    ]],
  ])('discards non-salient or raw three-way attention split %s', (_label, movies) => {
    expect(getDecisionCompanionCue(movies as Movie[], noCompanionContext)).toBeNull()
  })

  it.each([
    ['moderate/moderate/heavy', 'heavy', [
      makeMovie({ id: 'moderate-1', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'moderate-2', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'heavy', emotionalWeight: 'heavy' }),
    ]],
    ['light/light/heavy', 'heavy', [
      makeMovie({ id: 'light-1', emotionalWeight: 'light' }),
      makeMovie({ id: 'light-2', emotionalWeight: 'light' }),
      makeMovie({ id: 'heavy', emotionalWeight: 'heavy' }),
    ]],
  ])('keeps emotional split %s salient', (_label, expectedId, movies) => {
    expect(getDecisionCompanionCue(movies as Movie[], noCompanionContext)?.outlierMovieId).toBe(expectedId)
  })

  it.each([
    ['light/light/moderate', [
      makeMovie({ id: 'light-1', emotionalWeight: 'light' }),
      makeMovie({ id: 'light-2', emotionalWeight: 'light' }),
      makeMovie({ id: 'moderate', emotionalWeight: 'moderate' }),
    ]],
    ['light/moderate/heavy', [
      makeMovie({ id: 'light', emotionalWeight: 'light' }),
      makeMovie({ id: 'moderate', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'heavy', emotionalWeight: 'heavy' }),
    ]],
  ])('discards non-salient or raw three-way emotional split %s', (_label, movies) => {
    expect(getDecisionCompanionCue(movies as Movie[], noCompanionContext)).toBeNull()
  })

  it('keeps only slow/fast pace salient', () => {
    expect(getDecisionCompanionCue([
      makeMovie({ id: 'slow-1', pace: 'slow' }),
      makeMovie({ id: 'slow-2', pace: 'slow' }),
      makeMovie({ id: 'fast', pace: 'fast' }),
    ], noCompanionContext)?.outlierMovieId).toBe('fast')

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'slow-1', pace: 'slow' }),
      makeMovie({ id: 'slow-2', pace: 'slow' }),
      makeMovie({ id: 'medium', pace: 'medium' }),
    ], noCompanionContext)).toBeNull()

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'medium-1', pace: 'medium' }),
      makeMovie({ id: 'medium-2', pace: 'medium' }),
      makeMovie({ id: 'fast', pace: 'fast' }),
    ], noCompanionContext)).toBeNull()
  })

  it('never creates a cue from runtime-only distinction', () => {
    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', runtimeMinutes: 82 }),
      makeMovie({ id: 'second', runtimeMinutes: 84 }),
      makeMovie({ id: 'third', runtimeMinutes: 148 }),
    ], noCompanionContext)).toBeNull()
  })

  it('removes context-redundant splits before salience', () => {
    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', attentionDemand: 'easy' }),
      makeMovie({ id: 'second', attentionDemand: 'easy' }),
      makeMovie({ id: 'third', attentionDemand: 'engaged' }),
    ], {
      ...noCompanionContext,
      discoveryPreferences: {
        ...noCompanionContext.discoveryPreferences,
        attentionDemand: 'easy',
      },
    })).toBeNull()

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'second', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'third', emotionalWeight: 'heavy' }),
    ], {
      ...noCompanionContext,
      filters: { ...noCompanionContext.filters, emotionalWeight: 'moderate' },
    })).toBeNull()

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'second', emotionalWeight: 'moderate' }),
      makeMovie({ id: 'third', emotionalWeight: 'heavy' }),
    ], {
      ...noCompanionContext,
      discoveryPreferences: {
        ...noCompanionContext.discoveryPreferences,
        dealbreakers: { avoidHeavy: true, avoidSlow: false, underTwoHours: false },
      },
    })).toBeNull()

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', pace: 'slow' }),
      makeMovie({ id: 'second', pace: 'slow' }),
      makeMovie({ id: 'third', pace: 'fast' }),
    ], {
      ...noCompanionContext,
      filters: { ...noCompanionContext.filters, pace: 'fast' },
    })).toBeNull()

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', pace: 'slow' }),
      makeMovie({ id: 'second', pace: 'slow' }),
      makeMovie({ id: 'third', pace: 'fast' }),
    ], {
      ...noCompanionContext,
      discoveryPreferences: {
        ...noCompanionContext.discoveryPreferences,
        dealbreakers: { avoidHeavy: false, avoidSlow: true, underTwoHours: false },
      },
    })).toBeNull()
  })

  it('applies salience before coherence so weak conflicts cannot veto strong ones', () => {
    const cue = getDecisionCompanionCue([
      makeMovie({ id: 'first', attentionDemand: 'engaged', emotionalWeight: 'light' }),
      makeMovie({ id: 'second', attentionDemand: 'engaged', emotionalWeight: 'light' }),
      makeMovie({ id: 'third', attentionDemand: 'immersive', emotionalWeight: 'heavy' }),
    ], noCompanionContext)

    expect(cue?.outlierMovieId).toBe('third')
    expect(cue?.salientDimensions).toEqual(['emotionalWeight'])
  })

  it('returns a cue for multiple salient splits with the same outlier', () => {
    const cue = getDecisionCompanionCue([
      makeMovie({ id: 'first', attentionDemand: 'easy', emotionalWeight: 'light' }),
      makeMovie({ id: 'second', attentionDemand: 'easy', emotionalWeight: 'light' }),
      makeMovie({ id: 'third', attentionDemand: 'immersive', emotionalWeight: 'heavy' }),
    ], noCompanionContext)

    expect(cue).toEqual(expect.objectContaining({
      outlierMovieId: 'third',
      majorityMovieIds: ['first', 'second'],
      salientDimensions: ['attentionDemand', 'emotionalWeight'],
    }))
  })

  it('returns silence for conflicting salient outliers', () => {
    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', attentionDemand: 'engaged', emotionalWeight: 'light' }),
      makeMovie({ id: 'second', attentionDemand: 'easy', emotionalWeight: 'heavy' }),
      makeMovie({ id: 'third', attentionDemand: 'easy', emotionalWeight: 'light' }),
    ], noCompanionContext)).toBeNull()
  })

  it('describes the outlier without quality, warning, or enum-label copy', () => {
    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', attentionDemand: 'immersive' }),
      makeMovie({ id: 'second', attentionDemand: 'immersive' }),
      makeMovie({ id: 'third', attentionDemand: 'easy' }),
    ], noCompanionContext)?.observation).toBe(
      'It asks less of your attention than the other two.',
    )

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', pace: 'slow' }),
      makeMovie({ id: 'second', pace: 'slow' }),
      makeMovie({ id: 'third', pace: 'fast' }),
    ], noCompanionContext)?.observation).toBe(
      'It moves at a much quicker clip; the other two take their time.',
    )

    expect(getDecisionCompanionCue([
      makeMovie({ id: 'first', emotionalWeight: 'light' }),
      makeMovie({ id: 'second', emotionalWeight: 'light' }),
      makeMovie({ id: 'third', emotionalWeight: 'heavy' }),
    ], noCompanionContext)?.observation).toBe(
      'It carries a heavier emotional charge than the other two.',
    )
  })

  it('is invariant under slate permutation and never chooses a majority survivor by array order', () => {
    const baseSlate = [
      makeMovie({ id: 'majority-a', pace: 'slow' }),
      makeMovie({ id: 'majority-b', pace: 'slow' }),
      makeMovie({ id: 'outlier', pace: 'fast' }),
    ] as [Movie, Movie, Movie]

    for (const permutedSlate of permutations(baseSlate)) {
      const cue = getDecisionCompanionCue(permutedSlate, noCompanionContext)
      expect(cue?.outlierMovieId).toBe('outlier')
      expect(new Set(cue?.majorityMovieIds)).toEqual(new Set(['majority-a', 'majority-b']))
    }
  })

  it('matches the locked A-H behavioral oracle', () => {
    const cases: Array<[[string, string, string], string | null]> = [
      [['rear-window', 'children-of-men', 'petite-maman'], 'children-of-men'],
      [['a-separation', 'arrival', 'parasite'], 'arrival'],
      [['moonlight', 'shoplifters', 'rye-lane'], 'rye-lane'],
      [['aftersun', 'spirited-away', 'perfect-days'], 'aftersun'],
      [['amelie', 'school-of-rock', 'edge-of-tomorrow'], 'edge-of-tomorrow'],
      [['portrait-lady-fire', 'get-out', 'inception'], null],
      [['before-sunrise', 'perfect-days', 'my-neighbor-totoro'], 'before-sunrise'],
      [['shoplifters', 'rye-lane', 'petite-maman'], null],
    ]

    for (const [ids, expectedOutlierMovieId] of cases) {
      expect(getDecisionCompanionCue(oracleSlate(ids), noCompanionContext)?.outlierMovieId ?? null).toBe(expectedOutlierMovieId)
    }
  })

  it('matches the locked A-H behavioral oracle against the current catalog', () => {
    const cases: Array<[[string, string, string], string | null]> = [
      [['rear-window', 'children-of-men', 'petite-maman-2021'], 'children-of-men'],
      [['a-separation-2011', 'arrival', 'parasite'], 'arrival'],
      [['moonlight', 'shoplifters', 'rye-lane-2023'], 'rye-lane-2023'],
      [['aftersun', 'spirited-away', 'perfect-days'], 'aftersun'],
      [['amelie', 'school-of-rock', 'edge-of-tomorrow'], 'edge-of-tomorrow'],
      [['portrait-lady-fire', 'get-out', 'inception'], null],
      [['before-sunrise', 'perfect-days', 'my-neighbor-totoro'], 'before-sunrise'],
      [['shoplifters', 'rye-lane-2023', 'petite-maman-2021'], null],
    ]

    for (const [ids, expectedOutlierMovieId] of cases) {
      expect(getDecisionCompanionCue(catalogSlate(ids), noCompanionContext)?.outlierMovieId ?? null).toBe(expectedOutlierMovieId)
    }
  })
})

describe('whyItFitsTonight', () => {
  it('returns reasons for mood match', () => {
    const movie = makeMovie({ moods: ['funny', 'relaxing'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('fits your funny mood')
  })

  it('returns reasons for situation match', () => {
    const movie = makeMovie({ moods: ['funny'], situations: ['friends', 'date-night'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: 'friends',
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('perfect for friends')
  })

  it('returns reasons for attention demand match', () => {
    const movie = makeMovie({ moods: ['funny'], attentionDemand: 'engaged' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: 'engaged',
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('matches the engaging headspace')
  })

  it('returns reasons for discovery style match', () => {
    const movie = makeMovie({ moods: ['funny'], discoveryStyle: 'different' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: 'different',
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toContain('keeps things different')
  })

  it('returns reasons for pace match', () => {
    const movie = makeMovie({ moods: ['funny'], pace: 'fast' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: 'fast',
      emotionalWeight: null,
    })

    expect(reasons).toContain('leans faster')
  })

  it('returns reasons for emotional weight match', () => {
    const movie = makeMovie({ moods: ['funny'], emotionalWeight: 'light' })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: 'light',
    })

    expect(reasons).toContain('stays lighter')
  })

  it('returns multiple reasons when multiple preferences match', () => {
    const movie = makeMovie({
      moods: ['funny'],
      situations: ['friends'],
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
      pace: 'fast',
      emotionalWeight: 'light',
    })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: 'friends',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
      pace: 'fast',
      emotionalWeight: 'light',
    })

    expect(reasons).toHaveLength(6)
    expect(reasons).toContain('fits your funny mood')
    expect(reasons).toContain('perfect for friends')
    expect(reasons).toContain('matches the engaging headspace')
    expect(reasons).toContain('keeps things familiar')
    expect(reasons).toContain('leans faster')
    expect(reasons).toContain('stays lighter')
  })

  it('returns empty array when no preferences match', () => {
    const movie = makeMovie({ moods: ['thoughtful'] })
    const reasons = whyItFitsTonight(movie, {
      mood: 'funny',
      situation: null,
      attentionDemand: null,
      discoveryStyle: null,
      pace: null,
      emotionalWeight: null,
    })

    expect(reasons).toEqual([])
  })
})

describe('compareMoviesForDuel', () => {
  it('shows mood differences', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny', 'relaxing'],
      genres: ['Comedy'],
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['suspenseful'],
      genres: ['Thriller'],
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toHaveLength(2) // mood and genre
    expect(result.differences.map((d) => d.category)).toContain('mood')
    expect(result.differences.map((d) => d.category)).toContain('genre')
  })

  it('shows pace differences', () => {
    const first = makeMovie({ id: 'movie-1', title: 'Fast Movie', moods: ['funny'], pace: 'fast' })
    const second = makeMovie({ id: 'movie-2', title: 'Slow Movie', moods: ['funny'], pace: 'slow' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'pace',
        firstValue: 'faster',
        secondValue: 'slower',
        summary: 'Fast Movie moves faster; Slow Movie takes its time.',
      }),
    ])
  })

  it('shows emotional weight differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], emotionalWeight: 'light' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], emotionalWeight: 'heavy' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'emotional weight',
        firstValue: 'lighter',
        secondValue: 'heavier',
      }),
    ])
  })

  it('shows attention demand differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], attentionDemand: 'easy' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], attentionDemand: 'immersive' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'attention',
        firstValue: 'easygoing',
        secondValue: 'immersive',
      }),
    ])
  })

  it('shows discovery style differences', () => {
    const first = makeMovie({ id: 'movie-1', moods: ['funny'], discoveryStyle: 'familiar' })
    const second = makeMovie({ id: 'movie-2', moods: ['funny'], discoveryStyle: 'adventurous' })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([
      expect.objectContaining({
        category: 'style',
        firstValue: 'familiar',
        secondValue: 'adventurous',
      }),
    ])
  })

  it('returns empty differences when movies are identical', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny'],
      genres: ['Comedy'],
      pace: 'fast',
      emotionalWeight: 'light',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['funny'],
      genres: ['Comedy'],
      pace: 'fast',
      emotionalWeight: 'light',
      attentionDemand: 'engaged',
      discoveryStyle: 'familiar',
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    expect(result.differences).toEqual([])
  })

  it('excludes shared moods from difference display', () => {
    const first = makeMovie({
      id: 'movie-1',
      moods: ['funny', 'relaxing'],
      genres: ['Comedy'],
    })
    const second = makeMovie({
      id: 'movie-2',
      moods: ['funny', 'suspenseful'],
      genres: ['Thriller'],
    })

    const result = compareMoviesForDuel(first, second, { mood: 'funny' })

    // Both share 'funny' mood, so moods only differ in unique values (relaxing vs suspenseful)
    // But we're not comparing mood values directly in the current implementation
    expect(result.differences).toHaveLength(2) // mood unique values + genres
  })
})

describe('getPrioritizedDecisionFactors', () => {
  it('prioritizes attention differences when attention preference is active', () => {
    const first = makeMovie({ id: 'first', attentionDemand: 'easy', pace: 'slow' })
    const second = makeMovie({ id: 'second', attentionDemand: 'immersive', pace: 'fast' })

    const result = getPrioritizedDecisionFactors(first, second, {
      mood: 'funny',
      discoveryPreferences: {
        attentionDemand: 'easy',
        discoveryStyle: null,
        dealbreakers: {
          avoidHeavy: false,
          avoidSlow: false,
          underTwoHours: false,
        },
      },
    })

    expect(result.map((difference) => difference.category)).toEqual(['attention', 'pace'])
  })

  it('prioritizes emotional-ease differences when an emotional boundary is active', () => {
    const first = makeMovie({ id: 'first', emotionalWeight: 'light', pace: 'slow' })
    const second = makeMovie({ id: 'second', emotionalWeight: 'heavy', pace: 'fast' })

    const result = getPrioritizedDecisionFactors(first, second, {
      mood: 'relaxing',
      discoveryPreferences: {
        attentionDemand: null,
        discoveryStyle: null,
        dealbreakers: {
          avoidHeavy: true,
          avoidSlow: false,
          underTwoHours: false,
        },
      },
    })

    expect(result[0]).toEqual(expect.objectContaining({ category: 'emotional weight' }))
  })

  it('prioritizes discovery differences when discovery preference is active', () => {
    const first = makeMovie({ id: 'first', discoveryStyle: 'familiar', pace: 'slow' })
    const second = makeMovie({ id: 'second', discoveryStyle: 'adventurous', pace: 'fast' })

    const result = getPrioritizedDecisionFactors(first, second, {
      mood: 'thoughtful',
      discoveryPreferences: {
        attentionDemand: null,
        discoveryStyle: 'adventurous',
        dealbreakers: {
          avoidHeavy: false,
          avoidSlow: false,
          underTwoHours: false,
        },
      },
    })

    expect(result.map((difference) => difference.category)).toEqual(['style', 'pace'])
  })

  it('does not double-count overlapping ease signals independently', () => {
    const first = makeMovie({
      id: 'first',
      title: 'First',
      moods: ['relaxing'],
      attentionDemand: 'easy',
      emotionalWeight: 'light',
      pace: 'medium',
    })
    const second = makeMovie({
      id: 'second',
      title: 'Second',
      moods: ['relaxing'],
      attentionDemand: 'immersive',
      emotionalWeight: 'heavy',
      pace: 'fast',
    })

    const result = getPrioritizedDecisionFactors(first, second, {
      mood: 'relaxing',
      filters: {
        genres: [],
        runtime: null,
        language: null,
        pace: null,
        emotionalWeight: null,
      },
      discoveryPreferences: {
        attentionDemand: 'easy',
        discoveryStyle: null,
        dealbreakers: {
          avoidHeavy: true,
          avoidSlow: false,
          underTwoHours: false,
        },
      },
    })

    expect(result.map((difference) => difference.category)).toEqual(['attention', 'pace'])
    expect(result[0].summary).toBe('First is the gentler, lower-effort watch tonight.')
  })

  it('does not let inactive preferences distort priority', () => {
    const first = makeMovie({
      id: 'first',
      attentionDemand: 'easy',
      emotionalWeight: 'light',
      pace: 'slow',
    })
    const second = makeMovie({
      id: 'second',
      attentionDemand: 'immersive',
      emotionalWeight: 'heavy',
      pace: 'fast',
    })

    const result = getPrioritizedDecisionFactors(first, second, { mood: 'funny' })

    expect(result.map((difference) => difference.category)).toEqual(['pace', 'emotional weight'])
  })

  it('falls back to pace and runtime when more relevant active dimensions do not differ', () => {
    const first = makeMovie({
      id: 'first',
      attentionDemand: 'easy',
      discoveryStyle: 'familiar',
      pace: 'slow',
      runtimeMinutes: 92,
    })
    const second = makeMovie({
      id: 'second',
      attentionDemand: 'easy',
      discoveryStyle: 'familiar',
      pace: 'fast',
      runtimeMinutes: 142,
    })

    const result = getPrioritizedDecisionFactors(first, second, {
      mood: 'funny',
      discoveryPreferences: {
        attentionDemand: 'easy',
        discoveryStyle: 'familiar',
        dealbreakers: {
          avoidHeavy: false,
          avoidSlow: false,
          underTwoHours: false,
        },
      },
    })

    expect(result.map((difference) => difference.category)).toEqual(['pace', 'runtime'])
  })

  it('summarizes meaningful runtime differences without medium-length filler', () => {
    const first = makeMovie({
      id: 'shorter',
      title: 'Shorter Movie',
      runtimeMinutes: 101,
      pace: 'medium',
      emotionalWeight: 'moderate',
    })
    const second = makeMovie({
      id: 'longer',
      title: 'Longer Movie',
      runtimeMinutes: 122,
      pace: 'medium',
      emotionalWeight: 'moderate',
    })

    const result = getPrioritizedDecisionFactors(first, second, { mood: 'funny' })

    expect(result[0]).toEqual(expect.objectContaining({
      category: 'runtime',
      summary: 'Longer Movie asks for about 21 more minutes.',
    }))
    expect(result[0].summary).not.toContain('medium length')
  })

  it('omits runtime summaries when the difference is too small to help decide', () => {
    const first = makeMovie({ id: 'first', runtimeMinutes: 101, pace: 'medium' })
    const second = makeMovie({ id: 'second', runtimeMinutes: 106, pace: 'medium' })

    const result = getPrioritizedDecisionFactors(first, second, { mood: 'funny' })

    expect(result[0]).toEqual(expect.objectContaining({
      category: 'runtime',
      summary: undefined,
    }))
  })

  it('keeps ordering deterministic', () => {
    const first = makeMovie({
      id: 'first',
      genres: ['Comedy'],
      runtimeMinutes: 90,
      pace: 'slow',
      emotionalWeight: 'light',
      attentionDemand: 'easy',
      discoveryStyle: 'familiar',
    })
    const second = makeMovie({
      id: 'second',
      genres: ['Thriller'],
      runtimeMinutes: 145,
      pace: 'fast',
      emotionalWeight: 'heavy',
      attentionDemand: 'immersive',
      discoveryStyle: 'adventurous',
    })
    const context = {
      mood: 'suspenseful' as const,
      filters: {
        genres: [],
        runtime: 'short' as const,
        language: null,
        pace: null,
        emotionalWeight: null,
      },
      discoveryPreferences: {
        attentionDemand: null,
        discoveryStyle: 'different' as const,
        dealbreakers: {
          avoidHeavy: false,
          avoidSlow: false,
          underTwoHours: true,
        },
      },
    }

    expect(getPrioritizedDecisionFactors(first, second, context)).toEqual(
      getPrioritizedDecisionFactors(first, second, context),
    )
    expect(getPrioritizedDecisionFactors(first, second, context).map((difference) => difference.category)).toEqual([
      'style',
      'runtime',
    ])
  })
})

describe('updateDuelFinalistSelection', () => {
  it('adds finalists until two are selected', () => {
    expect(updateDuelFinalistSelection([], 'first')).toEqual(['first'])
    expect(updateDuelFinalistSelection(['first'], 'second')).toEqual(['first', 'second'])
  })

  it('removes an already-selected finalist', () => {
    expect(updateDuelFinalistSelection(['first', 'second'], 'first')).toEqual(['second'])
  })

  it('does not replace a finalist when two are already selected', () => {
    expect(updateDuelFinalistSelection(['first', 'second'], 'third')).toEqual(['first', 'second'])
  })
})
