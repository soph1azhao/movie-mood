import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  V3_MAX_PAGE,
  V3_PARTITION_HASH,
  V3_PROTOCOL_ID,
  V3_STATUSES,
  V3_TERMINAL_PRECEDENCE,
  buildAnnualPageRequest,
  buildPaginationPlan,
  buildV3ExclusionManifest,
  canonicalizeRawResponseCorpus,
  canonicalizeRequestManifest,
  createV3SourceSnapshot,
  evaluatePage1Gate,
  executeV3PostFreezeSelection,
  isPhase2PageAuthorized,
  loadRegisteredV3Spec,
  resolveV3PartitionDuplicates,
  serializeAnnualRequest,
  validateAnnualRequest,
  validateLaterPageResponse,
  validateSerializedAnnualRequest,
  verifyCorpusCompleteness,
  verifyPaginationPlan,
  verifyV3ExclusionManifest,
  verifyV3SourceSnapshot,
} from './c1bV3Stage1.mjs'
import { canonicalSha256, parseJsonRejectingDuplicateKeys } from './c1bV2Stage0.mjs'

let frozen
beforeAll(async () => { frozen = await loadRegisteredV3Spec() })

const clone = (value) => structuredClone(value)
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const movie = (id, year, suffix = '', releaseDate = undefined) => ({
  id,
  title: `Synthetic ${id}${suffix}`,
  release_date: releaseDate ?? `${year}-06-15`,
  vote_count: 500,
  vote_average: 7,
  original_language: 'en',
  genre_ids: [18],
})

function fixture({ perStratum = false } = {}) {
  const quotas = new Map([
    ['1980-1989', 24],
    ['1990-1999', 24],
    ['2000-2009', 33],
    ['2010-2019', 45],
    ['2020-2024', 54],
  ])
  const responses = new Map()
  let id = 100000
  for (const cell of frozen.cells) {
    const count = perStratum ? (cell.year % 10 === 0 ? quotas.get(cell.parentStratumId) : 0) : 1
    const results = Array.from({ length: count }, () => movie(id++, cell.year))
    responses.set(cell.cellId, { page: 1, total_pages: count ? 1 : 0, total_results: results.length, results })
  }
  const requests = frozen.cells.map((cell) => buildAnnualPageRequest(frozen, cell.cellId, 1))
  const gates = frozen.cells.map((cell) => evaluatePage1Gate(buildAnnualPageRequest(frozen, cell.cellId, 1), responses.get(cell.cellId)))
  const plan = buildPaginationPlan(frozen, gates)
  const corpus = frozen.cells.map((cell) => ({ cellId: cell.cellId, requestedPage: 1, response: responses.get(cell.cellId) }))
  return { requests, gates, plan, corpus }
}

function twoPageFixture() {
  const responses = new Map()
  let id = 200000
  for (const cell of frozen.cells) {
    const isMulti = cell.cellId === 'year-1981'
    const total_pages = isMulti ? 2 : 1
    const results = [movie(id++, cell.year)]
    responses.set(cell.cellId, { page: 1, total_pages, total_results: isMulti ? 2 : 1, results })
  }
  const requests = frozen.cells.map((cell) => buildAnnualPageRequest(frozen, cell.cellId, 1))
  const gates = frozen.cells.map((cell) => evaluatePage1Gate(buildAnnualPageRequest(frozen, cell.cellId, 1), responses.get(cell.cellId)))
  const plan = buildPaginationPlan(frozen, gates)
  return { responses, requests, gates, plan }
}

describe('C1b-V3 Stage 1A deterministic annual-partition recruitment', () => {
  it('loads the registered frozen partition and terminal precedence exactly', () => {
    expect(frozen.cells).toHaveLength(45)
    expect(frozen.cells[0].cellId).toBe('year-1980')
    expect(frozen.cells.at(-1).cellId).toBe('year-2024')
    expect(canonicalSha256(frozen.content.partitionManifest)).toBe(V3_PARTITION_HASH)
    expect(V3_TERMINAL_PRECEDENCE).toEqual(frozen.content.terminalResultPrecedence.map((x) => x.status))
  })

  it('rejects duplicate JSON keys while loading frozen inputs', () => {
    expect(() => parseJsonRejectingDuplicateKeys('{"a":1,"a":2}')).toThrow()
  })

  it('derives only exact annual requests and rejects provider-visible deviations', () => {
    const request = buildAnnualPageRequest(frozen, 'year-1997', 1)
    expect(request.params).toEqual({
      include_adult: false,
      include_video: false,
      language: 'en-US',
      page: 1,
      'primary_release_date.gte': '1997-01-01',
      'primary_release_date.lte': '1997-12-31',
      sort_by: 'primary_release_date.asc',
      'vote_count.gte': 200,
      'vote_count.lte': 2000,
    })
    const serialized = serializeAnnualRequest(frozen, request)
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1997', serialized)).not.toThrow()
    for (const mutation of [
      (x) => { x.params.region = 'US' },
      (x) => { x.params.page = '1' },
      (x) => { x.params['primary_release_date.gte'] = '1997-01-02' },
      (x) => { x.params.include_video = true },
    ]) {
      const bad = clone(request)
      mutation(bad)
      expect(() => validateAnnualRequest(frozen, bad)).toThrow()
    }
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1997', `${serialized}&page=1`)).toThrow()
    expect(() => buildAnnualPageRequest(frozen, 'year-1997', 2)).toThrow()
  })

  it('requires a verified pagination plan for every Phase-2 use and fails closed when tampered', () => {
    const { plan } = twoPageFixture()
    const cellId = 'year-1981'
    expect(plan.entries.find((e) => e.cellId === cellId).total_pages).toBe(2)
    expect(plan.entries.find((e) => e.cellId === cellId).requiredPages).toEqual([1, 2])

    // Page 2 is genuinely authorized with valid plan
    expect(isPhase2PageAuthorized(plan, cellId, 2, frozen)).toBe(true)
    const page2Req = buildAnnualPageRequest(frozen, cellId, 2, { phase: 'page2', paginationPlan: plan })
    expect(page2Req.page).toBe(2)
    expect(() => validateAnnualRequest(frozen, page2Req, { phase: 'page2', paginationPlan: plan })).not.toThrow()

    const page2Res = { page: 2, total_pages: 2, total_results: 2, results: [movie(300000, 1981)] }
    expect(validateLaterPageResponse(frozen, plan, page2Req, page2Res).status).toBe('LATER_PAGE_ACCEPTED')
    expect(validateLaterPageResponse(plan, page2Req, page2Res).status).toBe('LATER_PAGE_ACCEPTED')

    // Tamper ONLY paginationPlanHash
    const tamperedPlan = freeze({ ...clone(plan), paginationPlanHash: `sha256:${'0'.repeat(64)}` })

    // Both request authorization and later-response validation must reject/fail closed
    expect(() => buildAnnualPageRequest(frozen, cellId, 2, { phase: 'page2', paginationPlan: tamperedPlan })).toThrow()
    expect(() => validateAnnualRequest(frozen, page2Req, { phase: 'page2', paginationPlan: tamperedPlan })).toThrow()
    expect(() => validateLaterPageResponse(frozen, tamperedPlan, page2Req, page2Res)).toThrow()
    expect(() => validateLaterPageResponse(tamperedPlan, page2Req, page2Res)).toThrow()
    expect(isPhase2PageAuthorized(tamperedPlan, cellId, 2, frozen)).toBe(false)
    expect(isPhase2PageAuthorized(tamperedPlan, cellId, 2)).toBe(false)
  })

  it('strictly verifies pagination plan structure, order, cell count, and page ranges', () => {
    const { plan } = twoPageFixture()
    expect(() => verifyPaginationPlan(frozen, plan)).not.toThrow()

    // Wrong paginationPlanHash
    expect(() => verifyPaginationPlan(frozen, { ...plan, paginationPlanHash: 'sha256:bad' })).toThrow()

    // Altered total_pages
    const badPages = clone(plan)
    badPages.entries[1].total_pages = 3
    badPages.paginationPlanHash = canonicalSha256({ entries: badPages.entries })
    expect(() => verifyPaginationPlan(frozen, badPages)).toThrow()

    // Altered total_results
    const badResults = clone(plan)
    badResults.entries[1].total_results = -1
    badResults.paginationPlanHash = canonicalSha256({ entries: badResults.entries })
    expect(() => verifyPaginationPlan(frozen, badResults)).toThrow()

    // Altered requiredPages
    const badRequired = clone(plan)
    badRequired.entries[1].requiredPages = [1, 3]
    badRequired.paginationPlanHash = canonicalSha256({ entries: badRequired.entries })
    expect(() => verifyPaginationPlan(frozen, badRequired)).toThrow()

    // Wrong cell order
    const badOrder = clone(plan)
    badOrder.entries.reverse()
    badOrder.paginationPlanHash = canonicalSha256({ entries: badOrder.entries })
    expect(() => verifyPaginationPlan(frozen, badOrder)).toThrow()

    // Missing cell (44 cells)
    const missingCell = clone(plan)
    missingCell.entries.pop()
    missingCell.paginationPlanHash = canonicalSha256({ entries: missingCell.entries })
    expect(() => verifyPaginationPlan(frozen, missingCell)).toThrow()

    // Extra cell (46 cells)
    const extraCell = clone(plan)
    extraCell.entries.push({ cellId: 'year-2025', total_pages: 1, total_results: 1, requiredPages: [1] })
    extraCell.paginationPlanHash = canonicalSha256({ entries: extraCell.entries })
    expect(() => verifyPaginationPlan(frozen, extraCell)).toThrow()
  })

  it('validates gate semantics inside buildPaginationPlan and rejects fabricated gates', () => {
    const data = fixture()

    const zeroResults = clone(data.gates)
    zeroResults[0] = {
      status: 'PAGE1_ACCEPTED',
      cellId: 'year-1980',
      total_pages: 1,
      total_results: 0,
    }

    expect(() => buildPaginationPlan(frozen, zeroResults)).not.toThrow()

    // Non-integer total_pages
    const gateFloatPages = clone(data.gates)
    gateFloatPages[0] = { status: 'PAGE1_ACCEPTED', cellId: 'year-1980', total_pages: 1.5, total_results: 10 }
    expect(() => buildPaginationPlan(frozen, gateFloatPages)).toThrow()

    // String total_pages
    const gateStrPages = clone(data.gates)
    gateStrPages[0] = { status: 'PAGE1_ACCEPTED', cellId: 'year-1980', total_pages: '1', total_results: 10 }
    expect(() => buildPaginationPlan(frozen, gateStrPages)).toThrow()

    // Non-integer or negative total_results
    const gateNegResults = clone(data.gates)
    gateNegResults[0] = { status: 'PAGE1_ACCEPTED', cellId: 'year-1980', total_pages: 1, total_results: -5 }
    expect(() => buildPaginationPlan(frozen, gateNegResults)).toThrow()

    // EMPTY_CELL with totals other than exactly 0/0
    const emptyWithPages = clone(data.gates)
    emptyWithPages[0] = { status: 'EMPTY_CELL', cellId: 'year-1980', total_pages: 1, total_results: 0 }
    expect(() => buildPaginationPlan(frozen, emptyWithPages)).toThrow()

    const emptyWithResults = clone(data.gates)
    emptyWithResults[0] = { status: 'EMPTY_CELL', cellId: 'year-1980', total_pages: 0, total_results: 1 }
    expect(() => buildPaginationPlan(frozen, emptyWithResults)).toThrow()

    // Non-accepted status
    const budgetGate = clone(data.gates)
    budgetGate[0] = { status: V3_STATUSES.budget, cellId: 'year-1980', total_pages: 55 }
    expect(() => buildPaginationPlan(frozen, budgetGate)).toThrow()
  })

  it('parses serialized requests strictly at the first question mark and rejects suffixes', () => {
    const request = buildAnnualPageRequest(frozen, 'year-1980', 1)
    const serialized = serializeAnnualRequest(frozen, request)

    // Valid serialized request passes
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1980', serialized)).not.toThrow()

    // Additional question mark (<otherwise-valid-request>?evil=1) must NOT validate
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1980', `${serialized}?evil=1`)).toThrow()

    // Trailing serialized parameter must NOT validate
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1980', `${serialized}&extra=bad`)).toThrow()

    // Duplicate query key must NOT validate
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1980', `${serialized}&page=1`)).toThrow()

    // Missing query key must NOT validate
    const missingParam = serialized.replace(/&vote_count\.lte=2000/u, '')
    expect(() => validateSerializedAnnualRequest(frozen, 'year-1980', missingParam)).toThrow()
  })

  it('requires integer logical page identities in corpus for nonempty and empty cells', () => {
    const data = fixture()

    // Nonempty cell: string requestedPage
    const strReq = clone(data.corpus)
    strReq[0].requestedPage = '1'
    expect(() => verifyCorpusCompleteness(frozen, data.plan, data.requests, strReq)).toThrow()

    // Nonempty cell: string response.page
    const strRes = clone(data.corpus)
    strRes[0].response.page = '1'
    expect(() => verifyCorpusCompleteness(frozen, data.plan, data.requests, strRes)).toThrow()

    // Nonempty cell: non-integer float
    const floatReq = clone(data.corpus)
    floatReq[0].requestedPage = 1.5
    expect(() => verifyCorpusCompleteness(frozen, data.plan, data.requests, floatReq)).toThrow()

    // Empty cell: integer required, strings must be rejected
    const emptyGates = clone(data.gates)
    emptyGates[0] = { status: 'EMPTY_CELL', cellId: 'year-1980', total_pages: 0, total_results: 0 }
    const emptyPlan = buildPaginationPlan(frozen, emptyGates)
    const emptyCorpus = clone(data.corpus)
    emptyCorpus[0] = { cellId: 'year-1980', requestedPage: 1, response: { page: 1, total_pages: 0, total_results: 0, results: [] } }

    expect(() => verifyCorpusCompleteness(frozen, emptyPlan, data.requests, emptyCorpus)).not.toThrow()

    const emptyStrReq = clone(emptyCorpus)
    emptyStrReq[0].requestedPage = '1'
    expect(() => verifyCorpusCompleteness(frozen, emptyPlan, data.requests, emptyStrReq)).toThrow()

    const emptyStrRes = clone(emptyCorpus)
    emptyStrRes[0].response.page = '1'
    expect(() => verifyCorpusCompleteness(frozen, emptyPlan, data.requests, emptyStrRes)).toThrow()
  })

  it('validates Phase-2 later responses and detects total_pages / total_results pagination drift', () => {
    const { plan } = twoPageFixture()
    const cellId = 'year-1981'
    const page2Req = buildAnnualPageRequest(frozen, cellId, 2, { phase: 'page2', paginationPlan: plan })

    // Valid Phase-2 response
    const validRes = { page: 2, total_pages: 2, total_results: 2, results: [movie(400000, 1981)] }
    expect(validateLaterPageResponse(frozen, plan, page2Req, validRes).status).toBe('LATER_PAGE_ACCEPTED')

    // total_pages drift
    const driftPages = { page: 2, total_pages: 3, total_results: 2, results: [movie(400000, 1981)] }
    expect(validateLaterPageResponse(frozen, plan, page2Req, driftPages).status).toBe(V3_STATUSES.drift)

    // total_results drift
    const driftResults = { page: 2, total_pages: 2, total_results: 5, results: [movie(400000, 1981)] }
    expect(validateLaterPageResponse(frozen, plan, page2Req, driftResults).status).toBe(V3_STATUSES.drift)
  })

  it('strengthens exclusion manifest verification and rejects non-string provenance and reasons', () => {
    const validManifest = buildV3ExclusionManifest({
      sources: [
        {
          sourceName: 'src-a',
          entries: [
            { tmdbId: 10, canonicalId: 'can-10', title: 'Film 10', provenance: 'prov-a', reason: 'reason-a' },
            { tmdbId: 20, canonicalId: null, title: null, provenance: ['prov-b', 'prov-c'], reasons: ['reason-b'] },
          ],
        },
      ],
    })
    expect(() => verifyV3ExclusionManifest(validManifest)).not.toThrow()

    // Correctly re-hashed manifest containing provenance: [123]
    const badProvPayload = {
      protocolId: V3_PROTOCOL_ID,
      manifestVersion: 1,
      exclusions: [
        { canonicalId: 'can-10', provenance: [123], reasons: ['reason-a'], title: 'Film 10', tmdbId: 10 },
      ],
    }
    const badProvManifest = { ...badProvPayload, exclusionManifestHash: canonicalSha256(badProvPayload) }
    expect(() => verifyV3ExclusionManifest(badProvManifest)).toThrow()

    // Correctly re-hashed manifest containing reasons: [123]
    const badReasonPayload = {
      protocolId: V3_PROTOCOL_ID,
      manifestVersion: 1,
      exclusions: [
        { canonicalId: 'can-10', provenance: ['prov-a'], reasons: [123], title: 'Film 10', tmdbId: 10 },
      ],
    }
    const badReasonManifest = { ...badReasonPayload, exclusionManifestHash: canonicalSha256(badReasonPayload) }
    expect(() => verifyV3ExclusionManifest(badReasonManifest)).toThrow()

    // Re-hashed manifest with invalid canonicalId type
    const badCanPayload = {
      protocolId: V3_PROTOCOL_ID,
      manifestVersion: 1,
      exclusions: [
        { canonicalId: 999, provenance: ['prov-a'], reasons: ['reason-a'], title: 'Film 10', tmdbId: 10 },
      ],
    }
    const badCanManifest = { ...badCanPayload, exclusionManifestHash: canonicalSha256(badCanPayload) }
    expect(() => verifyV3ExclusionManifest(badCanManifest)).toThrow()

    // Re-hashed manifest with invalid title type
    const badTitlePayload = {
      protocolId: V3_PROTOCOL_ID,
      manifestVersion: 1,
      exclusions: [
        { canonicalId: 'can-10', provenance: ['prov-a'], reasons: ['reason-a'], title: false, tmdbId: 10 },
      ],
    }
    const badTitleManifest = { ...badTitlePayload, exclusionManifestHash: canonicalSha256(badTitlePayload) }
    expect(() => verifyV3ExclusionManifest(badTitleManifest)).toThrow()

    // buildV3ExclusionManifest cannot return an artifact with non-string provenance/reason/metadata
    expect(() => buildV3ExclusionManifest({
      sources: [{ sourceName: 'bad', entries: [{ tmdbId: 1, provenance: 123 }] }],
    })).toThrow()
    expect(() => buildV3ExclusionManifest({
      sources: [{ sourceName: 'bad', entries: [{ tmdbId: 1, reasons: 123 }] }],
    })).toThrow()
    expect(() => buildV3ExclusionManifest({
      sources: [{ sourceName: 'bad', entries: [{ tmdbId: 1, canonicalId: 123 }] }],
    })).toThrow()
  })

  it('aligns usable release_date membership semantics for valid vs out-of-cell vs malformed dates', () => {
    const data = fixture()

    // 1. Valid in-cell date
    const inCellCorpus = clone(data.corpus)
    inCellCorpus[0].response.results[0].release_date = '1980-06-15'
    const inCellSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, inCellCorpus)
    expect(resolveV3PartitionDuplicates(inCellSnapshot, frozen).status).toBe('OK')

    // 2. Valid out-of-cell date -> MEMBERSHIP VIOLATION
    const outOfCellCorpus = clone(data.corpus)
    outOfCellCorpus[0].response.results[0].release_date = '1999-01-01'
    const outOfCellSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, outOfCellCorpus)
    expect(resolveV3PartitionDuplicates(outOfCellSnapshot, frozen).status).toBe(V3_STATUSES.membership)

    // 3. Malformed date string -> NOT MEMBERSHIP VIOLATION (passes to factual eligibility)
    const malformedCorpus = clone(data.corpus)
    malformedCorpus[0].response.results[0].release_date = 'garbage'
    const malformedSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, malformedCorpus)
    const result = resolveV3PartitionDuplicates(malformedSnapshot, frozen)
    expect(result.status).not.toBe(V3_STATUSES.membership)
    expect(result.status).toBe('OK')

    // In post-freeze selection, 'garbage' is screened out as factually ineligible
    const postSelection = executeV3PostFreezeSelection({
      frozen,
      paginationPlan: data.plan,
      sourceSnapshot: malformedSnapshot,
      exclusionManifest: buildV3ExclusionManifest({ sources: [] }),
    })
    // Since 1980 candidate had release_date 'garbage', stratum 1980-1989 has 0 eligible candidates -> insufficient
    expect(postSelection.status).toBe(V3_STATUSES.insufficient)
  })

  it('enforces binary lexicographic order on SHA-256 rank hashes matching V2', () => {
    const data = fixture({ perStratum: true })
    const snapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, data.corpus)
    const result = executeV3PostFreezeSelection({
      frozen,
      paginationPlan: data.plan,
      sourceSnapshot: snapshot,
      exclusionManifest: buildV3ExclusionManifest({ sources: [] }),
    })
    expect(result.status).toBe(V3_STATUSES.complete)
    expect(result.candidates).toHaveLength(180)
    expect(result.finalCandidateCount).toBe(180)

    // Independently compute rank hashes and verify exact candidate ordering
    const candidatesByStratum = new Map()
    for (const c of result.candidates) {
      const year = Number(c.release_date.slice(0, 4))
      const stratumId = year < 1990 ? '1980-1989' : year < 2000 ? '1990-1999' : year < 2010 ? '2000-2009' : year < 2020 ? '2010-2019' : '2020-2024'
      const list = candidatesByStratum.get(stratumId) ?? []
      list.push(c)
      candidatesByStratum.set(stratumId, list)
    }

    for (const [stratumId, candidates] of candidatesByStratum) {
      for (let i = 0; i < candidates.length; i++) {
        const preimage = `${V3_PROTOCOL_ID}|stage1-select|${stratumId}|${candidates[i].id}`
        const expectedRank = createHash('sha256').update(preimage, 'utf8').digest('hex')
        expect(candidates[i].rank).toBe(expectedRank)
        if (i > 0) {
          const prev = candidates[i - 1].rank
          const curr = candidates[i].rank
          // Strictly binary / code-unit lexicographic order
          expect(prev < curr).toBe(true)
        }
      }
    }
  })

  it('enforces frozen boundaries: page 50 accepted vs 51 rejected, missing/extra query keys, duplicate collapses', () => {
    const request = buildAnnualPageRequest(frozen, 'year-1980', 1)

    // Page 50 accepted vs page 51 rejected at gate
    expect(evaluatePage1Gate(request, { page: 1, total_pages: 50, total_results: 1000, results: [] }).status).toBe('PAGE1_ACCEPTED')
    expect(evaluatePage1Gate(request, { page: 1, total_pages: 51, total_results: 1020, results: [] }).status).toBe(V3_STATUSES.budget)

    // Request builder rejects page 51
    expect(() => buildAnnualPageRequest(frozen, 'year-1980', 51)).toThrow()

    // Missing / extra query key validation
    const extraKeyReq = clone(request)
    extraKeyReq.params.extra_param = 'forbidden'
    expect(() => validateAnnualRequest(frozen, extraKeyReq)).toThrow()

    const missingKeyReq = clone(request)
    delete missingKeyReq.params['vote_count.lte']
    expect(() => validateAnnualRequest(frozen, missingKeyReq)).toThrow()

    // Within-cell identical duplicate collapses
    const data = fixture()
    const duplicateCorpus = clone(data.corpus)
    duplicateCorpus[0].response.results = [movie(500000, 1980), movie(500000, 1980)]
    const duplicateSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, duplicateCorpus)
    const collapsed = resolveV3PartitionDuplicates(duplicateSnapshot, frozen)
    expect(collapsed.status).toBe('OK')
    expect(collapsed.records.filter((r) => r.id === 500000)).toHaveLength(1)

    // Within-cell non-identical duplicate blocks
    const conflictingCorpus = clone(data.corpus)
    conflictingCorpus[0].response.results = [movie(500000, 1980, 'A'), movie(500000, 1980, 'B')]
    const conflictingSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, conflictingCorpus)
    expect(resolveV3PartitionDuplicates(conflictingSnapshot, frozen).status).toBe(V3_STATUSES.duplicate)

    // Cross-cell identical records block
    const crossIdenticalCorpus = clone(data.corpus)
    crossIdenticalCorpus[0].response.results = [movie(600000, 1980, '', 'garbage')]
    crossIdenticalCorpus[1].response.results = [movie(600000, 1980, '', 'garbage')]
    const crossIdenticalSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, crossIdenticalCorpus)
    expect(resolveV3PartitionDuplicates(crossIdenticalSnapshot, frozen).status).toBe(V3_STATUSES.crossCell)

    // Cross-cell non-identical records with same ID block
    const crossDiffCorpus = clone(data.corpus)
    crossDiffCorpus[0].response.results = [movie(600000, 1980)]
    crossDiffCorpus[1].response.results = [movie(600000, 1981)]
    const crossDiffSnapshot = createV3SourceSnapshot(frozen, data.plan, data.requests, crossDiffCorpus)
    expect(resolveV3PartitionDuplicates(crossDiffSnapshot, frozen).status).toBe(V3_STATUSES.crossCell)
  })

  it('leaves the registered V2 and V3 protocol sources unchanged', () => {
    const raw = readFileSync('catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json', 'utf8')
    expect(`sha256:${createHash('sha256').update(raw).digest('hex')}`).toBe('sha256:3568b8fd4f2895ab4b9e2cdba145e501e737c784d08a948491413de47483b374')
  })
})
