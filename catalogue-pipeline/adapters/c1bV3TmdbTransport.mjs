// Narrow, injected TMDB wire boundary for the frozen C1b-V3 Stage-1 runner.
// It performs no I/O until dispatch is explicitly called.

const TMDB_ORIGIN = 'https://api.themoviedb.org'
const TMDB_API_PREFIX = '/3'
const DISCOVER_MOVIE_ENDPOINT = '/discover/movie'
const QUERY_KEYS = Object.freeze([
  'include_adult', 'include_video', 'language', 'page',
  'primary_release_date.gte', 'primary_release_date.lte', 'sort_by',
  'vote_count.gte', 'vote_count.lte',
])

export class C1bV3TmdbTransportError extends Error {
  constructor(message, code = 'C1B_V3_TMDB_TRANSPORT_ERROR') { super(message); this.name = 'C1bV3TmdbTransportError'; this.code = code }
}

const fail = (message, code) => { throw new C1bV3TmdbTransportError(message, code) }

export function serializeC1bV3TmdbRequest(request) {
  if (!request || request.endpoint !== DISCOVER_MOVIE_ENDPOINT || !request.params || typeof request.params !== 'object') fail('Frozen Stage-1 request is invalid.', 'INVALID_REQUEST')
  const keys = Object.keys(request.params)
  if (keys.length !== QUERY_KEYS.length || QUERY_KEYS.some((key) => !Object.hasOwn(request.params, key)) || keys.some((key) => !QUERY_KEYS.includes(key))) fail('Provider-visible query key set must be exact.', 'INVALID_QUERY_KEYS')
  return `${DISCOVER_MOVIE_ENDPOINT}?${QUERY_KEYS.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(request.params[key]))}`).join('&')}`
}

export function createC1bV3TmdbTransport({ fetchImpl, token } = {}) {
  if (typeof fetchImpl !== 'function') fail('An injected fetch implementation is required.', 'MISSING_FETCH')
  if (typeof token !== 'string' || token.length === 0) fail('TMDB credential is not present.', 'TMDB_CREDENTIAL_MISSING')
  return Object.freeze({
    async dispatch(request) {
      const url = `${TMDB_ORIGIN}${TMDB_API_PREFIX}${serializeC1bV3TmdbRequest(request)}`
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error',
      })
      const body = await response.text()
      return { ok: response.ok, status: response.status, body }
    },
  })
}

export const C1B_V3_TMDB_BASE_URL = `${TMDB_ORIGIN}${TMDB_API_PREFIX}`
