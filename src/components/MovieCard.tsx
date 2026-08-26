import type { Movie } from '../types/movie'

interface MovieCardProps {
  movie: Movie
  index: number
}

export function MovieCard({ movie, index }: MovieCardProps) {
  const titleParts = movie.title.split(' ')
  const breakAt = Math.ceil(titleParts.length / 2)
  const languageText = movie.languages.length > 2
    ? `${movie.languages.slice(0, 2).join(', ')} +${movie.languages.length - 2}`
    : movie.languages.join(', ')
  const paceLabel = `${movie.pace} pace`
  const emotionalWeightLabel = `${movie.emotionalWeight} weight`
  const posterTitle = (
    <>
      {titleParts.slice(0, breakAt).join(' ')}
      {titleParts.length > 1 && <br />}
      {titleParts.slice(breakAt).join(' ')}
    </>
  )

  return (
    <article className="movie-card" style={{ '--card-index': index } as React.CSSProperties}>
      <div
        className="poster"
        style={{ '--poster-start': movie.palette[0], '--poster-end': movie.palette[1] } as React.CSSProperties}
        aria-label={`Illustrated title poster for ${movie.title}`}
        role="img"
      >
        <span className="poster-year">{movie.year}</span>
        <span className="poster-symbol" aria-hidden="true">◒</span>
        <strong>{posterTitle}</strong>
        <span className="poster-line" aria-hidden="true" />
      </div>
      <div className="movie-details">
        <div className="movie-heading">
          <p className="eyebrow">Pick {String(index + 1).padStart(2, '0')}</p>
          <h3>{movie.title}</h3>
          <p className="metadata">{movie.year} · {movie.director}</p>
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
      </div>
    </article>
  )
}
