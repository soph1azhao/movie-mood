import { describe, expect, it } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import artifactSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import { buildSemanticResponseJsonSchema } from './geminiProvider.ts'
import { validateSemanticOutput } from '../scripts/validateBatch.mjs'

describe('semantic-output.v2 mechanical provider schema', () => {
  const schema = buildSemanticResponseJsonSchema([], 'semantic-output.v2')

  it('matches every required model-owned top-level and classification field', () => {
    const modelOwnedTopLevel = artifactSchema.required.filter((field) => ['classification', 'evidence', 'boundaryFlags', 'selfConfidence'].includes(field))
    expect(schema.required).toEqual(modelOwnedTopLevel)
    expect(schema.properties).toHaveProperty('selfConfidence')
    expect(schema.required).not.toContain('selfConfidence')
    expect(schema.properties.classification.required).toEqual(artifactSchema.properties.classification.required)
    expect(schema.properties.classification.required).toContain('filterLanguages')
  })

  it('derives all classification enums from the current taxonomy contract', () => {
    for (const field of ['moods', 'situations', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'] as const) {
      const projected = schema.properties.classification.properties[field]
      expect((projected.items ?? projected).enum).toEqual(taxonomy[field])
    }
    expect(schema.properties.classification.properties.filterLanguages).toMatchObject({ type: 'array', minItems: 1, items: { type: 'string' } })
  })

  it('closes fixed objects while retaining every contract-valid optional field', () => {
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.classification.additionalProperties).toBe(false)
    expect(schema.properties.evidence.additionalProperties).toBe(false)
    expect(schema.properties.evidence.properties.pace.additionalProperties).toBe(false)
    expect(schema.properties.evidence.properties.pace.properties.grounding.additionalProperties).toBe(false)
    expect(schema.properties.evidence.properties.pace.properties.grounding.properties).toHaveProperty('bridge')
    expect(schema.properties).toHaveProperty('selfConfidence')
  })

  it('marks the observed missing filterLanguages response structurally incomplete', () => {
    const observed = { moods: ['funny'], situations: ['family'], pace: 'medium', emotionalWeight: 'light', attentionDemand: 'easy', discoveryStyle: 'familiar' }
    const missingRequired = schema.properties.classification.required.filter((field) => !Object.hasOwn(observed, field))
    expect(missingRequired).toEqual(['filterLanguages'])
  })

  it('projects every authoritative semantic-output.v2 numeric string-length constraint exactly', () => {
    const evidence = schema.properties.evidence.properties.pace
    expect(evidence.properties.rationale).toMatchObject({ type: 'string', minLength: 12 })
    expect(evidence.properties.grounding.properties.cues.items.properties.cue).toMatchObject({ type: 'string', minLength: 8 })
    expect(evidence.properties.grounding.properties.bridge).toMatchObject({ type: 'string', minLength: 12 })
    expect(schema.properties.boundaryFlags.items.properties.message).toMatchObject({ type: 'string', minLength: 12 })
  })

  it('keeps the completed historical projection reproducible without weakening the current projection', () => {
    const legacy = buildSemanticResponseJsonSchema([], 'semantic-output.v2', 'legacy-v1')
    expect(legacy.properties.evidence.properties.pace.properties.rationale).not.toHaveProperty('minLength')
    expect(legacy.properties.evidence.properties.pace.properties.grounding.properties.cues.items.properties.cue).not.toHaveProperty('minLength')
    expect(schema.properties.evidence.properties.pace.properties.grounding.properties.cues.items.properties.cue.minLength).toBe(8)
  })

  it('keeps projected thresholds aligned with canonical validator rejection boundaries', () => {
    const evidence = (rationale = 'twelve chars!', cue = '12345678', bridge = undefined) => ({ rationale, sourceRefs: ['tmdb-overview'], grounding: { mode: bridge ? 'supported-inference' : 'direct', cues: bridge ? [{ sourceRef: 'tmdb-overview', cue }, { sourceRef: 'tmdb-overview', cue: '87654321' }] : [{ sourceRef: 'tmdb-overview', cue }], ...(bridge ? { bridge } : {}) } })
    const semantic = (pace, boundaryFlags = []) => ({ schemaVersion: 'semantic-output.v2', promptVersion: 'semantic-classifier.v3', taxonomyVersion: taxonomy.taxonomyVersion, movie: { candidateId: 'fixture', tmdbId: 1 }, classification: { moods: ['thoughtful'], situations: ['alone'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'moderate', attentionDemand: 'engaged', discoveryStyle: 'different' }, evidence: { moods: { thoughtful: evidence() }, situations: { alone: evidence() }, pace, emotionalWeight: evidence(), attentionDemand: evidence(), discoveryStyle: evidence() }, boundaryFlags })
    expect(validateSemanticOutput(semantic(evidence('twelve chars!', '1234567'))).hardFailures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_CUE_TOO_SHORT' })]))
    expect(validateSemanticOutput(semantic(evidence('eleven char'))).hardFailures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_RATIONALE_TOO_SHORT' })]))
    expect(validateSemanticOutput(semantic(evidence('twelve chars!', '12345678', 'short one'))).hardFailures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_BRIDGE_TOO_SHORT' })]))
    expect(validateSemanticOutput(semantic(evidence(), [{ code: 'BOUNDARY', fields: ['pace'], message: 'too short', reviewRequired: true }])).hardFailures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INVALID_BOUNDARY_FLAG' })]))
  })
})
