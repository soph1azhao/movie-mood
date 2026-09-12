import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { stableHash } from './tmdbProvider.ts'

export const WIKIPEDIA_RECEPTION_EXTRACTION_POLICY = 'wikipedia-reception-extraction.v1'
export const WIKIPEDIA_ELIGIBLE_HEADING_POLICY = 'wikipedia-reception-headings.v1'
export const WIKIPEDIA_NORMALIZATION_FILTER_POLICY = 'wikipedia-reception-normalization-filter.v1'
export const WIKIPEDIA_CACHE_ROOT = resolve('catalogue-pipeline/cache/descriptive/wikipedia')
const ELIGIBLE_HEADING = /^(Critical response|Reception|Critical reception|Release and reception)$/i
const PROHIBITED_HEADING = /^(Plot|Synopsis|Story)$/i
const PROHIBITED_SENTENCE = /\b(?:award|accolade|nominat|festival|box[ -]?office|gross(?:ed|ing)?|revenue|chart|ranking|ranked|rotten tomatoes|metacritic|imdb|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:out of|\/|stars?))/i

export class WikipediaDescriptiveEvidenceError extends Error {
  constructor(message, { code = 'WIKIPEDIA_DESCRIPTIVE_EVIDENCE_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'WikipediaDescriptiveEvidenceError'
    this.code = code
    this.details = details
  }
}

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function normalize(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function sha256(text) { return createHash('sha256').update(text).digest('hex') }
function decodeEntities(text) { return text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ') }
function stripHtml(value) { return normalize(decodeEntities(String(value ?? '').replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ').replace(/<[^>]+>/g, ' '))) }
function paragraphsFromHtml(html) { return [...String(html ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripHtml(match[1])).filter(Boolean) }

export function selectEligibleReceptionSection(sections) {
  for (const section of sections ?? []) {
    const heading = normalize(section?.line)
    if (PROHIBITED_HEADING.test(heading)) continue
    if (ELIGIBLE_HEADING.test(heading)) return { index: String(section.index), heading }
  }
  return null
}

function removeProhibitedSentences(paragraph) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph]
  return normalize(sentences.filter((sentence) => !PROHIBITED_SENTENCE.test(sentence)).join(' '))
}

export function extractReceptionDescriptiveText({ heading, html }) {
  if (!ELIGIBLE_HEADING.test(normalize(heading)) || PROHIBITED_HEADING.test(normalize(heading))) return { text: null, failureReason: 'NO_MATCHING_SECTION' }
  const rawParagraphs = paragraphsFromHtml(html)
  if (rawParagraphs.length === 0) return { text: null, failureReason: 'NO_QUALIFYING_PROSE' }
  const cleaned = rawParagraphs.map(removeProhibitedSentences).filter((paragraph) => paragraph.length >= 24)
  if (cleaned.length === 0) return { text: null, failureReason: 'PROHIBITED_CONTENT_ONLY' }
  const text = normalize(cleaned.slice(0, 2).join('\n\n')).slice(0, 1000)
  return text ? { text, characterCount: text.length, contentSha256: `sha256:${sha256(text)}` } : { text: null, failureReason: 'NO_QUALIFYING_PROSE' }
}

export function createWikipediaDescriptiveCacheKey({ pageId, revisionId }) {
  return stableHash({ source: 'english-wikipedia', pageId: String(pageId), revisionId: String(revisionId), extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY, eligibleHeadingPolicy: WIKIPEDIA_ELIGIBLE_HEADING_POLICY, normalizationFilterPolicy: WIKIPEDIA_NORMALIZATION_FILTER_POLICY })
}

export function buildNullDescriptiveEvidence(failureReason) {
  return { descriptiveEvidence: null, stage2Bypassed: true, reviewFlags: ['human-review-queue'], failureReason }
}

export function verifyGroundingQuote(excerpt, groundingQuote) {
  return typeof groundingQuote === 'string' && groundingQuote.trim().length > 0 && normalize(excerpt).includes(normalize(groundingQuote))
}

export function createDescriptiveEvidence({ pageTitle, pageId, revisionId, sourceUrl, sectionHeading, retrievedAt, extracted }) {
  if (!extracted.text) return buildNullDescriptiveEvidence(extracted.failureReason)
  return {
    descriptiveEvidence: {
      sourceRef: 'wikipedia-reception', text: extracted.text, contentSha256: extracted.contentSha256,
      provenance: { source: 'english-wikipedia', pageTitle, pageId: String(pageId), revisionId: String(revisionId), sourceUrl, sectionHeading, retrievedAt, license: 'CC BY-SA 4.0', extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY, eligibleHeadingPolicy: WIKIPEDIA_ELIGIBLE_HEADING_POLICY, normalizationFilterPolicy: WIKIPEDIA_NORMALIZATION_FILTER_POLICY, contentSha256: extracted.contentSha256, characterCount: extracted.characterCount },
    },
    stage2Bypassed: false, reviewFlags: [], failureReason: null,
  }
}

export function projectDescriptiveEvidenceProvenance(result) {
  if (!result.descriptiveEvidence) return result
  return { descriptiveEvidence: { sourceRef: result.descriptiveEvidence.sourceRef, contentSha256: result.descriptiveEvidence.contentSha256, provenance: result.descriptiveEvidence.provenance }, stage2Bypassed: result.stage2Bypassed, reviewFlags: result.reviewFlags, failureReason: result.failureReason }
}

async function writeJsonIfChanged(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  let prior = null
  try { prior = await readFile(path, 'utf8') } catch { /* absent */ }
  if (prior === serialized) return false
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  try { await writeFile(temporary, serialized); await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
  return true
}

async function requestJson(fetchImpl, url) {
  let response
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json' } }) } catch (error) {
    throw new WikipediaDescriptiveEvidenceError('MediaWiki request failed before a response.', { code: 'FETCH_FAILED', details: { cause: String(error) } })
  }
  if (!response.ok) throw new WikipediaDescriptiveEvidenceError(`MediaWiki request failed: ${response.status}`, { code: 'FETCH_FAILED' })
  return response.json()
}

export async function fetchWikipediaReceptionEvidence({ pageTitle, fetchImpl = globalThis.fetch, retrievedAt = new Date().toISOString(), cacheRoot = WIKIPEDIA_CACHE_ROOT, writeJsonFile = writeJsonIfChanged, onDescriptiveResponseReceived }) {
  try {
    const base = 'https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2'
    const sectionsPayload = await requestJson(fetchImpl, `${base}&prop=sections&page=${encodeURIComponent(pageTitle)}`)
    const sections = asObject(sectionsPayload).parse?.sections
    if (!Array.isArray(sections)) throw new WikipediaDescriptiveEvidenceError('MediaWiki sections response was malformed.', { code: 'PARSE_FAILED' })
    const selected = selectEligibleReceptionSection(sections)
    if (!selected) return buildNullDescriptiveEvidence('NO_MATCHING_SECTION')
    const contentPayload = await requestJson(fetchImpl, `${base}&prop=text|revid&page=${encodeURIComponent(pageTitle)}&section=${encodeURIComponent(selected.index)}`)
    const parsed = asObject(contentPayload).parse
    if (parsed?.text) {
      try { await onDescriptiveResponseReceived?.({ source: 'english-wikipedia', phase: 'phase-5c-c1b-development-diagnostic', extractionPolicy: WIKIPEDIA_RECEPTION_EXTRACTION_POLICY, sourceRevision: parsed.revid ? String(parsed.revid) : null, occurredAt: retrievedAt }) }
      catch (error) { throw new WikipediaDescriptiveEvidenceError('Descriptive exposure could not be persisted.', { code: 'EXPOSURE_PERSISTENCE_FAILED', details: { cause: error instanceof Error ? error.message : String(error) } }) }
    }
    if (!parsed || !parsed.text || !parsed.pageid || !parsed.revid) throw new WikipediaDescriptiveEvidenceError('MediaWiki section response was malformed.', { code: 'PARSE_FAILED' })
    const pageId = parsed.pageid
    const revisionId = parsed.revid
    const extracted = extractReceptionDescriptiveText({ heading: selected.heading, html: asObject(parsed.text)['*'] ?? parsed.text })
    const sourceUrl = `https://en.wikipedia.org/?curid=${pageId}`
    const result = createDescriptiveEvidence({ pageTitle: parsed.title ?? pageTitle, pageId, revisionId, sourceUrl, sectionHeading: selected.heading, retrievedAt, extracted })
    if (result.descriptiveEvidence) {
      const cacheKey = createWikipediaDescriptiveCacheKey({ pageId, revisionId })
      await writeJsonFile(resolve(cacheRoot, `${cacheKey}.json`), { rawMediaWikiSection: contentPayload, provenance: result.descriptiveEvidence.provenance })
    }
    return result
  } catch (error) {
    if (error instanceof WikipediaDescriptiveEvidenceError && error.code === 'EXPOSURE_PERSISTENCE_FAILED') throw error
    if (error instanceof WikipediaDescriptiveEvidenceError) return buildNullDescriptiveEvidence(error.code)
    return buildNullDescriptiveEvidence('PARSE_FAILED')
  }
}
