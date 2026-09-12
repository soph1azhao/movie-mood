import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCostProjection,
  buildExpansionReadiness,
  createExpansionCandidateManifest,
} from './catalogueExpansionReadiness.mjs'

function sourceSnapshot() {
  const results = []
  const bands = [
    ['mainstream', 1200],
    ['familiar', 700],
    ['discovery', 300],
  ]
  let id = 1
  for (const decade of [1980, 1990, 2000, 2010, 2020]) {
    for (const [, votes] of bands) {
      for (let index = 0; index < 20; index += 1) {
        results.push({
          id: id++, title: `Film ${id}`, release_date: `${decade + index % 10}-01-01`, original_language: index % 2 ? ['fr', 'ja', 'es'][index % 3] : 'en',
          genre_ids: [index % 5 + 1], vote_count: votes + index, vote_average: 6 + index / 100, popularity: 10 + index,
          overview: 'A sufficiently detailed factual overview for deterministic grounding readiness tests.', poster_path: '/poster.jpg', adult: false, softcore: false,
        })
      }
    }
  }
  return { sourceSnapshotHash: 'sha256:fixture', rawResponseCorpus: [{ cellId: 'fixture', response: { results } }] }
}

function factsFor(manifest, overrides = {}) {
  return {
    schemaVersion: 'tmdb-facts.v1', batchId: manifest.batchId, facts: manifest.candidates.map((candidate) => ({
      candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, title: candidate.title, year: candidate.year,
      director: 'Director', genres: ['Drama'], runtimeMinutes: 100, countries: ['France'], spokenLanguages: ['French'],
      overview: 'A sufficiently detailed factual overview for deterministic grounding readiness tests.', keywords: ['friendship'], posterPath: '/poster.jpg', factsHash: `facts-${candidate.tmdbId}`,
      ...overrides,
    })),
  }
}

const pilot = {
  runId: 'pilot', providerId: 'provider', modelId: 'model', counts: { completed: 12, failedTerminal: 0 },
  usage: { inputTokens: 24009, outputTokens: 19879, thinkingTokens: 61830, successfulModelRequests: 13, retries: 1 },
  states: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`film-${index}`, { status: 'COMPLETED', providerUsageMetadata: { promptTokenCount: 2000 + index, candidatesTokenCount: 1600 + index, thoughtsTokenCount: 5000 + index, totalTokenCount: 8600 + index } }])),
}

describe('catalogue expansion readiness', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('selects a deterministic, duplicate-free 100-film manifest with stable IDs', () => {
    const source = sourceSnapshot()
    const first = createExpansionCandidateManifest({ sourceSnapshot: source, existingMappings: [{ id: 'existing', tmdbId: 1 }] })
    const second = createExpansionCandidateManifest({ sourceSnapshot: source, existingMappings: [{ id: 'existing', tmdbId: 1 }] })
    expect(first).toEqual(second)
    expect(first.candidates).toHaveLength(100)
    expect(new Set(first.candidates.map((candidate) => candidate.tmdbId)).size).toBe(100)
    expect(first.candidates.some((candidate) => candidate.tmdbId === 1)).toBe(false)
    expect(first.candidates.every((candidate) => candidate.candidateId === `exp100-tmdb-${candidate.tmdbId}`)).toBe(true)
  })

  it('builds overview-only packets without false maintainer keyword provenance or model calls', () => {
    const externalCall = vi.fn(() => { throw new Error('Offline readiness must not call fetch.') })
    vi.stubGlobal('fetch', externalCall)
    const manifest = createExpansionCandidateManifest({ sourceSnapshot: sourceSnapshot(), existingMappings: [] })
    const result = buildExpansionReadiness({ manifest, factsArtifact: factsFor(manifest), pilotManifest: pilot })
    expect(result.packets).toHaveLength(100)
    expect(result.packets.every((packet) => packet.facts.overview && packet.facts.keywords.length === 0)).toBe(true)
    expect(result.packets.flatMap((packet) => packet.sourceProvenance).some((source) => source.selection === 'maintainer-inspected-useful')).toBe(false)
    expect(result.report.counts).toMatchObject({ automaticallyReady: 100, insufficientGrounding: 0, hardBlocked: 0 })
    expect(result.report.scaleDecision).toBe('READY_FOR_50')
    expect(externalCall).not.toHaveBeenCalled()
  })

  it('flags insufficient grounding and routes only the exception to targeted review', () => {
    const manifest = createExpansionCandidateManifest({ sourceSnapshot: sourceSnapshot(), existingMappings: [] })
    const facts = factsFor(manifest)
    facts.facts[0].overview = 'short'
    const result = buildExpansionReadiness({ manifest, factsArtifact: facts, pilotManifest: pilot })
    expect(result.report.counts.insufficientGrounding).toBe(1)
    expect(result.report.counts.needsTargetedReview).toBe(1)
    expect(result.reviewQueue.items[0]).toMatchObject({ status: 'needs_review', priority: 'P2' })
    expect(result.reviewQueue.items.slice(1).every((item) => item.status === 'candidate_for_batch_approval')).toBe(true)
  })

  it('projects observed pilot usage with deterministic arithmetic', () => {
    const projection = buildCostProjection(pilot)
    expect(projection.perCompletedFilm.inputTokens.average).toBe(2000.75)
    expect(projection.projections['100']).toMatchObject({ inputTokens: 200075, outputTokens: 165658, thinkingTokens: 515250, providerRequests: 109, retries: 8 })
    expect(projection.reliability.observedRetryFractionOfRequests).toBeCloseTo(1 / 13)
    expect(projection.dollarProjection.calculated).toBe(false)
  })
})
