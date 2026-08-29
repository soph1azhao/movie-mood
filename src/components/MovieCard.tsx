import { useState } from 'react'
import type { Movie } from '../types/movie'
import { formatCompactFacts, formatGenreSummary, getExperientialCue } from '../utils/moviePresentation'
import { MovieDetails } from './MovieDetails'
import { MoviePoster } from './MoviePoster'

interface MovieCardProps {
  movie: Movie
  index: number
  variant?: 'glimpse' | 'full'
  isFavorite: boolean
  onToggleFavorite: (movieId: string) => void
  onFindSimilar?: (movieId: string) => void
  onChooseMovie?: (movieId: string) => void
}

export function MovieCard({ movie, index, variant = 'full', isFavorite, onToggleFavorite, onFindSimilar, onChooseMovie }: MovieCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const detailsId = `movie-details-${movie.id}`
  const experientialCue = getExperientialCue(movie)

  if (variant === 'glimpse') {
    return (
      <article className="movie-card glimpse-card" style={{ '--card-index': index } as React.CSSProperties}>
        <MoviePoster movie={movie} />
        <div className="movie-details glimpse-details">
          <p className="eyebrow">Glimpse {String(index + 1).padStart(2, '0')}</p>
          <h3>{movie.title}</h3>
          <p className="curiosity-hook">{movie.curiosityHook}</p>
        </div>
      </article>
    )
  }

  return (
    <article className="movie-card" style={{ '--card-index': index } as React.CSSProperties}>
      <MoviePoster movie={movie} />
      <div className="movie-details">
        <div className="movie-heading">
          <div>
            <p className="eyebrow">Pick {String(index + 1).padStart(2, '0')}</p>
            <h3>{movie.title}</h3>
            <p className="metadata">{formatCompactFacts(movie)}</p>
          </div>
          <button
            type="button"
            className={`favorite-button ${isFavorite ? 'is-favorite' : ''}`}
            aria-label={isFavorite ? `Remove ${movie.title} from favorites` : `Save ${movie.title} to favorites`}
            aria-pressed={isFavorite}
            onClick={() => onToggleFavorite(movie.id)}
          >
            <span aria-hidden="true">{isFavorite ? '♥' : '♡'}</span>
          </button>
        </div>
        <p className="genres">{formatGenreSummary(movie)}</p>
        {experientialCue && (
          <p className="experience-cue">{experientialCue}</p>
        )}
        <div className="why-watch">
          <p className="why-label">Why it fits tonight</p>
          <p>{movie.whyWatch}</p>
        </div>
        <div className="card-actions">
          {onFindSimilar && (
            <button
              type="button"
              className="details-toggle"
              onClick={() => onFindSimilar(movie.id)}
            >
              More like this
            </button>
          )}
          <button
            type="button"
            className="details-toggle"
            aria-expanded={isDetailsOpen}
            aria-controls={detailsId}
            onClick={() => setIsDetailsOpen((current) => !current)}
          >
            {isDetailsOpen ? 'Hide details' : 'More details'}
          </button>
          {onChooseMovie && (
            <button
              type="button"
              className="details-toggle decision-primary"
              onClick={() => onChooseMovie(movie.id)}
            >
              That’s the one
            </button>
          )}
        </div>
        <div className={`expanded-details ${isDetailsOpen ? 'is-open' : ''}`} id={detailsId} hidden={!isDetailsOpen}>
          <MovieDetails movie={movie} />
        </div>
      </div>
    </article>
  )
}
