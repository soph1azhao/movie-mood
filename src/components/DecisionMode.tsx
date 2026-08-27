import { useMemo, useState } from 'react'
import type { DecisionState, DuelState } from '../types/decision'
import type { DiscoveryPreferences, Mood, Movie, MovieFilters, ViewingSituation } from '../types/movie'
import {
  compareMoviesForDuel,
  getPrioritizedDecisionFactors,
  updateDuelFinalistSelection,
  whyItFitsTonight,
} from '../utils/decision'

interface DecisionModeProps {
  movies: Movie[]
  mood: Mood
  situation: ViewingSituation | null
  filters: MovieFilters
  discoveryPreferences: DiscoveryPreferences
  state: DecisionState
  onChange: (state: DecisionState) => void
  onExit: () => void
}

const fallbackReasons = [
  'It is already in tonight’s shortlist.',
  'It gives you a clear path out of browsing.',
]

function getMovieById(movies: Movie[], movieId: string) {
  return movies.find((movie) => movie.id === movieId) ?? null
}

function getMovieList(movies: Movie[], movieIds: string[]) {
  return movieIds
    .map((movieId) => getMovieById(movies, movieId))
    .filter((movie): movie is Movie => movie !== null)
}

function formatDifference(first: Movie, second: Movie, category: string, firstValue: string, secondValue: string) {
  if (!firstValue && !secondValue) {
    return `${first.title} and ${second.title} differ most in ${category}.`
  }

  return `${first.title}: ${firstValue || 'less of this'} · ${second.title}: ${secondValue || 'less of this'}`
}

function getPairDifferences(
  first: Movie,
  second: Movie,
  mood: Mood,
  filters: MovieFilters,
  discoveryPreferences: DiscoveryPreferences,
) {
  return getPrioritizedDecisionFactors(first, second, { mood, filters, discoveryPreferences })
    .map((difference) => (
      difference.summary
        ?? formatDifference(first, second, difference.category, difference.firstValue, difference.secondValue)
    ))
}

function getSlateCue(
  movie: Movie,
  others: Movie[],
  mood: Mood,
  filters: MovieFilters,
  discoveryPreferences: DiscoveryPreferences,
) {
  const comparison = others
    .flatMap((other) => compareMoviesForDuel(movie, other, { mood, filters, discoveryPreferences }).differences)
    .find((difference) => difference.firstValue)

  if (comparison) {
    return comparison.summary ?? `${comparison.category}: ${comparison.firstValue}`
  }

  return movie.vibeSummary
}

function DecisionPoster({ movie }: { movie: Movie }) {
  const titleParts = movie.title.split(' ')
  const breakAt = Math.ceil(titleParts.length / 2)

  return (
    <div
      className="decision-poster"
      style={{ '--poster-start': movie.palette[0], '--poster-end': movie.palette[1] } as React.CSSProperties}
      aria-hidden="true"
    >
      <span>{movie.year}</span>
      <strong>
        {titleParts.slice(0, breakAt).join(' ')}
        {titleParts.length > 1 && <br />}
        {titleParts.slice(breakAt).join(' ')}
      </strong>
    </div>
  )
}

interface DecisionMovieCardProps {
  movie: Movie
  eyebrow: string
  cue: string
  isSelected?: boolean
  onToggleDuel?: () => void
  canAddToDuel?: boolean
  onChoose: () => void
}

function DecisionMovieCard({
  movie,
  eyebrow,
  cue,
  isSelected = false,
  onToggleDuel,
  canAddToDuel = true,
  onChoose,
}: DecisionMovieCardProps) {
  const isBlocked = Boolean(onToggleDuel) && !isSelected && !canAddToDuel

  return (
    <article className={`decision-card ${isSelected ? 'is-selected' : ''}`}>
      <DecisionPoster movie={movie} />
      <div className="decision-card-body">
        <p className="eyebrow">{eyebrow}</p>
        <h3>{movie.title}</h3>
        <p className="decision-meta">{movie.runtimeMinutes} min · {movie.genres.slice(0, 2).join(' · ')}</p>
        <p className="decision-cue">{cue}</p>
        <div className="decision-actions">
          {onToggleDuel && (
            <button type="button" className="details-toggle" disabled={isBlocked} onClick={onToggleDuel}>
              {isSelected ? 'Remove from duel' : isBlocked ? 'Remove one finalist first' : 'Put in final duel'}
            </button>
          )}
          <button type="button" className="details-toggle decision-primary" onClick={onChoose}>
            Choose this tonight
          </button>
        </div>
      </div>
    </article>
  )
}

export function DecisionMode({
  movies,
  mood,
  situation,
  filters,
  discoveryPreferences,
  state,
  onChange,
  onExit,
}: DecisionModeProps) {
  const [selectedDuelIds, setSelectedDuelIds] = useState<string[]>([])
  const [coinFlipWinnerId, setCoinFlipWinnerId] = useState<string | null>(null)
  const allMoviesById = useMemo(() => new Map(movies.map((movie) => [movie.id, movie])), [movies])

  function chooseMovie(selectedId: string, source?: DuelState | [string, string, string]) {
    if (Array.isArray(source)) {
      onChange({ kind: 'pick', selectedId, sourceThreeSlateIds: source })
      return
    }

    onChange(source ? { kind: 'pick', selectedId, sourceDuel: source } : { kind: 'pick', selectedId })
  }

  function toggleDuelMovie(movieId: string) {
    setSelectedDuelIds((currentIds) => updateDuelFinalistSelection(currentIds, movieId))
  }

  function flipCoin(finalistIds: [string, string]) {
    setCoinFlipWinnerId(finalistIds[Math.floor(Math.random() * finalistIds.length)])
  }

  if (state.kind === 'three-slate') {
    const slateMovies = getMovieList(movies, state.movieIds)

    if (slateMovies.length !== 3) {
      return null
    }

    const canStartDuel = selectedDuelIds.length === 2
    const canAddToDuel = selectedDuelIds.length < 2

    return (
      <div className="decision-mode" aria-labelledby="decision-heading">
        <div className="decision-toolbar">
          <div>
            <p className="eyebrow">Decision mode</p>
            <h3 id="decision-heading">Three good options. One calmer choice.</h3>
          </div>
          <button type="button" className="another-button" onClick={onExit}>Back to browsing</button>
        </div>
        <div className="decision-grid">
          {slateMovies.map((movie, index) => (
            <DecisionMovieCard
              key={movie.id}
              movie={movie}
              eyebrow={`Option ${index + 1}`}
              cue={getSlateCue(
                movie,
                slateMovies.filter((other) => other.id !== movie.id),
                mood,
                filters,
                discoveryPreferences,
              )}
              isSelected={selectedDuelIds.includes(movie.id)}
              canAddToDuel={canAddToDuel}
              onToggleDuel={() => toggleDuelMovie(movie.id)}
              onChoose={() => chooseMovie(movie.id, state.movieIds)}
            />
          ))}
        </div>
        <div className="duel-builder">
          <p>
            {selectedDuelIds.length < 2
              ? 'Pick two finalists for a head-to-head.'
              : 'Two finalists are ready. Remove one before adding a different movie.'}
          </p>
          <button
            type="button"
            className="another-button"
            disabled={!canStartDuel}
            onClick={() => {
              if (!canStartDuel) return
              setCoinFlipWinnerId(null)
              onChange({
                kind: 'duel',
                finalistIds: [selectedDuelIds[0], selectedDuelIds[1]],
                sourceThreeSlateIds: state.movieIds,
              })
            }}
          >
            Start the duel
          </button>
        </div>
      </div>
    )
  }

  if (state.kind === 'duel') {
    const finalistMovies = getMovieList(movies, state.finalistIds)

    if (finalistMovies.length !== 2) {
      return null
    }

    const [first, second] = finalistMovies
    const differences = getPairDifferences(first, second, mood, filters, discoveryPreferences)
    const otherFinalistId = coinFlipWinnerId
      ? state.finalistIds.find((movieId) => movieId !== coinFlipWinnerId) ?? null
      : null
    const otherFinalist = otherFinalistId ? allMoviesById.get(otherFinalistId) : null

    return (
      <div className="decision-mode duel-mode" aria-labelledby="duel-heading">
        <div className="decision-toolbar">
          <div>
            <p className="eyebrow">Final duel</p>
            <h3 id="duel-heading">Which one feels more like tonight?</h3>
          </div>
          {state.sourceThreeSlateIds && (
            <button
              type="button"
              className="another-button"
              onClick={() => {
                setCoinFlipWinnerId(null)
                setSelectedDuelIds(state.finalistIds)
                onChange({ kind: 'three-slate', movieIds: state.sourceThreeSlateIds! })
              }}
            >
              Back to all three
            </button>
          )}
        </div>
        <div className="duel-grid">
          {finalistMovies.map((movie, index) => (
            <DecisionMovieCard
              key={movie.id}
              movie={movie}
              eyebrow={`Finalist ${index + 1}`}
              cue={differences[index] ?? movie.vibeSummary}
              onChoose={() => chooseMovie(movie.id, state)}
            />
          ))}
        </div>
        {differences.length > 0 && (
          <ul className="duel-differences" aria-label="Deciding differences">
            {differences.map((difference) => <li key={difference}>{difference}</li>)}
          </ul>
        )}
        <div className="coin-panel">
          <button type="button" className="coin-button" onClick={() => flipCoin(state.finalistIds)}>
            Flip a coin
          </button>
          {coinFlipWinnerId && allMoviesById.get(coinFlipWinnerId) && (
            <div className="coin-result">
              <div className="coin-mark" aria-hidden="true">◐</div>
              <div>
                <p className="eyebrow">Gut check</p>
                <h4>{allMoviesById.get(coinFlipWinnerId)!.title}</h4>
                <p>How does that feel?</p>
                <div className="decision-actions inline-actions">
                  <button type="button" className="details-toggle decision-primary" onClick={() => chooseMovie(coinFlipWinnerId, state)}>
                    Go with the coin
                  </button>
                  {otherFinalist && (
                    <button type="button" className="details-toggle" onClick={() => chooseMovie(otherFinalist.id, state)}>
                      Choose {otherFinalist.title}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const selectedMovie = allMoviesById.get(state.selectedId)

  if (!selectedMovie) {
    return null
  }

  const reasons = whyItFitsTonight(selectedMovie, {
    mood,
    situation,
    attentionDemand: discoveryPreferences.attentionDemand,
    discoveryStyle: discoveryPreferences.discoveryStyle,
    pace: filters.pace,
    emotionalWeight: filters.emotionalWeight,
  })
  const displayedReasons = reasons.length > 0 ? reasons.slice(0, 3) : fallbackReasons

  return (
    <div className="decision-mode ticket-mode" aria-labelledby="ticket-heading">
      <div className="tonight-ticket">
        <DecisionPoster movie={selectedMovie} />
        <div className="ticket-copy">
          <p className="eyebrow">Tonight’s Pick</p>
          <h3 id="ticket-heading">{selectedMovie.title}</h3>
          <p className="decision-meta">{selectedMovie.year} · {selectedMovie.director} · {selectedMovie.runtimeMinutes} min</p>
          <p className="ticket-summary">{selectedMovie.vibeSummary}</p>
          <div className="why-watch">
            <p className="why-label">Why it fits tonight</p>
            <ul className="ticket-reasons">
              {displayedReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
          <div className="decision-actions inline-actions">
            <button
              type="button"
              className="details-toggle"
              onClick={() => {
                setCoinFlipWinnerId(null)
                if (state.sourceDuel) {
                  setSelectedDuelIds(state.sourceDuel.finalistIds)
                  onChange(state.sourceDuel)
                } else if (state.sourceThreeSlateIds) {
                  setSelectedDuelIds([])
                  onChange({ kind: 'three-slate', movieIds: state.sourceThreeSlateIds })
                } else {
                  onExit()
                }
              }}
            >
              Change my mind
            </button>
            <button type="button" className="details-toggle decision-primary" onClick={onExit}>
              Back to browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
