import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildCriticGeminiSchema, buildEditorialGeminiSchema, buildGemini38Request, executeGemini38Structured, GEMINI_EDITORIAL_MODEL_ID, GEMINI_EDITORIAL_PROVIDER_ID, THINKING_LEVELS } from '../adapters/geminiEditorialProvider.mjs'
import { checkEditorialVoice } from './checkEditorialVoice.mjs'
import { buildCriticInputPacket, createCriticResumeKey, createPilotResumeKey, CRITIC_MAX_OUTPUT_TOKENS, PILOT_ID, WRITER_MAX_OUTPUT_TOKENS } from './editorialPilot.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateCriticOutput, validateEditorialOutput } from './validateBatch.mjs'
import { normalizeGeminiUsage } from './editorialEfficiencyAudit.mjs'

const MAX_ATTEMPTS = 2

function root(repoRoot) { return path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion', PILOT_ID) }
function jsonPath(repoRoot) { return path.join(root(repoRoot), 'review/pilot-results.json') }
async function readJson(filePath) { return JSON.parse(await readFile(filePath, 'utf8')) }
async function writeCanonical(filePath, value) { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, serializeArtifactForPersistence(value)) }
async function writeRaw(filePath, value) { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, value) }
async function existingAttempts(dir) {
  try { return (await readdir(dir)).filter((name) => /^raw-response\.attempt-\d+\.json$/.test(name)).length } catch { return 0 }
}
async function totalPreservedCalls(repoRoot) {
  let total = 0
  for (const stage of ['writers', 'critics']) {
    const stageRoot = path.join(root(repoRoot), 'execution', stage)
    try {
      for (const candidateId of await readdir(stageRoot)) total += await existingAttempts(path.join(stageRoot, candidateId))
    } catch {}
  }
  return total
}

function emptyResults(manifest) {
  return { schemaVersion: 'editorial-pilot-results.v1', pilotId: PILOT_ID, configuration: manifest.configuration, externalCalls: { model: 0, total: 0 }, pricingMetadata: { status: 'unavailable', reason: 'No price is embedded in promotion validity; report-only pricing must be supplied separately.' }, records: manifest.packets.map(({ order, candidateId, tmdbId, title, packetPath, v8_2ArtifactHash, writerResumeKey }) => ({ order, candidateId, tmdbId, title, writerPacketPath: packetPath, writerPacketHash: v8_2ArtifactHash, writerResumeKey, writer: { terminalState: 'PENDING', attempts: [] }, critic: { terminalState: 'PENDING', attempts: [] }, humanDecision: 'PENDING' })) }
}

async function loadResults(repoRoot, manifest) {
  try { return await readJson(jsonPath(repoRoot)) } catch { return emptyResults(manifest) }
}

function allowedSourceRefs(packet) { return new Set(packet.allowedSourceMaterial?.sourceRefs ?? []) }
export function validateWriterForCritic({ output, packet }) {
  const base = validateEditorialOutput(output)
  const hardFailures = [...base.hardFailures]
  if (output.movie?.candidateId !== packet.candidateId || output.movie?.tmdbId !== packet.tmdbId) hardFailures.push({ code: 'WRITER_IDENTITY_MISMATCH', message: 'Writer output identity does not match its immutable packet.' })
  for (const sourceRef of output.writerNotes?.spoilerBoundary?.sourceRefs ?? []) {
    if (!allowedSourceRefs(packet).has(sourceRef)) hardFailures.push({ code: 'WRITER_SOURCE_REF_UNAUTHORIZED', message: `writerNotes sourceRef is not authorized: ${sourceRef}` })
  }
  const voiceReviewFlags = checkEditorialVoice(output.copy)
  return { ok: hardFailures.length === 0, hardFailures, reviewFlags: [...base.reviewFlags, ...voiceReviewFlags], voiceHardGate: { ok: true, hardFailures: [] } }
}

function editorialArtifact(packet, output) {
  return { schemaVersion: 'editorial-artifact.v1', candidateId: packet.candidateId, tmdbId: packet.tmdbId, output, sourceHashes: Object.fromEntries(Object.entries(packet.sourceBindings).map(([key, value]) => [key, value.v8_2ArtifactHash])) }
}
function criticArtifact(packet, editorialHash, output) {
  return { schemaVersion: 'critic-artifact.v1', candidateId: packet.candidateId, tmdbId: packet.tmdbId, output, sourceHashes: { semanticArtifact: packet.sourceBindings.semanticArtifact.v8_2ArtifactHash, evidencePacket: packet.sourceBindings.evidencePacket.v8_2ArtifactHash, factsRecord: packet.sourceBindings.factsRecord.v8_2ArtifactHash, editorialArtifact: editorialHash }, independence: { writerHiddenReasoningProvided: false } }
}

async function dispatch({ stage, repoRoot, record, packet, promptText, schema, thinkingLevel, maxOutputTokens, apiKey, fetchImpl, sleep, validate, artifactBuilder, resumeKey }) {
  const request = buildGemini38Request({ promptText, input: packet, responseSchema: schema, thinkingLevel, maxOutputTokens })
  const dir = path.join(root(repoRoot), 'execution', stage, record.candidateId)
  await writeCanonical(path.join(dir, 'request.json'), { ...request.requestMetadata, providerId: GEMINI_EDITORIAL_PROVIDER_ID, modelId: GEMINI_EDITORIAL_MODEL_ID, thinkingLevel, maxOutputTokens, resumeKey })
  const existingAttemptCount = await existingAttempts(dir)
  if (existingAttemptCount >= MAX_ATTEMPTS) return { terminalState: `${stage === 'writers' ? 'WRITER' : 'CRITIC'}_PROVIDER_FAILED`, attempts: [], request: request.requestMetadata, resumeKey, error: { code: 'ATTEMPT_BUDGET_EXHAUSTED', category: 'provider-http', status: null, message: 'Preserved attempts already exhaust this candidate budget.' }, attemptCount: existingAttemptCount }
  const attempts = []
  try {
    const result = await executeGemini38Structured({ apiKey, request, fetchImpl, sleep, maxAttempts: MAX_ATTEMPTS, preserveRawResponse: async ({ attempt, status, rawText, rawResponseHash }) => {
      const rawPath = path.join(dir, `raw-response.attempt-${String(attempt).padStart(2, '0')}.json`)
      await writeRaw(rawPath, rawText)
      attempts.push({ attempt, status, rawResponsePath: path.relative(repoRoot, rawPath), rawResponseHash })
    }, startingAttempt: existingAttemptCount, validateOutput: () => ({ ok: true }) })
    const validation = validate(result.output)
    const artifact = artifactBuilder(packet, result.output)
    const artifactHash = hashArtifact(artifact)
    const outputPath = path.join(dir, `${stage}-output.json`)
    const artifactPath = path.join(dir, `${stage}-artifact.json`)
    await writeCanonical(outputPath, result.output)
    await writeCanonical(artifactPath, artifact)
    return { terminalState: validation.ok ? `${stage === 'writers' ? 'WRITER' : 'CRITIC'}_VALID` : `${stage === 'writers' ? 'WRITER_HARD_INVALID' : 'CRITIC_HARD_INVALID'}`, attempts, request: request.requestMetadata, resumeKey, outputPath: path.relative(repoRoot, outputPath), outputHash: hashArtifact(result.output), artifactPath: path.relative(repoRoot, artifactPath), artifactHash, validation, usageMetadata: result.usageMetadata, tokenAccounting: normalizeGeminiUsage(result.usageMetadata), attemptCount: result.attempt }
  } catch (error) {
    return { terminalState: error.ambiguous ? `${stage === 'writers' ? 'WRITER_AMBIGUOUS' : 'CRITIC_AMBIGUOUS'}` : `${stage === 'writers' ? 'WRITER_PROVIDER_FAILED' : 'CRITIC_PROVIDER_FAILED'}`, attempts, request: request.requestMetadata, resumeKey, error: { code: error.code ?? 'UNEXPECTED_ERROR', category: error.category ?? 'unknown', status: error.status ?? null, message: error.message }, attemptCount: attempts.length }
  }
}

function addCalls(results, record) { const calls = record.attempts.length; results.externalCalls.model += calls; results.externalCalls.total += calls }
function requiresStop(result) { return result.terminalState.endsWith('_AMBIGUOUS') || result.error?.category === 'configuration' || result.error?.status === 400 }

export async function runWriters({ repoRoot, execute = false, apiKey = process.env.GEMINI_API_KEY, fetchImpl = globalThis.fetch, sleep } = {}) {
  if (!execute) throw new Error('Live writer execution requires the explicit --execute flag.')
  if (!apiKey) throw new Error('GEMINI_API_KEY is required from the environment.')
  const manifest = await readJson(path.join(root(repoRoot), 'pilot-manifest.json'))
  const promptText = await readFile(path.join(repoRoot, manifest.promptBindings.writer.path), 'utf8')
  const results = await loadResults(repoRoot, manifest)
  for (const record of results.records) {
    if (record.writer.terminalState !== 'PENDING') continue
    const packet = await readJson(path.join(repoRoot, record.writerPacketPath))
    if (hashBytes(serializeArtifactForPersistence(packet)) !== record.writerPacketHash) throw new Error(`Writer packet hash mismatch: ${record.candidateId}`)
    const schema = buildEditorialGeminiSchema(record)
    const resumeKey = createPilotResumeKey({ stage: 'editorial-writer', candidateId: record.candidateId, tmdbId: record.tmdbId, packetHash: record.writerPacketHash, promptHash: hashBytes(promptText), schemaHash: hashArtifact(schema), thinkingLevel: THINKING_LEVELS.writer, maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS })
    const outcome = await dispatch({ stage: 'writers', repoRoot, record, packet, promptText, schema, thinkingLevel: THINKING_LEVELS.writer, maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS, apiKey, fetchImpl, sleep, resumeKey, validate: (output) => validateWriterForCritic({ output, packet }), artifactBuilder: editorialArtifact })
    record.writer = outcome
    addCalls(results, outcome)
    await writeCanonical(jsonPath(repoRoot), results)
    if (requiresStop(outcome)) throw new Error(`Writer dispatch stopped at ${record.candidateId}: ${outcome.error?.code ?? outcome.terminalState}`)
  }
  return results
}

export async function runCritics({ repoRoot, execute = false, apiKey = process.env.GEMINI_API_KEY, fetchImpl = globalThis.fetch, sleep } = {}) {
  if (!execute) throw new Error('Live critic execution requires the explicit --execute flag.')
  if (!apiKey) throw new Error('GEMINI_API_KEY is required from the environment.')
  const manifest = await readJson(path.join(root(repoRoot), 'pilot-manifest.json'))
  const promptText = await readFile(path.join(repoRoot, manifest.promptBindings.critic.path), 'utf8')
  const results = await loadResults(repoRoot, manifest)
  for (const record of results.records) {
    if (record.writer.terminalState !== 'WRITER_VALID' || record.critic.terminalState !== 'PENDING') continue
    const writerPacket = await readJson(path.join(repoRoot, record.writerPacketPath))
    const output = await readJson(path.join(repoRoot, record.writer.outputPath))
    const criticPacket = buildCriticInputPacket({ writerPacket, editorialOutput: output, hardValidation: record.writer.validation.hardFailures, reviewFlags: record.writer.validation.reviewFlags })
    const criticPacketHash = hashArtifact(criticPacket)
    const schema = buildCriticGeminiSchema(record)
    const resumeKey = createCriticResumeKey({ candidateId: record.candidateId, tmdbId: record.tmdbId, criticPacketHash, editorialArtifactHash: record.writer.artifactHash, promptHash: hashBytes(promptText), schemaHash: hashArtifact(schema), thinkingLevel: THINKING_LEVELS.critic, maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS })
    const dir = path.join(root(repoRoot), 'execution/critics', record.candidateId)
    const criticPacketPath = path.join(dir, 'critic-input.json')
    await writeCanonical(criticPacketPath, criticPacket)
    const outcome = await dispatch({ stage: 'critics', repoRoot, record, packet: criticPacket, promptText, schema, thinkingLevel: THINKING_LEVELS.critic, maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS, apiKey, fetchImpl, sleep, resumeKey, validate: validateCriticOutput, artifactBuilder: (packet, criticOutput) => criticArtifact(writerPacket, record.writer.artifactHash, criticOutput) })
    record.critic = { ...outcome, criticPacketPath: path.relative(repoRoot, criticPacketPath), criticPacketHash }
    addCalls(results, outcome)
    await writeCanonical(jsonPath(repoRoot), results)
    if (requiresStop(outcome)) throw new Error(`Critic dispatch stopped at ${record.candidateId}: ${outcome.error?.code ?? outcome.terminalState}`)
  }
  return results
}

function markdown(results) {
  const lines = ['# V8.2 Editorial Pilot Review', '', `Model: ${GEMINI_EDITORIAL_MODEL_ID}; writer thinking: low; critic thinking: medium.`, '', `Human approvals: 0. External calls: ${results.externalCalls.total}.`, '']
  for (const record of results.records) {
    lines.push(`## ${record.title} (${record.tmdbId})`, '', `Candidate: \`${record.candidateId}\``, '')
    if (record.writer.outputPath) {
      const output = record.writer.output
      if (output) for (const [field, value] of Object.entries(output.copy)) lines.push(`**${field}:** ${value}`, '')
    }
    lines.push(`Writer: ${record.writer.terminalState}; attempts: ${record.writer.attemptCount ?? 0}.`, `Critic: ${record.critic.terminalState}${record.critic.output?.verdict ? ` (${record.critic.output.verdict})` : ''}.`, 'Human decision: PENDING.', '')
  }
  return `${lines.join('\n')}\n`
}

export async function buildReviewReport({ repoRoot }) {
  const results = await readJson(jsonPath(repoRoot))
  results.externalCalls = { model: await totalPreservedCalls(repoRoot), total: await totalPreservedCalls(repoRoot) }
  for (const record of results.records) {
    if (record.writer.outputPath) record.writer.output = await readJson(path.join(repoRoot, record.writer.outputPath))
    if (record.critic.outputPath) record.critic.output = await readJson(path.join(repoRoot, record.critic.outputPath))
  }
  const reviewRoot = path.join(root(repoRoot), 'review')
  await writeCanonical(jsonPath(repoRoot), results)
  await writeRaw(path.join(reviewRoot, 'pilot-review.md'), markdown(results))
  return results
}
