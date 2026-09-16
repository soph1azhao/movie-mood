import {
  MIN_COLOR_DISTANCE,
  POSTER_RENDITION,
  extractPaletteFromRgba,
  rgbDistance,
} from './paletteAlgorithmV1.mjs'

export const PALETTE_ALGORITHM_VERSION_V11 = 'palette-algorithm.v1.1'
export const CHROMATIC_SATURATION_THRESHOLD = 0.22
export const CHROMATIC_BRIGHTNESS_THRESHOLD = 45
export const CHROMATIC_COVERAGE_THRESHOLD = 0.25
export const CHROMATIC_SCORE_SHARE_THRESHOLD = 0.20

function quantize(channel) {
  return Math.min(255, Math.round(channel / 16) * 16)
}

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function isChromatic([r, g, b]) {
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)

  return maximum > CHROMATIC_BRIGHTNESS_THRESHOLD &&
    (maximum - minimum) / maximum >= CHROMATIC_SATURATION_THRESHOLD
}

function hex(rgb) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function score(first, entry) {
  return entry.count * (1 + rgbDistance(first, entry.rgb) ** 1.35)
}

function exactExtremeNeutralPair(palette) {
  return palette.length === 2 &&
    palette.includes('#000000') &&
    palette.includes('#ffffff')
}

export function analyzeChromaticEvidence({ width, height, data }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    !data ||
    data.length !== width * height * 4
  ) {
    throw new Error('Invalid decoded RGBA image.')
  }

  const sampleWidth = Math.min(64, width)
  const sampleHeight = Math.min(96, height)
  const histogram = new Map()
  let validPixelCount = 0
  let chromaticPixelCount = 0

  for (let y = 0; y < sampleHeight; y += 1) {
    const sourceY = Math.min(
      height - 1,
      Math.floor((y + 0.5) * height / sampleHeight),
    )

    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(
        width - 1,
        Math.floor((x + 0.5) * width / sampleWidth),
      )
      const index = (sourceY * width + sourceX) * 4

      if (data[index + 3] < 128) continue

      const raw = [data[index], data[index + 1], data[index + 2]]
      const quantized = raw.map(quantize)
      const key = quantized.join(',')

      validPixelCount += 1
      if (isChromatic(raw)) chromaticPixelCount += 1
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
  }

  if (validPixelCount === 0) {
    throw new Error('Decoded poster contains no opaque pixels.')
  }

  const entries = [...histogram.entries()]
    .map(([key, count]) => ({
      rgb: key.split(',').map(Number),
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        luminance(a.rgb) - luminance(b.rgb) ||
        a.rgb.join(',').localeCompare(b.rgb.join(',')),
    )

  const dominant = entries[0].rgb
  const ranked = entries.slice(1)
    .map((entry) => ({ ...entry, score: score(dominant, entry) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.count - a.count ||
        a.rgb.join(',').localeCompare(b.rgb.join(',')),
    )

  const selectedSecond = ranked[0]
  const bestChromatic = ranked
    .filter(
      (entry) =>
        isChromatic(entry.rgb) &&
        rgbDistance(dominant, entry.rgb) >= MIN_COLOR_DISTANCE,
    )[0] ?? null

  return {
    dominant,
    selectedSecond,
    bestChromatic,
    chromaticCoverage: chromaticPixelCount / validPixelCount,
    chromaticScoreShare:
      bestChromatic && selectedSecond.score > 0
        ? bestChromatic.score / selectedSecond.score
        : 0,
  }
}

export function extractPaletteFromRgbaV11(image) {
  const v1Palette = extractPaletteFromRgba(image)

  if (!exactExtremeNeutralPair(v1Palette)) return v1Palette

  const evidence = analyzeChromaticEvidence(image)
  const materialChromaticEvidence =
    evidence.chromaticCoverage >= CHROMATIC_COVERAGE_THRESHOLD ||
    evidence.chromaticScoreShare >= CHROMATIC_SCORE_SHARE_THRESHOLD

  if (!materialChromaticEvidence || !evidence.bestChromatic) {
    return v1Palette
  }

  const palette = [evidence.dominant, evidence.bestChromatic.rgb]
    .sort(
      (a, b) =>
        luminance(a) - luminance(b) ||
        a.join(',').localeCompare(b.join(',')),
    )
    .map(hex)

  if (
    palette[0] === palette[1] ||
    rgbDistance(
      palette.map((color) => [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
      ])[0],
      palette.map((color) => [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
      ])[1],
    ) < MIN_COLOR_DISTANCE
  ) {
    throw new Error('palette-algorithm.v1.1 distinctness invariant failed.')
  }

  return palette
}

export async function decodePosterV11(bytes) {
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { width: info.width, height: info.height, data }
}

export async function paletteFromPosterV11(bytes) {
  return extractPaletteFromRgbaV11(await decodePosterV11(bytes))
}

export { POSTER_RENDITION }
