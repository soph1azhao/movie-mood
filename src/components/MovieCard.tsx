import { useState } from 'react'
import type { Movie } from '../types/movie'
import { formatCompactFacts, formatGenreSummary, getExperientialCue, getFinishTimeLabel } from '../utils/moviePresentation'
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
  showFinishTime?: boolean
}

export function MovieCard({ movie, index, variant = 'full', isFavorite, onToggleFavorite, onFindSimilar, onChooseMovie, showFinishTime }: MovieCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const detailsId = `movie-details-${movie.id}`
  const experientialCue = getExperientialCue(movie)
  const compactFacts = showFinishTime
    ? `${formatCompactFacts(movie)} · ${getFinishTimeLabel(movie.runtimeMinutes)}`
    : formatCompactFacts(movie)

  if (variant === 'glimpse') {
    return (
      <article className="movie-card glimpse-card" style={{ '--card-index': index } as React.CSSProperties}>
        <MoviePoster movie={movie} bleedTitle={movie.title} bleedClassName="poster-bleed-title glimpse-bleed-title" />
        <div className="movie-details glimpse-details">
          <p className="eyebrow">Glimpse {String(index + 1).padStart(2, '0')}</p>
          <p className="curiosity-hook">{movie.curiosityHook}</p>
        </div>
      </article>
    )
  }

  return (
    <article className="movie-card reveal-card" style={{ '--card-index': index } as React.CSSProperties}>
      <p className="eyebrow reveal-index">Pick {String(index + 1).padStart(2, '0')}</p>
      <MoviePoster movie={movie} bleedTitle={movie.title} bleedClassName="poster-bleed-title reveal-bleed-title" />
      <div className="movie-details reveal-details">
        <p className="why-watch reveal-quote">{movie.whyWatch}</p>
        <div className="card-actions reveal-actions">
          {onChooseMovie && (
            <button
              type="button"
              className="details-toggle decision-primary reveal-primary"
              onClick={() => onChooseMovie(movie.id)}
            >
              That’s the one
            </button>
          )}
          <div className="reveal-secondary-actions">
            {onFindSimilar && (
              <button
                type="button"
                className="details-toggle action-quiet"
                onClick={() => onFindSimilar(movie.id)}
              >
                More like this
              </button>
            )}
            <button
              type="button"
              className="details-toggle action-quiet"
              aria-expanded={isDetailsOpen}
              aria-controls={detailsId}
              onClick={() => setIsDetailsOpen((current) => !current)}
            >
              {isDetailsOpen ? 'Hide details' : 'More details'}
            </button>
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
        <div className="reveal-whisper-cluster">
          <p className="metadata">{compactFacts}</p>
          <p className="genres">{formatGenreSummary(movie)}</p>
        </div>
        {experientialCue && (
          <p className="experience-cue">{experientialCue}</p>
        )}
        <div className={`expanded-details ${isDetailsOpen ? 'is-open' : ''}`} id={detailsId} hidden={!isDetailsOpen}>
          <MovieDetails movie={movie} />
        </div>
      </div>
    </article>
  )
}
