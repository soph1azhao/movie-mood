import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OPERATIONALLY_INCONCLUSIVE,
  Stage0Error,
  WAL_GENESIS_HASH,
  acquireRunLock,
  appendWalRecord,
  atomicWriteArtifact,
  canonicalSha256,
  canonicalize,
  classifyAttempt,
  createWalRecord,
  executeRequest,
  parseJsonRejectingDuplicateKeys,
  recoverWal,
  validateRequestIdentity,
  validateWalRecords,
  verifyContractsBundle,
} from './c1bV2Stage0.mjs'

const createdDirectories = []
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'c1b-v2-stage0-'))
  createdDirectories.push(directory)
  return { directory, walPath: join(directory, 'execution.wal'), lockPath: join(directory, 'RUN_LOCK'), artifactPath: join(directory, 'result.json') }
}
afterEach(async () => Promise.all(createdDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

const candidateIdentity = (overrides = {}) => ({
  studyId: 'synthetic-study', invocationId: 'invocation-1', attemptId: 'attempt-1', stage: 2,
  requestScope: 'candidate', requestPurpose: 'synthetic-fetch', requestHash: 'sha256:request',
  attemptOrdinal: 0, timestamp: '2026-09-11T00:00:00.000Z', scopeId: null,
  candidateId: 'candidate-1', arm: null, drawIndex: null, ...overrides,
})
const universeIdentity = (overrides = {}) => candidateIdentity({ requestScope: 'universe', scopeId: 'page-1', candidateId: null, ...overrides })
const inferenceIdentity = (overrides = {}) => candidateIdentity({ requestScope: 'inference', candidateId: 'candidate-1', arm: 'arm0', drawIndex: 1, ...overrides })

function chain(identity = candidateIdentity(), payloads = [{ lifecycle: 'INTENT', payload: null }, { lifecycle: 'RESPONSE', payload: { response: { value: 1 } } }, { lifecycle: 'TERMINAL', payload: { disposition: 'COMPLETED', output: { value: 2 } } }]) {
  const records = []
  for (const item of payloads) records.push(createWalRecord({ ...item, identity, seq: records.length, prevRecordHash: records.at(-1)?.canonicalRecordHash ?? WAL_GENESIS_HASH }))
  return records
}

async function writeChain(path, records, suffix = '\n') { await writeFile(path, records.map(canonicalize).join('\n') + suffix, 'utf8') }
const exists = async (path) => stat(path).then(() => true, () => false)

describe('C1b-V2 Stage 0 canonical hashing and frozen specification preflight', () => {
  it('implements deterministic RFC-8785-style canonical UTF-8 SHA-256', () => {
    expect(canonicalize({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}')
    expect(canonicalSha256({ a: 1, b: [2, 3] })).toBe(canonicalSha256({ b: [2, 3], a: 1 }))
    expect(canonicalSha256({ a: 1 })).not.toBe(canonicalSha256({ a: 2 }))
    expect(() => canonicalize({ invalid: Number.NaN })).toThrow(/non-finite/)
  })

  it('rejects duplicate JSON member names instead of first/last-wins parsing', () => {
    expect(() => parseJsonRejectingDuplicateKeys('{"a":1,"a":2}')).toThrowError(expect.objectContaining({ code: 'DUPLICATE_JSON_KEY' }))
    expect(parseJsonRejectingDuplicateKeys('{"a":{"b":1},"c":[true,null]}')).toEqual({ a: { b: 1 }, c: [true, null] })
  })

  it('recomputes the registered protocol, all nine contracts, and bundle hash', async () => {
    const base = new URL('../calibration/diagnostics/', import.meta.url)
    const protocolSource = await readFile(new URL('phase5c-c1b-v-confirmatory.v2.json', base), 'utf8')
    const bundleSource = await readFile(new URL('phase5c-c1b-v-confirmatory.v2.contracts.json', base), 'utf8')
    const acceptanceSource = await readFile(new URL('phase5c-c1b-v-confirmatory.v2.acceptance-tests.md', base), 'utf8')
    const protocol = parseJsonRejectingDuplicateKeys(protocolSource)
    const bundle = parseJsonRejectingDuplicateKeys(bundleSource)
    expect(() => parseJsonRejectingDuplicateKeys(JSON.stringify({ acceptanceSource }))).not.toThrow()
    expect(canonicalSha256(protocol)).toBe('sha256:00d82b9b439c2d721fabaf0da6c8e6027b338d7e82bffa3cc9ee0d37c070a376')
    expect(bundle.contracts).toHaveLength(9)
    expect(verifyContractsBundle(protocol, bundle)).toMatchObject({ ok: true, contractsBundleHash: 'sha256:7b342a7f51e8d4ac1695298ba80774834fd6984385b6ad7ed7348c2969ac0c99' })
    expect(protocol.stages[0].wal.commonRequiredIdentityFields).toEqual(['studyId', 'invocationId', 'attemptId', 'stage', 'requestScope', 'requestPurpose', 'requestHash', 'attemptOrdinal', 'timestamp'])
    expect(protocol.stages[0].wal).not.toHaveProperty('requiredIdentityFields')
    expect(protocol.stages[0].wal).not.toHaveProperty('nullableWhenNotApplicable')
  })

  it('fails closed on content, bundle, required-contract, and stage-contract mutations', async () => {
    const base = new URL('../calibration/diagnostics/', import.meta.url)
    const protocol = JSON.parse(await readFile(new URL('phase5c-c1b-v-confirmatory.v2.json', base)))
    const bundle = JSON.parse(await readFile(new URL('phase5c-c1b-v-confirmatory.v2.contracts.json', base)))
    const copy = (value) => structuredClone(value)
    const contentMutation = copy(bundle); contentMutation.contracts[0].canonicalContent.purpose += '!'
    expect(() => verifyContractsBundle(protocol, contentMutation)).toThrowError(expect.objectContaining({ code: 'SPECIFICATION_TAMPER' }))
    const bundleMutation = copy(bundle); bundleMutation.contractsBundleHash = bundleMutation.contractsBundleHash.replace(/.$/u, '0')
    expect(() => verifyContractsBundle(protocol, bundleMutation)).toThrowError(expect.objectContaining({ code: 'SPECIFICATION_TAMPER' }))
    const manifestMutation = copy(protocol); manifestMutation.contractBundle.requiredContracts[0].contentHash = 'sha256:bad'
    expect(() => verifyContractsBundle(manifestMutation, bundle)).toThrowError(expect.objectContaining({ code: 'SPECIFICATION_TAMPER' }))
    const stageMutation = copy(protocol); stageMutation.stages.find(({ stage }) => stage === 5).friendsClassificationContractHash = 'sha256:bad'
    expect(() => verifyContractsBundle(stageMutation, bundle)).toThrowError(expect.objectContaining({ code: 'SPECIFICATION_TAMPER' }))
    expect(canonicalSha256(bundle.contracts[0])).not.toBe(bundle.contracts[0].contentHash)
  })
})

describe('C1b-V2 Stage 0 request identity and WAL chain', () => {
  it('enforces the three scope-conditional identity shapes before mutation', async () => {
    expect(validateRequestIdentity(universeIdentity())).toMatchObject({ scopeId: 'page-1', candidateId: null })
    expect(validateRequestIdentity(candidateIdentity())).toMatchObject({ candidateId: 'candidate-1', arm: null })
    expect(validateRequestIdentity(inferenceIdentity())).toMatchObject({ arm: 'arm0', drawIndex: 1 })
    const invalid = [
      candidateIdentity({ requestPurpose: '' }), candidateIdentity({ requestScope: 'unknown' }),
      universeIdentity({ candidateId: 'forbidden' }), candidateIdentity({ candidateId: null }),
      candidateIdentity({ arm: 'arm0' }), inferenceIdentity({ arm: null }), inferenceIdentity({ drawIndex: null }),
    ]
    for (const identity of invalid) expect(() => validateRequestIdentity(identity)).toThrow(Stage0Error)
    const { walPath } = await fixture(); let transportCalls = 0
    await expect(executeRequest({ walPath, identity: candidateIdentity({ requestScope: 'unknown' }), transport: { dispatch: async () => { transportCalls++ } }, parseResponse: (x) => x })).rejects.toThrow()
    expect(transportCalls).toBe(0); expect(await exists(walPath)).toBe(false)
  })

  it('accepts a contiguous linked chain with explicit genesis and self-excluding hash rule', () => {
    const records = chain()
    expect(records[0].prevRecordHash).toBe(WAL_GENESIS_HASH)
    expect(canonicalSha256(Object.fromEntries(Object.entries(records[0]).filter(([key]) => key !== 'canonicalRecordHash')))).toBe(records[0].canonicalRecordHash)
    expect(validateWalRecords(records).lastRecordHash).toBe(records[2].canonicalRecordHash)
  })

  it.each([
    ['duplicate', (records) => [records[0], { ...records[1], seq: 0 }, records[2]]],
    ['skipped', (records) => [records[0], { ...records[1], seq: 2 }, records[2]]],
    ['decreasing', (records) => [{ ...records[0], seq: 1 }, { ...records[1], seq: 0 }, records[2]]],
    ['negative', (records) => [{ ...records[0], seq: -1 }, records[1], records[2]]],
    ['non-integer', (records) => [{ ...records[0], seq: 0.5 }, records[1], records[2]]],
    ['bad-genesis', (records) => [{ ...records[0], prevRecordHash: 'sha256:bad' }, records[1], records[2]]],
    ['reordered', (records) => [records[1], records[0], records[2]]],
    ['deleted', (records) => [records[0], records[2]]],
    ['spliced', (records) => [records[0], ...chain(candidateIdentity({ attemptId: 'other' })).slice(1)]],
    ['payload-mutation', (records) => [records[0], { ...records[1], payload: { response: { value: 9 } } }, records[2]]],
  ])('rejects %s chain corruption', (_name, mutate) => expect(() => validateWalRecords(mutate(chain()))).toThrow())

  it('rejects missing identity and lifecycle identity drift', () => {
    const records = chain()
    const missing = { ...records[1] }; delete missing.requestHash
    expect(() => validateWalRecords([records[0], missing])).toThrow()
    const changedIdentity = createWalRecord({ lifecycle: 'RESPONSE', identity: candidateIdentity({ candidateId: 'changed' }), payload: {}, seq: 1, prevRecordHash: records[0].canonicalRecordHash })
    expect(() => validateWalRecords([records[0], changedIdentity])).toThrowError(expect.objectContaining({ code: 'WAL_CORRUPTION' }))
    const falseCompletion = createWalRecord({ lifecycle: 'TERMINAL', identity: candidateIdentity(), payload: { disposition: 'COMPLETED' }, seq: 1, prevRecordHash: records[0].canonicalRecordHash })
    expect(() => validateWalRecords([records[0], falseCompletion])).toThrowError(expect.objectContaining({ code: 'WAL_CORRUPTION' }))
  })
})

describe('C1b-V2 Stage 0 durable ordering, recovery, and replay', () => {
  it('orders INTENT fsync before dispatch, RESPONSE fsync before parse, and TERMINAL fsync before completion', async () => {
    const { walPath } = await fixture(); const events = []
    const result = await executeRequest({ walPath, identity: candidateIdentity(), transport: { dispatch: async () => { events.push('transport-body'); return { raw: 4 } } }, parseResponse: (response) => { events.push('parse-body'); return { value: response.raw + 1 } }, onCompleted: () => events.push('complete-body'), onStep: (step) => events.push(step) })
    expect(result.output).toEqual({ value: 5 })
    const firstFsync = events.indexOf('wal-fsync-complete')
    expect(firstFsync).toBeLessThan(events.indexOf('transport-dispatch'))
    const responseFsync = events.indexOf('wal-fsync-complete', firstFsync + 1)
    expect(responseFsync).toBeLessThan(events.indexOf('parse-body'))
    const terminalFsync = events.indexOf('wal-fsync-complete', responseFsync + 1)
    expect(terminalFsync).toBeLessThan(events.indexOf('complete-body'))
  })

  it.each([
    ['INTENT append', 'intent-append-start', 'EMPTY'],
    ['INTENT fsync', 'intent-fsync-start', 'UNKNOWN_IN_FLIGHT'],
    ['RESPONSE append', 'response-append-start', 'UNKNOWN_IN_FLIGHT'],
    ['RESPONSE fsync', 'response-fsync-start', 'DURABLE_RESPONSE'],
    ['TERMINAL append', 'terminal-append-start', 'DURABLE_RESPONSE'],
    ['TERMINAL fsync', 'terminal-fsync-start', 'SURVIVED_TERMINAL'],
  ])('injects %s failure at its lifecycle-specific checkpoint and recovers safely', async (_label, failureStep, expectedRecovery) => {
    const { walPath } = await fixture(); const events = []
    let dispatchCalls = 0; let parseCalls = 0; let completedAdvances = 0
    const options = {
      walPath,
      identity: candidateIdentity(),
      transport: { dispatch: async () => { dispatchCalls++; return { value: 7 } } },
      parseResponse: ({ value }) => { parseCalls++; return { value } },
      onCompleted: () => { completedAdvances++ },
      onStep: (step) => { events.push(step); if (step === failureStep) throw new Error(`fault:${failureStep}`) },
    }
    await expect(executeRequest(options)).rejects.toThrow(`fault:${failureStep}`)
    expect(completedAdvances).toBe(0)
    if (failureStep.startsWith('intent-')) expect(dispatchCalls).toBe(0)
    if (failureStep.startsWith('response-')) expect(parseCalls).toBe(0)

    const recovered = await recoverWal(walPath)
    if (failureStep.startsWith('response-')) expect(recovered.records.some(({ lifecycle }) => lifecycle === 'TERMINAL')).toBe(false)
    const attempt = classifyAttempt(recovered.records, 'attempt-1')
    if (expectedRecovery === 'EMPTY') {
      expect(recovered.status).toBe('EMPTY'); expect(dispatchCalls).toBe(0)
      return
    }
    if (expectedRecovery === 'UNKNOWN_IN_FLIGHT') {
      expect(attempt).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE })
      const callsBeforeRerun = dispatchCalls
      await executeRequest({ ...options, onStep: () => {} })
      expect(dispatchCalls).toBe(callsBeforeRerun)
      expect(parseCalls).toBe(0); expect(completedAdvances).toBe(0)
      return
    }
    if (expectedRecovery === 'DURABLE_RESPONSE') {
      expect(attempt.status).toBe('DURABLE_RESPONSE')
      const callsBeforeRerun = dispatchCalls
      const replay = await executeRequest({ ...options, onStep: () => {} })
      expect(replay).toMatchObject({ status: 'COMPLETED', transportCalls: 0, output: { value: 7 } })
      expect(dispatchCalls).toBe(callsBeforeRerun); expect(completedAdvances).toBe(1)
      return
    }

    expect(attempt.status).toBe('COMPLETED')
    expect(completedAdvances).toBe(0)
    const durablePrefix = recovered.records.slice(0, 2)
    await writeChain(walPath, durablePrefix)
    const callsBeforeRerun = dispatchCalls
    const replay = await executeRequest({ ...options, onStep: () => {} })
    expect(replay).toMatchObject({ status: 'COMPLETED', transportCalls: 0, output: { value: 7 } })
    expect(dispatchCalls).toBe(callsBeforeRerun); expect(completedAdvances).toBe(1)
  })

  it('does not redispatch when a RESPONSE whose fsync failed is lost in the simulated crash', async () => {
    const { walPath } = await fixture(); let dispatchCalls = 0
    const options = {
      walPath,
      identity: candidateIdentity(),
      transport: { dispatch: async () => { dispatchCalls++; return { value: 7 } } },
      parseResponse: (response) => response,
      onStep: (step) => { if (step === 'response-fsync-start') throw new Error('response fsync fault') },
    }
    await expect(executeRequest(options)).rejects.toThrow('response fsync fault')
    const visible = await recoverWal(walPath)
    await writeChain(walPath, visible.records.slice(0, 1)) // simulate loss of the non-fsynced RESPONSE
    const rerun = await executeRequest({ ...options, onStep: () => {} })
    expect(rerun).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE, transportCalls: 0 })
    expect(dispatchCalls).toBe(1)
  })

  it('classifies crash-before-INTENT and crash-after-INTENT-before-dispatch', async () => {
    const before = await fixture(); expect(await recoverWal(before.walPath)).toMatchObject({ status: 'EMPTY', records: [] })
    let calls = 0
    await expect(executeRequest({ walPath: before.walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++ } }, parseResponse: (x) => x, fault: (point) => { if (point === 'after-intent') throw new Error('crash') } })).rejects.toThrow('crash')
    expect(calls).toBe(0)
    const recovered = await recoverWal(before.walPath)
    expect(classifyAttempt(recovered.records, 'attempt-1')).toEqual({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE })
    await executeRequest({ walPath: before.walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++ } }, parseResponse: (x) => x })
    expect(calls).toBe(0)
  })

  it('records an explicit pre-dispatch failure as PROVABLY_NOT_DISPATCHED without entering dispatch', async () => {
    const { walPath } = await fixture(); let dispatchCalls = 0
    const result = await executeRequest({ walPath, identity: candidateIdentity(), prepareDispatch: async () => { throw Object.assign(new Error('pre-dispatch check failed'), { code: 'PRE_DISPATCH' }) }, transport: { dispatch: async () => { dispatchCalls++ } }, parseResponse: (x) => x })
    expect(result).toMatchObject({ status: 'PROVABLY_NOT_DISPATCHED', transportCalls: 0 })
    expect(dispatchCalls).toBe(0)
    const recovered = await recoverWal(walPath)
    expect(classifyAttempt(recovered.records, 'attempt-1').status).toBe('PROVABLY_NOT_DISPATCHED')
  })

  it.each([
    ['dispatchOccurred=false metadata', Object.assign(new Error('post-entry failure'), { dispatchOccurred: false, sent: false, socketOpened: false })],
    ['generic error', new Error('generic transport failure')],
  ])('treats dispatch entered plus %s as UNKNOWN_IN_FLIGHT and never redispatches', async (_label, dispatchError) => {
    const { walPath } = await fixture(); let dispatchCalls = 0
    const options = { walPath, identity: candidateIdentity(), transport: { dispatch: async () => { dispatchCalls++; throw dispatchError } }, parseResponse: (x) => x }
    await expect(executeRequest(options)).rejects.toThrow(dispatchError.message)
    expect(dispatchCalls).toBe(1)
    const recovered = await recoverWal(walPath)
    expect(classifyAttempt(recovered.records, 'attempt-1')).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE })
    const rerun = await executeRequest(options)
    expect(rerun).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE, transportCalls: 0 })
    expect(dispatchCalls).toBe(1)
  })

  it('never redispatches after possible dispatch without a durable RESPONSE', async () => {
    const { walPath } = await fixture(); let calls = 0
    await expect(executeRequest({ walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++; throw new Error('connection lost after send') } }, parseResponse: (x) => x })).rejects.toThrow()
    expect(calls).toBe(1)
    const result = await executeRequest({ walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++ } }, parseResponse: (x) => x })
    expect(result).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE, transportCalls: 0 })
    expect(calls).toBe(1)
  })

  it.each(['after-response', 'after-parse'])('recovers deterministic state with zero redispatch after %s crash', async (crashPoint) => {
    const { walPath } = await fixture(); let calls = 0; let parseCalls = 0
    const options = { walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++; return { value: 6 } } }, parseResponse: (response) => { parseCalls++; return { value: response.value * 2 } }, fault: (point) => { if (point === crashPoint) throw new Error('crash') } }
    await expect(executeRequest(options)).rejects.toThrow('crash')
    const recovered = await executeRequest({ ...options, fault: () => {} })
    expect(recovered).toMatchObject({ status: 'COMPLETED', output: { value: 12 }, transportCalls: 0 })
    expect(calls).toBe(1); expect(parseCalls).toBe(crashPoint === 'after-response' ? 1 : 2)
  })

  it('replays completed immutable output byte-identically with zero transport calls', async () => {
    const { walPath } = await fixture(); let calls = 0
    const options = { walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++; return { value: 1 } } }, parseResponse: () => ({ b: 2, a: 1 }) }
    const first = await executeRequest(options); const second = await executeRequest(options)
    expect(canonicalize(second.output)).toBe(canonicalize(first.output)); expect(second.replayed).toBe(true); expect(calls).toBe(1)
  })

  it('recovers after durable TERMINAL but before completed-state advancement', async () => {
    const { walPath } = await fixture(); let calls = 0; let completedAdvances = 0
    const options = { walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++; return { value: 3 } } }, parseResponse: ({ value }) => ({ value }), onCompleted: () => { completedAdvances++ }, fault: (point) => { if (point === 'after-terminal') throw new Error('crash') } }
    await expect(executeRequest(options)).rejects.toThrow('crash')
    const replay = await executeRequest({ ...options, fault: () => {} })
    expect(replay).toMatchObject({ status: 'COMPLETED', replayed: true, output: { value: 3 }, transportCalls: 0 })
    expect(calls).toBe(1); expect(completedAdvances).toBe(0)
  })

  it('preserves a torn forensic source and exposes only its valid prefix', async () => {
    const { walPath } = await fixture(); const records = chain().slice(0, 2)
    await writeChain(walPath, records, '\n{"lifecycle":"TER')
    const before = await readFile(walPath, 'utf8'); const recovered = await recoverWal(walPath)
    expect(recovered).toMatchObject({ status: 'TORN_TRAILING_RECORD', records })
    expect(await readFile(walPath, 'utf8')).toBe(before)
    let calls = 0
    expect(await executeRequest({ walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++ } }, parseResponse: (x) => x })).toMatchObject({ status: 'TORN_TRAILING_RECORD', transportCalls: 0 })
    expect(calls).toBe(0); expect(await readFile(walPath, 'utf8')).toBe(before)
  })

  it.each(['interior-malformed', 'checksum', 'broken-link'])('fails closed and preserves forensic WAL for %s corruption', async (kind) => {
    const { walPath } = await fixture(); const records = chain()
    if (kind === 'interior-malformed') await writeFile(walPath, `${canonicalize(records[0])}\n{bad}\n${canonicalize(records[2])}\n`)
    else {
      if (kind === 'checksum') records[1].canonicalRecordHash = 'sha256:bad'
      else records[1].prevRecordHash = 'sha256:bad'
      await writeChain(walPath, records)
    }
    const before = await readFile(walPath, 'utf8')
    expect(await recoverWal(walPath)).toMatchObject({ status: 'WAL_CORRUPTION', outcome: OPERATIONALLY_INCONCLUSIVE })
    expect(await readFile(walPath, 'utf8')).toBe(before)
  })

  it('treats a complete trailing duplicate-key record as corruption, not a torn frame', async () => {
    const { walPath } = await fixture(); const intent = chain()[0]
    await writeFile(walPath, `${canonicalize(intent)}\n{"seq":1,"seq":1}\n`)
    expect(await recoverWal(walPath)).toMatchObject({ status: 'WAL_CORRUPTION', outcome: OPERATIONALLY_INCONCLUSIVE })
  })
})

describe('C1b-V2 Stage 0 RUN_LOCK and atomic artifacts', () => {
  it('acquires exclusively, durably, and never TTL-clears stale or concurrent locks', async () => {
    const { lockPath } = await fixture(); const events = []
    await acquireRunLock(lockPath, { invocationId: 'one' }, { onStep: (step) => events.push(step) })
    expect(events).toEqual(['lock-write-complete', 'lock-fsync-complete', 'lock-parent-fsync-complete'])
    await expect(acquireRunLock(lockPath, { invocationId: 'two' })).rejects.toThrowError(expect.objectContaining({ code: 'RUN_LOCK_HELD' }))
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual({ invocationId: 'one' })
    await writeFile(lockPath, '{"createdAt":"2000-01-01T00:00:00Z"}')
    await expect(acquireRunLock(lockPath, { invocationId: 'three' })).rejects.toThrowError(expect.objectContaining({ code: 'RUN_LOCK_HELD' }))
    expect(await readFile(lockPath, 'utf8')).toContain('2000-01-01')
  })

  it('atomically replaces only after temp write/fsync/rename/parent-fsync', async () => {
    const { artifactPath } = await fixture(); const events = []
    await atomicWriteArtifact(artifactPath, { b: 2, a: 1 }, { onStep: (step) => events.push(step) })
    expect(events).toEqual(['artifact-temp-write-complete', 'artifact-temp-fsync-complete', 'artifact-rename-complete', 'artifact-parent-fsync-complete'])
    expect(await readFile(artifactPath, 'utf8')).toBe('{"a":1,"b":2}')
  })

  it.each(['artifact-temp-write-complete', 'artifact-temp-fsync-complete', 'artifact-rename-complete', 'artifact-parent-fsync-complete'])('runs no later artifact step after injected %s fault', async (failureStep) => {
    const { artifactPath } = await fixture(); const events = []
    await expect(atomicWriteArtifact(artifactPath, 'complete-bytes', { onStep: (step) => { events.push(step); if (step === failureStep) throw new Error('fault') } })).rejects.toThrow('fault')
    const failureIndex = events.indexOf(failureStep)
    expect(events).toHaveLength(failureIndex + 1)
    if (!['artifact-rename-complete', 'artifact-parent-fsync-complete'].includes(failureStep)) expect(await exists(artifactPath)).toBe(false)
    else expect(await readFile(artifactPath, 'utf8')).toBe('complete-bytes')
  })

  it.each(['lock-write-complete', 'lock-fsync-complete', 'lock-parent-fsync-complete'])('runs no later lock step after injected %s fault and leaves reviewable lock evidence', async (failureStep) => {
    const { lockPath } = await fixture(); const events = []
    await expect(acquireRunLock(lockPath, { invocationId: 'faulted' }, { onStep: (step) => { events.push(step); if (step === failureStep) throw new Error('fault') } })).rejects.toThrow('fault')
    expect(events).toHaveLength(events.indexOf(failureStep) + 1)
    expect(await exists(lockPath)).toBe(true)
    await expect(acquireRunLock(lockPath, { invocationId: 'later' })).rejects.toThrowError(expect.objectContaining({ code: 'RUN_LOCK_HELD' }))
  })

  it('enforces the central invariant: ambiguous state or a second runner cannot silently request transport', async () => {
    const locked = await fixture(); let calls = 0
    await acquireRunLock(locked.lockPath, { invocationId: 'first' })
    await expect(acquireRunLock(locked.lockPath, { invocationId: 'second' })).rejects.toThrowError(expect.objectContaining({ code: 'RUN_LOCK_HELD' }))
    expect(await exists(locked.walPath)).toBe(false); expect(calls).toBe(0)

    const ambiguous = await fixture(); await writeChain(ambiguous.walPath, chain().slice(0, 1))
    const result = await executeRequest({ walPath: ambiguous.walPath, identity: candidateIdentity(), transport: { dispatch: async () => { calls++ } }, parseResponse: (x) => x })
    expect(result).toMatchObject({ status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE, transportCalls: 0 })
    expect(calls).toBe(0)
  })
})
