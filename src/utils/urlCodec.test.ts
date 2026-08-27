import { describe, expect, it } from 'vitest'
import { encodeDecisionState, decodeDecisionState, encodeSimpleState } from './urlCodec'
import type { DecisionModeState, ThreeSlateState, DuelState, PickState } from '../types/decision'

describe('urlCodec', () => {
  const createSampleDecisionState = (
    decisionState: ThreeSlateState | DuelState | PickState,
  ): DecisionModeState => ({
    schemaVersion: 'v4',
    mood: 'funny',
    situation: 'friends',
    filters: {
      genres: ['Comedy'],
      runtime: null,
      language: null,
      pace: null,
      emotionalWeight: null,
    },
    discoveryPreferences: {
      attentionDemand: null,
      discoveryStyle: null,
      dealbreakers: {
        avoidHeavy: false,
        avoidSlow: false,
        underTwoHours: false,
      },
    },
    decisionState,
  })

  describe('encodeDecisionState', () => {
    it('encodes a three-slate state with all parameters', () => {
      const state = createSampleDecisionState({
        kind: 'three-slate',
        movieIds: ['movie-a', 'movie-b', 'movie-c'],
      })
      const encoded = encodeDecisionState(state)

      expect(encoded).toContain('mode=decision')
      expect(encoded).toContain('v=v4')
      expect(encoded).toContain('m=funny')
      expect(encoded).toContain('s=friends')
      expect(encoded).toContain('f=')
      expect(encoded).toContain('ds=') // Decision state string is URL-encoded
      expect(decodeURIComponent(encoded.split('ds=')[1])).toContain('ts:movie-a,movie-b,movie-c')
    })

    it('encodes a duel state', () => {
      const state = createSampleDecisionState({
        kind: 'duel',
        finalistIds: ['movie-x', 'movie-y'],
      })
      const encoded = encodeDecisionState(state)

      expect(decodeURIComponent(encoded.split('ds=')[1])).toContain('dl:movie-x,movie-y')
    })

    it('encodes a pick state', () => {
      const state = createSampleDecisionState({
        kind: 'pick',
        selectedId: 'movie-winner',
      })
      const encoded = encodeDecisionState(state)

      expect(decodeURIComponent(encoded.split('ds=')[1])).toContain('pk:movie-winner')
    })
  })

  describe('decodeDecisionState', () => {
    it('round-trips a three-slate state', () => {
      const original = createSampleDecisionState({
        kind: 'three-slate',
        movieIds: ['movie-a', 'movie-b', 'movie-c'],
      })
      const encoded = encodeDecisionState(original)
      const decoded = decodeDecisionState(encoded)

      expect(decoded).toEqual(original)
    })

    it('round-trips a duel state', () => {
      const original = createSampleDecisionState({
        kind: 'duel',
        finalistIds: ['movie-x', 'movie-y'],
      })
      const encoded = encodeDecisionState(original)
      const decoded = decodeDecisionState(encoded)

      expect(decoded).toEqual(original)
    })

    it('round-trips a pick state', () => {
      const original = createSampleDecisionState({
        kind: 'pick',
        selectedId: 'movie-winner',
      })
      const encoded = encodeDecisionState(original)
      const decoded = decodeDecisionState(encoded)

      expect(decoded).toEqual(original)
    })

    it('returns null for non-decision mode URLs', () => {
      expect(decodeDecisionState('mode=other')).toBeNull()
      expect(decodeDecisionState('')).toBeNull()
      expect(decodeDecisionState('m=funny')).toBeNull() // no mode parameter
    })

    it('returns null for invalid schema versions', () => {
      expect(decodeDecisionState('mode=decision&v=v3')).toBeNull()
      expect(decodeDecisionState('mode=decision&v=v5')).toBeNull()
    })

    it('returns null for invalid mood values', () => {
      expect(decodeDecisionState('mode=decision&v=v4&m=invalid-mood')).toBeNull()
    })

    it('returns null for missing decision state', () => {
      const result = decodeDecisionState('mode=decision&v=v4&m=funny')
      expect(result).toBeNull()
    })

    it('returns null for malformed decision state strings', () => {
      expect(decodeDecisionState('mode=decision&v=v4&m=funny&ds=invalid')).toBeNull()
      expect(decodeDecisionState('mode=decision&v=v4&m=funny&ds=ts:')).toBeNull()
      expect(decodeDecisionState('mode=decision&v=v4&m=funny&ds=dl:')).toBeNull()
    })
  })

  describe('encodeSimpleState', () => {
    it('encodes a simple state with mood and three-slate', () => {
      const encoded = encodeSimpleState('funny', {
        kind: 'three-slate',
        movieIds: ['m1', 'm2', 'm3'],
      })

      expect(encoded).toContain('mode=decision')
      expect(encoded).toContain('v=v4')
      expect(encoded).toContain('m=funny')
      // ds parameter is URL-encoded, so decode to check value
      const dsValue = decodeURIComponent(encoded.split('ds=')[1])
      expect(dsValue).toContain('ts:m1,m2,m3')
    })
  })

  describe('edge cases', () => {
    it('handles URLs with existing query string', () => {
      // decode should work with URL that has ?query=string portion
      const original = createSampleDecisionState({
        kind: 'three-slate',
        movieIds: ['m1', 'm2', 'm3'],
      })
      const encoded = encodeDecisionState(original)
      const fullUrl = `https://example.com/page?other=value&${encoded}`
      const decoded = decodeDecisionState(fullUrl)

      expect(decoded).toEqual(original)
    })

    it('handles empty URL gracefully', () => {
      expect(decodeDecisionState('')).toBeNull()
    })

    it('handles URL with hash fragment', () => {
      const original = createSampleDecisionState({
        kind: 'pick',
        selectedId: 'winner',
      })
      const encoded = encodeDecisionState(original)
      const urlWithHash = `https://example.com/watch#section?${encoded}`
      const decoded = decodeDecisionState(urlWithHash)

      expect(decoded).toEqual(original)
    })

    it('degrades safely for unknown parameters', () => {
      const result = decodeDecisionState(
        'mode=decision&v=v4&m=funny&ds=ts:m1,m2,m3&unknown=ignored&also_unknown=values',
      )
      expect(result).not.toBeNull()
      expect(result!.mood).toBe('funny')
    })
  })
})