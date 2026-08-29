import type {
  DiscoveryPreferences,
  Mood,
  Movie,
  MovieFilters,
  Mood as MoodType,
  ViewingSituation,
} from '../types/movie'
import type {
  DecisionCompanionCue,
  DecisionCompanionDimension,
} from '../types/decision'

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
  easy: 'easygoing',
  engaged: 'engaging',
  immersive: 'immersive',
}

const DISCOVERY_LABEL: Record<string, string> = {
  familiar: 'familiar',
  different: 'different',
  adventurous: 'adventurous',
}

const PACE_LABEL: Record<string, string> = {
  slow: 'slower',
  medium: 'steady',
  fast: 'faster',
}

const EMOTIONAL_LABEL: Record<string, string> = {
  light: 'lighter',
  moderate: 'emotionally balanced',
  heavy: 'heavier',
}

const DECISION_COMPANION_DIMENSIONS: DecisionCompanionDimension[] = [
  'attentionDemand',
  'emotionalWeight',
  'pace',
]

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

interface CandidateDecisionCompanionSplit {
  dimension: DecisionCompanionDimension
  majorityValue: string
  outlierValue: string
  majorityMovies: [Movie, Movie]
  outlierMovie: Movie
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
    reasons.push(`matches the ${ATTENTION_LABEL[options.attentionDemand]} headspace`)
  }

  // Discovery style (soft preference)
  if (options.discoveryStyle && movie.discoveryStyle === options.discoveryStyle) {
    reasons.push(`keeps things ${DISCOVERY_LABEL[options.discoveryStyle]}`)
  }

  // Pace matching (when specified as preference)
  if (options.pace && movie.pace === options.pace) {
    reasons.push(movie.pace === 'medium' ? 'keeps an even rhythm' : `leans ${PACE_LABEL[movie.pace]}`)
  }

  // Emotional weight matching (when specified as preference)
  if (options.emotionalWeight && movie.emotionalWeight === options.emotionalWeight) {
    reasons.push(movie.emotionalWeight === 'moderate' ? 'has room for feeling without going all the way under' : `stays ${EMOTIONAL_LABEL[movie.emotionalWeight]}`)
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

function getCompanionValue(movie: Movie, dimension: DecisionCompanionDimension): string {
  return movie[dimension]
}

function getCleanDecisionCompanionSplit(
  movies: [Movie, Movie, Movie],
  dimension: DecisionCompanionDimension,
): CandidateDecisionCompanionSplit | null {
  const groups = new Map<string, Movie[]>()

  for (const movie of movies) {
    const value = getCompanionValue(movie, dimension)
    groups.set(value, [...(groups.get(value) ?? []), movie])
  }

  if (groups.size !== 2) {
    return null
  }

  const entries = [...groups.entries()]
  const majorityEntry = entries.find(([, groupMovies]) => groupMovies.length === 2)
  const minorityEntry = entries.find(([, groupMovies]) => groupMovies.length === 1)

  if (!majorityEntry || !minorityEntry) {
    return null
  }

  return {
    dimension,
    majorityValue: majorityEntry[0],
    outlierValue: minorityEntry[0],
    majorityMovies: [majorityEntry[1][0], majorityEntry[1][1]],
    outlierMovie: minorityEntry[1][0],
  }
}

function dealbreakerResolvesCompanionSplit(split: CandidateDecisionCompanionSplit, context: DecisionContext) {
  const dealbreakers = context.discoveryPreferences?.dealbreakers

  if (!dealbreakers) {
    return false
  }

  if (
    split.dimension === 'pace'
    && dealbreakers.avoidSlow
    && (split.majorityValue === 'slow' || split.outlierValue === 'slow')
  ) {
    return true
  }

  if (
    split.dimension === 'emotionalWeight'
    && dealbreakers.avoidHeavy
    && (split.majorityValue === 'heavy' || split.outlierValue === 'heavy')
  ) {
    return true
  }

  return false
}

function contextMakesCompanionSplitRedundant(split: CandidateDecisionCompanionSplit, context: DecisionContext) {
  const filters = context.filters
  const preferences = context.discoveryPreferences

  if (split.dimension === 'attentionDemand') {
    return Boolean(preferences?.attentionDemand)
  }

  if (split.dimension === 'pace') {
    return Boolean(filters?.pace) || dealbreakerResolvesCompanionSplit(split, context)
  }

  if (split.dimension === 'emotionalWeight') {
    return Boolean(filters?.emotionalWeight) || dealbreakerResolvesCompanionSplit(split, context)
  }

  return false
}

function isSalientCompanionSplit(split: CandidateDecisionCompanionSplit) {
  const values = new Set([split.majorityValue, split.outlierValue])

  if (split.dimension === 'attentionDemand') {
    return values.has('easy') && (values.has('engaged') || values.has('immersive'))
  }

  if (split.dimension === 'emotionalWeight') {
    return values.has('heavy') && (values.has('moderate') || values.has('light'))
  }

  return values.has('slow') && values.has('fast')
}

function getCompanionObservation(split: CandidateDecisionCompanionSplit): string {
  if (split.dimension === 'attentionDemand') {
    return split.outlierValue === 'easy'
      ? 'It asks less of your attention than the other two.'
      : 'It asks for more of your attention; the other two are easier to settle into.'
  }

  if (split.dimension === 'emotionalWeight') {
    return split.outlierValue === 'heavy'
      ? 'It carries a heavier emotional charge than the other two.'
      : 'It stays emotionally lighter than the other two.'
  }

  return split.outlierValue === 'fast'
    ? 'It moves at a much quicker clip; the other two take their time.'
    : 'It takes its time more than the other two.'
}

export function getDecisionCompanionCue(
  movies: Movie[],
  context: DecisionContext,
): DecisionCompanionCue | null {
  if (movies.length !== 3) {
    return null
  }

  const slate: [Movie, Movie, Movie] = [movies[0], movies[1], movies[2]]
  const salientSplits = DECISION_COMPANION_DIMENSIONS
    .map((dimension) => getCleanDecisionCompanionSplit(slate, dimension))
    .filter((split): split is CandidateDecisionCompanionSplit => split !== null)
    .filter((split) => !contextMakesCompanionSplitRedundant(split, context))
    .filter(isSalientCompanionSplit)

  if (salientSplits.length === 0) {
    return null
  }

  const [firstSplit] = salientSplits
  const hasOneCoherentOutlier = salientSplits.every(
    (split) => split.outlierMovie.id === firstSplit.outlierMovie.id,
  )

  if (!hasOneCoherentOutlier) {
    return null
  }

  return {
    outlierMovieId: firstSplit.outlierMovie.id,
    majorityMovieIds: [
      firstSplit.majorityMovies[0].id,
      firstSplit.majorityMovies[1].id,
    ],
    salientDimensions: salientSplits.map((split) => split.dimension),
    observation: getCompanionObservation(firstSplit),
  }
}

function runtimeSummary(first: Movie, second: Movie) {
  const difference = Math.abs(first.runtimeMinutes - second.runtimeMinutes)
  if (difference < 10) return null

  const shorter = first.runtimeMinutes < second.runtimeMinutes ? first : second
  const longer = shorter.id === first.id ? second : first

  if (difference >= 25) {
    return `${shorter.title} is the shorter commitment tonight.`
  }

  return `${longer.title} asks for about ${difference} more minutes.`
}

function paceSummary(first: Movie, second: Movie) {
  if (first.pace === 'medium' || second.pace === 'medium') return null

  const faster = first.pace === 'fast' ? first : second
  const slower = faster.id === first.id ? second : first
  return `${faster.title} moves faster; ${slower.title} takes its time.`
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
          summary: paceSummary(first, second) ?? undefined,
        }
    case 'runtime':
      return first.runtimeMinutes === second.runtimeMinutes
        ? null
        : {
          category: 'runtime',
          firstValue: runtimeLabel(first),
          secondValue: runtimeLabel(second),
          summary: runtimeSummary(first, second) ?? undefined,
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
    } else if (
      difference.summary
      && (dimension === 'attention' || dimension === 'emotional weight')
      && usedEaseSummary
    ) {
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
