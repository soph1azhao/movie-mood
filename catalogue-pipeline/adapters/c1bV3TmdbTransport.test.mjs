import { describe, expect, it, vi } from 'vitest'
import { buildAnnualPageRequest, buildPaginationPlan, evaluatePage1Gate, loadRegisteredV3Spec, serializeAnnualRequest } from '../scripts/c1bV3Stage1.mjs'
import { C1B_V3_TMDB_BASE_URL, createC1bV3TmdbTransport, serializeC1bV3TmdbRequest } from './c1bV3TmdbTransport.mjs'

const frozen = await loadRegisteredV3Spec()
const token = 'transport-test-secret'
const fakeResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: vi.fn(async () => body) })

function planWithFirstCellPages(pages = 50) {
  return buildPaginationPlan(frozen, frozen.cells.map((cell) => evaluatePage1Gate(
    buildAnnualPageRequest(frozen, cell.cellId, 1),
    { page: 1, total_pages: cell.cellId === 'year-1980' ? pages : 0, total_results: 0, results: [] },
  )))
}

describe('C1b-V3 TMDB transport', () => {
  it('has no fetch side effect on import or construction', async () => {
    const fetchImpl = vi.fn()
    const previous = globalThis.fetch
    globalThis.fetch = fetchImpl
    vi.resetModules()
    try { await import('./c1bV3TmdbTransport.mjs') } finally { globalThis.fetch = previous }
    createC1bV3TmdbTransport({ fetchImpl, token })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('serializes all page-1 requests and authorized page-2/page-50 exactly as Stage 1A', () => {
    for (const cell of frozen.cells) {
      const request = buildAnnualPageRequest(frozen, cell.cellId, 1)
      expect(serializeC1bV3TmdbRequest(request)).toBe(serializeAnnualRequest(frozen, request, { phase: 'page1' }))
    }
    const plan = planWithFirstCellPages()
    for (const page of [2, 50]) {
      const request = buildAnnualPageRequest(frozen, 'year-1980', page, { phase: 'page2', paginationPlan: plan })
      expect(serializeC1bV3TmdbRequest(request)).toBe(serializeAnnualRequest(frozen, request, { phase: 'page2', paginationPlan: plan }))
    }
  })

  it('uses one GET fetch with header-only bearer auth, error redirects, and byte-preserved body', async () => {
    const body = ' {"results": [ ]}\n'
    const response = fakeResponse(body)
    const fetchImpl = vi.fn(async () => response)
    const request = buildAnnualPageRequest(frozen, 'year-1980', 1)
    const wire = await createC1bV3TmdbTransport({ fetchImpl, token }).dispatch(request)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(url).toBe(`${C1B_V3_TMDB_BASE_URL}${serializeAnnualRequest(frozen, request, { phase: 'page1' })}`)
    expect(url).not.toContain(token)
    expect(options).toEqual({ method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error' })
    expect(wire).toEqual({ ok: true, status: 200, body })
    expect(JSON.stringify(wire)).not.toContain(token)
    expect(response.text).toHaveBeenCalledTimes(1)
  })

  it.each([429, 500])('returns HTTP %i once without retrying', async (status) => {
    const fetchImpl = vi.fn(async () => fakeResponse('failure', status))
    const wire = await createC1bV3TmdbTransport({ fetchImpl, token }).dispatch(buildAnnualPageRequest(frozen, 'year-1980', 1))
    expect(wire).toEqual({ ok: false, status, body: 'failure' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('propagates fetch and body failures without retrying and rejects absent credentials before fetch', async () => {
    const request = buildAnnualPageRequest(frozen, 'year-1980', 1)
    const throwFetch = vi.fn(async () => { throw new Error('network') })
    await expect(createC1bV3TmdbTransport({ fetchImpl: throwFetch, token }).dispatch(request)).rejects.toThrow('network')
    expect(throwFetch).toHaveBeenCalledTimes(1)
    const throwBody = vi.fn(async () => ({ ok: true, status: 200, text: async () => { throw new Error('body') } }))
    await expect(createC1bV3TmdbTransport({ fetchImpl: throwBody, token }).dispatch(request)).rejects.toThrow('body')
    expect(throwBody).toHaveBeenCalledTimes(1)
    const never = vi.fn()
    expect(() => createC1bV3TmdbTransport({ fetchImpl: never, token: '' })).toThrowError(expect.objectContaining({ code: 'TMDB_CREDENTIAL_MISSING' }))
    expect(never).not.toHaveBeenCalled()
  })
})
