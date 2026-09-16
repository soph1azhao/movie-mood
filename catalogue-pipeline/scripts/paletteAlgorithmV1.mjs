export const PALETTE_ALGORITHM_VERSION = 'palette-algorithm.v1'
export const POSTER_RENDITION = 'w500'
export const MIN_COLOR_DISTANCE = 48

export function resolveTmdbPosterUrl(posterPath) {
  if (typeof posterPath !== 'string' || !posterPath.startsWith('/')) throw new Error('posterPath must be a non-empty TMDB path beginning with /.')
  return `https://image.tmdb.org/t/p/${POSTER_RENDITION}${posterPath}`
}

export function rgbDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

function quantize(channel) {
  return Math.min(255, Math.round(channel / 16) * 16)
}

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hex(rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function neutralFallback(mean) {
  const center = Math.round((mean[0] + mean[1] + mean[2]) / 3)
  let dark = Math.max(0, center - 36)
  let light = Math.min(255, center + 36)
  if (light - dark < MIN_COLOR_DISTANCE) {
    if (dark === 0) light = MIN_COLOR_DISTANCE
    else dark = Math.max(0, light - MIN_COLOR_DISTANCE)
  }
  return [[dark, dark, dark], [light, light, light]]
}

/** Deterministic fixed-grid sampling and RGB histogram selection. */
export function extractPaletteFromRgba({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !data || data.length !== width * height * 4) {
    throw new Error('Invalid decoded RGBA image.')
  }
  const sampleWidth = Math.min(64, width)
  const sampleHeight = Math.min(96, height)
  const histogram = new Map()
  const sums = [0, 0, 0]
  let valid = 0
  for (let y = 0; y < sampleHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / sampleHeight))
    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / sampleWidth))
      const index = (sourceY * width + sourceX) * 4
      if (data[index + 3] < 128) continue
      const rgb = [data[index], data[index + 1], data[index + 2]]
      sums[0] += rgb[0]; sums[1] += rgb[1]; sums[2] += rgb[2]; valid += 1
      const q = rgb.map(quantize)
      const key = q.join(',')
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
  }
  if (valid === 0) throw new Error('Decoded poster contains no opaque pixels.')
  const entries = [...histogram.entries()].map(([key, count]) => ({ rgb: key.split(',').map(Number), count }))
    .sort((a, b) => b.count - a.count || luminance(a.rgb) - luminance(b.rgb) || a.rgb.join(',').localeCompare(b.rgb.join(',')))
  let first = entries[0].rgb
  let second = entries.slice(1).sort((a, b) => {
    const scoreA = a.count * (1 + rgbDistance(first, a.rgb) ** 1.35)
    const scoreB = b.count * (1 + rgbDistance(first, b.rgb) ** 1.35)
    return scoreB - scoreA || b.count - a.count || a.rgb.join(',').localeCompare(b.rgb.join(','))
  })[0]?.rgb ?? first
  if (rgbDistance(first, second) < MIN_COLOR_DISTANCE) {
    const farthest = entries.slice(1).sort((a, b) => rgbDistance(first, b.rgb) - rgbDistance(first, a.rgb) || a.rgb.join(',').localeCompare(b.rgb.join(',')))[0]?.rgb
    if (farthest && rgbDistance(first, farthest) >= MIN_COLOR_DISTANCE) second = farthest
    else[first, second] = neutralFallback(sums.map((sum) => sum / valid))
  }
  if (luminance(first) > luminance(second)) [first, second] = [second, first]
  return [hex(first), hex(second)]
}

export async function decodePoster(bytes) {
  const { default: sharp } = await import('sharp')

  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return {
    width: info.width,
    height: info.height,
    data,
  }
}

export async function paletteFromPoster(bytes) {
  return extractPaletteFromRgba(await decodePoster(bytes))
}
