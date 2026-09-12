import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCandidateManifest, runSemanticBatch } from './runSemanticBatch.mjs'

const packet = (id, tmdbId) => ({ schemaVersion: 'evidence-packet.v1', candidateId: id, tmdbId, inputHash: `sha256:${id}`, sourceProvenance: [] })
const provider = { metadata: { providerId: 'gemini', modelId: 'gemini-3.7-flash' } }
const options = (root, evidencePackets) => ({ runId: 'batch-1', evidencePackets, provider, prompt: 'fixture', promptVersion: 'semantic-classifier.v3', schemaVersion: 'semantic-output.v2', cacheRoot: join(root, 'cache'), outputRoot: join(root, 'output'), runRoot: join(root, 'runs') })

describe('semantic batch runner', () => {
  it('creates an ordered immutable candidate manifest', () => {
    const first = createCandidateManifest([packet('a', 1), packet('b', 2)])
    expect(first.candidates.map((candidate) => candidate.candidateId)).toEqual(['a', 'b'])
    expect(createCandidateManifest([packet('b', 2), packet('a', 1)]).candidateManifestHash).not.toBe(first.candidateManifestHash)
  })

  it('dry-runs without provider calls and reports uncached work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'semantic-batch-'))
    const classify = vi.fn()
    try {
      const result = await runSemanticBatch({ ...options(root, [packet('a', 1), packet('b', 2)]), dryRun: true, classifyCandidate: classify })
      expect(result).toMatchObject({ candidateCount: 2, cacheHits: 0, freshGenerationCount: 2, projectedFreshRequestCount: 2 })
      expect(classify).not.toHaveBeenCalled()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('persists progress, stops retryable failures, and resumes only unresolved work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'semantic-batch-'))
    const first = vi.fn()
      .mockResolvedValueOnce({ cacheHit: false, modelCalls: 1, cacheKey: 'a-key', outputPath: '/a.json', artifact: { outputHash: 'sha256:a' } })
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'MODEL_RETRY_LIMIT' }))
    try {
      const stopped = await runSemanticBatch({ ...options(root, [packet('a', 1), packet('b', 2)]), classifyCandidate: first })
      expect(stopped.manifest).toMatchObject({ status: 'STOPPED_RETRYABLE_FAILURE', states: { a: { status: 'COMPLETED' }, b: { status: 'RETRYABLE_FAILURE' } } })
      const resume = vi.fn().mockResolvedValue({ cacheHit: false, modelCalls: 1, cacheKey: 'b-key', outputPath: '/b.json', artifact: { outputHash: 'sha256:b' } })
      const completed = await runSemanticBatch({ ...options(root, [packet('a', 1), packet('b', 2)]), classifyCandidate: resume })
      expect(resume).toHaveBeenCalledTimes(1)
      expect(resume.mock.calls[0][0].evidencePacket.candidateId).toBe('b')
      expect(completed.manifest.status).toBe('COMPLETED')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('blocks resume when candidate membership or provider identity changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'semantic-batch-'))
    try {
      await runSemanticBatch({ ...options(root, [packet('a', 1)]), dryRun: false, maxFreshCalls: 0 })
      await expect(runSemanticBatch({ ...options(root, [packet('a', 1), packet('b', 2)]), dryRun: false })).rejects.toMatchObject({ code: 'BATCH_IDENTITY_MISMATCH' })
      await expect(runSemanticBatch({ ...options(root, [packet('a', 1)]), provider: { metadata: { providerId: 'gemini', modelId: 'gemini-3.6-flash' } }, dryRun: false })).rejects.toMatchObject({ code: 'BATCH_IDENTITY_MISMATCH' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
