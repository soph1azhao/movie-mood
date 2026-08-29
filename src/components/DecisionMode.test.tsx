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

describe('DecisionMode three-slate cues', () => {
  it('renders each card with that movie’s own vibe summary, not a pairwise comparison', () => {
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
