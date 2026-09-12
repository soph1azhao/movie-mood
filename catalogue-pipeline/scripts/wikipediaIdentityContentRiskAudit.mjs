import { createHash } from 'node:crypto'
import { extractReceptionDescriptiveText } from '../adapters/wikipediaDescriptiveEvidence.mjs'
import { diagnoseSectionStructure } from './wikipediaStructuralMissingnessAudit.mjs'

export const C1B_D2B_IDENTITY_VERSION = 'phase-5c-c1b-d2b-wikipedia-identity.v1'
export const C1B_D2B_CONTENT_AUDIT_VERSION = 'phase-5c-c1b-d2b-content-risk.v1'
const API = 'https://en.wikipedia.org/w/api.php'
const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const normalizedTitle = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

export class WikipediaD2bAuditError extends Error {
  constructor(message, { code = 'WIKIPEDIA_D2B_AUDIT_ERROR', details = {} } = {}) { super(message); this.name = 'WikipediaD2bAuditError'; this.code = code; this.details = details }
}

export function buildDeterministicWikipediaTitleVariants({ title, year }) {
  return [...new Set([title, `${title} (film)`, `${title} (${year} film)`])]
}

export function projectWikipediaIdentityAnchor(fact) {
  return { candidateId: fact.candidateId, title: fact.title, year: fact.year, tmdbId: fact.tmdbId, director: fact.director }
}

async function requestJson(fetchImpl, url, { beforeParse, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), onDiagnosticEvent, stage } = {}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response
    onDiagnosticEvent?.({ stage, event: 'request', attempt })
    try { response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'MovieMoodPhase5D2bAudit/1.0 (metadata-only diagnostic)' } }) }
    catch { onDiagnosticEvent?.({ stage, event: 'transport-failure', attempt }); throw new WikipediaD2bAuditError('MediaWiki request failed before a response.', { code: 'WIKIPEDIA_REQUEST_FAILED' }) }
    onDiagnosticEvent?.({ stage, event: 'http-response', attempt, status: response.status })
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers?.get?.('retry-after'))
      onDiagnosticEvent?.({ stage, event: 'retry', attempt, status: response.status })
      await sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 30_000) : 1_000)
      continue
    }
    if (!response.ok) { onDiagnosticEvent?.({ stage, event: 'http-failure', attempt, status: response.status }); throw new WikipediaD2bAuditError(`MediaWiki request failed: ${response.status}`, { code: 'WIKIPEDIA_REQUEST_FAILED' }) }
    await beforeParse?.()
    try { const payload = await response.json(); onDiagnosticEvent?.({ stage, event: 'parse-success', attempt }); return payload }
    catch { onDiagnosticEvent?.({ stage, event: 'parse-failure', attempt }); throw new WikipediaD2bAuditError('MediaWiki response JSON was malformed.', { code: 'MALFORMED_RESPONSE' }) }
  }
  throw new WikipediaD2bAuditError('MediaWiki request retry limit reached.', { code: 'WIKIPEDIA_REQUEST_FAILED' })
}

function redirectPathFor(requested, payload) {
  const normalizations = new Map((payload?.query?.normalized ?? []).map((entry) => [entry.from, entry.to]))
  const redirects = new Map((payload?.query?.redirects ?? []).map((entry) => [entry.from, entry.to]))
  const path = [requested]
  let current = normalizations.get(requested) ?? requested
  if (current !== requested) path.push(current)
  const redirected = redirects.get(current)
  if (redirected && redirected !== current) { path.push(redirected); current = redirected }
  return { path, finalTitle: current }
}

function filmStructureScore(inventory) {
  const headings = new Set(inventory.map((section) => section.heading.toLowerCase()))
  return (headings.has('plot') ? 30 : 0) + (headings.has('cast') ? 20 : 0) + (headings.has('production') ? 10 : 0) + (inventory.some((section) => section.v1Eligible) ? 10 : 0)
}

export function rankWikipediaIdentityCandidate({ fact, requestedVariants, page, structure }) {
  const title = page.title
  let score = 0
  if (normalizedTitle(title) === normalizedTitle(`${fact.title} (${fact.year} film)`)) score += 100
  else if (normalizedTitle(title) === normalizedTitle(`${fact.title} (film)`)) score += 80
  else if (normalizedTitle(title) === normalizedTitle(fact.title)) score += 60
  else if (normalizedTitle(title).includes(normalizedTitle(fact.title))) score += 20
  if (new RegExp(`\\b${fact.year}\\b`).test(title)) score += 30
  score += filmStructureScore(structure.inventory)
  const matchingRequest = requestedVariants.find((variant) => normalizedTitle(variant) === normalizedTitle(title)) ?? requestedVariants[0]
  return { score, matchingRequest }
}

export function selectWikipediaIdentity({ fact, requestedVariants, candidates }) {
  const eligible = candidates.filter((candidate) => !candidate.missing && !candidate.disambiguation && candidate.structure.inventory.length > 0)
    .map((candidate) => ({ ...candidate, ...rankWikipediaIdentityCandidate({ fact, requestedVariants, page: candidate, structure: candidate.structure }) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  if (!eligible.length || eligible[0].score < 80 || (eligible[1] && eligible[0].score === eligible[1].score)) return { resolved: false, result: 'UNRESOLVED_UNIQUE_FILM_PAGE_NOT_ESTABLISHED', candidates: candidates.map(({ title, pageId, disambiguation, missing }) => ({ title, pageId, disambiguation, missing })) }
  const selected = eligible[0]
  return { resolved: true, result: 'RESOLVED_HIGH_CONFIDENCE', selected, candidates: candidates.map(({ title, pageId, disambiguation, missing }) => ({ title, pageId, disambiguation, missing })) }
}

export async function resolveWikipediaFilmIdentity({ fact, fetchImpl = globalThis.fetch, pace = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), onDiagnosticEvent }) {
  const anchor = projectWikipediaIdentityAnchor(fact)
  const requestedVariants = buildDeterministicWikipediaTitleVariants(anchor)
  const queryUrl = `${API}?action=query&format=json&formatversion=2&redirects=1&prop=info%7Cpageprops%7Crevisions&rvprop=ids&titles=${encodeURIComponent(requestedVariants.join('|'))}`
  const payload = await requestJson(fetchImpl, queryUrl, { onDiagnosticEvent, stage: 'identity-query' })
  const pages = payload?.query?.pages
  if (!Array.isArray(pages)) { onDiagnosticEvent?.({ stage: 'identity-query', event: 'identity-response-malformed' }); throw new WikipediaD2bAuditError('MediaWiki identity response was malformed.', { code: 'MALFORMED_IDENTITY_RESPONSE' }) }
  const candidates = pages.map((page) => ({ title: page.title, pageId: page.pageid == null ? null : String(page.pageid), revisionId: page.revisions?.[0]?.revid == null ? null : String(page.revisions[0].revid), disambiguation: Boolean(page.pageprops && Object.hasOwn(page.pageprops, 'disambiguation')), missing: Boolean(page.missing), redirectPaths: requestedVariants.map((variant) => redirectPathFor(variant, payload)).filter((entry) => normalizedTitle(entry.finalTitle) === normalizedTitle(page.title)).map((entry) => entry.path), structure: diagnoseSectionStructure([]) }))
  const rankedMetadata = candidates.filter((candidate) => !candidate.missing && !candidate.disambiguation).map((candidate) => ({ candidate, ranking: rankWikipediaIdentityCandidate({ fact: anchor, requestedVariants, page: candidate, structure: candidate.structure }) })).sort((a, b) => b.ranking.score - a.ranking.score || a.candidate.title.localeCompare(b.candidate.title))
  if (!rankedMetadata.length || (rankedMetadata[1] && rankedMetadata[0].ranking.score === rankedMetadata[1].ranking.score)) { onDiagnosticEvent?.({ stage: 'identity', event: 'unresolved-unique-film-page-not-established' }); return { canonicalId: anchor.candidateId, requestedTitle: anchor.title, requestedYear: anchor.year, tmdbId: anchor.tmdbId, directorAnchor: anchor.director, requestedVariants, resolved: false, result: 'UNRESOLVED_UNIQUE_FILM_PAGE_NOT_ESTABLISHED', candidates: candidates.map(({ title, pageId, disambiguation, missing }) => ({ title, pageId, disambiguation, missing })) } }
  const selectedMetadata = rankedMetadata[0].candidate
  const sectionUrl = `${API}?action=parse&format=json&formatversion=2&prop=sections&pageid=${encodeURIComponent(selectedMetadata.pageId)}`
  const sectionResponse = await requestJson(fetchImpl, sectionUrl, { onDiagnosticEvent, stage: 'identity-sections' })
  if (!Array.isArray(sectionResponse?.parse?.sections)) { onDiagnosticEvent?.({ stage: 'identity-sections', event: 'sections-response-malformed' }); throw new WikipediaD2bAuditError('MediaWiki section response was malformed.', { code: 'MALFORMED_SECTIONS_RESPONSE' }) }
  selectedMetadata.structure = diagnoseSectionStructure(sectionResponse.parse.sections)
  await pace(1_000)
  const resolution = selectWikipediaIdentity({ fact: anchor, requestedVariants, candidates })
  if (!resolution.resolved) { onDiagnosticEvent?.({ stage: 'identity', event: 'unresolved-after-structure', result: resolution.result }); return { canonicalId: anchor.candidateId, requestedTitle: anchor.title, requestedYear: anchor.year, tmdbId: anchor.tmdbId, directorAnchor: anchor.director, requestedVariants, ...resolution } }
  const selected = resolution.selected
  onDiagnosticEvent?.({ stage: 'identity', event: 'resolved', pageId: selected.pageId, revisionId: selected.revisionId, redirect: selected.redirectPaths.length > 0, disambiguation: selected.disambiguation })
  return { canonicalId: anchor.candidateId, requestedTitle: anchor.title, requestedYear: anchor.year, tmdbId: anchor.tmdbId, directorAnchor: anchor.director, requestedVariants, resolved: true, canonicalWikipediaTitle: selected.title, pageId: selected.pageId, revisionId: selected.revisionId, redirectPath: selected.redirectPaths[0] ?? [selected.matchingRequest, selected.title], disambiguationDetected: selected.disambiguation, filmIdentityConfidence: resolution.result, identityResolutionMethod: 'deterministic-title-variants+pageprops+film-section-structure.v1', sectionHierarchy: selected.structure.inventory, structuralClassification: selected.structure.classification, candidateSections: selected.structure.relevantSections, consideredCandidates: resolution.candidates }
}

function stripHtml(value) {
  return normalize(String(value ?? '').replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ').replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' '))
}
function paragraphsFromHtml(html) { return [...String(html ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripHtml(match[1])).filter(Boolean) }
const patterns = {
  experiential: /\b(?:tone|tonal|style|stylish|rhythm|rhythmic|pace|paced|atmosphere|atmospheric|humou?r|comic|comedy|funny|tension|tense|suspense|moving|emotional|affect|audience|entertaining|thrilling|haunting|meditative|quiet|intense|energetic)\b/gi,
  plotSpoiler: /\b(?:ending|finale|reveal|twist|dies|death of|killer is|culminates|eventually|in the final|last scene|outcome)\b/gi,
  prestige: /\b(?:award|accolade|masterpiece|canon|greatest|best film|ranked|top ten|retrospective|legacy|historical standing)\b/gi,
  commercial: /\b(?:box office|grossed|release date|released on|streaming|distribution|festival|rotten tomatoes|metacritic|rating|approval rating)\b/gi,
  controversy: /\b(?:controversy|controversial|censor|censorship|protest|political reaction|public reaction|backlash|banned)\b/gi,
}
function countMatches(text, pattern) { return [...text.matchAll(pattern)].length }
function level(count, { moderate = 1, high = 3 } = {}) { return count >= high ? 'HIGH' : count >= moderate ? 'MODERATE' : 'LOW' }

export function assessWikipediaCandidateContent({ identity, section = identity.candidateSections[0], html }) {
  if (!section) return { auditable: false, failureReason: 'NO_STRUCTURALLY_PLAUSIBLE_CRITICISM_SECTION' }
  const paragraphs = paragraphsFromHtml(html)
  const normalized = normalize(paragraphs.join('\n\n'))
  const extracted = extractReceptionDescriptiveText({ heading: section.heading, html })
  const unfilteredLead = normalized.slice(0, 1000)
  const boundedEvidence = extracted.text ?? ''
  const experientialLead = countMatches(boundedEvidence, patterns.experiential)
  const experientialFull = countMatches(normalized, patterns.experiential)
  const combined = /^Release and reception$/i.test(section.heading)
  const risks = {
    experientialRegisterSignal: level(experientialLead, { moderate: 1, high: 3 }),
    plotSpoilerContamination: level(countMatches(boundedEvidence, patterns.plotSpoiler), { moderate: 1, high: 2 }),
    prestigeCanonizationContamination: level(countMatches(boundedEvidence, patterns.prestige), { moderate: 1, high: 3 }),
    commercialReleaseContamination: level(countMatches(boundedEvidence, patterns.commercial), { moderate: 1, high: 3 }),
    controversyPublicReactionContamination: level(countMatches(boundedEvidence, patterns.controversy), { moderate: 1, high: 2 }),
  }
  const unfilteredLeadCommercialDominance = level(countMatches(unfilteredLead, patterns.commercial), { moderate: 2, high: 5 })
  const usefulProseOccursTooLate = experientialLead === 0 && experientialFull > 0
  const budgetClipsBeforeCriticism = normalized.length > 1000 && usefulProseOccursTooLate
  const existingFilterWouldSucceed = Boolean(extracted.text)
  const highRisk = Object.entries(risks).some(([key, value]) => key !== 'experientialRegisterSignal' && value === 'HIGH')
  const extractionBudgetViability = existingFilterWouldSucceed && !usefulProseOccursTooLate && !highRisk && risks.experientialRegisterSignal !== 'LOW' ? 'VIABLE' : existingFilterWouldSucceed && !highRisk ? 'MARGINAL' : 'NOT_VIABLE'
  return { auditable: true, sectionIdentity: { index: section.index, heading: section.heading, ancestors: section.ancestors }, contentSha256: sha256(normalized), characterCount: normalized.length, paragraphCount: paragraphs.length, ...risks, unfilteredLeadCommercialDominance, extractionBudgetViability, existingFilterWouldSucceed, usefulProseOccursTooLate, budgetClipsBeforeCriticism, structurallyHeterogeneous: combined }
}

export async function fetchWikipediaCandidateSectionForAudit({ identity, section = identity.candidateSections[0], fetchImpl = globalThis.fetch, onTextResponseReceived }) {
  if (!identity.resolved || !section) return { auditable: false, failureReason: 'NO_STRUCTURALLY_PLAUSIBLE_CRITICISM_SECTION' }
  const url = `${API}?action=parse&format=json&formatversion=2&prop=text&oldid=${encodeURIComponent(identity.revisionId)}&section=${encodeURIComponent(section.index)}`
  const payload = await requestJson(fetchImpl, url, { beforeParse: () => onTextResponseReceived?.({ source: 'english-wikipedia', sourceRevision: identity.revisionId, sectionIndex: section.index }) })
  const html = payload?.parse?.text?.['*'] ?? payload?.parse?.text
  if (typeof html !== 'string') throw new WikipediaD2bAuditError('MediaWiki content response was malformed.', { code: 'MALFORMED_CONTENT_RESPONSE' })
  return assessWikipediaCandidateContent({ identity, section, html })
}

export function summarizeD2bContentAudit(rows) {
  const viable = rows.filter((row) => row.preferredCandidateAudit?.extractionBudgetViability === 'VIABLE').length
  const marginal = rows.filter((row) => row.preferredCandidateAudit?.extractionBudgetViability === 'MARGINAL').length
  const sectionFamilies = [...new Set(rows.map((row) => row.preferredCandidateAudit?.sectionIdentity?.heading).filter(Boolean))]
  const unsafeFamilies = rows.filter((row) => /^(?:Themes?|Analysis|Legacy|Response|Reactions)$/i.test(row.preferredCandidateAudit?.sectionIdentity?.heading ?? ''))
  const heterogeneous = sectionFamilies.some((heading) => /^Release and reception$/i.test(heading)) || unsafeFamilies.length > 0
  const safeCoverage = viable + marginal
  let decision = 'NO-GO — SOURCE REGIME TOO HETEROGENEOUS / BIASED'
  if (!heterogeneous && viable === rows.length) decision = 'GO — HOMOGENEOUS DESCRIPTIVE CHANNEL PLAUSIBLE'
  else if (!heterogeneous && safeCoverage >= Math.ceil(rows.length * 0.75)) decision = 'CONDITIONAL — LIMITED STRUCTURAL POLICY MAY BE VIABLE'
  return { expectedSafeCoverage: safeCoverage, viable, marginal, unavailableOrUnsafe: rows.length - safeCoverage, sectionFamilies, asymmetricEvidenceRegimesDetected: heterogeneous, decision }
}

export function choosePreferredStructuralCandidate(audits) {
  const rank = (audit) => /^Critical (?:response|reception)$/i.test(audit.sectionIdentity?.heading ?? '') ? 0 : /^Reception$/i.test(audit.sectionIdentity?.heading ?? '') ? 1 : /^Release and reception$/i.test(audit.sectionIdentity?.heading ?? '') ? 2 : 3
  return [...audits].sort((a, b) => rank(a) - rank(b) || Number(a.sectionIdentity?.index) - Number(b.sectionIdentity?.index))[0] ?? null
}
