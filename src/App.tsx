import { useEffect, useMemo, useRef, useState } from 'react'
import { CategorySelector, moods } from './components/CategorySelector'
import { DecisionMode } from './components/DecisionMode'
import { DiscoveryPreferencesPanel } from './components/DiscoveryPreferencesPanel'
import { FilterPanel } from './components/FilterPanel'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { MovieGrid } from './components/MovieGrid'
import { SituationSelector } from './components/SituationSelector'
import { movies } from './data/movies'
import { useFavorites } from './hooks/useFavorites'
import { emptyDiscoveryPreferences, getDiscoveryPool, getSimilarMovies } from './utils/discovery'
import { emptyFilters, filterMovies } from './utils/filterMovies'
import { getNextPickOffset, getPicks, PICKS_PER_ROUND } from './utils/picks'
import { decodeDecisionState, encodeDecisionState } from './utils/urlCodec'
import type { DecisionState } from './types/decision'
import type { DiscoveryPreferences, Mood, MovieFilters, ViewingSituation } from './types/movie'

const restoredDecisionModeState = typeof window === 'undefined'
  ? null
  : decodeDecisionState(window.location.href)

function getCleanPageUrl() {
  const url = new URL(window.location.href)
  url.search = ''
  return url.toString()
}

function App() {
  const [selectedMood, setSelectedMood] = useState<Mood | null>((restoredDecisionModeState?.mood ?? null) as Mood | null)
  const [selectedSituation, setSelectedSituation] = useState<ViewingSituation | null>(
    (restoredDecisionModeState?.situation ?? null) as ViewingSituation | null,
  )
  const [filters, setFilters] = useState<MovieFilters>(restoredDecisionModeState?.filters ?? emptyFilters)
  const [discoveryPreferences, setDiscoveryPreferences] = useState<DiscoveryPreferences>(
    restoredDecisionModeState?.discoveryPreferences ?? emptyDiscoveryPreferences,
  )
  const [similarToMovieId, setSimilarToMovieId] = useState<string | null>(null)
  const [decisionState, setDecisionState] = useState<DecisionState | null>(restoredDecisionModeState?.decisionState ?? null)
  const [round, setRound] = useState(0)
  const [previousPickOffset, setPreviousPickOffset] = useState<number | null>(null)
  const [recommendationReveal, setRecommendationReveal] = useState<'glimpse' | 'full'>('glimpse')
  const [view, setView] = useState<'recommendations' | 'favorites'>('recommendations')
  const resultsRef = useRef<HTMLElement>(null)
  const refinementRef = useRef<HTMLDivElement>(null)
  const { favoriteIds, toggleFavorite, isFavorite } = useFavorites()

  const genreOptions = useMemo(
    () => [...new Set(movies.flatMap((movie) => movie.genres))].sort(),
    [],
  )
  const languageOptions = useMemo(
    () => [...new Set(movies.flatMap((movie) => movie.languages))].sort(),
    [],
  )
  const filterResult = useMemo(
    () => filterMovies(movies, selectedMood, selectedSituation, filters),
    [selectedMood, selectedSituation, filters],
  )
  const discoveryPool = useMemo(
    () => getDiscoveryPool(filterResult, discoveryPreferences),
    [filterResult, discoveryPreferences],
  )

  const picks = useMemo(
    () => getPicks(discoveryPool, round),
    [discoveryPool, round],
  )
  const favoriteMovies = useMemo(
    () => movies.filter((movie) => favoriteIds.includes(movie.id)),
    [favoriteIds],
  )
  const similarSeedMovie = useMemo(
    () => movies.find((movie) => movie.id === similarToMovieId) ?? null,
    [similarToMovieId],
  )
  const similarMovies = useMemo(
    () => (similarToMovieId ? getSimilarMovies(movies, similarToMovieId) : []),
    [similarToMovieId],
  )

  const activeMood = moods.find((mood) => mood.id === selectedMood)
  const isViewingFavorites = view === 'favorites'
  const isViewingSimilarMovies = !isViewingFavorites && similarSeedMovie !== null
  const isFullReveal = recommendationReveal === 'full'
  const hasMorePicks = discoveryPool.length > PICKS_PER_ROUND
  const canUseDecisionMode = !decisionState && !isViewingFavorites && !isViewingSimilarMovies && picks.length === PICKS_PER_ROUND
  const resultCount = isViewingFavorites
    ? favoriteMovies.length
    : isViewingSimilarMovies
      ? similarMovies.length
      : discoveryPool.length
  const resultCountLabel = `${resultCount} ${resultCount === 1 ? 'movie' : 'movies'}`
  const activeDealbreakerCount = Object.values(discoveryPreferences.dealbreakers).filter(Boolean).length
  const dealbreakersAreActive = activeDealbreakerCount > 0
  const limitedByDealbreakers = dealbreakersAreActive && filterResult.recommendationPool.length > discoveryPool.length
  const resultMessage = (() => {
    if (limitedByDealbreakers && discoveryPool.length > 0 && discoveryPool.length < PICKS_PER_ROUND) {
      return `Only ${discoveryPool.length} ${discoveryPool.length === 1 ? 'movie fits' : 'movies fit'} these boundaries tonight. Try removing a “Not tonight” choice to see more.`
    }

    if (filterResult.usedSituationFallback) {
      return `Only ${filterResult.exactMatches.length} matched everything, so we added ${filterResult.fallbackMatches.length} more that fit your mood and filters.`
    }

    return null
  })()
  const shareUrl = useMemo(() => {
    if (!selectedMood || !decisionState) return ''

    return `${window.location.origin}${window.location.pathname}?${encodeDecisionState({
      schemaVersion: 'v6',
      mood: selectedMood,
      situation: selectedSituation,
      filters,
      discoveryPreferences,
      decisionState,
    })}`
  }, [decisionState, discoveryPreferences, filters, selectedMood, selectedSituation])

  useEffect(() => {
    if (!selectedMood || !decisionState) {
      if (window.location.search.includes('mode=decision')) {
        window.history.replaceState(null, '', getCleanPageUrl())
      }
      return
    }

    window.history.replaceState(null, '', shareUrl)
  }, [decisionState, selectedMood, shareUrl])

  function chooseMood(mood: Mood) {
    const isNewMood = mood !== selectedMood
    setSelectedMood(mood)
    setView('recommendations')
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
    if (isNewMood) {
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }

  function chooseSituation(situation: ViewingSituation | null) {
    setSelectedSituation(situation)
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function updateFilters(nextFilters: MovieFilters) {
    setFilters(nextFilters)
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function updateDiscoveryPreferences(nextPreferences: DiscoveryPreferences) {
    setDiscoveryPreferences(nextPreferences)
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function clearDiscoveryPreferences() {
    setDiscoveryPreferences(emptyDiscoveryPreferences)
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setSimilarToMovieId(null)
    setDecisionState(null)
    setRound(0)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function showAnotherThree() {
    setPreviousPickOffset(round)
    setDecisionState(null)
    setRound(getNextPickOffset(discoveryPool.length, round))
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function showPreviousThree() {
    if (previousPickOffset === null) return
    setRound(previousPickOffset)
    setPreviousPickOffset(null)
  }

  function showFavorites() {
    setView('favorites')
    setSimilarToMovieId(null)
    setDecisionState(null)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function showRecommendations() {
    setView('recommendations')
    setSimilarToMovieId(null)
    setDecisionState(null)
    setPreviousPickOffset(null)
    setRecommendationReveal('glimpse')
  }

  function showSimilarMovies(movieId: string) {
    setView('recommendations')
    setSimilarToMovieId(movieId)
    setDecisionState(null)
    setPreviousPickOffset(null)
    setRecommendationReveal('full')
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function startDecisionMode() {
    if (!canUseDecisionMode) return
    setDecisionState({
      kind: 'three-slate',
      movieIds: [picks[0].id, picks[1].id, picks[2].id],
    })
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function showRefinementControls() {
    refinementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function directPickMovie(movieId: string) {
    setDecisionState({ kind: 'pick', selectedId: movieId })
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  return (
    <div className="app-shell" id="top">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <Header />
      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="kicker"><span /> A better way to pick a movie</p>
          <h1 id="page-title">Find the right film<br />for <em>right now.</em></h1>
          <p className="hero-copy">A small, considered shortlist for whatever kind of night you’re having.</p>
        </section>

        <section className="mood-section" aria-labelledby="mood-heading">
          <div className="section-heading">
            <p className="section-count">01</p>
            <div>
              <p className="eyebrow">Start with the feeling</p>
              <h2 id="mood-heading">What are you in the mood for?</h2>
            </div>
          </div>
          <p className="mood-nudge">Not completely sure? Pick the closest feeling, and we’ll narrow it from there.</p>
          <CategorySelector selectedMood={selectedMood} onSelect={chooseMood} />
        </section>

        <section className={`results ${selectedMood ? 'has-picks' : ''}`} ref={resultsRef} aria-live="polite" aria-labelledby="results-heading">
          {selectedMood && activeMood ? (
            <>
              <div className="view-controls" aria-label="Choose recommendation or saved movies view">
                <button
                  type="button"
                  className={`view-button ${!isViewingFavorites ? 'is-selected' : ''}`}
                  aria-pressed={!isViewingFavorites}
                  onClick={showRecommendations}
                >
                  Recommendations
                </button>
                <button
                  type="button"
                  className={`view-button ${isViewingFavorites ? 'is-selected' : ''}`}
                  aria-pressed={isViewingFavorites}
                  onClick={showFavorites}
                >
                  My List ({favoriteIds.length})
                </button>
              </div>
              <div className="results-header">
                <div className="section-heading">
                  <p className="section-count">02</p>
                  <div>
                    <p className="eyebrow">
                      {isViewingFavorites
                        ? 'Saved movies'
                        : isViewingSimilarMovies
                          ? 'Movies like this'
                          : isFullReveal
                            ? 'A closer look'
                            : 'First glimpse'}
                    </p>
                    <h2 id="results-heading">
                      {isViewingFavorites
                        ? 'My List'
                        : isViewingSimilarMovies
                          ? `More like ${similarSeedMovie.title}`
                          : isFullReveal
                            ? `For a ${activeMood.label.toLowerCase()} kind of night.`
                            : 'Anything here pull you in?'}
                    </h2>
                    <p className="result-count">{resultCountLabel}</p>
                  </div>
                </div>
                {!isViewingFavorites && !isViewingSimilarMovies && (
                  <div className="result-actions">
                    {canUseDecisionMode && (
                      <button type="button" className="another-button decision-start-button" onClick={startDecisionMode}>
                        Help me choose
                      </button>
                    )}
                    {previousPickOffset !== null && (
                      <button type="button" className="another-button" onClick={showPreviousThree}>
                        Previous three
                      </button>
                    )}
                    {hasMorePicks && (
                      <button type="button" className="another-button" onClick={showAnotherThree}>
                        Another three <span aria-hidden="true">↻</span>
                      </button>
                    )}
                  </div>
                )}
                {isViewingSimilarMovies && (
                  <button type="button" className="another-button" onClick={showRecommendations}>
                    Back to recommendations
                  </button>
                )}
                {isViewingFavorites && (
                  <button type="button" className="another-button" onClick={showRecommendations}>
                    Back to recommendations
                  </button>
                )}
              </div>
              {isViewingFavorites ? (
                favoriteMovies.length > 0 ? (
                  <MovieGrid movies={favoriteMovies} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                ) : (
                  <div className="empty-state compact-empty">
                    <div>
                      <p className="eyebrow">Nothing saved yet</p>
                      <h2>No movies saved yet.</h2>
                      <p>Tap the heart on a movie you might want to watch later.</p>
                    </div>
                  </div>
                )
              ) : isViewingSimilarMovies ? (
                similarMovies.length > 0 ? (
                  <MovieGrid
                    movies={similarMovies}
                    isFavorite={isFavorite}
                    onToggleFavorite={toggleFavorite}
                    onFindSimilar={showSimilarMovies}
                  />
                ) : (
                  <div className="empty-state compact-empty">
                    <div>
                      <p className="eyebrow">No similar movies</p>
                      <h2>No nearby picks in this collection yet.</h2>
                      <p>Return to the regular recommendations to keep browsing.</p>
                      <button type="button" className="empty-action" onClick={showRecommendations}>
                        Back to recommendations
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {resultMessage && <p className="result-note">{resultMessage}</p>}
                  {decisionState && selectedMood ? (
                    <DecisionMode
                      movies={movies}
                      mood={selectedMood}
                      situation={selectedSituation}
                      filters={filters}
                      discoveryPreferences={discoveryPreferences}
                      state={decisionState}
                      shareUrl={shareUrl}
                      onChange={setDecisionState}
                      onExit={() => setDecisionState(null)}
                    />
                  ) : discoveryPool.length > 0 ? (
                    <>
                      <MovieGrid
                        movies={picks}
                        variant={isFullReveal ? 'full' : 'glimpse'}
                        isFavorite={isFavorite}
                        onToggleFavorite={toggleFavorite}
                        onFindSimilar={isFullReveal ? showSimilarMovies : undefined}
                        onChooseMovie={isFullReveal ? directPickMovie : undefined}
                        showFinishTime={isFullReveal}
                      />
                      {!isFullReveal && (
                        <div className="glimpse-bridge">
                          <div>
                            <p className="eyebrow">Next move</p>
                            <p>Still circling? Tune the night. Already tempted? Open these three up.</p>
                          </div>
                          <div className="bridge-actions">
                            <button type="button" className="details-toggle" onClick={showRefinementControls}>
                              Refine tonight
                            </button>
                            <button type="button" className="details-toggle decision-primary" onClick={() => setRecommendationReveal('full')}>
                              Take a closer look
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="refinement-stack" ref={refinementRef}>
                        <SituationSelector selectedSituation={selectedSituation} onSelect={chooseSituation} />
                        <DiscoveryPreferencesPanel
                          preferences={discoveryPreferences}
                          onChange={updateDiscoveryPreferences}
                          onClear={clearDiscoveryPreferences}
                        />
                        <FilterPanel
                          filters={filters}
                          genreOptions={genreOptions}
                          languageOptions={languageOptions}
                          onChange={updateFilters}
                          onClear={clearFilters}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="empty-state compact-empty">
                        <div>
                          <p className="eyebrow">No matches</p>
                          <h2>
                            {dealbreakersAreActive
                              ? 'Nothing in the current collection fits all of these boundaries.'
                              : 'No movies match all of these preferences.'}
                          </h2>
                          <p>
                            {dealbreakersAreActive
                              ? 'Try removing one “Not tonight” choice.'
                              : 'Clear filters to widen the shortlist.'}
                          </p>
                          <button
                            type="button"
                            className="empty-action"
                            onClick={dealbreakersAreActive ? clearDiscoveryPreferences : clearFilters}
                          >
                            {dealbreakersAreActive ? 'Clear tonight' : 'Clear filters'}
                          </button>
                        </div>
                      </div>
                      <div className="refinement-stack" ref={refinementRef}>
                        <SituationSelector selectedSituation={selectedSituation} onSelect={chooseSituation} />
                        <DiscoveryPreferencesPanel
                          preferences={discoveryPreferences}
                          onChange={updateDiscoveryPreferences}
                          onClear={clearDiscoveryPreferences}
                        />
                        <FilterPanel
                          filters={filters}
                          genreOptions={genreOptions}
                          languageOptions={languageOptions}
                          onChange={updateFilters}
                          onClear={clearFilters}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true"><span>◐</span><i /></div>
              <div>
                <p className="eyebrow">Tonight’s shortlist</p>
                <h2 id="results-heading">Your next great watch is waiting.</h2>
                <p>Choose a feeling above, and we’ll keep it simple: just three films worth your time.</p>
              </div>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  )
}

export default App
