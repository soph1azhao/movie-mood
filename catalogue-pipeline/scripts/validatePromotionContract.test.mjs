import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assemblePromotionTransaction,
  buildPromotionManifest,
  getActualReviewHashes,
  hashArtifact,
  hashBytes,
  hashReviewedProductionBytes,
  stableSerialize,
  serializeArtifactForPersistence,
  validateApprovalFreshness,
  validateCriticArtifact,
  validateCrossArtifactIdentity,
  validateEditorialArtifact,
  validateHumanReviewDecision,
  validatePaletteArtifact,
  validateProductionRecord,
  validateProductionValidationReport,
  validatePromotionManifest,
  validatePromotionTransaction,
} from './validatePromotionContract.mjs'

function grounding(label) {
  return {
    rationale: `${label} has a specific factual rationale.`,
    sourceRefs: ['tmdb-facts'],
    grounding: { mode: 'direct', cues: [{ sourceRef: 'tmdb-facts', cue: `${label} factual cue` }] },
  }
}

function semantic(candidateId, tmdbId) {
  const classification = {
    moods: ['thoughtful', 'emotional'],
    situations: ['alone', 'date-night'],
    filterLanguages: ['English'],
    pace: 'medium',
    emotionalWeight: 'moderate',
    attentionDemand: 'engaged',
    discoveryStyle: 'different',
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

function editorial(candidateId, tmdbId) {
  return {
    schemaVersion: 'editorial-output.v1',
    promptVersion: 'editorial-writer.v1',
    voiceGuideVersion: 'voice-guide.v1',
    movie: { candidateId, tmdbId },
    copy: {
      description: 'A careful observer follows two strangers through a changing city as an uncertain evening reveals what each has avoided.',
      whyWatch: 'Choose it for precise character work and vivid atmosphere, with emotional tension grounded in small decisions.',
      curiosityHook: 'A chance encounter turns an ordinary evening into a revealing test of what each person wants.',
      vibeSummary: 'Reflective and intimate, with measured momentum beneath its quiet emotional surface.',
    },
    writerNotes: { spoilerBoundary: { allowedMaterial: ['Opening setup'], excludedMaterial: ['Resolution'], sourceRefs: ['tmdb-overview'] } },
  }
}

function critic(candidateId, tmdbId, verdict = 'approve_for_review') {
  return {
    schemaVersion: 'critic-output.v1',
    promptVersion: 'critic.v1',
    voiceGuideVersion: 'voice-guide.v1',
    movie: { candidateId, tmdbId },
    verdict,
    issues: [],
    copyAssessment: {
      taxonomyAlignment: 'pass',
      voiceConsistency: 'pass',
      specificity: 'pass',
      descriptionHookDifferentiation: 'pass',
      genericLanguageRisk: 'pass',
      syntacticRepetitionRisk: 'pass',
      setupOnlySpoilerCompliance: 'pass',
      synopsisDrift: 'pass',
      distinctiveness: 'pass',
      layoutFit: 'pass',
    },
  }
}

function makeFixture({ candidateId = 'candidate-1', tmdbId = 101, id = 'film-101', criticVerdict = 'approve_for_review', decision = 'approve' } = {}) {
  const semanticArtifact = semantic(candidateId, tmdbId)
  const evidencePacket = { schemaVersion: 'evidence-packet.v1', candidateId, tmdbId, facts: { title: 'Synthetic Film', year: 2001 } }
  const factsRecord = {
    candidateId,
    tmdbId,
    title: 'Synthetic Film',
    year: 2001,
    director: 'Example Director',
    countries: ['Canada'],
    spokenLanguages: ['English'],
    genres: ['Drama'],
    runtimeMinutes: 102,
    posterPath: '/synthetic.jpg',
  }
  const editorialOutput = editorial(candidateId, tmdbId)
  const editorialArtifact = {
    schemaVersion: 'editorial-artifact.v1',
    candidateId,
    tmdbId,
    output: editorialOutput,
    sourceHashes: {
      semanticArtifact: hashArtifact(semanticArtifact),
      evidencePacket: hashArtifact(evidencePacket),
      factsRecord: hashArtifact(factsRecord),
    },
  }
  const criticOutput = critic(candidateId, tmdbId, criticVerdict)
  const criticArtifact = {
    schemaVersion: 'critic-artifact.v1',
    candidateId,
    tmdbId,
    output: criticOutput,
    sourceHashes: {
      semanticArtifact: hashArtifact(semanticArtifact),
      evidencePacket: hashArtifact(evidencePacket),
      factsRecord: hashArtifact(factsRecord),
      editorialArtifact: hashArtifact(editorialArtifact),
    },
    independence: { writerHiddenReasoningProvided: false },
  }
  const paletteArtifact = {
    schemaVersion: 'palette-artifact.v1',
    candidateId,
    tmdbId,
    palette: ['#123456', '#abcdef'],
    method: 'poster-algorithm',
    sourcePosterIdentity: { posterPath: factsRecord.posterPath },
    sourcePosterHash: hashArtifact('synthetic-poster-bytes'),
    algorithmVersion: 'palette-algorithm.v1',
    override: null,
  }
  const promotionCandidate = {
    schemaVersion: 'promotion-candidate.v1',
    candidateId,
    tmdbId,
    cohortId: 'synthetic-cohort',
    candidateCohortHash: hashArtifact(['candidate-1']),
    sourceHashes: {
      semanticArtifact: hashArtifact(semanticArtifact),
      evidencePacket: hashArtifact(evidencePacket),
      factsRecord: hashArtifact(factsRecord),
    },
  }
  const record = {
    schemaVersion: 'production-record.v1',
    candidateId,
    tmdbId,
    curatedMovie: {
      id,
      tmdbId,
      ...semanticArtifact.classification,
      ...editorialArtifact.output.copy,
      palette: paletteArtifact.palette,
    },
    facts: {
      tmdbId,
      title: factsRecord.title,
      year: factsRecord.year,
      director: factsRecord.director,
      countries: factsRecord.countries,
      spokenLanguages: factsRecord.spokenLanguages,
      genres: factsRecord.genres,
      runtimeMinutes: factsRecord.runtimeMinutes,
      posterPath: factsRecord.posterPath,
    },
    provenance: {
      promotionCandidateHash: hashArtifact(promotionCandidate),
      semanticArtifactHash: hashArtifact(semanticArtifact),
      evidencePacketHash: hashArtifact(evidencePacket),
      factsRecordHash: hashArtifact(factsRecord),
      editorialArtifactHash: hashArtifact(editorialArtifact),
      criticArtifactHash: hashArtifact(criticArtifact),
      paletteArtifactHash: hashArtifact(paletteArtifact),
      humanReviewDecisionHash: hashArtifact(null),
    },
  }
  const artifacts = { promotionCandidate, semanticArtifact, evidencePacket, factsRecord, editorialArtifact, criticArtifact, paletteArtifact }
  const sourceHashes = getActualReviewHashes(record, artifacts)
  const humanReviewDecision = {
    schemaVersion: 'human-review.v1',
    candidateId,
    tmdbId,
    decision,
    reviewer: 'Solo Maintainer',
    reviewedAt: '2026-09-14T12:00:00.000Z',
    sourceHashes,
    notes: null,
    revisions: {},
  }
  artifacts.humanReviewDecision = humanReviewDecision
  record.provenance.humanReviewDecisionHash = hashArtifact(humanReviewDecision)
  return { record, artifacts }
}

function baseline() {
  return {
    commit: 'abcdef1234567890',
    sourceHashes: { curatedMovies: hashArtifact('curated'), tmdbMovieMappings: hashArtifact('mappings'), tmdbMovies: hashArtifact('facts') },
    records: [{ id: 'existing-film', tmdbId: 999, recordHash: hashArtifact('existing') }],
  }
}

function proposedSourceHashes() {
  return { curatedMovies: hashArtifact('proposed-curated'), tmdbMovieMappings: hashArtifact('proposed-mappings'), tmdbMovies: hashArtifact('proposed-facts') }
}

function assembleTransaction(input) {
  return assemblePromotionTransaction({ proposedSourceHashes: proposedSourceHashes(), ...input })
}

test('validates a complete synthetic production record and dry-run transaction', () => {
  const fixture = makeFixture()
  assert.equal(validateProductionRecord(fixture.record, fixture.artifacts).ok, true)
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [fixture] })
  assert.equal(transaction.validationResult.ok, true)
  assert.equal(validatePromotionTransaction(transaction).ok, true)
  assert.equal(transaction.beforeCount, 1)
  assert.equal(transaction.afterCount, 2)
})

test('missing human approval blocks production', () => {
  const fixture = makeFixture()
  delete fixture.artifacts.humanReviewDecision
  const validation = validateProductionRecord(fixture.record, fixture.artifacts)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'MISSING_BOUND_ARTIFACT'))
})

for (const decision of ['reject', 'revise']) {
  test(`${decision} human decision cannot authorize promotion`, () => {
    const fixture = makeFixture({ decision })
    const validation = validateProductionRecord(fixture.record, fixture.artifacts)
    assert.equal(validation.ok, false)
    assert.ok(validation.hardFailures.some((failure) => failure.code === 'HUMAN_APPROVAL_REQUIRED'))
  })
}

for (const [name, mutate] of [
  ['editorial', (fixture) => { fixture.artifacts.editorialArtifact.output.copy.description += ' Changed.' }],
  ['critic', (fixture) => { fixture.artifacts.criticArtifact.output.issues.push({ code: 'NEW' }) }],
  ['palette', (fixture) => { fixture.artifacts.paletteArtifact.palette[0] = '#654321' }],
]) {
  test(`approval becomes stale after ${name} changes`, () => {
    const fixture = makeFixture()
    mutate(fixture)
    const validation = validateApprovalFreshness(fixture.artifacts.humanReviewDecision, getActualReviewHashes(fixture.record, fixture.artifacts))
    assert.equal(validation.ok, false)
    assert.ok(validation.hardFailures.some((failure) => failure.code === 'STALE_APPROVAL'))
  })
}

for (const [name, mutate] of [
  ['semantic', (fixture) => { fixture.artifacts.semanticArtifact.movie.tmdbId += 1 }],
  ['editorial', (fixture) => { fixture.artifacts.editorialArtifact.output.movie.candidateId = 'wrong' }],
  ['critic', (fixture) => { fixture.artifacts.criticArtifact.output.movie.tmdbId += 1 }],
  ['facts', (fixture) => { fixture.artifacts.factsRecord.tmdbId += 1 }],
]) {
  test(`${name} identity mismatch fails closed`, () => {
    const fixture = makeFixture()
    mutate(fixture)
    const validation = validateCrossArtifactIdentity({ ...fixture.artifacts, productionRecord: fixture.record })
    assert.equal(validation.ok, false)
    assert.ok(validation.hardFailures.some((failure) => failure.code === 'CROSS_ARTIFACT_IDENTITY_MISMATCH'))
  })
}

test('invalid palette fails closed', () => {
  const fixture = makeFixture()
  fixture.artifacts.paletteArtifact.palette = ['red']
  assert.equal(validatePaletteArtifact(fixture.artifacts.paletteArtifact).ok, false)
  assert.equal(validateProductionRecord(fixture.record, fixture.artifacts).ok, false)
})

test('missing complete production field fails closed', () => {
  const fixture = makeFixture()
  delete fixture.record.curatedMovie.description
  const validation = validateProductionRecord(fixture.record, fixture.artifacts)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code.includes('MISSING_REQUIRED_FIELD')))
})

test('duplicate TMDB identity fails the transaction', () => {
  const first = makeFixture({ candidateId: 'a', tmdbId: 1, id: 'film-a' })
  const second = makeFixture({ candidateId: 'b', tmdbId: 1, id: 'film-b' })
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [first, second] })
  assert.equal(transaction.validationResult.ok, false)
  assert.ok(transaction.validationResult.hardFailures.some((failure) => failure.code === 'TMDB_ID_COLLISION'))
})

test('critic candidate_for_auto_accept still requires explicit human approval', () => {
  const fixture = makeFixture({ criticVerdict: 'candidate_for_auto_accept' })
  delete fixture.artifacts.humanReviewDecision
  const validation = validateProductionRecord(fixture.record, fixture.artifacts)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'MISSING_BOUND_ARTIFACT'))
})

test('canonical serialization is deterministic across object key order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } }
  const right = { a: { c: 3, d: 4 }, b: 2 }
  assert.equal(stableSerialize(left), stableSerialize(right))
  assert.equal(hashArtifact(left), hashArtifact(right))
})

test('manifest count derives from accepted records rather than a declared target', () => {
  const fixture = makeFixture()
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [fixture] })
  const manifest = buildPromotionManifest({
    transaction,
    candidateCohortHash: hashArtifact('cohort'),
    candidateRoster: [{ candidateId: fixture.record.candidateId, tmdbId: fixture.record.tmdbId }],
    validationReportHash: hashArtifact('validation'),
    benchmarkReportHashes: [],
    createdAt: '2026-09-14T12:00:00.000Z',
  })
  assert.equal(manifest.outputRuntimeCount, 2)
  assert.equal(validatePromotionManifest(manifest).ok, true)
  manifest.outputRuntimeCount = 400
  manifest.declaredTargetCount = 400
  const validation = validatePromotionManifest(manifest)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'INVALID_OUTPUT_COUNT'))
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'PLANNING_TARGET_NOT_AUTHORITATIVE'))
})

test('existing runtime identities and hashes remain byte-for-byte preserved', () => {
  const fixture = makeFixture()
  const originalBaseline = baseline()
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: originalBaseline, candidates: [fixture] })
  assert.deepEqual(transaction.proposedRuntime[0], originalBaseline.records[0])
  assert.equal(transaction.identityReconciliation.existingRuntimeIdsPreserved, true)
})

test('local ID collision fails closed', () => {
  const fixture = makeFixture({ id: 'existing-film' })
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [fixture] })
  assert.equal(transaction.validationResult.ok, false)
  assert.ok(transaction.validationResult.hardFailures.some((failure) => failure.code === 'LOCAL_ID_COLLISION'))
})

test('approval binds the reviewed record bytes without a circular decision hash', () => {
  const fixture = makeFixture()
  assert.equal(fixture.artifacts.humanReviewDecision.sourceHashes.completeRecord, hashReviewedProductionBytes(fixture.record))
  assert.equal(validateHumanReviewDecision(fixture.artifacts.humanReviewDecision).ok, true)
})

test('editorial artifact is bound to exact semantic, evidence, and facts inputs', () => {
  const fixture = makeFixture()
  assert.equal(validateEditorialArtifact(fixture.artifacts.editorialArtifact, fixture.artifacts).ok, true)
  fixture.artifacts.evidencePacket.facts.year = 2002
  const validation = validateEditorialArtifact(fixture.artifacts.editorialArtifact, fixture.artifacts)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'EDITORIAL_SOURCE_HASH_MISMATCH'))
})

test('critic artifact enforces exact editorial binding and hidden-reasoning independence', () => {
  const fixture = makeFixture()
  assert.equal(validateCriticArtifact(fixture.artifacts.criticArtifact, fixture.artifacts).ok, true)
  fixture.artifacts.criticArtifact.independence.writerHiddenReasoningProvided = true
  const validation = validateCriticArtifact(fixture.artifacts.criticArtifact, fixture.artifacts)
  assert.equal(validation.ok, false)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'CRITIC_INDEPENDENCE_VIOLATION'))
})

test('production validation report summary derives from checks and failures', () => {
  const report = {
    schemaVersion: 'production-validation-report.v1',
    promotionVersion: 'v8.2-test',
    transactionHash: hashArtifact('transaction'),
    generatedAt: '2026-09-14T12:00:00.000Z',
    checks: [{ name: 'identity', ok: true }, { name: 'completeness', ok: true }],
    ok: true,
    hardFailures: [],
  }
  assert.equal(validateProductionValidationReport(report).ok, true)
  report.checks[1].ok = false
  assert.equal(validateProductionValidationReport(report).ok, false)
})

function completeRosterManifest() {
  const acceptedFixture = makeFixture({ candidateId: 'a', tmdbId: 1, id: 'film-a' })
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [acceptedFixture] })
  return buildPromotionManifest({
    transaction,
    candidateCohortHash: hashArtifact('cohort'),
    candidateRoster: [{ candidateId: 'a', tmdbId: 1 }, { candidateId: 'b', tmdbId: 2 }, { candidateId: 'c', tmdbId: 3 }],
    rejected: [{ candidateId: 'b', tmdbId: 2, reason: 'Synthetic rejection' }],
    deferred: [{ candidateId: 'c', tmdbId: 3, reason: 'Synthetic deferral' }],
    validationReportHash: hashArtifact('validation'),
    benchmarkReportHashes: [],
    createdAt: '2026-09-14T12:00:00.000Z',
  })
}

test('exact complete candidate roster and disjoint dispositions pass', () => {
  const manifest = completeRosterManifest()
  assert.equal(validatePromotionManifest(manifest, { candidateCohortHash: manifest.candidateCohortHash, candidateRoster: manifest.candidateRoster }).ok, true)
})

test('omitted roster candidate fails manifest validation', () => {
  const manifest = completeRosterManifest()
  manifest.deferred = []
  const validation = validatePromotionManifest(manifest)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'CANDIDATE_DISPOSITION_MISSING'))
})

test('candidate in accepted and rejected fails manifest validation', () => {
  const manifest = completeRosterManifest()
  manifest.rejected.push({ candidateId: 'a', tmdbId: 1, reason: 'Conflicting disposition' })
  const validation = validatePromotionManifest(manifest)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'DUPLICATE_OR_OVERLAPPING_DISPOSITION'))
})

test('duplicate accepted candidate fails manifest validation', () => {
  const manifest = completeRosterManifest()
  manifest.accepted.push({ ...manifest.accepted[0] })
  manifest.outputRuntimeCount += 1
  const validation = validatePromotionManifest(manifest)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'DUPLICATE_OR_OVERLAPPING_DISPOSITION'))
})

test('wrong disposition TMDB identity fails manifest validation', () => {
  const manifest = completeRosterManifest()
  manifest.deferred[0].tmdbId = 30
  const validation = validatePromotionManifest(manifest)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'DISPOSITION_TMDB_ID_MISMATCH'))
})

test('duplicate candidate ID fails assembly and transaction validation', () => {
  const first = makeFixture({ candidateId: 'same', tmdbId: 1, id: 'film-a' })
  const second = makeFixture({ candidateId: 'same', tmdbId: 2, id: 'film-b' })
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [first, second] })
  assert.ok(transaction.validationResult.hardFailures.some((failure) => failure.code === 'CANDIDATE_ID_COLLISION'))
  transaction.validationResult = { ok: true, hardFailures: [] }
  assert.ok(validatePromotionTransaction(transaction).hardFailures.some((failure) => failure.code === 'DUPLICATE_CANDIDATE_ID'))
})

test('transaction and manifest require all three stable runtime source hashes', () => {
  const fixture = makeFixture()
  const transaction = assembleTransaction({ promotionVersion: 'v8.2-test', baseline: baseline(), candidates: [fixture] })
  delete transaction.baseline.sourceHashes.tmdbMovies
  assert.equal(validatePromotionTransaction(transaction).ok, false)
  const manifest = completeRosterManifest()
  delete manifest.outputHashes.tmdbMovieMappings
  assert.equal(validatePromotionManifest(manifest).ok, false)
})

test('critic approve_for_review rejects any failing assessment', () => {
  const fixture = makeFixture()
  fixture.artifacts.criticArtifact.output.copyAssessment.layoutFit = 'fail'
  const validation = validateCriticArtifact(fixture.artifacts.criticArtifact, fixture.artifacts)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'CRITIC_VERDICT_ASSESSMENT_CONTRADICTION'))
})

test('critic candidate_for_auto_accept requires all-pass assessments and no issues', () => {
  const reviewFixture = makeFixture({ criticVerdict: 'candidate_for_auto_accept' })
  reviewFixture.artifacts.criticArtifact.output.copyAssessment.layoutFit = 'review'
  assert.ok(validateCriticArtifact(reviewFixture.artifacts.criticArtifact, reviewFixture.artifacts).hardFailures.some((failure) => failure.code === 'CRITIC_AUTO_ACCEPT_REQUIRES_ALL_PASS'))

  const issueFixture = makeFixture({ criticVerdict: 'candidate_for_auto_accept' })
  issueFixture.artifacts.criticArtifact.output.issues.push({ code: 'VISIBLE_ISSUE' })
  assert.ok(validateCriticArtifact(issueFixture.artifacts.criticArtifact, issueFixture.artifacts).hardFailures.some((failure) => failure.code === 'CRITIC_AUTO_ACCEPT_REQUIRES_NO_ISSUES'))

  const validFixture = makeFixture({ criticVerdict: 'candidate_for_auto_accept' })
  assert.equal(validateProductionRecord(validFixture.record, validFixture.artifacts).ok, true)
})

test('canonical persistence bytes are stable JSON with exactly one terminal newline', () => {
  const left = { b: 2, a: { d: 4, c: 3 } }
  const right = { a: { c: 3, d: 4 }, b: 2 }
  const bytes = serializeArtifactForPersistence(left)
  assert.equal(bytes, serializeArtifactForPersistence(right))
  assert.doesNotThrow(() => JSON.parse(bytes))
  assert.equal(bytes.endsWith('\n'), true)
  assert.equal(bytes.endsWith('\n\n'), false)
  assert.equal(hashArtifact(left), hashBytes(bytes))
})

test('historical raw-byte hashing remains whitespace-sensitive and distinct from recanonicalization', () => {
  const compact = '{"a":1}\n'
  const historical = '{ "a": 1 }\n'
  assert.notEqual(hashBytes(compact), hashBytes(historical))
  assert.equal(hashArtifact(JSON.parse(compact)), hashArtifact(JSON.parse(historical)))
  assert.notEqual(hashArtifact(JSON.parse(historical)), hashBytes(historical))
})

test('poster-algorithm palette requires non-null poster identity and source-byte hash', () => {
  const fixture = makeFixture()
  fixture.artifacts.paletteArtifact.sourcePosterIdentity.posterPath = null
  fixture.artifacts.paletteArtifact.sourcePosterHash = null
  const validation = validatePaletteArtifact(fixture.artifacts.paletteArtifact)
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'MISSING_POSTER_PATH'))
  assert.ok(validation.hardFailures.some((failure) => failure.code === 'MISSING_POSTER_HASH'))
})
