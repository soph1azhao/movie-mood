import type { DiscoveryPreferences, Mood, MovieFilters, ViewingSituation } from './movie'

export const V4_SCHEMA_VERSION = 'v4' as const

export type DecisionModeSchemaVersion = typeof V4_SCHEMA_VERSION

export type ThreeSlateState = {
  kind: 'three-slate'
  movieIds: [string, string, string]
}

export type DuelState = {
  kind: 'duel'
  finalistIds: [string, string]
  sourceThreeSlateIds?: [string, string, string]
}

export type PickState = {
  kind: 'pick'
  selectedId: string
  sourceDuel?: DuelState
  sourceThreeSlateIds?: [string, string, string]
}

export type DecisionState = ThreeSlateState | DuelState | PickState

export interface DecisionModeState {
  schemaVersion: DecisionModeSchemaVersion
  mood: string
  situation: string | null
  filters: MovieFilters
  discoveryPreferences: DiscoveryPreferences
  decisionState: DecisionState
}

export function isThreeSlateState(
  state: DecisionState,
): state is ThreeSlateState {
  return state.kind === 'three-slate'
}

export function isDuelState(state: DecisionState): state is DuelState {
  return state.kind === 'duel'
}

export function isPickState(state: DecisionState): state is PickState {
  return state.kind === 'pick'
}

export function createThreeSlateState(movieIds: [string, string, string]): ThreeSlateState {
  return { kind: 'three-slate', movieIds }
}

export function createDuelState(
  finalistIds: [string, string],
  sourceThreeSlateIds?: [string, string, string],
): DuelState {
  return sourceThreeSlateIds
    ? { kind: 'duel', finalistIds, sourceThreeSlateIds }
    : { kind: 'duel', finalistIds }
}

export function createPickState(
  selectedId: string,
  sourceDuel?: DuelState | undefined,
  sourceThreeSlateIds?: [string, string, string] | undefined,
): PickState {
  return {
    kind: 'pick',
    selectedId,
    sourceDuel,
    sourceThreeSlateIds,
  }
}

export function isValidDecisionState(state: DecisionState): boolean {
  switch (state.kind) {
    case 'three-slate':
      return (
        typeof state.movieIds[0] === 'string' &&
        typeof state.movieIds[1] === 'string' &&
        typeof state.movieIds[2] === 'string'
      )
    case 'duel':
      return (
        typeof state.finalistIds[0] === 'string' &&
        typeof state.finalistIds[1] === 'string'
      )
    case 'pick':
      return typeof state.selectedId === 'string'
    default:
      return false
  }
}

export function isValidSchemaVersion(version: string): version is DecisionModeSchemaVersion {
  return version === V4_SCHEMA_VERSION
}

export function isValidMood(value: string): value is Mood {
  return ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'].includes(value)
}

export function isValidSituation(value: string | null): value is ViewingSituation | null {
  if (value === null) return true
  return ['alone', 'date-night', 'friends', 'family', 'easy-watch'].includes(value)
}
