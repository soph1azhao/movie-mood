import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_COLOR_DISTANCE,
  extractPaletteFromRgba,
  rgbDistance,
} from './paletteAlgorithmV1.mjs'
import {
  extractPaletteFromRgbaV11,
} from './paletteAlgorithmV11.mjs'

function imageFromCounts(colors) {
  const pixels = colors.flatMap(({ rgb, count }) =>
    Array.from({ length: count }, () => [...rgb, 255]),
  )
  const width = 10
  const height = pixels.length / width

  return {
    width,
    height,
    data: Buffer.from(pixels.flat()),
  }
}

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

test('v1.1 corrects a colorful exact-black-white collapse', () => {
  const image = imageFromCounts([
    { rgb: [0, 0, 0], count: 45 },
    { rgb: [255, 255, 255], count: 20 },
    { rgb: [224, 48, 96], count: 35 },
  ])

  assert.deepEqual(
    extractPaletteFromRgba(image),
    ['#000000', '#ffffff'],
  )
  assert.deepEqual(
    extractPaletteFromRgbaV11(image),
    ['#000000', '#e03060'],
  )
})

test('v1.1 leaves a legitimate monochrome poster neutral', () => {
  const image = imageFromCounts([
    { rgb: [255, 255, 255], count: 70 },
    { rgb: [0, 0, 0], count: 29 },
    { rgb: [96, 96, 112], count: 1 },
  ])

  assert.deepEqual(
    extractPaletteFromRgbaV11(image),
    extractPaletteFromRgba(image),
  )
})

test('v1.1 is deterministic and preserves minimum distance', () => {
  const image = imageFromCounts([
    { rgb: [0, 0, 0], count: 45 },
    { rgb: [255, 255, 255], count: 20 },
    { rgb: [32, 160, 208], count: 35 },
  ])
  const first = extractPaletteFromRgbaV11(image)
  const second = extractPaletteFromRgbaV11(image)

  assert.deepEqual(first, second)
  assert.ok(rgbDistance(rgb(first[0]), rgb(first[1])) >= MIN_COLOR_DISTANCE)
})

test('v1.1 leaves the normal non-black-white selection path unchanged', () => {
  const image = imageFromCounts([
    { rgb: [32, 64, 96], count: 60 },
    { rgb: [208, 144, 48], count: 40 },
  ])

  assert.deepEqual(
    extractPaletteFromRgbaV11(image),
    extractPaletteFromRgba(image),
  )
})
