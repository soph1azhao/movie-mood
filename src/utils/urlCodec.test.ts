import { describe, expect, it } from 'vitest'
import { encodeDecisionState, decodeDecisionState, encodeSimpleState } from './urlCodec'
import type { DecisionModeState, DecisionState } from '../types/decision'

const threeMovieIds: [string, string, string] = ['grand-budapest', 'paddington-2', 'knives-out']
const duelMovieIds: [string, string] = ['grand-budapest', 'knives-out']

const createDecisionModeState = (decisionState: DecisionState): DecisionModeState => ({
  schemaVersion: 'v4',
  mood: 'funny',
  situation: 'friends',
  filters: {
    genres: ['Comedy'],
    runtime: 'medium',
    language: 'English',
    pace: 'fast',
    emotionalWeight: 'light',
  },
  discoveryPreferences: {
    attentionDemand: 'easy',
    discoveryStyle: 'familiar',
    dealbreakers: {
      avoidHeavy: true,
      avoidSlow: false,
      underTwoHours: true,
    },
  },
  decisionState,
})

describe('urlCodec', () => {
  describe('encodeDecisionState and decodeDecisionState', () => {
    it('round-trips supported three-slate state and recommendation context', () => {
      const original = createDecisionModeState({
        kind: 'three-slate',
        movieIds: threeMovieIds,
      })
      const encoded = encodeDecisionState(original)
      const decoded = decodeDecisionState(encoded)

      expect(encoded).toContain('mode=decision')
      expect(encoded).toContain('v=v4')
      expect(decoded).toEqual(original)
    })

    it('round-trips a duel with source three-slate context', () => {
      const original = createDecisionModeState({
        kind: 'duel',
        finalistIds: duelMovieIds,
        sourceThreeSlateIds: threeMovieIds,
      })
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a pick with source duel context', () => {
      const original = createDecisionModeState({
        kind: 'pick',
        selectedId: 'knives-out',
        sourceDuel: {
          kind: 'duel',
          finalistIds: duelMovieIds,
          sourceThreeSlateIds: threeMovieIds,
        },
      })
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a direct three-slate pick with source three-slate context', () => {
      const original = createDecisionModeState({
        kind: 'pick',
        selectedId: 'paddington-2',
        sourceThreeSlateIds: threeMovieIds,
      })
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a V6 three-slate with a manual drop in progress', () => {
      const original: DecisionModeState = {
        ...createDecisionModeState({
          kind: 'three-slate',
          movieIds: threeMovieIds,
          manuallyDroppedMovieId: 'paddington-2',
        }),
        schemaVersion: 'v6',
      }
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a V6 duel created from a companion drop', () => {
      const original: DecisionModeState = {
        ...createDecisionModeState({
          kind: 'duel',
          finalistIds: duelMovieIds,
          sourceThreeSlateIds: threeMovieIds,
          reduction: {
            kind: 'companion-drop',
            droppedMovieId: 'paddington-2',
          },
        }),
        schemaVersion: 'v6',
      }
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a V6 pick with source companion-drop duel context', () => {
      const original: DecisionModeState = {
        ...createDecisionModeState({
          kind: 'pick',
          selectedId: 'knives-out',
          sourceDuel: {
            kind: 'duel',
            finalistIds: duelMovieIds,
            sourceThreeSlateIds: threeMovieIds,
            reduction: {
              kind: 'companion-drop',
              droppedMovieId: 'paddington-2',
            },
          },
        }),
        schemaVersion: 'v6',
      }
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('round-trips a V6 three-slate with a dismissed companion cue', () => {
      const original: DecisionModeState = {
        ...createDecisionModeState({
          kind: 'three-slate',
          movieIds: threeMovieIds,
          dismissedCompanionOutlierId: 'paddington-2',
        }),
        schemaVersion: 'v6',
      }
      const decoded = decodeDecisionState(encodeDecisionState(original))

      expect(decoded).toEqual(original)
    })

    it('decodes historical adaptive-answer reductions as explicit companion drops', () => {
      const decoded = decodeDecisionState(
        'mode=decision&v=v6&m=funny&s=&f=&d=&ds=dl%3Agrand-budapest%3Bknives-out%3Bsrc%3Bgrand-budapest%3Bpaddington-2%3Bknives-out%3Bad%3BattentionDemand%3Bmajority%3Bpaddington-2',
      )

      expect(decoded?.decisionState).toEqual({
        kind: 'duel',
        finalistIds: duelMovieIds,
        sourceThreeSlateIds: threeMovieIds,
        reduction: {
          kind: 'companion-drop',
          droppedMovieId: 'paddington-2',
        },
      })
    })

    it('encodes a simple state with default context', () => {
      const decoded = decodeDecisionState(encodeSimpleState('funny', {
        kind: 'three-slate',
        movieIds: threeMovieIds,
      }))

      expect(decoded).toEqual({
        schemaVersion: 'v4',
        mood: 'funny',
        situation: null,
        filters: {
          genres: [],
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
        decisionState: {
          kind: 'three-slate',
          movieIds: threeMovieIds,
        },
      })
    })

    it('still decodes existing V4 decision URLs', () => {
      const decoded = decodeDecisionState(
        'mode=decision&v=v4&m=funny&s=&f=&d=&ds=dl%3Agrand-budapest%3Bknives-out%3Bgrand-budapest%3Bpaddington-2%3Bknives-out',
      )

      expect(decoded).toEqual({
        schemaVersion: 'v4',
        mood: 'funny',
        situation: null,
        filters: {
          genres: [],
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
        decisionState: {
          kind: 'duel',
          finalistIds: duelMovieIds,
          sourceThreeSlateIds: threeMovieIds,
        },
      })
    })
  })

  describe('URL value validation', () => {
    const validUrl = 'mode=decision&v=v4&m=funny&s=friends&ds=ts%3Agrand-budapest%3Bpaddington-2%3Bknives-out'

    it('rejects invalid required mood values', () => {
      expect(decodeDecisionState(validUrl.replace('m=funny', 'm=ominous'))).toBeNull()
    })

    it('does not accept invalid optional situation values', () => {
      const decoded = decodeDecisionState(validUrl.replace('s=friends', 's=work-meeting'))

      expect(decoded?.situation).toBeNull()
    })

    it.each([
      ['runtime', 'f=r%3Dmarathon'],
      ['pace', 'f=p%3Dbreakneck'],
      ['emotional weight', 'f=e%3Dcrushing'],
      ['attention demand', 'd=a%3Dbackground'],
      ['discovery style', 'd=d%3Drandom'],
    ])('rejects invalid %s values', (_label, parameter) => {
      expect(decodeDecisionState(`${validUrl}&${parameter}`)).toBeNull()
    })
  })

  describe('movie ID validation', () => {
    it('rejects unknown three-slate candidate IDs', () => {
      expect(
        decodeDecisionState(
          'mode=decision&v=v4&m=funny&ds=ts%3Aunknown-movie%3Bpaddington-2%3Bknives-out',
        ),
      ).toBeNull()
    })

    it('rejects unknown duel finalist IDs', () => {
      expect(
        decodeDecisionState('mode=decision&v=v4&m=funny&ds=dl%3Agrand-budapest%3Bstale-id'),
      ).toBeNull()
    })

    it('rejects unknown selected-pick IDs', () => {
      expect(
        decodeDecisionState('mode=decision&v=v4&m=funny&ds=pk%3Astale-id'),
      ).toBeNull()
    })
  })

  describe('decision-context preservation', () => {
    it('preserves enough context to return from duel to the same three-slate', () => {
      const decoded = decodeDecisionState(encodeSimpleState('funny', {
        kind: 'duel',
        finalistIds: duelMovieIds,
        sourceThreeSlateIds: threeMovieIds,
      }))

      expect(decoded?.decisionState.kind).toBe('duel')
      if (decoded?.decisionState.kind !== 'duel') return
      expect(decoded.decisionState.finalistIds).toEqual(duelMovieIds)
      expect(decoded.decisionState.sourceThreeSlateIds).toEqual(threeMovieIds)
    })

    it('preserves enough context to return from pick to the same duel', () => {
      const decoded = decodeDecisionState(encodeSimpleState('funny', {
        kind: 'pick',
        selectedId: 'knives-out',
        sourceDuel: {
          kind: 'duel',
          finalistIds: duelMovieIds,
          sourceThreeSlateIds: threeMovieIds,
        },
      }))

      expect(decoded?.decisionState.kind).toBe('pick')
      if (decoded?.decisionState.kind !== 'pick') return
      expect(decoded.decisionState.sourceDuel).toEqual({
        kind: 'duel',
        finalistIds: duelMovieIds,
        sourceThreeSlateIds: threeMovieIds,
      })
    })

    it('preserves enough context to return from direct pick to the same three-slate', () => {
      const decoded = decodeDecisionState(encodeSimpleState('funny', {
        kind: 'pick',
        selectedId: 'paddington-2',
        sourceThreeSlateIds: threeMovieIds,
      }))

      expect(decoded?.decisionState.kind).toBe('pick')
      if (decoded?.decisionState.kind !== 'pick') return
      expect(decoded.decisionState.sourceThreeSlateIds).toEqual(threeMovieIds)
    })
  })

  describe('decoder isolation and edge cases', () => {
    it('does not mutate shared default filters, preferences, or dealbreakers across repeated decodes', () => {
      const first = decodeDecisionState(
        'mode=decision&v=v4&m=funny&f=g%3DComedy%7Cr%3Dshort&d=dh%3D1%7Cds%3D1&ds=ts%3Agrand-budapest%3Bpaddington-2%3Bknives-out',
      )
      const second = decodeDecisionState(
        'mode=decision&v=v4&m=exciting&ds=ts%3Agrand-budapest%3Bpaddington-2%3Bknives-out',
      )

      expect(first?.filters.genres).toEqual(['Comedy'])
      expect(first?.filters.runtime).toBe('short')
      expect(first?.discoveryPreferences.dealbreakers.avoidHeavy).toBe(true)
      expect(first?.discoveryPreferences.dealbreakers.avoidSlow).toBe(true)
      expect(second?.filters).toEqual({
        genres: [],
        runtime: null,
        language: null,
        pace: null,
        emotionalWeight: null,
      })
      expect(second?.discoveryPreferences).toEqual({
        attentionDemand: null,
        discoveryStyle: null,
        dealbreakers: {
          avoidHeavy: false,
          avoidSlow: false,
          underTwoHours: false,
        },
      })
    })

    it('handles invalid schema versions', () => {
      expect(decodeDecisionState('mode=decision&v=v3')).toBeNull()
      expect(decodeDecisionState('mode=decision&v=v5')).toBeNull()
    })

    it('returns null for non-decision mode URLs', () => {
      expect(decodeDecisionState('mode=other')).toBeNull()
      expect(decodeDecisionState('')).toBeNull()
      expect(decodeDecisionState('m=funny')).toBeNull()
    })

    it('returns null for missing decision state', () => {
      const result = decodeDecisionState('mode=decision&v=v4&m=funny')
      expect(result).toBeNull()
    })

    it('returns null for malformed decision state strings', () => {
      expect(decodeDecisionState('mode=decision&v=v4&m=funny&ds=invalid')).toBeNull()
      expect(decodeDecisionState('mode=decision&v=v4&m=funny&ds=ts:')).toBeNull()
    })

    it('handles URLs with existing query strings and hash fragments', () => {
      const encoded = encodeSimpleState('funny', {
        kind: 'three-slate',
        movieIds: threeMovieIds,
      })

      expect(decodeDecisionState(`https://example.com/page?other=value&${encoded}#details`)).not.toBeNull()
    })
  })
})
