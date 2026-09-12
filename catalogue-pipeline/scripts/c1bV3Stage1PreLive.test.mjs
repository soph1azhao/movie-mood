import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalize } from './c1bV2Stage0.mjs'
import { assembleRepositoryExclusions } from './c1bV2Stage1Runner.mjs'
import { V3_PROTOCOL_ID, buildV3ExclusionManifest } from './c1bV3Stage1.mjs'
import {
  V3_STAGE1A_CHECKPOINT,
  V3_FUTURE_LIVE_RELATIVE,
  buildV3PreLiveExclusions,
  loadFrozenV3Stage1RunConfiguration,
  prepareV3PreLiveGate,
  verifyV2ForensicIntegrity,
  verifyV3ExclusionProvenance,
  verifyV3PreLiveGate,
} from './c1bV3Stage1PreLive.mjs'

const directories = []
const frozenPreLive = join(process.cwd(), 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/pre-live-v1')
const frozenFiles = ['exclusion-manifest.json', 'exclusion-provenance.json', 'phase5c-c1b-v3-stage1-pre-live-gate.v1.json']
async function tempOutput() { const path = await mkdtemp(join(tmpdir(), 'c1b-v3-pre-live-')); directories.push(path); return path }
async function frozenCopies() {
  const outputDir = await tempOutput()
  await Promise.all(frozenFiles.map((file) => copyFile(join(frozenPreLive, file), join(outputDir, file))))
  return { outputDir, paths: { manifest: join(outputDir, frozenFiles[0]), provenance: join(outputDir, frozenFiles[1]), gate: join(outputDir, frozenFiles[2]) } }
}
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('C1b-V3 Stage 1C offline pre-live gate', () => {
  it('is invariant to source and record permutation under the V3 canonical builder', async () => {
    const inherited = await assembleRepositoryExclusions({ root: process.cwd() })
    const sources = inherited.provenance.sources.map((source) => ({ sourceName: source.sourceCategory, entries: source.records }))
    const first = buildV3ExclusionManifest({ protocolId: V3_PROTOCOL_ID, sources })
    const second = buildV3ExclusionManifest({ protocolId: V3_PROTOCOL_ID, sources: [...sources].reverse().map((source) => ({ ...source, entries: [...source.entries].reverse() })) })
    expect(canonicalize(first)).toBe(canonicalize(second))
    expect(first.exclusionManifestHash).toBe(second.exclusionManifestHash)
  })

  it('preserves V3 protocol binding and rejects metadata conflicts', () => {
    expect(() => buildV3ExclusionManifest({ protocolId: 'wrong', sources: [] })).toThrow()
    expect(() => buildV3ExclusionManifest({ sources: [
      { sourceName: 'one', entries: [{ id: 7, canonicalId: 'a' }] },
      { sourceName: 'two', entries: [{ id: 7, canonicalId: 'b' }] },
    ] })).toThrowError(expect.objectContaining({ code: 'EXCLUSION_METADATA_CONFLICT' }))
  })

  it('records substantive local source hashes and explicitly excludes V2 factual page observations', async () => {
    const { manifest, provenance } = await buildV3PreLiveExclusions({ root: process.cwd() })
    expect(manifest.protocolId).toBe(V3_PROTOCOL_ID)
    expect(manifest.exclusions).toHaveLength(150)
    expect(provenance.v2FactualPage1Rule).toMatchObject({ consumedAsExclusionInput: false, rawResponseCopiedIntoV3Universe: false, feasibilityFactsRetainedOnly: { '1980-1989.total_pages': 45, '1990-1999.total_pages': 65 } })
    expect(provenance.substantiveSources.some(({ sourcePath }) => sourcePath.includes('phase-5c-c1b-v-confirmatory.v2/stage1-recruitment-live-v1'))).toBe(false)
    expect(provenance.substantiveSources.every(({ rawFiles }) => rawFiles.length > 0)).toBe(true)
    await expect(verifyV3ExclusionProvenance(provenance, { root: process.cwd(), manifest })).resolves.toMatchObject({ ok: true })
  })

  it('fails provenance verification when a listed source hash is changed', async () => {
    const { manifest, provenance } = await buildV3PreLiveExclusions({ root: process.cwd() })
    const altered = structuredClone(provenance)
    altered.substantiveSources[0].rawFiles[0].rawSha256 = `sha256:${'0'.repeat(64)}`
    await expect(verifyV3ExclusionProvenance(altered, { root: process.cwd(), manifest })).rejects.toMatchObject({ code: 'PROVENANCE_SOURCE_HASH_MISMATCH' })
  })

  it('rejects any V2 live-tree path and non-exact feasibility facts in exclusion provenance', async () => {
    const { manifest, provenance } = await buildV3PreLiveExclusions({ root: process.cwd() })
    const rawFilePath = structuredClone(provenance)
    rawFilePath.substantiveSources[0].rawFiles[0].path = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v2/stage1-recruitment-live-v1/request-manifest.json'
    await expect(verifyV3ExclusionProvenance(rawFilePath, { root: process.cwd(), manifest })).rejects.toMatchObject({ code: 'V2_LIVE_PROVENANCE_PROHIBITED' })
    const livePath = structuredClone(provenance)
    livePath.identityResolutionInputs[0].path = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v2/stage1-recruitment-live-v1/request-manifest.json'
    await expect(verifyV3ExclusionProvenance(livePath, { root: process.cwd(), manifest })).rejects.toMatchObject({ code: 'V2_LIVE_PROVENANCE_PROHIBITED' })
    const nonExactFacts = structuredClone(provenance)
    nonExactFacts.v2FactualPage1Rule.feasibilityFactsRetainedOnly['1990-1999.total_pages'] = 64
    await expect(verifyV3ExclusionProvenance(nonExactFacts, { root: process.cwd(), manifest })).rejects.toMatchObject({ code: 'PROVENANCE_MISMATCH' })
  })

  it('anchors V2 closure validation at immutable roots before closure-recorded live artifact hashes', async () => {
    const cases = [
      ['phase5c-c1b-v2-stage1-closure.v1.json', 'closure', true],
      ['phase5c-c1b-v-confirmatory.v2.json', 'protocol', true],
      ['phase5c-c1b-v-confirmatory.v2.contracts.json', 'contracts', true],
      ['phase5c-c1b-v-confirmatory.v2.acceptance-tests.md', 'acceptance', true],
      ['/stage1-recruitment-live-v1/RUN_LOCK', null, false],
    ]
    for (const [suffix, rootName, stopsBeforeArtifacts] of cases) {
      const altered = async (path, encoding) => {
        const raw = await readFile(path, encoding)
        return path.endsWith(suffix) ? `${raw}\n` : raw
      }
      const result = await verifyV2ForensicIntegrity(process.cwd(), { readFileImpl: altered })
      expect(result.ok).toBe(false)
      if (stopsBeforeArtifacts) {
        expect(result.entries).toEqual([])
        expect(result.roots.find(({ name }) => name === rootName)?.actual).not.toBe(result.roots.find(({ name }) => name === rootName)?.rawSha256)
      } else expect(result.entries.find(({ name }) => name === 'RUN_LOCK')).toMatchObject({ actual: expect.not.stringMatching(/^sha256:e057e2/) })
    }
  })

  it('fails the machine gate for mutated registered spec, runner version, checkpoint, or manifest hash', async () => {
    const { manifest, provenance } = await buildV3PreLiveExclusions({ root: process.cwd() })
    const badSpec = await verifyV3PreLiveGate({ root: process.cwd(), manifest, provenance, loadSpec: async () => { throw Object.assign(new Error('tamper'), { code: 'SPECIFICATION_TAMPER' }) } })
    expect(badSpec).toMatchObject({ ok: false, reason: 'SPECIFICATION_TAMPER' })
    expect((await verifyV3PreLiveGate({ root: process.cwd(), manifest, provenance, runnerVersion: 'wrong' })).checks.runnerVersion).toBe(false)
    expect((await verifyV3PreLiveGate({ root: process.cwd(), manifest, provenance, stage1aCheckpoint: '0000000000000000000000000000000000000000' })).checks.stage1aCheckpointAncestor).toBe(false)
    const badManifest = structuredClone(manifest); badManifest.exclusionManifestHash = `sha256:${'f'.repeat(64)}`
    expect((await verifyV3PreLiveGate({ root: process.cwd(), manifest: badManifest, provenance })).checks.exclusionManifestValid).toBe(false)
  })

  it('rejects historical preparation from post-freeze HEAD without network, WAL, or live directory activity', async () => {
    const fetchSpy = vi.fn()
    const previousFetch = globalThis.fetch
    globalThis.fetch = fetchSpy
    try { await expect(prepareV3PreLiveGate({ root: process.cwd(), outputDir: await tempOutput(), env: {} })).rejects.toMatchObject({ code: 'PREPARATION_HEAD_MISMATCH' }) } finally { globalThis.fetch = previousFetch }
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(readFile(join(process.cwd(), V3_FUTURE_LIVE_RELATIVE, 'execution.wal'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps committed Stage-1C evidence and registered inputs byte-identical after freeze', async () => {
    const gate = JSON.parse(await readFile(join(frozenPreLive, frozenFiles[2]), 'utf8'))
    expect(gate.checks.v2ForensicArtifactsByteIdentical).toBe(true)
    expect(gate.checks.registeredSpecUnmodified).toBe(true)
    const raw = await readFile('catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.json')
    expect(`sha256:${createHash('sha256').update(raw).digest('hex')}`).toBe('sha256:3568b8fd4f2895ab4b9e2cdba145e501e737c784d08a948491413de47483b374')
    expect(gate.stage1aCheckpoint).toBe(V3_STAGE1A_CHECKPOINT)
    expect(gate.preparationBaseHead).toBe(gate.stage1bCheckpoint)
    expect(gate.checks.implementationBytesBoundToRegisteredCheckpoints).toBe(true)
    expect(gate.implementationBindings).toHaveLength(5)
  })

  it('loads only the persisted frozen run configuration and never starts the runner', async () => {
    const { outputDir, paths } = await frozenCopies()
    const configuration = await loadFrozenV3Stage1RunConfiguration({ root: process.cwd(), preLiveDir: outputDir })
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
    const gate = JSON.parse(await readFile(paths.gate, 'utf8'))
    expect(configuration).toMatchObject({ protocolId: V3_PROTOCOL_ID, stage: 1, invocationId: gate.invocationId, exclusionManifestHash: manifest.exclusionManifestHash, liveExecutionRequiresIndependentAuthorization: true })
    gate.invocationId = 'tampered'
    await (await import('node:fs/promises')).writeFile(paths.gate, JSON.stringify(gate))
    await expect(loadFrozenV3Stage1RunConfiguration({ root: process.cwd(), preLiveDir: outputDir })).rejects.toMatchObject({ code: 'FROZEN_RUN_CONFIGURATION_MISMATCH' })
  })

  it('rejects frozen gates whose forensic bindings, checks, authorization, or zero-I/O claims diverge', async () => {
    const { outputDir, paths } = await frozenCopies()
    const original = JSON.parse(await readFile(paths.gate, 'utf8'))
    const mutations = [
      (gate) => { gate.stage1aCheckpoint = '0'.repeat(40) },
      (gate) => { gate.stage1bCheckpoint = '0'.repeat(40) },
      (gate) => { gate.preparationBaseHead = '0'.repeat(40) },
      (gate) => { gate.specificationHashes.protocolRaw = 'sha256:0' },
      (gate) => { gate.implementationBindings[0].workingRawSha256 = 'sha256:0' },
      (gate) => { gate.checks.exactAnnualCells = false },
      (gate) => { gate.networkCallsDuringGate = 1 },
      (gate) => { gate.tmdbCredentialPresent = true },
    ]
    for (const mutate of mutations) {
      const gate = structuredClone(original)
      mutate(gate)
      await (await import('node:fs/promises')).writeFile(paths.gate, JSON.stringify(gate))
      await expect(loadFrozenV3Stage1RunConfiguration({ root: process.cwd(), preLiveDir: outputDir })).rejects.toMatchObject({ code: 'FROZEN_RUN_CONFIGURATION_MISMATCH' })
    }
  })
})
