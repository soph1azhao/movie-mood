export const BEHAVIOR_IMPACTING_COMPARISONS = [
  { field: 'runtimeMinutes', oldField: 'runtimeMinutes', newField: 'runtimeMinutes' },
  { field: 'genres', oldField: 'genres', newField: 'genres' },
  { field: 'filterLanguages', oldField: 'languages', newField: 'languages', newSource: 'movie' },
]
export const DISPLAY_FIELDS = ['title', 'year', 'director', 'countries', 'spokenLanguages', 'posterPath']

export class TmdbSyncError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TmdbSyncError'
  }
}

export function assertValidMappings(movies, mappings) {
  const movieIds = new Set()
  const mappingIds = new Set()
  const tmdbIds = new Set()

  for (const movie of movies) {
    if (!movie.id || typeof movie.id !== 'string') {
      throw new TmdbSyncError('Invalid/missing local movie ID.')
    }

    if (movieIds.has(movie.id)) {
      throw new TmdbSyncError(`Duplicate local movie ID: ${movie.id}`)
    }

    movieIds.add(movie.id)
  }

  for (const mapping of mappings) {
    if (!mapping.id || typeof mapping.id !== 'string') {
      throw new TmdbSyncError('Invalid/missing mapping movie ID.')
    }

    if (!Number.isInteger(mapping.tmdbId) || mapping.tmdbId <= 0) {
      throw new TmdbSyncError(`Missing/invalid tmdbId for ${mapping.id}.`)
    }

    if (mappingIds.has(mapping.id)) {
      throw new TmdbSyncError(`Duplicate mapping movie ID: ${mapping.id}`)
    }

    if (tmdbIds.has(mapping.tmdbId)) {
      throw new TmdbSyncError(`Duplicate tmdbId: ${mapping.tmdbId}`)
    }

    if (!movieIds.has(mapping.id)) {
      throw new TmdbSyncError(`Mapping does not belong to a curated movie: ${mapping.id}`)
    }

    mappingIds.add(mapping.id)
    tmdbIds.add(mapping.tmdbId)
  }

  if (mappingIds.size !== movieIds.size) {
    const missingIds = [...movieIds].filter((id) => !mappingIds.has(id))
    throw new TmdbSyncError(`Snapshot cannot resolve one-to-one with curated data. Missing: ${missingIds.join(', ')}`)
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TmdbSyncError(`Invalid response structure for ${label}.`)
  }
}

function normalizeString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TmdbSyncError(`Missing/invalid ${label}.`)
  }

  return value.trim()
}

function normalizeUniqueStrings(values, label) {
  if (!Array.isArray(values)) {
    throw new TmdbSyncError(`Malformed required ${label} data.`)
  }

  const normalized = values.map((value) => normalizeString(value, label))
  const unique = [...new Set(normalized)]

  if (unique.length === 0) {
    throw new TmdbSyncError(`Malformed required ${label} data.`)
  }

  return unique.sort((first, second) => first.localeCompare(second))
}

function getYear(releaseDate) {
  if (typeof releaseDate !== 'string') {
    throw new TmdbSyncError('Missing/invalid year.')
  }

  const match = releaseDate.match(/^(\d{4})-\d{2}-\d{2}$/)
  const year = match ? Number(match[1]) : NaN

  if (!Number.isInteger(year) || year <= 0) {
    throw new TmdbSyncError('Missing/invalid year.')
  }

  return year
}

function getDirector(response) {
  const crew = response.credits?.crew

  if (!Array.isArray(crew)) {
    throw new TmdbSyncError('Missing usable director.')
  }

  const directors = crew
    .filter((person) => person?.job === 'Director')
    .map((person) => normalizeString(person.name, 'director'))

  const uniqueDirectors = [...new Set(directors)]

  if (uniqueDirectors.length === 0) {
    throw new TmdbSyncError('Missing usable director.')
  }

  return uniqueDirectors.join(' & ')
}

export function normalizeTmdbMovieResponse(response, requestedTmdbId) {
  assertObject(response, requestedTmdbId)

  if (response.id !== requestedTmdbId) {
    throw new TmdbSyncError(`Response movie ID differs from requested ID: ${requestedTmdbId}`)
  }

  if (!Number.isInteger(response.runtime) || response.runtime <= 0) {
    throw new TmdbSyncError('Missing/invalid runtime.')
  }

  return {
    tmdbId: requestedTmdbId,
    title: normalizeString(response.title, 'title'),
    year: getYear(response.release_date),
    director: getDirector(response),
    countries: normalizeUniqueStrings(
      response.production_countries?.map((country) => country?.name),
      'country',
    ),
    spokenLanguages: normalizeUniqueStrings(
      response.spoken_languages?.map((language) => language?.english_name || language?.name),
      'language',
    ),
    genres: normalizeUniqueStrings(
      response.genres?.map((genre) => genre?.name),
      'genre',
    ),
    runtimeMinutes: response.runtime,
    posterPath: response.poster_path === null ? null : normalizeString(response.poster_path, 'posterPath'),
  }
}

export function buildSnapshot(movies, mappings, factsByMovieId) {
  assertValidMappings(movies, mappings)

  const snapshot = {}

  for (const mapping of mappings) {
    const facts = factsByMovieId[mapping.id]

    if (!facts || typeof facts !== 'object') {
      throw new TmdbSyncError(`Missing generated facts for ${mapping.id}.`)
    }

    if (facts.tmdbId !== mapping.tmdbId) {
      throw new TmdbSyncError(`tmdbId correspondence failed for ${mapping.id}.`)
    }

    snapshot[mapping.id] = facts
  }

  if (Object.keys(snapshot).length !== movies.length) {
    throw new TmdbSyncError('Snapshot count differs from curated movie count.')
  }

  return snapshot
}

export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

function arraysEqualAsSets(first, second) {
  return (
    Array.isArray(first)
    && Array.isArray(second)
    && first.length === second.length
    && first.every((value) => second.includes(value))
  )
}

function valuesEqual(first, second) {
  if (Array.isArray(first) || Array.isArray(second)) {
    return arraysEqualAsSets(first, second)
  }

  return first === second
}

export function getFieldDifferences(movies, snapshot, comparisons) {
  const differences = []

  for (const movie of movies) {
    const facts = snapshot[movie.id]

    if (!facts) {
      throw new TmdbSyncError(`Missing generated facts for ${movie.id}.`)
    }

    for (const comparison of comparisons) {
      const oldField = typeof comparison === 'string' ? comparison : comparison.oldField
      const newField = typeof comparison === 'string' ? comparison : comparison.newField
      const field = typeof comparison === 'string' ? comparison : comparison.field
      const newSource = typeof comparison === 'string' ? facts : comparison.newSource === 'movie' ? movie : facts

      if (!valuesEqual(movie[oldField], newSource[newField])) {
        differences.push({
          id: movie.id,
          title: movie.title,
          field,
          oldValue: movie[oldField],
          newValue: newSource[newField],
        })
      }
    }
  }

  return differences
}
