import { createHash } from 'node:crypto'
import { curatedMovies } from '../../src/data/curatedMovies.ts'
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import phase5bExamples from '../calibration/phase5b-experiential-examples.json' with { type: 'json' }
import ordinalDiagnostic from '../calibration/diagnostics/phase5b-ordinal-hedging.json' with { type: 'json' }
import generalizationDiagnostic from '../calibration/diagnostics/phase5c0-generalization.json' with { type: 'json' }

export const BASELINE_PROMPT_SHA256 = 'be63a47c80b4247e09a2271f5be63b06add6d5ac6cd2496ad40d65d409f9076b'
export const ORDERED_FIELDS = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
export const SET_FIELDS = ['moods', 'situations']
export const ORDER = {
  pace: ['slow', 'medium', 'fast'],
  emotionalWeight: ['light', 'moderate', 'heavy'],
  attentionDemand: ['easy', 'engaged', 'immersive'],
  discoveryStyle: ['familiar', 'different', 'adventurous'],
}

const evaluationIds = ordinalDiagnostic.candidateIds
const definitions = new Map([
  ['ordinal-hedging', ordinalDiagnostic],
  ['generalization', generalizationDiagnostic],
])

function addReasons(target, ids, reason) {
  for (const id of ids) {
    const reasons = target.get(id) ?? []
    reasons.push(reason)
    target.set(id, reasons)
  }
}

export function namedClassifierExampleExclusions() {
  const exclusions = new Map()
  addReasons(exclusions, evaluationIds, 'phase-5 evaluation target')
  addReasons(exclusions, anchors.anchors.map((entry) => entry.movieId), 'calibration anchor')
  addReasons(exclusions, boundaryCases.boundaryCases.map((entry) => entry.movieId), 'boundary case')
  addReasons(exclusions, phase5bExamples.positiveExamples.map((entry) => entry.movieId), 'Phase 5B experiential positive example')
  addReasons(exclusions, phase5bExamples.boundaryAndCounterexamples.map((entry) => entry.movieId), 'Phase 5B experiential boundary/counterexample')
  return exclusions
}

export function getDiagnosticDefinition(name) {
  const definition = definitions.get(name)
  if (!definition) throw new Error(`Unknown semantic diagnostic: ${name}`)
  return definition
}

export function auditGeneralizationSample(definition = generalizationDiagnostic, movies = curatedMovies) {
  const exclusions = namedClassifierExampleExclusions()
  const selected = new Set(definition.candidateIds)
  const duplicates = definition.candidateIds.filter((id, index) => definition.candidateIds.indexOf(id) !== index)
  const missing = definition.candidateIds.filter((id) => !movies.some((movie) => movie.id === id))
  const leaked = definition.candidateIds.filter((id) => exclusions.has(id)).map((id) => ({ id, reasons: exclusions.get(id) }))
  const exclusionAudit = [...exclusions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, reasons]) => ({ id, reasons }))
  return {
    selectedCount: selected.size,
    duplicates,
    missing,
    leaked,
    exclusionAudit,
    clean: duplicates.length === 0 && missing.length === 0 && leaked.length === 0 && selected.size >= 10 && selected.size <= 15,
  }
}

export function summarizeGeneralizationCoverage(definition = generalizationDiagnostic, movies = curatedMovies) {
  const byId = new Map(movies.map((movie) => [movie.id, movie]))
  const selected = definition.candidateIds.map((id) => byId.get(id)).filter(Boolean)
  const countValues = (field, values) => Object.fromEntries(values.map((value) => [value, selected.filter((movie) => movie[field] === value).length]))
  const countLabel = (field, values) => Object.fromEntries(values.map((value) => [value, selected.filter((movie) => movie[field].includes(value)).length]))
  return {
    sampleSize: selected.length,
    semanticExtremes: {
      pace: countValues('pace', ORDER.pace),
      emotionalWeight: countValues('emotionalWeight', ORDER.emotionalWeight),
      attentionDemand: countValues('attentionDemand', ORDER.attentionDemand),
      discoveryStyle: countValues('discoveryStyle', ORDER.discoveryStyle),
    },
    labels: {
      moods: countLabel('moods', ['relaxing', 'thoughtful', 'suspenseful', 'emotional', 'funny']),
      situations: countLabel('situations', ['easy-watch', 'friends', 'date-night', 'family', 'alone']),
    },
    cardinality: {
      moods: Object.fromEntries([1, 2, 3].map((count) => [count, selected.filter((movie) => movie.moods.length === count).length])),
      situations: Object.fromEntries([1, 2, 3, 4].map((count) => [count, selected.filter((movie) => movie.situations.length === count).length])),
    },
    coverageTags: definition.coverageNotes,
    coverageLimitations: definition.coverageLimitations ?? [],
  }
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function orderedAgreement(field, human, model) {
  const distance = Math.abs(ORDER[field].indexOf(human) - ORDER[field].indexOf(model))
  return distance === 0 ? 'exact' : distance === 1 ? 'adjacent/boundary' : 'severe'
}

export function isCenterHedging(field, human, model) {
  const values = ORDER[field]
  return model === values[1] && (human === values[0] || human === values[2])
}

function weightedKappa(field, records) {
  if (records.length === 0) return null
  const values = ORDER[field]
  const size = values.length
  const index = new Map(values.map((value, position) => [value, position]))
  const observed = Array.from({ length: size }, () => Array(size).fill(0))
  const humanTotals = Array(size).fill(0)
  const modelTotals = Array(size).fill(0)
  for (const record of records) {
    const human = index.get(record.human)
    const model = index.get(record.model)
    observed[human][model] += 1
    humanTotals[human] += 1
    modelTotals[model] += 1
  }
  const weight = (row, column) => 1 - ((row - column) ** 2 / ((size - 1) ** 2))
  let observedWeighted = 0
  let expectedWeighted = 0
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      observedWeighted += weight(row, column) * observed[row][column] / records.length
      expectedWeighted += weight(row, column) * (humanTotals[row] / records.length) * (modelTotals[column] / records.length)
    }
  }
  return expectedWeighted === 1 ? null : (observedWeighted - expectedWeighted) / (1 - expectedWeighted)
}

export function summarizeOrderedDiagnostics(records) {
  return Object.fromEntries(ORDERED_FIELDS.map((field) => {
    const entries = records.map((record) => ({ id: record.id, human: record.human[field], model: record.model[field] }))
    const values = ORDER[field]
    const distribution = (key) => Object.fromEntries(values.map((value) => [value, entries.filter((entry) => entry[key] === value).length]))
    const transitions = Object.fromEntries(entries.filter((entry) => entry.human !== entry.model).map((entry) => [`${entry.human} -> ${entry.model}`, (entries.filter((candidate) => candidate.human === entry.human && candidate.model === entry.model).length)]))
    const centerRegression = entries.filter((entry) => isCenterHedging(field, entry.human, entry.model))
    return [field, {
      total: entries.length,
      exact: entries.filter((entry) => orderedAgreement(field, entry.human, entry.model) === 'exact').length,
      adjacentBoundary: entries.filter((entry) => orderedAgreement(field, entry.human, entry.model) === 'adjacent/boundary').length,
      severe: entries.filter((entry) => orderedAgreement(field, entry.human, entry.model) === 'severe').length,
      weightedCohenKappa: weightedKappa(field, entries),
      predictionDistribution: distribution('model'),
      humanDistribution: distribution('human'),
      middlePredictionRate: entries.length ? entries.filter((entry) => entry.model === values[1]).length / entries.length : null,
      humanMiddleRate: entries.length ? entries.filter((entry) => entry.human === values[1]).length / entries.length : null,
      centerRegressionCount: centerRegression.length,
      centerRegression,
      transitions,
    }]
  }))
}

export function setMetrics(humanValues, modelValues, labels) {
  const human = new Set(humanValues)
  const model = new Set(modelValues)
  const perLabel = Object.fromEntries(labels.map((label) => {
    const tp = human.has(label) && model.has(label) ? 1 : 0
    const fp = !human.has(label) && model.has(label) ? 1 : 0
    const fn = human.has(label) && !model.has(label) ? 1 : 0
    const precision = tp + fp === 0 ? null : tp / (tp + fp)
    const recall = tp + fn === 0 ? null : tp / (tp + fn)
    const f1 = precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall)
    return [label, { tp, fp, fn, precision, recall, f1 }]
  }))
  const intersection = [...human].filter((label) => model.has(label)).length
  const union = new Set([...human, ...model]).size
  return { exactSetAgreement: human.size === model.size && intersection === human.size, jaccard: union === 0 ? 1 : intersection / union, perLabel }
}

export function summarizeMultilabelDiagnostics(records) {
  const taxonomyLabels = {
    moods: ['relaxing', 'thoughtful', 'suspenseful', 'emotional', 'funny'],
    situations: ['easy-watch', 'friends', 'date-night', 'family', 'alone'],
  }
  return Object.fromEntries(SET_FIELDS.map((field) => {
    const labels = taxonomyLabels[field]
    const totals = Object.fromEntries(labels.map((label) => [label, { tp: 0, fp: 0, fn: 0 }]))
    const perFilm = records.map((record) => ({ id: record.id, ...setMetrics(record.human[field], record.model[field], labels) }))
    for (const item of perFilm) {
      for (const label of labels) {
        totals[label].tp += item.perLabel[label].tp
        totals[label].fp += item.perLabel[label].fp
        totals[label].fn += item.perLabel[label].fn
      }
    }
    const perLabel = Object.fromEntries(labels.map((label) => {
      const { tp, fp, fn } = totals[label]
      const precision = tp + fp === 0 ? null : tp / (tp + fp)
      const recall = tp + fn === 0 ? null : tp / (tp + fn)
      const f1 = precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall)
      return [label, { tp, fp, fn, precision, recall, f1 }]
    }))
    return [field, { perFilm, perLabel }]
  }))
}
