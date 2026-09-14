import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPromotionReadinessAudit, selectDeterministicPilot } from './auditPromotionReadiness.mjs'

function grounding(label) {
  return {
    rationale: `${label} has a sufficiently specific rationale.`,
    sourceRefs: ['tmdb-facts'],
    grounding: {
      mode: 'direct',
      cues: [{ sourceRef: 'tmdb-facts', cue: `${label} factual cue` }],
    },
  }
}

function semantic(candidateId, tmdbId, overrides = {}) {
  const classification = {
    moods: ['thoughtful', 'emotional'],
    situations: ['alone', 'date-night'],
    filterLanguages: ['English'],
    pace: 'medium',
    emotionalWeight: 'moderate',
    attentionDemand: 'engaged',
    discoveryStyle: 'different',
    ...overrides,
  }
  return {
    schemaVersion: 'semantic-output.v2',
    promptVersion: 'semantic-classifier.v3',
    taxonomyVersion: 'taxonomy.v2',
    movie: { candidateId, tmdbId },
    classification,
    evidence: {
      moods: Object.fromEntries(classification.moods.map((value) => [value, grounding(value)])),
      situations: Object.fromEntries(classification.situations.map((value) => [value, grounding(value)])),
      pace: grounding('pace'),
      emotionalWeight: grounding('emotional weight'),
      attentionDemand: grounding('attention demand'),
      discoveryStyle: grounding('discovery style'),
    },
    boundaryFlags: [],
  }
}

function facts(candidateId, tmdbId, overrides = {}) {
  return {
    candidateId,
    tmdbId,
    title: `Film ${tmdbId}`,
    year: 2000,
    director: 'Director Name',
    countries: ['Country'],
    spokenLanguages: ['English'],
    genres: ['Drama'],
    runtimeMinutes: 100,
    posterPath: '/poster.jpg',
    ...overrides,
  }
}

function evidence(candidateId, tmdbId, fact = facts(candidateId, tmdbId)) {
  return {
    schemaVersion: 'evidence-packet.v1',
    candidateId,
    tmdbId,
    facts: {
      title: fact.title,
      year: fact.year,
      director: fact.director,
      countries: fact.countries,
      spokenLanguages: fact.spokenLanguages,
      genres: fact.genres,
      runtimeMinutes: fact.runtimeMinutes,
    },
  }
}

function editorial(candidateId, tmdbId) {
  return {
    schemaVersion: 'editorial-output.v1',
    promptVersion: 'editorial-writer.v1',
    voiceGuideVersion: 'voice-guide.v1',
    movie: { candidateId, tmdbId },
    copy: {
      description: 'A carefully observed story follows two people through a changing city and an uncertain but revealing night together.',
      whyWatch: 'Choose it for precise character work, vivid atmosphere, and emotional tension that stays grounded in small decisions.',
      curiosityHook: 'A chance encounter turns an ordinary evening into a revealing test of what each person really wants.',
      vibeSummary: 'Reflective and intimate, with measured momentum and a quietly resonant emotional finish.',
    },
    writerNotes: {
      spoilerBoundary: {
        allowedMaterial: ['Opening setup'],
        excludedMaterial: ['Resolution'],
        sourceRefs: ['tmdb-overview'],
      },
    },
  }
}

function makeInput(entries, options = {}) {
  const importedCandidates = entries.map(({ candidateId, tmdbId }) => ({ candidateId, tmdbId, disposition: 'IMPORTED_VALID', evidencePacketHash: `hash-${candidateId}`, priorArtifactHash: `artifact-${candidateId}` }))
  const states = Object.fromEntries(entries.map(({ candidateId, tmdbId }) => [candidateId, { candidateId, tmdbId, status: 'IMPORTED_VALID', evidencePacketHash: `hash-${candidateId}`, lifetimeProvenance: { artifactHash: `artifact-${candidateId}`, sourceRunId: 'prior' } }]))
  const factRecords = entries.map(({ candidateId, tmdbId, facts: factOverrides }) => facts(candidateId, tmdbId, factOverrides))
  return {
    cohortManifest: { cohortId: 'cohort', cohortHash: 'hash', targetCount: entries.length, totalCandidates: entries.length, importedCandidates, newCandidates: [] },
    semanticManifest: { runId: 'cohort', cohortHash: 'hash', candidateCount: entries.length, states, lastInvocation: { completedAt: '2026-01-01T00:00:00.000Z' } },
    semanticArtifactsByCandidateId: Object.fromEntries(entries.map(({ candidateId, tmdbId, semantic: semanticOverrides }) => [candidateId, semantic(candidateId, tmdbId, semanticOverrides)])),
    evidencePacketsByCandidateId: Object.fromEntries(entries.map(({ candidateId, tmdbId }, index) => [candidateId, evidence(candidateId, tmdbId, factRecords[index])])),
    facts: factRecords,
    runtimeMappings: [],
    runtimeFactsByLocalId: {},
    editorialByCandidateId: {},
    palettesByCandidateId: {},
    infrastructure: {},
    pilotSize: Math.min(2, entries.length),
    ...options,
  }
}

test('reconciles runtime overlap and an already-promoted record by TMDB identity', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }, { candidateId: 'b', tmdbId: 2 }], {
    runtimeMappings: [{ id: 'existing', tmdbId: 1 }],
    runtimeFactsByLocalId: { existing: facts('unused', 1) },
  })
  const report = buildPromotionReadinessAudit(input)
  assert.deepEqual(report.identityReconciliation.alreadyInRuntime.map((item) => item.candidateId), ['a'])
  assert.deepEqual(report.identityReconciliation.newUniqueCandidates.map((item) => item.candidateId), ['b'])
  assert.ok(report.records[0].categories.includes('already-in-runtime'))
})

test('reports duplicate semantic TMDB identities and excludes them from unique candidates', () => {
  const report = buildPromotionReadinessAudit(makeInput([{ candidateId: 'a', tmdbId: 1 }, { candidateId: 'b', tmdbId: 1 }]))
  assert.equal(report.identityReconciliation.duplicateSemanticIdentities.length, 1)
  assert.equal(report.identityReconciliation.newUniqueCandidates.length, 0)
})

test('reports conflicting identity across semantic state and cohort', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }])
  input.semanticManifest.states.a.tmdbId = 9
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.identityReconciliation.identityConflicts.length, 1)
  assert.ok(report.records[0].categories.includes('identity-review'))
})

test('reports missing facts without manufacturing a factual record', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }])
  input.facts = []
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.readiness.factsReady, 0)
  assert.equal(report.readiness.factsRequireLaterTmdbAcquisition, 1)
  assert.deepEqual(report.identityReconciliation.semanticRecordsLackingUsableFactualRecord, [{ candidateId: 'a', tmdbId: 1 }])
})

test('reports a missing semantic field through the existing hard validator', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }])
  delete input.semanticArtifactsByCandidateId.a.classification.pace
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.readiness.completeSemantic, 0)
  assert.equal(report.missingRequirements.semanticInvalidOrMissing, 1)
})

test('fails closed when cohort source declarations are ambiguous', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }], {
    editorialByCandidateId: { a: editorial('a', 1) },
    palettesByCandidateId: { a: ['#123456', '#abcdef'] },
  })
  input.cohortManifest.totalCandidates = 2
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.semanticCheckpoint.verifiedCount, 0)
  assert.equal(report.readiness.promotionReadyNow, 0)
  assert.equal(report.pilotSelection.actualSize, 0)
  assert.ok(report.semanticCheckpoint.sourceAmbiguities.length > 0)
})

test('computes exact readiness counts', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }, { candidateId: 'b', tmdbId: 2 }], {
    editorialByCandidateId: { a: editorial('a', 1) },
    palettesByCandidateId: { a: ['#123456', '#abcdef'] },
  })
  const report = buildPromotionReadinessAudit(input)
  assert.deepEqual(report.readiness, {
    completeSemantic: 2,
    factsReady: 2,
    factsPartiallyAvailable: 0,
    factsRequireLaterTmdbAcquisition: 0,
    factsConflictingAcrossArtifacts: 0,
    editorialReady: 1,
    paletteReady: 1,
    humanDecisionReady: 0,
    promotionReadyNow: 0,
    blocked: 2,
  })
})

test('complete artifacts without human approval remain blocked', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }], {
    editorialByCandidateId: { a: editorial('a', 1) },
    palettesByCandidateId: { a: ['#123456', '#abcdef'] },
  })
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.records[0].humanDecisionReady, false)
  assert.equal(report.records[0].promotionReady, false)
  assert.equal(report.missingRequirements.humanDecisionMissing, 1)
})

test('complete artifacts with explicitly supplied validated human readiness are promotable', () => {
  const input = makeInput([{ candidateId: 'a', tmdbId: 1 }], {
    editorialByCandidateId: { a: editorial('a', 1) },
    palettesByCandidateId: { a: ['#123456', '#abcdef'] },
    humanDecisionReadinessByCandidateId: { a: true },
  })
  const report = buildPromotionReadinessAudit(input)
  assert.equal(report.records[0].humanDecisionReady, true)
  assert.equal(report.records[0].promotionReady, true)
})

test('orders records deterministically regardless of cohort input order', () => {
  const forward = buildPromotionReadinessAudit(makeInput([{ candidateId: 'b', tmdbId: 2 }, { candidateId: 'a', tmdbId: 1 }]))
  const reverse = buildPromotionReadinessAudit(makeInput([{ candidateId: 'a', tmdbId: 1 }, { candidateId: 'b', tmdbId: 2 }]))
  assert.deepEqual(forward.records.map((record) => record.candidateId), ['a', 'b'])
  assert.deepEqual(forward.records, reverse.records)
})

test('selects a deterministic structurally diverse pilot', () => {
  const records = [
    { candidateId: 'c', tmdbId: 3, semanticReady: true, factsReady: true, identityConflict: false, semantic: { moods: ['funny'], attentionDemand: 'easy', emotionalWeight: 'light', discoveryStyle: 'familiar' }, facts: { title: 'C', year: 2020, spokenLanguages: ['English'], genres: ['Comedy'], runtimeMinutes: 80 } },
    { candidateId: 'a', tmdbId: 1, semanticReady: true, factsReady: true, identityConflict: false, semantic: { moods: ['thoughtful'], attentionDemand: 'immersive', emotionalWeight: 'heavy', discoveryStyle: 'adventurous' }, facts: { title: 'A', year: 1950, spokenLanguages: ['Japanese'], genres: ['Drama'], runtimeMinutes: 130 } },
    { candidateId: 'b', tmdbId: 2, semanticReady: true, factsReady: true, identityConflict: false, semantic: { moods: ['exciting'], attentionDemand: 'engaged', emotionalWeight: 'moderate', discoveryStyle: 'different' }, facts: { title: 'B', year: 1980, spokenLanguages: ['French'], genres: ['Action'], runtimeMinutes: 100 } },
  ]
  assert.deepEqual(selectDeterministicPilot(records, 3), selectDeterministicPilot([...records].reverse(), 3))
  assert.deepEqual(selectDeterministicPilot(records, 3).map((record) => record.candidateId), ['a', 'b', 'c'])
})
