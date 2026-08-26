import { useMemo, useRef, useState } from 'react'
import { CategorySelector, moods } from './components/CategorySelector'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { MovieGrid } from './components/MovieGrid'
import { SituationSelector } from './components/SituationSelector'
import { movies } from './data/movies'
import { emptyFilters, filterMovies } from './utils/filterMovies'
import type { Mood, ViewingSituation } from './types/movie'

const PICKS_PER_ROUND = 3

function getPicks(recommendationPool: typeof movies, offset: number) {
  if (recommendationPool.length === 0) {
    return []
  }
  if (recommendationPool.length <= PICKS_PER_ROUND) {
    return recommendationPool
  }
  return Array.from(
    { length: PICKS_PER_ROUND },
    (_, index) => recommendationPool[(offset + index) % recommendationPool.length],
  )
}

function App() {
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null)
  const [selectedSituation, setSelectedSituation] = useState<ViewingSituation | null>(null)
  const [round, setRound] = useState(0)
  const resultsRef = useRef<HTMLElement>(null)

  const filterResult = useMemo(
    () => filterMovies(movies, selectedMood, selectedSituation, emptyFilters),
    [selectedMood, selectedSituation],
  )

  const picks = useMemo(
    () => getPicks(filterResult.recommendationPool, round * PICKS_PER_ROUND),
    [filterResult.recommendationPool, round],
  )

  const activeMood = moods.find((mood) => mood.id === selectedMood)

  function chooseMood(mood: Mood) {
    const isNewMood = mood !== selectedMood
    setSelectedMood(mood)
    setRound(0)
    if (isNewMood) {
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }

  function chooseSituation(situation: ViewingSituation | null) {
    setSelectedSituation(situation)
    setRound(0)
  }

  function showAnotherThree() {
    setRound((currentRound) => currentRound + 1)
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
          <CategorySelector selectedMood={selectedMood} onSelect={chooseMood} />
        </section>

        <section className={`results ${selectedMood ? 'has-picks' : ''}`} ref={resultsRef} aria-live="polite" aria-labelledby="results-heading">
          {selectedMood && activeMood ? (
            <>
              <SituationSelector selectedSituation={selectedSituation} onSelect={chooseSituation} />
              <div className="results-header">
                <div className="section-heading">
                  <p className="section-count">02</p>
                  <div>
                    <p className="eyebrow">Your three picks</p>
                    <h2 id="results-heading">For a {activeMood.label.toLowerCase()} kind of night.</h2>
                  </div>
                </div>
                <button type="button" className="another-button" onClick={showAnotherThree}>
                  Another three <span aria-hidden="true">↻</span>
                </button>
              </div>
              <MovieGrid movies={picks} />
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
