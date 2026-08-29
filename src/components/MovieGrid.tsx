import type { Movie } from '../types/movie'
import { MovieCard } from './MovieCard'

interface MovieGridProps {
  movies: Movie[]
  variant?: 'glimpse' | 'full'
  isFavorite: (movieId: string) => boolean
  onToggleFavorite: (movieId: string) => void
  onFindSimilar?: (movieId: string) => void
  onChooseMovie?: (movieId: string) => void
}

export function MovieGrid({ movies, variant = 'full', isFavorite, onToggleFavorite, onFindSimilar, onChooseMovie }: MovieGridProps) {
  return (
    <div className="movie-grid">
      {movies.map((movie, index) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          index={index}
          variant={variant}
          isFavorite={isFavorite(movie.id)}
          onToggleFavorite={onToggleFavorite}
          onFindSimilar={onFindSimilar}
          onChooseMovie={onChooseMovie}
        />
      ))}
    </div>
  )
}
