import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ModelProviderError } from '../adapters/modelProvider.ts'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import {
  buildSemanticClassifierInput,
  classifySemanticCandidate,
  SEMANTIC_PROMPT_VERSION,
  summarizeCalibrationReplay,
} from './classifySemantic.mjs'

const prompt = '# semantic classifier fixture\npace is not attention demand'

function packet() {
  return buildEvidencePacket({
    candidateId: 'existing-paddington-2',
    facts: {
      tmdbId: 346648, title: 'Paddington 2', year: 2017, director: 'Paul King', genres: ['Adventure', 'Comedy', 'Family'], runtimeMinutes: 104, countries: ['United Kingdom'], spokenLanguages: ['English'], factsHash: 'sha256:facts-v1',
    },
    tmdbOverview: 'Paddington takes on an odd job to buy a special present, then must clear his name after a theft.',
  }).packet
}

function response(overrides = {}) {
  const item = (rationale) => ({ rationale, sourceRefs: ['tmdb-facts'] })
  return {
    classification: {
      moods: ['funny', 'relaxing'], situations: ['family', 'easy-watch'], filterLanguages: ['English'], pace: 'medium', emotionalWeight: 'light', attentionDemand: 'easy', discoveryStyle: 'familiar',
    },
    evidence: {
      moods: { funny: item('The factual genre includes comedy and the overview describes a playful setup.'), relaxing: item('The family-comedy framing supports a gentle practical viewing experience.') },
      situations: { family: item('The family genre and accessible premise support shared viewing.'), 'easy-watch': item('The concise premise and accessible genre frame support low practical friction.') },
      pace: item('The runtime and caper-style overview support a medium pace.'),
      emotionalWeight: item('The factual family-comedy framing supports limited emotional recovery cost.'),
      attentionDemand: item('The premise is legible without dense puzzle tracking.'),
      discoveryStyle: item('The familiar family-comedy form is broadly approachable.'),
    },
    boundaryFlags: [],
    selfConfidence: { moods: 0.8, situations: 0.8, pace: 0.8, emotionalWeight: 0.8, attentionDemand: 0.8, discoveryStyle: 0.8 },
    ...overrides,
  }
}

function providerWith(output, metadata = {}) {
  return {
    metadata: { providerId: 'mock-provider', modelId: 'mock-classifier-v1', supportsStructuredJson: true, supportsTemperature: true, ...metadata },
    generateStructured: vi.fn().mockResolvedValue(output),
  }
}

async function runInTemp(provider, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'movie-mood-semantic-'))
  const result = await classifySemanticCandidate({ evidencePacket: packet(), provider, prompt, cacheRoot: join(root, 'cache'), outputPath: join(root, 'generated', 'paddington.json'), ...overrides })
  return { root, result }
}

describe('Phase 5 semantic classifier', () => {
  it('builds a frozen prompt input containing only evidence and versioned calibration material', () => {
    const input = buildSemanticClassifierInput({ evidencePacket: packet(), prompt })
    expect(input.schemaVersion).toBe('semantic-input.v1')
    expect(input.promptVersion).toBe(SEMANTIC_PROMPT_VERSION)
    expect(input.evidencePacket.facts.title).toBe('Paddington 2')
    expect(input).not.toHaveProperty('editorialCopy')
    expect(input).not.toHaveProperty('writerNotes')
    expect(input.taxonomy.taxonomyVersion).toBe('taxonomy.v2')
  })

  it('produces a validated structured semantic artifact with provenance only', async () => {
    const provider = providerWith(response())
    const { root, result } = await runInTemp(provider)
    try {
      expect(result.modelCalls).toBe(1)
      expect(result.retries).toBe(0)
      expect(result.cacheHit).toBe(false)
      expect(result.classificationsCompleted).toBe(1)
      expect(result.providerUsageMetadata).toBeNull()
      expect(result.artifact).toMatchObject({ schemaVersion: 'semantic-output.v1', promptVersion: 'semantic-classifier.v1', taxonomyVersion: 'taxonomy.v2', modelProvider: 'mock-provider', modelId: 'mock-classifier-v1' })
      expect(result.artifact.outputHash).toMatch(/^sha256:/)
      expect(result.artifact).not.toHaveProperty('copy')
      expect(provider.generateStructured).toHaveBeenCalledWith(expect.objectContaining({ stage: 'semantic-classifier', responseFormat: 'json_object' }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects missing per-tag evidence and invalid enums from structured provider output', async () => {
    const missingEvidence = providerWith(response({ evidence: { ...response().evidence, moods: { funny: response().evidence.moods.funny } } }))
    await expect(runInTemp(missingEvidence)).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
    const invalidEnum = providerWith(response({ classification: { ...response().classification, pace: 'turbo' } }))
    await expect(runInTemp(invalidEnum)).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
  })

  it('preserves boundary flags and rejects unavailable source references', async () => {
    const provider = providerWith(response({ boundaryFlags: [{ code: 'CARDINALITY_BOUNDARY', fields: ['moods'], message: 'Two moods are grounded but should be compared with the calibration anchor.', reviewRequired: true }] }))
    const { root, result } = await runInTemp(provider)
    try {
      expect(result.artifact.boundaryFlags[0].code).toBe('CARDINALITY_BOUNDARY')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    const unknownSource = providerWith(response({ evidence: { ...response().evidence, pace: { rationale: 'This is supposedly grounded but cites an absent source.', sourceRefs: ['external-review'] } } }))
    await expect(runInTemp(unknownSource)).rejects.toMatchObject({ code: 'INVALID_SEMANTIC_OUTPUT' })
  })

  it('is idempotent on cache hits and invalidates only changed classification keys', async () => {
    const provider = providerWith(response())
    const root = await mkdtemp(join(tmpdir(), 'movie-mood-semantic-cache-'))
    const options = { evidencePacket: packet(), provider, prompt, cacheRoot: join(root, 'cache'), outputPath: join(root, 'generated', 'paddington.json') }
    try {
      const first = await classifySemanticCandidate(options)
      const firstArtifact = await readFile(options.outputPath, 'utf8')
      const second = await classifySemanticCandidate(options)
      const secondArtifact = await readFile(options.outputPath, 'utf8')
      expect(first.cacheHit).toBe(false)
      expect(second.cacheHit).toBe(true)
      expect(second.modelCalls).toBe(0)
      expect(second.retries).toBe(0)
      expect(second.classificationsCompleted).toBe(1)
      expect(second.providerUsageMetadata).toBeNull()
      expect(provider.generateStructured).toHaveBeenCalledTimes(1)
      expect(secondArtifact).toBe(firstArtifact)
      expect(second.artifact.outputHash).toBe(first.artifact.outputHash)

      const promptChanged = await classifySemanticCandidate({ ...options, prompt: `${prompt}\nrevision`, promptVersion: 'semantic-classifier.v2' })
      const taxonomyChanged = await classifySemanticCandidate({ ...options, taxonomyDefinition: { ...buildSemanticClassifierInput({ evidencePacket: packet(), prompt }).taxonomy, taxonomyVersion: 'taxonomy.v3' } })
      const evidenceChanged = await classifySemanticCandidate({ ...options, evidencePacket: { ...packet(), inputHash: 'sha256:evidence-v2' } })
      const calibrationChanged = await classifySemanticCandidate({ ...options, calibrationAnchors: { anchors: [{ movieId: 'paddington-2', field: 'pace', value: 'medium' }] } })
      const modelChangedProvider = providerWith(response(), { modelId: 'mock-classifier-v2' })
      const modelChanged = await classifySemanticCandidate({ ...options, provider: modelChangedProvider })
      expect(new Set([first.cacheKey, promptChanged.cacheKey, taxonomyChanged.cacheKey, evidenceChanged.cacheKey, calibrationChanged.cacheKey, modelChanged.cacheKey]).size).toBe(6)
      expect(provider.generateStructured).toHaveBeenCalledTimes(5)
      expect(modelChangedProvider.generateStructured).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects malformed output, honors the provider retry limit, and keeps classifier/editorial work separate', async () => {
    await expect(runInTemp(providerWith('{not json'))).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
    const retryProvider = {
      metadata: { providerId: 'mock-provider', modelId: 'retry-model', supportsStructuredJson: true, supportsTemperature: true },
      generateStructured: vi.fn().mockRejectedValue(new ModelProviderError('retry', { retryable: true })),
    }
    await expect(runInTemp(retryProvider)).rejects.toMatchObject({ code: 'MODEL_RETRY_LIMIT' })
    expect(retryProvider.generateStructured).toHaveBeenCalledTimes(2)
    await expect(runInTemp(providerWith(response({ description: 'Not allowed.' })))).rejects.toMatchObject({ code: 'MODEL_PROVIDER_FAILURE' })
  })

  it('does not cache invalid output and accepts a corrected subsequent response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'movie-mood-semantic-invalid-cache-'))
    const invalidProvider = providerWith(response({ classification: { ...response().classification, attentionDemand: 'invalid' } }))
    const options = { evidencePacket: packet(), provider: invalidProvider, prompt, cacheRoot: join(root, 'cache'), outputPath: join(root, 'generated', 'paddington.json') }
    try {
      await expect(classifySemanticCandidate(options)).rejects.toMatchObject({ code: 'MALFORMED_MODEL_OUTPUT' })
      expect(invalidProvider.generateStructured).toHaveBeenCalledTimes(1)
      await expect(readFile(options.outputPath, 'utf8')).rejects.toThrow()

      const correctedProvider = providerWith(response())
      const corrected = await classifySemanticCandidate({ ...options, provider: correctedProvider })
      expect(corrected.cacheHit).toBe(false)
      expect(correctedProvider.generateStructured).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('summarizes calibration replay agreement without overwriting human targets', () => {
    const artifact = { movie: { tmdbId: 346648 }, classification: response().classification, evidence: response().evidence, boundaryFlags: [] }
    const replay = summarizeCalibrationReplay({ targets: [{ tmdbId: 346648, ...response().classification }], artifacts: [artifact] })
    expect(replay.orderedExactAgreement.pace.rate).toBe(1)
    expect(replay.moodSituationOverlap.moods).toEqual([1])
    expect(replay.severeDisagreements).toEqual([])
    expect(replay.evidenceQuality.complete).toBe(1)
  })
})
