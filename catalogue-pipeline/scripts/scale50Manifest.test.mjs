import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildScale50Manifest, loadAndBuildScale50, SOURCE_MANIFEST_HASH } from './scale50Manifest.mjs'

const root = resolve('catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1')
const readJson = (name) => readFile(resolve(root, name), 'utf8').then(JSON.parse)

describe('frozen Scale-50 manifest', () => {
  it('deterministically selects the exact production composition from frozen expansion-100-v1', async () => {
    const first = await loadAndBuildScale50(); const second = await loadAndBuildScale50()
    expect(first).toEqual(second)
    expect(first).toMatchObject({ batchId: 'scale-50-v1', sourceCandidateManifestHash: SOURCE_MANIFEST_HASH, selectionRuleVersion: 'scale-50-stratified-genre-rotation.v1', scaleManifestHash: 'sha256:bc2733492833df6b1e693c7646a468967e663d241b0d2aa7e2f58c1e64d7fd52' })
    expect(first.candidates).toHaveLength(50)
    expect(new Set(first.candidates.map(({ candidateId }) => candidateId)).size).toBe(50)
    expect(new Set(first.candidates.map(({ tmdbId }) => tmdbId)).size).toBe(50)
    expect(first.composition.decades).toEqual({ '1980s': 10, '1990s': 10, '2000s': 10, '2010s': 10, '2020s': 10 })
    expect(first.composition.languageBuckets).toEqual({ English: 25, 'Non-English': 25 })
    expect(first.composition.familiarityBuckets).toEqual({ mainstream: 18, familiar: 17, discovery: 15 })
    expect(Object.keys(first.composition.originalLanguages).length).toBeGreaterThanOrEqual(10)
    expect(Object.keys(first.composition.primaryGenres).length).toBeGreaterThanOrEqual(8)
  })

  it('binds every selected candidate to complete, automatically ready frozen evidence', async () => {
    const [source, readiness, frozen, pilot] = await Promise.all([readJson('candidate-manifest.json'), readJson('expansion-readiness-report.v1.json'), readFile(resolve('catalogue-pipeline/generated/catalogue-expansion/scale-50-v1/candidate-manifest.json'), 'utf8').then(JSON.parse), readFile(resolve('catalogue-pipeline/generated/semantic/batches/v8-1-semantic-pilot-001/manifest.json'), 'utf8').then(JSON.parse)])
    const rebuilt = buildScale50Manifest(source, readiness); expect(frozen).toEqual(rebuilt)
    const sourceById = new Map(source.candidates.map((candidate) => [candidate.candidateId, candidate])); const readyById = new Map(readiness.records.map((record) => [record.candidateId, record]))
    for (const candidate of frozen.candidates) {
      expect(sourceById.get(candidate.candidateId)).toMatchObject({ tmdbId: candidate.tmdbId, factualSnapshotStatus: 'COMPLETE', duplicateExistingCatalogueStatus: 'NOT_PRESENT' })
      expect(readyById.get(candidate.candidateId)).toMatchObject({ evidencePacketHash: candidate.evidencePacketHash, factualSnapshotStatus: 'COMPLETE', evidencePacketStatus: 'COMPLETE', readiness: 'AUTOMATICALLY_READY' })
      const packet = await readJson(`evidence-packets/${candidate.candidateId}.json`); expect(packet).toMatchObject({ candidateId: candidate.candidateId, tmdbId: candidate.tmdbId, inputHash: candidate.evidencePacketHash })
    }
    const pilotTmdbIds = new Set(pilot.candidates.map(({ tmdbId }) => tmdbId)); expect(frozen.candidates.filter(({ tmdbId }) => pilotTmdbIds.has(tmdbId))).toEqual([])
    expect(frozen.candidates.map(({ candidateId }) => candidateId)).not.toEqual(source.candidates.slice(0, 50).map(({ candidateId }) => candidateId))
  })

  it('fails closed on source provenance or evidence drift', async () => {
    const [source, readiness] = await Promise.all([readJson('candidate-manifest.json'), readJson('expansion-readiness-report.v1.json')])
    expect(() => buildScale50Manifest({ ...source, candidateManifestHash: 'sha256:drift' }, readiness)).toThrow(expect.objectContaining({ code: 'SOURCE_MANIFEST_IDENTITY_MISMATCH' }))
    const selectedId = buildScale50Manifest(source, readiness).candidates[0].candidateId
    const records = readiness.records.map((record) => record.candidateId === selectedId ? { ...record, evidencePacketHash: 'sha256:drift' } : record)
    expect(() => buildScale50Manifest(source, { ...readiness, records })).toThrow(expect.objectContaining({ code: 'SOURCE_READINESS_HASH_MISMATCH' }))
  })
})
