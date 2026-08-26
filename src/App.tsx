import { useMemo, useRef, useState } from 'react'
import { CategorySelector, moods } from './components/CategorySelector'
import { FilterPanel } from './components/FilterPanel'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { MovieGrid } from './components/MovieGrid'
import { SituationSelector } from './components/SituationSelector'
import { movies } from './data/movies'
import { useFavorites } from './hooks/useFavorites'
import { emptyFilters, filterMovies } from './utils/filterMovies'
import type { Mood, MovieFilters, ViewingSituation } from './types/movie'

const PICKS_PER_ROUND = 3

function getPicks(recommendationPool: typeof movies, offset: number) {
  if (recommendationPool.length === 0) {
    return []
  }

  return recommendationPool.slice(offset, offset + PICKS_PER_ROUND)
}

function App() {
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null)
  const [selectedSituation, setSelectedSituation] = useState<ViewingSituation | null>(null)
  const [filters, setFilters] = useState<MovieFilters>(emptyFilters)
  const [round, setRound] = useState(0)
  const [view, setView] = useState<'recommendations' | 'favorites'>('recommendations')
  const resultsRef = useRef<HTMLElement>(null)
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

  const picks = useMemo(
    () => getPicks(filterResult.recommendationPool, round),
    [filterResult.recommendationPool, round],
  )
  const favoriteMovies = useMemo(
    () => movies.filter((movie) => favoriteIds.includes(movie.id)),
    [favoriteIds],
  )

  const activeMood = moods.find((mood) => mood.id === selectedMood)
  const hasMorePicks = filterResult.recommendationPool.length > PICKS_PER_ROUND
  const isViewingFavorites = view === 'favorites'
  const resultMessage = filterResult.usedSituationFallback
    ? `Only ${filterResult.exactMatches.length} matched everything, so we added ${filterResult.fallbackMatches.length} more that fit your mood and filters.`
    : null

  function chooseMood(mood: Mood) {
    const isNewMood = mood !== selectedMood
    setSelectedMood(mood)
    setView('recommendations')
    setRound(0)
    if (isNewMood) {
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }

  function chooseSituation(situation: ViewingSituation | null) {
    setSelectedSituation(situation)
    setRound(0)
  }

  function updateFilters(nextFilters: MovieFilters) {
    setFilters(nextFilters)
    setRound(0)
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setRound(0)
  }

  function showAnotherThree() {
    setRound((currentOffset) => (
      currentOffset + PICKS_PER_ROUND >= filterResult.recommendationPool.length
        ? 0
        : currentOffset + PICKS_PER_ROUND
    ))
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function showFavorites() {
    setView('favorites')
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function showRecommendations() {
    setView('recommendations')
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
              {!isViewingFavorites && (
                <>
                  <SituationSelector selectedSituation={selectedSituation} onSelect={chooseSituation} />
                  <FilterPanel
                    filters={filters}
                    genreOptions={genreOptions}
                    languageOptions={languageOptions}
                    onChange={updateFilters}
                    onClear={clearFilters}
                  />
                </>
              )}
              <div className="results-header">
                <div className="section-heading">
                  <p className="section-count">02</p>
                  <div>
                    <p className="eyebrow">{isViewingFavorites ? 'Saved movies' : 'Your three picks'}</p>
                    <h2 id="results-heading">
                      {isViewingFavorites ? 'My List' : `For a ${activeMood.label.toLowerCase()} kind of night.`}
                    </h2>
                  </div>
                </div>
                {!isViewingFavorites && hasMorePicks && (
                  <button type="button" className="another-button" onClick={showAnotherThree}>
                    Another three <span aria-hidden="true">↻</span>
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
              ) : (
                <>
                  {resultMessage && <p className="result-note">{resultMessage}</p>}
                  {filterResult.recommendationPool.length > 0 ? (
                    <MovieGrid movies={picks} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                  ) : (
                    <div className="empty-state compact-empty">
                      <div>
                        <p className="eyebrow">No matches</p>
                        <h2>No movies match all of these preferences.</h2>
                        <p>Clear filters to widen the shortlist.</p>
                      </div>
                    </div>
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
