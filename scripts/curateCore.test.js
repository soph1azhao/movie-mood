import { describe, expect, it, vi } from 'vitest'
import {
  buildScaffold,
  CurateError,
  formatScaffoldAsMarkdown,
  isDuplicateLocalId,
  isDuplicateTmdbId,
  normalizeSearchResults,
  suggestLocalId,
  runCurate,
} from './curateCore.mjs'

describe('curation assistant — local ID suggestion', () => {
  it('suggests an ASCII kebab ID from title and year', () => {
    expect(suggestLocalId('Perfect Blue', 1998)).toBe('perfect-blue-1998')
  })

  it('falls back to title-only ID when year is missing', () => {
    expect(suggestLocalId('Some Title', null)).toBe('some-title')
  })

  it('strips diacritics and non-alphanumeric characters', () => {
    expect(suggestLocalId('Café Noir', 2020)).toBe('cafe-noir-2020')
  })

  it('handles empty or invalid titles without crashing', () => {
    expect(suggestLocalId('', 2020)).toBe('movie-2020')
    expect(suggestLocalId('   ', 2020)).toBe('movie-2020')
  })

  it('truncates very long titles deterministically', () => {
    const long = 'a'.repeat(60)
    const suggested = suggestLocalId(long, 2001)
    // Result is the first 40 chars of kebab-case, plus year suffix.
    expect(suggested.endsWith('-2001')).toBe(true)
    expect(suggested.length).toBeLessThan(60)
  })
})

describe('curation assistant — duplicate detection', () => {
  it('detects a duplicate local ID', () => {
    expect(isDuplicateLocalId('perfect-blue', ['perfect-blue', 'other'])).toBe(true)
    expect(isDuplicateLocalId('perfect-blue', ['other'])).toBe(false)
  })

  it('detects a duplicate TMDB ID', () => {
    expect(isDuplicateTmdbId(4893, [4893, 10])).toBe(true)
    expect(isDuplicateTmdbId(4893, [10])).toBe(false)
  })
})

describe('curation assistant — candidate normalization', () => {
  it('normalizes valid TMDB search results', () => {
    const results = [
      { id: 1, title: 'A', release_date: '1998-01-01', overview: 'x' },
      { id: 2, title: 'B' }, // no release_date -> year null
    ]

    const normalized = normalizeSearchResults(results)

    expect(normalized).toEqual([
      { tmdbId: 1, title: 'A', year: 1998, overview: 'x' },
      { tmdbId: 2, title: 'B', year: null, overview: '' },
    ])
  })

  it('drops malformed entries without guessing', () => {
    const results = [
      { id: 1, title: 'Valid' },
      { id: null, title: 'No id' },
      { title: 'No id field' },
      {},
      null,
    ]

    expect(normalizeSearchResults(results)).toHaveLength(1)
    expect(normalizeSearchResults(results)[0].tmdbId).toBe(1)
  })

  it('returns an empty array for non-array input', () => {
    expect(normalizeSearchResults(null)).toEqual([])
    expect(normalizeSearchResults(undefined)).toEqual([])
    expect(normalizeSearchResults('not-a-list')).toEqual([])
  })
})

describe('curation assistant — scaffold generation', () => {
  const candidate = { tmdbId: 4893, title: 'Perfect Blue', year: 1998, overview: '' }

  it('includes all required CuratedMovie fields', () => {
    const scaffold = buildScaffold(candidate, 'perfect-blue-1998')

    for (const field of [
      'id', 'tmdbId', 'moods', 'situations', 'filterLanguages', 'pace',
      'emotionalWeight', 'attentionDemand', 'discoveryStyle', 'description',
      'whyWatch', 'curiosityHook', 'vibeSummary', 'palette',
    ]) {
      expect(scaffold).toHaveProperty(field)
    }
  })

  it('carries the factual TMDB id and the suggested local id through', () => {
    const scaffold = buildScaffold(candidate, 'perfect-blue-1998')
    expect(scaffold.tmdbId).toBe(4893)
    expect(scaffold.id).toBe('perfect-blue-1998')
  })

  it('does not auto-fill editorial meaning fields', () => {
    const scaffold = buildScaffold(candidate, 'perfect-blue-1998')

    expect(scaffold.moods[0]).toContain('TODO')
    expect(scaffold.pace).toContain('TODO')
    expect(scaffold.emotionalWeight).toContain('TODO')
    expect(scaffold.whyWatch).toContain('TODO')
    expect(scaffold.vibeSummary).toContain('TODO')
    expect(scaffold.filterLanguages[0]).toContain('TODO')
  })

  it('includes the required fields in the markdown draft', () => {
    const scaffold = buildScaffold(candidate, 'perfect-blue-1998')
    const markdown = formatScaffoldAsMarkdown(scaffold, candidate, 'Satoshi Kon')

    expect(markdown).toContain('id')
    expect(markdown).toContain('tmdbId')
    expect(markdown).toContain('moods')
    expect(markdown).toContain('whyWatch')
    expect(markdown).toContain('curiosityHook')
    expect(markdown).toContain('palette')
    expect(markdown).toContain('```ts')
  })

  it('lists the next steps including sync:tmdb', () => {
    const scaffold = buildScaffold(candidate, 'perfect-blue-1998')
    const markdown = formatScaffoldAsMarkdown(scaffold, candidate, 'Satoshi Kon')

    expect(markdown).toContain('curatedMovies.ts')
    expect(markdown).toContain('tmdbMovieMappings.json')
    expect(markdown).toContain('sync:tmdb')
    expect(markdown).toContain('pnpm test')
    expect(markdown).toContain('pnpm build')
  })
})

describe('curation assistant — runCurate orchestration', () => {
  const mkDeps = (overrides = {}) => ({
    query: 'Perfect Blue',
    token: 'fake-token',
    existingIds: [],
    existingTmdbIds: [],
    searchFn: vi.fn(),
    detailsFn: vi.fn(),
    chooseFn: vi.fn(),
    writeFn: vi.fn(),
    ...overrides,
  })

  it('fails clearly and safely when the token is missing', async () => {
    const deps = mkDeps({ token: '', searchFn: vi.fn() })

    await expect(runCurate(deps)).rejects.toThrow(CurateError)
    await expect(runCurate(deps)).rejects.toThrow(/missing/)
    expect(deps.searchFn).not.toHaveBeenCalled()
  })

  it('fails on an empty search query without network calls', async () => {
    const deps = mkDeps({ query: '   ', searchFn: vi.fn() })

    await expect(runCurate(deps)).rejects.toThrow(CurateError)
    expect(deps.searchFn).not.toHaveBeenCalled()
  })

  it('fails when no candidates are found', async () => {
    const deps = mkDeps({ searchFn: vi.fn().mockResolvedValue([]) })

    await expect(runCurate(deps)).rejects.toThrow(/No TMDB candidates/)
    expect(deps.writeFn).not.toHaveBeenCalled()
  })

  it('returns cancelled when the maintainer cancels selection and writes nothing', async () => {
    const deps = mkDeps({
      searchFn: vi.fn().mockResolvedValue([{ id: 4893, title: 'Perfect Blue', release_date: '1998-01-01' }]),
      chooseFn: vi.fn().mockResolvedValue(null),
    })

    const result = await runCurate(deps)

    expect(result).toEqual({ kind: 'cancelled' })
    expect(deps.writeFn).not.toHaveBeenCalled()
  })

  it('writes a draft on success and never touches the generated TMDB snapshot', async () => {
    const writtenPaths = []
    const writtenContents = []
    const deps = mkDeps({
      searchFn: vi.fn().mockResolvedValue([{
        id: 4893, title: 'Perfect Blue', release_date: '1998-01-01', overview: 'A psychological thriller.',
      }]),
      detailsFn: vi.fn().mockResolvedValue({ director: 'Satoshi Kon' }),
      chooseFn: vi.fn().mockResolvedValue({ tmdbId: 4893, title: 'Perfect Blue', year: 1998, overview: 'A psychological thriller.' }),
      writeFn: vi.fn().mockImplementation(async (path, content) => {
        writtenPaths.push(path)
        writtenContents.push(content)
      }),
    })

    const result = await runCurate(deps)

    expect(result.kind).toBe('written')
    expect(writtenPaths).toEqual(['docs/curation-drafts/perfect-blue-1998.md'])
    expect(writtenContents[0]).toContain('```ts')
    // Must never write to the generated TMDB factual snapshot.
    expect(writtenPaths).not.toContain('src/data/generated/tmdbMovies.json')
  })

  it('rejects a duplicate suggested local ID before writing', async () => {
    const deps = mkDeps({
      existingIds: ['perfect-blue-1998'],
      searchFn: vi.fn().mockResolvedValue([{
        id: 4893, title: 'Perfect Blue', release_date: '1998-01-01', overview: '',
      }]),
      chooseFn: vi.fn().mockResolvedValue({ tmdbId: 4893, title: 'Perfect Blue', year: 1998, overview: '' }),
      writeFn: vi.fn(),
    })

    await expect(runCurate(deps)).rejects.toThrow(/already exists/)
    expect(deps.writeFn).not.toHaveBeenCalled()
  })

  it('rejects a duplicate TMDB ID before writing', async () => {
    const deps = mkDeps({
      existingTmdbIds: [4893],
      searchFn: vi.fn().mockResolvedValue([{
        id: 3, title: 'Perfect Blue', release_date: '1998-01-01', overview: '',
      }]),
      chooseFn: vi.fn().mockResolvedValue({ tmdbId: 4893, title: 'Perfect Blue', year: 1998, overview: '' }),
      writeFn: vi.fn(),
    })

    await expect(runCurate(deps)).rejects.toThrow(/already mapped/)
    expect(deps.writeFn).not.toHaveBeenCalled()
  })

  it('normalizes search results before selecting', async () => {
    const searchFn = vi.fn().mockResolvedValue([
      { id: 4893, title: 'Perfect Blue', release_date: '1998-01-01', overview: 'x' },
      { id: null, title: 'Invalid' },
    ])
    const deps = mkDeps({
      searchFn,
      chooseFn: vi.fn().mockResolvedValue({ tmdbId: 4893, title: 'Perfect Blue', year: 1998, overview: 'x' }),
      writeFn: vi.fn().mockResolvedValue(undefined),
    })

    await runCurate(deps)

    expect(searchFn).toHaveBeenCalled()
    expect(deps.chooseFn.mock.calls[0][0]).toHaveLength(1)
    expect(deps.chooseFn.mock.calls[0][0][0].tmdbId).toBe(4893)
  })
})
