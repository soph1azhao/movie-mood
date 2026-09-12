import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { stableHash } from './tmdbProvider.ts'
import { buildNullDescriptiveEvidence, extractReceptionDescriptiveText, WIKIPEDIA_NORMALIZATION_FILTER_POLICY } from './wikipediaDescriptiveEvidence.mjs'
import { resolveWikipediaFilmIdentity } from '../scripts/wikipediaIdentityContentRiskAudit.mjs'

export const WIKIPEDIA_RECEPTION_EXTRACTION_POLICY_V2 = 'wikipedia-reception-extraction.v2'
export const WIKIPEDIA_FILM_IDENTITY_POLICY = 'wikipedia-film-identity-resolution.v1'
export const WIKIPEDIA_RECEPTION_SECTION_POLICY_V2 = 'wikipedia-reception-sections.v2'
export const WIKIPEDIA_V2_CACHE_ROOT = resolve('catalogue-pipeline/cache/descriptive/wikipedia-v2')
const API = 'https://en.wikipedia.org/w/api.php'
const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

export class WikipediaDescriptiveEvidenceV2Error extends Error {
  constructor(message, { code = 'WIKIPEDIA_DESCRIPTIVE_EVIDENCE_V2_ERROR' } = {}) { super(message); this.name = 'WikipediaDescriptiveEvidenceV2Error'; this.code = code }
}

export function selectV2ReceptionSection(sections) {
  const normalized = (sections ?? []).map((section) => ({ index: String(section.index), heading: normalize(section.heading ?? section.line), ancestors: section.ancestors ?? [] }))
  for (const pattern of [/^Critical response$/i, /^Critical reception$/i, /^Reception$/i, /^Release and reception$/i]) {
    const selected = normalized.find((section) => pattern.test(section.heading))
    if (selected) return selected
  }
  return null
}

export function createWikipediaV2CacheKey({ canonicalWikipediaTitle, pageId, revisionId, section, identityPolicy = WIKIPEDIA_FILM_IDENTITY_POLICY }) {
  return stableHash({ source: 'english-wikipedia', canonicalWikipediaTitle, pageId: String(pageId), revisionId: String(revisionId), identityPolicy, sectionSelectionPolicy: WIKIPEDIA_RECEPTION_SECTION_POLICY_V2, extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY_V2, normalizationFilterPolicy: WIKIPEDIA_NORMALIZATION_FILTER_POLICY, sectionIndex: String(section.index), sectionHeading: section.heading })
}

async function writeJsonIfChanged(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`; let prior = null
  try { prior = await readFile(path, 'utf8') } catch { /* absent */ }
  if (prior === serialized) return false
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`
  try { await writeFile(temporary, serialized); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
  return true
}

function createV2Evidence({ identity, section, extracted, retrievedAt }) {
  if (!extracted.text) return { ...buildNullDescriptiveEvidence(extracted.failureReason), identity: { policy: WIKIPEDIA_FILM_IDENTITY_POLICY, canonicalWikipediaTitle: identity.canonicalWikipediaTitle, pageId: identity.pageId, revisionId: identity.revisionId } }
  return {
    descriptiveEvidence: {
      sourceRef: 'wikipedia-reception', text: extracted.text, contentSha256: extracted.contentSha256,
      provenance: { source: 'english-wikipedia', canonicalWikipediaTitle: identity.canonicalWikipediaTitle, pageId: identity.pageId, revisionId: identity.revisionId, sourceUrl: `https://en.wikipedia.org/?curid=${identity.pageId}`, sectionHeading: section.heading, sectionIndex: section.index, retrievedAt, license: 'CC BY-SA 4.0', identityPolicy: WIKIPEDIA_FILM_IDENTITY_POLICY, sectionSelectionPolicy: WIKIPEDIA_RECEPTION_SECTION_POLICY_V2, extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY_V2, normalizationFilterPolicy: WIKIPEDIA_NORMALIZATION_FILTER_POLICY, contentSha256: extracted.contentSha256, characterCount: extracted.characterCount },
    }, stage2Bypassed: false, reviewFlags: [], failureReason: null,
  }
}

export function projectV2DescriptiveEvidenceProvenance(result) {
  if (!result.descriptiveEvidence) return result
  return { descriptiveEvidence: { sourceRef: result.descriptiveEvidence.sourceRef, contentSha256: result.descriptiveEvidence.contentSha256, provenance: result.descriptiveEvidence.provenance }, stage2Bypassed: false, reviewFlags: [], failureReason: null }
}

export async function fetchWikipediaReceptionEvidenceV2({ facts, fetchImpl = globalThis.fetch, resolveIdentity = resolveWikipediaFilmIdentity, retrievedAt = new Date().toISOString(), cacheRoot = WIKIPEDIA_V2_CACHE_ROOT, writeJsonFile = writeJsonIfChanged, onDescriptiveResponseReceived, onDiagnosticEvent }) {
  let identity
  try { identity = await resolveIdentity({ fact: facts, fetchImpl, onDiagnosticEvent }) }
  catch (error) { const resolverFailureCode = typeof error?.code === 'string' ? error.code : 'UNKNOWN_RESOLVER_FAILURE'; onDiagnosticEvent?.({ stage: 'identity', event: 'resolver-failure', code: resolverFailureCode }); return { ...buildNullDescriptiveEvidence('IDENTITY_RESOLUTION_FAILED'), retryable: true, resolverFailureCode } }
  if (!identity?.resolved) { onDiagnosticEvent?.({ stage: 'identity', event: 'identity-unresolved', result: identity?.result ?? 'UNKNOWN' }); return buildNullDescriptiveEvidence('IDENTITY_UNRESOLVED') }
  const section = selectV2ReceptionSection(identity.sectionHierarchy)
  if (!section) { onDiagnosticEvent?.({ stage: 'section-selection', event: 'no-allowed-section' }); return buildNullDescriptiveEvidence('NO_MATCHING_SECTION') }
  const url = `${API}?action=parse&format=json&formatversion=2&prop=text&oldid=${encodeURIComponent(identity.revisionId)}&section=${encodeURIComponent(section.index)}`
  let response
  onDiagnosticEvent?.({ stage: 'content', event: 'request', attempt: 1 })
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'MovieMoodWikipediaEvidence/2.0' } }) }
  catch { onDiagnosticEvent?.({ stage: 'content', event: 'transport-failure', attempt: 1 }); return buildNullDescriptiveEvidence('FETCH_FAILED') }
  onDiagnosticEvent?.({ stage: 'content', event: 'http-response', attempt: 1, status: response.status })
  if (!response.ok) { onDiagnosticEvent?.({ stage: 'content', event: 'http-failure', attempt: 1, status: response.status }); return buildNullDescriptiveEvidence('FETCH_FAILED') }
  try { await onDescriptiveResponseReceived?.({ source: 'english-wikipedia', canonicalWikipediaTitle: identity.canonicalWikipediaTitle, pageId: identity.pageId, sourceRevision: identity.revisionId, sectionIndex: section.index, occurredAt: retrievedAt, extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY_V2, identityPolicy: WIKIPEDIA_FILM_IDENTITY_POLICY, sectionSelectionPolicy: WIKIPEDIA_RECEPTION_SECTION_POLICY_V2 }) }
  catch { onDiagnosticEvent?.({ stage: 'exposure', event: 'persistence-failure' }); throw new WikipediaDescriptiveEvidenceV2Error('Descriptive exposure could not be persisted.', { code: 'EXPOSURE_PERSISTENCE_FAILED' }) }
  onDiagnosticEvent?.({ stage: 'exposure', event: 'persistence-success' })
  let payload
  try { payload = await response.json(); onDiagnosticEvent?.({ stage: 'content', event: 'parse-success' }) } catch { onDiagnosticEvent?.({ stage: 'content', event: 'parse-failure' }); return buildNullDescriptiveEvidence('PARSE_FAILED') }
  const html = payload?.parse?.text?.['*'] ?? payload?.parse?.text
  if (typeof html !== 'string') { onDiagnosticEvent?.({ stage: 'content', event: 'content-payload-malformed' }); return buildNullDescriptiveEvidence('PARSE_FAILED') }
  const extracted = extractReceptionDescriptiveText({ heading: section.heading, html })
  onDiagnosticEvent?.({ stage: 'extraction', event: extracted.text ? 'success' : 'failure', failureReason: extracted.failureReason ?? null })
  const result = createV2Evidence({ identity, section, extracted, retrievedAt })
  if (result.descriptiveEvidence) {
    const cacheKey = createWikipediaV2CacheKey({ canonicalWikipediaTitle: identity.canonicalWikipediaTitle, pageId: identity.pageId, revisionId: identity.revisionId, section })
    try { await writeJsonFile(resolve(cacheRoot, `${cacheKey}.json`), { rawMediaWikiSection: payload, provenance: result.descriptiveEvidence.provenance }); onDiagnosticEvent?.({ stage: 'cache', event: 'write-success' }) }
    catch (error) { onDiagnosticEvent?.({ stage: 'cache', event: 'write-failure', code: typeof error?.code === 'string' ? error.code : 'UNKNOWN_CACHE_FAILURE' }); throw error }
  }
  return result
}
