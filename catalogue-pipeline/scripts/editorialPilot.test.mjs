import assert from 'node:assert/strict'
import test from 'node:test'

import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import {
  FIXED_PILOT,
  buildCriticInputPacket,
  buildWriterInputPacket,
  countPosterReadiness,
  createCriticResumeKey,
  createPilotResumeKey,
  runEditorialPilotCommand,
  verifyFixedPilot,
} from './editorialPilot.mjs'

const expectedCandidateIds = [
  'scale500-tmdb-14283', 'scale500-tmdb-347201', 'scale500-tmdb-25237', 'exp100-tmdb-21316',
  'scale500-tmdb-2061', 'scale500-tmdb-535167', 'exp100-tmdb-144', 'exp100-tmdb-2023',
  'scale500-tmdb-10389', 'scale500-tmdb-11314', 'scale500-tmdb-11416', 'scale500-tmdb-13752',
  'scale500-tmdb-15764', 'scale500-tmdb-256040', 'scale500-tmdb-30017', 'scale500-tmdb-477018',
]

function inputs() {
  const pilotEntry = { candidateId: 'candidate-1', tmdbId: 101, title: 'Synthetic Film' }
  const factsRecord = { ...pilotEntry, year: 2001, director: 'A Director', countries: ['CA'], spokenLanguages: ['English'], genres: ['Drama'], runtimeMinutes: 100, posterPath: '/poster.jpg', overview: 'A grounded setup.', keywords: ['journey'] }
  const semanticArtifact = { movie: { candidateId: 'candidate-1', tmdbId: 101 }, classification: { moods: ['thoughtful'], pace: 'medium' }, evidence: { moods: { thoughtful: { sourceRefs: ['facts'], rationale: 'Grounded.' } } }, boundaryFlags: [] }
  const evidencePacket = { candidateId: 'candidate-1', tmdbId: 101, facts: { overview: 'A grounded setup.', keywords: ['journey'] }, sourceProvenance: [{ source: 'tmdb-facts' }] }
  const sourceBindings = {
    semanticArtifact: { historicalSourceHash: 'sha256:a', historicalRawByteHash: 'sha256:b', v8_2ArtifactHash: 'sha256:c' },
    evidencePacket: { historicalSourceHash: 'sha256:d', historicalRawByteHash: 'sha256:e', v8_2ArtifactHash: 'sha256:f' },
    factsRecord: { historicalSourceHash: 'sha256:g', v8_2ArtifactHash: 'sha256:h' },
  }
  return { pilotEntry, factsRecord, semanticArtifact, evidencePacket, sourceBindings, voiceGuideBinding: { historicalSourceHash: 'sha256:i' } }
}

test('fixed pilot exactly matches the Phase 0 16-film identity and order', () => {
  assert.equal(FIXED_PILOT.length, 16)
  assert.deepEqual(FIXED_PILOT.map((entry) => entry.candidateId), expectedCandidateIds)
  assert.equal(verifyFixedPilot(FIXED_PILOT), true)
  assert.throws(() => verifyFixedPilot(FIXED_PILOT.slice(1)))
})

test('writer packet preserves identity, exact source bindings, and canonical determinism', () => {
  const packet = buildWriterInputPacket(inputs())
  assert.equal(packet.candidateId, 'candidate-1')
  assert.equal(packet.tmdbId, 101)
  assert.deepEqual(packet.sourceBindings, inputs().sourceBindings)
  assert.deepEqual(serializeArtifactForPersistence(packet), serializeArtifactForPersistence(buildWriterInputPacket(inputs())))
  assert.equal(hashArtifact(packet), hashArtifact(buildWriterInputPacket(inputs())))
  assert.throws(() => buildWriterInputPacket({ ...inputs(), pilotEntry: { candidateId: 'wrong', tmdbId: 101 } }))
})

test('critic packet preserves identity and excludes writer notes or hidden reasoning', () => {
  const writerPacket = buildWriterInputPacket(inputs())
  const editorialOutput = { movie: { candidateId: 'candidate-1', tmdbId: 101 }, copy: { description: 'd', whyWatch: 'w', curiosityHook: 'c', vibeSummary: 'v' }, writerNotes: { spoilerBoundary: { allowedMaterial: ['setup'], excludedMaterial: ['ending'], sourceRefs: ['facts'] }, hiddenReasoning: 'never forward' }, chainOfThought: 'never forward' }
  const criticPacket = buildCriticInputPacket({ writerPacket, editorialOutput, reviewFlags: ['voice'] })
  assert.equal(criticPacket.candidateId, 'candidate-1')
  assert.equal(criticPacket.tmdbId, 101)
  assert.equal(JSON.stringify(criticPacket).includes('writerNotes'), false)
  assert.equal(JSON.stringify(criticPacket).includes('hiddenReasoning'), false)
  assert.equal(JSON.stringify(criticPacket).includes('chainOfThought'), false)
  assert.throws(() => buildCriticInputPacket({ writerPacket, editorialOutput: { ...editorialOutput, movie: { candidateId: 'other', tmdbId: 101 } } }))
  assert.throws(() => buildCriticInputPacket({ writerPacket, editorialOutput, hardValidation: [{ code: 'LENGTH' }] }), /blocked by writer hard validation/)
})

test('critic resume identity is unavailable before the critic packet and changes with editorial copy', () => {
  const base = { candidateId: 'candidate-1', tmdbId: 101, criticPacketHash: 'sha256:a', editorialArtifactHash: 'sha256:b', promptHash: 'sha256:c', schemaHash: 'sha256:d', thinkingLevel: 'medium', maxOutputTokens: 12288 }
  assert.equal(createCriticResumeKey(base), createCriticResumeKey({ ...base }))
  assert.notEqual(createCriticResumeKey(base), createCriticResumeKey({ ...base, editorialArtifactHash: 'sha256:changed-by-one-copy-character' }))
})

test('resume keys are deterministic and sensitive to execution inputs', () => {
  const input = { stage: 'editorial-writer', candidateId: 'candidate-1', tmdbId: 101, packetHash: 'sha256:a', promptHash: 'sha256:b', schemaHash: 'sha256:c', thinkingLevel: 'low', maxOutputTokens: 4096 }
  assert.equal(createPilotResumeKey(input), createPilotResumeKey({ ...input }))
  assert.notEqual(createPilotResumeKey(input), createPilotResumeKey({ ...input, thinkingLevel: 'medium' }))
})

test('poster readiness counts non-null and null paths without inventing a fallback', () => {
  assert.deepEqual(countPosterReadiness([
    { candidateId: 'a', tmdbId: 1, title: 'A', posterPath: '/a.jpg' },
    { candidateId: 'b', tmdbId: 2, title: 'B', posterPath: null },
  ]), { total: 2, nonNullCount: 1, nullCount: 1, nullCandidates: [{ candidateId: 'b', tmdbId: 2, title: 'B' }] })
})

test('prepare, inspect, and estimate dispatch without network access; run is unavailable', async () => {
  let fetchCalls = 0
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('network forbidden') }
  try {
    const operations = {
      prepare: async () => ({ command: 'prepare', externalCalls: 0 }),
      inspect: async () => ({ command: 'inspect', externalCalls: 0 }),
      estimate: async () => ({ command: 'estimate', externalCalls: 0 }),
    }
    for (const command of ['prepare', 'inspect', 'estimate']) assert.equal((await runEditorialPilotCommand(command, {}, operations)).externalCalls, 0)
    await assert.rejects(runEditorialPilotCommand('run', {}, operations), /Live dispatch requires --execute/)
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})
