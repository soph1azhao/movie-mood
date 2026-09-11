// C1b-V2 Stage 1: Deterministic recruitment implementation.
// This module provides deterministic request planning, source snapshot freezing,
// duplicate disposition, factual eligibility, exclusion manifest construction,
// and deterministic hash ranking.
// Network calls: 0. External transports: 0.

import { createHash } from 'node:crypto'
import { canonicalize, canonicalSha256, parseJsonRejectingDuplicateKeys } from './c1bV2Stage0.mjs'

export const STAGE1_ENDPOINT = '/discover/movie'
export const STAGE1_MAX_TOTAL_PAGES = 50
export const STAGE1_TOTAL_UNIVERSE = 180

export const STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED = 'BLOCKED — DISCOVERY CORPUS EXCEEDS PREDECLARED PAGE BUDGET'
export const STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT = 'BLOCKED — SOURCE SNAPSHOT DUPLICATE CONFLICT'
export const STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE = 'BLOCKED — INSUFFICIENT FRESH FACTUAL UNIVERSE'

export const STAGE1_STRATA = Object.freeze([
  Object.freeze({ id: '1980-1989', releaseDateGte: '1980-01-01', releaseDateLte: '1989-12-31', quota: 24 }),
  Object.freeze({ id: '1990-1999', releaseDateGte: '1990-01-01', releaseDateLte: '1999-12-31', quota: 24 }),
  Object.freeze({ id: '2000-2009', releaseDateGte: '2000-01-01', releaseDateLte: '2009-12-31', quota: 33 }),
  Object.freeze({ id: '2010-2019', releaseDateGte: '2010-01-01', releaseDateLte: '2019-12-31', quota: 45 }),
  Object.freeze({ id: '2020-2024', releaseDateGte: '2020-01-01', releaseDateLte: '2024-12-31', quota: 54 }),
])

export const STAGE1_PROTOCOL_ID = 'phase-5c-c1b-v-confirmatory.v2'
export const STAGE1_CONTRACT_REF = 'stage1-recruitment-contract.v2'
export const STAGE1_STAGE_NUMBER = 1

export class Stage1Error extends Error {
  constructor(message, code = 'STAGE1_ERROR', details = undefined) {
    super(message)
    this.name = 'Stage1Error'
    this.code = code
    this.details = details
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

// ---------------------------------------------------------------------------
// A/B. Request Planning and Serialization
// ---------------------------------------------------------------------------

export function validateContractCanonicalContent(canonicalContent) {
  if (!canonicalContent || typeof canonicalContent !== 'object') {
    throw new Stage1Error('Contract canonicalContent must be an object.', 'INVALID_CONTRACT_STRUCTURE')
  }
  if (Object.hasOwn(canonicalContent, 'requestParameters')) {
    throw new Stage1Error(
      'Contract canonicalContent must not contain requestParameters; parameters must be read from fixedRequestParameters and stratumBoundParameters.',
      'INVALID_CONTRACT_STRUCTURE'
    )
  }
  if (canonicalContent.endpoint !== STAGE1_ENDPOINT) {
    throw new Stage1Error(`Contract endpoint must be ${STAGE1_ENDPOINT}, got ${canonicalContent.endpoint}`, 'INVALID_CONTRACT_STRUCTURE')
  }
  if (!canonicalContent.omittedParameters || !canonicalContent.omittedParameters.includes('region')) {
    throw new Stage1Error('Contract omittedParameters must contain "region".', 'INVALID_CONTRACT_STRUCTURE')
  }
}

export function buildStratumPageRequest(contractOrContent, stratum, page) {
  const content = contractOrContent?.canonicalContent ?? contractOrContent
  validateContractCanonicalContent(content)

  if (!stratum || !stratum.id || !stratum.releaseDateGte || !stratum.releaseDateLte) {
    throw new Stage1Error('Invalid stratum definition.', 'INVALID_STRATUM')
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Stage1Error(`Page must be a positive integer, got ${page}`, 'INVALID_PAGE_NUMBER')
  }
  if (page > STAGE1_MAX_TOTAL_PAGES) {
    throw new Stage1Error(`Page ${page} exceeds maximum allowed page budget (${STAGE1_MAX_TOTAL_PAGES}); page 51 is never permitted.`, 'PAGE_BUDGET_EXCEEDED')
  }

  const fixed = content.fixedRequestParameters
  if (!fixed) throw new Stage1Error('Missing fixedRequestParameters in contract.', 'INVALID_CONTRACT_STRUCTURE')

  const params = {
    include_adult: fixed.include_adult,
    include_video: fixed.include_video,
    language: fixed.language,
    page,
    'primary_release_date.gte': stratum.releaseDateGte,
    'primary_release_date.lte': stratum.releaseDateLte,
    sort_by: fixed.sort_by,
    'vote_count.gte': fixed['vote_count.gte'],
    'vote_count.lte': fixed['vote_count.lte'],
  }

  // Explicit check against omitted parameters
  for (const omitted of content.omittedParameters ?? []) {
    if (Object.hasOwn(params, omitted)) {
      throw new Stage1Error(`Omitted parameter "${omitted}" found in request parameters.`, 'FORBIDDEN_PARAMETER')
    }
  }

  return {
    endpoint: content.endpoint,
    stratumId: stratum.id,
    page,
    params,
  }
}

export const STAGE1_REQUIRED_REQUEST_PARAMETERS = Object.freeze([
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

export function serializeRequestQuery(request) {
  if (!request || !request.params) throw new Stage1Error('Invalid request object for serialization.', 'INVALID_REQUEST')
  validateSerializedRequest(request)

  const keys = Object.keys(request.params).sort()
  const query = keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(request.params[key]))}`).join('&')
  validateSerializedRequest(query)
  return query
}

export function serializeRequestUrl(request) {
  const query = serializeRequestQuery(request)
  const url = `${request.endpoint}?${query}`
  validateSerializedRequest(url)
  return url
}

export function validateSerializedRequest(target) {
  if (typeof target === 'string') {
    // Check for region in query string or URL or JSON string first
    if (/(?:^|[?&])region(?:=([^&#]*)|(?=[&#]|$))/i.test(target)) {
      throw new Stage1Error('Forbidden parameter "region" detected in serialized request string.', 'FORBIDDEN_PARAMETER')
    }
    if (/"region"\s*:\s*/i.test(target)) {
      throw new Stage1Error('Forbidden member "region" detected in serialized JSON request.', 'FORBIDDEN_PARAMETER')
    }

    const trimmed = target.trim()
    if (trimmed.startsWith('{')) {
      const parsed = parseJsonRejectingDuplicateKeys(trimmed)
      validateSerializedRequest(parsed)
      return
    }

    let queryPart = target
    if (target.startsWith('/') || target.includes('?')) {
      const [endpoint, q] = target.split('?')
      if (endpoint !== STAGE1_ENDPOINT) {
        throw new Stage1Error(`Invalid endpoint: ${endpoint}, expected ${STAGE1_ENDPOINT}`, 'INVALID_ENDPOINT')
      }
      queryPart = q ?? ''
    }

    const searchParams = new URLSearchParams(queryPart)
    const paramObj = {}
    for (const [key, value] of searchParams.entries()) {
      if (Object.hasOwn(paramObj, key)) {
        throw new Stage1Error(`Duplicate query parameter: ${key}`, 'DUPLICATE_QUERY_PARAMETER')
      }
      paramObj[key] = value
    }
    validateSerializedRequest(paramObj)
    return
  }

  if (!target || typeof target !== 'object') {
    throw new Stage1Error('Target for request validation must be an object or string.', 'INVALID_REQUEST')
  }

  const params = target.params ?? target

  // Check region first
  if (Object.hasOwn(params, 'region') || 'region' in params) {
    throw new Stage1Error(`Forbidden parameter "region" detected in request parameters with value: ${params.region}`, 'FORBIDDEN_PARAMETER')
  }

  if (target.endpoint && target.endpoint !== STAGE1_ENDPOINT) {
    throw new Stage1Error(`Invalid endpoint: ${target.endpoint}, expected ${STAGE1_ENDPOINT}`, 'INVALID_ENDPOINT')
  }

  // Exact keys check:
  // 1. Any missing required parameter
  for (const requiredKey of STAGE1_REQUIRED_REQUEST_PARAMETERS) {
    if (!Object.hasOwn(params, requiredKey) || params[requiredKey] === undefined) {
      throw new Stage1Error(`Missing required request parameter: ${requiredKey}`, 'MISSING_REQUIRED_PARAMETER', { parameter: requiredKey })
    }
  }

  // 2. Any unexpected / extra parameter
  for (const actualKey of Object.keys(params)) {
    if (!STAGE1_REQUIRED_REQUEST_PARAMETERS.includes(actualKey)) {
      throw new Stage1Error(`Unexpected parameter in request: ${actualKey}`, 'UNKNOWN_PARAMETER', { parameter: actualKey })
    }
  }

  // 3. Frozen value validation
  if (params.include_adult !== false && params.include_adult !== 'false') {
    throw new Stage1Error(`Invalid include_adult: ${params.include_adult}, expected false`, 'INVALID_REQUEST_PARAMETERS')
  }

  if (params.include_video !== false && params.include_video !== 'false') {
    throw new Stage1Error(`Invalid include_video: ${params.include_video}, expected false`, 'INVALID_REQUEST_PARAMETERS')
  }

  if (params.language !== 'en-US') {
    throw new Stage1Error(`Invalid language: ${params.language}, expected en-US`, 'INVALID_REQUEST_PARAMETERS')
  }

  if (params.sort_by !== 'primary_release_date.asc') {
    throw new Stage1Error(`Invalid sort_by: ${params.sort_by}, expected primary_release_date.asc`, 'INVALID_REQUEST_PARAMETERS')
  }

  if (params['vote_count.gte'] !== 200 && params['vote_count.gte'] !== '200') {
    throw new Stage1Error(`Invalid vote_count.gte: ${params['vote_count.gte']}, expected 200`, 'INVALID_REQUEST_PARAMETERS')
  }

  if (params['vote_count.lte'] !== 2000 && params['vote_count.lte'] !== '2000') {
    throw new Stage1Error(`Invalid vote_count.lte: ${params['vote_count.lte']}, expected 2000`, 'INVALID_REQUEST_PARAMETERS')
  }

  const pageStr = String(params.page)
  const pageNum = Number(params.page)
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > STAGE1_MAX_TOTAL_PAGES || pageStr.includes('.')) {
    throw new Stage1Error(`Invalid page: ${params.page}, must be an integer between 1 and ${STAGE1_MAX_TOTAL_PAGES}`, 'INVALID_PAGE_NUMBER')
  }

  const dateGte = String(params['primary_release_date.gte'])
  const dateLte = String(params['primary_release_date.lte'])
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateGte) || !/^\d{4}-\d{2}-\d{2}$/u.test(dateLte)) {
    throw new Stage1Error('Invalid date format for primary_release_date bounds; expected YYYY-MM-DD.', 'INVALID_REQUEST_PARAMETERS')
  }

  // Pin release-date request bounds to the five frozen strata
  if (target.stratumId) {
    const stratum = STAGE1_STRATA.find((s) => s.id === target.stratumId)
    if (!stratum || dateGte !== stratum.releaseDateGte || dateLte !== stratum.releaseDateLte) {
      throw new Stage1Error(
        `Date bounds ${dateGte} / ${dateLte} do not match frozen bounds for stratum ${target.stratumId}.`,
        'INVALID_STRATUM_DATE_BOUNDS',
        { stratumId: target.stratumId, dateGte, dateLte }
      )
    }
  } else {
    const matched = STAGE1_STRATA.some((s) => s.releaseDateGte === dateGte && s.releaseDateLte === dateLte)
    if (!matched) {
      throw new Stage1Error(
        `Date bounds ${dateGte} / ${dateLte} do not match any of the five frozen strata date bounds.`,
        'INVALID_STRATUM_DATE_BOUNDS',
        { dateGte, dateLte }
      )
    }
  }
}

// ---------------------------------------------------------------------------
// C. Pagination Planning and Validation
// ---------------------------------------------------------------------------

export function planStratumPagination(page1Response) {
  if (!page1Response || typeof page1Response !== 'object') {
    throw new Stage1Error('Invalid page 1 response payload.', 'INVALID_PAGE_RESPONSE')
  }
  if (page1Response.page !== 1) {
    throw new Stage1Error(`Initial discovery response must be page 1, got page ${page1Response.page}`, 'INVALID_PAGE_RESPONSE')
  }
  const totalPages = page1Response.total_pages
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Stage1Error(`Invalid total_pages in page 1 response: ${totalPages}`, 'INVALID_PAGE_RESPONSE')
  }
  if (totalPages > STAGE1_MAX_TOTAL_PAGES) {
    throw new Stage1Error(STAGE1_DISCOVERY_PAGE_BUDGET_EXCEEDED, 'DISCOVERY_PAGE_BUDGET_EXCEEDED', { totalPages, maximumAllowed: STAGE1_MAX_TOTAL_PAGES })
  }

  return {
    ok: true,
    totalPages,
    requiredPages: Array.from({ length: totalPages }, (_, index) => index + 1),
    earlyStopAllowed: false,
  }
}

export function validateCorpusCompleteness(stratumId, plannedTotalPages, receivedPages) {
  if (!Number.isInteger(plannedTotalPages) || plannedTotalPages < 1 || plannedTotalPages > STAGE1_MAX_TOTAL_PAGES) {
    throw new Stage1Error(
      `plannedTotalPages must be an integer in 1..${STAGE1_MAX_TOTAL_PAGES}, got ${plannedTotalPages}`,
      'INVALID_PAGE_BUDGET',
      { stratumId, plannedTotalPages }
    )
  }

  if (!Array.isArray(receivedPages)) {
    throw new Stage1Error('receivedPages must be an array.', 'INVALID_CORPUS')
  }

  const seen = new Set()
  for (const item of receivedPages) {
    let pageNum
    if (typeof item === 'number') {
      pageNum = item
    } else if (item && typeof item === 'object' && Object.hasOwn(item, 'page')) {
      pageNum = item.page
    } else {
      throw new Stage1Error(`Invalid page item in corpus: ${JSON.stringify(item)}`, 'INVALID_PAGE_NUMBER')
    }

    if (!Number.isInteger(pageNum)) {
      throw new Stage1Error(`Page number must be an integer, got ${pageNum}`, 'INVALID_PAGE_NUMBER', { stratumId, pageNum })
    }

    if (pageNum < 1) {
      throw new Stage1Error(`Page number must be positive (>= 1), got ${pageNum}`, 'INVALID_PAGE_NUMBER', { stratumId, pageNum })
    }

    if (pageNum > STAGE1_MAX_TOTAL_PAGES) {
      throw new Stage1Error(`Page ${pageNum} exceeds maximum page budget of ${STAGE1_MAX_TOTAL_PAGES}; page 51 is prohibited.`, 'PAGE_BUDGET_EXCEEDED', { stratumId, pageNum })
    }

    if (pageNum > plannedTotalPages) {
      throw new Stage1Error(`Page ${pageNum} exceeds planned total pages of ${plannedTotalPages}.`, 'UNEXPECTED_PAGE_IN_CORPUS', { stratumId, pageNum, plannedTotalPages })
    }

    if (seen.has(pageNum)) {
      throw new Stage1Error(`Duplicate page detected in corpus: page ${pageNum}`, 'DUPLICATE_PAGE_IN_CORPUS', { stratumId, pageNum })
    }

    seen.add(pageNum)
  }

  if (receivedPages.length !== plannedTotalPages) {
    const missing = []
    for (let p = 1; p <= plannedTotalPages; p++) {
      if (!seen.has(p)) missing.push(p)
    }
    throw new Stage1Error(
      `Incomplete discovery corpus for stratum ${stratumId}; missing pages: ${missing.join(', ')}`,
      'INCOMPLETE_DISCOVERY_CORPUS',
      { stratumId, missing, plannedTotalPages, receivedCount: receivedPages.length }
    )
  }

  for (let p = 1; p <= plannedTotalPages; p++) {
    if (!seen.has(p)) {
      throw new Stage1Error(
        `Incomplete discovery corpus for stratum ${stratumId}; missing page ${p}`,
        'INCOMPLETE_DISCOVERY_CORPUS',
        { stratumId, missingPage: p }
      )
    }
  }
}

// ---------------------------------------------------------------------------
// D. Source Snapshot Construction & Freezing
// ---------------------------------------------------------------------------

export function createSourceSnapshot({
  protocolId,
  stage = 1,
  contractRef = 'stage1-recruitment-contract.v2',
  requests,
  responses,
}) {
  if (!protocolId) throw new Stage1Error('protocolId is required for source snapshot.', 'INVALID_SNAPSHOT_INPUT')
  if (!Array.isArray(requests)) throw new Stage1Error('requests must be an array.', 'INVALID_SNAPSHOT_INPUT')
  if (!Array.isArray(responses)) throw new Stage1Error('responses must be an array.', 'INVALID_SNAPSHOT_INPUT')

  // Ordering normalization ensures delivery-order independence for snapshot representation:
  // Sort requests deterministically by stratumId then page ascending
  const sortedRequests = [...requests].sort((a, b) => {
    if (a.stratumId !== b.stratumId) return String(a.stratumId).localeCompare(String(b.stratumId))
    return (a.page ?? 0) - (b.page ?? 0)
  })

  // Sort responses deterministically by stratumId then page ascending
  const sortedResponses = [...responses].sort((a, b) => {
    if (a.stratumId !== b.stratumId) return String(a.stratumId).localeCompare(String(b.stratumId))
    return (a.page ?? 0) - (b.page ?? 0)
  })

  // The raw response corpus preserves the complete response payloads untouched.
  const snapshotData = {
    contractRef,
    protocolId,
    rawResponseCorpus: sortedResponses,
    requestManifest: sortedRequests,
    stage,
  }

  const sourceSnapshotHash = canonicalSha256(snapshotData)

  // Freeze deep copy so snapshot and underlying corpus cannot be mutated downstream
  const deepFrozenSnapshot = deepFreeze(JSON.parse(canonicalize(snapshotData)))
  return Object.freeze({
    ...deepFrozenSnapshot,
    sourceSnapshotHash,
  })
}

// ---------------------------------------------------------------------------
// E. Duplicate TMDB-ID Disposition
// ---------------------------------------------------------------------------

export function resolveDuplicateDisposition(sourceSnapshot) {
  if (!sourceSnapshot || !Array.isArray(sourceSnapshot.rawResponseCorpus)) {
    throw new Stage1Error('Invalid source snapshot.', 'INVALID_SOURCE_SNAPSHOT')
  }

  const recordsById = new Map()
  for (const pageEntry of sourceSnapshot.rawResponseCorpus) {
    const results = pageEntry.response?.results ?? []
    for (const record of results) {
      if (!record || typeof record !== 'object' || record.id === undefined || record.id === null) {
        throw new Stage1Error('Invalid result record in source corpus.', 'INVALID_SOURCE_RECORD')
      }
      const list = recordsById.get(record.id) ?? []
      list.push(record)
      recordsById.set(record.id, list)
    }
  }

  const collapsedRecords = []
  for (const [tmdbId, records] of recordsById.entries()) {
    if (records.length === 1) {
      collapsedRecords.push(records[0])
      continue
    }

    // RFC-8785 canonicalize each complete result object exactly as present in the frozen source corpus
    const canonicalStrings = records.map((r) => canonicalize(r))
    const firstCanonical = canonicalStrings[0]
    const isIdentical = canonicalStrings.every((c) => c === firstCanonical)

    if (!isIdentical) {
      throw new Stage1Error(
        STAGE1_SOURCE_SNAPSHOT_DUPLICATE_CONFLICT,
        'SOURCE_SNAPSHOT_DUPLICATE_CONFLICT',
        { tmdbId, duplicateCount: records.length }
      )
    }

    // All identical duplicate records collapse to exactly one logical record.
    collapsedRecords.push(records[0])
  }

  // Deterministic order of collapsed records by TMDB ID
  collapsedRecords.sort((a, b) => a.id - b.id)
  return collapsedRecords
}

// ---------------------------------------------------------------------------
// F. Factual Eligibility
// ---------------------------------------------------------------------------

export function checkFactualEligibility(record) {
  if (!record || typeof record !== 'object') {
    return { eligible: false, reasons: ['INVALID_RECORD'] }
  }
  const failures = []

  const voteCount = record.vote_count
  if (typeof voteCount !== 'number' || !Number.isFinite(voteCount)) {
    failures.push('MISSING_OR_NON_NUMERIC_VOTE_COUNT')
  } else if (voteCount < 200 || voteCount > 2000) {
    failures.push(`VOTE_COUNT_OUT_OF_BOUNDS: ${voteCount}`)
  }

  const releaseDate = record.release_date
  if (typeof releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)) {
    failures.push('MISSING_OR_INVALID_RELEASE_DATE_FORMAT')
  } else if (releaseDate > '2024-12-31') {
    failures.push(`RELEASE_DATE_EXCEEDS_MAX: ${releaseDate}`)
  } else if (releaseDate < '1980-01-01') {
    failures.push(`RELEASE_DATE_BEFORE_MIN: ${releaseDate}`)
  }

  // Language, country, genre are disclosure-only; no quotas or filters applied here
  return {
    eligible: failures.length === 0,
    reasons: failures,
  }
}

export function matchStratum(releaseDate, strata = STAGE1_STRATA) {
  if (typeof releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)) return null
  for (const stratum of strata) {
    if (releaseDate >= stratum.releaseDateGte && releaseDate <= stratum.releaseDateLte) {
      return stratum
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// G. Frozen Exclusion Manifest
// ---------------------------------------------------------------------------

export function buildExclusionManifest({ protocolId, sources }) {
  if (!protocolId) throw new Stage1Error('protocolId is required for exclusion manifest.', 'INVALID_EXCLUSION_INPUT')
  if (!Array.isArray(sources)) throw new Stage1Error('sources must be an array.', 'INVALID_EXCLUSION_INPUT')

  const byId = new Map()

  for (const source of sources) {
    const sourceName = source.sourceName || source.name || 'unknown-source'
    const sourceProvenance = source.provenance || source.sourceFile || sourceName
    const entries = Array.isArray(source) ? source : (source.entries || source.candidates || [])

    for (const entry of entries) {
      const tmdbId = Number(entry.tmdbId ?? entry.id)
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        throw new Stage1Error(`Invalid TMDB ID in exclusion entry: ${JSON.stringify(entry)}`, 'INVALID_EXCLUSION_ENTRY')
      }

      const incomingCanonicalId = entry.canonicalId ?? entry.candidateId ?? null
      const incomingTitle = entry.title ?? null

      let existing = byId.get(tmdbId)
      if (!existing) {
        existing = {
          tmdbId,
          canonicalId: incomingCanonicalId,
          title: incomingTitle,
          reasons: new Set(),
          provenance: new Set(),
        }
        byId.set(tmdbId, existing)
      } else {
        // Enforce canonicalId consistency: identical non-null allowed, null + non-null allowed, conflicting non-null throws
        if (incomingCanonicalId !== null) {
          if (existing.canonicalId === null) {
            existing.canonicalId = incomingCanonicalId
          } else if (existing.canonicalId !== incomingCanonicalId) {
            throw new Stage1Error(
              `Conflicting canonicalId for TMDB ID ${tmdbId}: "${existing.canonicalId}" vs "${incomingCanonicalId}".`,
              'EXCLUSION_METADATA_CONFLICT',
              { tmdbId, existingCanonicalId: existing.canonicalId, incomingCanonicalId }
            )
          }
        }

        // Enforce title consistency: identical non-null allowed, null + non-null allowed, conflicting non-null throws
        if (incomingTitle !== null) {
          if (existing.title === null) {
            existing.title = incomingTitle
          } else if (existing.title !== incomingTitle) {
            throw new Stage1Error(
              `Conflicting title for TMDB ID ${tmdbId}: "${existing.title}" vs "${incomingTitle}".`,
              'EXCLUSION_METADATA_CONFLICT',
              { tmdbId, existingTitle: existing.title, incomingTitle }
            )
          }
        }
      }

      const reason = entry.reason || entry.exposureType || sourceName
      const provenance = entry.provenance || sourceProvenance
      if (reason) existing.reasons.add(String(reason))
      if (provenance) existing.provenance.add(String(provenance))
    }
  }

  // Sort unique IDs ascending for deterministic output
  const sortedIds = Array.from(byId.keys()).sort((a, b) => a - b)
  const exclusions = sortedIds.map((tmdbId) => {
    const item = byId.get(tmdbId)
    return {
      canonicalId: item.canonicalId,
      provenance: Array.from(item.provenance).sort(),
      reasons: Array.from(item.reasons).sort(),
      title: item.title,
      tmdbId,
    }
  })

  const manifestData = {
    exclusions,
    manifestVersion: 1,
    protocolId,
  }

  const exclusionManifestHash = canonicalSha256(manifestData)
  const deepFrozenManifest = deepFreeze(JSON.parse(canonicalize(manifestData)))
  return Object.freeze({
    ...deepFrozenManifest,
    exclusionManifestHash,
  })
}

export function verifySourceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Stage1Error('Source snapshot must be an object.', 'INVALID_SOURCE_SNAPSHOT')
  }
  if (!snapshot.sourceSnapshotHash || typeof snapshot.sourceSnapshotHash !== 'string') {
    throw new Stage1Error('Source snapshot is missing sourceSnapshotHash.', 'SOURCE_SNAPSHOT_HASH_MISMATCH')
  }
  const { sourceSnapshotHash, ...payload } = snapshot
  const computedHash = canonicalSha256(payload)
  if (computedHash !== sourceSnapshotHash) {
    throw new Stage1Error(
      `Source snapshot hash mismatch: expected ${sourceSnapshotHash}, computed ${computedHash}`,
      'SOURCE_SNAPSHOT_HASH_MISMATCH',
      { actualHash: sourceSnapshotHash, computedHash }
    )
  }
  return { ok: true, sourceSnapshotHash }
}

export function verifyExclusionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Stage1Error('Exclusion manifest must be an object.', 'INVALID_EXCLUSION_INPUT')
  }
  if (!manifest.exclusionManifestHash || typeof manifest.exclusionManifestHash !== 'string') {
    throw new Stage1Error('Exclusion manifest is missing exclusionManifestHash.', 'EXCLUSION_MANIFEST_HASH_MISMATCH')
  }
  const { exclusionManifestHash, ...payload } = manifest
  const computedHash = canonicalSha256(payload)
  if (computedHash !== exclusionManifestHash) {
    throw new Stage1Error(
      `Exclusion manifest hash mismatch: expected ${exclusionManifestHash}, computed ${computedHash}`,
      'EXCLUSION_MANIFEST_HASH_MISMATCH',
      { actualHash: exclusionManifestHash, computedHash }
    )
  }
  return { ok: true, exclusionManifestHash }
}

export function isCandidateExcluded(tmdbId, exclusionManifest) {
  if (!exclusionManifest || !Array.isArray(exclusionManifest.exclusions)) return false
  const numericId = Number(tmdbId)
  return exclusionManifest.exclusions.some((entry) => entry.tmdbId === numericId)
}

// ---------------------------------------------------------------------------
// H. Deterministic Ranking
// ---------------------------------------------------------------------------

export function computeCandidateRankHash({ protocolId, stratumId, tmdbId }) {
  if (!protocolId || !stratumId || tmdbId === undefined || tmdbId === null) {
    throw new Stage1Error('Missing parameters for rank hash computation.', 'INVALID_RANK_INPUT')
  }
  const preimage = `${protocolId}|stage1-select|${stratumId}|${tmdbId}`
  const rankHash = createHash('sha256').update(preimage, 'utf8').digest('hex')
  return { preimage, rankHash }
}

// ---------------------------------------------------------------------------
// I. Output Determinism & Post-Freeze Operation Sequence
// ---------------------------------------------------------------------------

export function executePostFreezeSelection({
  protocolId,
  sourceSnapshot,
  exclusionManifest,
  strata = undefined,
  onStep = () => {},
}) {
  onStep('post-freeze-selection-start')

  // Enforce frozen strata: custom override is strictly forbidden
  if (strata !== undefined) {
    if (canonicalize(strata) !== canonicalize(STAGE1_STRATA)) {
      throw new Stage1Error(
        'Custom strata override is forbidden; must match frozen STAGE1_STRATA.',
        'FROZEN_STRATA_MISMATCH'
      )
    }
  }

  // Cross-bind all post-freeze artifacts to registered protocol and contract
  if (!protocolId || protocolId !== STAGE1_PROTOCOL_ID) {
    throw new Stage1Error(
      `Caller protocolId must equal registered protocol "${STAGE1_PROTOCOL_ID}", got "${protocolId}".`,
      'PROTOCOL_BINDING_MISMATCH',
      { expected: STAGE1_PROTOCOL_ID, received: protocolId }
    )
  }

  if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
    throw new Stage1Error('Invalid source snapshot.', 'INVALID_SOURCE_SNAPSHOT')
  }

  if (sourceSnapshot.protocolId !== STAGE1_PROTOCOL_ID || sourceSnapshot.protocolId !== protocolId) {
    throw new Stage1Error(
      `Source snapshot protocolId "${sourceSnapshot.protocolId}" does not match registered protocol "${STAGE1_PROTOCOL_ID}".`,
      'PROTOCOL_BINDING_MISMATCH',
      { expected: STAGE1_PROTOCOL_ID, received: sourceSnapshot.protocolId }
    )
  }

  if (!exclusionManifest || typeof exclusionManifest !== 'object') {
    throw new Stage1Error('Invalid exclusion manifest.', 'INVALID_EXCLUSION_MANIFEST')
  }

  if (exclusionManifest.protocolId !== STAGE1_PROTOCOL_ID || exclusionManifest.protocolId !== protocolId) {
    throw new Stage1Error(
      `Exclusion manifest protocolId "${exclusionManifest.protocolId}" does not match registered protocol "${STAGE1_PROTOCOL_ID}".`,
      'PROTOCOL_BINDING_MISMATCH',
      { expected: STAGE1_PROTOCOL_ID, received: exclusionManifest.protocolId }
    )
  }

  if (sourceSnapshot.stage !== STAGE1_STAGE_NUMBER) {
    throw new Stage1Error(
      `Source snapshot stage must be ${STAGE1_STAGE_NUMBER}, got ${sourceSnapshot.stage}.`,
      'SOURCE_SNAPSHOT_STAGE_MISMATCH',
      { expected: STAGE1_STAGE_NUMBER, received: sourceSnapshot.stage }
    )
  }

  if (sourceSnapshot.contractRef !== STAGE1_CONTRACT_REF) {
    throw new Stage1Error(
      `Source snapshot contractRef must be "${STAGE1_CONTRACT_REF}", got "${sourceSnapshot.contractRef}".`,
      'SOURCE_SNAPSHOT_CONTRACT_MISMATCH',
      { expected: STAGE1_CONTRACT_REF, received: sourceSnapshot.contractRef }
    )
  }

  // Hash-bind integrity verification before post-freeze processing
  onStep('integrity-verification-start')
  verifySourceSnapshot(sourceSnapshot)
  verifyExclusionManifest(exclusionManifest)
  onStep('integrity-verification-complete')

  // Required Step 1: Duplicate disposition
  onStep('duplicate-disposition-start')
  const uniqueRecords = resolveDuplicateDisposition(sourceSnapshot)
  onStep('duplicate-disposition-complete')

  // Required Step 2: Factual eligibility
  onStep('factual-eligibility-start')
  const factuallyEligibleRecords = uniqueRecords.filter((record) => {
    const { eligible } = checkFactualEligibility(record)
    return eligible
  })
  onStep('factual-eligibility-complete')

  // Required Step 3: Frozen V2 exclusion manifest
  onStep('exclusion-filtering-start')
  const excludedTmdbIds = new Set(exclusionManifest.exclusions.map((e) => e.tmdbId))
  const nonExcludedRecords = factuallyEligibleRecords.filter((record) => !excludedTmdbIds.has(record.id))
  onStep('exclusion-filtering-complete')

  // Required Step 4: Stratum membership verification (internally uses only STAGE1_STRATA)
  onStep('stratum-verification-start')
  const recordsByStratum = new Map(STAGE1_STRATA.map((s) => [s.id, []]))
  for (const record of nonExcludedRecords) {
    const stratum = matchStratum(record.release_date, STAGE1_STRATA)
    if (stratum && recordsByStratum.has(stratum.id)) {
      recordsByStratum.get(stratum.id).push(record)
    }
  }
  onStep('stratum-verification-complete')

  // Required Step 5: Deterministic hash ranking & Step 6: Exact quota selection (internally uses only STAGE1_STRATA)
  onStep('ranking-and-selection-start')
  const allSelectedCandidates = []
  const strataSummary = []

  for (const stratum of STAGE1_STRATA) {
    const stratumRecords = recordsByStratum.get(stratum.id) || []
    const ranked = stratumRecords.map((record) => {
      const { preimage, rankHash } = computeCandidateRankHash({
        protocolId,
        stratumId: stratum.id,
        tmdbId: record.id,
      })
      return {
        preimage,
        rankHash,
        record,
      }
    })

    // Sort lexicographically ascending by rankHash
    ranked.sort((a, b) => (a.rankHash < b.rankHash ? -1 : a.rankHash > b.rankHash ? 1 : 0))

    if (ranked.length < stratum.quota) {
      throw new Stage1Error(
        STAGE1_INSUFFICIENT_FRESH_FACTUAL_UNIVERSE,
        'INSUFFICIENT_FRESH_FACTUAL_UNIVERSE',
        { stratumId: stratum.id, available: ranked.length, quota: stratum.quota }
      )
    }

    const selectedForStratum = ranked.slice(0, stratum.quota)
    for (let index = 0; index < selectedForStratum.length; index++) {
      const item = selectedForStratum[index]
      allSelectedCandidates.push({
        rankHash: item.rankHash,
        rankOrdinal: index + 1,
        rankPreimage: item.preimage,
        releaseDate: item.record.release_date,
        stratumId: stratum.id,
        title: item.record.title,
        tmdbId: item.record.id,
        tmdbRecord: item.record,
        voteAverage: item.record.vote_average,
        voteCount: item.record.vote_count,
      })
    }

    strataSummary.push({
      availableEligibleNonExcluded: ranked.length,
      quota: stratum.quota,
      selectedCount: selectedForStratum.length,
      stratumId: stratum.id,
    })
  }

  onStep('ranking-and-selection-complete')
  onStep('post-freeze-selection-complete')

  return {
    candidates: allSelectedCandidates,
    exclusionManifestHash: exclusionManifest.exclusionManifestHash,
    protocolId,
    sourceSnapshotHash: sourceSnapshot.sourceSnapshotHash,
    stage: 1,
    strataSummary,
    totalUniverseSize: allSelectedCandidates.length,
  }
}
