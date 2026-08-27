import type { Mood, MovieFilters, DiscoveryPreferences, ViewingSituation } from '../types/movie'
import type { DecisionState, DecisionModeState } from '../types/decision'

const DEFAULT_FILTERS: MovieFilters = {
  genres: [],
  runtime: null,
  language: null,
  pace: null,
  emotionalWeight: null,
}

const DEFAULT_DISCOVERY: DiscoveryPreferences = {
  attentionDemand: null,
  discoveryStyle: null,
  dealbreakers: {
    avoidHeavy: false,
    avoidSlow: false,
    underTwoHours: false,
  },
}

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

function deserializeFilters(str: string | null): MovieFilters {
  if (!str) {
    return { ...DEFAULT_FILTERS }
  }

  const result: MovieFilters = { ...DEFAULT_FILTERS }
  const parts = str.split('|')

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!value) continue

    if (key === 'g') {
      result.genres = value.split(',')
    } else if (key === 'r') {
      result.runtime = value as MovieFilters['runtime']
    } else if (key === 'l') {
      result.language = value
    } else if (key === 'p') {
      result.pace = value as MovieFilters['pace']
    } else if (key === 'e') {
      result.emotionalWeight = value as MovieFilters['emotionalWeight']
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

function deserializeDiscoveryPreferences(str: string | null): DiscoveryPreferences {
  if (!str) {
    return { ...DEFAULT_DISCOVERY }
  }

  const result: DiscoveryPreferences = { ...DEFAULT_DISCOVERY }
  const parts = str.split('|')

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!value) continue

    if (key === 'a') {
      result.attentionDemand = value as DiscoveryPreferences['attentionDemand']
    } else if (key === 'd') {
      result.discoveryStyle = value as DiscoveryPreferences['discoveryStyle']
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

function serializeDecisionState(state: DecisionState): string {
  switch (state.kind) {
    case 'three-slate':
      return `ts:${state.movieIds.join(',')}`
    case 'duel':
      return `dl:${state.finalistIds.join(',')}`
    case 'pick':
      return `pk:${state.selectedId}`
    default:
      throw new Error(`Unknown decision state kind: ${(state as any).kind}`)
  }
}

function deserializeDecisionState(str: string | null): DecisionState | null {
  if (!str) {
    return null
  }

  const [kind, value] = str.split(':')
  const ids = value?.split(',') ?? []

  switch (kind) {
    case 'ts':
      if (ids.length !== 3 || ids.some((id) => !id)) {
        return null
      }
      return { kind: 'three-slate', movieIds: [ids[0], ids[1], ids[2]] as [string, string, string] }
    case 'dl':
      if (ids.length !== 2 || ids.some((id) => !id)) {
        return null
      }
      return { kind: 'duel', finalistIds: [ids[0], ids[1]] as [string, string] }
    case 'pk':
      if (!ids[0]) {
        return null
      }
      return { kind: 'pick', selectedId: ids[0] }
    default:
      return null
  }
}

const VALID_MOODS = ['funny', 'exciting', 'thoughtful', 'relaxing', 'emotional', 'suspenseful'] as const
const VALID_SITUATIONS = ['alone', 'date-night', 'friends', 'family', 'easy-watch'] as const

type ValidMood = typeof VALID_MOODS[number]

function validateMood(value: string | null): ValidMood | null {
  if (!value) return null
  if (VALID_MOODS.includes(value as ValidMood)) return value as ValidMood
  return null
}

function validateSituation(value: string | null): ViewingSituation | null {
  if (!value) return null
  if (VALID_SITUATIONS.includes(value as ViewingSituation)) return value as ViewingSituation
  return null
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
    const searchParams = new URLSearchParams(
      url.includes('?') ? url.split('?')[1] : url,
    )

    // Check mode is decision
    if (searchParams.get('mode') !== 'decision') {
      return null
    }

    // Check schema version
    const version = searchParams.get('v')
    if (version !== 'v4') {
      return null
    }

    // Validate mood
    const moodStr = searchParams.get('m')
    const mood = validateMood(moodStr)
    if (!mood) {
      return null
    }

    // Parse situation
    const situationStr = searchParams.get('s')
    const situation = situationStr ? validateSituation(situationStr) : null

    // Parse filters
    const filtersStr = searchParams.get('f')
    const filters = deserializeFilters(filtersStr)

    // Parse discovery preferences
    const discoveryStr = searchParams.get('d')
    const discoveryPreferences = deserializeDiscoveryPreferences(discoveryStr)

    // Parse decision state
    const decisionStr = searchParams.get('ds')
    const decisionState = deserializeDecisionState(decisionStr)

    if (!decisionState) {
      return null
    }

    return {
      schemaVersion: 'v4',
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
  mood: ValidMood,
  decisionState: DecisionState,
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('mode', 'decision')
  searchParams.set('v', 'v4')
  searchParams.set('m', mood)
  searchParams.set('s', '')
  searchParams.set('f', serializeFilters(DEFAULT_FILTERS))
  searchParams.set('d', serializeDiscoveryPreferences(DEFAULT_DISCOVERY))
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