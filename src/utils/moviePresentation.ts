import type { AttentionDemand, EmotionalWeight, Movie, Pace } from '../types/movie'

const attentionCueLabels: Record<AttentionDemand, string | null> = {
  easy: 'Easygoing',
  engaged: 'Keeps you engaged',
  immersive: 'Full-attention watch',
}

const paceCueLabels: Record<Pace, string | null> = {
  slow: 'Patient burn',
  medium: null,
  fast: 'Moves quickly',
}

const emotionalCueLabels: Record<EmotionalWeight, string | null> = {
  light: 'Gentle emotional lift',
  moderate: null,
  heavy: 'Emotionally weighty',
}

export function formatRuntime(runtimeMinutes: number) {
  return `${runtimeMinutes} min`
}

export function getFinishTimeLabel(runtimeMinutes: number, now: Date = new Date()): string {
  const finish = new Date(now.getTime() + runtimeMinutes * 60 * 1000)
  const hours24 = finish.getHours()
  const minutes = finish.getMinutes()
  const period = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const mm = String(minutes).padStart(2, '0')
  return `Ends around ${hours12}:${mm} ${period}`
}

export function formatCompactFacts(movie: Movie) {
  return `${movie.year} · ${formatRuntime(movie.runtimeMinutes)}`
}

export function formatGenreSummary(movie: Movie) {
  return movie.genres.slice(0, 2).join(' · ')
}

export function getExperientialCue(movie: Movie) {
  return (
    emotionalCueLabels[movie.emotionalWeight]
    ?? paceCueLabels[movie.pace]
    ?? attentionCueLabels[movie.attentionDemand]
  )
}

export function getPaceDetailLabel(pace: Pace) {
  if (pace === 'slow') return 'Slow burn'
  if (pace === 'fast') return 'Fast-moving'
  return 'Balanced pace'
}

export function getEmotionalWeightDetailLabel(emotionalWeight: EmotionalWeight) {
  if (emotionalWeight === 'light') return 'Light'
  if (emotionalWeight === 'heavy') return 'Heavy'
  return 'Moderate'
}
