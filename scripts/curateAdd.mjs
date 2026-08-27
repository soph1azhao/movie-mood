// Movie Mood V5.1 — `pnpm curate:add` maintainer CLI helper.
//
// Reduces manual TMDB lookup and schema-copying work when adding a curated
// movie. It does NOT decide Movie Mood editorial meaning; the maintainer selects
// the candidate and fills in taste/mood fields.
//
// The token is read ONLY from the process environment and is never printed or
// written to generated output. Normal build/test/dev do not require a token.

import { createInterface } from 'node:readline'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import mappings from '../src/data/tmdbMovieMappings.json' with { type: 'json' }
import { runCurate } from './curateCore.mjs'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

// Network: TMDB search. Returns raw `results` array.
async function searchTmdb(query, token) {
  const url = new URL(`${TMDB_BASE_URL}/search/movie`)
  url.searchParams.set('query', query)
  url.searchParams.set('language', 'en-US')

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error(`TMDB authentication/authorization failed with HTTP ${response.status}.`)
  }

  if (!response.ok) {
    throw new Error(`TMDB search failed with HTTP ${response.status}.`)
  }

  const body = await response.json()
  return Array.isArray(body?.results) ? body.results : []
}

// Network: TMDB movie details with credits (for director reference).
// Director is factual; shown for reference only, never editorialized.
async function fetchTmdbDetails(tmdbId, token) {
  const url = new URL(`${TMDB_BASE_URL}/movie/${tmdbId}`)
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('append_to_response', 'credits')

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`TMDB details failed with HTTP ${response.status}.`)
  }

  const body = await response.json()
  const directors = (body?.credits?.crew ?? [])
    .filter((person) => person?.job === 'Director' && person?.name)
    .map((person) => person.name)
  const director = directors.length > 0 ? [...new Set(directors)].join(' & ') : null

  return { director }
}

function prompt(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

// Interactive selection. Never auto-selects; requires an explicit maintainer
// choice, and supports cancellation.
async function selectCandidate(candidates) {
  console.log('\nTMDB candidate matches:')
  candidates.forEach((candidate, index) => {
    const yearLabel = candidate.year ? String(candidate.year) : 'year unknown'
    const hint = candidate.overview ? ` — ${candidate.overview.slice(0, 100)}${candidate.overview.length > 100 ? '…' : ''}` : ''
    console.log(`  [${index + 1}] ${candidate.title} (${yearLabel}) · TMDB ID ${candidate.tmdbId}${hint}`)
  })

  console.log('\nEnter the number of the matching movie, or leave empty to cancel.')
  const raw = await prompt('selection> ')
  const trimmed = raw.trim()

  if (!trimmed) {
    return null
  }

  const index = Number(trimmed) - 1
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    console.error('Invalid selection. No files were modified.')
    process.exitCode = 1
    return null
  }

  return candidates[index]
}

async function writeDraft(draftPath, content) {
  await mkdir('docs/curation-drafts', { recursive: true })
  await writeFile(draftPath, content, 'utf8')
}

async function main() {
  const token = process.env.TMDB_READ_ACCESS_TOKEN

  const query = process.argv.slice(2).join(' ')

  const existingIds = mappings.map((mapping) => mapping.id)
  const existingTmdbIds = mappings.map((mapping) => mapping.tmdbId)

  try {
    const result = await runCurate({
      query,
      token,
      existingIds,
      existingTmdbIds,
      searchFn: searchTmdb,
      detailsFn: fetchTmdbDetails,
      chooseFn: selectCandidate,
      writeFn: writeDraft,
    })

    if (result.kind === 'cancelled') {
      console.log('Cancelled. No files were modified.')
      return
    }

    console.log(`\nDraft written to ${result.draftPath}.`)
    console.log('\nNext steps:')
    console.log('1. Review the draft and fill in the Movie Mood editorial meaning fields.')
    console.log('2. Add the object to src/data/curatedMovies.ts.')
    console.log('3. Add the mapping to src/data/tmdbMovieMappings.json.')
    console.log('4. Run `pnpm sync:tmdb` with TMDB_READ_ACCESS_TOKEN available to refresh facts.')
    console.log('5. Review behavior-impact warnings and the Git diff.')
    console.log('6. Run `pnpm test` and `pnpm build`.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

main()
