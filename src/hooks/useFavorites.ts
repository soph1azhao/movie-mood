import { useEffect, useState } from 'react'

const FAVORITES_STORAGE_KEY = 'movieMoodFavorites'

function readStoredFavorites() {
  try {
    const storedFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!storedFavorites) {
      return []
    }

    const parsedFavorites: unknown = JSON.parse(storedFavorites)
    if (!Array.isArray(parsedFavorites)) {
      return []
    }

    const favoriteIds = parsedFavorites.filter((favoriteId): favoriteId is string => (
      typeof favoriteId === 'string' && favoriteId.length > 0
    ))

    return [...new Set(favoriteIds)]
  } catch {
    return []
  }
}

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(readStoredFavorites)

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds))
    } catch {
      // Favorites are a convenience feature, so storage failures should not break the app.
    }
  }, [favoriteIds])

  function toggleFavorite(movieId: string) {
    setFavoriteIds((currentFavoriteIds) => (
      currentFavoriteIds.includes(movieId)
        ? currentFavoriteIds.filter((favoriteId) => favoriteId !== movieId)
        : [...currentFavoriteIds, movieId]
    ))
  }

  function isFavorite(movieId: string) {
    return favoriteIds.includes(movieId)
  }

  return {
    favoriteIds,
    toggleFavorite,
    isFavorite,
  }
}
