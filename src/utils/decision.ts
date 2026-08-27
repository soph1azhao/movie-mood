import type {
  DiscoveryPreferences,
  Mood,
  Movie,
  MovieFilters,
  Mood as MoodType,
  ViewingSituation,
} from '../types/movie'

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

interface DecisionContext {
  mood: MoodType
  filters?: MovieFilters
  discoveryPreferences?: DiscoveryPreferences
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
  summary?: string
}

interface ComparisonResult {
  differences: DiffReason[]
}

type DecisionDimension = 'attention' | 'emotional weight' | 'style' | 'pace' | 'runtime' | 'genre' | 'mood'

const fallbackDimensionOrder: DecisionDimension[] = [
  'pace',
  'runtime',
  'emotional weight',
  'attention',
  'style',
  'genre',
  'mood',
]

function getActiveContextDimensions(context: DecisionContext): DecisionDimension[] {
  const dimensions: DecisionDimension[] = []
  const filters = context.filters
  const preferences = context.discoveryPreferences

  if (preferences?.attentionDemand) {
    dimensions.push('attention')
  }

  if (filters?.emotionalWeight || preferences?.dealbreakers.avoidHeavy) {
    dimensions.push('emotional weight')
  }

  if (preferences?.discoveryStyle) {
    dimensions.push('style')
  }

  if (filters?.pace || preferences?.dealbreakers.avoidSlow) {
    dimensions.push('pace')
  }

  if (filters?.runtime || preferences?.dealbreakers.underTwoHours) {
    dimensions.push('runtime')
  }

  return dimensions
}

function uniqueInOrder<T>(values: T[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function runtimeLabel(movie: Movie) {
  if (movie.runtimeMinutes < 100) return `${movie.runtimeMinutes} min, shorter`
  if (movie.runtimeMinutes <= 130) return `${movie.runtimeMinutes} min, medium length`
  return `${movie.runtimeMinutes} min, longer`
}

function emotionalRank(movie: Movie) {
  if (movie.emotionalWeight === 'light') return 0
  if (movie.emotionalWeight === 'moderate') return 1
  return 2
}

function attentionRank(movie: Movie) {
  if (movie.attentionDemand === 'easy') return 0
  if (movie.attentionDemand === 'engaged') return 1
  return 2
}

function lowerEffortSummary(first: Movie, second: Movie) {
  const firstIsEmotionallyEasier = emotionalRank(first) < emotionalRank(second)
  const secondIsEmotionallyEasier = emotionalRank(second) < emotionalRank(first)
  const firstIsLowerEffort = attentionRank(first) < attentionRank(second)
  const secondIsLowerEffort = attentionRank(second) < attentionRank(first)

  if ((firstIsEmotionallyEasier || firstIsLowerEffort) && !secondIsEmotionallyEasier && !secondIsLowerEffort) {
    return `${first.title} is the gentler, lower-effort watch tonight.`
  }

  if ((secondIsEmotionallyEasier || secondIsLowerEffort) && !firstIsEmotionallyEasier && !firstIsLowerEffort) {
    return `${second.title} is the gentler, lower-effort watch tonight.`
  }

  return null
}

function createDifference(first: Movie, second: Movie, dimension: DecisionDimension): DiffReason | null {
  switch (dimension) {
    case 'attention':
      return first.attentionDemand === second.attentionDemand
        ? null
        : {
          category: 'attention',
          firstValue: ATTENTION_LABEL[first.attentionDemand],
          secondValue: ATTENTION_LABEL[second.attentionDemand],
          summary: lowerEffortSummary(first, second) ?? undefined,
        }
    case 'emotional weight':
      return first.emotionalWeight === second.emotionalWeight
        ? null
        : {
          category: 'emotional weight',
          firstValue: EMOTIONAL_LABEL[first.emotionalWeight],
          secondValue: EMOTIONAL_LABEL[second.emotionalWeight],
          summary: lowerEffortSummary(first, second) ?? undefined,
        }
    case 'style':
      return first.discoveryStyle === second.discoveryStyle
        ? null
        : {
          category: 'style',
          firstValue: DISCOVERY_LABEL[first.discoveryStyle],
          secondValue: DISCOVERY_LABEL[second.discoveryStyle],
        }
    case 'pace':
      return first.pace === second.pace
        ? null
        : {
          category: 'pace',
          firstValue: PACE_LABEL[first.pace],
          secondValue: PACE_LABEL[second.pace],
        }
    case 'runtime':
      return first.runtimeMinutes === second.runtimeMinutes
        ? null
        : {
          category: 'runtime',
          firstValue: runtimeLabel(first),
          secondValue: runtimeLabel(second),
        }
    case 'genre': {
      const firstGenres = new Set(first.genres)
      const secondGenres = new Set(second.genres)
      const firstOnlyGenres = [...firstGenres].filter((genre) => !secondGenres.has(genre))
      const secondOnlyGenres = [...secondGenres].filter((genre) => !firstGenres.has(genre))

      return firstOnlyGenres.length > 0 || secondOnlyGenres.length > 0
        ? {
          category: 'genre',
          firstValue: first.genres.join(', '),
          secondValue: second.genres.join(', '),
        }
        : null
    }
    case 'mood': {
      const firstOnlyMoods = first.moods.filter((mood) => !second.moods.includes(mood))
      const secondOnlyMoods = second.moods.filter((mood) => !first.moods.includes(mood))

      return firstOnlyMoods.length > 0 || secondOnlyMoods.length > 0
        ? {
          category: 'mood',
          firstValue: firstOnlyMoods.join(', '),
          secondValue: secondOnlyMoods.join(', '),
        }
        : null
    }
    default:
      return null
  }
}

export function getPrioritizedDecisionFactors(
  first: Movie,
  second: Movie,
  context: DecisionContext,
  limit = 2,
): DiffReason[] {
  const dimensionOrder = uniqueInOrder([
    ...getActiveContextDimensions(context),
    ...fallbackDimensionOrder,
  ])
  const differences: DiffReason[] = []
  let usedEaseSummary = false

  for (const dimension of dimensionOrder) {
    const difference = createDifference(first, second, dimension)
    if (!difference) continue

    if (
      difference.summary
      && (dimension === 'attention' || dimension === 'emotional weight')
      && !usedEaseSummary
    ) {
      differences.push(difference)
      usedEaseSummary = true
    } else if (difference.summary && usedEaseSummary) {
      continue
    } else {
      differences.push(difference)
    }

    if (differences.length >= limit) break
  }

  return differences
}

export function updateDuelFinalistSelection(currentIds: string[], movieId: string) {
  if (currentIds.includes(movieId)) {
    return currentIds.filter((id) => id !== movieId)
  }

  return currentIds.length >= 2 ? currentIds : [...currentIds, movieId]
}

export function compareMoviesForDuel(
  first: Movie,
  second: Movie,
  context: DecisionContext,
): ComparisonResult {
  return { differences: getPrioritizedDecisionFactors(first, second, context) }
}

export type { DecisionContext, DiffReason, ComparisonResult }
