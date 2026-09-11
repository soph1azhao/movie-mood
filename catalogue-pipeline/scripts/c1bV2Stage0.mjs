// C1b-V2 Stage 0: crash-safe execution primitives. This module deliberately
// contains no concrete transport and therefore cannot initiate network I/O.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export const WAL_GENESIS_HASH = `sha256:${'0'.repeat(64)}`
export const OPERATIONALLY_INCONCLUSIVE = 'OPERATIONALLY_INCONCLUSIVE'

export class Stage0Error extends Error {
  constructor(message, code = 'STAGE0_ERROR', details = undefined) {
    super(message)
    this.name = 'Stage0Error'
    this.code = code
    this.details = details
  }
}

function assertJcsValue(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Stage0Error('JCS rejects lone Unicode surrogates.', 'INVALID_JCS_VALUE')
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Stage0Error('JCS rejects non-finite numbers.', 'INVALID_JCS_VALUE')
    return
  }
  if (typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof Date) throw new Stage0Error('Value is not an I-JSON value.', 'INVALID_JCS_VALUE')
  if (seen.has(value)) throw new Stage0Error('JCS rejects cyclic values.', 'INVALID_JCS_VALUE')
  seen.add(value)
  const children = Array.isArray(value) ? value : Object.values(value)
  for (const child of children) assertJcsValue(child, seen)
  seen.delete(value)
}

// RFC 8785 uses ECMAScript number/string serialization and UTF-16 code-unit key order.
export function canonicalize(value) {
  assertJcsValue(value)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

export function canonicalSha256(value) {
  return `sha256:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`
}

// A small JSON parser wrapper whose scanner rejects duplicate object members
// before JSON.parse can silently apply last-wins semantics.
export function parseJsonRejectingDuplicateKeys(source) {
  let index = 0
  const fail = (message) => { throw new Stage0Error(`${message} at byte ${index}.`, 'INVALID_JSON') }
  const whitespace = () => { while (/\s/u.test(source[index] ?? '')) index++ }
  const stringToken = () => {
    const start = index
    if (source[index++] !== '"') fail('Expected string')
    while (index < source.length) {
      if (source[index] === '"') { index++; return JSON.parse(source.slice(start, index)) }
      if (source[index] === '\\') {
        index++
        if (source[index] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(index + 1, index + 5))) fail('Invalid Unicode escape')
          index += 5
        } else if ('"\\/bfnrt'.includes(source[index] ?? '')) index++
        else fail('Invalid escape')
      } else {
        if (source.charCodeAt(index) < 0x20) fail('Unescaped control character')
        index++
      }
    }
    fail('Unterminated string')
  }
  const value = () => {
    whitespace()
    if (source[index] === '{') {
      index++; whitespace()
      const keys = new Set()
      if (source[index] === '}') { index++; return }
      while (true) {
        whitespace(); const key = stringToken()
        if (keys.has(key)) throw new Stage0Error(`Duplicate JSON member name: ${key}`, 'DUPLICATE_JSON_KEY')
        keys.add(key); whitespace()
        if (source[index++] !== ':') fail('Expected colon')
        value(); whitespace()
        if (source[index] === '}') { index++; return }
        if (source[index++] !== ',') fail('Expected comma')
      }
    }
    if (source[index] === '[') {
      index++; whitespace()
      if (source[index] === ']') { index++; return }
      while (true) {
        value(); whitespace()
        if (source[index] === ']') { index++; return }
        if (source[index++] !== ',') fail('Expected comma')
      }
    }
    if (source[index] === '"') { stringToken(); return }
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(source.slice(index))
    if (!match) fail('Invalid value')
    index += match[0].length
  }
  value(); whitespace()
  if (index !== source.length) fail('Trailing content')
  return JSON.parse(source)
}

const COMMON_IDENTITY_FIELDS = Object.freeze(['studyId', 'invocationId', 'attemptId', 'stage', 'requestScope', 'requestPurpose', 'requestHash', 'attemptOrdinal', 'timestamp'])
const IMMUTABLE_ATTEMPT_FIELDS = Object.freeze(['studyId', 'invocationId', 'attemptId', 'stage', 'requestScope', 'requestPurpose', 'requestHash', 'attemptOrdinal', 'scopeId', 'candidateId', 'arm', 'drawIndex'])

function requiredNonEmpty(identity, field) {
  if (!Object.hasOwn(identity, field) || identity[field] === null || identity[field] === undefined || (typeof identity[field] === 'string' && identity[field].length === 0)) throw new Stage0Error(`Missing required identity field: ${field}`, 'INVALID_REQUEST_IDENTITY')
}

export function validateRequestIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new Stage0Error('Request identity must be an object.', 'INVALID_REQUEST_IDENTITY')
  for (const field of COMMON_IDENTITY_FIELDS) requiredNonEmpty(identity, field)
  if (!Number.isInteger(identity.stage) || identity.stage < 0 || !Number.isInteger(identity.attemptOrdinal) || identity.attemptOrdinal < 0) throw new Stage0Error('stage and attemptOrdinal must be non-negative integers.', 'INVALID_REQUEST_IDENTITY')
  if (!['universe', 'candidate', 'inference'].includes(identity.requestScope)) throw new Stage0Error('Unknown requestScope.', 'INVALID_REQUEST_SCOPE')
  const mustBeNull = (field) => { if (!Object.hasOwn(identity, field) || identity[field] !== null) throw new Stage0Error(`${field} must be explicitly null for ${identity.requestScope} scope.`, 'INVALID_REQUEST_IDENTITY') }
  if (identity.requestScope === 'universe') {
    requiredNonEmpty(identity, 'scopeId'); mustBeNull('candidateId'); mustBeNull('arm'); mustBeNull('drawIndex')
  } else if (identity.requestScope === 'candidate') {
    requiredNonEmpty(identity, 'candidateId'); mustBeNull('arm'); mustBeNull('drawIndex')
    if (Object.hasOwn(identity, 'scopeId') && identity.scopeId !== null && (typeof identity.scopeId !== 'string' || identity.scopeId.length === 0)) throw new Stage0Error('scopeId must be non-empty or null.', 'INVALID_REQUEST_IDENTITY')
  } else {
    requiredNonEmpty(identity, 'candidateId'); requiredNonEmpty(identity, 'arm'); requiredNonEmpty(identity, 'drawIndex')
    if (Object.hasOwn(identity, 'scopeId') && identity.scopeId !== null && (typeof identity.scopeId !== 'string' || identity.scopeId.length === 0)) throw new Stage0Error('scopeId must be non-empty or null.', 'INVALID_REQUEST_IDENTITY')
    if (!Number.isInteger(identity.drawIndex) || identity.drawIndex < 0) throw new Stage0Error('drawIndex must be a non-negative integer.', 'INVALID_REQUEST_IDENTITY')
  }
  return Object.freeze({ ...identity })
}

export function recordHashInput(record) {
  // canonicalRecordHash = SHA-256(JCS(record without canonicalRecordHash)).
  // Excluding only the self-referential field keeps seq and prevRecordHash signed.
  const { canonicalRecordHash: _self, ...hashInput } = record
  return hashInput
}

export function createWalRecord({ lifecycle, identity, payload = null, seq, prevRecordHash }) {
  validateRequestIdentity(identity)
  if (!['INTENT', 'RESPONSE', 'TERMINAL'].includes(lifecycle)) throw new Stage0Error('Invalid WAL lifecycle.', 'INVALID_WAL_LIFECYCLE')
  if (!Number.isInteger(seq) || seq < 0) throw new Stage0Error('WAL sequence must be a non-negative integer.', 'INVALID_WAL_SEQUENCE')
  if (typeof prevRecordHash !== 'string') throw new Stage0Error('prevRecordHash is required.', 'INVALID_WAL_LINK')
  const unsigned = { lifecycle, ...identity, payload, seq, prevRecordHash }
  return { ...unsigned, canonicalRecordHash: canonicalSha256(unsigned) }
}

function sameAttempt(left, right) { return left.attemptId === right.attemptId }
function assertLifecycleIdentity(first, record) {
  for (const field of IMMUTABLE_ATTEMPT_FIELDS) if ((first[field] ?? null) !== (record[field] ?? null)) throw new Stage0Error(`Attempt identity changed at ${field}.`, 'WAL_CORRUPTION')
}

export function validateWalRecords(records) {
  let previousHash = WAL_GENESIS_HASH
  const firstByAttempt = new Map()
  const lifecycleByAttempt = new Map()
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    validateRequestIdentity(record)
    if (!Number.isInteger(record.seq) || record.seq < 0 || record.seq !== index) throw new Stage0Error('WAL sequence is not contiguous from zero.', 'WAL_CORRUPTION')
    if (record.prevRecordHash !== previousHash) throw new Stage0Error('Broken WAL prevRecordHash link.', 'WAL_CORRUPTION')
    if (canonicalSha256(recordHashInput(record)) !== record.canonicalRecordHash) throw new Stage0Error('WAL canonicalRecordHash mismatch.', 'WAL_CORRUPTION')
    const first = firstByAttempt.get(record.attemptId)
    if (first) assertLifecycleIdentity(first, record)
    else firstByAttempt.set(record.attemptId, record)
    const prior = lifecycleByAttempt.get(record.attemptId) ?? []
    const expected = prior.length === 0 ? 'INTENT' : prior.at(-1) === 'INTENT' ? ['RESPONSE', 'TERMINAL'] : prior.at(-1) === 'RESPONSE' ? ['TERMINAL'] : []
    if (!(Array.isArray(expected) ? expected.includes(record.lifecycle) : record.lifecycle === expected)) throw new Stage0Error('Invalid WAL lifecycle transition.', 'WAL_CORRUPTION')
    if (record.lifecycle === 'TERMINAL') {
      const expectedDisposition = prior.at(-1) === 'INTENT' ? 'PROVABLY_NOT_DISPATCHED' : 'COMPLETED'
      if (record.payload?.disposition !== expectedDisposition) throw new Stage0Error('TERMINAL disposition does not match its durable predecessor.', 'WAL_CORRUPTION')
    }
    prior.push(record.lifecycle); lifecycleByAttempt.set(record.attemptId, prior)
    previousHash = record.canonicalRecordHash
  }
  return { records, lastRecordHash: previousHash }
}

export function classifyAttempt(records, attemptId) {
  const attempt = records.filter((record) => record.attemptId === attemptId)
  if (!attempt.length) return { status: 'NO_DURABLE_ATTEMPT', outcome: null }
  const terminal = attempt.find((record) => record.lifecycle === 'TERMINAL')
  const response = attempt.find((record) => record.lifecycle === 'RESPONSE')
  if (terminal?.payload?.disposition === 'PROVABLY_NOT_DISPATCHED') return { status: 'PROVABLY_NOT_DISPATCHED', outcome: null, terminal }
  if (terminal) return { status: 'COMPLETED', outcome: null, terminal, response }
  if (response) return { status: 'DURABLE_RESPONSE', outcome: null, response }
  return { status: 'UNKNOWN_IN_FLIGHT', outcome: OPERATIONALLY_INCONCLUSIVE }
}

export async function recoverWal(path) {
  let source
  try { source = await readFile(path, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return { status: 'EMPTY', outcome: null, records: [], lastRecordHash: WAL_GENESIS_HASH }
    throw error
  }
  if (source.length === 0) return { status: 'EMPTY', outcome: null, records: [], lastRecordHash: WAL_GENESIS_HASH }
  const frames = source.split('\n')
  if (frames.at(-1) === '') frames.pop()
  const records = []
  for (let index = 0; index < frames.length; index++) {
    try { records.push(parseJsonRejectingDuplicateKeys(frames[index])) } catch (error) {
      if (index === frames.length - 1 && isIncompleteJsonFrame(frames[index])) {
        try { validateWalRecords(records) } catch { return { status: 'WAL_CORRUPTION', outcome: OPERATIONALLY_INCONCLUSIVE, records: [] } }
        return { status: 'TORN_TRAILING_RECORD', outcome: null, records, lastRecordHash: records.at(-1)?.canonicalRecordHash ?? WAL_GENESIS_HASH }
      }
      return { status: 'WAL_CORRUPTION', outcome: OPERATIONALLY_INCONCLUSIVE, records: [] }
    }
  }
  try { return { status: 'VALID', outcome: null, ...validateWalRecords(records) } } catch { return { status: 'WAL_CORRUPTION', outcome: OPERATIONALLY_INCONCLUSIVE, records: [] } }
}

function isIncompleteJsonFrame(frame) {
  let depth = 0; let inString = false; let escaped = false
  for (const character of frame) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') inString = true
    else if (character === '{' || character === '[') depth++
    else if (character === '}' || character === ']') depth--
  }
  return inString || depth > 0
}

export async function appendWalRecord(path, record, { onStep = () => {} } = {}) {
  const lifecycle = record.lifecycle.toLowerCase()
  onStep(`${lifecycle}-append-start`)
  onStep('wal-append-start')
  const handle = await open(path, 'a', 0o600)
  try {
    await handle.writeFile(`${canonicalize(record)}\n`, 'utf8')
    onStep(`${lifecycle}-append-complete`)
    onStep('wal-append-complete')
    onStep(`${lifecycle}-fsync-start`)
    await handle.sync()
    onStep(`${lifecycle}-fsync-complete`)
    onStep('wal-fsync-complete')
  } finally { await handle.close() }
}

async function syncDirectory(path) { const handle = await open(path, constants.O_RDONLY); try { await handle.sync() } finally { await handle.close() } }

export async function acquireRunLock(path, contents, { onStep = () => {} } = {}) {
  let handle
  try { handle = await open(path, 'wx', 0o600) } catch (error) {
    if (error.code === 'EEXIST') throw new Stage0Error('RUN_LOCK already exists; controlled recovery review is required.', 'RUN_LOCK_HELD')
    throw error
  }
  try {
    await handle.writeFile(canonicalize(contents), 'utf8'); onStep('lock-write-complete')
    await handle.sync(); onStep('lock-fsync-complete')
  } finally { await handle.close() }
  await syncDirectory(dirname(path)); onStep('lock-parent-fsync-complete')
  return { path }
}

export async function releaseRunLock(lock) { await unlink(lock.path); await syncDirectory(dirname(lock.path)) }

export async function atomicWriteArtifact(path, value, { tempPath = `${path}.tmp`, onStep = () => {} } = {}) {
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(typeof value === 'string' ? value : canonicalize(value), 'utf8'); onStep('artifact-temp-write-complete')
    await handle.sync(); onStep('artifact-temp-fsync-complete')
  } finally { await handle.close() }
  await rename(tempPath, path); onStep('artifact-rename-complete')
  await syncDirectory(dirname(path)); onStep('artifact-parent-fsync-complete')
}

export async function executeRequest({ walPath, identity, transport, prepareDispatch = async () => undefined, parseResponse, onCompleted = () => {}, onStep = () => {}, fault = () => {} }) {
  validateRequestIdentity(identity) // fail before all mutation and transport
  const recovered = await recoverWal(walPath)
  if (recovered.status === 'WAL_CORRUPTION') return { status: OPERATIONALLY_INCONCLUSIVE, transportCalls: 0 }
  if (recovered.status === 'TORN_TRAILING_RECORD') return { status: 'TORN_TRAILING_RECORD', recovery: classifyAttempt(recovered.records, identity.attemptId), transportCalls: 0 }
  const existing = classifyAttempt(recovered.records, identity.attemptId)
  const existingFirst = recovered.records.find((record) => record.attemptId === identity.attemptId)
  if (existingFirst) assertLifecycleIdentity(existingFirst, identity)
  if (existing.status === 'UNKNOWN_IN_FLIGHT') return { ...existing, transportCalls: 0 }
  if (existing.status === 'COMPLETED') return { status: 'COMPLETED', output: existing.terminal.payload.output, replayed: true, transportCalls: 0 }
  const finishResponse = async (responseRecord, replayed) => {
    fault('before-parse')
    const output = await parseResponse(responseRecord.payload.response)
    onStep('parse-complete'); fault('after-parse')
    const terminal = createWalRecord({ lifecycle: 'TERMINAL', identity, payload: { disposition: 'COMPLETED', output }, seq: recovered.records.length + (replayed ? 0 : 2), prevRecordHash: responseRecord.canonicalRecordHash })
    await appendWalRecord(walPath, terminal, { onStep }); fault('after-terminal')
    await onCompleted(output); onStep('completed-state-advanced')
    return { status: 'COMPLETED', output, replayed, transportCalls: replayed ? 0 : 1 }
  }
  if (existing.status === 'DURABLE_RESPONSE') return finishResponse(existing.response, true)
  if (existing.status === 'PROVABLY_NOT_DISPATCHED') return { ...existing, transportCalls: 0 }

  const intent = createWalRecord({ lifecycle: 'INTENT', identity, payload: null, seq: recovered.records.length, prevRecordHash: recovered.lastRecordHash })
  await appendWalRecord(walPath, intent, { onStep }); fault('after-intent')
  let preparedDispatch
  try {
    onStep('pre-dispatch-start')
    preparedDispatch = await prepareDispatch()
    onStep('pre-dispatch-complete')
  } catch (error) {
    const terminal = createWalRecord({ lifecycle: 'TERMINAL', identity, payload: { disposition: 'PROVABLY_NOT_DISPATCHED', errorCode: error.code ?? 'PRE_DISPATCH_FAILURE' }, seq: intent.seq + 1, prevRecordHash: intent.canonicalRecordHash })
    await appendWalRecord(walPath, terminal, { onStep })
    return { status: 'PROVABLY_NOT_DISPATCHED', transportCalls: 0 }
  }
  onStep('transport-dispatch')
  const response = await transport.dispatch(preparedDispatch)
  onStep('transport-response')
  fault('after-dispatch')
  const responseRecord = createWalRecord({ lifecycle: 'RESPONSE', identity, payload: { response }, seq: intent.seq + 1, prevRecordHash: intent.canonicalRecordHash })
  await appendWalRecord(walPath, responseRecord, { onStep }); fault('after-response')
  return finishResponse(responseRecord, false)
}

export function verifyContractsBundle(protocol, bundle) {
  const computedManifest = bundle.contracts.map(({ id, version, canonicalContent, contentHash }) => {
    const computed = canonicalSha256(canonicalContent)
    if (computed !== contentHash) throw new Stage0Error(`Contract hash mismatch: ${id}`, 'SPECIFICATION_TAMPER')
    return { id, version, contentHash: computed }
  })
  if (canonicalize(computedManifest) !== canonicalize(bundle.orderedContractManifest) || canonicalSha256(computedManifest) !== bundle.contractsBundleHash || protocol.contractBundle.contractsBundleHash !== bundle.contractsBundleHash || canonicalize(protocol.contractBundle.requiredContracts) !== canonicalize(computedManifest)) throw new Stage0Error('Contract bundle mismatch.', 'SPECIFICATION_TAMPER')
  const verifyRefs = (value, location = 'protocol') => {
    if (!value || typeof value !== 'object') return
    for (const [key, ref] of Object.entries(value)) {
      if (key.endsWith('ContractRef') || key === 'contractRef') {
        const hashKey = `${key.slice(0, -3)}Hash`
        const contract = computedManifest.find(({ id }) => id === ref)
        if (!contract || contract.contentHash !== value[hashKey]) throw new Stage0Error(`Stage contract mismatch at ${location}.${key}`, 'SPECIFICATION_TAMPER')
      }
    }
    for (const [key, child] of Object.entries(value)) verifyRefs(child, `${location}.${key}`)
  }
  verifyRefs(protocol.stages)
  return { ok: true, computedManifest, contractsBundleHash: bundle.contractsBundleHash }
}
