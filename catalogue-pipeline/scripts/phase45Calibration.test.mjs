import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { checkEditorialVoice, detectBatchStructuralPatterns } from './checkEditorialVoice.mjs'
import {
  getCardinalityFlags,
  shouldRequestIndependentReclassification,
  validateCriticOutput,
  validateEditorialOutput,
  validateSemanticOutput,
} from './validateBatch.mjs'

const taxonomy = JSON.parse(fs.readFileSync(new URL('../config/taxonomyVersion.json', import.meta.url), 'utf8'))
const taxonomyGuide = fs.readFileSync(new URL('../calibration/taxonomy-guide.md', import.meta.url), 'utf8')

function evidenceItem(rationale = 'The TMDB overview provides a concrete observable classification signal.') {
  return { rationale, sourceRefs: ['tmdb-overview'] }
}

function validSemantic(overrides = {}) {
  return {
    schemaVersion: 'semantic-output.v1',
    promptVersion: 'semantic-classifier.v1',
    taxonomyVersion: 'taxonomy.v2',
    movie: { candidateId: 'pilot-001', tmdbId: 123 },
    classification: {
      moods: ['relaxing'], situations: ['family'], filterLanguages: ['Japanese'], pace: 'medium', emotionalWeight: 'light', attentionDemand: 'easy', discoveryStyle: 'different',
    },
    evidence: {
      moods: { relaxing: evidenceItem() },
      situations: { family: evidenceItem() },
      pace: evidenceItem(), emotionalWeight: evidenceItem(), attentionDemand: evidenceItem(), discoveryStyle: evidenceItem(),
    },
    boundaryFlags: [],
    selfConfidence: { moods: 0.7 },
    ...overrides,
  }
}

describe('Phase 4.5 calibration and evidence hardening', () => {
  it('requires taxonomy definitions and a matching version', () => {
    expect(taxonomy.taxonomyVersion).toBe('taxonomy.v2')
    for (const value of [...taxonomy.moods, ...taxonomy.situations, ...taxonomy.pace, ...taxonomy.emotionalWeight, ...taxonomy.attentionDemand, ...taxonomy.discoveryStyle]) expect(taxonomyGuide).toContain(value)
    expect(taxonomyGuide).toContain('No cross-axis combination is invalid merely because it is unusual')
  })

  it('flags unusual and human-approved cardinality without imposing maxItems two', () => {
    expect(getCardinalityFlags({ moods: ['funny', 'thoughtful', 'emotional'], situations: ['alone', 'date-night', 'friends', 'easy-watch'] })).toHaveLength(2)
    expect(getCardinalityFlags({ moods: ['funny', 'thoughtful', 'emotional', 'relaxing'], situations: ['alone'] })[0].code).toBe('MOOD_CARDINALITY_UNUSUAL')
  })

  it('requires meaningful evidence for every selected mood and situation', () => {
    const result = validateSemanticOutput(validSemantic({ evidence: { ...validSemantic().evidence, moods: {} } }))
    expect(result.ok).toBe(false)
    expect(result.hardFailures.some((issue) => issue.code === 'INVALID_SEMANTIC_EVIDENCE')).toBe(true)
  })

  it('rejects malformed or empty semantic evidence and boundary flags', () => {
    const result = validateSemanticOutput(validSemantic({ evidence: {}, boundaryFlags: [{}] }))
    expect(result.ok).toBe(false)
    expect(result.hardFailures.some((issue) => issue.code === 'INVALID_SEMANTIC_EVIDENCE')).toBe(true)
    expect(result.hardFailures.some((issue) => issue.code === 'MISSING_REQUIRED_FIELD' || issue.code === 'INVALID_BOUNDARY_FLAG')).toBe(true)
  })

  it('builds a stable, auditable evidence packet from factual source material only', () => {
    const input = { candidateId: 'pilot-001', facts: { tmdbId: 123, title: 'Example', year: 2001, director: 'Director', genres: ['Drama'], runtimeMinutes: 100, countries: ['Japan'], spokenLanguages: ['Japanese'], factsHash: 'sha256:facts' }, tmdbOverview: 'A person begins a small journey that changes an ordinary routine.', keywordAssessment: { useful: true, selected: ['routine'] } }
    const first = buildEvidencePacket(input)
    const second = buildEvidencePacket({ ...input, keywordAssessment: { useful: true, selected: ['routine'] } })
    expect(first.packet.inputHash).toBe(second.packet.inputHash)
    expect(first.packet.sourceProvenance.map((source) => source.source)).toEqual(['tmdb-facts', 'tmdb-overview', 'tmdb-keywords'])
  })

  it('flags absent grounding rather than inventing model-memory support', () => {
    const { reviewFlags } = buildEvidencePacket({ candidateId: 'pilot-001', facts: { tmdbId: 123, title: 'Example', year: 2001, director: 'Director', genres: ['Drama'], runtimeMinutes: 100, countries: ['Japan'], spokenLanguages: ['Japanese'] } })
    expect(reviewFlags[0].code).toBe('INSUFFICIENT_GROUNDING')
  })

  it('flags description and hook duplication, cliches, and obvious spoiler patterns for review', () => {
    const copy = { description: 'A detective enters a house to solve a mystery with a family.', curiosityHook: 'A detective enters a house to solve a mystery with a family.', whyWatch: 'A tour de force that keeps you on the edge of your seat.', vibeSummary: 'The ending reveals a quiet surprise.' }
    const flags = checkEditorialVoice(copy)
    expect(flags.map((flag) => flag.code)).toEqual(expect.arrayContaining(['DESCRIPTION_HOOK_DUPLICATION', 'GENERIC_LANGUAGE_REVIEW', 'SPOILER_PATTERN_REVIEW']))
  })

  it('treats model/meta language as hard-invalid while a cliche remains reviewable', () => {
    const output = validateEditorialOutput({ schemaVersion: 'editorial-output.v1', promptVersion: 'writer.v1', voiceGuideVersion: 'voice.v2', movie: { candidateId: 'pilot-001', tmdbId: 123 }, copy: { description: 'As an AI, I cannot provide a reliable description of this movie for tonight.', whyWatch: 'A tour de force with enough specific texture to support an informed decision tonight.', curiosityHook: 'A focused premise opens into a sharp question about the life already in motion.', vibeSummary: 'Focused and textured, with an engaged viewing cost and a clear identity.' }, writerNotes: { spoilerBoundary: { allowedMaterial: ['premise'], excludedMaterial: ['ending'], sourceRefs: ['tmdb-overview'] } } })
    expect(output.hardFailures.some((issue) => issue.code === 'MODEL_OR_META_LANGUAGE')).toBe(true)
    expect(output.reviewFlags.some((issue) => issue.code === 'GENERIC_LANGUAGE_REVIEW')).toBe(true)
  })

  it('detects corpus-level adjective-triad repetition', () => {
    const flags = detectBatchStructuralPatterns([{ candidateId: 'a', copy: { vibeSummary: 'Bright, warm, and playful for a relaxed night.' } }, { candidateId: 'b', copy: { vibeSummary: 'Sharp, fast, and stylish for an engaged night.' } }, { candidateId: 'c', copy: { vibeSummary: 'Quiet, tender, and reflective for a private night.' } }])
    expect(flags[0].code).toBe('BATCH_TRIAD_SYNTAX_REPETITION')
  })

  it('requires the full structured critic rubric and supports targeted independent reclassification', () => {
    const invalidCritic = validateCriticOutput({ schemaVersion: 'critic-output.v1', promptVersion: 'critic.v1', voiceGuideVersion: 'voice.v2', movie: { candidateId: 'pilot-001', tmdbId: 123 }, verdict: 'needs_review', issues: [], copyAssessment: { taxonomyAlignment: 'pass' } })
    expect(invalidCritic.ok).toBe(false)
    expect(shouldRequestIndependentReclassification({ isGoldSubset: true })).toBe(true)
    expect(shouldRequestIndependentReclassification({ classifierCriticDisagreement: true })).toBe(true)
    expect(shouldRequestIndependentReclassification()).toBe(false)
  })
})
