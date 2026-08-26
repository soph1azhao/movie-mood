import type { Movie } from '../types/movie'
import { MovieCard } from './MovieCard'

interface MovieGridProps {
  movies: Movie[]
  isFavorite: (movieId: string) => boolean
  onToggleFavorite: (movieId: string) => void
}

export function MovieGrid({ movies, isFavorite, onToggleFavorite }: MovieGridProps) {
  return (
    <div className="movie-grid">
      {movies.map((movie, index) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          index={index}
          isFavorite={isFavorite(movie.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  )
}
