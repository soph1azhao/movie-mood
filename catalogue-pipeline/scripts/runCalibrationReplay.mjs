import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { curatedMovies } from '../../src/data/curatedMovies.ts'
import tmdbSnapshot from '../../src/data/generated/tmdbMovies.json' with { type: 'json' }
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import { createGeminiProvider } from '../adapters/geminiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import { enrichTmdbCandidates } from './enrichTmdb.mjs'

const CALIBRATION_IDS = [
  'paddington-2',
  'whiplash',
  'perfect-days',
  'arrival',
  'mad-max',
  'edge-of-tomorrow',
  'before-sunrise',
  'rye-lane-2023',
  'petite-maman-2021',
  'truman-show',
]

const ORDERED_FIELDS = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
const SET_FIELDS = ['moods', 'situations']
const ORDER = {
  pace: ['slow', 'medium', 'fast'],
  emotionalWeight: ['light', 'moderate', 'heavy'],
  attentionDemand: ['easy', 'engaged', 'immersive'],
  discoveryStyle: ['familiar', 'different', 'adventurous'],
}
const EXCLUDED_FIELDS = [
  'moods',
  'situations',
  'pace',
  'emotionalWeight',
  'attentionDemand',
  'discoveryStyle',
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
]
const LIVE_REQUEST_INTERVAL_MS = 5000
const DEFAULT_CALIBRATION_MODEL = 'gemini-3.7-flash'

class CalibrationReplayError extends Error {
  constructor(message, { code = 'CALIBRATION_REPLAY_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'CalibrationReplayError'
    this.code = code
    this.details = details
  }
}

async function writeJsonIfChanged(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  let previous = null
  try {
    previous = await readFile(path, 'utf8')
  } catch {
    previous = null
  }
  if (previous === serialized) return false
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  try {
    await writeFile(tempPath, serialized)
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return true
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new CalibrationReplayError(`${name} is missing.`, { code: `MISSING_${name}` })
  return value
}

export function resolveCalibrationModel(env = process.env) {
  const modelId = env.GEMINI_MODEL?.trim() || DEFAULT_CALIBRATION_MODEL
  if (!/^[A-Za-z0-9._-]+$/.test(modelId)) throw new CalibrationReplayError('GEMINI_MODEL contains unsupported characters.', { code: 'INVALID_GEMINI_MODEL' })
  return modelId
}

function calibrationBatch() {
  const byId = new Map(mappings.map((mapping) => [mapping.id, mapping]))
  return {
    schemaVersion: 'candidate.v1',
    batchId: 'phase-5a-calibration',
    sourcePolicy: {
      description: 'Existing production movies used only for Phase 5A semantic calibration evidence materialization.',
      licensingNotes: [],
    },
    candidates: CALIBRATION_IDS.map((candidateId) => {
      const mapping = byId.get(candidateId)
      const facts = tmdbSnapshot[candidateId]
      if (!mapping || !facts) throw new CalibrationReplayError(`Missing factual calibration target: ${candidateId}`, { code: 'MISSING_CALIBRATION_TARGET' })
      return {
        candidateId,
        title: facts.title,
        year: facts.year,
        tmdbId: mapping.tmdbId,
        sourceTags: ['phase-5a-calibration'],
        inclusionRationale: 'Existing production movie selected for semantic calibration replay.',
      }
    }),
  }
}

function selectUsefulKeywords(keywords) {
  if (!Array.isArray(keywords)) return []
  const blocked = new Set(['woman director', 'duringcreditsstinger', 'aftercreditsstinger', 'based on novel or book'])
  return keywords
    .filter((keyword) => typeof keyword === 'string')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0 && !blocked.has(keyword.toLowerCase()))
    .slice(0, 12)
}

function buildPackets(factsArtifact) {
  return factsArtifact.facts.map((facts) => buildEvidencePacket({
    candidateId: facts.candidateId,
    facts,
    tmdbOverview: facts.overview,
    keywordAssessment: {
      useful: selectUsefulKeywords(facts.keywords).length > 0,
      selected: selectUsefulKeywords(facts.keywords),
    },
  }).packet)
}

function assertEvidenceIsolation(packets) {
  const curatedById = new Map(curatedMovies.map((movie) => [movie.id, movie]))
  const leaks = []

  for (const packet of packets) {
    const text = JSON.stringify(packet)
    const movie = curatedById.get(packet.candidateId)
    for (const field of EXCLUDED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(packet.facts, field)) leaks.push({ candidateId: packet.candidateId, field, reason: 'excluded-field-present' })
    }
    if (!movie) continue
    for (const field of EXCLUDED_FIELDS) {
      const value = movie[field]
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        if (typeof item === 'string' && item.length >= 12 && text.includes(item)) leaks.push({ candidateId: packet.candidateId, field, reason: 'target-value-present' })
        if (typeof item === 'string' && item.length > 0 && ['moods', 'situations', 'pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].includes(field) && text.includes(`"${item}"`)) {
          leaks.push({ candidateId: packet.candidateId, field, reason: 'semantic-label-present' })
        }
      }
    }
  }

  if (leaks.length > 0) throw new CalibrationReplayError('Calibration evidence leakage check failed.', { code: 'CALIBRATION_INPUT_LEAKAGE', details: { leaks } })
}

function assertFrozenPackets(first, second) {
  const firstHashes = first.map((packet) => packet.inputHash)
  const secondHashes = second.map((packet) => packet.inputHash)
  if (JSON.stringify(firstHashes) !== JSON.stringify(secondHashes)) {
    throw new CalibrationReplayError('Calibration evidence regeneration changed packet hashes.', { code: 'EVIDENCE_NOT_DETERMINISTIC' })
  }
  for (const packet of first) {
    if (!packet.sourceProvenance?.length || !packet.inputHash) {
      throw new CalibrationReplayError(`Calibration packet is missing provenance/hash: ${packet.candidateId}`, { code: 'INCOMPLETE_EVIDENCE_PACKET' })
    }
    if (packet.sourceProvenance.some((source) => !source.version)) {
      throw new CalibrationReplayError(`Calibration packet is missing provenance versions: ${packet.candidateId}`, { code: 'INCOMPLETE_EVIDENCE_PACKET' })
    }
  }
}

function setCompare(expectedValues, actualValues) {
  const expected = new Set(expectedValues)
  const actual = new Set(actualValues)
  const intersection = [...expected].filter((value) => actual.has(value))
  const union = [...new Set([...expected, ...actual])]
  const missing = [...expected].filter((value) => !actual.has(value))
  const extra = [...actual].filter((value) => !expected.has(value))
  return {
    exactSetAgreement: missing.length === 0 && extra.length === 0,
    jaccard: union.length === 0 ? 1 : intersection.length / union.length,
    missing,
    extra,
    overTagging: actual.size > expected.size,
  }
}

function orderedKind(field, expected, actual) {
  if (expected === actual) return 'exact'
  const distance = Math.abs(ORDER[field].indexOf(expected) - ORDER[field].indexOf(actual))
  return distance === 1 ? 'adjacent/boundary' : 'severe'
}

function shortcutSignals(human, model) {
  const signals = []
  if (model.pace === 'fast' && model.attentionDemand === 'immersive' && human.attentionDemand !== 'immersive') signals.push('fast -> immersive')
  if (model.moods.includes('funny') && model.emotionalWeight === 'light' && human.emotionalWeight !== 'light') signals.push('funny -> light')
  if (model.moods.includes('relaxing') && model.situations.includes('easy-watch') && !human.situations.includes('easy-watch')) signals.push('relaxing -> easy-watch')
  if (model.moods.includes('thoughtful') && model.attentionDemand === 'immersive' && human.attentionDemand !== 'immersive') signals.push('thoughtful -> immersive')
  if (model.moods.includes('exciting') && model.pace === 'fast' && human.pace !== 'fast') signals.push('exciting -> fast')
  return signals
}

function disagreementAssessment({ field, kind, comparison, packet }) {
  if (!packet.facts.overview && (!packet.facts.keywords || packet.facts.keywords.length === 0)) return 'evidence-packet problem'
  if (kind === 'severe') return 'likely model error'
  if (comparison?.jaccard === 0) return 'likely model error'
  if (comparison?.overTagging && comparison.extra.length > 2) return 'likely model error'
  if (field === 'situations' && comparison?.missing.includes('date-night')) return 'human-anchor ambiguity'
  return 'defensible boundary disagreement'
}

function summarize(firstResults, secondResults, packets) {
  const packetById = new Map(packets.map((packet) => [packet.candidateId, packet]))
  const curatedById = new Map(curatedMovies.map((movie) => [movie.id, movie]))
  const disagreements = []
  const ordered = Object.fromEntries(ORDERED_FIELDS.map((field) => [field, { exact: 0, adjacentBoundary: 0, severe: 0, total: 0 }]))
  const sets = Object.fromEntries(SET_FIELDS.map((field) => [field, { exactSetAgreement: 0, averageJaccard: 0, overTagged: 0, total: 0, perFilm: [] }]))
  const usage = { requestCount: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, reasoningTokensExposed: false }

  for (const entry of firstResults) {
    const artifact = entry.result.artifact
    const id = artifact.movie.candidateId
    const human = curatedById.get(id)
    const model = artifact.classification
    const packet = packetById.get(id)
    if (!human || !packet) continue

    usage.requestCount += entry.result.modelCalls
    const providerUsage = artifact.providerMetadata?.providerUsageMetadata ?? {}
    usage.inputTokens += Number(providerUsage.promptTokenCount ?? 0)
    usage.outputTokens += Number(providerUsage.candidatesTokenCount ?? 0)
    if (providerUsage.thoughtsTokenCount !== undefined) {
      usage.reasoningTokens += Number(providerUsage.thoughtsTokenCount ?? 0)
      usage.reasoningTokensExposed = true
    }

    for (const field of ORDERED_FIELDS) {
      const kind = orderedKind(field, human[field], model[field])
      ordered[field].total += 1
      if (kind === 'exact') ordered[field].exact += 1
      if (kind === 'adjacent/boundary') ordered[field].adjacentBoundary += 1
      if (kind === 'severe') ordered[field].severe += 1
      if (kind !== 'exact') disagreements.push({
        candidateId: id,
        title: packet.facts.title,
        field,
        human: human[field],
        model: model[field],
        kind,
        shortcutSignals: shortcutSignals(human, model),
        assessment: disagreementAssessment({ field, kind, packet }),
      })
    }

    for (const field of SET_FIELDS) {
      const comparison = setCompare(human[field], model[field])
      sets[field].total += 1
      sets[field].averageJaccard += comparison.jaccard
      sets[field].perFilm.push({ candidateId: id, title: packet.facts.title, ...comparison })
      if (comparison.exactSetAgreement) sets[field].exactSetAgreement += 1
      if (comparison.overTagging) sets[field].overTagged += 1
      if (!comparison.exactSetAgreement) disagreements.push({
        candidateId: id,
        title: packet.facts.title,
        field,
        human: human[field],
        model: model[field],
        ...comparison,
        shortcutSignals: shortcutSignals(human, model),
        assessment: disagreementAssessment({ field, comparison, packet }),
      })
    }
  }

  for (const field of SET_FIELDS) sets[field].averageJaccard /= sets[field].total

  const firstHashes = Object.fromEntries(firstResults.map((entry) => [entry.result.artifact.movie.candidateId, entry.result.artifact.outputHash]))
  const secondHashes = Object.fromEntries(secondResults.map((entry) => [entry.result.artifact.movie.candidateId, entry.result.artifact.outputHash]))
  return {
    provider: firstResults[0]?.result.artifact.modelProvider,
    model: firstResults[0]?.result.artifact.modelId,
    idempotency: {
      firstRunModelCalls: firstResults.reduce((sum, entry) => sum + entry.result.modelCalls, 0),
      secondRunModelCalls: secondResults.reduce((sum, entry) => sum + entry.result.modelCalls, 0),
      secondRunCacheHits: secondResults.filter((entry) => entry.result.cacheHit).length,
      outputHashesUnchanged: JSON.stringify(firstHashes) === JSON.stringify(secondHashes),
      secondRunSubstantiveArtifactWrites: secondResults.filter((entry) => entry.result.wroteArtifact).length,
    },
    outputHashDigest: stableHash(firstHashes),
    ordered,
    sets,
    disagreements,
    usage,
  }
}

async function runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot }) {
  const results = []
  for (const [index, packet] of packets.entries()) {
    const result = await classifySemanticCandidate({
      evidencePacket: packet,
      provider,
      prompt,
      cacheRoot,
      outputPath: resolve(outputRoot, `${packet.candidateId}.json`),
      createdAt: '2026-08-31T00:00:00.000Z',
      maxAttempts: 2,
    })
    results.push({ packet, result })
    if (result.result.modelCalls > 0 && index < packets.length - 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LIVE_REQUEST_INTERVAL_MS))
    }
  }
  return results
}

async function main() {
  const command = process.argv[2] ?? 'run'
  const pipelineRoot = resolve(new URL('..', import.meta.url).pathname)
  const batch = calibrationBatch()
  const token = requireEnv('TMDB_READ_ACCESS_TOKEN')
  const factsResult = await enrichTmdbCandidates({
    batch,
    token,
    allowProductionCollisions: true,
    cacheRoot: resolve(pipelineRoot, 'cache/tmdb/phase-5a-calibration'),
    outputPath: resolve(pipelineRoot, 'generated/tmdbFacts/phase-5a-calibration.json'),
    fetchedAt: '2026-08-31T00:00:00.000Z',
  })
  const packets = buildPackets(factsResult.artifact)
  const regeneratedPackets = buildPackets(factsResult.artifact)
  assertEvidenceIsolation(packets)
  assertFrozenPackets(packets, regeneratedPackets)

  const evidenceRoot = resolve(pipelineRoot, 'generated/semantic/phase-5a-calibration/evidencePackets')
  await mkdir(evidenceRoot, { recursive: true })
  for (const packet of packets) {
    await writeJsonIfChanged(resolve(evidenceRoot, `${packet.candidateId}.json`), packet)
  }
  console.log('CALIBRATION INPUT LEAKAGE CHECK: PASS')

  if (command === 'materialize-only') {
    console.log(JSON.stringify({
      factsFetchCount: factsResult.fetchCount,
      factsCacheHits: factsResult.cacheHits,
      packetCount: packets.length,
      packetHashes: Object.fromEntries(packets.map((packet) => [packet.candidateId, packet.inputHash])),
    }, null, 2))
    return
  }

  requireEnv('GEMINI_API_KEY')
  const modelId = resolveCalibrationModel()
  const provider = createGeminiProvider({ modelId })
  const prompt = await readFile(resolve(pipelineRoot, 'prompts/semantic-classifier.v1.md'), 'utf8')
  const outputRoot = resolve(pipelineRoot, `generated/semantic/phase-5a-calibration/${modelId}`)
  const cacheRoot = resolve(pipelineRoot, `cache/semantic/phase-5a-calibration/${modelId}`)
  const firstResults = await runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot })
  const secondResults = await runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot })
  const report = summarize(firstResults, secondResults, packets)
  await writeJsonIfChanged(resolve(pipelineRoot, 'generated/semantic/phase-5a-calibration/report.json'), report)
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const cause = error?.cause
    const causeDetails = cause?.message ? ` Cause: ${cause.message}` : ''
    const codeDetails = error?.code ? ` [${error.code}]` : ''
    const causeCodeDetails = cause?.code ? ` [cause:${cause.code}]` : ''
    console.error(`${error.message}${codeDetails}${causeCodeDetails}${causeDetails}`)
    process.exitCode = 1
  })
}
