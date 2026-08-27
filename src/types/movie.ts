export type Mood = 'funny' | 'exciting' | 'thoughtful' | 'relaxing' | 'emotional' | 'suspenseful'

export type ViewingSituation = 'alone' | 'date-night' | 'friends' | 'family' | 'easy-watch'

export type Pace = 'slow' | 'medium' | 'fast'

export type EmotionalWeight = 'light' | 'moderate' | 'heavy'

export type RuntimeFilter = 'short' | 'medium' | 'long'

export type AttentionDemand = 'easy' | 'engaged' | 'immersive'

export type DiscoveryStyle = 'familiar' | 'different' | 'adventurous'

export interface Dealbreakers {
  avoidHeavy: boolean
  avoidSlow: boolean
  underTwoHours: boolean
}

export interface DiscoveryPreferences {
  attentionDemand: AttentionDemand | null
  discoveryStyle: DiscoveryStyle | null
  dealbreakers: Dealbreakers
}

export interface MovieFilters {
  genres: string[]
  runtime: RuntimeFilter | null
  language: string | null
  pace: Pace | null
  emotionalWeight: EmotionalWeight | null
}

export interface CuratedMovie {
  id: string
  tmdbId: number
  moods: Mood[]
  situations: ViewingSituation[]
  filterLanguages: string[]
  pace: Pace
  emotionalWeight: EmotionalWeight
  attentionDemand: AttentionDemand
  discoveryStyle: DiscoveryStyle
  description: string
  whyWatch: string
  curiosityHook: string
  vibeSummary: string
  palette: [string, string]
}

export interface MovieFacts {
  tmdbId: number
  title: string
  year: number
  director: string
  countries: string[]
  spokenLanguages: string[]
  genres: string[]
  runtimeMinutes: number
  posterPath: string | null
}

export interface Movie extends CuratedMovie, MovieFacts {
  languages: string[]
}
