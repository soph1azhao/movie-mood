import { useState } from 'react'
import type { Movie } from '../types/movie'
import { getTmdbPosterUrl } from '../utils/tmdbImages'

interface MoviePosterProps {
  movie: Movie
  className?: string
  isDecorative?: boolean
}

function PosterFallback({ movie }: { movie: Movie }) {
  const titleParts = movie.title.split(' ')
  const breakAt = Math.ceil(titleParts.length / 2)

  return (
    <>
      <span className="poster-year">{movie.year}</span>
      <span className="poster-symbol" aria-hidden="true">◒</span>
      <strong>
        {titleParts.slice(0, breakAt).join(' ')}
        {titleParts.length > 1 && <br />}
        {titleParts.slice(breakAt).join(' ')}
      </strong>
      <span className="poster-line" aria-hidden="true" />
    </>
  )
}

export function MoviePoster({ movie, className = 'poster', isDecorative = false }: MoviePosterProps) {
  const [didPosterFail, setDidPosterFail] = useState(false)
  const posterUrl = getTmdbPosterUrl(movie.posterPath)
  const shouldShowImage = posterUrl && !didPosterFail

  return (
    <div
      className={`${className} ${shouldShowImage ? 'has-real-poster' : ''}`}
      style={{ '--poster-start': movie.palette[0], '--poster-end': movie.palette[1] } as React.CSSProperties}
      aria-label={isDecorative ? undefined : `Poster for ${movie.title}`}
      aria-hidden={isDecorative ? 'true' : undefined}
      role={isDecorative ? undefined : 'img'}
    >
      {shouldShowImage ? (
        <img
          src={posterUrl}
          alt=""
          className="poster-image"
          loading="lazy"
          onError={() => setDidPosterFail(true)}
        />
      ) : (
        <PosterFallback movie={movie} />
      )}
    </div>
  )
}
