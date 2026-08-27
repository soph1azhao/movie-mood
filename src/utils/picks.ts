export const PICKS_PER_ROUND = 3

export function getPicks<T>(recommendationPool: T[], offset: number, picksPerRound = PICKS_PER_ROUND) {
  if (recommendationPool.length === 0) {
    return []
  }

  if (recommendationPool.length <= picksPerRound) {
    return recommendationPool
  }

  return Array.from({ length: picksPerRound }, (_, index) => (
    recommendationPool[(offset + index) % recommendationPool.length]
  ))
}

export function getNextPickOffset(poolSize: number, currentOffset: number, picksPerRound = PICKS_PER_ROUND) {
  if (poolSize <= picksPerRound) {
    return 0
  }

  return (currentOffset + picksPerRound) % poolSize
}
