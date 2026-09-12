import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { selectEligibleReceptionSection, WIKIPEDIA_ELIGIBLE_HEADING_POLICY, WIKIPEDIA_RECEPTION_EXTRACTION_POLICY } from '../adapters/wikipediaDescriptiveEvidence.mjs'

export const C1B_WIKIPEDIA_STRUCTURAL_AUDIT_VERSION = 'phase-5c-c1b-d-wikipedia-structural-audit.v1'
export const C1B_WIKIPEDIA_SECTIONS_ENDPOINT = 'https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=sections'

export class WikipediaStructuralAuditError extends Error {
  constructor(message, { code = 'WIKIPEDIA_STRUCTURAL_AUDIT_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'WikipediaStructuralAuditError'
    this.code = code
    this.details = details
  }
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const receptionLike = /\b(?:reception|critical(?:\s+response|\s+reception|\s+reviews?)?|reviews?|critics?)\b/i
const combinedReleaseReception = /\brelease\b/i

function asSection(value, position, ancestors) {
  const heading = normalize(value?.line)
  const level = Number(value?.toclevel ?? value?.level ?? 1)
  const section = { position, index: String(value?.index ?? position), number: normalize(value?.number), level: Number.isFinite(level) ? level : 1, heading, ancestors }
  return section
}

export function normalizeSectionHierarchy(sections) {
  if (!Array.isArray(sections)) throw new WikipediaStructuralAuditError('MediaWiki sections response was malformed.', { code: 'MALFORMED_SECTIONS_RESPONSE' })
  const stack = []
  return sections.map((value, offset) => {
    const level = Number(value?.toclevel ?? value?.level ?? 1)
    const normalizedLevel = Number.isFinite(level) ? level : 1
    while (stack.length && stack.at(-1).level >= normalizedLevel) stack.pop()
    const section = asSection(value, offset + 1, stack.map((entry) => entry.heading))
    stack.push(section)
    return section
  })
}

export function isV1EligibleHeading(section) {
  return Boolean(selectEligibleReceptionSection([{ ...section, line: section.heading }]))
}

export function diagnoseSectionStructure(sections) {
  const inventory = normalizeSectionHierarchy(sections).map((section) => ({ ...section, v1Eligible: isV1EligibleHeading(section) }))
  const eligible = inventory.filter((section) => section.v1Eligible)
  const candidates = inventory.filter((section) => !section.v1Eligible && receptionLike.test(section.heading))
  const combined = candidates.filter((section) => combinedReleaseReception.test(section.heading) && /\breception\b/i.test(section.heading))
  const nested = candidates.filter((section) => section.ancestors.length > 0)
  const distributed = candidates.filter((section) => /\b(?:reviews?|critics?)\b/i.test(section.heading) && !/\breception\b/i.test(section.heading))
  const disambiguationLike = inventory.some((section) => /^(?:People|Astronomy|Computing|Film and television|Greek mythology|Music|Organizations|Places|Science and medicine|Other uses)$/i.test(section.heading))
  let classification = 'NO_RECEPTION_LIKE_STRUCTURAL_SECTION'
  let relevantSections = []
  if (eligible.length) { classification = 'V1_ELIGIBLE_SECTION_PRESENT'; relevantSections = eligible }
  else if (combined.length) { classification = 'COMBINED_RELEASE_RECEPTION_HEADING'; relevantSections = combined }
  else if (nested.length) { classification = 'RECEPTION_LIKE_HEADING_NESTED'; relevantSections = nested }
  else if (distributed.length) { classification = 'CRITICISM_DISTRIBUTED_NON_RECEPTION_SECTIONS'; relevantSections = distributed }
  else if (candidates.length) { classification = 'RECEPTION_LIKE_HEADING_VARIANT'; relevantSections = candidates }
  else if (disambiguationLike) { classification = 'PAGE_IDENTITY_AMBIGUITY_OR_NON_FILM_STRUCTURE'; relevantSections = [] }
  else if (inventory.length === 0) { classification = 'PAGE_WITH_NO_AUDITABLE_SECTIONS'; relevantSections = [] }
  return { inventory, classification, relevantSections: relevantSections.map(({ position, index, number, level, heading, ancestors }) => ({ position, index, number, level, heading, ancestors })) }
}

export function auditStructuralRows({ candidates, sectionsById }) {
  return candidates.map(({ canonicalId, title, available, nullReason }) => {
    const source = sectionsById.get(canonicalId)
    const page = Array.isArray(source) ? { sections: source, pageTitle: title, pageId: null } : source
    const diagnosis = diagnoseSectionStructure(page?.sections)
    return { canonicalId, title, pageTitleReturned: page?.pageTitle ?? title, pageId: page?.pageId ?? null, v1Availability: available, v1NullReason: nullReason, ...diagnosis }
  })
}

export function summarizeClassConditionedCoverage(rows, friendsGoldById) {
  const classes = { friends: { available: 0, null: 0, total: 0 }, notFriends: { available: 0, null: 0, total: 0 } }
  for (const row of rows) {
    const key = friendsGoldById.get(row.canonicalId) ? 'friends' : 'notFriends'
    classes[key].total += 1
    classes[key][row.v1Availability ? 'available' : 'null'] += 1
  }
  return classes
}

export function proposeStructuralPolicies(rows) {
  const nullRows = rows.filter((row) => !row.v1Availability)
  const classifications = new Set(nullRows.map((row) => row.classification))
  return [
    { id: 'candidate-v2-narrow-heading-variants', status: classifications.has('RECEPTION_LIKE_HEADING_VARIANT') ? 'REQUIRES_D2B_REVIEW' : 'NOT_INDICATED', scope: 'Only exact observed reception-like heading variants, enumerated after audit.', risk: 'Heading resemblance does not establish that a section contains suitable descriptive criticism.' },
    { id: 'candidate-v2-nested-reception', status: classifications.has('RECEPTION_LIKE_HEADING_NESTED') ? 'REQUIRES_D2B_REVIEW' : 'NOT_INDICATED', scope: 'Reception-like descendant sections only; preserve the current prohibition on plot/synopsis/story.', risk: 'Nested placement can bundle marketing, release, or non-critical material.' },
    { id: 'candidate-v2-combined-release-reception', status: classifications.has('COMBINED_RELEASE_RECEPTION_HEADING') ? 'REQUIRES_D2B_REVIEW' : 'NOT_INDICATED', scope: 'Combined release/reception heading variants only.', risk: 'Release information may dominate the section and weaken descriptive-evidence precision.' },
    { id: 'candidate-v2-distributed-criticism', status: classifications.has('CRITICISM_DISTRIBUTED_NON_RECEPTION_SECTIONS') ? 'HIGH_RISK_D2B_REQUIRED' : 'NOT_INDICATED', scope: 'Multiple non-reception criticism headings.', risk: 'Requires prose-level provenance and leakage adjudication; no automated expansion is safe.' },
    { id: 'resolve-page-identity-before-v2', status: classifications.has('PAGE_IDENTITY_AMBIGUITY_OR_NON_FILM_STRUCTURE') || classifications.has('PAGE_WITH_NO_AUDITABLE_SECTIONS') ? 'REQUIRED_BEFORE_POLICY_CHANGE' : 'NOT_NEEDED', scope: 'Resolve the intended film page deterministically before considering any reception policy.', risk: 'A heading policy cannot repair a title lookup that reached a disambiguation, non-film, or structurally empty page.' },
    { id: 'retain-v1-null-on-no-structure', status: classifications.has('NO_RECEPTION_LIKE_STRUCTURAL_SECTION') ? 'RECOMMENDED' : 'NOT_NEEDED', scope: 'Keep null evidence where the TOC has no reception-like structural signal.', risk: 'Avoids fabricating coverage by searching unrelated sections.' },
  ]
}

export function classifyStructuralAuditOutcome({ rows, classCoverage }) {
  const nullRows = rows.filter((row) => !row.v1Availability)
  const classifications = new Set(nullRows.map((row) => row.classification))
  const classImbalance = classCoverage.friends.null !== classCoverage.notFriends.null
  const broadOrAbsentStructure = classifications.has('NO_RECEPTION_LIKE_STRUCTURAL_SECTION') || classifications.has('CRITICISM_DISTRIBUTED_NON_RECEPTION_SECTIONS') || classifications.has('PAGE_IDENTITY_AMBIGUITY_OR_NON_FILM_STRUCTURE') || classifications.has('PAGE_WITH_NO_AUDITABLE_SECTIONS')
  if (classImbalance || broadOrAbsentStructure) return 'STRUCTURAL MISSINGNESS / SELECTION-BIAS RISK'
  if (nullRows.length && classifications.size === 1 && (classifications.has('RECEPTION_LIKE_HEADING_VARIANT') || classifications.has('RECEPTION_LIKE_HEADING_NESTED') || classifications.has('COMBINED_RELEASE_RECEPTION_HEADING'))) return 'SIMPLE STRUCTURAL GENERALIZATION PLAUSIBLE'
  return 'NO SAFE STRUCTURAL GENERALIZATION'
}

export async function fetchWikipediaSectionInventory({ pageTitle, fetchImpl = globalThis.fetch }) {
  const url = `${C1B_WIKIPEDIA_SECTIONS_ENDPOINT}&page=${encodeURIComponent(pageTitle)}`
  let response
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json' } }) }
  catch { throw new WikipediaStructuralAuditError('MediaWiki structural request failed before a response.', { code: 'STRUCTURAL_FETCH_FAILED' }) }
  if (!response.ok) throw new WikipediaStructuralAuditError(`MediaWiki structural request failed: ${response.status}`, { code: 'STRUCTURAL_FETCH_FAILED' })
  const payload = await response.json()
  const sections = payload?.parse?.sections
  if (!Array.isArray(sections)) throw new WikipediaStructuralAuditError('MediaWiki sections response was malformed.', { code: 'MALFORMED_SECTIONS_RESPONSE' })
  return { pageTitle: normalize(payload.parse.title) || pageTitle, pageId: payload.parse.pageid == null ? null : String(payload.parse.pageid), sections }
}

async function writeJsonIfChanged(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  let prior = null
  try { prior = await readFile(path, 'utf8') } catch { /* absent */ }
  if (prior === text) return false
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, text)
  await rename(temporary, path)
  return true
}

export async function writeStructuralAuditReport(path, report) {
  await writeJsonIfChanged(resolve(path), report)
}

export { WIKIPEDIA_ELIGIBLE_HEADING_POLICY, WIKIPEDIA_RECEPTION_EXTRACTION_POLICY }
