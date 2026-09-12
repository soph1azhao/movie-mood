import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildV3ExclusionManifest } from './c1bV3Stage1.mjs'
import { V3_STAGE1_EXECUTION_FLAG, runAuthorizedC1bV3Stage1, runC1bV3Stage1LiveCli } from './runC1bV3Stage1Live.mjs'

const token = 'launcher-test-secret'
const configuration = Object.freeze({
  artifactDir: '/synthetic/frozen-v3-live',
  invocationId: 'phase-5c-c1b-v3-stage1-recruitment-live-v1',
  exclusionManifest: buildV3ExclusionManifest({ sources: [] }),
})

function dependencies(overrides = {}) {
  const fetchImpl = vi.fn()
  const loadFrozenConfiguration = vi.fn(async () => configuration)
  const createTransport = vi.fn(({ fetchImpl: injected, token: injectedToken }) => ({ dispatch: vi.fn(), injected, injectedToken }))
  const runRecruitment = vi.fn(async () => ({ status: 'SYNTHETIC', dispatchedRequests: 1, maxConcurrency: 1, sourceSnapshotHash: 'sha256:snapshot', selection: { finalCandidateCount: 7 } }))
  const log = vi.fn()
  return { authorizationFlag: V3_STAGE1_EXECUTION_FLAG, root: '/synthetic', env: { TMDB_READ_ACCESS_TOKEN: token }, fetchImpl, loadFrozenConfiguration, createTransport, runRecruitment, now: vi.fn(() => '2026-09-11T00:00:00.000Z'), log, ...overrides }
}

describe('C1b-V3 initial live launcher authorization interlock', () => {
  it('has no fetch side effect on import', async () => {
    const previous = globalThis.fetch
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    vi.resetModules()
    try { await import('./runC1bV3Stage1Live.mjs') } finally { globalThis.fetch = previous }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does nothing for absent, wrong, or additional CLI flags', async () => {
    for (const argv of [['node', 'launcher'], ['node', 'launcher', '--wrong'], ['node', 'launcher', V3_STAGE1_EXECUTION_FLAG, '--extra']]) {
      const deps = dependencies()
      await expect(runC1bV3Stage1LiveCli({ argv, ...deps })).resolves.toEqual({ executed: false })
      expect(deps.loadFrozenConfiguration).not.toHaveBeenCalled()
      expect(deps.fetchImpl).not.toHaveBeenCalled()
      expect(deps.runRecruitment).not.toHaveBeenCalled()
    }
  })

  it.each([undefined, '--wrong'])('blocks direct execution with authorization flag %s before every dependency', async (authorizationFlag) => {
    const deps = dependencies({ authorizationFlag })
    await expect(runAuthorizedC1bV3Stage1(deps)).rejects.toMatchObject({ code: 'LIVE_AUTHORIZATION_REQUIRED' })
    expect(deps.loadFrozenConfiguration).not.toHaveBeenCalled()
    expect(deps.createTransport).not.toHaveBeenCalled()
    expect(deps.runRecruitment).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect(deps.fetchImpl).not.toHaveBeenCalled()
  })

  it('blocks missing credentials and frozen-configuration rejection before transport, runner, or fetch', async () => {
    const missing = dependencies({ env: {} })
    await expect(runAuthorizedC1bV3Stage1(missing)).rejects.toMatchObject({ code: 'TMDB_CREDENTIAL_MISSING' })
    expect(missing.createTransport).not.toHaveBeenCalled()
    expect(missing.runRecruitment).not.toHaveBeenCalled()
    expect(missing.fetchImpl).not.toHaveBeenCalled()
    const rejected = dependencies({ loadFrozenConfiguration: vi.fn(async () => { throw new Error('frozen reject') }) })
    await expect(runAuthorizedC1bV3Stage1(rejected)).rejects.toThrow('frozen reject')
    expect(rejected.createTransport).not.toHaveBeenCalled()
    expect(rejected.runRecruitment).not.toHaveBeenCalled()
    expect(rejected.fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the frozen configuration unchanged for exactly one initial runner call and emits a non-secret summary', async () => {
    const deps = dependencies()
    const output = await runC1bV3Stage1LiveCli({ argv: ['node', 'launcher', V3_STAGE1_EXECUTION_FLAG], ...deps })
    expect(output.executed).toBe(true)
    expect(deps.now).toHaveBeenCalledTimes(1)
    expect(deps.createTransport).toHaveBeenCalledWith({ fetchImpl: deps.fetchImpl, token })
    expect(deps.runRecruitment).toHaveBeenCalledTimes(1)
    expect(deps.runRecruitment).toHaveBeenCalledWith(expect.objectContaining({ artifactDir: configuration.artifactDir, invocationId: configuration.invocationId, exclusionManifest: configuration.exclusionManifest, controlledResume: false, timestamp: '2026-09-11T00:00:00.000Z' }))
    expect(deps.log).toHaveBeenCalledTimes(1)
    expect(deps.log.mock.calls[0][0]).not.toContain(token)
    expect(output.summary).toMatchObject({ artifactDir: configuration.artifactDir, dispatchedRequests: 1, maxConcurrency: 1, finalCandidateCount: 7 })
  })

  it('does not mutate frozen Stage-1C evidence or contain RUN_LOCK deletion capability', async () => {
    const root = process.cwd()
    const relative = 'catalogue-pipeline/generated/semantic/diagnostics/phase-5c-c1b-v-confirmatory.v3/pre-live-v1'
    const files = ['exclusion-manifest.json', 'exclusion-provenance.json', 'phase5c-c1b-v3-stage1-pre-live-gate.v1.json']
    const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
    const before = await Promise.all(files.map((file) => digest(`${root}/${relative}/${file}`)))
    await runAuthorizedC1bV3Stage1(dependencies())
    const after = await Promise.all(files.map((file) => digest(`${root}/${relative}/${file}`)))
    expect(after).toEqual(before)
    const source = await readFile(new URL('./runC1bV3Stage1Live.mjs', import.meta.url), 'utf8')
    expect(source).not.toMatch(/node:fs|\brm\s*\(|\bunlink\s*\(|RUN_LOCK/u)
  })
})
