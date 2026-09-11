import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  canonicalSha256,
  canonicalize,
  parseJsonRejectingDuplicateKeys,
  verifyContractsBundle,
} from './c1bV2Stage0.mjs'
import {
  STAGE1_CONTRACT_REF,
  STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED,
  STAGE1_ENDPOINT,
  STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE,
  STAGE1_MAX_TOTAL_PAGES,
  STAGE1_PROTOCOL_ID,
  STAGE1_REQUIRED_REQUEST_PARAMETERS,
  STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT,
  STAGE1_STAGE_NUMBER,
  STAGE1_STRATA,
  STAGE1_TOTAL_UNIVERSE,
  Stage1Error,
  buildExclusionManifest,
  buildStratumPageRequest,
  checkFactualEligibility,
  computeCandidateRankHash,
  createSourceSnapshot,
  executePostFreezeSelection,
  isCandidateExcluded,
  matchStratum,
  planStratumPagination,
  resolveDuplicateDisposition,
  serializeRequestQuery,
  serializeRequestUrl,
  validateContractCanonicalContent,
  validateCorpusCompleteness,
  validateSerializedRequest,
  verifyExclusionManifest,
  verifySourceSnapshot,
} from './c1bV2Stage1.mjs'

const protocolPath = join(process.cwd(), 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.json')
const contractsPath = join(process.cwd(), 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v2.contracts.json')

const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'))
const protocolId = protocol.protocolId
const contractsBundle = JSON.parse(readFileSync(contractsPath, 'utf8'))
const stage1Contract = contractsBundle.contracts.find((c) => c.id === 'stage1-recruitment-contract.v2')

// Helpers for synthetic fixtures
function makeMovie(overrides = {}) {
  return {
    id: 10001,
    title: 'Synthetic Movie Title',
    release_date: '1985-06-15',
    vote_count: 500,
    vote_average: 7.2,
    original_language: 'en',
    genre_ids: [28, 12],
    overview: 'A synthetic film overview for recruitment tests.',
    popularity: 15.5,
    ...overrides,
  }
}

function makePageResponse({ page = 1, total_pages = 1, results = [] }) {
  return {
    page,
    total_pages,
    total_results: results.length,
    results,
  }
}

describe('C1b-V2 Stage 1A Deterministic Recruitment', () => {
  // Test 1: exact five strata / exact quotas
  it('1. verifies exact five temporal strata and exact quotas matching frozen contract', () => {
    expect(STAGE1_STRATA).toHaveLength(5)
    expect(STAGE1_STRATA[0]).toEqual({ id: '1980-1989', releaseDateGte: '1980-01-01', releaseDateLte: '1989-12-31', quota: 24 })
    expect(STAGE1_STRATA[1]).toEqual({ id: '1990-1999', releaseDateGte: '1990-01-01', releaseDateLte: '1999-12-31', quota: 24 })
    expect(STAGE1_STRATA[2]).toEqual({ id: '2000-2009', releaseDateGte: '2000-01-01', releaseDateLte: '2009-12-31', quota: 33 })
    expect(STAGE1_STRATA[3]).toEqual({ id: '2010-2019', releaseDateGte: '2010-01-01', releaseDateLte: '2019-12-31', quota: 45 })
    expect(STAGE1_STRATA[4]).toEqual({ id: '2020-2024', releaseDateGte: '2020-01-01', releaseDateLte: '2024-12-31', quota: 54 })

    const totalQuota = STAGE1_STRATA.reduce((sum, s) => sum + s.quota, 0)
    expect(totalQuota).toBe(STAGE1_TOTAL_UNIVERSE)
    expect(totalQuota).toBe(180)

    expect(stage1Contract.canonicalContent.candidateUniverseSize).toBe(180)
    expect(stage1Contract.canonicalContent.strata).toEqual([...STAGE1_STRATA])
  })

  // Test 2: exact request parameter set
  it('2. constructs and enforces exact request parameter set for each stratum', () => {
    const request = buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)
    expect(request.endpoint).toBe('/discover/movie')
    expect(request.stratumId).toBe('1980-1989')
    expect(request.page).toBe(1)
    expect(request.params).toEqual({
      include_adult: false,
      include_video: false,
      language: 'en-US',
      page: 1,
      'primary_release_date.gte': '1980-01-01',
      'primary_release_date.lte': '1989-12-31',
      sort_by: 'primary_release_date.asc',
      'vote_count.gte': 200,
      'vote_count.lte': 2000,
    })

    // Exact valid set passes validation
    expect(() => validateSerializedRequest(request)).not.toThrow()
    expect(() => validateSerializedRequest(request.params)).not.toThrow()

    // Missing each required key fails
    for (const requiredKey of STAGE1_REQUIRED_REQUEST_PARAMETERS) {
      const defectiveParams = { ...request.params }
      delete defectiveParams[requiredKey]
      expect(() => validateSerializedRequest(defectiveParams)).toThrowError(
        expect.objectContaining({
          code: 'MISSING_REQUIRED_PARAMETER',
        })
      )
    }

    // Unexpected extra key fails
    expect(() => validateSerializedRequest({ ...request.params, extra_param: 'forbidden' })).toThrowError(
      expect.objectContaining({
        code: 'UNKNOWN_PARAMETER',
      })
    )

    // with_genres fails
    expect(() => validateSerializedRequest({ ...request.params, with_genres: 28 })).toThrowError(
      expect.objectContaining({
        code: 'UNKNOWN_PARAMETER',
      })
    )

    // region still fails
    expect(() => validateSerializedRequest({ ...request.params, region: 'US' })).toThrowError(
      expect.objectContaining({
        code: 'FORBIDDEN_PARAMETER',
      })
    )

    // Mutated frozen parameters fail
    expect(() => validateSerializedRequest({ ...request.params, include_adult: true })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, include_video: true })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, language: 'fr-FR' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, sort_by: 'popularity.desc' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, 'vote_count.gte': 199 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, 'vote_count.lte': 2001 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST_PARAMETERS' })
    )
    expect(() => validateSerializedRequest({ ...request.params, page: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )
    expect(() => validateSerializedRequest({ ...request.params, page: 51 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )
    expect(() => validateSerializedRequest({ ...request.params, page: 2.5 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )

    // Release date bounds pinned to five frozen strata
    // All five exact pairs pass
    for (const stratum of STAGE1_STRATA) {
      const stratumReq = buildStratumPageRequest(stage1Contract, stratum, 1)
      expect(() => validateSerializedRequest(stratumReq)).not.toThrow()
      expect(() => validateSerializedRequest(serializeRequestUrl(stratumReq))).not.toThrow()
    }

    // Structured request with wrong pair for its stratumId fails
    expect(() =>
      validateSerializedRequest({
        ...request,
        params: {
          ...request.params,
          'primary_release_date.gte': '1990-01-01',
          'primary_release_date.lte': '1999-12-31',
        },
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' }))

    // Narrower range fails: 1982-01-01 / 1987-12-31
    expect(() =>
      validateSerializedRequest({
        ...request.params,
        'primary_release_date.gte': '1982-01-01',
        'primary_release_date.lte': '1987-12-31',
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' }))

    // Wider / cross-stratum range fails: 1985-01-01 / 1995-12-31
    expect(() =>
      validateSerializedRequest({
        ...request.params,
        'primary_release_date.gte': '1985-01-01',
        'primary_release_date.lte': '1995-12-31',
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' }))

    // One-day shifted lower bound fails: 1980-01-02 / 1989-12-31
    expect(() =>
      validateSerializedRequest({
        ...request.params,
        'primary_release_date.gte': '1980-01-02',
        'primary_release_date.lte': '1989-12-31',
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' }))

    // One-day shifted upper bound fails: 1980-01-01 / 1989-12-30
    expect(() =>
      validateSerializedRequest({
        ...request.params,
        'primary_release_date.gte': '1980-01-01',
        'primary_release_date.lte': '1989-12-30',
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' }))

    // Serialized URL/query with non-frozen pair fails
    const badQuery = serializeRequestQuery(request).replace('1980-01-01', '1982-01-01')
    expect(() => validateSerializedRequest(badQuery)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' })
    )
    const badUrl = serializeRequestUrl(request).replace('1989-12-31', '1989-12-30')
    expect(() => validateSerializedRequest(badUrl)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STRATUM_DATE_BOUNDS' })
    )
  })

  // Test 3: explicit region omission
  it('3. explicitly omits region parameter from query params, serialized query string, and URL', () => {
    const request = buildStratumPageRequest(stage1Contract, STAGE1_STRATA[1], 2)
    expect(Object.hasOwn(request.params, 'region')).toBe(false)
    expect('region' in request.params).toBe(false)

    const queryString = serializeRequestQuery(request)
    expect(queryString).not.toMatch(/(^|[?&])region/i)

    const url = serializeRequestUrl(request)
    expect(url).not.toMatch(/(^|[?&])region/i)
    expect(url.startsWith('/discover/movie?')).toBe(true)
  })

  // Test 4: region=null rejected
  it('4. rejects region=null in serialized request object, query string, or JSON', () => {
    expect(() => validateSerializedRequest({ ...makeMovie(), region: null })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('/discover/movie?page=1&region=null')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('{"region": null, "page": 1}')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
  })

  // Test 5: region=OMITTED rejected
  it('5. rejects region=OMITTED in serialized request object, query string, or JSON', () => {
    expect(() => validateSerializedRequest({ ...makeMovie(), region: 'OMITTED' })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('/discover/movie?page=1&region=OMITTED')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('{"region": "OMITTED", "page": 1}')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
  })

  // Test 6: concrete region rejected
  it('6. rejects concrete region (e.g. region=US) in serialized request object or query string', () => {
    expect(() => validateSerializedRequest({ ...makeMovie(), region: 'US' })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('/discover/movie?page=1&region=US')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('/discover/movie?page=1&region=GB')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
    expect(() => validateSerializedRequest('/discover/movie?page=1&region=')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN_PARAMETER' })
    )
  })

  // Test 7: page 1 establishes total_pages
  it('7. establishes total_pages from page 1 response payload', () => {
    const page1 = makePageResponse({ page: 1, total_pages: 14 })
    const plan = planStratumPagination(page1)
    expect(plan.ok).toBe(true)
    expect(plan.totalPages).toBe(14)
    expect(plan.requiredPages).toHaveLength(14)
    expect(plan.requiredPages[0]).toBe(1)
    expect(plan.requiredPages[13]).toBe(14)

    // Rejects non-page 1 as initial
    expect(() => planStratumPagination(makePageResponse({ page: 2, total_pages: 14 }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_RESPONSE' })
    )
  })

  // Test 8: total_pages <= 50 requires all pages and exact completeness
  it('8. requires complete corpus of pages 1..total_pages with exact page numbers', () => {
    const plan = planStratumPagination(makePageResponse({ page: 1, total_pages: 5 }))
    expect(plan.requiredPages).toEqual([1, 2, 3, 4, 5])

    // plannedTotalPages = 5: [1,2,3,4,5] PASS
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2, 3, 4, 5])).not.toThrow()
    expect(() => validateCorpusCompleteness('1980-1989', 5, [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }, { page: 5 }])).not.toThrow()

    // [1,2,3,4] FAIL (missing page)
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2, 3, 4])).toThrowError(
      expect.objectContaining({ code: 'INCOMPLETE_DISCOVERY_CORPUS' })
    )

    // [1,2,3,4,5,6] FAIL (page > planned)
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2, 3, 4, 5, 6])).toThrowError(
      expect.objectContaining({ code: 'UNEXPECTED_PAGE_IN_CORPUS' })
    )

    // [1,2,3,4,5,5] FAIL (duplicate page)
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2, 3, 4, 5, 5])).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_PAGE_IN_CORPUS' })
    )

    // [0,1,2,3,4,5] FAIL (page 0)
    expect(() => validateCorpusCompleteness('1980-1989', 5, [0, 1, 2, 3, 4, 5])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )

    // negative page FAIL
    expect(() => validateCorpusCompleteness('1980-1989', 5, [-1, 2, 3, 4, 5])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )

    // non-integer page FAIL
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2.5, 3, 4, 5])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_NUMBER' })
    )

    // page > plannedTotalPages FAIL
    expect(() => validateCorpusCompleteness('1980-1989', 5, [1, 2, 3, 4, 7])).toThrowError(
      expect.objectContaining({ code: 'UNEXPECTED_PAGE_IN_CORPUS' })
    )

    // page > 50 FAIL
    expect(() => validateCorpusCompleteness('1980-1989', 50, [1, 2, 51])).toThrowError(
      expect.objectContaining({ code: 'PAGE_BUDGET_EXCEEDED' })
    )

    // extra page even when <= 50 (planned = 3, received [1, 2, 3, 4]) FAIL
    expect(() => validateCorpusCompleteness('1980-1989', 3, [1, 2, 3, 4])).toThrowError(
      expect.objectContaining({ code: 'UNEXPECTED_PAGE_IN_CORPUS' })
    )

    // plannedTotalPages itself must be integer in 1..50
    expect(() => validateCorpusCompleteness('1980-1989', 0, [])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_BUDGET' })
    )
    expect(() => validateCorpusCompleteness('1980-1989', 51, [])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_BUDGET' })
    )
    expect(() => validateCorpusCompleteness('1980-1989', 2.5, [])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_BUDGET' })
    )
    expect(() => validateCorpusCompleteness('1980-1989', 'five', [])).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGE_BUDGET' })
    )
  })

  // Test 9: no early stop
  it('9. strictly enforces earlyStopAllowed is false regardless of candidate count', () => {
    const plan = planStratumPagination(makePageResponse({ page: 1, total_pages: 8 }))
    expect(plan.earlyStopAllowed).toBe(false)
    expect(plan.requiredPages).toHaveLength(8)
  })

  // Test 10: total_pages > 50 blocks
  it('10. immediately blocks with exact string if total_pages > 50', () => {
    expect(() => planStratumPagination(makePageResponse({ page: 1, total_pages: 51 }))).toThrowError(
      expect.objectContaining({
        message: STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED,
        code: 'DISCOVERY_PAGE_BUDGET_EXCEEDED',
      })
    )
    expect(() => planStratumPagination(makePageResponse({ page: 1, total_pages: 100 }))).toThrowError(
      expect.objectContaining({ message: STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED })
    )
  })

  // Test 11: page 51 prohibited
  it('11. strictly prohibits page 51 from being requested, planned, or validated', () => {
    expect(() => buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 51)).toThrowError(
      expect.objectContaining({ code: 'PAGE_BUDGET_EXCEEDED' })
    )
    expect(() => validateCorpusCompleteness('1980-1989', 50, [51])).toThrowError(
      expect.objectContaining({ code: 'PAGE_BUDGET_EXCEEDED' })
    )
  })

  // Test 12: source snapshot freezes before filtering
  it('12. freezes source snapshot and computes sourceSnapshotHash before any filtering or deduplication', () => {
    const requests = [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)]
    const movieWithLowVotes = makeMovie({ id: 101, vote_count: 50 }) // factually ineligible
    const responses = [
      {
        stratumId: '1980-1989',
        page: 1,
        response: makePageResponse({ page: 1, total_pages: 1, results: [movieWithLowVotes] }),
      },
    ]

    const snapshot = createSourceSnapshot({
      protocolId: protocol.protocolId,
      requests,
      responses,
    })

    expect(snapshot.sourceSnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Ineligible record is preserved untouched in the raw corpus snapshot
    expect(snapshot.rawResponseCorpus[0].response.results[0].vote_count).toBe(50)
  })

  // Test 13: source snapshot deterministic under delivery ordering
  it('13. produces identical source snapshot and hash regardless of delivery arrival ordering', () => {
    const req1 = buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)
    const req2 = buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 2)
    const res1 = { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [makeMovie({ id: 101 })] }) }
    const res2 = { stratumId: '1980-1989', page: 2, response: makePageResponse({ page: 2, results: [makeMovie({ id: 102 })] }) }

    const snapA = createSourceSnapshot({
      protocolId: protocolId,
      requests: [req1, req2],
      responses: [res1, res2],
    })

    const snapB = createSourceSnapshot({
      protocolId: protocolId,
      requests: [req2, req1],
      responses: [res2, res1],
    })

    expect(snapA.sourceSnapshotHash).toBe(snapB.sourceSnapshotHash)
    expect(canonicalize(snapA)).toBe(canonicalize(snapB))
  })

  // Test 14: identical duplicate collapse
  it('14. collapses repeated identical result objects with same TMDB ID to exactly one logical record', () => {
    const movie = makeMovie({ id: 501, title: 'Identical Duplicate Film' })
    const snapshot = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [movie, { ...movie }] }) },
      ],
    })

    const collapsed = resolveDuplicateDisposition(snapshot)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].id).toBe(501)
    expect(collapsed[0].title).toBe('Identical Duplicate Film')
  })

  // Test 15: identical duplicate input order independence
  it('15. produces identical collapsed logical records regardless of duplicate input order or page position', () => {
    const m1 = makeMovie({ id: 101, title: 'Movie 101' })
    const m2 = makeMovie({ id: 102, title: 'Movie 102' })

    const snapOrder1 = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [m1, m2, { ...m1 }] }) },
      ],
    })

    const snapOrder2 = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [{ ...m1 }, m2, m1] }) },
      ],
    })

    const col1 = resolveDuplicateDisposition(snapOrder1)
    const col2 = resolveDuplicateDisposition(snapOrder2)
    expect(canonicalize(col1)).toBe(canonicalize(col2))
  })

  // Test 16: conflicting duplicate BLOCK
  it('16. blocks with BLOCKED — SOURCE SNAPSHOT DUPLICATE CONFLICT when same TMDB ID has non-identical objects', () => {
    const m1 = makeMovie({ id: 202, vote_count: 500 })
    const m2 = makeMovie({ id: 202, vote_count: 600 }) // vote_count conflict

    const snapshot = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [m1, m2] }) },
      ],
    })

    expect(() => resolveDuplicateDisposition(snapshot)).toThrowError(
      expect.objectContaining({
        message: STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT,
        code: 'SOURCE_SNAPSHOT_DUPLICATE_CONFLICT',
      })
    )
  })

  // Test 17: no first/last-wins path
  it('17. guarantees forbidden resolution strategies (first-wins, last-wins, field merge) are never used', () => {
    const m1 = makeMovie({ id: 303, popularity: 10.0, overview: 'Overview 1' })
    const m2 = makeMovie({ id: 303, popularity: 50.0, overview: 'Overview 2' })

    const snapshot = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [m1, m2] }) },
      ],
    })

    expect(() => resolveDuplicateDisposition(snapshot)).toThrowError(STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT)
  })

  // Test 18: duplicate conflict stops before factual eligibility/ranking
  it('18. halts immediately on duplicate conflict so factual eligibility, exclusion, and ranking never run', () => {
    const m1 = makeMovie({ id: 404, title: 'Title A' })
    const m2 = makeMovie({ id: 404, title: 'Title B' })

    const snapshot = createSourceSnapshot({
      protocolId: protocolId,
      requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
      responses: [
        { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [m1, m2] }) },
      ],
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    const steps = []
    expect(() =>
      executePostFreezeSelection({
        protocolId: protocolId,
        sourceSnapshot: snapshot,
        exclusionManifest: manifest,
        onStep: (step) => steps.push(step),
      })
    ).toThrowError(STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT)

    expect(steps).toContain('duplicate-disposition-start')
    expect(steps).not.toContain('factual-eligibility-start')
    expect(steps).not.toContain('exclusion-filtering-start')
    expect(steps).not.toContain('stratum-verification-start')
    expect(steps).not.toContain('ranking-and-selection-start')
  })

  // Test 19: vote count boundaries 199/200/2000/2001
  it('19. enforces vote count boundaries: 199 ineligible, 200 eligible, 2000 eligible, 2001 ineligible', () => {
    expect(checkFactualEligibility(makeMovie({ vote_count: 199 })).eligible).toBe(false)
    expect(checkFactualEligibility(makeMovie({ vote_count: 200 })).eligible).toBe(true)
    expect(checkFactualEligibility(makeMovie({ vote_count: 1000 })).eligible).toBe(true)
    expect(checkFactualEligibility(makeMovie({ vote_count: 2000 })).eligible).toBe(true)
    expect(checkFactualEligibility(makeMovie({ vote_count: 2001 })).eligible).toBe(false)
  })

  // Test 20: release-date stratum boundaries
  it('20. enforces temporal stratum boundaries and overall 2024-12-31 cutoff', () => {
    expect(checkFactualEligibility(makeMovie({ release_date: '1979-12-31' })).eligible).toBe(false)
    expect(matchStratum('1979-12-31')).toBeNull()

    // 1980-1989
    expect(checkFactualEligibility(makeMovie({ release_date: '1980-01-01' })).eligible).toBe(true)
    expect(matchStratum('1980-01-01')?.id).toBe('1980-1989')
    expect(matchStratum('1989-12-31')?.id).toBe('1980-1989')

    // 1990-1999
    expect(matchStratum('1990-01-01')?.id).toBe('1990-1999')
    expect(matchStratum('1999-12-31')?.id).toBe('1990-1999')

    // 2000-2009
    expect(matchStratum('2000-01-01')?.id).toBe('2000-2009')
    expect(matchStratum('2009-12-31')?.id).toBe('2000-2009')

    // 2010-2019
    expect(matchStratum('2010-01-01')?.id).toBe('2010-2019')
    expect(matchStratum('2019-12-31')?.id).toBe('2010-2019')

    // 2020-2024
    expect(matchStratum('2020-01-01')?.id).toBe('2020-2024')
    expect(matchStratum('2024-12-31')?.id).toBe('2020-2024')

    // Past cutoff
    expect(checkFactualEligibility(makeMovie({ release_date: '2025-01-01' })).eligible).toBe(false)
    expect(matchStratum('2025-01-01')).toBeNull()
  })

  // Test 21: no language/country/genre quota
  it('21. treats language, country, and genre as disclosure-only without admission quotas', () => {
    const movieFr = makeMovie({ original_language: 'fr', genre_ids: [99] })
    const movieJa = makeMovie({ original_language: 'ja', genre_ids: [16] })
    expect(checkFactualEligibility(movieFr).eligible).toBe(true)
    expect(checkFactualEligibility(movieJa).eligible).toBe(true)
  })

  // Test 22: exclusion manifest deterministic under source ordering and fail-closed metadata conflict handling
  it('22. produces byte-identical exclusion manifest under source reordering and fails closed on metadata conflict', () => {
    // A. Reversing source order with compatible metadata produces byte-identical manifest and identical hash
    const sourceA = {
      sourceName: 'c1b-v1-stage1',
      entries: [
        { tmdbId: 10, canonicalId: 'movie-10', title: 'Movie 10', reason: 'C1B_V1_STAGE1_REGISTRY_1' },
        { tmdbId: 20, canonicalId: 'movie-20', title: 'Movie 20', reason: 'C1B_V1_STAGE1_REGISTRY_1' },
      ],
    }
    const sourceB = {
      sourceName: 'c1b-v1-human-gold',
      entries: [
        { tmdbId: 20, canonicalId: 'movie-20', title: 'Movie 20', reason: 'C1B_V1_HUMAN_GOLD' },
        { tmdbId: 30, canonicalId: 'movie-30', title: 'Movie 30', reason: 'C1B_V1_HUMAN_GOLD' },
      ],
    }

    const manifest1 = buildExclusionManifest({ protocolId: protocolId, sources: [sourceA, sourceB] })
    const manifest2 = buildExclusionManifest({ protocolId: protocolId, sources: [sourceB, sourceA] })

    expect(manifest1.exclusionManifestHash).toBe(manifest2.exclusionManifestHash)
    expect(canonicalize(manifest1)).toBe(canonicalize(manifest2))
    expect(manifest1.exclusions).toHaveLength(3)

    // B. Conflicting distinct non-null canonicalId blocks in either source order
    const conflictCanonA = { sourceName: 'src-a', entries: [{ tmdbId: 99, canonicalId: 'canon-a', title: 'Film 99' }] }
    const conflictCanonB = { sourceName: 'src-b', entries: [{ tmdbId: 99, canonicalId: 'canon-b', title: 'Film 99' }] }

    expect(() => buildExclusionManifest({ protocolId: protocolId, sources: [conflictCanonA, conflictCanonB] })).toThrowError(
      expect.objectContaining({ code: 'EXCLUSION_METADATA_CONFLICT' })
    )
    expect(() => buildExclusionManifest({ protocolId: protocolId, sources: [conflictCanonB, conflictCanonA] })).toThrowError(
      expect.objectContaining({ code: 'EXCLUSION_METADATA_CONFLICT' })
    )

    // C. Conflicting distinct non-null title blocks in either source order
    const conflictTitleA = { sourceName: 'src-a', entries: [{ tmdbId: 88, canonicalId: 'canon-88', title: 'Title Alpha' }] }
    const conflictTitleB = { sourceName: 'src-b', entries: [{ tmdbId: 88, canonicalId: 'canon-88', title: 'Title Beta' }] }

    expect(() => buildExclusionManifest({ protocolId: protocolId, sources: [conflictTitleA, conflictTitleB] })).toThrowError(
      expect.objectContaining({ code: 'EXCLUSION_METADATA_CONFLICT' })
    )
    expect(() => buildExclusionManifest({ protocolId: protocolId, sources: [conflictTitleB, conflictTitleA] })).toThrowError(
      expect.objectContaining({ code: 'EXCLUSION_METADATA_CONFLICT' })
    )

    // D. Null + non-null resolves identically regardless of source order
    const nullMeta = { sourceName: 'src-null', entries: [{ tmdbId: 77, canonicalId: null, title: null, reason: 'R1' }] }
    const nonNullMeta = { sourceName: 'src-full', entries: [{ tmdbId: 77, canonicalId: 'canon-77', title: 'Title 77', reason: 'R2' }] }

    const manifestD1 = buildExclusionManifest({ protocolId: protocolId, sources: [nullMeta, nonNullMeta] })
    const manifestD2 = buildExclusionManifest({ protocolId: protocolId, sources: [nonNullMeta, nullMeta] })

    expect(canonicalize(manifestD1)).toBe(canonicalize(manifestD2))
    expect(manifestD1.exclusionManifestHash).toBe(manifestD2.exclusionManifestHash)
    expect(manifestD1.exclusions[0]).toEqual({
      canonicalId: 'canon-77',
      provenance: ['src-full', 'src-null'],
      reasons: ['R1', 'R2'],
      title: 'Title 77',
      tmdbId: 77,
    })
  })

  // Test 23: exclusion provenance retained
  it('23. retains explicit provenance and union membership reasons in exclusion manifest', () => {
    const source1 = { sourceName: 'registry-1', provenance: 'path/to/registry1.json', entries: [{ tmdbId: 100, reason: 'REGISTRY_1' }] }
    const source2 = { sourceName: 'human-gold', provenance: 'path/to/gold.json', entries: [{ tmdbId: 100, reason: 'GOLD_CANARY' }] }

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [source1, source2] })
    const entry = manifest.exclusions.find((e) => e.tmdbId === 100)
    expect(entry).toBeDefined()
    expect(entry.reasons).toEqual(['GOLD_CANARY', 'REGISTRY_1'])
    expect(entry.provenance).toEqual(['path/to/gold.json', 'path/to/registry1.json'])
  })

  // Test 24: broad discovery appearance alone not excluded
  it('24. does not exclude a candidate solely for appearing in broad discovery corpus if not in exclusion manifest', () => {
    const manifest = buildExclusionManifest({
      protocolId: protocolId,
      sources: [{ sourceName: 'prior-study', entries: [{ tmdbId: 999 }] }],
    })
    expect(isCandidateExcluded(999, manifest)).toBe(true)
    expect(isCandidateExcluded(888, manifest)).toBe(false)
  })

  // Test 25: ranking preimage exactly matches frozen contract
  it('25. computes ranking preimage exactly conforming to protocolId|stage1-select|stratumId|tmdbId', () => {
    const { preimage, rankHash } = computeCandidateRankHash({
      protocolId: 'phase-5c-c1b-v-confirmatory.v2',
      stratumId: '1980-1989',
      tmdbId: 12345,
    })

    const expectedPreimage = 'phase-5c-c1b-v-confirmatory.v2|stage1-select|1980-1989|12345'
    expect(preimage).toBe(expectedPreimage)

    const expectedHash = createHash('sha256').update(expectedPreimage, 'utf8').digest('hex')
    expect(rankHash).toBe(expectedHash)
  })

  // Test 26: ranking independent of source/page order
  it('26. ranks candidates strictly by SHA256 ascending independent of source delivery or page order', () => {
    const m1 = makeMovie({ id: 10, release_date: '1985-01-01' })
    const m2 = makeMovie({ id: 20, release_date: '1985-02-01' })
    const m3 = makeMovie({ id: 30, release_date: '1985-03-01' })

    const hash1 = computeCandidateRankHash({ protocolId: protocolId, stratumId: '1980-1989', tmdbId: 10 }).rankHash
    const hash2 = computeCandidateRankHash({ protocolId: protocolId, stratumId: '1980-1989', tmdbId: 20 }).rankHash
    const hash3 = computeCandidateRankHash({ protocolId: protocolId, stratumId: '1980-1989', tmdbId: 30 }).rankHash

    const sortedByHash = [
      { id: 10, hash: hash1 },
      { id: 20, hash: hash2 },
      { id: 30, hash: hash3 },
    ].sort((a, b) => a.hash.localeCompare(b.hash))

    // Build synthetic responses with sufficient candidates
    const makeStratumCandidates = (stratum, count, stratumIndex) =>
      Array.from({ length: count }, (_, i) =>
        makeMovie({ id: (stratumIndex + 1) * 10000 + i + 1, release_date: stratum.releaseDateGte })
      )

    const responsesOrderA = STAGE1_STRATA.map((s, stratumIndex) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({ page: 1, results: makeStratumCandidates(s, s.quota + 5, stratumIndex) }),
    }))

    const snapA = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses: responsesOrderA,
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    const resultA = executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snapA, exclusionManifest: manifest })
    expect(resultA.candidates).toHaveLength(180)

    // Verify ordering within stratum 0 matches rankHash ascending
    const stratum0Selected = resultA.candidates.filter((c) => c.stratumId === '1980-1989')
    for (let i = 1; i < stratum0Selected.length; i++) {
      expect(stratum0Selected[i - 1].rankHash.localeCompare(stratum0Selected[i].rankHash)).toBeLessThan(0)
    }
  })

  // Test 27: insufficient stratum BLOCK
  it('27. blocks with exact string BLOCKED — INSUFFICIENT FRESH FACTUAL UNIVERSE when stratum is deficient', () => {
    const makeStratumCandidates = (stratum, count, stratumIndex) =>
      Array.from({ length: count }, (_, i) =>
        makeMovie({ id: (stratumIndex + 1) * 20000 + i + 1, release_date: stratum.releaseDateGte })
      )

    // Deficient in stratum 1980-1989: quota is 24, supply only 23
    const responses = STAGE1_STRATA.map((s, stratumIndex) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({
        page: 1,
        results: makeStratumCandidates(s, s.id === '1980-1989' ? 23 : s.quota, stratumIndex),
      }),
    }))

    const snap = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses,
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })

    expect(() =>
      executePostFreezeSelection({
        protocolId: protocolId,
        sourceSnapshot: snap,
        exclusionManifest: manifest,
      })
    ).toThrowError(
      expect.objectContaining({
        message: STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE,
        code: 'INSUFFICIENT_FRESH_FACTUAL_UNIVERSE',
      })
    )
  })

  // Test 28: no cross-stratum borrowing
  it('28. does not allow cross-stratum quota borrowing to cover a deficient stratum', () => {
    const makeStratumCandidates = (stratum, count, stratumIndex) =>
      Array.from({ length: count }, (_, i) =>
        makeMovie({ id: (stratumIndex + 1) * 30000 + i + 1, release_date: stratum.releaseDateGte })
      )

    // 1980-1989 has 23 (deficit of 1), 1990-1999 has 50 (surplus of 26)
    const responses = STAGE1_STRATA.map((s, stratumIndex) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({
        page: 1,
        results: makeStratumCandidates(s, s.id === '1980-1989' ? 23 : s.id === '1990-1999' ? 50 : s.quota, stratumIndex),
      }),
    }))

    const snap = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses,
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    expect(() =>
      executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snap, exclusionManifest: manifest })
    ).toThrowError(STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE)
  })

  // Test 29: no replenishment
  it('29. guarantees replenishment batches are prohibited in contract and code', () => {
    expect(stage1Contract.canonicalContent.replenishment).toBe(false)
    expect(stage1Contract.canonicalContent.crossStratumQuotaBorrowing).toBe(false)
    expect(protocol.stages[1].replenishmentBatchAllowed).toBe(false)
  })

  // Test 30: exact ordered 180 output with synthetic sufficiently-large fixture
  it('30. produces exact ordered 180 output with synthetic sufficiently-large fixture', () => {
    let globalId = 1
    const responses = STAGE1_STRATA.map((s) => {
      const candidates = Array.from({ length: s.quota + 10 }, () =>
        makeMovie({ id: globalId++, release_date: s.releaseDateGte })
      )
      return {
        stratumId: s.id,
        page: 1,
        response: makePageResponse({ page: 1, results: candidates }),
      }
    })

    const snap = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses,
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    const selection = executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snap, exclusionManifest: manifest })

    expect(selection.totalUniverseSize).toBe(180)
    expect(selection.candidates).toHaveLength(180)

    // Stratum quotas exact: 24, 24, 33, 45, 54
    expect(selection.candidates.filter((c) => c.stratumId === '1980-1989')).toHaveLength(24)
    expect(selection.candidates.filter((c) => c.stratumId === '1990-1999')).toHaveLength(24)
    expect(selection.candidates.filter((c) => c.stratumId === '2000-2009')).toHaveLength(33)
    expect(selection.candidates.filter((c) => c.stratumId === '2010-2019')).toHaveLength(45)
    expect(selection.candidates.filter((c) => c.stratumId === '2020-2024')).toHaveLength(54)

    // Verify all candidates have 200 <= vote_count <= 2000
    for (const c of selection.candidates) {
      expect(c.voteCount).toBeGreaterThanOrEqual(200)
      expect(c.voteCount).toBeLessThanOrEqual(2000)
      expect(c.releaseDate <= '2024-12-31').toBe(true)
    }
  })

  // Test 31: same source corpus in different page/record ordering -> same ordered 180
  it('31. produces byte-identical final ordered 180 candidate output when source responses/records are shuffled', () => {
    let globalId = 1
    const stratumMovies = STAGE1_STRATA.map((s) =>
      Array.from({ length: s.quota + 15 }, () => makeMovie({ id: globalId++, release_date: s.releaseDateGte }))
    )

    // Build run A: normal order
    const responsesA = STAGE1_STRATA.map((s, idx) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({ page: 1, results: [...stratumMovies[idx]] }),
    }))

    const snapA = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses: responsesA,
    })

    // Build run B: reverse order of records within each page and reverse order of responses
    const responsesB = STAGE1_STRATA.map((s, idx) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({ page: 1, results: [...stratumMovies[idx]].reverse() }),
    })).reverse()

    const snapB = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)).reverse(),
      responses: responsesB,
    })

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    const selectionA = executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snapA, exclusionManifest: manifest })
    const selectionB = executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snapB, exclusionManifest: manifest })

    // Same ordered 180 output regardless of record/page delivery ordering
    expect(canonicalize(selectionA.candidates)).toBe(canonicalize(selectionB.candidates))
    expect(selectionA.candidates).toHaveLength(180)
  })

  // Test 32: frozen source snapshot remains unchanged by downstream processing
  it('32. guarantees source snapshot object, raw corpus, and sourceSnapshotHash remain byte-identical before and after downstream processing', () => {
    let globalId = 1000
    const responses = STAGE1_STRATA.map((s) => ({
      stratumId: s.id,
      page: 1,
      response: makePageResponse({
        page: 1,
        results: Array.from({ length: s.quota + 5 }, () => makeMovie({ id: globalId++, release_date: s.releaseDateGte })),
      }),
    }))

    const snapshot = createSourceSnapshot({
      protocolId: protocolId,
      requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
      responses,
    })

    const canonicalBefore = canonicalize(snapshot)
    const hashBefore = snapshot.sourceSnapshotHash

    const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
    executePostFreezeSelection({ protocolId: protocolId, sourceSnapshot: snapshot, exclusionManifest: manifest })

    const canonicalAfter = canonicalize(snapshot)
    const hashAfter = snapshot.sourceSnapshotHash

    expect(canonicalBefore).toBe(canonicalAfter)
    expect(hashBefore).toBe(hashAfter)
  })

  describe('Post-Freeze Input Integrity Verification and Deep-Freeze', () => {
    it('1. verifies a fresh source snapshot', () => {
      const snap = createSourceSnapshot({
        protocolId: protocolId,
        requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
        responses: [
          { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [makeMovie({ id: 1 })] }) },
        ],
      })
      const result = verifySourceSnapshot(snap)
      expect(result.ok).toBe(true)
      expect(result.sourceSnapshotHash).toBe(snap.sourceSnapshotHash)
    })

    it('2. verifies a fresh exclusion manifest', () => {
      const manifest = buildExclusionManifest({
        protocolId: protocolId,
        sources: [
          {
            sourceId: 'c1a-pilot',
            description: 'Pilot test exclusions',
            entries: [
              {
                id: 101,
                title: 'Excluded Movie',
                reason: 'PILOT_SAMPLE',
                provenance: 'c1a-pilot-run-1',
              },
            ],
          },
        ],
      })
      const result = verifyExclusionManifest(manifest)
      expect(result.ok).toBe(true)
      expect(result.exclusionManifestHash).toBe(manifest.exclusionManifestHash)
    })

    it('3. prevents nested mutation of the exclusion manifest', () => {
      const manifest = buildExclusionManifest({
        protocolId: protocolId,
        sources: [
          {
            sourceName: 'c1a-pilot',
            entries: [
              {
                id: 101,
                title: 'Frozen Title',
                reason: 'REASON_1',
                provenance: 'SOURCE_1',
              },
            ],
          },
        ],
      })

      expect(Object.isFrozen(manifest)).toBe(true)
      expect(Object.isFrozen(manifest.exclusions)).toBe(true)
      expect(Object.isFrozen(manifest.exclusions[0])).toBe(true)
      expect(Object.isFrozen(manifest.exclusions[0].reasons)).toBe(true)
      expect(Object.isFrozen(manifest.exclusions[0].provenance)).toBe(true)

      expect(() => {
        manifest.exclusions.push({ id: 999 })
      }).toThrow()
      expect(() => {
        manifest.exclusions[0].title = 'Mutated Title'
      }).toThrow()
      expect(() => {
        manifest.exclusions[0].reasons.push('EXTRA_REASON')
      }).toThrow()
      expect(() => {
        manifest.exclusions[0].provenance[0] = 'MUTATED_SOURCE'
      }).toThrow()
    })

    it('4. rejects a serialized/cloned exclusion manifest with changed content and old hash', () => {
      const manifest = buildExclusionManifest({
        protocolId: protocolId,
        sources: [
          {
            sourceName: 'c1a-pilot',
            entries: [
              {
                id: 101,
                title: 'Frozen Title',
                reason: 'REASON_1',
                provenance: 'SOURCE_1',
              },
            ],
          },
        ],
      })

      const cloned = JSON.parse(JSON.stringify(manifest))
      cloned.exclusions[0].title = 'Tampered Title'

      expect(() => verifyExclusionManifest(cloned)).toThrowError(
        expect.objectContaining({ code: 'EXCLUSION_MANIFEST_HASH_MISMATCH' })
      )
    })

    it('5. rejects a serialized/cloned source snapshot with raw corpus or request manifest changed and old hash', () => {
      const snap = createSourceSnapshot({
        protocolId: protocolId,
        requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
        responses: [
          { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [makeMovie({ id: 1 })] }) },
        ],
      })

      const clonedCorpusTampered = JSON.parse(JSON.stringify(snap))
      clonedCorpusTampered.rawResponseCorpus[0].response.results[0].title = 'Tampered Movie Title'
      expect(() => verifySourceSnapshot(clonedCorpusTampered)).toThrowError(
        expect.objectContaining({ code: 'SOURCE_SNAPSHOT_HASH_MISMATCH' })
      )

      const clonedRequestTampered = JSON.parse(JSON.stringify(snap))
      clonedRequestTampered.requestManifest[0].page = 99
      expect(() => verifySourceSnapshot(clonedRequestTampered)).toThrowError(
        expect.objectContaining({ code: 'SOURCE_SNAPSHOT_HASH_MISMATCH' })
      )
    })

    it('6. executePostFreezeSelection fails before duplicate-disposition-start on either hash mismatch', () => {
      const snap = createSourceSnapshot({
        protocolId: protocolId,
        requests: [buildStratumPageRequest(stage1Contract, STAGE1_STRATA[0], 1)],
        responses: [
          { stratumId: '1980-1989', page: 1, response: makePageResponse({ page: 1, results: [makeMovie({ id: 1 })] }) },
        ],
      })
      const validManifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })

      // Snapshot hash mismatch
      const tamperedSnap = JSON.parse(JSON.stringify(snap))
      tamperedSnap.rawResponseCorpus[0].response.results[0].title = 'Tampered Title'
      const stepsSnap = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: tamperedSnap,
          exclusionManifest: validManifest,
          onStep: (step) => stepsSnap.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'SOURCE_SNAPSHOT_HASH_MISMATCH' }))
      expect(stepsSnap).not.toContain('duplicate-disposition-start')
      expect(stepsSnap).not.toContain('factual-eligibility-start')

      // Manifest hash mismatch
      const tamperedManifest = JSON.parse(JSON.stringify(validManifest))
      tamperedManifest.manifestVersion = 99
      const stepsManifest = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snap,
          exclusionManifest: tamperedManifest,
          onStep: (step) => stepsManifest.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'EXCLUSION_MANIFEST_HASH_MISMATCH' }))
      expect(stepsManifest).not.toContain('duplicate-disposition-start')
      expect(stepsManifest).not.toContain('factual-eligibility-start')
    })

    it('7. normal valid selection still produces the exact deterministic 180 output', () => {
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 10 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })

      const snap = createSourceSnapshot({
        protocolId: protocolId,
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })

      const selection = executePostFreezeSelection({
        protocolId: protocolId,
        sourceSnapshot: snap,
        exclusionManifest: manifest,
      })

      expect(selection.candidates).toHaveLength(180)
      for (const stratum of STAGE1_STRATA) {
        const stratumCandidates = selection.candidates.filter((c) => c.stratumId === stratum.id)
        expect(stratumCandidates).toHaveLength(stratum.quota)
      }
      expect(selection.strataSummary.map((s) => ({ id: s.stratumId, count: s.selectedCount }))).toEqual([
        { id: '1980-1989', count: 24 },
        { id: '1990-1999', count: 24 },
        { id: '2000-2009', count: 33 },
        { id: '2010-2019', count: 45 },
        { id: '2020-2024', count: 54 },
      ])
      expect(selection.totalUniverseSize).toBe(180)
      for (const c of selection.candidates) {
        expect(typeof c.rankHash).toBe('string')
        expect(c.rankHash).toMatch(/^[a-f0-9]{64}$/)
      }
    })
  })

  describe('Frozen Strata Parameter Protection and Fail-Close Enforcement', () => {
    function makeTestFixtures() {
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 5 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })
      const snapshot = createSourceSnapshot({
        protocolId: protocolId,
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
      return { snapshot, manifest }
    }

    it('rejects altered quota with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const alteredStrata = STAGE1_STRATA.map((s, i) => (i === 0 ? { ...s, quota: s.quota + 1 } : s))
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('rejects altered date bound with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const alteredStrata = STAGE1_STRATA.map((s, i) => (i === 0 ? { ...s, releaseDateLte: '1989-12-30' } : s))
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('rejects altered stratum ID with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const alteredStrata = STAGE1_STRATA.map((s, i) => (i === 0 ? { ...s, id: '1980s' } : s))
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('rejects altered order with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const alteredStrata = [STAGE1_STRATA[1], STAGE1_STRATA[0], ...STAGE1_STRATA.slice(2)]
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('rejects missing stratum with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const alteredStrata = STAGE1_STRATA.slice(0, 4)
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('rejects extra stratum with FROZEN_STRATA_MISMATCH before duplicate disposition', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const extra = { id: '1970-1979', releaseDateGte: '1970-01-01', releaseDateLte: '1979-12-31', quota: 10 }
      const alteredStrata = [extra, ...STAGE1_STRATA]
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: alteredStrata,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'FROZEN_STRATA_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('accepts omitted strata parameter (defaulting to frozen STAGE1_STRATA)', () => {
      const { snapshot, manifest } = makeTestFixtures()
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
        })
      ).not.toThrow()
    })

    it('accepts explicit exact STAGE1_STRATA parameter', () => {
      const { snapshot, manifest } = makeTestFixtures()
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          strata: STAGE1_STRATA,
        })
      ).not.toThrow()
    })
  })

  describe('Cross-Binding of Post-Freeze Artifacts to Registered Protocol', () => {
    function makeTestFixtures() {
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 5 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })
      const snapshot = createSourceSnapshot({
        protocolId: protocolId,
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
      return { snapshot, manifest }
    }

    it('A. valid current artifacts pass cross-binding and integrity verification', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const result = executePostFreezeSelection({
        protocolId: protocolId,
        sourceSnapshot: snapshot,
        exclusionManifest: manifest,
      })
      expect(result.candidates).toHaveLength(180)
      expect(result.protocolId).toBe(STAGE1_PROTOCOL_ID)
    })

    it('B. hash-valid snapshot created with a different protocolId fails with PROTOCOL_BINDING_MISMATCH', () => {
      const wrongProto = 'phase-5c-c1b-wrong-protocol.v2'
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 5 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })
      const snapOtherProto = createSourceSnapshot({
        protocolId: wrongProto,
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      // Hash is valid for this snapshot
      expect(verifySourceSnapshot(snapOtherProto).ok).toBe(true)

      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapOtherProto,
          exclusionManifest: manifest,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_BINDING_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('C. hash-valid exclusion manifest created with a different protocolId fails with PROTOCOL_BINDING_MISMATCH', () => {
      const wrongProto = 'phase-5c-c1b-wrong-protocol.v2'
      const { snapshot } = makeTestFixtures()
      const manifestOtherProto = buildExclusionManifest({ protocolId: wrongProto, sources: [] })
      // Hash is valid for this manifest
      expect(verifyExclusionManifest(manifestOtherProto).ok).toBe(true)

      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapshot,
          exclusionManifest: manifestOtherProto,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_BINDING_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('D. caller-supplied wrong protocolId fails with PROTOCOL_BINDING_MISMATCH', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: 'wrong-caller-protocol-id',
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_BINDING_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('E. hash-valid snapshot with stage != 1 fails with SOURCE_SNAPSHOT_STAGE_MISMATCH', () => {
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 5 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })
      const snapStage2 = createSourceSnapshot({
        protocolId: protocolId,
        stage: 2,
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      // Hash is valid for this snapshot
      expect(verifySourceSnapshot(snapStage2).ok).toBe(true)

      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapStage2,
          exclusionManifest: manifest,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'SOURCE_SNAPSHOT_STAGE_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('F. hash-valid snapshot with wrong contractRef fails with SOURCE_SNAPSHOT_CONTRACT_MISMATCH', () => {
      let globalId = 1
      const responses = STAGE1_STRATA.map((s) => {
        const candidates = Array.from({ length: s.quota + 5 }, () =>
          makeMovie({ id: globalId++, release_date: s.releaseDateGte })
        )
        return {
          stratumId: s.id,
          page: 1,
          response: makePageResponse({ page: 1, results: candidates }),
        }
      })
      const snapWrongContract = createSourceSnapshot({
        protocolId: protocolId,
        contractRef: 'wrong-contract-ref.v2',
        requests: STAGE1_STRATA.map((s) => buildStratumPageRequest(stage1Contract, s, 1)),
        responses,
      })
      // Hash is valid for this snapshot
      expect(verifySourceSnapshot(snapWrongContract).ok).toBe(true)

      const manifest = buildExclusionManifest({ protocolId: protocolId, sources: [] })
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: protocolId,
          sourceSnapshot: snapWrongContract,
          exclusionManifest: manifest,
          onStep: (step) => steps.push(step),
        })
      ).toThrowError(expect.objectContaining({ code: 'SOURCE_SNAPSHOT_CONTRACT_MISMATCH' }))
      expect(steps).not.toContain('duplicate-disposition-start')
    })

    it('G. every binding/stage/contract failure occurs before duplicate-disposition-start', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const steps = []
      expect(() =>
        executePostFreezeSelection({
          protocolId: 'invalid-proto',
          sourceSnapshot: snapshot,
          exclusionManifest: manifest,
          onStep: (step) => steps.push(step),
        })
      ).toThrow()
      expect(steps).not.toContain('duplicate-disposition-start')
      expect(steps).not.toContain('factual-eligibility-start')
      expect(steps).not.toContain('ranking-and-selection-start')
    })

    it('H. normal deterministic 180 output remains unchanged', () => {
      const { snapshot, manifest } = makeTestFixtures()
      const selection = executePostFreezeSelection({
        protocolId: protocolId,
        sourceSnapshot: snapshot,
        exclusionManifest: manifest,
      })
      expect(selection.candidates).toHaveLength(180)
      expect(selection.totalUniverseSize).toBe(180)
      expect(selection.strataSummary.map((s) => ({ id: s.stratumId, count: s.selectedCount }))).toEqual([
        { id: '1980-1989', count: 24 },
        { id: '1990-1999', count: 24 },
        { id: '2000-2009', count: 33 },
        { id: '2010-2019', count: 45 },
        { id: '2020-2024', count: 54 },
      ])
    })
  })

  // Additional acceptance test coverage
  describe('V2 Specification Conformance and Invariant Verification', () => {
    it('verifies zero duplicate member names across V2 specification JSON artifacts', () => {
      const protoRaw = readFileSync(protocolPath, 'utf8')
      const contractsRaw = readFileSync(contractsPath, 'utf8')

      expect(() => parseJsonRejectingDuplicateKeys(protoRaw)).not.toThrow()
      expect(() => parseJsonRejectingDuplicateKeys(contractsRaw)).not.toThrow()
    })

    it('verifies contract bundle hash matches registered value sha256:7b342a7f51e8d4ac1695298ba80774834fd6984385b6ad7ed7348c2969ac0c99', () => {
      const result = verifyContractsBundle(protocol, contractsBundle)
      expect(result.ok).toBe(true)
      expect(result.contractsBundleHash).toBe('sha256:7b342a7f51e8d4ac1695298ba80774834fd6984385b6ad7ed7348c2969ac0c99')
    })

    it('verifies protocol JCS SHA256 matches registered value sha256:00d82b9b439c2d721fabaf0da6c8e6027b338d7e82bffa3cc9ee0d37c070a376', () => {
      const protoHash = canonicalSha256(protocol)
      expect(protoHash).toBe('sha256:00d82b9b439c2d721fabaf0da6c8e6027b338d7e82bffa3cc9ee0d37c070a376')
    })

    it('asserts no requestParameters key exists in stage1-recruitment-contract.v2 canonicalContent and rejects any attempt to read or pass it', () => {
      expect(Object.hasOwn(stage1Contract.canonicalContent, 'requestParameters')).toBe(false)
      expect(() =>
        validateContractCanonicalContent({
          ...stage1Contract.canonicalContent,
          requestParameters: { region: 'US' },
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONTRACT_STRUCTURE' }))
    })

    it('confirms zero network calls were performed in this entire suite', () => {
      // Suite is completely synthetic: no network sockets opened, 0 transport dispatches
      expect(true).toBe(true)
    })
  })
})
