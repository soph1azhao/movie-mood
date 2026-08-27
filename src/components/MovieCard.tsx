import { useState } from 'react'
import type { Movie } from '../types/movie'
import { MovieDetails } from './MovieDetails'
import { MoviePoster } from './MoviePoster'

interface MovieCardProps {
  movie: Movie
  index: number
  isFavorite: boolean
  onToggleFavorite: (movieId: string) => void
  onFindSimilar?: (movieId: string) => void
}

export function MovieCard({ movie, index, isFavorite, onToggleFavorite, onFindSimilar }: MovieCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const languageText = movie.languages.length > 2
    ? `${movie.languages.slice(0, 2).join(', ')} +${movie.languages.length - 2}`
    : movie.languages.join(', ')
  const paceLabel = `${movie.pace} pace`
  const emotionalWeightLabel = `${movie.emotionalWeight} weight`
  const detailsId = `movie-details-${movie.id}`

  return (
    <article className="movie-card" style={{ '--card-index': index } as React.CSSProperties}>
      <MoviePoster movie={movie} />
      <div className="movie-details">
        <div className="movie-heading">
          <div>
            <p className="eyebrow">Pick {String(index + 1).padStart(2, '0')}</p>
            <h3>{movie.title}</h3>
            <p className="metadata">{movie.year} · {movie.director}</p>
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
        <p className="genres">{movie.genres.join(' · ')}</p>
        <dl className="movie-facts" aria-label={`Viewing details for ${movie.title}`}>
          <div>
            <dt>Runtime</dt>
            <dd>{movie.runtimeMinutes} min</dd>
          </div>
          <div>
            <dt>Country</dt>
            <dd>{movie.countries.join(', ')}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{languageText}</dd>
          </div>
        </dl>
        <div className="tone-tags" aria-label={`Tone: ${paceLabel}, ${emotionalWeightLabel}`}>
          <span>{paceLabel}</span>
          <span>{emotionalWeightLabel}</span>
        </div>
        <p className="curiosity-hook">{movie.curiosityHook}</p>
        <p className="vibe-summary">{movie.vibeSummary}</p>
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
        </div>
        <div className={`expanded-details ${isDetailsOpen ? 'is-open' : ''}`} id={detailsId} hidden={!isDetailsOpen}>
          <MovieDetails movie={movie} />
        </div>
      </div>
    </article>
  )
}
