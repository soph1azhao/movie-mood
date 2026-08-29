import { useMemo, useState } from 'react'
import type { DecisionState, DuelState } from '../types/decision'
import type { DiscoveryPreferences, Mood, Movie, MovieFilters, ViewingSituation } from '../types/movie'
import {
  compareMoviesForDuel,
  getDecisionCompanionCue,
  getPrioritizedDecisionFactors,
  whyItFitsTonight,
} from '../utils/decision'
import { MoviePoster } from './MoviePoster'
import { WatchAction } from './WatchAction'

interface DecisionModeProps {
  movies: Movie[]
  mood: Mood
  situation: ViewingSituation | null
  filters: MovieFilters
  discoveryPreferences: DiscoveryPreferences
  state: DecisionState
  shareUrl: string
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

function getPairDifferences(
  first: Movie,
  second: Movie,
  mood: Mood,
  filters: MovieFilters,
  discoveryPreferences: DiscoveryPreferences,
) {
  return getPrioritizedDecisionFactors(first, second, { mood, filters, discoveryPreferences })
    .map((difference) => difference.summary)
    .filter((summary): summary is string => Boolean(summary))
}

interface DecisionMovieCardProps {
  movie: Movie
  eyebrow: string
  cue: string
  isSelected?: boolean
  onDrop?: () => void
  onChoose: () => void
}

function DecisionMovieCard({
  movie,
  eyebrow,
  cue,
  isSelected = false,
  onDrop,
  onChoose,
}: DecisionMovieCardProps) {
  return (
    <article className={`decision-card ${isSelected ? 'is-selected' : ''}`}>
      <MoviePoster movie={movie} className="decision-poster" isDecorative />
      <div className="decision-card-body">
        <p className="eyebrow">{eyebrow}</p>
        <h3>{movie.title}</h3>
        <p className="decision-meta">{movie.runtimeMinutes} min · {movie.genres.slice(0, 2).join(' · ')}</p>
        <p className="decision-cue">{cue}</p>
        <div className="decision-actions">
          {onDrop && (
            <button type="button" className="details-toggle" onClick={onDrop}>
              {isSelected ? 'Keep it in' : 'Not tonight'}
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
  shareUrl,
  onChange,
  onExit,
}: DecisionModeProps) {
  const [coinFlipWinnerId, setCoinFlipWinnerId] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState('')
  const allMoviesById = useMemo(() => new Map(movies.map((movie) => [movie.id, movie])), [movies])

  function chooseMovie(selectedId: string, source?: DuelState | [string, string, string]) {
    if (Array.isArray(source)) {
      onChange({ kind: 'pick', selectedId, sourceThreeSlateIds: source })
      return
    }

    onChange(source ? { kind: 'pick', selectedId, sourceDuel: source } : { kind: 'pick', selectedId })
  }

  function flipCoin(finalistIds: [string, string]) {
    setCoinFlipWinnerId(finalistIds[Math.floor(Math.random() * finalistIds.length)])
  }

  async function sharePick(movie: Movie) {
    const shareText = `Tonight's Pick: ${movie.title} on Movie Mood`

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareText,
          text: movie.vibeSummary,
          url: shareUrl,
        })
        setShareMessage('Share sheet opened.')
        return
      }

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = shareUrl
        textArea.setAttribute('readonly', '')
        textArea.style.position = 'fixed'
        textArea.style.top = '-999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setShareMessage('Link copied to clipboard.')
    } catch {
      setShareMessage('Could not share right now.')
    }
  }

  if (state.kind === 'three-slate') {
    const slateMovies = getMovieList(movies, state.movieIds)
    const droppedMovieId = state.manuallyDroppedMovieId ?? null

    if (slateMovies.length !== 3) {
      return null
    }

    const companionCue = getDecisionCompanionCue(slateMovies, {
      mood,
      filters,
      discoveryPreferences,
    })
    const companionMovie = companionCue ? getMovieById(movies, companionCue.outlierMovieId) : null
    const showCompanion = Boolean(
      companionCue
      && companionMovie
      && state.dismissedCompanionOutlierId !== companionCue.outlierMovieId
      && !droppedMovieId
    )
    const finalistIds = slateMovies
      .filter((movie) => movie.id !== droppedMovieId)
      .map((movie) => movie.id)
    const canStartDuel = finalistIds.length === 2

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
              cue={movie.vibeSummary}
              isSelected={droppedMovieId === movie.id}
              onDrop={() => {
                onChange({
                  ...state,
                  manuallyDroppedMovieId: droppedMovieId === movie.id ? undefined : movie.id,
                })
              }}
              onChoose={() => chooseMovie(movie.id, state.movieIds)}
            />
          ))}
        </div>
        {showCompanion && companionCue && companionMovie && (
          <div className="decision-companion-panel" aria-labelledby="decision-companion-heading">
            <div>
              <p className="eyebrow">Decision companion</p>
              <h4 id="decision-companion-heading">{companionMovie.title} stands a little apart.</h4>
              <p className="decision-companion-observation">{companionCue.observation}</p>
              <p className="decision-companion-vibe">{companionMovie.vibeSummary}</p>
            </div>
            <div className="decision-companion-actions">
              <button
                type="button"
                className="decision-companion-action"
                onClick={() => {
                  setCoinFlipWinnerId(null)
                  onChange({
                    kind: 'duel',
                    finalistIds: companionCue.majorityMovieIds,
                    sourceThreeSlateIds: state.movieIds,
                    reduction: {
                      kind: 'companion-drop',
                      droppedMovieId: companionCue.outlierMovieId,
                    },
                  })
                }}
              >
                Not tonight
              </button>
              <button
                type="button"
                className="decision-companion-action"
                onClick={() => {
                  onChange({
                    ...state,
                    dismissedCompanionOutlierId: companionCue.outlierMovieId,
                  })
                }}
              >
                Keep it in
              </button>
            </div>
          </div>
        )}
        <div className="duel-builder">
          <p>
            {droppedMovieId
              ? 'Good. The remaining two can settle it head-to-head.'
              : 'Drop the one that feels least like tonight, or choose a movie now.'}
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
                finalistIds: [finalistIds[0], finalistIds[1]],
                sourceThreeSlateIds: state.movieIds,
                reduction: droppedMovieId
                  ? { kind: 'manual-drop', droppedMovieId }
                  : undefined,
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
        <MoviePoster movie={selectedMovie} className="decision-poster" isDecorative />
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
          <div className="watch-action-section">
            <WatchAction movie={selectedMovie} />
          </div>
          <div className="decision-actions inline-actions">
            <button type="button" className="details-toggle decision-primary" onClick={() => sharePick(selectedMovie)}>
              Share pick
            </button>
            <button
              type="button"
              className="details-toggle"
              onClick={() => {
                setCoinFlipWinnerId(null)
                if (state.sourceDuel) {
                  onChange(state.sourceDuel)
                } else if (state.sourceThreeSlateIds) {
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
          <p className="share-feedback" aria-live="polite">{shareMessage}</p>
        </div>
      </div>
    </div>
  )
}
