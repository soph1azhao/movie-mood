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
