import type {
  DiscoveryPreferences,
  Mood,
  Movie,
  MovieFilters,
  Mood as MoodType,
  ViewingSituation,
} from '../types/movie'
import type {
  AdaptiveDecisionDimension,
  AdaptiveDecisionOption,
  AdaptiveDecisionQuestion,
  AdaptiveDecisionValue,
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

const ADAPTIVE_DIMENSION_PRIORITY: AdaptiveDecisionDimension[] = [
  'attentionDemand',
  'pace',
  'emotionalWeight',
  'runtime',
]

const ADAPTIVE_PROMPTS: Record<AdaptiveDecisionDimension, string> = {
  attentionDemand: 'What kind of attention do you want to spend tonight?',
  pace: 'What rhythm sounds better tonight?',
  emotionalWeight: 'How much emotional weight do you want tonight?',
  runtime: 'How much time do you want to give this?',
}

const ADAPTIVE_OPTION_LABELS: Record<AdaptiveDecisionDimension, Record<string, string>> = {
  attentionDemand: {
    easy: 'Keep it easygoing',
    engaged: 'Stay more engaged',
    immersive: 'Go more immersive',
  },
  pace: {
    slow: 'Take it slower',
    medium: 'Keep it steady',
    fast: 'Move faster',
  },
  emotionalWeight: {
    light: 'Keep it lighter',
    moderate: 'Keep some emotional room',
    heavy: 'Go heavier',
  },
  runtime: {
    short: 'Keep it shorter',
    medium: 'Keep it medium length',
    long: 'Settle in longer',
  },
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

interface CandidateAdaptiveSplit {
  dimension: AdaptiveDecisionDimension
  majorityValue: AdaptiveDecisionValue
  minorityValue: AdaptiveDecisionValue
  majorityMovies: [Movie, Movie]
  minorityMovie: Movie
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

function runtimeCategory(movie: Movie) {
  if (movie.runtimeMinutes < 100) return 'short'
  if (movie.runtimeMinutes <= 130) return 'medium'
  return 'long'
}

function getAdaptiveValue(movie: Movie, dimension: AdaptiveDecisionDimension): AdaptiveDecisionValue {
  if (dimension === 'attentionDemand') return movie.attentionDemand
  if (dimension === 'pace') return movie.pace
  if (dimension === 'emotionalWeight') return movie.emotionalWeight
  return runtimeCategory(movie)
}

function getCleanAdaptiveSplit(
  movies: [Movie, Movie, Movie],
  dimension: AdaptiveDecisionDimension,
): CandidateAdaptiveSplit | null {
  const groups = new Map<AdaptiveDecisionValue, Movie[]>()

  for (const movie of movies) {
    const value = getAdaptiveValue(movie, dimension)
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
    minorityValue: minorityEntry[0],
    majorityMovies: [majorityEntry[1][0], majorityEntry[1][1]],
    minorityMovie: minorityEntry[1][0],
  }
}

function dealbreakerResolvesSplit(split: CandidateAdaptiveSplit, context: DecisionContext) {
  const dealbreakers = context.discoveryPreferences?.dealbreakers

  if (!dealbreakers) {
    return false
  }

  if (
    split.dimension === 'pace'
    && dealbreakers.avoidSlow
    && (split.majorityValue === 'slow' || split.minorityValue === 'slow')
  ) {
    return true
  }

  if (
    split.dimension === 'emotionalWeight'
    && dealbreakers.avoidHeavy
    && (split.majorityValue === 'heavy' || split.minorityValue === 'heavy')
  ) {
    return true
  }

  if (split.dimension === 'runtime' && dealbreakers.underTwoHours) {
    const majorityIsUnderTwoHours = split.majorityMovies.every((movie) => movie.runtimeMinutes < 120)
    const minorityIsUnderTwoHours = split.minorityMovie.runtimeMinutes < 120
    return majorityIsUnderTwoHours !== minorityIsUnderTwoHours
  }

  return false
}

function contextMakesAdaptiveSplitRedundant(split: CandidateAdaptiveSplit, context: DecisionContext) {
  const filters = context.filters
  const preferences = context.discoveryPreferences

  if (split.dimension === 'attentionDemand') {
    return Boolean(preferences?.attentionDemand)
  }

  if (split.dimension === 'pace') {
    return Boolean(filters?.pace) || dealbreakerResolvesSplit(split, context)
  }

  if (split.dimension === 'emotionalWeight') {
    return Boolean(filters?.emotionalWeight) || dealbreakerResolvesSplit(split, context)
  }

  return Boolean(filters?.runtime) || dealbreakerResolvesSplit(split, context)
}

function createAdaptiveOption(
  id: string,
  dimension: AdaptiveDecisionDimension,
  value: AdaptiveDecisionValue,
  keepMovies: [Movie, Movie],
  eliminatedMovie: Movie,
): AdaptiveDecisionOption {
  const baseLabel = ADAPTIVE_OPTION_LABELS[dimension][value]

  return {
    id,
    label: `${baseLabel}: ${keepMovies[0].title} + ${keepMovies[1].title}`,
    keepMovieIds: [keepMovies[0].id, keepMovies[1].id],
    eliminatedMovieId: eliminatedMovie.id,
  }
}

function createAdaptiveQuestion(split: CandidateAdaptiveSplit): AdaptiveDecisionQuestion {
  const [firstMajorityMovie, secondMajorityMovie] = split.majorityMovies

  return {
    dimension: split.dimension,
    prompt: ADAPTIVE_PROMPTS[split.dimension],
    options: [
      createAdaptiveOption(
        'majority',
        split.dimension,
        split.majorityValue,
        split.majorityMovies,
        split.minorityMovie,
      ),
      createAdaptiveOption(
        'outlier',
        split.dimension,
        split.minorityValue,
        [split.minorityMovie, firstMajorityMovie],
        secondMajorityMovie,
      ),
    ],
  }
}

export function getAdaptiveDecisionQuestion(
  movies: Movie[],
  context: DecisionContext,
): AdaptiveDecisionQuestion | null {
  if (movies.length !== 3) {
    return null
  }

  const slate: [Movie, Movie, Movie] = [movies[0], movies[1], movies[2]]
  const usefulSplits = ADAPTIVE_DIMENSION_PRIORITY
    .map((dimension) => getCleanAdaptiveSplit(slate, dimension))
    .filter((split): split is CandidateAdaptiveSplit => split !== null)
    .filter((split) => !contextMakesAdaptiveSplitRedundant(split, context))

  if (usefulSplits.length === 0) {
    return null
  }

  return createAdaptiveQuestion(usefulSplits[0])
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
