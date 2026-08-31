import { createHash } from 'node:crypto'
import { normalizeTmdbMovieResponse } from '../../scripts/tmdbCore.mjs'

export const TMDB_FACTS_SCHEMA_VERSION = 'tmdb-facts.v1'
export const TMDB_REQUEST_VERSION = 'tmdb-movie-details.v2'
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
export const TMDB_POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500'

export class TmdbProviderError extends Error {
  code: string
  status: number | null
  retryable: boolean

  constructor(
    message: string,
    {
      code = 'TMDB_PROVIDER_ERROR',
      status = null,
      retryable = false,
    }: {
      code?: string
      status?: number | null
      retryable?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'TmdbProviderError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

export function redactSecret(message: unknown, secret: string | null | undefined): string {
  const text = String(message)
  if (!secret) return text
  return text.replaceAll(secret, '[redacted]')
}

export function getRetryDelayMs(response: { headers?: { get?: (name: string) => string | null } }, attempt: number): number {
  const retryAfter = response.headers?.get?.('retry-after') ?? response.headers?.get?.('Retry-After') ?? null
  const retrySeconds = retryAfter ? Number(retryAfter) : NaN

  if (Number.isFinite(retrySeconds) && retrySeconds >= 0) {
    return retrySeconds * 1000
  }

  return 250 * 2 ** (attempt - 1)
}

export function buildTmdbMovieUrl(tmdbId: number): string {
  const url = new URL(`${TMDB_BASE_URL}/movie/${tmdbId}`)
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('append_to_response', 'credits,keywords')
  return url.toString()
}

export async function defaultDelay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function fetchTmdbMovie({
  tmdbId,
  token,
  fetchFn = fetch,
  delayFn = defaultDelay,
  maxAttempts = 3,
}: {
  tmdbId: number
  token: string
  fetchFn?: typeof fetch
  delayFn?: (ms: number) => Promise<void>
  maxAttempts?: number
}): Promise<unknown> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new TmdbProviderError(`Invalid TMDB ID: ${String(tmdbId)}`, { code: 'INVALID_TMDB_ID' })
  }
  if (!token) {
    throw new TmdbProviderError('TMDB_READ_ACCESS_TOKEN is missing.', { code: 'MISSING_TMDB_TOKEN' })
  }

  const url = buildTmdbMovieUrl(tmdbId)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response

    try {
      response = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new TmdbProviderError(
          `Temporary network failure for TMDB ID ${tmdbId}: ${redactSecret(error instanceof Error ? error.message : error, token)}`,
          { code: 'TMDB_NETWORK_FAILURE', retryable: true },
        )
      }

      await delayFn(250 * 2 ** (attempt - 1))
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new TmdbProviderError(`TMDB authentication/authorization failed with HTTP ${response.status}.`, {
        code: 'TMDB_AUTH_FAILED',
        status: response.status,
      })
    }

    if (response.status === 404) {
      throw new TmdbProviderError(`TMDB ID ${tmdbId} returned HTTP 404.`, {
        code: 'TMDB_NOT_FOUND',
        status: response.status,
      })
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxAttempts) {
        throw new TmdbProviderError(`TMDB ID ${tmdbId} failed after bounded retries with HTTP ${response.status}.`, {
          code: 'TMDB_RETRY_LIMIT',
          status: response.status,
          retryable: true,
        })
      }

      await delayFn(getRetryDelayMs(response, attempt))
      continue
    }

    if (!response.ok) {
      throw new TmdbProviderError(`TMDB ID ${tmdbId} failed with HTTP ${response.status}.`, {
        code: 'TMDB_HTTP_ERROR',
        status: response.status,
      })
    }

    return response.json()
  }

  throw new TmdbProviderError(`TMDB ID ${tmdbId} failed after bounded retries.`, {
    code: 'TMDB_RETRY_LIMIT',
    retryable: true,
  })
}

export function normalizePipelineTmdbFacts(
  response: unknown,
  requestedTmdbId: number,
  {
    fetchedAt = new Date().toISOString(),
    posterBaseUrl = TMDB_POSTER_BASE_URL,
  }: {
    fetchedAt?: string
    posterBaseUrl?: string
  } = {},
) {
  const normalized = normalizeTmdbMovieResponse(response, requestedTmdbId)
  const source = response && typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : {}
  const overview = typeof source.overview === 'string' ? source.overview.trim() : ''
  const rawKeywords = source.keywords && typeof source.keywords === 'object' && !Array.isArray(source.keywords)
    ? (source.keywords as { keywords?: unknown }).keywords
    : []
  const keywords = Array.isArray(rawKeywords)
    ? [...new Set(rawKeywords
        .map((keyword) => keyword && typeof keyword === 'object' && !Array.isArray(keyword) ? (keyword as { name?: unknown }).name : null)
        .filter((keyword): keyword is string => typeof keyword === 'string' && keyword.trim().length > 0)
        .map((keyword) => keyword.trim()))].sort((first, second) => first.localeCompare(second))
    : []
  const sourceHash = stableHash(response)

  return {
    schemaVersion: TMDB_FACTS_SCHEMA_VERSION,
    requestVersion: TMDB_REQUEST_VERSION,
    tmdbId: normalized.tmdbId,
    title: normalized.title,
    year: normalized.year,
    director: normalized.director,
    countries: normalized.countries,
    spokenLanguages: normalized.spokenLanguages,
    genres: normalized.genres,
    runtimeMinutes: normalized.runtimeMinutes,
    overview,
    keywords,
    posterPath: normalized.posterPath,
    posterAvailability: {
      available: normalized.posterPath !== null,
      path: normalized.posterPath,
      imageUrl: normalized.posterPath ? `${posterBaseUrl}${normalized.posterPath}` : null,
    },
    dataQualityFlags: normalized.posterPath === null
      ? [{
          code: 'POSTER_UNAVAILABLE',
          severity: 'review',
          message: 'TMDB posterPath is null; poster suitability remains unapproved.',
        }]
      : [],
    fetchedAt,
    sourceHash,
    factsHash: stableHash({
      schemaVersion: TMDB_FACTS_SCHEMA_VERSION,
      requestVersion: TMDB_REQUEST_VERSION,
      normalized,
      overview,
      keywords,
      sourceHash,
    }),
  }
}
