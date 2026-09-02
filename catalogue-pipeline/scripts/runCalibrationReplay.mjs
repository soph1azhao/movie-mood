import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { curatedMovies } from '../../src/data/curatedMovies.ts'
import tmdbSnapshot from '../../src/data/generated/tmdbMovies.json' with { type: 'json' }
import mappings from '../../src/data/tmdbMovieMappings.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import phase5bExamples from '../calibration/phase5b-experiential-examples.json' with { type: 'json' }
import { createGeminiProvider } from '../adapters/geminiProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { buildEvidencePacket } from './buildEvidencePacket.mjs'
import { classifySemanticCandidate } from './classifySemantic.mjs'
import {
  auditGeneralizationSample,
  getDiagnosticDefinition,
  summarizeGeneralizationCoverage,
  summarizeMultilabelDiagnostics,
  summarizeOrderedDiagnostics,
} from './diagnosticScaffolding.mjs'
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
const PHASE_5B_PROMPT_VERSION = 'semantic-classifier.v3'
const PHASE_5B_SCHEMA_VERSION = 'semantic-output.v2'

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

function calibrationBatch(replay) {
  const byId = new Map(mappings.map((mapping) => [mapping.id, mapping]))
  return {
    schemaVersion: 'candidate.v1',
    batchId: replay.batchId,
    sourcePolicy: {
      description: replay.sourcePolicy,
      licensingNotes: [],
    },
    candidates: replay.candidateIds.map((candidateId) => {
      const mapping = byId.get(candidateId)
      const facts = tmdbSnapshot[candidateId]
      if (!mapping || !facts) throw new CalibrationReplayError(`Missing factual calibration target: ${candidateId}`, { code: 'MISSING_CALIBRATION_TARGET' })
      return {
        candidateId,
        title: facts.title,
        year: facts.year,
        tmdbId: mapping.tmdbId,
        sourceTags: [replay.batchId],
        inclusionRationale: replay.inclusionRationale,
      }
    }),
  }
}

export function resolveReplayDefinition(diagnosticName) {
  if (!diagnosticName) {
    return {
      id: 'phase-5a-calibration',
      batchId: 'phase-5a-calibration',
      candidateIds: CALIBRATION_IDS,
      sourcePolicy: 'Existing production movies used only for Phase 5A semantic calibration evidence materialization.',
      inclusionRationale: 'Existing production movie selected for semantic calibration replay.',
      promptVersion: PHASE_5B_PROMPT_VERSION,
      promptFile: 'semantic-classifier.v3.md',
      schemaVersion: PHASE_5B_SCHEMA_VERSION,
      outputNamespace: 'phase-5a-calibration',
      isDiagnostic: false,
    }
  }
  const diagnostic = getDiagnosticDefinition(diagnosticName)
  return {
    ...diagnostic,
    batchId: diagnostic.id,
    sourcePolicy: diagnostic.purpose,
    inclusionRationale: 'Existing production movie selected for a non-production semantic diagnostic.',
    promptFile: diagnostic.kind === 'ordinal-hedging' ? 'semantic-classifier.v3-ordinal-diagnostic.md' : 'semantic-classifier.v3.md',
    schemaVersion: diagnostic.schemaVersionOutput,
    outputNamespace: `diagnostics/${diagnostic.id}`,
    isDiagnostic: true,
  }
}

export function resolveReplayStorage(replay, modelId) {
  return {
    outputRoot: `generated/semantic/${replay.outputNamespace}/${modelId}/${replay.promptVersion}`,
    cacheRoot: `cache/semantic/${replay.outputNamespace}/${modelId}/${replay.promptVersion}`,
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

export function assertCalibrationResult(result, candidateId = 'unknown') {
  if (!result || typeof result !== 'object') throw new CalibrationReplayError(`Classifier result contract is missing for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  if (!Number.isInteger(result.modelCalls) || result.modelCalls < 0) throw new CalibrationReplayError(`Classifier result contract has invalid modelCalls for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  if (typeof result.cacheHit !== 'boolean') throw new CalibrationReplayError(`Classifier result contract has invalid cacheHit for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  if (!Number.isInteger(result.retries) || result.retries < 0) throw new CalibrationReplayError(`Classifier result contract has invalid retries for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  if (result.classificationsCompleted !== 1) throw new CalibrationReplayError(`Classifier result contract has invalid classificationsCompleted for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  if (!Object.prototype.hasOwnProperty.call(result, 'providerUsageMetadata')) throw new CalibrationReplayError(`Classifier result contract omits providerUsageMetadata for ${candidateId}.`, { code: 'INVALID_CLASSIFIER_RESULT' })
  return result
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

export function getDealbreakerRisk(field, human, model) {
  if (field === 'emotionalWeight') {
    if (human === 'heavy' && model !== 'heavy') return 'DEALBREAKER_UNDERSHOOT'
    if (human !== 'heavy' && model === 'heavy') return 'DEALBREAKER_OVERSHOOT'
  }
  if (field === 'pace') {
    if (human === 'slow' && model !== 'slow') return 'DEALBREAKER_UNDERSHOOT'
    if (human !== 'slow' && model === 'slow') return 'DEALBREAKER_OVERSHOOT'
  }
  return null
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

export function summarizeCalibrationReplay(firstResults, secondResults, packets) {
  const packetById = new Map(packets.map((packet) => [packet.candidateId, packet]))
  const curatedById = new Map(curatedMovies.map((movie) => [movie.id, movie]))
  const disagreements = []
  const ordered = Object.fromEntries(ORDERED_FIELDS.map((field) => [field, { exact: 0, adjacentBoundary: 0, severe: 0, total: 0 }]))
  const sets = Object.fromEntries(SET_FIELDS.map((field) => [field, { exactSetAgreement: 0, averageJaccard: 0, overTagged: 0, total: 0, perFilm: [] }]))
  const usage = {
    requestCount: 0,
    cacheHits: 0,
    retries: 0,
    classificationsCompleted: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    reasoningTokensExposed: false,
  }
  const productImpact = {
    rawSemanticDisagreements: 0,
    hardDealbreakerUndershoots: [],
    hardDealbreakerOvershoots: [],
    moodEligibilityChanges: [],
    situationEligibilityChanges: [],
    softOrderOnlyDisagreements: [],
    precisionDiscipline: { extraLabels: 0, overTaggedFilms: 0, evidenceRationaleContractFailures: 0 },
  }

  for (const entry of firstResults) {
    const artifact = entry.result.artifact
    const id = artifact.movie.candidateId
    const human = curatedById.get(id)
    const model = artifact.classification
    const packet = packetById.get(id)
    if (!human || !packet) continue

    assertCalibrationResult(entry.result, id)
    usage.requestCount += entry.result.modelCalls
    usage.cacheHits += entry.result.cacheHit ? 1 : 0
    usage.retries += entry.result.retries
    usage.classificationsCompleted += entry.result.classificationsCompleted
    const providerUsage = entry.result.providerUsageMetadata ?? {}
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
      if (kind !== 'exact') {
        productImpact.rawSemanticDisagreements += 1
        const risk = getDealbreakerRisk(field, human[field], model[field])
        const impactEntry = { candidateId: id, title: packet.facts.title, field, human: human[field], model: model[field], kind }
        if (risk === 'DEALBREAKER_UNDERSHOOT') productImpact.hardDealbreakerUndershoots.push(impactEntry)
        else if (risk === 'DEALBREAKER_OVERSHOOT') productImpact.hardDealbreakerOvershoots.push(impactEntry)
        else productImpact.softOrderOnlyDisagreements.push(impactEntry)
      }
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
      if (!comparison.exactSetAgreement) {
        productImpact.rawSemanticDisagreements += 1
        const impactEntry = { candidateId: id, title: packet.facts.title, missing: comparison.missing, extra: comparison.extra, jaccard: comparison.jaccard }
        if (field === 'moods') productImpact.moodEligibilityChanges.push(impactEntry)
        else productImpact.situationEligibilityChanges.push(impactEntry)
        productImpact.precisionDiscipline.extraLabels += comparison.extra.length
        if (comparison.overTagging) productImpact.precisionDiscipline.overTaggedFilms += 1
      }
    }

    if (artifact.schemaVersion !== PHASE_5B_SCHEMA_VERSION) productImpact.precisionDiscipline.evidenceRationaleContractFailures += 1
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
    productImpact: {
      rawSemanticDisagreements: productImpact.rawSemanticDisagreements,
      hardDealbreakerUndershoots: { count: productImpact.hardDealbreakerUndershoots.length, perFilm: productImpact.hardDealbreakerUndershoots },
      hardDealbreakerOvershoots: { count: productImpact.hardDealbreakerOvershoots.length, perFilm: productImpact.hardDealbreakerOvershoots },
      moodEligibilityChanges: { count: productImpact.moodEligibilityChanges.length, perFilm: productImpact.moodEligibilityChanges },
      situationEligibilityChanges: { count: productImpact.situationEligibilityChanges.length, perFilm: productImpact.situationEligibilityChanges },
      softOrderOnlyDisagreements: { count: productImpact.softOrderOnlyDisagreements.length, perFilm: productImpact.softOrderOnlyDisagreements },
      precisionDiscipline: productImpact.precisionDiscipline,
    },
  }
}

function recordsFromResults(results, packets) {
  const packetById = new Map(packets.map((packet) => [packet.candidateId, packet]))
  const curatedById = new Map(curatedMovies.map((movie) => [movie.id, movie]))
  return results.map((entry) => {
    const id = entry.result.artifact.movie.candidateId
    return { id, human: curatedById.get(id), model: entry.result.artifact.classification, packet: packetById.get(id) }
  }).filter((entry) => entry.human && entry.packet)
}

function dealbreakerCounts(records) {
  const counts = { undershoot: 0, overshoot: 0 }
  for (const record of records) {
    for (const field of ['pace', 'emotionalWeight']) {
      const risk = getDealbreakerRisk(field, record.human[field], record.model[field])
      if (risk === 'DEALBREAKER_UNDERSHOOT') counts.undershoot += 1
      if (risk === 'DEALBREAKER_OVERSHOOT') counts.overshoot += 1
    }
  }
  return counts
}

async function loadBaselineRecords({ pipelineRoot, modelId, packets }) {
  const artifacts = await Promise.all(packets.map(async (packet) => {
    const path = resolve(pipelineRoot, `generated/semantic/phase-5a-calibration/${modelId}/${PHASE_5B_PROMPT_VERSION}/${packet.candidateId}.json`)
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      throw new CalibrationReplayError(`Missing frozen v3 baseline artifact for ordinal diagnostic: ${packet.candidateId}`, { code: 'MISSING_ORDINAL_DIAGNOSTIC_BASELINE' })
    }
  }))
  const curatedById = new Map(curatedMovies.map((movie) => [movie.id, movie]))
  return artifacts.map((artifact) => ({ id: artifact.movie.candidateId, human: curatedById.get(artifact.movie.candidateId), model: artifact.classification }))
}

function ordinalComparison(baselineRecords, diagnosticRecords) {
  const baseline = summarizeOrderedDiagnostics(baselineRecords)
  const diagnostic = summarizeOrderedDiagnostics(diagnosticRecords)
  return {
    baseline,
    diagnostic,
    delta: Object.fromEntries(ORDERED_FIELDS.map((field) => [field, {
      centerRegression: diagnostic[field].centerRegressionCount - baseline[field].centerRegressionCount,
      severe: diagnostic[field].severe - baseline[field].severe,
      endpointPredictionRate: (
        diagnostic[field].predictionDistribution[ORDER[field][0]] + diagnostic[field].predictionDistribution[ORDER[field][2]]
      ) / diagnostic[field].total - (
        baseline[field].predictionDistribution[ORDER[field][0]] + baseline[field].predictionDistribution[ORDER[field][2]]
      ) / baseline[field].total,
    }])),
    dealbreakerRisk: { baseline: dealbreakerCounts(baselineRecords), diagnostic: dealbreakerCounts(diagnosticRecords) },
  }
}

async function runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot, promptVersion = PHASE_5B_PROMPT_VERSION, schemaVersion = PHASE_5B_SCHEMA_VERSION, calibrationAnchors, calibrationBoundaryCases }) {
  const results = []
  for (const [index, packet] of packets.entries()) {
    const result = await classifySemanticCandidate({
      evidencePacket: packet,
      provider,
      prompt,
      promptVersion,
      schemaVersion,
      calibrationAnchors,
      calibrationBoundaryCases,
      cacheRoot,
      outputPath: resolve(outputRoot, `${packet.candidateId}.json`),
      createdAt: '2026-08-31T00:00:00.000Z',
      maxAttempts: 2,
    })
    results.push({ packet, result })
    assertCalibrationResult(result, packet.candidateId)
    if (result.modelCalls > 0 && index < packets.length - 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LIVE_REQUEST_INTERVAL_MS))
    }
  }
  return results
}

async function main() {
  const command = process.argv[2] ?? 'run'
  const diagnosticName = process.argv[3]
  const pipelineRoot = resolve(new URL('..', import.meta.url).pathname)
  const replay = resolveReplayDefinition(diagnosticName)
  if (replay.kind === 'generalization') {
    const audit = auditGeneralizationSample(replay)
    if (!audit.clean) throw new CalibrationReplayError('Generalization diagnostic sample failed exclusion audit.', { code: 'GENERALIZATION_SAMPLE_LEAKAGE', details: audit })
  }
  const batch = calibrationBatch(replay)
  const token = requireEnv('TMDB_READ_ACCESS_TOKEN')
  const factsResult = await enrichTmdbCandidates({
    batch,
    token,
    allowProductionCollisions: true,
    cacheRoot: resolve(pipelineRoot, `cache/tmdb/${replay.outputNamespace}`),
    outputPath: resolve(pipelineRoot, `generated/tmdbFacts/${replay.outputNamespace}.json`),
    fetchedAt: '2026-08-31T00:00:00.000Z',
  })
  const packets = buildPackets(factsResult.artifact)
  const regeneratedPackets = buildPackets(factsResult.artifact)
  assertEvidenceIsolation(packets)
  assertFrozenPackets(packets, regeneratedPackets)

  const evidenceRoot = resolve(pipelineRoot, `generated/semantic/${replay.outputNamespace}/evidencePackets`)
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
  const prompt = await readFile(resolve(pipelineRoot, `prompts/${replay.promptFile}`), 'utf8')
  const calibrationAnchors = { ...anchors, anchors: [...anchors.anchors, ...phase5bExamples.positiveExamples] }
  const calibrationBoundaryCases = { ...boundaryCases, boundaryCases: [...boundaryCases.boundaryCases, ...phase5bExamples.boundaryAndCounterexamples] }
  const storage = resolveReplayStorage(replay, modelId)
  const outputRoot = resolve(pipelineRoot, storage.outputRoot)
  const cacheRoot = resolve(pipelineRoot, storage.cacheRoot)
  const firstResults = await runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot, promptVersion: replay.promptVersion, schemaVersion: replay.schemaVersion, calibrationAnchors, calibrationBoundaryCases })
  const secondResults = await runClassifierPass({ packets, provider, prompt, outputRoot, cacheRoot, promptVersion: replay.promptVersion, schemaVersion: replay.schemaVersion, calibrationAnchors, calibrationBoundaryCases })
  const report = summarizeCalibrationReplay(firstResults, secondResults, packets)
  const diagnosticRecords = recordsFromResults(firstResults, packets)
  if (replay.kind === 'ordinal-hedging') report.ordinalHedgingDiagnostic = {
    decisionRules: replay.decisionRules,
    ...ordinalComparison(await loadBaselineRecords({ pipelineRoot, modelId, packets }), diagnosticRecords),
  }
  if (replay.kind === 'generalization') report.generalizationDiagnostic = {
    purpose: replay.purpose,
    decisionRules: replay.decisionRules,
    exclusionAudit: auditGeneralizationSample(replay),
    coverage: summarizeGeneralizationCoverage(replay),
    ordered: summarizeOrderedDiagnostics(diagnosticRecords),
    multilabel: summarizeMultilabelDiagnostics(diagnosticRecords),
  }
  await writeJsonIfChanged(resolve(outputRoot, 'report.json'), report)
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
