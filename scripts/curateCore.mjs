// Movie Mood V5.1 — Curation Assistant core logic (pure, testable).
//
// This module holds the reusable, side-effect-free helpers used by the
// `pnpm curate:add` maintainer command. Network and filesystem access live in
// the CLI wrapper (scripts/curateAdd.mjs) so this logic can be unit tested
// with mocked TMDB responses and an injected file writer.
//
// Safety guarantees:
// - The assistant never decides Movie Mood editorial meaning (taste/mood).
// - The assistant never writes to the generated TMDB snapshot
//   (src/data/generated/tmdbMovies.json). It only writes curation drafts.

export class CurateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CurateError'
  }
}

// Fields required by the V5 CuratedMovie structure. The scaffold must include
// every one of these so a maintainer can paste it into curatedMovies.ts.
export const CURATED_MOVIE_FIELDS = [
  'id',
  'tmdbId',
  'moods',
  'situations',
  'filterLanguages',
  'pace',
  'emotionalWeight',
  'attentionDemand',
  'discoveryStyle',
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
  'palette',
]

// Suggest a stable local Movie Mood ID from the TMDB title and year.
// Diacritics are stripped and the result is ASCII kebab-case so the ID is
// safe for URLs and data files. The maintainer may review and rename it.
export function suggestLocalId(title, year) {
  const normalized = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  const base = normalized || 'movie'
  const safeYear = year && Number.isInteger(year) && year > 0 ? String(year) : ''

  return safeYear ? `${base}-${safeYear}` : base
}

export function isDuplicateLocalId(id, existingIds) {
  return Array.isArray(existingIds) && existingIds.includes(id)
}

export function isDuplicateTmdbId(tmdbId, existingTmdbIds) {
  return Array.isArray(existingTmdbIds) && existingTmdbIds.includes(tmdbId)
}

// Normalize raw TMDB search/movie responses into minimal disambiguation
// candidates. Malformed or incomplete entries are dropped, never guessed.
export function normalizeSearchResults(results) {
  if (!Array.isArray(results)) {
    return []
  }

  return results
    .filter((result) => result && typeof result.id === 'number' && result.id > 0)
    .map((result) => {
      const releaseDate = typeof result.release_date === 'string' ? result.release_date : ''
      const yearMatch = releaseDate.match(/^(\d{4})/)
      const year = yearMatch ? Number(yearMatch[1]) : null

      return {
        tmdbId: result.id,
        title: typeof result.title === 'string' ? result.title : '',
        year: Number.isInteger(year) ? year : null,
        overview: typeof result.overview === 'string' ? result.overview : '',
      }
    })
}

// Build a Movie Mood editorial scaffold. Editorial fields are left as obvious
// TODO placeholders so the maintainer fills them in with human judgment.
// Factual TMDB identity (tmdbId) is carried through verbatim.
export function buildScaffold(candidate, suggestedId) {
  return {
    id: suggestedId,
    tmdbId: candidate.tmdbId,
    moods: ['TODO: choose 1-3 moods'],
    situations: ['TODO: choose situations'],
    filterLanguages: ['TODO: choose filter language'],
    pace: 'TODO: slow|medium|fast',
    emotionalWeight: 'TODO: light|moderate|heavy',
    attentionDemand: 'TODO: easy|engaged|immersive',
    discoveryStyle: 'TODO: familiar|different|adventurous',
    description: 'TODO: write description',
    whyWatch: 'TODO: write whyWatch',
    curiosityHook: 'TODO: write curiosityHook',
    vibeSummary: 'TODO: write vibeSummary',
    palette: ['#1a1a1a', '#f0f0f0'],
  }
}

// Render a maintainer-facing markdown draft: instructions plus a paste-ready
// TypeScript object. The director (factual, from TMDB) is shown for reference
// only and is not an editorial decision.
export function formatScaffoldAsMarkdown(scaffold, candidate, director = null) {
  const tsObject = [
    '{',
    `  id: ${JSON.stringify(scaffold.id)},`,
    `  tmdbId: ${scaffold.tmdbId},`,
    '',
    `  moods: ${JSON.stringify(scaffold.moods)},`,
    `  situations: ${JSON.stringify(scaffold.situations)},`,
    `  filterLanguages: ${JSON.stringify(scaffold.filterLanguages)},`,
    `  pace: ${JSON.stringify(scaffold.pace)},`,
    `  emotionalWeight: ${JSON.stringify(scaffold.emotionalWeight)},`,
    `  attentionDemand: ${JSON.stringify(scaffold.attentionDemand)},`,
    `  discoveryStyle: ${JSON.stringify(scaffold.discoveryStyle)},`,
    '',
    `  description: ${JSON.stringify(scaffold.description)},`,
    `  whyWatch: ${JSON.stringify(scaffold.whyWatch)},`,
    `  curiosityHook: ${JSON.stringify(scaffold.curiosityHook)},`,
    `  vibeSummary: ${JSON.stringify(scaffold.vibeSummary)},`,
    '',
    `  palette: ${JSON.stringify(scaffold.palette)},`,
    '},',
  ].join('\n')

  const lines = [
    `# Curation draft: ${scaffold.id}`,
    '',
    `Suggested from TMDB candidate: **${candidate.title || 'unknown'}** (${candidate.year ?? 'year unknown'})`,
    director ? `Director (factual, from TMDB): ${director}` : 'Director: populated by `pnpm sync:tmdb` after you add the mapping.',
    '',
    '## What to do',
    '1. Review the scaffold below. Movie Mood meaning fields are marked `TODO` — fill them in with editorial judgment.',
    '2. Add the object to `src/data/curatedMovies.ts`.',
    '3. Add the mapping `{ "id": "<id>", "tmdbId": <tmdbId> }` to `src/data/tmdbMovieMappings.json`.',
    '4. Run `pnpm sync:tmdb` with `TMDB_READ_ACCESS_TOKEN` available to refresh generated facts.',
    '5. Review behavior-impact warnings and the Git diff.',
    '6. Run `pnpm test` and `pnpm build`.',
    '',
    '> Movie Mood owns meaning. TMDB owns facts. Do not automate taste, mood, or editorial interpretation.',
    '',
    '## Scaffold (paste into curatedMovies.ts)',
    '```ts',
    tsObject,
    '```',
    '',
  ]

  return lines.join('\n')
}

// Orchestrate a curation run with injected side effects so the logic is
// testable. `searchFn(query, token)` and `detailsFn(tmdbId, token)` perform
// network calls; `chooseFn(candidates)` performs explicit human selection;
// `writeFn(draftPath, content)` persists the draft.
//
// The function fails clearly and safely (no files written) when the token is
// missing, the query is empty, no candidates are found, the selection is
// cancelled, or the suggested IDs collide with existing data.
export async function runCurate(deps) {
  const {
    query,
    token,
    existingIds = [],
    existingTmdbIds = [],
    searchFn,
    detailsFn,
    chooseFn,
    writeFn,
  } = deps

  if (!token) {
    throw new CurateError('TMDB_READ_ACCESS_TOKEN is missing. No files were modified.')
  }

  const trimmedQuery = typeof query === 'string' ? query.trim() : ''
  if (!trimmedQuery) {
    throw new CurateError('Search query is empty. No files were modified.')
  }

  const results = await searchFn(trimmedQuery, token)
  const candidates = normalizeSearchResults(results)

  if (candidates.length === 0) {
    throw new CurateError(`No TMDB candidates found for "${trimmedQuery}". No files were modified.`)
  }

  const chosen = await chooseFn(candidates)
  if (!chosen) {
    return { kind: 'cancelled' }
  }

  const suggestedId = suggestLocalId(chosen.title, chosen.year)

  if (isDuplicateLocalId(suggestedId, existingIds)) {
    throw new CurateError(
      `Suggested local ID "${suggestedId}" already exists. Rename the candidate or choose a different title/year. No files were modified.`,
    )
  }

  if (isDuplicateTmdbId(chosen.tmdbId, existingTmdbIds)) {
    throw new CurateError(`TMDB ID ${chosen.tmdbId} is already mapped to a curated movie. No files were modified.`)
  }

  let director = null
  if (typeof detailsFn === 'function') {
    try {
      const details = await detailsFn(chosen.tmdbId, token)
      if (details && typeof details.director === 'string' && details.director) {
        director = details.director
      }
    } catch {
      director = null
    }
  }

  const scaffold = buildScaffold(chosen, suggestedId)
  const content = formatScaffoldAsMarkdown(scaffold, chosen, director)
  const draftPath = `docs/curation-drafts/${suggestedId}.md`

  // Structural safety: the assistant writes only curation drafts, never the
  // generated TMDB snapshot.
  if (!draftPath.endsWith('.md') || !draftPath.includes('curation-drafts')) {
    throw new CurateError('Refusing to write outside the curation drafts location.')
  }

  await writeFn(draftPath, content)

  return { kind: 'written', scaffold, draftPath, content }
}
