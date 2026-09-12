import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { canonicalize } from './c1bV2Stage0.mjs'
import { fetchWikipediaReceptionEvidenceV2 } from '../adapters/wikipediaDescriptiveEvidenceV2.mjs'
import { V4_IMPLEMENTATION_COMMIT, buildExecutableClosureManifest, buildTriageExposureAudit, canonicalSha256, deriveDependencyPaths } from './c1bV4Registration.mjs'

const diagnostics = 'catalogue-pipeline/calibration/diagnostics'
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

describe('C1b-V4 static registration', () => {
  it('derives the exact tracked executable closure and validates every pinned byte', async () => {
    const stored = await readJson(`${diagnostics}/wikipedia-executable-closure.v1.json`)
    const derived = buildExecutableClosureManifest({ root: process.cwd(), commit: V4_IMPLEMENTATION_COMMIT })
    expect(canonicalize(stored)).toBe(canonicalize(derived))
    expect(stored.materialLocalSources.every(({ gitTracked }) => gitTracked)).toBe(true)
    expect(stored.materialLocalSources.map(({ path }) => path)).toEqual(deriveDependencyPaths({ root: process.cwd() }).paths)
    expect(stored.importEdges.every(({ importer, imported }) => stored.materialLocalSources.some(({ path }) => path === importer) && stored.materialLocalSources.some(({ path }) => path === imported))).toBe(true)
  })

  it('records the bounded triage standard without claiming absolute non-exposure', async () => {
    const stored = await readJson(`${diagnostics}/c1b-v4-triage-exposure-audit.v1.json`)
    const derived = await buildTriageExposureAudit({ root: process.cwd() })
    expect(canonicalize(stored)).toBe(canonicalize(derived))
    expect(stored).toMatchObject({ adverseEvidenceFound: false, triageExposureStatus: 'VERIFIED_NO_ADVERSE_EVIDENCE', networkCallsDuringAudit: 0 })
    expect(stored.epistemicStandard).toContain('absence-of-adverse-evidence')
    expect(stored.scopeLimitations.join(' ')).toContain('not proof of absolute non-exposure')
  })

  it('materializes exactly 11 independently hashed contracts and preserves all eight V3 canonical contents', async () => {
    const [v3, v4] = await Promise.all([readJson(`${diagnostics}/phase5c-c1b-v-confirmatory.v3.contracts.json`), readJson(`${diagnostics}/phase5c-c1b-v-confirmatory.v4.contracts.json`)])
    expect(v4.contracts).toHaveLength(11)
    for (const entry of v4.contracts) expect(entry.contentHash).toBe(canonicalSha256(entry.canonicalContent))
    expect(v4.contractsBundleHash).toBe(canonicalSha256(v4.orderedContractManifest))
    for (const id of ['shared-covariate-contract.v2', 'friends-classification-contract.v2', 'semantic-taxonomy.v2', 'arm0-input-projection.v2', 'arm1-evidence-projection.v2', 'wikipedia-excerpt-projection.v2', 'literal-grounding-validator.v2', 'identity-canary-contract.v2']) {
      expect(canonicalize(v4.contracts.find((entry) => entry.id === id).canonicalContent)).toBe(canonicalize(v3.contracts.find((entry) => entry.id === id).canonicalContent))
    }
    expect(JSON.stringify(v4)).not.toContain('explicitReadoptionRequired')
  })

  it('binds the registered protocol to closure, triage, cohort, contracts, and same-lock JIT order', async () => {
    const [protocol, closure, triage, bundle] = await Promise.all([
      readJson(`${diagnostics}/phase5c-c1b-v-confirmatory.v4.json`), readJson(`${diagnostics}/wikipedia-executable-closure.v1.json`),
      readJson(`${diagnostics}/c1b-v4-triage-exposure-audit.v1.json`), readJson(`${diagnostics}/phase5c-c1b-v-confirmatory.v4.contracts.json`),
    ])
    expect(protocol).toMatchObject({ protocolId: 'phase-5c-c1b-v-confirmatory.v4', registrationStatus: 'REGISTERED', specificationStatus: 'registered-frozen' })
    expect(protocol.contractBundle.contractsBundleHash).toBe(bundle.contractsBundleHash)
    expect(protocol.contractBundle.requiredContracts).toHaveLength(11)
    expect(protocol.historicalProvenance.triageAuditReportHash).toBe(canonicalSha256(triage))
    expect(protocol.stages[0].wikipediaExecutableClosure.canonicalSha256).toBe(canonicalSha256(closure))
    expect(protocol.stages[0].stage2JitExecutionInvariant.orderedSteps).toEqual(['acquire-stage2-RUN_LOCK', 'JIT-hash-and-provenance-verification', 'no-mutable-semantic-policy-operation', 'first-stage2-HTTP-dispatch', 'first-request-durable-completion'])
    expect(JSON.stringify(protocol)).not.toContain('PENDING_STATIC_REGISTRATION')
  })

  it('executes identity through viability on the declared synthetic fixture with zero external requests', async () => {
    const provenance = await readJson('tests/fixtures/wikipedia/provenance.json')
    expect(provenance).toMatchObject({ provenanceClass: 'SYNTHETIC', candidateSpecificV4WikipediaOutcome: false, networkRequired: false })
    const words = Array.from({ length: 160 }, (_, index) => `w${index}`).join(' ')
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ query: { pages: [{ pageid: 10, title: 'Synthetic Film (2018 film)', revisions: [{ revid: 20 }], pageprops: {} }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ parse: { sections: [{ index: '1', line: 'Plot' }, { index: '2', line: 'Reception' }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ parse: { text: { '*': `<p>${words}.</p>` } } }) })
    const result = await fetchWikipediaReceptionEvidenceV2({ facts: { candidateId: 'synthetic-film-2018', title: 'Synthetic Film', year: 2018, director: 'Synthetic Director', tmdbId: 1 }, fetchImpl, writeJsonFile: async () => false })
    const eligibleNormalizedWordCount = result.descriptiveEvidence.text.split(/\s+/u).filter(Boolean).length
    expect(result.descriptiveEvidence.provenance).toMatchObject({ identityPolicy: 'wikipedia-film-identity-resolution.v1', sectionSelectionPolicy: 'wikipedia-reception-sections.v2', extractionPolicy: 'wikipedia-reception-extraction.v2', normalizationFilterPolicy: 'wikipedia-reception-normalization-filter.v1', sectionHeading: 'Reception' })
    expect(eligibleNormalizedWordCount).toBeGreaterThanOrEqual(150)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
