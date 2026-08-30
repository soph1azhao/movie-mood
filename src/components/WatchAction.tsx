import type { Movie } from '../types/movie'
import {
  WATCH_LINKS_LABEL,
  buildJustWatchSearchUrl,
  buildLetterboxdSearchUrl,
  buildTmdbWebUrl,
  buildWhereToWatchSearchUrl,
} from '../utils/watchLinks'

interface WatchActionProps {
  movie: Movie
  label?: string
}

// Tonight's Action: a centralized outbound lookup section so a user who
// reaches Tonight's Pick can find where to watch without Movie Mood claiming
// verified provider availability. All links open as external, noopener.
export function WatchAction({ movie, label = WATCH_LINKS_LABEL }: WatchActionProps) {
  const primarySearchUrl = buildWhereToWatchSearchUrl(movie.title, movie.year)
  const secondaryLinks = [
    { title: 'On JustWatch', href: buildJustWatchSearchUrl(movie.title) },
    { title: 'On Letterboxd', href: buildLetterboxdSearchUrl(movie.title) },
    { title: 'On TMDB', href: buildTmdbWebUrl(movie.tmdbId) },
  ].filter((link): link is { title: string; href: string } => Boolean(link.href))

  return (
    <div className="watch-action">
      <p className="eyebrow">{label}</p>
      {primarySearchUrl && (
        <div className="watch-primary-action">
          <a
            href={primarySearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="details-toggle watch-link watch-link-primary"
          >
            Find where to watch
          </a>
        </div>
      )}
      {secondaryLinks.length > 0 && (
        <ul className="watch-action-list watch-secondary-list" role="menu">
          {secondaryLinks.map((link) => (
            <li key={link.title} role="none">
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="details-toggle watch-link watch-link-secondary"
                role="menuitem"
              >
                {link.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="watch-note">Movie Mood does not verify streaming availability.</p>
    </div>
  )
}
