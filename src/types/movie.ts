export type Mood = 'funny' | 'exciting' | 'thoughtful' | 'relaxing' | 'emotional' | 'suspenseful'

export interface Movie {
  id: string
  title: string
  year: number
  director: string
  countries: string[]
  genres: string[]
  moods: Mood[]
  description: string
  whyWatch: string
  palette: [string, string]
}
