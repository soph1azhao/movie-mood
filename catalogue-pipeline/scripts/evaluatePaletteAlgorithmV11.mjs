import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  hashArtifact,
  hashBytes,
  serializeArtifactForPersistence,
  validatePaletteArtifact,
} from './validatePromotionContract.mjs'
import {
  MIN_COLOR_DISTANCE,
  extractPaletteFromRgba,
  rgbDistance,
} from './paletteAlgorithmV1.mjs'
import {
  CHROMATIC_BRIGHTNESS_THRESHOLD,
  CHROMATIC_COVERAGE_THRESHOLD,
  CHROMATIC_SATURATION_THRESHOLD,
  CHROMATIC_SCORE_SHARE_THRESHOLD,
  PALETTE_ALGORITHM_VERSION_V11,
  analyzeChromaticEvidence,
  decodePosterV11,
  extractPaletteFromRgbaV11,
} from './paletteAlgorithmV11.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TRANCHE = path.join(REPO, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1')
const LEDGER = path.join(TRANCHE, 'palette-generation-results.v1.json')
const OUTPUT = path.join(TRANCHE, 'palette-algorithm-v1-v1_1-comparison.json')

const SUSPECTED = new Set([
  'exp100-tmdb-10377',
  'exp100-tmdb-122857',
  'exp100-tmdb-1989',
  'exp100-tmdb-9349',
  'scale500-tmdb-10403',
  'scale500-tmdb-20533',
  'scale500-tmdb-29702',
  'scale500-tmdb-62204',
])

const LEGITIMATE_NEUTRAL = new Set([
  'exp100-tmdb-283566',
  'scale500-tmdb-12622',
  'scale500-tmdb-9079',
])

const RULES = [
  { id: 'coverage-0.20', coverage: 0.20, scoreShare: null },
  { id: 'coverage-0.25', coverage: 0.25, scoreShare: null },
  { id: 'score-share-0.20', coverage: null, scoreShare: 0.20 },
  { id: 'coverage-0.20-or-score-share-0.20', coverage: 0.20, scoreShare: 0.20 },
  { id: 'coverage-0.25-or-score-share-0.20', coverage: 0.25, scoreShare: 0.20 },
  { id: 'coverage-0.30-or-score-share-0.20', coverage: 0.30, scoreShare: 0.20 },
]

function parseHex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ]
}

function triggered(record, rule) {
  if (!record.exactExtremeNeutralPair) return false

  return (
    rule.coverage !== null &&
    record.chromaticCoverage >= rule.coverage
  ) || (
    rule.scoreShare !== null &&
    record.chromaticScoreShare >= rule.scoreShare
  )
}

function paletteForRule(record, rule) {
  return triggered(record, rule)
    ? record.v11Palette
    : record.v1Palette
}

function topRepeated(palettes) {
  const counts = new Map()
  for (const palette of palettes) {
    const key = palette.join('|')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([key, count]) => ({ palette: key.split('|'), count }))
}

function quality(records, rule) {
  const palettes = records.map((record) => paletteForRule(record, rule))
  let invalidHexCount = 0
  let identicalColorCount = 0
  let belowDistanceThresholdCount = 0

  for (const palette of palettes) {
    if (!palette.every((color) => /^#[0-9a-f]{6}$/.test(color))) {
      invalidHexCount += 1
    }
    if (palette[0] === palette[1]) identicalColorCount += 1
    if (rgbDistance(parseHex(palette[0]), parseHex(palette[1])) < MIN_COLOR_DISTANCE) {
      belowDistanceThresholdCount += 1
    }
  }

  const changed = records.filter((record) => triggered(record, rule))

  return {
    suspectedCollapsesCorrected: changed.filter((record) =>
      SUSPECTED.has(record.candidateId)).length,
    legitimateNeutralAltered: changed.filter((record) =>
      LEGITIMATE_NEUTRAL.has(record.candidateId)).length,
    totalChanged: changed.length,
    collateralChangesAmongOther88: changed
      .filter((record) =>
        !SUSPECTED.has(record.candidateId) &&
        !LEGITIMATE_NEUTRAL.has(record.candidateId))
      .map((record) => record.candidateId),
    invalidHexCount,
    identicalColorCount,
    belowDistanceThresholdCount,
    exactBlackWhiteCount: palettes.filter((palette) =>
      palette.includes('#000000') && palette.includes('#ffffff')).length,
    topRepeatedPalettes: topRepeated(palettes),
  }
}

async function main() {
  const ledgerBytes = await readFile(LEDGER)
  const ledger = JSON.parse(ledgerBytes)
  const records = []

  for (const ledgerRecord of ledger.records) {
    const posterPath = path.join(
      TRANCHE,
      'poster-cache',
      'w500',
      `${ledgerRecord.candidateId}.poster`,
    )
    const posterBytes = await readFile(posterPath)
    const image = await decodePosterV11(posterBytes)
    const v1Palette = extractPaletteFromRgba(image)
    const v11Palette = extractPaletteFromRgbaV11(image)
    const deterministicRerun = extractPaletteFromRgbaV11(image)
    const evidence = analyzeChromaticEvidence(image)

    if (JSON.stringify(v1Palette) !== JSON.stringify(ledgerRecord.palette)) {
      throw new Error(`Cached v1 palette mismatch: ${ledgerRecord.candidateId}`)
    }
    if (JSON.stringify(v11Palette) !== JSON.stringify(deterministicRerun)) {
      throw new Error(`v1.1 nondeterminism: ${ledgerRecord.candidateId}`)
    }

    const validation = validatePaletteArtifact({
      schemaVersion: 'palette-artifact.v1',
      candidateId: ledgerRecord.candidateId,
      tmdbId: ledgerRecord.tmdbId,
      palette: v11Palette,
      method: 'poster-algorithm',
      sourcePosterIdentity: { posterPath: ledgerRecord.posterPath },
      sourcePosterHash: hashBytes(posterBytes),
      algorithmVersion: PALETTE_ALGORITHM_VERSION_V11,
      override: null,
    })

    if (!validation.ok) {
      throw new Error(
        `Invalid v1.1 palette: ${ledgerRecord.candidateId} ${JSON.stringify(validation.hardFailures)}`,
      )
    }

    records.push({
      candidateId: ledgerRecord.candidateId,
      tmdbId: ledgerRecord.tmdbId,
      sourcePosterHash: hashBytes(posterBytes),
      v1Palette,
      v11Palette,
      changed: JSON.stringify(v1Palette) !== JSON.stringify(v11Palette),
      exactExtremeNeutralPair:
        v1Palette.includes('#000000') &&
        v1Palette.includes('#ffffff'),
      chromaticCoverage: evidence.chromaticCoverage,
      chromaticScoreShare: evidence.chromaticScoreShare,
      knownQaClassification: SUSPECTED.has(ledgerRecord.candidateId)
        ? 'ALGORITHM_COLLAPSE_SUSPECTED'
        : LEGITIMATE_NEUTRAL.has(ledgerRecord.candidateId)
          ? 'PLAUSIBLE_MONOCHROME_OR_NEUTRAL'
          : null,
    })
  }

  const chosenRule = RULES.find((rule) =>
    rule.coverage === CHROMATIC_COVERAGE_THRESHOLD &&
    rule.scoreShare === CHROMATIC_SCORE_SHARE_THRESHOLD)
  const comparison = {
    schemaVersion: 'palette-algorithm-comparison.v1',
    oldAlgorithmVersion: 'palette-algorithm.v1',
    newAlgorithmVersion: PALETTE_ALGORITHM_VERSION_V11,
    cohort: {
      trancheId: 'SCALE_TRANCHE_1',
      candidateCount: records.length,
      identityHash: hashArtifact(
        records.map(({ candidateId, tmdbId }) => ({ candidateId, tmdbId })),
      ),
    },
    sourceHashes: {
      paletteGenerationResults: hashBytes(ledgerBytes),
      oldAlgorithmImplementation: hashBytes(await readFile(path.join(REPO, 'catalogue-pipeline/scripts/paletteAlgorithmV1.mjs'))),
      newAlgorithmImplementation: hashBytes(await readFile(path.join(REPO, 'catalogue-pipeline/scripts/paletteAlgorithmV11.mjs'))),
    },
    chromaticDefinition: {
      saturationAtLeast: CHROMATIC_SATURATION_THRESHOLD,
      maximumChannelGreaterThan: CHROMATIC_BRIGHTNESS_THRESHOLD,
      samplingAndQuantization: 'unchanged from palette-algorithm.v1',
    },
    chosenRule: {
      id: chosenRule.id,
      exactExtremeNeutralPairOnly: true,
      chromaticCoverageAtLeast: CHROMATIC_COVERAGE_THRESHOLD,
      orChromaticCandidateScoreShareAtLeast: CHROMATIC_SCORE_SHARE_THRESHOLD,
      action: 'replace only the non-dominant extreme with the highest-ranked eligible chromatic histogram bin',
    },
    candidateRuleResults: RULES.map((rule) => ({
      rule,
      ...quality(records, rule),
    })),
    aggregate: {
      ...quality(records, chosenRule),
      deterministicRerun: 'PASS_99_OF_99',
      paletteSchemaValidation: 'PASS_99_OF_99',
    },
    records,
  }

  await writeFile(OUTPUT, serializeArtifactForPersistence(comparison))
  console.log(JSON.stringify({
    outputPath: path.relative(REPO, OUTPUT),
    outputHash: hashArtifact(comparison),
    chosenRule: comparison.chosenRule,
    candidateRuleResults: comparison.candidateRuleResults,
    aggregate: comparison.aggregate,
  }, null, 2))
}

await main()
