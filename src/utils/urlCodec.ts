import { movies } from '../data/movies'
import type {
  AttentionDemand,
  DiscoveryPreferences,
  DiscoveryStyle,
  EmotionalWeight,
  Mood,
  MovieFilters,
  Pace,
  RuntimeFilter,
  ViewingSituation,
} from '../types/movie'
import type {
  DecisionReduction,
  DecisionModeState,
  DecisionState,
  DuelState,
} from '../types/decision'

const VALID_MOVIE_IDS = new Set(movies.map((m) => m.id))
const VALID_MOODS = ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'] as const satisfies readonly Mood[]
const VALID_SITUATIONS = ['alone', 'date-night', 'friends', 'family', 'easy-watch'] as const satisfies readonly ViewingSituation[]
const VALID_RUNTIMES = ['short', 'medium', 'long'] as const satisfies readonly RuntimeFilter[]
const VALID_PACES = ['slow', 'medium', 'fast'] as const satisfies readonly Pace[]
const VALID_EMOTIONAL_WEIGHTS = ['light', 'moderate', 'heavy'] as const satisfies readonly EmotionalWeight[]
const VALID_ATTENTION_DEMANDS = ['easy', 'engaged', 'immersive'] as const satisfies readonly AttentionDemand[]
const VALID_DISCOVERY_STYLES = ['familiar', 'different', 'adventurous'] as const satisfies readonly DiscoveryStyle[]

type ValidMood = (typeof VALID_MOODS)[number]

const isOneOf = <T extends string>(value: string, allowed: readonly T[]): value is T =>
  allowed.includes(value as T)

const isValidMovieId = (id: string): boolean => VALID_MOVIE_IDS.has(id)

const createEmptyFilters = (): MovieFilters => ({
  genres: [],
  runtime: null,
  language: null,
  pace: null,
  emotionalWeight: null,
})

const createEmptyDiscoveryPreferences = (): DiscoveryPreferences => ({
  attentionDemand: null,
  discoveryStyle: null,
  dealbreakers: {
    avoidHeavy: false,
    avoidSlow: false,
    underTwoHours: false,
  },
})

function serializeFilters(filters: MovieFilters): string {
  const parts: string[] = []
  if (filters.genres.length > 0) {
    parts.push(`g=${filters.genres.join(',')}`)
  }
  if (filters.runtime !== null) {
    parts.push(`r=${filters.runtime}`)
  }
  if (filters.language !== null) {
    parts.push(`l=${filters.language}`)
  }
  if (filters.pace !== null) {
    parts.push(`p=${filters.pace}`)
  }
  if (filters.emotionalWeight !== null) {
    parts.push(`e=${filters.emotionalWeight}`)
  }
  return parts.join('|')
}

function deserializeFilters(str: string | null): MovieFilters | null {
  const result = createEmptyFilters()

  if (!str) {
    return result
  }

  const parts = str.split('|')

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!value) continue

    if (key === 'g') {
      result.genres = value.split(',')
    } else if (key === 'r') {
      if (!isOneOf(value, VALID_RUNTIMES)) return null
      result.runtime = value
    } else if (key === 'l') {
      result.language = value
    } else if (key === 'p') {
      if (!isOneOf(value, VALID_PACES)) return null
      result.pace = value
    } else if (key === 'e') {
      if (!isOneOf(value, VALID_EMOTIONAL_WEIGHTS)) return null
      result.emotionalWeight = value
    }
  }

  return result
}

function serializeDiscoveryPreferences(prefs: DiscoveryPreferences): string {
  const parts: string[] = []
  if (prefs.attentionDemand !== null) {
    parts.push(`a=${prefs.attentionDemand}`)
  }
  if (prefs.discoveryStyle !== null) {
    parts.push(`d=${prefs.discoveryStyle}`)
  }
  if (prefs.dealbreakers.avoidHeavy) {
    parts.push('dh=1')
  }
  if (prefs.dealbreakers.avoidSlow) {
    parts.push('ds=1')
  }
  if (prefs.dealbreakers.underTwoHours) {
    parts.push('dt=1')
  }
  return parts.join('|')
}

function deserializeDiscoveryPreferences(str: string | null): DiscoveryPreferences | null {
  const result = createEmptyDiscoveryPreferences()

  if (!str) {
    return result
  }

  const parts = str.split('|')

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!value) continue

    if (key === 'a') {
      if (!isOneOf(value, VALID_ATTENTION_DEMANDS)) return null
      result.attentionDemand = value
    } else if (key === 'd') {
      if (!isOneOf(value, VALID_DISCOVERY_STYLES)) return null
      result.discoveryStyle = value
    } else if (key === 'dh') {
      result.dealbreakers.avoidHeavy = true
    } else if (key === 'ds') {
      result.dealbreakers.avoidSlow = true
    } else if (key === 'dt') {
      result.dealbreakers.underTwoHours = true
    }
  }

  return result
}

function serializeThreeSlateIds(ids: [string, string, string]): string {
  return ids.join(';')
}

function toThreeSlateIds(ids: string[]): [string, string, string] | null {
  if (ids.length !== 3 || ids.some((id) => !id)) {
    return null
  }
  const slateIds: [string, string, string] = [ids[0], ids[1], ids[2]]
  return slateIds.every(isValidMovieId) ? slateIds : null
}

function serializeReduction(reduction: DecisionReduction): string {
  if (reduction.kind === 'companion-drop') {
    return `cd;${reduction.droppedMovieId}`
  }

  return `md;${reduction.droppedMovieId}`
}

function deserializeReduction(parts: string[]): DecisionReduction | null {
  if (parts[0] === 'ad' && parts.length === 4) {
    const [, , , eliminatedMovieId] = parts
    return isValidMovieId(eliminatedMovieId)
      ? { kind: 'companion-drop', droppedMovieId: eliminatedMovieId }
      : null
  }

  if (parts[0] === 'cd' && parts.length === 2) {
    const [, droppedMovieId] = parts
    return isValidMovieId(droppedMovieId) ? { kind: 'companion-drop', droppedMovieId } : null
  }

  if (parts[0] === 'md' && parts.length === 2) {
    const [, droppedMovieId] = parts
    return isValidMovieId(droppedMovieId) ? { kind: 'manual-drop', droppedMovieId } : null
  }

  return null
}

function serializeDuelState(state: DuelState): string {
  if (!state.reduction) {
    const sourceIds = state.sourceThreeSlateIds ? `;${serializeThreeSlateIds(state.sourceThreeSlateIds)}` : ''
    return `dl:${state.finalistIds.join(';')}${sourceIds}`
  }

  const sourceIds = state.sourceThreeSlateIds ? `;src;${serializeThreeSlateIds(state.sourceThreeSlateIds)}` : ''
  return `dl:${state.finalistIds.join(';')}${sourceIds};${serializeReduction(state.reduction)}`
}

function serializeDecisionState(state: DecisionState): string {
  switch (state.kind) {
    case 'three-slate':
      if (state.manuallyDroppedMovieId) {
        return `ts:${serializeThreeSlateIds(state.movieIds)};md;${state.manuallyDroppedMovieId}`
      }
      return state.dismissedCompanionOutlierId
        ? `ts:${serializeThreeSlateIds(state.movieIds)};dc;${state.dismissedCompanionOutlierId}`
        : `ts:${serializeThreeSlateIds(state.movieIds)}`
    case 'duel':
      return serializeDuelState(state)
    case 'pick': {
      if (state.sourceDuel) {
        return `pk:${state.selectedId};duel;${serializeDuelState(state.sourceDuel)}`
      }
      const sourceIds = state.sourceThreeSlateIds ? `;three;${serializeThreeSlateIds(state.sourceThreeSlateIds)}` : ''
      return `pk:${state.selectedId}${sourceIds}`
    }
    default:
      throw new Error(`Unknown decision state kind: ${(state as any).kind}`)
  }
}

function deserializeDecisionState(str: string | null): DecisionState | null {
  if (!str) {
    return null
  }

  const colonIndex = str.indexOf(':')
  if (colonIndex === -1) {
    return null
  }

  const kind = str.substring(0, colonIndex)
  const remainder = str.substring(colonIndex + 1)

  switch (kind) {
    case 'ts': {
      const ids = remainder.split(';')
      if (ids.length !== 3 && ids.length !== 5) {
        return null
      }

      const movieIds = toThreeSlateIds(ids.slice(0, 3))
      if (!movieIds) {
        return null
      }

      if (ids.length === 5) {
        const marker = ids[3]
        const movieId = ids[4]
        if (!isValidMovieId(movieId) || !movieIds.includes(movieId)) return null
        if (marker === 'md') return { kind: 'three-slate', movieIds, manuallyDroppedMovieId: movieId }
        if (marker === 'dc') return { kind: 'three-slate', movieIds, dismissedCompanionOutlierId: movieId }
        return null
      }

      return { kind: 'three-slate', movieIds }
    }
    case 'dl': {
      const ids = remainder.split(';')
      if (ids.length !== 2 && ids.length !== 4 && ids.length !== 5 && ids.length !== 6 && ids.length !== 8 && ids.length !== 10) {
        return null
      }
      const finalistIds: [string, string] = [ids[0], ids[1]]
      if (!finalistIds.every(isValidMovieId)) {
        return null
      }

      if (ids.length === 4 || ids.length === 6) {
        const reduction = deserializeReduction(ids.slice(2))
        return reduction ? { kind: 'duel', finalistIds, reduction } : null
      }

      if (ids.length === 8 || ids.length === 10) {
        if (ids[2] !== 'src') return null
        const sourceThreeSlateIds = toThreeSlateIds(ids.slice(3, 6))
        const reduction = deserializeReduction(ids.slice(6))
        return sourceThreeSlateIds && reduction
          ? { kind: 'duel', finalistIds, sourceThreeSlateIds, reduction }
          : null
      }

      const sourceThreeSlateIds = ids.length === 5 ? toThreeSlateIds(ids.slice(2)) : null
      if (ids.length === 5 && !sourceThreeSlateIds) return null
      return sourceThreeSlateIds
        ? { kind: 'duel', finalistIds, sourceThreeSlateIds }
        : { kind: 'duel', finalistIds }
    }
    case 'pk': {
      const ids = remainder.split(';')
      if (!ids[0]) {
        return null
      }
      if (!isValidMovieId(ids[0])) {
        return null
      }

      if (ids.length === 1) {
        return { kind: 'pick', selectedId: ids[0] }
      }

      if (ids[1] === 'three' && ids.length === 5) {
        const sourceThreeSlateIds = toThreeSlateIds(ids.slice(2))
        return sourceThreeSlateIds ? { kind: 'pick', selectedId: ids[0], sourceThreeSlateIds } : null
      }

      if (ids[1] === 'duel') {
        const sourceDuel = deserializeDecisionState(ids.slice(2).join(';'))
        if (!sourceDuel || sourceDuel.kind !== 'duel') {
          return null
        }
        return { kind: 'pick', selectedId: ids[0], sourceDuel }
      }

      if (ids.length === 4) {
        const sourceThreeSlateIds = toThreeSlateIds(ids.slice(1))
        return sourceThreeSlateIds ? { kind: 'pick', selectedId: ids[0], sourceThreeSlateIds } : null
      }

      if (ids.length === 6) {
        const sourceDuel = deserializeDecisionState(`dl:${ids.slice(1).join(';')}`)
        if (!sourceDuel || sourceDuel.kind !== 'duel') {
          return null
        }
        return { kind: 'pick', selectedId: ids[0], sourceDuel }
      }

      return null
    }
    default:
      return null
  }
}

function validateSituation(value: string | null): ViewingSituation | null {
  if (!value) return null
  if (isOneOf(value, VALID_SITUATIONS)) return value
  return null
}

function validateMood(value: string | null): ValidMood | null {
  if (!value) return null
  if (isOneOf(value, VALID_MOODS)) return value
  return null
}

function extractSearchParams(url: string): URLSearchParams {
  if (!url.includes('?')) {
    return new URLSearchParams(url.split('#')[0])
  }

  const afterQuestionMark = url.slice(url.indexOf('?') + 1)
  return new URLSearchParams(afterQuestionMark.split('#')[0])
}

export function encodeDecisionState(state: DecisionModeState): string {
  const searchParams = new URLSearchParams()
  searchParams.set('mode', 'decision')
  searchParams.set('v', state.schemaVersion)
  searchParams.set('m', state.mood)
  searchParams.set('s', state.situation ?? '')
  searchParams.set('f', serializeFilters(state.filters))
  searchParams.set('d', serializeDiscoveryPreferences(state.discoveryPreferences))
  searchParams.set('ds', serializeDecisionState(state.decisionState))

  return searchParams.toString()
}

export function decodeDecisionState(url: string): DecisionModeState | null {
  try {
    const searchParams = extractSearchParams(url)

    if (searchParams.get('mode') !== 'decision') {
      return null
    }

    const version = searchParams.get('v')
    if (version !== 'v4' && version !== 'v6') {
      return null
    }

    const mood = validateMood(searchParams.get('m'))
    if (!mood) {
      return null
    }

    const situation = validateSituation(searchParams.get('s'))

    const filters = deserializeFilters(searchParams.get('f'))
    if (!filters) {
      return null
    }

    const discoveryPreferences = deserializeDiscoveryPreferences(searchParams.get('d'))
    if (!discoveryPreferences) {
      return null
    }

    const decisionState = deserializeDecisionState(searchParams.get('ds'))
    if (!decisionState) {
      return null
    }

    return {
      schemaVersion: version,
      mood,
      situation,
      filters,
      discoveryPreferences,
      decisionState,
    }
  } catch {
    return null
  }
}

export function encodeSimpleState(
  mood: Mood,
  decisionState: DecisionState,
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('mode', 'decision')
  searchParams.set('v', 'v4')
  searchParams.set('m', mood)
  searchParams.set('s', '')
  searchParams.set('f', serializeFilters(createEmptyFilters()))
  searchParams.set('d', serializeDiscoveryPreferences(createEmptyDiscoveryPreferences()))
  searchParams.set('ds', serializeDecisionState(decisionState))
  return searchParams.toString()
}

export function buildUrlFromState(encodedState: string, baseUrl: string = ''): string {
  if (!encodedState) return baseUrl || ''

  if (baseUrl?.includes('?')) {
    return `${baseUrl}&${encodedState}`
  }
  return `${baseUrl}?${encodedState}`
}
