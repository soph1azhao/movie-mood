import type { Movie } from '../types/movie'
import { MovieCard } from './MovieCard'

export function MovieGrid({ movies }: { movies: Movie[] }) {
  return (
    <div className="movie-grid">
      {movies.map((movie, index) => <MovieCard key={movie.id} movie={movie} index={index} />)}
    </div>
  )
}
