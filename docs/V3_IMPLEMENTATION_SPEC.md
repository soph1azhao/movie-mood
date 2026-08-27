# Movie Mood V3 — Codex Implementation Specification

## 1. Project Context

**Project:** Movie Mood
**Repository:** `soph1azhao/movie-mood`
**Current checkpoint:** `v2.0.0`
**Stack:** Vite + React + TypeScript + plain CSS
**Hosting:** GitHub Pages
**Data:** local curated TypeScript movie dataset

V2 is complete.

V2 currently provides:

* six mood-first entry points
* optional viewing situations
* genre, runtime, language, pace, and emotional-weight filters
* three movie choices at a time
* situation fallback behavior
* richer movie details
* browser-local favorites and My List
* local CSS-generated posters

V3 should **evolve the browsing/discovery model**, not replace Movie Mood with a recommendation system.

---

# 2. V3 Product Goal

Movie Mood V3 should help users explore a small curated movie collection using more human ways of expressing what they want **right now**.

The intended idea is:

> **Mood starts the choice. Human experience preferences, boundaries, and lightweight discovery help the user explore a little further without turning the app into an endless catalogue.**

V3 should introduce:

1. a larger curated movie pool
2. human experience preferences
3. explicit dealbreakers
4. lightweight matching
5. “Movies like this”
6. more deliberate discovery among the final choices

The project should continue to emphasize:

> **Right for now, not right for you.**

Do not attempt to infer a permanent taste profile.

---

# 3. Hard Scope Constraints

V3 must remain:

* static
* free to run and host
* local-first
* understandable by one developer
* deployable through the existing GitHub Pages workflow

Do not add:

* backend
* database
* authentication
* accounts
* AI/chat
* external movie API
* official poster API
* cloud persistence
* personalized user profiling
* collaborative filtering
* machine learning
* React Router
* Redux
* Zustand
* a state-management framework
* search
* sorting
* shareable URL state
* multi-user/movie-night-for-two behavior
* broad visual redesign

Those remain future-version candidates.

Do not display numerical recommendation percentages or claims such as:

```text
96% match
```

Internal lightweight ordering logic is allowed, but it must remain transparent and simple.

---

# 4. Preserve V2

Do not remove or unnecessarily redesign:

* the six existing moods
* viewing situations
* practical filters
* favorites
* My List
* movie details
* three-choice presentation
* situation fallback behavior
* localStorage favorite IDs
* CSS-generated poster system
* current deployment workflow

Mood remains the primary starting point.

Existing V2 users must still be able to:

```text
Mood → situation/filter → three movies
```

without using any V3 controls.

---

# 5. V3 Discovery Model

V3 adds an optional discovery layer after mood selection.

The conceptual flow becomes:

```text
Mood
  ↓
optional situation / practical filters
  ↓
optional "Tonight" discovery preferences
  ↓
eligible movie pool
  ↓
lightweight ordering
  ↓
three choices
  ↓
More like this
```

V3 discovery controls must remain optional.

Do not force users through a questionnaire before showing movies.

---

# 6. Human Experience Preferences

Add two new movie-level experience fields.

## 6.1 Attention Demand

```ts
export type AttentionDemand =
  | 'easy'
  | 'engaged'
  | 'immersive'
```

Definitions:

### easy

Easy to follow when the viewer is tired or wants a low-effort watch.

### engaged

Benefits from normal attention but is not unusually demanding.

### immersive

Best when the viewer is ready to concentrate or fully sink into the movie.

User-facing prompt:

**How much attention do you want to give tonight?**

Options:

* Take it easy
* Keep me engaged
* Full immersion
* No preference

---

## 6.2 Discovery Style

```ts
export type DiscoveryStyle =
  | 'familiar'
  | 'different'
  | 'adventurous'
```

Definitions:

### familiar

Accessible, recognizable, or relatively easy to enter.

### different

Offers a noticeable change in style, culture, structure, genre, or tone without being especially challenging.

### adventurous

Unconventional, formally unusual, culturally unfamiliar, challenging, or intentionally outside a typical comfort-zone choice.

This is an editorial Movie Mood label.

It is **not** inferred from user history.

User-facing prompt:

**How far from your comfort zone?**

Options:

* Keep it familiar
* Something different
* Surprise me
* No preference

Avoid sliders and numerical scales.

---

# 7. Dealbreakers

Add a small **Not tonight** section.

Supported V3 dealbreakers:

```ts
export interface Dealbreakers {
  avoidHeavy: boolean
  avoidSlow: boolean
  underTwoHours: boolean
}
```

User-facing labels:

* Nothing emotionally heavy
* No slow burn
* Keep it under 2 hours

Rules:

### Nothing emotionally heavy

Exclude:

```ts
emotionalWeight === 'heavy'
```

### No slow burn

Exclude:

```ts
pace === 'slow'
```

### Keep it under 2 hours

Exclude:

```ts
runtimeMinutes >= 120
```

Dealbreakers are strict.

Never relax them silently.

If dealbreakers produce too few results, show fewer movies and explain that the user can remove a boundary.

Do not add additional dealbreakers in V3 unless required to fix a clearly identified usability problem.

---

# 8. V3 Preference State

Add a separate V3 type rather than expanding `MovieFilters` indefinitely.

Suggested types:

```ts
export interface DiscoveryPreferences {
  attentionDemand: AttentionDemand | null
  discoveryStyle: DiscoveryStyle | null
  dealbreakers: Dealbreakers
}
```

Suggested initial value:

```ts
export const emptyDiscoveryPreferences: DiscoveryPreferences = {
  attentionDemand: null,
  discoveryStyle: null,
  dealbreakers: {
    avoidHeavy: false,
    avoidSlow: false,
    underTwoHours: false,
  },
}
```

Keep practical V2 filters and V3 discovery preferences conceptually separate.

---

# 9. Lightweight Matching

Do not replace `filterMovies()`.

The existing V2 filtering utility remains responsible for:

```text
mood
+ situation
+ practical filters
+ existing situation fallback
```

V3 discovery logic should operate on the resulting eligible pool.

Conceptually:

```text
movies
  ↓
filterMovies()
  ↓
V2 eligible pool
  ↓
apply V3 dealbreakers
  ↓
order by optional experience preferences
  ↓
display three
```

Create a separate pure utility, for example:

```text
src/utils/discovery.ts
```

Suggested responsibilities:

```ts
applyDealbreakers(...)
rankByExperiencePreferences(...)
getDiscoveryPool(...)
getSimilarMovies(...)
```

Names may vary if an existing project convention is clearer.

---

# 10. Matching Rules

## 10.1 Dealbreakers

Dealbreakers are hard constraints.

A movie violating an active dealbreaker must not appear.

---

## 10.2 Experience Preferences

`attentionDemand` and `discoveryStyle` are soft preferences.

Movies matching them should appear earlier.

Movies that do not match may still appear if they satisfy:

* mood
* practical filters
* applicable situation/fallback rules
* active dealbreakers

Do not produce an empty result merely because a soft preference cannot be satisfied.

---

## 10.3 Internal Ordering

Use a small deterministic ordering rule.

A simple implementation is sufficient.

For example:

```text
+1 matching attention preference
+1 matching discovery-style preference
```

Existing exact situation matches should remain ahead of situation fallback results.

Do not create large weighting tables.

Do not add decimal confidence scores.

Do not expose internal points to users.

Use stable dataset order as the final tie-breaker.

---

# 11. Larger Curated Library

Expand the current local collection from roughly 26 films to **at least 36 films**.

The additional movies should improve useful coverage rather than simply increase quantity.

Aim to strengthen gaps across:

* moods
* countries
* languages
* decades
* genres
* pace
* emotional weight
* attention demand
* discovery style

Keep the library intentionally curated.

Do not attempt to create a large catalogue.

All movies, existing and new, must receive:

```ts
attentionDemand
discoveryStyle
```

Continue to maintain all required V2 fields.

Use stable IDs.

Do not replace local data with an API.

---

# 12. Data-Curation Rules

Experience labels are subjective, so consistency matters more than false precision.

Do not add numerical attributes such as:

```ts
attentionScore: 7.4
noveltyScore: 8.1
```

Use the categorical definitions in this specification.

Before assigning a value, interpret the category according to its definition rather than according to whether the movie is personally liked.

Keep metadata concise and spoiler-free.

---

# 13. “Movies Like This”

Every normal movie card should provide a discovery action such as:

```text
More like this
```

When selected:

1. use that movie as the discovery seed
2. find similar movies from the curated local dataset
3. exclude the seed movie
4. show up to three similar movies
5. clearly identify the mode:

```text
More like Perfect Days
```

6. provide a clear way to return to the previous normal recommendations

A similar movie may itself be used as a new seed.

No route is required.

No browser history stack is required.

A single active `similarToMovieId` state is sufficient.

---

# 14. Similarity Logic

`getSimilarMovies()` must remain deterministic and explainable.

Use existing and V3 metadata.

Suggested similarity signals:

```text
shared mood
shared genre
same pace
same emotional weight
same attention demand
same discovery style
shared situation
```

Use a small fixed internal point system.

Example:

```text
shared mood             +2
shared genre            +2
same pace               +1
same emotional weight   +1
same attention demand   +1
same discovery style    +1
shared situation        +1
```

Exact values may be adjusted if tests reveal clearly poor behavior, but keep the model simple.

Do not use:

* user history
* favorites as ranking weight
* external popularity
* ratings
* machine learning

Do not display the internal score.

Tie-break using stable dataset order.

---

# 15. Choice Presentation

Continue showing a maximum of three movies at once.

V3 should make the three results feel deliberately useful without inventing certainty.

When experience preferences are active, the UI may provide concise context such as:

```text
Fits your low-effort mood tonight
```

or:

```text
A more adventurous option
```

Do not claim that any movie is objectively the “best.”

Do not require labels such as:

* Safe
* Different
* Wildcard

for every result in V3.

Those may be used only if they emerge naturally from the implementation without adding substantial complexity.

---

# 16. UI Scope

Add one compact optional discovery section after the existing mood/situation area.

Suggested heading:

```text
What feels right tonight?
```

Include:

### Attention

```text
Take it easy
Keep me engaged
Full immersion
```

### Discovery

```text
Keep it familiar
Something different
Surprise me
```

### Not tonight

```text
Nothing emotionally heavy
No slow burn
Keep it under 2 hours
```

Controls should use accessible buttons, pills, radio-like controls, or checkboxes consistent with the existing UI.

Do not introduce a multi-page questionnaire.

Do not redesign the entire visual system.

---

# 17. Empty and Limited Results

If active dealbreakers reduce the eligible pool:

### 3 or more

Show three.

### 1–2

Show the available movies and explain:

```text
Only 2 movies fit these boundaries tonight.
Try removing a “Not tonight” choice to see more.
```

### 0

Show:

```text
Nothing in the current collection fits all of these boundaries.

Try removing one “Not tonight” choice.
```

Do not silently relax dealbreakers.

Soft experience preferences may be relaxed automatically because they affect ordering, not eligibility.

---

# 18. Recommendation Cycling

Preserve V2 cycling behavior where reasonable.

The current discovery pool after dealbreakers and ordering becomes the pool used by **Another three**.

Changing any of these must reset the recommendation offset:

* mood
* situation
* practical filter
* attention preference
* discovery-style preference
* dealbreaker

Do not show duplicate movies within one three-card slate.

Address the known V2 edge case where the final cycle can show fewer than three movies even though the pool contains more than three total movies.

When the eligible pool contains more than three movies, cycling should fill a three-card slate by wrapping to unseen/next eligible movies as appropriate.

Do not duplicate a movie within the same slate.

---

# 19. Architecture

Preserve the current architecture.

Expected direction:

```text
src/
  components/
    ...
    DiscoveryPreferences.tsx   # or similarly clear name

  data/
    movies.ts

  hooks/
    useFavorites.ts

  types/
    movie.ts

  utils/
    filterMovies.ts            # preserve V2 responsibility
    discovery.ts               # V3 pure discovery logic

  App.tsx
  styles.css
```

Do not create unnecessary layers merely to match this layout.

`App.tsx` may coordinate state but should not contain the matching algorithms.

---

# 20. Automated Tests

V3 introduces reusable matching logic with meaningful edge cases.

Add a lightweight TypeScript-compatible test runner.

**Vitest is preferred** because the project already uses Vite.

Add only the minimum required testing dependency/configuration.

Add:

```text
pnpm test
```

or an equivalent concise test script.

At minimum, automated tests must cover:

### Dealbreakers

* heavy movies excluded when `avoidHeavy`
* slow movies excluded when `avoidSlow`
* movies of exactly 120 minutes excluded by `underTwoHours`
* multiple dealbreakers combine correctly

### Experience ordering

* matching attention preference ranks earlier
* matching discovery style ranks earlier
* soft preferences do not remove otherwise eligible movies
* ordering is deterministic

### Movies Like This

* seed movie is excluded
* stronger overlap ranks ahead of weaker overlap
* ties are deterministic
* result count does not exceed requested limit

### Cycling helper, if extracted

* no duplicate within a three-card slate
* wrap behavior fills three slots when the pool contains more than three movies

Do not write broad snapshot tests for ordinary presentational components unless they provide real value.

---

# 21. Implementation Phases

V3 should use **four implementation phases**.

Keep each phase independently buildable.

---

## Phase 1 — Discovery Data Foundation

Implement:

* `AttentionDemand`
* `DiscoveryStyle`
* `DiscoveryPreferences`
* dealbreaker types
* new movie fields
* tagging of all existing movies
* expansion to at least 36 curated films
* Vitest setup
* pure V3 discovery utility
* unit tests for dealbreakers and experience ordering

Do not add V3 UI yet.

### Phase 1 acceptance

* existing V2 behavior still builds
* dataset has at least 36 films
* every movie has valid V3 experience fields
* discovery utility is pure and deterministic
* targeted tests pass
* production build passes

Risk: **high** because data and core matching logic change.

---

## Phase 2 — Tonight Discovery Controls

Implement the optional V3 controls:

* attention preference
* discovery-style preference
* three dealbreakers
* clear/reset behavior
* integration with V2 eligible pool
* recommendation-offset reset when preferences change
* limited/empty-result messaging

Preserve existing V2 filters.

### Phase 2 acceptance

* no V3 preference is required
* V2-only flow still works
* dealbreakers are strict
* soft preferences affect order but not eligibility
* changing V3 preferences resets cycling
* production build passes
* targeted discovery tests pass

Risk: **medium/high**.

---

## Phase 3 — Movies Like This

Implement:

* `More like this`
* deterministic local similarity utility
* up to three similar results
* exclusion of seed movie
* ability to use a similar result as the next seed
* clear return to ordinary recommendations
* targeted similarity tests

Do not add routes or external APIs.

### Phase 3 acceptance

* similarity uses local curated metadata only
* seed never appears in its own results
* results are deterministic
* V2 favorites/details continue working in similar-results mode
* tests pass
* production build passes

Risk: **high** for reusable matching logic, medium for UI.

---

## Phase 4 — Integration, Cycling Fix, Documentation

Complete V3 by:

* fixing the known final-cycle three-card edge case
* reviewing responsive behavior of new controls
* keyboard/focus accessibility sanity checks
* checking empty/limited states
* updating README
* updating LEARNING_NOTES
* documenting new V3 fields and utilities
* verifying GitHub Pages build compatibility

Do not add unrelated visual polish.

### Phase 4 acceptance

* ordinary V2 flow works
* V3 preferences work
* dealbreakers work
* More like this works
* favorites/My List work
* Another three behaves correctly
* tests pass
* production build passes
* documentation reflects V3 architecture

Risk: **medium**, with high-risk regression checks around cycling/discovery integration.

---

# 22. Deferred Beyond V3

Explicitly defer:

* TMDb/API integration
* official posters
* search
* sorting
* URL-state sharing
* two-person compromise mode
* user accounts
* cloud sync
* persistent taste profiles
* personalized weighting
* AI/chat
* complex recommendation models
* large-scale catalogue browsing

These should not enter V3 opportunistically.

---

# 23. V3 Completion Criteria

V3 is complete when a user can:

1. start with the existing mood-first experience
2. optionally specify attention level
3. optionally specify how adventurous the choice should feel
4. specify simple “Not tonight” boundaries
5. receive up to three fitting choices from a larger curated library
6. continue cycling through eligible choices
7. select **More like this** from an interesting movie
8. return to the main choice flow
9. continue using favorites and My List normally

The implementation must remain:

* local
* static
* deterministic
* understandable
* tested where logic has meaningful edge cases
* free of paid services and infrastructure

## V3 in one sentence

> **V3 evolves Movie Mood from practical mood filtering into a small human-centered discovery experience: express what feels right tonight, rule out what does not, and explore a few related films without entering an endless recommendation catalogue.**
