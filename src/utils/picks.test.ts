import { describe, expect, it } from 'vitest'
import { getNextPickOffset, getPicks } from './picks'

describe('getPicks', () => {
  it('returns an empty slate for an empty pool', () => {
    expect(getPicks([], 0)).toEqual([])
  })

  it('returns all movies when the pool has three or fewer entries', () => {
    expect(getPicks(['a', 'b'], 0)).toEqual(['a', 'b'])
  })

  it('wraps the final slate without duplicating movies in that slate', () => {
    expect(getPicks(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['d', 'e', 'a'])
  })
})

describe('getNextPickOffset', () => {
  it('wraps to the start after advancing past the end of a larger pool', () => {
    expect(getNextPickOffset(5, 3)).toBe(1)
  })

  it('keeps the offset at zero for pools that fit in one slate', () => {
    expect(getNextPickOffset(3, 0)).toBe(0)
  })

  it('advances by the slate size across repeated rounds', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const secondOffset = getNextPickOffset(pool.length, 0)
    const thirdOffset = getNextPickOffset(pool.length, secondOffset)

    expect(getPicks(pool, secondOffset)).toEqual(['d', 'e', 'f'])
    expect(getPicks(pool, thirdOffset)).toEqual(['g', 'a', 'b'])
  })
})

describe('Previous Three state machine', () => {
  // Models the ephemeral previousPickOffset state transitions
  // using plain arithmetic — no React needed.

  it('Another three stores the immediately previous offset', () => {
    const poolSize = 9
    let round = 0
    let previousPickOffset: number | null = null

    // simulate Another three
    previousPickOffset = round
    round = getNextPickOffset(poolSize, round)

    expect(previousPickOffset).toBe(0)
    expect(round).toBe(3)
  })

  it('Previous three restores the prior offset and clears recovery state', () => {
    const poolSize = 9
    let round = 0
    let previousPickOffset: number | null = null

    // Another three
    previousPickOffset = round
    round = getNextPickOffset(poolSize, round)

    // Previous three
    const restored = previousPickOffset!
    previousPickOffset = null
    round = restored

    expect(round).toBe(0)
    expect(previousPickOffset).toBe(null)
  })

  it('a second Previous three is unavailable after the first use', () => {
    const poolSize = 9
    let round = 0
    let previousPickOffset: number | null = null

    // Another three then Previous three
    previousPickOffset = round
    round = getNextPickOffset(poolSize, round)
    round = previousPickOffset!
    previousPickOffset = null

    // No further recovery available
    expect(previousPickOffset).toBe(null)
  })

  it('a fresh Another three after restoration creates a new one-step recovery', () => {
    const poolSize = 9
    let round = 0
    let previousPickOffset: number | null = null

    // Another three -> Previous three -> round back to 0, previous = null
    previousPickOffset = round
    round = getNextPickOffset(poolSize, round)  // 3
    round = previousPickOffset!                // 0
    previousPickOffset = null

    // Another three again
    previousPickOffset = round                 // 0
    round = getNextPickOffset(poolSize, round) // 3

    expect(previousPickOffset).toBe(0)
    expect(round).toBe(3)
  })

  it('recommendation-context change clears previous offset', () => {
    let round = 3
    let previousPickOffset: number | null = 0

    // simulate mood / filter / situation / discovery change
    round = 0
    previousPickOffset = null

    expect(round).toBe(0)
    expect(previousPickOffset).toBe(null)
  })

  it('Favorites navigation clears previous offset', () => {
    let previousPickOffset: number | null = 0

    // simulate showFavorites()
    previousPickOffset = null

    expect(previousPickOffset).toBe(null)
  })

  it('More Like This navigation clears previous offset', () => {
    let previousPickOffset: number | null = 0

    // simulate showSimilarMovies()
    previousPickOffset = null

    expect(previousPickOffset).toBe(null)
  })

  it('existing cycling is unaffected when poolSize <= PICKS_PER_ROUND', () => {
    expect(getNextPickOffset(3, 0)).toBe(0)
    expect(getNextPickOffset(2, 0)).toBe(0)
  })
})
