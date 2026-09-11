// C1b-V3 Stage 1A: deterministic annual-partition recruitment core.
// This module deliberately contains no transport, WAL, lock, or network I/O.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalize, canonicalSha256, parseJsonRejectingDuplicateKeys, verifyContractsBundle } from './c1bV2Stage0.mjs'
import { checkFactualEligibility, computeCandidateRankHash } from './c1bV2Stage1.mjs'

export const V3_PROTOCOL_ID = 'phase-5c-c1b-v-confirmatory.v3'
export const V3_STAGE1_CONTRACT_REF = 'stage1-recruitment-contract.v3'
export const V3_STAGE1_STAGE = 1
export const V3_ENDPOINT = '/discover/movie'
export const V3_MAX_PAGE = 50
export const V3_PARTITION_HASH = 'sha256:10e44ffb38f0e870a80e2a57f61719fd1bb55d6e6fd8836aadb05743a773c0c6'
export const V3_STATUSES = Object.freeze({
  inconclusive: 'OPERATIONALLY_INCONCLUSIVE',
  empty: 'BLOCKED — INVALID EMPTY-CELL PAGINATION STATE',
  budget: 'BLOCKED — ANNUAL CELL EXCEEDS PREDECLARED PAGE BUDGET',
  drift: 'BLOCKED — PROVIDER PAGINATION DRIFT',
  membership: 'BLOCKED — PARTITION MEMBERSHIP VIOLATION',
  crossCell: 'BLOCKED — CROSS-CELL TMDB ID CONFLICT',
  duplicate: 'BLOCKED — SOURCE SNAPSHOT DUPLICATE CONFLICT',
  insufficient: 'BLOCKED — INSUFFICIENT FRESH FACTUAL UNIVERSE',
  complete: 'STAGE 1 COMPLETE — FRESH FACTUAL UNIVERSE FROZEN',
})
// Terminal outcomes are ordered by the frozen Stage-1 precedence table.
export const V3_TERMINAL_PRECEDENCE = Object.freeze([
  V3_STATUSES.inconclusive,
  V3_STATUSES.empty,
  V3_STATUSES.budget,
  V3_STATUSES.drift,
  V3_STATUSES.membership,
  V3_STATUSES.crossCell,
  V3_STATUSES.duplicate,
  V3_STATUSES.insufficient,
  V3_STATUSES.complete,
])
const EXPECTED = Object.freeze({
  protocolJcs: 'sha256:4ceaa4af2db232de365e9f42a4e85ce4bdff9fb9dc56e38b3806d85c4b0f8bc2',
  protocolRaw: 'sha256:3568b8fd4f2895ab4b9e2cdba145e501e737c784d08a948491413de47483b374',
  bundle: 'sha256:2f477ef6ba7f12e17ed5f1178026e2572f9abddf12507395121519ed03b6b738',
  contract: 'sha256:00c3aa3f7509c0bf662ec8e9eb8d5e0b2119d70dbf957dc821c3aa54d310a5a4',
})
const QUERY_KEYS = Object.freeze([
  'include_adult',
  'include_video',
  'language',
  'page',
  'primary_release_date.gte',
  'primary_release_date.lte',
  'sort_by',
  'vote_count.gte',
  'vote_count.lte',
])
const STRATA = Object.freeze([
  { id: '1980-1989', quota: 24 },
  { id: '1990-1999', quota: 24 },
  { id: '2000-2009', quota: 33 },
  { id: '2010-2019', quota: 45 },
  { id: '2020-2024', quota: 54 },
])

export class V3Stage1Error extends Error {
  constructor(message, code = 'V3_STAGE1_ERROR', details) {
    super(message)
    this.name = 'V3Stage1Error'
    this.code = code
    this.details = details
  }
}
const fail = (message, code, details) => {
  throw new V3Stage1Error(message, code, details)
}
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const clone = (value) => JSON.parse(canonicalize(value))
const yearOf = (cellId) => {
  const match = /^year-(\d{4})$/u.exec(cellId ?? '')
  if (!match) fail(`Invalid annual cell ID: ${cellId}`, 'INVALID_CELL')
  return Number(match[1])
}
const compareCellPage = (a, b) => yearOf(a.cellId) - yearOf(b.cellId) || a.page - b.page
const shaRaw = (source) => `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`
const isUsableDateFormat = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(d)

export async function loadRegisteredV3Spec({ root = process.cwd() } = {}) {
  const base = resolve(root, 'catalogue-pipeline/calibration/diagnostics')
  const [protocolRaw, bundleRaw] = await Promise.all([
    readFile(resolve(base, 'phase5c-c1b-v-confirmatory.v3.json'), 'utf8'),
    readFile(resolve(base, 'phase5c-c1b-v-confirmatory.v3.contracts.json'), 'utf8'),
  ])
  const protocol = parseJsonRejectingDuplicateKeys(protocolRaw)
  const bundle = parseJsonRejectingDuplicateKeys(bundleRaw)
  if (protocol.protocolId !== V3_PROTOCOL_ID || protocol.specificationStatus !== 'registered-frozen') {
    fail('Registered V3 protocol identity/status mismatch.', 'SPECIFICATION_TAMPER')
  }
  if (
    shaRaw(protocolRaw) !== EXPECTED.protocolRaw ||
    canonicalSha256(protocol) !== EXPECTED.protocolJcs ||
    bundle.contractsBundleHash !== EXPECTED.bundle ||
    bundle.contracts.length !== 9
  ) {
    fail('Registered V3 specification hash mismatch.', 'SPECIFICATION_TAMPER')
  }
  verifyContractsBundle(protocol, bundle)
  const contract = bundle.contracts.find(({ id }) => id === V3_STAGE1_CONTRACT_REF)
  if (
    !contract ||
    contract.contentHash !== EXPECTED.contract ||
    canonicalSha256(contract.canonicalContent) !== EXPECTED.contract
  ) {
    fail('Registered V3 Stage-1 contract mismatch.', 'SPECIFICATION_TAMPER')
  }
  const partition = contract.canonicalContent.partitionManifest
  if (
    canonicalSha256(partition) !== V3_PARTITION_HASH ||
    contract.canonicalContent.partitionManifestHash !== V3_PARTITION_HASH
  ) {
    fail('Registered partition manifest mismatch.', 'SPECIFICATION_TAMPER')
  }
  const frozen = { protocol, bundle, contract, content: contract.canonicalContent, cells: clone(partition.cells) }
  verifyFrozenPartition(frozen)
  return freeze(frozen)
}

export function verifyFrozenPartition(frozen) {
  const cells = frozen?.cells
  if (!Array.isArray(cells) || cells.length !== 45) fail('V3 requires exactly 45 annual cells.', 'PARTITION_MISMATCH')
  const parent = (year) =>
    year < 1990 ? '1980-1989' : year < 2000 ? '1990-1999' : year < 2010 ? '2000-2009' : year < 2020 ? '2010-2019' : '2020-2024'
  cells.forEach((cell, index) => {
    const year = 1980 + index
    if (
      cell.cellId !== `year-${year}` ||
      cell.year !== year ||
      cell.parentStratumId !== parent(year) ||
      cell.releaseDateGte !== `${year}-01-01` ||
      cell.releaseDateLte !== `${year}-12-31` ||
      cell.pageBudget !== 50
    ) {
      fail('Frozen annual partition cell mismatch.', 'PARTITION_MISMATCH', { cell })
    }
    if (index && cells[index - 1].releaseDateLte >= cell.releaseDateGte) {
      fail('Annual partition overlap.', 'PARTITION_MISMATCH')
    }
  })
  if (cells[0].releaseDateGte !== '1980-01-01' || cells.at(-1).releaseDateLte !== '2024-12-31') {
    fail('Annual partition coverage mismatch.', 'PARTITION_MISMATCH')
  }
  return { ok: true, partitionManifestHash: V3_PARTITION_HASH, cells }
}

const cellFor = (frozen, cellId) => {
  verifyFrozenPartition(frozen)
  const cell = frozen.cells.find((x) => x.cellId === cellId)
  if (!cell) fail(`Unknown frozen cell: ${cellId}`, 'INVALID_CELL')
  return cell
}

export function buildAnnualPageRequest(frozen, cellId, page, { phase = 'page1', paginationPlan } = {}) {
  const cell = cellFor(frozen, cellId)
  if (!Number.isInteger(page) || page < 1 || page > 50) fail(`Invalid page: ${page}`, 'INVALID_PAGE')
  if (phase === 'page1' && page !== 1) fail('Phase 1 permits page 1 only.', 'UNAUTHORIZED_PHASE_PAGE')
  if (phase === 'page2') {
    if (!paginationPlan) fail('Pagination plan is required for Phase 2.', 'MISSING_PAGINATION_PLAN')
    verifyPaginationPlan(frozen, paginationPlan)
    if (page < 2 || !isPhase2PageAuthorized(paginationPlan, cellId, page, frozen)) {
      fail('Page is not authorized by frozen pagination plan.', 'UNAUTHORIZED_PHASE_PAGE')
    }
  }
  if (!['page1', 'page2'].includes(phase)) fail('Unknown request phase.', 'INVALID_PHASE')
  const fixed = frozen.content.fixedRequestParameters
  const params = {
    include_adult: fixed.include_adult,
    include_video: fixed.include_video,
    language: fixed.language,
    page,
    'primary_release_date.gte': cell.releaseDateGte,
    'primary_release_date.lte': cell.releaseDateLte,
    sort_by: fixed.sort_by,
    'vote_count.gte': fixed['vote_count.gte'],
    'vote_count.lte': fixed['vote_count.lte'],
  }
  const request = { endpoint: V3_ENDPOINT, cellId, page, params }
  validateAnnualRequest(frozen, request, { phase, paginationPlan })
  return freeze(request)
}

export function validateAnnualRequest(frozen, target, { phase = 'page1', paginationPlan } = {}) {
  if (typeof target === 'string') fail('Use validateSerializedAnnualRequest for serialized requests.', 'INVALID_REQUEST')
  const request = target
  if (!request || request.endpoint !== V3_ENDPOINT || !request.params || typeof request.params !== 'object') {
    fail('Invalid annual request.', 'INVALID_REQUEST')
  }
  const cell = cellFor(frozen, request.cellId)
  const params = request.params
  if (
    Object.keys(params).length !== QUERY_KEYS.length ||
    QUERY_KEYS.some((key) => !Object.hasOwn(params, key)) ||
    Object.keys(params).some((key) => !QUERY_KEYS.includes(key))
  ) {
    fail('Provider-visible query key set must be exact.', 'INVALID_QUERY_KEYS')
  }
  if (
    ['region', 'cellId', 'stratumId', 'protocolId', 'requestPurpose', 'credentials', 'api_key', 'authorization'].some(
      (key) => Object.hasOwn(params, key)
    )
  ) {
    fail('Forbidden provider-visible query parameter.', 'FORBIDDEN_PARAMETER')
  }
  if (
    params.include_adult !== false ||
    params.include_video !== false ||
    params.language !== 'en-US' ||
    params.sort_by !== 'primary_release_date.asc' ||
    params['vote_count.gte'] !== 200 ||
    params['vote_count.lte'] !== 2000
  ) {
    fail('Frozen provider parameter value mismatch.', 'INVALID_REQUEST_PARAMETERS')
  }
  if (!Number.isInteger(params.page) || params.page < 1 || params.page > 50 || request.page !== params.page) {
    fail('Page must be an integer 1..50.', 'INVALID_PAGE')
  }
  if (params['primary_release_date.gte'] !== cell.releaseDateGte || params['primary_release_date.lte'] !== cell.releaseDateLte) {
    fail('Request date bounds do not match frozen annual cell.', 'INVALID_CELL_DATE_BOUNDS')
  }
  if (phase === 'page1' && params.page !== 1) fail('Phase 1 permits page 1 only.', 'UNAUTHORIZED_PHASE_PAGE')
  if (phase === 'page2') {
    if (!paginationPlan) fail('Pagination plan is required for Phase 2.', 'MISSING_PAGINATION_PLAN')
    verifyPaginationPlan(frozen, paginationPlan)
    if (params.page < 2 || !isPhase2PageAuthorized(paginationPlan, request.cellId, params.page, frozen)) {
      fail('Phase 2 page not authorized.', 'UNAUTHORIZED_PHASE_PAGE')
    }
  }
  return { ok: true }
}

function parseSerializedRequest(value) {
  if (typeof value !== 'string') fail('Serialized request must be a string.', 'INVALID_REQUEST')
  const qIndex = value.indexOf('?')
  if (qIndex === -1) fail('Invalid endpoint separator.', 'INVALID_ENDPOINT')
  const endpoint = value.slice(0, qIndex)
  const query = value.slice(qIndex + 1)
  if (endpoint !== V3_ENDPOINT) fail('Invalid endpoint.', 'INVALID_ENDPOINT')
  if (query.includes('?')) fail('Serialized request contains unexpected additional question mark.', 'INVALID_REQUEST')
  const params = {}
  for (const [key, val] of new URLSearchParams(query)) {
    if (!key) fail('Empty query parameter key.', 'INVALID_REQUEST')
    if (Object.hasOwn(params, key)) fail('Duplicate query parameter.', 'DUPLICATE_QUERY_PARAMETER')
    params[key] = val
  }
  return { endpoint, params, page: Number(params.page), cellId: undefined }
}

export function serializeAnnualRequest(frozen, request, options = {}) {
  validateAnnualRequest(frozen, request, options)
  return `${V3_ENDPOINT}?${QUERY_KEYS.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(request.params[k]))}`).join('&')}`
}

export function validateSerializedAnnualRequest(frozen, cellId, value, options = {}) {
  const parsed = parseSerializedRequest(value)
  if (!/^\d+$/u.test(parsed.params.page ?? '')) fail('Serialized page must be an integer literal.', 'INVALID_PAGE')
  if (!/^\d+$/u.test(parsed.params['vote_count.gte'] ?? '')) fail('Serialized vote_count.gte must be an integer literal.', 'INVALID_REQUEST_PARAMETERS')
  if (!/^\d+$/u.test(parsed.params['vote_count.lte'] ?? '')) fail('Serialized vote_count.lte must be an integer literal.', 'INVALID_REQUEST_PARAMETERS')
  const request = {
    endpoint: parsed.endpoint,
    cellId,
    page: Number(parsed.params.page),
    params: {
      ...parsed.params,
      include_adult: parsed.params.include_adult === 'false' ? false : parsed.params.include_adult,
      include_video: parsed.params.include_video === 'false' ? false : parsed.params.include_video,
      page: Number(parsed.params.page),
      'vote_count.gte': Number(parsed.params['vote_count.gte']),
      'vote_count.lte': Number(parsed.params['vote_count.lte']),
    },
  }
  return validateAnnualRequest(frozen, request, options)
}

export function evaluatePage1Gate(request, response) {
  if (
    request?.page !== 1 ||
    response?.page !== 1 ||
    !Number.isInteger(response?.total_pages) ||
    response.total_pages < 0 ||
    !Number.isInteger(response.total_results) ||
    response.total_results < 0 ||
    !Array.isArray(response.results)
  ) {
    return { status: V3_STATUSES.inconclusive }
  }
  if (response.total_pages === 0) {
    return response.total_results === 0 && response.results.length === 0
      ? freeze({ status: 'EMPTY_CELL', cellId: request.cellId, total_pages: 0, total_results: 0 })
      : freeze({ status: V3_STATUSES.empty, cellId: request.cellId })
  }
  if (response.total_pages > 50) return freeze({ status: V3_STATUSES.budget, cellId: request.cellId, total_pages: response.total_pages })
  return freeze({ status: 'PAGE1_ACCEPTED', cellId: request.cellId, total_pages: response.total_pages, total_results: response.total_results })
}

export function buildPaginationPlan(frozen, gateResults) {
  verifyFrozenPartition(frozen)
  if (!Array.isArray(gateResults) || gateResults.length !== 45) fail('All 45 page-1 results are required.', 'INVALID_PAGINATION_PLAN')
  const byCell = new Map(gateResults.map((x) => [x?.cellId, x]))
  const entries = frozen.cells.map((cell) => {
    const result = byCell.get(cell.cellId)
    if (!result || typeof result !== 'object') fail('Missing page-1 gate result.', 'PAGE1_GATE_FAILED', { cellId: cell.cellId })
    if (result.status === 'EMPTY_CELL') {
      if (result.total_pages !== 0 || result.total_results !== 0) {
        fail('EMPTY_CELL gate result must have total_pages=0 and total_results=0.', 'INVALID_PAGE1_GATE_RESULT', { cellId: cell.cellId })
      }
      return { cellId: cell.cellId, total_pages: 0, total_results: 0, requiredPages: [] }
    }
    if (result.status === 'PAGE1_ACCEPTED') {
      if (!Number.isInteger(result.total_pages) || result.total_pages < 1 || !Number.isInteger(result.total_results) || result.total_results < 0) {
        fail('PAGE1_ACCEPTED requires total_pages >= 1 and non-negative integer total_results.', 'INVALID_PAGE1_GATE_RESULT', { cellId: cell.cellId })
      }
      if (result.total_pages > V3_MAX_PAGE) {
        fail('A 51-page condition must never produce a pagination plan.', 'PAGE1_GATE_FAILED', { cellId: cell.cellId, total_pages: result.total_pages })
      }
      const n = result.total_pages
      return {
        cellId: cell.cellId,
        total_pages: n,
        total_results: result.total_results,
        requiredPages: Array.from({ length: n }, (_, i) => i + 1),
      }
    }
    fail('Cannot plan after failed page-1 gate.', 'PAGE1_GATE_FAILED', { cellId: cell.cellId, status: result.status })
  })
  const payload = { entries }
  const plan = freeze({ ...clone(payload), paginationPlanHash: canonicalSha256(payload) })
  verifyPaginationPlan(frozen, plan)
  return plan
}

export function verifyPaginationPlan(frozen, plan) {
  if (!plan?.paginationPlanHash || !Array.isArray(plan?.entries) || canonicalSha256({ entries: plan.entries }) !== plan.paginationPlanHash) {
    fail('Pagination plan hash mismatch.', 'PAGINATION_PLAN_HASH_MISMATCH')
  }
  const expected = frozen?.cells?.map((x) => x.cellId) ?? Array.from({ length: 45 }, (_, i) => `year-${1980 + i}`)
  if (plan.entries.length !== 45 || plan.entries.map((x) => x.cellId).join('|') !== expected.join('|')) {
    fail('Pagination plan order mismatch.', 'PAGINATION_PLAN_MISMATCH')
  }
  for (const entry of plan.entries) {
    if (
      Object.keys(entry).sort().join('|') !== 'cellId|requiredPages|total_pages|total_results' ||
      !Number.isInteger(entry.total_pages) ||
      entry.total_pages < 0 ||
      entry.total_pages > V3_MAX_PAGE ||
      !Number.isInteger(entry.total_results) ||
      entry.total_results < 0
    ) {
      fail('Pagination plan entry shape is invalid.', 'PAGINATION_PLAN_MISMATCH')
    }
    const required = entry.total_pages === 0 ? [] : Array.from({ length: entry.total_pages }, (_, index) => index + 1)
    if (canonicalize(entry.requiredPages) !== canonicalize(required)) {
      fail('Pagination plan pages are not frozen exactly.', 'PAGINATION_PLAN_MISMATCH')
    }
  }
  return { ok: true }
}

export function isPhase2PageAuthorized(plan, cellId, page, frozen = undefined) {
  try {
    verifyPaginationPlan(frozen, plan)
  } catch {
    return false
  }
  const entry = plan?.entries?.find((x) => x.cellId === cellId)
  return Boolean(entry && Number.isInteger(page) && page >= 2 && entry.requiredPages.includes(page))
}

export function validateLaterPageResponse(arg1, arg2, arg3, arg4) {
  let frozen, plan, request, response
  if (arg1?.cells || arg1?.content) {
    frozen = arg1
    plan = arg2
    request = arg3
    response = arg4
  } else {
    plan = arg1
    request = arg2
    response = arg3
    frozen = arg4
  }
  verifyPaginationPlan(frozen, plan)
  const entry = plan?.entries?.find((x) => x.cellId === request?.cellId)
  if (
    !entry ||
    !isPhase2PageAuthorized(plan, request?.cellId, request?.page, frozen) ||
    response?.page !== request?.page ||
    !Number.isInteger(response?.page) ||
    !Number.isInteger(response?.total_pages) ||
    !Number.isInteger(response?.total_results) ||
    !Array.isArray(response?.results)
  ) {
    return { status: V3_STATUSES.inconclusive }
  }
  if (response.total_pages !== entry.total_pages || response.total_results !== entry.total_results) {
    return { status: V3_STATUSES.drift }
  }
  return { status: 'LATER_PAGE_ACCEPTED' }
}

export function canonicalizeRequestManifest(requests) {
  if (!Array.isArray(requests)) fail('Request manifest must be an array.', 'INVALID_MANIFEST')
  for (const req of requests) {
    if (!Number.isInteger(req?.page)) fail('Request manifest page must be an integer.', 'INVALID_PAGE')
  }
  return freeze(clone([...requests].sort(compareCellPage)))
}

export function canonicalizeRawResponseCorpus(entries) {
  if (!Array.isArray(entries)) fail('Raw corpus must be an array.', 'INVALID_CORPUS')
  for (const entry of entries) {
    if (!Number.isInteger(entry?.requestedPage)) {
      fail('Corpus entry requestedPage must be an integer.', 'INVALID_CORPUS_PAGE')
    }
  }
  return freeze(clone([...entries].sort((a, b) => yearOf(a.cellId) - yearOf(b.cellId) || a.requestedPage - b.requestedPage)))
}

export function verifyCorpusCompleteness(frozen, plan, requests, corpus) {
  verifyPaginationPlan(frozen, plan)
  const rs = canonicalizeRequestManifest(requests)
  const cs = canonicalizeRawResponseCorpus(corpus)
  const allowed = new Set(frozen.cells.map((cell) => cell.cellId))
  if (rs.some((x) => !allowed.has(x.cellId)) || cs.some((x) => !allowed.has(x.cellId))) {
    fail('Corpus includes a non-frozen annual cell.', 'INCOMPLETE_CORPUS')
  }
  for (const entry of plan.entries) {
    const req = rs.filter((x) => x.cellId === entry.cellId)
    const got = cs.filter((x) => x.cellId === entry.cellId)

    // Strict integer page identities
    for (const r of req) {
      if (!Number.isInteger(r.page) || r.page < 1) fail('Request page must be an integer >= 1.', 'INVALID_PAGE', { cellId: entry.cellId })
      validateAnnualRequest(frozen, r, r.page === 1 ? { phase: 'page1' } : { phase: 'page2', paginationPlan: plan })
    }
    for (const g of got) {
      if (!Number.isInteger(g.requestedPage) || !Number.isInteger(g.response?.page)) {
        fail('Corpus requestedPage and response.page must be integers.', 'INVALID_CORPUS_PAGE', { cellId: entry.cellId })
      }
      if (g.response.page !== g.requestedPage) {
        fail('Response page does not match its requested page.', 'INCOMPLETE_CORPUS', { cellId: entry.cellId })
      }
    }

    if (entry.total_pages === 0) {
      if (req.length !== 1 || req[0].page !== 1 || got.length !== 1 || got[0].requestedPage !== 1 || got[0].response?.page !== 1) {
        fail('Empty cell must retain exactly integer page 1 request/response.', 'INCOMPLETE_CORPUS')
      }
      const response = got[0].response
      if (
        !Number.isInteger(response?.total_pages) ||
        !Number.isInteger(response?.total_results) ||
        !Array.isArray(response?.results) ||
        response.total_pages !== 0 ||
        response.total_results !== 0 ||
        response.results.length !== 0
      ) {
        fail('Empty-cell corpus response violates the frozen page-1 gate.', 'INCOMPLETE_CORPUS')
      }
      continue
    }

    // Exact count and integer identity check against entry.requiredPages
    if (req.length !== entry.requiredPages.length || got.length !== entry.requiredPages.length) {
      fail('Corpus pages are incomplete, duplicate, or unexpected.', 'INCOMPLETE_CORPUS', { cellId: entry.cellId })
    }
    for (let i = 0; i < entry.requiredPages.length; i++) {
      const expectedPage = entry.requiredPages[i]
      if (req[i].page !== expectedPage || got[i].requestedPage !== expectedPage || got[i].response.page !== expectedPage) {
        fail('Corpus page mismatch against requiredPages.', 'INCOMPLETE_CORPUS', { cellId: entry.cellId, expectedPage })
      }
    }

    for (const page of got) {
      if (!Number.isInteger(page.response?.total_pages) || !Number.isInteger(page.response?.total_results) || !Array.isArray(page.response?.results)) {
        fail('Raw response has an invalid discovery shape.', 'INCOMPLETE_CORPUS', { cellId: entry.cellId })
      }
      if (page.response.total_pages !== entry.total_pages || page.response.total_results !== entry.total_results) {
        fail('Raw response drifts from the frozen page-1 baseline.', 'PAGINATION_DRIFT', { cellId: entry.cellId })
      }
    }
  }
  if (rs.length !== cs.length) fail('Request/corpus count mismatch.', 'INCOMPLETE_CORPUS')
  return { requestManifest: rs, rawResponseCorpus: cs }
}

export function createV3SourceSnapshot(frozen, plan, requests, corpus) {
  const { requestManifest, rawResponseCorpus } = verifyCorpusCompleteness(frozen, plan, requests, corpus)
  const payload = {
    protocolId: V3_PROTOCOL_ID,
    stage: 1,
    contractRef: V3_STAGE1_CONTRACT_REF,
    partitionManifestHash: V3_PARTITION_HASH,
    paginationPlanHash: plan.paginationPlanHash,
    requestManifest,
    rawResponseCorpus,
  }
  return freeze({ ...clone(payload), sourceSnapshotHash: canonicalSha256(payload) })
}

export function verifyV3SourceSnapshot(snapshot) {
  if (!snapshot?.sourceSnapshotHash) fail('Missing source snapshot hash.', 'SOURCE_SNAPSHOT_HASH_MISMATCH')
  const { sourceSnapshotHash, ...payload } = snapshot
  const keys = Object.keys(payload).sort()
  if (
    keys.join('|') !== ['contractRef', 'paginationPlanHash', 'partitionManifestHash', 'protocolId', 'rawResponseCorpus', 'requestManifest', 'stage'].join('|') ||
    payload.protocolId !== V3_PROTOCOL_ID ||
    payload.stage !== 1 ||
    payload.contractRef !== V3_STAGE1_CONTRACT_REF ||
    payload.partitionManifestHash !== V3_PARTITION_HASH ||
    canonicalSha256(payload) !== sourceSnapshotHash
  ) {
    fail('Source snapshot hash/binding mismatch.', 'SOURCE_SNAPSHOT_HASH_MISMATCH')
  }
  if (
    canonicalizeRequestManifest(payload.requestManifest).map(canonicalize).join('|') !== payload.requestManifest.map(canonicalize).join('|') ||
    canonicalizeRawResponseCorpus(payload.rawResponseCorpus).map(canonicalize).join('|') !== payload.rawResponseCorpus.map(canonicalize).join('|')
  ) {
    fail('Source snapshot arrays are not canonically ordered.', 'SOURCE_SNAPSHOT_HASH_MISMATCH')
  }
  return { ok: true }
}

export function buildV3ExclusionManifest({ sources, protocolId = V3_PROTOCOL_ID }) {
  if (protocolId !== V3_PROTOCOL_ID || !Array.isArray(sources)) fail('Invalid V3 exclusion input.', 'INVALID_EXCLUSION_INPUT')
  const byId = new Map()
  for (const source of sources) {
    for (const row of source.entries ?? []) {
      const tmdbId = Number(row.tmdbId ?? row.id)
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) fail('Invalid exclusion TMDB ID.', 'INVALID_EXCLUSION_ENTRY')
      const old = byId.get(tmdbId) ?? { tmdbId, canonicalId: null, title: null, provenance: new Set(), reasons: new Set() }
      for (const key of ['canonicalId', 'title']) {
        const incoming = row[key] ?? (key === 'canonicalId' ? row.candidateId : null) ?? null
        if (incoming !== null && typeof incoming !== 'string') fail(`Exclusion ${key} must be a string or null.`, 'INVALID_EXCLUSION_ENTRY')
        if (incoming !== null && old[key] !== null && old[key] !== incoming) fail('Conflicting exclusion metadata.', 'EXCLUSION_METADATA_CONFLICT', { tmdbId, key })
        if (incoming !== null) old[key] = incoming
      }
      const provRaw = row.provenance ?? source.provenance ?? source.sourceName ?? 'unknown'
      const provList = Array.isArray(provRaw) ? provRaw : [provRaw]
      for (const p of provList) {
        if (typeof p !== 'string') fail('Exclusion provenance must be a string.', 'INVALID_EXCLUSION_ENTRY')
        old.provenance.add(p)
      }
      const reasonRaw = row.reasons ?? row.reason ?? row.exposureType ?? source.sourceName ?? 'unknown'
      const reasonList = Array.isArray(reasonRaw) ? reasonRaw : [reasonRaw]
      for (const r of reasonList) {
        if (typeof r !== 'string') fail('Exclusion reason must be a string.', 'INVALID_EXCLUSION_ENTRY')
        old.reasons.add(r)
      }
      byId.set(tmdbId, old)
    }
  }
  const exclusions = [...byId.values()]
    .sort((a, b) => a.tmdbId - b.tmdbId)
    .map((x) => ({
      canonicalId: x.canonicalId,
      provenance: [...x.provenance].sort(),
      reasons: [...x.reasons].sort(),
      title: x.title,
      tmdbId: x.tmdbId,
    }))
  const payload = { exclusions, manifestVersion: 1, protocolId: V3_PROTOCOL_ID }
  const manifest = freeze({ ...clone(payload), exclusionManifestHash: canonicalSha256(payload) })
  verifyV3ExclusionManifest(manifest)
  return manifest
}

export function verifyV3ExclusionManifest(manifest) {
  if (!manifest?.exclusionManifestHash || manifest.protocolId !== V3_PROTOCOL_ID) fail('V3 exclusion manifest binding mismatch.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
  const { exclusionManifestHash, ...payload } = manifest
  if (Object.keys(payload).sort().join('|') !== 'exclusions|manifestVersion|protocolId' || payload.manifestVersion !== 1 || !Array.isArray(payload.exclusions)) {
    fail('V3 exclusion manifest shape mismatch.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
  }
  let lastId = 0
  for (const entry of payload.exclusions) {
    if (Object.keys(entry).sort().join('|') !== 'canonicalId|provenance|reasons|title|tmdbId' || !Number.isInteger(entry.tmdbId) || entry.tmdbId <= lastId) {
      fail('V3 exclusion manifest entry mismatch.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
    }
    if (entry.canonicalId !== null && typeof entry.canonicalId !== 'string') {
      fail('Exclusion canonicalId must be string or null.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
    }
    if (entry.title !== null && typeof entry.title !== 'string') {
      fail('Exclusion title must be string or null.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
    }
    if (!Array.isArray(entry.provenance) || !entry.provenance.every((x) => typeof x === 'string') || canonicalize(entry.provenance) !== canonicalize([...new Set(entry.provenance)].sort())) {
      fail('Exclusion provenance must be a sorted unique array of strings.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
    }
    if (!Array.isArray(entry.reasons) || !entry.reasons.every((x) => typeof x === 'string') || canonicalize(entry.reasons) !== canonicalize([...new Set(entry.reasons)].sort())) {
      fail('Exclusion reasons must be a sorted unique array of strings.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
    }
    lastId = entry.tmdbId
  }
  if (canonicalSha256(payload) !== exclusionManifestHash) fail('V3 exclusion manifest hash mismatch.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
  return { ok: true }
}

export function resolveV3PartitionDuplicates(snapshot, frozen) {
  verifyV3SourceSnapshot(snapshot)
  verifyFrozenPartition(frozen)
  const occurrences = []
  for (const page of snapshot.rawResponseCorpus) {
    const cell = cellFor(frozen, page.cellId)
    for (const record of page.response?.results ?? []) {
      if (!Number.isInteger(record?.id)) fail('Invalid source record.', 'INVALID_SOURCE_RECORD')
      if (isUsableDateFormat(record.release_date) && (record.release_date < cell.releaseDateGte || record.release_date > cell.releaseDateLte)) {
        return { status: V3_STATUSES.membership }
      }
      occurrences.push({ cellId: cell.cellId, record })
    }
  }
  const cellsById = new Map()
  for (const x of occurrences) {
    const set = cellsById.get(x.record.id) ?? new Set()
    set.add(x.cellId)
    cellsById.set(x.record.id, set)
  }
  if ([...cellsById.values()].some((s) => s.size > 1)) return { status: V3_STATUSES.crossCell }
  const unique = []
  for (const [tmdbId, cells] of cellsById) {
    const cellId = [...cells][0]
    const list = occurrences.filter((x) => x.cellId === cellId && x.record.id === tmdbId)
    const canonical = list.map((x) => canonicalize(x.record))
    if (!canonical.every((x) => x === canonical[0])) return { status: V3_STATUSES.duplicate }
    unique.push(list[0].record)
  }
  return { status: 'OK', records: unique.sort((a, b) => a.id - b.id) }
}

export function executeV3PostFreezeSelection({ frozen, paginationPlan, sourceSnapshot, exclusionManifest }) {
  verifyV3SourceSnapshot(sourceSnapshot)
  verifyFrozenPartition(frozen)
  verifyPaginationPlan(frozen, paginationPlan)
  if (sourceSnapshot.paginationPlanHash !== paginationPlan.paginationPlanHash) {
    fail('Snapshot pagination plan binding mismatch.', 'SOURCE_SNAPSHOT_HASH_MISMATCH')
  }
  verifyCorpusCompleteness(frozen, paginationPlan, sourceSnapshot.requestManifest, sourceSnapshot.rawResponseCorpus)
  verifyV3ExclusionManifest(exclusionManifest)
  const integrity = resolveV3PartitionDuplicates(sourceSnapshot, frozen)
  if (integrity.status !== 'OK') return integrity
  const excluded = new Set(exclusionManifest.exclusions.map((x) => x.tmdbId))
  const byStratum = new Map(STRATA.map((x) => [x.id, []]))
  for (const record of integrity.records) {
    if (!checkFactualEligibility(record).eligible || excluded.has(record.id)) continue
    const stratum = STRATA.find((x) => record.release_date >= `${x.id.slice(0, 4)}-01-01` && record.release_date <= `${x.id.slice(5)}-12-31`)
    if (stratum) byStratum.get(stratum.id).push(record)
  }
  const candidates = []
  for (const stratum of STRATA) {
    const ranked = byStratum
      .get(stratum.id)
      .map((record) => ({
        ...record,
        rank: computeCandidateRankHash({ protocolId: V3_PROTOCOL_ID, stratumId: stratum.id, tmdbId: record.id }).rankHash,
      }))
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    if (ranked.length < stratum.quota) return { status: V3_STATUSES.insufficient, stratumId: stratum.id }
    candidates.push(...ranked.slice(0, stratum.quota))
  }
  return freeze({ status: V3_STATUSES.complete, candidates, finalCandidateCount: candidates.length })
}
