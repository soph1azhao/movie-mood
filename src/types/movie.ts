export type Mood = 'funny' | 'exciting' | 'thoughtful' | 'relaxing' | 'emotional' | 'suspenseful'

export type ViewingSituation = 'alone' | 'date-night' | 'friends' | 'family' | 'easy-watch'

export type Pace = 'slow' | 'medium' | 'fast'

export type EmotionalWeight = 'light' | 'moderate' | 'heavy'

export type RuntimeFilter = 'short' | 'medium' | 'long'

export interface MovieFilters {
  genres: string[]
  runtime: RuntimeFilter | null
  language: string | null
  pace: Pace | null
  emotionalWeight: EmotionalWeight | null
}

export interface Movie {
  id: string
  title: string
  year: number
  director: string
  countries: string[]
  languages: string[]
  genres: string[]
  runtimeMinutes: number
  moods: Mood[]
  situations: ViewingSituation[]
  pace: Pace
  emotionalWeight: EmotionalWeight
  description: string
  whyWatch: string
  curiosityHook: string
  vibeSummary: string
  palette: [string, string]
}
