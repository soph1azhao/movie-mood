import type { Mood, Movie, Mood as MoodType, ViewingSituation } from '../types/movie'

const MOOD_LABELS: Record<string, string> = {
  funny: 'funny',
  exciting: 'exciting',
  thoughtful: 'thoughtful',
  relaxing: 'relaxing',
  emotional: 'emotional',
  suspenseful: 'suspenseful',
}

const SITUATION_LABELS: Record<string, string> = {
  alone: 'you alone',
  'date-night': 'a date night',
  friends: 'friends',
  family: 'the family',
  'easy-watch': 'an easy watch',
}

const ATTENTION_LABEL: Record<string, string> = {
  easy: 'easy',
  engaged: 'engaged',
  immersive: 'immersive',
}

const DISCOVERY_LABEL: Record<string, string> = {
  familiar: 'familiar',
  different: 'different',
  adventurous: 'adventurous',
}

const PACE_LABEL: Record<string, string> = {
  slow: 'slow',
  medium: 'medium-paced',
  fast: 'fast',
}

const EMOTIONAL_LABEL: Record<string, string> = {
  light: 'light',
  moderate: 'moderate emotional weight',
  heavy: 'heavy emotional weight',
}

interface WhyFitsOptions {
  mood: MoodType
  situation: ViewingSituation | null
  attentionDemand: 'easy' | 'engaged' | 'immersive' | null
  discoveryStyle: 'familiar' | 'different' | 'adventurous' | null
  pace: 'slow' | 'medium' | 'fast' | null
  emotionalWeight: 'light' | 'moderate' | 'heavy' | null
}

export function whyItFitsTonight(
  movie: Movie,
  options: WhyFitsOptions,
): string[] {
  const reasons: string[] = []

  // Mood fit
  if (movie.moods.includes(options.mood)) {
    reasons.push(`fits your ${MOOD_LABELS[options.mood]} mood`)
  }

  // Situation fit
  if (options.situation && movie.situations.includes(options.situation)) {
    reasons.push(`perfect for ${SITUATION_LABELS[options.situation]}`)
  }

  // Attention demand (soft preference)
  if (options.attentionDemand && movie.attentionDemand === options.attentionDemand) {
    reasons.push(`matches your ${ATTENTION_LABEL[options.attentionDemand]} vibe`)
  }

  // Discovery style (soft preference)
  if (options.discoveryStyle && movie.discoveryStyle === options.discoveryStyle) {
    reasons.push(`offers a ${DISCOVERY_LABEL[options.discoveryStyle]} feel vibe`)
  }

  // Pace matching (when specified as preference)
  if (options.pace && movie.pace === options.pace) {
    reasons.push(`has a ${PACE_LABEL[movie.pace]} pace`)
  }

  // Emotional weight matching (when specified as preference)
  if (options.emotionalWeight && movie.emotionalWeight === options.emotionalWeight) {
    reasons.push(`has ${EMOTIONAL_LABEL[movie.emotionalWeight]} emotional weight`)
  }

  return reasons
}

interface DiffReason {
  category: string
  firstValue: string
  secondValue: string
}

interface ComparisonResult {
  differences: DiffReason[]
}

export function compareMoviesForDuel(
  first: Movie,
  second: Movie,
  context: { mood: MoodType },
): ComparisonResult {
  const differences: DiffReason[] = []

  // Compare moods (shared + unique)
  const firstOnlyMoods = first.moods.filter((m) => !second.moods.includes(m))
  const secondOnlyMoods = second.moods.filter((m) => !first.moods.includes(m))

  if (firstOnlyMoods.length > 0) {
    differences.push({
      category: 'mood',
      firstValue: firstOnlyMoods.join(', '),
      secondValue: secondOnlyMoods.join(', '),
    })
  } else if (secondOnlyMoods.length > 0) {
    differences.push({
      category: 'mood',
      firstValue: firstOnlyMoods.join(', '),
      secondValue: secondOnlyMoods.join(', '),
    })
  }

  // Compare genres
  const firstGenres = new Set(first.genres)
  const secondGenres = new Set(second.genres)
  const firstOnlyGenres = [...firstGenres].filter((g) => !secondGenres.has(g))
  const secondOnlyGenres = [...secondGenres].filter((g) => !firstGenres.has(g))

  if (firstOnlyGenres.length > 0 || secondOnlyGenres.length > 0) {
    differences.push({
      category: 'genre',
      firstValue: first.genres.join(', '),
      secondValue: second.genres.join(', '),
    })
  }

  // Compare pace
  if (first.pace !== second.pace) {
    differences.push({
      category: 'pace',
      firstValue: PACE_LABEL[first.pace],
      secondValue: PACE_LABEL[second.pace],
    })
  }

  // Compare emotional weight
  if (first.emotionalWeight !== second.emotionalWeight) {
    differences.push({
      category: 'emotional weight',
      firstValue: EMOTIONAL_LABEL[first.emotionalWeight],
      secondValue: EMOTIONAL_LABEL[second.emotionalWeight],
    })
  }

  // Compare attention demand
  if (first.attentionDemand !== second.attentionDemand) {
    differences.push({
      category: 'attention',
      firstValue: ATTENTION_LABEL[first.attentionDemand],
      secondValue: ATTENTION_LABEL[second.attentionDemand],
    })
  }

  // Compare discovery style
  if (first.discoveryStyle !== second.discoveryStyle) {
    differences.push({
      category: 'style',
      firstValue: DISCOVERY_LABEL[first.discoveryStyle],
      secondValue: DISCOVERY_LABEL[second.discoveryStyle],
    })
  }

  return { differences }
}

export type { DiffReason, ComparisonResult }