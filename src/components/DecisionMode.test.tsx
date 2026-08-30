import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { movies } from '../data/movies'
import { DecisionMode } from './DecisionMode'

const filters = {
  genres: [],
  runtime: null,
  language: null,
  pace: null,
  emotionalWeight: null,
}

const discoveryPreferences = {
  attentionDemand: null,
  discoveryStyle: null,
  dealbreakers: {
    avoidHeavy: false,
    avoidSlow: false,
    underTwoHours: false,
  },
}

function getMovie(id: string) {
  const movie = movies.find((candidate) => candidate.id === id)

  if (!movie) {
    throw new Error(`Missing movie fixture: ${id}`)
  }

  return movie
}

function cueForCard(markup: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markup.match(new RegExp(`<h3>${escapedTitle}</h3>[\\s\\S]*?<p class="decision-cue">([^<]+)</p>`))

  return match?.[1]
}

// Shared no-op favorites — existing tests are not concerned with favorites.
const noFavorite = () => false
const noToggle = () => undefined

describe('DecisionMode three-slate cues', () => {
  it('renders each card with that movie\u2019s own vibe summary, not a pairwise comparison', () => {
    const paddington = getMovie('paddington-2')
    const hunt = getMovie('hunt-wilderpeople')
    const grandBudapest = getMovie('grand-budapest')
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={[paddington, hunt, grandBudapest]}
        mood="funny"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'three-slate', movieIds: [paddington.id, hunt.id, grandBudapest.id] }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(cueForCard(markup, paddington.title)).toBe(paddington.vibeSummary)
    expect(cueForCard(markup, hunt.title)).toBe(hunt.vibeSummary)
    expect(cueForCard(markup, paddington.title)).not.toBe(hunt.vibeSummary)
    expect(cueForCard(markup, hunt.title)).not.toBe(paddington.vibeSummary)
    expect(markup).not.toContain('Paddington 2 is the gentler, lower-effort watch tonight.')
  })

  it('renders Form B only when the companion helper identifies an outlier', () => {
    const rearWindow = getMovie('rear-window')
    const childrenOfMen = getMovie('children-of-men')
    const petiteMaman = getMovie('petite-maman-2021')

    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'three-slate', movieIds: [rearWindow.id, childrenOfMen.id, petiteMaman.id] }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).toContain('Decision companion')
    expect(markup).toContain('Children of Men stands a little apart.')
    expect(markup).toContain('It carries a heavier emotional charge than the other two.')
    expect(markup).toContain(childrenOfMen.vibeSummary)
    expect(markup).toContain('Not tonight')
    expect(markup).toContain('Keep it in')
    expect(markup).toContain('Choose this tonight')
  })

  it('keeps silent slates in the normal manual Drop One flow', () => {
    const shoplifters = getMovie('shoplifters')
    const ryeLane = getMovie('rye-lane-2023')
    const petiteMaman = getMovie('petite-maman-2021')

    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="emotional"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'three-slate', movieIds: [shoplifters.id, ryeLane.id, petiteMaman.id] }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).not.toContain('stands a little apart')
    expect(markup).toContain('Drop the one that feels least like tonight, or choose a movie now.')
    expect(markup).toContain('Not tonight')
    expect(markup).toContain('Choose this tonight')
  })

  it('dismisses Form B after Keep it in while leaving all three cards available', () => {
    const rearWindow = getMovie('rear-window')
    const childrenOfMen = getMovie('children-of-men')
    const petiteMaman = getMovie('petite-maman-2021')

    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{
          kind: 'three-slate',
          movieIds: [rearWindow.id, childrenOfMen.id, petiteMaman.id],
          dismissedCompanionOutlierId: childrenOfMen.id,
        }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).not.toContain('stands a little apart')
    expect(markup).toContain(rearWindow.title)
    expect(markup).toContain(childrenOfMen.title)
    expect(markup).toContain(petiteMaman.title)
    expect(markup).toContain('Drop the one that feels least like tonight, or choose a movie now.')
  })

  it('renders the exact Duel finalists after a companion drop state', () => {
    const rearWindow = getMovie('rear-window')
    const childrenOfMen = getMovie('children-of-men')
    const petiteMaman = getMovie('petite-maman-2021')

    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{
          kind: 'duel',
          finalistIds: [rearWindow.id, petiteMaman.id],
          sourceThreeSlateIds: [rearWindow.id, childrenOfMen.id, petiteMaman.id],
          reduction: {
            kind: 'companion-drop',
            droppedMovieId: childrenOfMen.id,
          },
        }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).toContain('Final duel')
    expect(markup).toContain(rearWindow.title)
    expect(markup).toContain(petiteMaman.title)
    expect(markup).not.toContain('Children of Men</h3>')
    expect(markup).toContain('Flip a coin')
    expect(markup).toContain('Back to all three')
  })
})

describe('DecisionMode Phase 4 — Favorite Affordance Continuity', () => {
  const rearWindow = getMovie('rear-window')
  const petiteMaman = getMovie('petite-maman-2021')
  const childrenOfMen = getMovie('children-of-men')
  const shoplifters = getMovie('shoplifters')

  const duelState = {
    kind: 'duel' as const,
    finalistIds: [rearWindow.id, petiteMaman.id] as [string, string],
    sourceThreeSlateIds: [rearWindow.id, childrenOfMen.id, petiteMaman.id] as [string, string, string],
  }

  it('Duel finalist cards render a favorite control for each movie', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={duelState}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // Both finalist movies should have a favorite button rendered
    expect(markup).toContain(`Save ${rearWindow.title} to favorites`)
    expect(markup).toContain(`Save ${petiteMaman.title} to favorites`)
  })

  it('Duel favorite buttons reflect aria-pressed=false when not favorited', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={duelState}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // aria-pressed="false" for non-favorites
    const pressedFalseCount = (markup.match(/aria-pressed="false"/g) ?? []).length
    expect(pressedFalseCount).toBeGreaterThanOrEqual(2)
  })

  it('Duel favorite buttons reflect aria-pressed=true and Remove label when favorited', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={duelState}
        shareUrl="https://example.com"
        isFavorite={(movieId) => movieId === rearWindow.id}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).toContain(`Remove ${rearWindow.title} from favorites`)
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain(`Save ${petiteMaman.title} to favorites`)
  })

  it('Tonight\'s Pick exposes the favorite affordance', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'pick', selectedId: rearWindow.id }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).toContain(`Save ${rearWindow.title} to favorites`)
    expect(markup).toContain('Tonight\u2019s Pick')
  })

  it('Tonight\'s Pick reflects Remove label when the selected movie is already favorited', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'pick', selectedId: rearWindow.id }}
        shareUrl="https://example.com"
        isFavorite={(movieId) => movieId === rearWindow.id}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(markup).toContain(`Remove ${rearWindow.title} from favorites`)
    expect(markup).toContain('aria-pressed="true"')
  })

  it('three-slate Decision Mode does NOT render a favorite control', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="emotional"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{
          kind: 'three-slate',
          movieIds: [shoplifters.id, rearWindow.id, petiteMaman.id],
        }}
        shareUrl="https://example.com"
        isFavorite={(movieId) => movieId === shoplifters.id}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // Three-slate cards must not render favorite buttons
    expect(markup).not.toContain('Save')
    expect(markup).not.toContain('Remove')
    expect(markup).not.toContain('favorite-button')
  })
})

describe('DecisionMode V7.2 Phase 1 — Action Hierarchy + Tonight’s Pick + WatchAction', () => {
  const rearWindow = getMovie('rear-window')

  it('Tonight’s Pick renders the primary Find where to watch action and secondary destinations', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'pick', selectedId: rearWindow.id }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // Primary action visible copy
    expect(markup).toContain('Find where to watch')
    expect(markup).toContain('watch-link-primary')
    expect(markup).toContain('google.com/search?q=Rear+Window+1954+where+to+watch')

    // Secondary destinations
    expect(markup).toContain('On JustWatch')
    expect(markup).toContain('justwatch.com')
    expect(markup).toContain('On Letterboxd')
    expect(markup).toContain('letterboxd.com')
    expect(markup).toContain('On TMDB')
    expect(markup).toContain('themoviedb.org')

    // Disclaimer
    expect(markup).toContain('Movie Mood does not verify streaming availability.')
  })

  it('Tonight’s Pick renders supporting and quiet reversal actions without competing primary CTAs', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={{ kind: 'pick', selectedId: rearWindow.id }}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // Supporting actions
    expect(markup).toContain('Share pick')
    expect(markup).toContain('action-supporting')
    expect(markup).toContain('favorite-button')

    // Reversal / navigation actions
    expect(markup).toContain('Change my mind')
    expect(markup).toContain('Back to browsing')
    expect(markup).toContain('action-quiet')

    // Reversals and Share pick must not have decision-primary class
    expect(markup).not.toMatch(/class="[^"]*details-toggle[^"]*decision-primary[^"]*"[^>]*>Back to browsing/)
    expect(markup).not.toMatch(/class="[^"]*details-toggle[^"]*decision-primary[^"]*"[^>]*>Share pick/)
  })
})

describe('DecisionMode V7.2 Phase 3 — Tactile Coin', () => {
  const rearWindow = getMovie('rear-window')
  const petiteMaman = getMovie('petite-maman-2021')
  const childrenOfMen = getMovie('children-of-men')

  const duelState = {
    kind: 'duel' as const,
    finalistIds: [rearWindow.id, petiteMaman.id] as [string, string],
    sourceThreeSlateIds: [rearWindow.id, childrenOfMen.id, petiteMaman.id] as [string, string, string],
  }

  it('renders tactile 3D Flip a coin button with native button semantics and accessible label', () => {
    const markup = renderToStaticMarkup(
      <DecisionMode
        movies={movies}
        mood="suspenseful"
        situation={null}
        filters={filters}
        discoveryPreferences={discoveryPreferences}
        state={duelState}
        shareUrl="https://example.com"
        isFavorite={noFavorite}
        onToggleFavorite={noToggle}
        onChange={() => undefined}
        onExit={() => undefined}
      />,
    )

    // Button trigger
    expect(markup).toContain('Flip a coin')
    expect(markup).toContain('aria-label="Flip a coin"')
    expect(markup).toContain('coin-button')
    expect(markup).toContain('coin-inner')
    expect(markup).toContain('coin-face coin-front')
    expect(markup).toContain('coin-face coin-back')
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*class="[^"]*coin-button[^"]*"/)
  })
})

