import { useState } from 'react'
import type { Movie } from '../types/movie'
import { getTmdbPosterUrl, posterAspectRatio } from '../utils/tmdbImages'

// Re-exported so the aspect-ratio helper is discoverable alongside the poster
// component that consumes it.
export { posterAspectRatio }

interface MoviePosterProps {
  movie: Movie
  className?: string
  isDecorative?: boolean
  bleedTitle?: string
  bleedClassName?: string
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

export function MoviePoster({
  movie,
  className = 'poster',
  isDecorative = false,
  bleedTitle,
  bleedClassName = 'poster-bleed-title',
}: MoviePosterProps) {
  const [didPosterFail, setDidPosterFail] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const posterUrl = getTmdbPosterUrl(movie.posterPath)
  const shouldShowImage = Boolean(posterUrl) && !didPosterFail

  // Alt text: real posters are decorative within their card, so they stay empty;
  // the fallback exposes the title so screen readers still announce purpose.
  const imgAlt = isDecorative ? '' : `Poster for ${movie.title}`
  const fallbackAria = isDecorative ? undefined : { 'aria-label': `Poster for ${movie.title}` }

  const poster = (
    <div
      className={`${className} ${bleedTitle ? 'poster-bleed-poster' : ''} ${shouldShowImage ? 'has-real-poster' : ''} ${isLoading && shouldShowImage ? 'is-loading' : ''}`}
      style={{
        '--poster-start': movie.palette[0],
        '--poster-end': movie.palette[1],
        aspectRatio: posterAspectRatio(),
      } as React.CSSProperties}
      {...(isDecorative ? { 'aria-hidden': 'true' } : fallbackAria)}
    >
      {shouldShowImage ? (
        <img
          src={posterUrl!}
          alt={imgAlt}
          className="poster-image"
          loading="lazy"
          onLoad={() => setIsLoading(false)}
          onError={(event) => {
            setIsLoading(false)
            setDidPosterFail(true)
          }}
        />
      ) : (
        <PosterFallback movie={movie} />
      )}
    </div>
  )

  if (!bleedTitle) {
    return poster
  }

  return (
    <div className="poster-bleed-object">
      {poster}
      <h3 className={bleedClassName}>{bleedTitle}</h3>
    </div>
  )
}
