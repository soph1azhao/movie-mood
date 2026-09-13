import { describe, expect, it } from 'vitest'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import artifactSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import { buildSemanticResponseJsonSchema } from './geminiProvider.ts'

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
})
