import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildCriticGeminiSchema, buildEditorialGeminiSchema, GEMINI_EDITORIAL_MODEL_ID, GEMINI_EDITORIAL_PROVIDER_ID, THINKING_LEVELS } from '../adapters/geminiEditorialProvider.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const PILOT_ID = 'v8-2-editorial-pilot-v1'
export const WRITER_MAX_OUTPUT_TOKENS = 8192
export const CRITIC_MAX_OUTPUT_TOKENS = 12288
export const FIXED_PILOT = Object.freeze([
  { candidateId: 'scale500-tmdb-14283', tmdbId: 14283, title: 'The Red Violin' },
  { candidateId: 'scale500-tmdb-347201', tmdbId: 347201, title: 'Boruto: Naruto the Movie' },
  { candidateId: 'scale500-tmdb-25237', tmdbId: 25237, title: 'Come and See' },
  { candidateId: 'exp100-tmdb-21316', tmdbId: 21316, title: 'Leroy & Stitch' },
  { candidateId: 'scale500-tmdb-2061', tmdbId: 2061, title: 'Pusher' },
  { candidateId: 'scale500-tmdb-535167', tmdbId: 535167, title: 'The Wandering Earth' },
  { candidateId: 'exp100-tmdb-144', tmdbId: 144, title: 'Wings of Desire' },
  { candidateId: 'exp100-tmdb-2023', tmdbId: 2023, title: 'Hidalgo' },
  { candidateId: 'scale500-tmdb-10389', tmdbId: 10389, title: 'The Eye' },
  { candidateId: 'scale500-tmdb-11314', tmdbId: 11314, title: 'Koyaanisqatsi' },
  { candidateId: 'scale500-tmdb-11416', tmdbId: 11416, title: 'The Mission' },
  { candidateId: 'scale500-tmdb-13752', tmdbId: 13752, title: 'Max Manus: Man of War' },
  { candidateId: 'scale500-tmdb-15764', tmdbId: 15764, title: "Sophie's Choice" },
  { candidateId: 'scale500-tmdb-256040', tmdbId: 256040, title: 'Bāhubali: The Beginning' },
  { candidateId: 'scale500-tmdb-30017', tmdbId: 30017, title: 'Close-Up' },
  { candidateId: 'scale500-tmdb-477018', tmdbId: 477018, title: 'The Translators' },
])

const VOICE_RULES = Object.freeze([
  'Concise, specific, cinematic, and useful for choosing tonight.',
  'Warm without default cuteness; confident without hype; lyrical only when clear.',
  'Description is setup, whyWatch is the choosing case, curiosityHook is a distinct spark, and vibeSummary is experience plus viewing cost.',
  'No rankings, awards claims, streaming-metadata voice, generic critic cliches, model language, or generation references.',
])

const COPY_CONSTRAINTS = Object.freeze({
  description: { minChars: 80, maxChars: 220 },
  whyWatch: { minChars: 60, maxChars: 180 },
  curiosityHook: { minChars: 50, maxChars: 170 },
  vibeSummary: { minChars: 45, maxChars: 150 },
})

function selectedFacts(record) {
  return Object.fromEntries(['title', 'year', 'director', 'countries', 'spokenLanguages', 'genres', 'runtimeMinutes', 'posterPath', 'overview', 'keywords'].map((field) => [field, record[field] ?? (field === 'keywords' ? [] : null)]))
}

export function verifyFixedPilot(entries) {
  const actual = entries.map((entry) => ({ candidateId: entry.candidateId, tmdbId: entry.tmdbId, title: entry.title }))
  if (JSON.stringify(actual) !== JSON.stringify(FIXED_PILOT)) throw new Error('Pilot identity does not exactly match the accepted Phase 0 selection.')
  return true
}

export function countPosterReadiness(records) {
  const available = records.filter((record) => typeof record.posterPath === 'string' && record.posterPath.length > 0)
  const missing = records.filter((record) => record.posterPath === null || record.posterPath === undefined || record.posterPath === '')
  return {
    total: records.length,
    nonNullCount: available.length,
    nullCount: missing.length,
    nullCandidates: missing.map((record) => ({ candidateId: record.candidateId, tmdbId: record.tmdbId, title: record.title })).sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en')),
  }
}

export function createPilotResumeKey({ stage, candidateId, tmdbId, packetHash, promptHash, schemaHash, thinkingLevel, maxOutputTokens }) {
  return hashArtifact({ stage, candidateId, tmdbId, packetHash, promptHash, schemaHash, providerId: GEMINI_EDITORIAL_PROVIDER_ID, modelId: GEMINI_EDITORIAL_MODEL_ID, thinkingLevel, maxOutputTokens })
}

export function createCriticResumeKey({ candidateId, tmdbId, criticPacketHash, editorialArtifactHash, promptHash, schemaHash, thinkingLevel, maxOutputTokens }) {
  return hashArtifact({ stage: 'editorial-critic', candidateId, tmdbId, criticPacketHash, editorialArtifactHash, promptHash, schemaHash, providerId: GEMINI_EDITORIAL_PROVIDER_ID, modelId: GEMINI_EDITORIAL_MODEL_ID, thinkingLevel, maxOutputTokens })
}

export function buildWriterInputPacket({ pilotEntry, factsRecord, semanticArtifact, evidencePacket, sourceBindings, voiceGuideBinding }) {
  if (pilotEntry.candidateId !== factsRecord.candidateId || pilotEntry.tmdbId !== factsRecord.tmdbId) throw new Error(`Facts identity mismatch for ${pilotEntry.candidateId}.`)
  if (semanticArtifact.movie?.candidateId !== pilotEntry.candidateId || semanticArtifact.movie?.tmdbId !== pilotEntry.tmdbId) throw new Error(`Semantic identity mismatch for ${pilotEntry.candidateId}.`)
  if (evidencePacket.candidateId !== pilotEntry.candidateId || evidencePacket.tmdbId !== pilotEntry.tmdbId) throw new Error(`Evidence identity mismatch for ${pilotEntry.candidateId}.`)
  return {
    schemaVersion: 'editorial-writer-input.v1',
    pilotId: PILOT_ID,
    candidateId: pilotEntry.candidateId,
    tmdbId: pilotEntry.tmdbId,
    facts: selectedFacts(factsRecord),
    acceptedSemanticClassification: semanticArtifact.classification,
    groundedSemanticEvidence: semanticArtifact.evidence,
    semanticBoundaryFlags: semanticArtifact.boundaryFlags ?? [],
    allowedSourceMaterial: {
      overview: evidencePacket.facts?.overview ?? factsRecord.overview ?? null,
      keywords: evidencePacket.facts?.keywords ?? factsRecord.keywords ?? [],
      sourceRefs: (evidencePacket.sourceProvenance ?? []).map((source) => source.source),
    },
    voiceGuide: { version: 'voice.v2', rules: VOICE_RULES, sourceBinding: voiceGuideBinding },
    copyConstraints: COPY_CONSTRAINTS,
    spoilerBoundaryRules: {
      allowed: ['characters or central subjects', 'starting situation', 'premise', 'initial conflict', 'tone', 'texture', 'viewing experience'],
      excluded: ['major reversals', 'hidden identities', 'later deaths', 'culprit information', 'late relationship outcomes', 'third-act events', 'endings', 'later revelations'],
    },
    sourceBindings,
  }
}

export function buildCriticInputPacket({ writerPacket, editorialOutput, hardValidation = [], reviewFlags = [] }) {
  if (hardValidation.length > 0) throw new Error('Critic dispatch is blocked by writer hard validation failures.')
  if (editorialOutput.movie?.candidateId !== writerPacket.candidateId || editorialOutput.movie?.tmdbId !== writerPacket.tmdbId) throw new Error('Editorial identity does not match writer packet.')
  return {
    schemaVersion: 'editorial-critic-input.v1',
    pilotId: writerPacket.pilotId,
    candidateId: writerPacket.candidateId,
    tmdbId: writerPacket.tmdbId,
    facts: writerPacket.facts,
    acceptedSemanticClassification: writerPacket.acceptedSemanticClassification,
    groundedSemanticEvidence: writerPacket.groundedSemanticEvidence,
    voiceGuide: writerPacket.voiceGuide,
    visibleEditorialCopy: editorialOutput.copy,
    validationFlags: { hardValidation, reviewFlags },
  }
}

function tokenRange(byteCount) {
  return { lowerBound: Math.ceil(byteCount / 4), upperBound: Math.ceil(byteCount / 2), method: 'UTF-8 bytes divided by an approximate 2–4 bytes/token range; not provider billing data.' }
}

export function buildPilotEstimate({ packetByteCounts, writerPromptBytes, criticPromptBytes, schemaByteCounts }) {
  const writerInputBytes = packetByteCounts.reduce((sum, value) => sum + value, 0) + (writerPromptBytes + schemaByteCounts.writer) * packetByteCounts.length
  const maximumEditorialCharacters = Object.values(COPY_CONSTRAINTS).reduce((sum, limit) => sum + limit.maxChars, 0)
  const estimatedCriticInputBytes = packetByteCounts.reduce((sum, value) => sum + value, 0) + (criticPromptBytes + schemaByteCounts.critic + maximumEditorialCharacters) * packetByteCounts.length
  return {
    writerCalls: packetByteCounts.length,
    criticCalls: packetByteCounts.length,
    writerInputBytes,
    estimatedCriticInputBytes,
    combinedPlannedInputBytes: writerInputBytes + estimatedCriticInputBytes,
    approximateWriterInputTokens: tokenRange(writerInputBytes),
    approximateCriticInputTokens: tokenRange(estimatedCriticInputBytes),
    maximumConfiguredOutputTokens: { writerPerCall: WRITER_MAX_OUTPUT_TOKENS, criticPerCall: CRITIC_MAX_OUTPUT_TOKENS },
    thinkingLevels: THINKING_LEVELS,
    providerId: GEMINI_EDITORIAL_PROVIDER_ID,
    modelId: GEMINI_EDITORIAL_MODEL_ID,
    pricingIncluded: false,
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readJsonWithBytes(filePath) {
  const bytes = await readFile(filePath)
  return { value: JSON.parse(bytes.toString('utf8')), bytes }
}

function resolveRecordedArtifact(repoRoot, state, candidateId) {
  const recorded = state?.lifetimeProvenance?.artifactPath ?? state?.artifactPath
  if (recorded) {
    const marker = `${path.sep}catalogue-pipeline${path.sep}`
    const markerIndex = recorded.indexOf(marker)
    const resolved = markerIndex >= 0 ? path.join(repoRoot, recorded.slice(markerIndex + 1)) : recorded
    if (existsSync(resolved)) return resolved
  }
  const runId = state?.lifetimeProvenance?.sourceRunId
  if (runId) return path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches', runId, 'artifacts', `${candidateId}.json`)
  throw new Error(`Cannot resolve semantic artifact for ${candidateId}.`)
}

function relative(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

async function writeCanonical(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, serializeArtifactForPersistence(value))
}

export async function preparePilot({ repoRoot }) {
  const pipelineRoot = path.join(repoRoot, 'catalogue-pipeline')
  const outputRoot = path.join(pipelineRoot, 'generated/catalogue-promotion', PILOT_ID)
  const auditPath = path.join(pipelineRoot, 'generated/catalogue-promotion/v8-2-readiness-v1.json')
  const semanticManifestPath = path.join(pipelineRoot, 'generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json')
  const [auditSource, semanticManifest, expansionFacts, scaleFacts] = await Promise.all([
    readJsonWithBytes(auditPath),
    readJson(semanticManifestPath),
    readJson(path.join(pipelineRoot, 'generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json')),
    readJson(path.join(pipelineRoot, 'generated/catalogue-expansion/scale-500-v1/factual-snapshot.json')),
  ])
  const auditPilot = auditSource.value.pilotSelection.cohort.map((entry) => ({ candidateId: entry.candidateId, tmdbId: entry.tmdbId, title: entry.title }))
  verifyFixedPilot(auditPilot)
  const allFacts = [...expansionFacts.facts, ...scaleFacts.facts]
  const factsByCandidate = new Map(allFacts.map((record) => [record.candidateId, record]))
  const voiceGuidePath = path.join(pipelineRoot, 'calibration/voice-guide.md')
  const writerPromptPath = path.join(pipelineRoot, 'prompts/editorial-writer.v1.md')
  const criticPromptPath = path.join(pipelineRoot, 'prompts/editorial-critic.v1.md')
  const [voiceGuideBytes, writerPromptBytes, criticPromptBytes] = await Promise.all([readFile(voiceGuidePath), readFile(writerPromptPath), readFile(criticPromptPath)])
  const voiceGuideBinding = { path: relative(repoRoot, voiceGuidePath), historicalSourceHash: hashBytes(voiceGuideBytes) }
  const packetEntries = []

  for (const [index, pilotEntry] of FIXED_PILOT.entries()) {
    const factsRecord = factsByCandidate.get(pilotEntry.candidateId)
    if (!factsRecord) throw new Error(`Missing facts for ${pilotEntry.candidateId}.`)
    const state = semanticManifest.states[pilotEntry.candidateId]
    const semanticPath = resolveRecordedArtifact(repoRoot, state, pilotEntry.candidateId)
    const evidenceRoot = pilotEntry.candidateId.startsWith('exp100-') ? 'expansion-100-v1' : 'scale-500-v1'
    const evidencePath = path.join(pipelineRoot, 'generated/catalogue-expansion', evidenceRoot, 'evidence-packets', `${pilotEntry.candidateId}.json`)
    const [semanticSource, evidenceSource] = await Promise.all([readJsonWithBytes(semanticPath), readJsonWithBytes(evidencePath)])
    const normalizeHash = (value) => value?.startsWith?.('sha256:') ? value : value ? `sha256:${value}` : null
    const sourceBindings = {
      semanticArtifact: {
        path: relative(repoRoot, semanticPath),
        historicalSourceHash: state?.lifetimeProvenance?.artifactHash ?? state?.artifactHash,
        historicalRawByteHash: hashBytes(semanticSource.bytes),
        v8_2ArtifactHash: hashArtifact(semanticSource.value),
      },
      evidencePacket: {
        path: relative(repoRoot, evidencePath),
        historicalSourceHash: state?.evidencePacketHash,
        historicalRawByteHash: hashBytes(evidenceSource.bytes),
        v8_2ArtifactHash: hashArtifact(evidenceSource.value),
      },
      factsRecord: {
        path: factsRecord.candidateId.startsWith('exp100-') ? 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json' : 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/factual-snapshot.json',
        historicalSourceHash: normalizeHash(factsRecord.factsHash),
        v8_2ArtifactHash: hashArtifact(factsRecord),
      },
    }
    const packet = buildWriterInputPacket({ pilotEntry, factsRecord, semanticArtifact: semanticSource.value, evidencePacket: evidenceSource.value, sourceBindings, voiceGuideBinding })
    const packetBytes = serializeArtifactForPersistence(packet)
    const packetHash = hashBytes(packetBytes)
    const writerSchema = buildEditorialGeminiSchema(pilotEntry)
    const criticSchema = buildCriticGeminiSchema(pilotEntry)
    const packetPath = path.join(outputRoot, 'packets', `${String(index + 1).padStart(2, '0')}-${pilotEntry.candidateId}.writer-input.json`)
    await writeFileAfterMkdir(packetPath, packetBytes)
    packetEntries.push({
      order: index + 1,
      ...pilotEntry,
      packetPath: relative(repoRoot, packetPath),
      v8_2ArtifactHash: packetHash,
      byteCount: Buffer.byteLength(packetBytes),
      writerResumeKey: createPilotResumeKey({ stage: 'editorial-writer', candidateId: pilotEntry.candidateId, tmdbId: pilotEntry.tmdbId, packetHash, promptHash: hashBytes(writerPromptBytes), schemaHash: hashArtifact(writerSchema), thinkingLevel: THINKING_LEVELS.writer, maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS }),
    })
  }

  const schemaByteCounts = {
    writer: Buffer.byteLength(serializeArtifactForPersistence(buildEditorialGeminiSchema(FIXED_PILOT[0]))),
    critic: Buffer.byteLength(serializeArtifactForPersistence(buildCriticGeminiSchema(FIXED_PILOT[0]))),
  }
  const estimate = buildPilotEstimate({ packetByteCounts: packetEntries.map((entry) => entry.byteCount), writerPromptBytes: writerPromptBytes.length, criticPromptBytes: criticPromptBytes.length, schemaByteCounts })
  const pilotFacts = FIXED_PILOT.map((entry) => factsByCandidate.get(entry.candidateId))
  const manifest = {
    schemaVersion: 'editorial-pilot-preflight.v1',
    pilotId: PILOT_ID,
    generatedAt: semanticManifest.lastInvocation.completedAt,
    mode: 'prepare-only',
    executionAuthorized: false,
    externalCalls: { model: 0, tmdb: 0, wikipedia: 0, other: 0, total: 0 },
    configuration: { providerId: GEMINI_EDITORIAL_PROVIDER_ID, modelId: GEMINI_EDITORIAL_MODEL_ID, thinkingLevels: THINKING_LEVELS, maximumOutputTokens: { writer: WRITER_MAX_OUTPUT_TOKENS, critic: CRITIC_MAX_OUTPUT_TOKENS } },
    authoritativePilotSource: { path: relative(repoRoot, auditPath), historicalRawByteHash: hashBytes(auditSource.bytes), pilotSelectionHash: hashArtifact(auditPilot) },
    promptBindings: {
      writer: { path: relative(repoRoot, writerPromptPath), historicalRawByteHash: hashBytes(writerPromptBytes) },
      critic: { path: relative(repoRoot, criticPromptPath), historicalRawByteHash: hashBytes(criticPromptBytes) },
    },
    packets: packetEntries,
    posterReadiness: { semantic400: countPosterReadiness(allFacts), pilot16: countPosterReadiness(pilotFacts) },
    estimate,
  }
  const manifestPath = path.join(outputRoot, 'pilot-manifest.json')
  const estimatePath = path.join(outputRoot, 'preflight-estimate.json')
  await writeCanonical(manifestPath, manifest)
  await writeCanonical(estimatePath, { schemaVersion: 'editorial-pilot-estimate.v1', pilotId: PILOT_ID, externalCalls: 0, ...estimate })
  return { manifest, manifestPath, estimatePath }
}

async function writeFileAfterMkdir(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes)
}

export async function inspectPilot({ repoRoot }) {
  const manifestPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion', PILOT_ID, 'pilot-manifest.json')
  const manifest = await readJson(manifestPath)
  verifyFixedPilot(manifest.packets)
  const checks = []
  for (const packetEntry of manifest.packets) {
    const packetBytes = await readFile(path.join(repoRoot, packetEntry.packetPath))
    const parsed = JSON.parse(packetBytes.toString('utf8'))
    checks.push({ candidateId: packetEntry.candidateId, hashMatches: hashBytes(packetBytes) === packetEntry.v8_2ArtifactHash && hashArtifact(parsed) === packetEntry.v8_2ArtifactHash, terminalNewline: packetBytes.toString('utf8').endsWith('\n') && !packetBytes.toString('utf8').endsWith('\n\n') })
  }
  return { pilotId: manifest.pilotId, packetCount: checks.length, allValid: checks.every((check) => check.hashMatches && check.terminalNewline), externalCalls: 0, checks }
}

export async function estimatePilot({ repoRoot }) {
  return readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion', PILOT_ID, 'preflight-estimate.json'))
}

export async function runEditorialPilotCommand(command, options, operations = { prepare: preparePilot, inspect: inspectPilot, estimate: estimatePilot }) {
  if (command === 'prepare') return operations.prepare(options)
  if (command === 'inspect') return operations.inspect(options)
  if (command === 'estimate') return operations.estimate(options)
  if (command === 'run-writers' && options.execute) return (await import('./editorialPilotLive.mjs')).runWriters(options)
  if (command === 'run-critics' && options.execute) {
    const live = await import('./editorialPilotLive.mjs')
    await live.runCritics(options)
    return live.buildReviewReport(options)
  }
  throw new Error('Supported commands are prepare, inspect, estimate, run-writers --execute, and run-critics --execute. Live dispatch requires --execute.')
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  const command = process.argv[2]
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const execute = process.argv.slice(3).includes('--execute')
  runEditorialPilotCommand(command, { repoRoot, execute }).then((value) => {
    const printable = command === 'prepare' ? { manifestPath: value.manifestPath, estimatePath: value.estimatePath, packetCount: value.manifest.packets.length, posterReadiness: value.manifest.posterReadiness, estimate: value.manifest.estimate, externalCalls: 0 } : value
    console.log(JSON.stringify(printable, null, 2))
  }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
