import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { movies } from '../dist-sync/data/movies.js'
import mappings from '../src/data/tmdbMovieMappings.json' with { type: 'json' }
import {
  BEHAVIOR_IMPACTING_COMPARISONS,
  DISPLAY_FIELDS,
  buildSnapshot,
  getFieldDifferences,
  normalizeTmdbMovieResponse,
  serializeSnapshot,
} from './tmdbCore.mjs'

const snapshotPath = resolve('src/data/generated/tmdbMovies.json')
const maxAttempts = 3

function redact(message) {
  const token = process.env.TMDB_READ_ACCESS_TOKEN

  if (!token) {
    return String(message)
  }

  return String(message).replaceAll(token, '[redacted]')
}

function getToken() {
  const token = process.env.TMDB_READ_ACCESS_TOKEN

  if (!token) {
    throw new Error('TMDB_READ_ACCESS_TOKEN is missing. Snapshot was not modified.')
  }

  return token
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms)
  })
}

function getRetryDelay(response, attempt) {
  const retryAfter = response.headers.get('retry-after')
  const retrySeconds = retryAfter ? Number(retryAfter) : NaN

  if (Number.isFinite(retrySeconds) && retrySeconds >= 0) {
    return retrySeconds * 1000
  }

  return 250 * 2 ** (attempt - 1)
}

async function fetchMovie(tmdbId, token) {
  const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}`)
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('append_to_response', 'credits')

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`Temporary network failure for TMDB ID ${tmdbId}: ${redact(error.message)}`)
      }

      await delay(250 * 2 ** (attempt - 1))
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`TMDB authentication/authorization failed with HTTP ${response.status}. Snapshot was not modified.`)
    }

    if (response.status === 404) {
      throw new Error(`TMDB ID ${tmdbId} returned HTTP 404. Snapshot was not modified.`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`TMDB ID ${tmdbId} failed after bounded retries with HTTP ${response.status}.`)
      }

      await delay(getRetryDelay(response, attempt))
      continue
    }

    if (!response.ok) {
      throw new Error(`TMDB ID ${tmdbId} failed with HTTP ${response.status}. Snapshot was not modified.`)
    }

    return response.json()
  }

  throw new Error(`TMDB ID ${tmdbId} failed after bounded retries.`)
}

function formatValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

function printDifferences(label, differences) {
  if (differences.length === 0) {
    console.log(`${label}: none`)
    return
  }

  console.log(label)

  for (const difference of differences) {
    console.log(`- ${difference.id} | ${difference.title} | ${difference.field} | ${formatValue(difference.oldValue)} -> ${formatValue(difference.newValue)}`)
  }
}

async function writeSnapshotAtomically(serializedSnapshot) {
  await mkdir(dirname(snapshotPath), { recursive: true })

  const tempPath = `${snapshotPath}.tmp`

  try {
    await writeFile(tempPath, serializedSnapshot)
    await rename(tempPath, snapshotPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function readPreviousSnapshot() {
  try {
    return await readFile(snapshotPath, 'utf8')
  } catch {
    return null
  }
}

async function main() {
  const token = getToken()
  const factsByMovieId = {}

  for (const mapping of mappings) {
    const response = await fetchMovie(mapping.tmdbId, token)
    factsByMovieId[mapping.id] = normalizeTmdbMovieResponse(response, mapping.tmdbId)
  }

  const snapshot = buildSnapshot(movies, mappings, factsByMovieId)
  const serializedSnapshot = serializeSnapshot(snapshot)
  const previousSnapshot = await readPreviousSnapshot()

  const behaviorDifferences = getFieldDifferences(movies, snapshot, BEHAVIOR_IMPACTING_COMPARISONS)
  const displayDifferences = getFieldDifferences(movies, snapshot, DISPLAY_FIELDS)

  await writeSnapshotAtomically(serializedSnapshot)

  console.log(previousSnapshot === serializedSnapshot ? 'TMDB snapshot unchanged.' : 'TMDB snapshot updated.')
  printDifferences('Behavior-impacting differences', behaviorDifferences)
  printDifferences('Display-oriented differences', displayDifferences)
}

main().catch((error) => {
  console.error(redact(error.message))
  process.exitCode = 1
})
