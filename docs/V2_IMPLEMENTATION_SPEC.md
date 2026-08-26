# Movie Mood V2 — Codex Implementation Specification

## 1. Project Context

**Project:** Movie Mood
**Repository:** `soph1azhao/movie-mood`
**Tech stack:** Vite + React + TypeScript + plain CSS
**Hosting:** GitHub Pages
**Data source:** Local TypeScript movie dataset only

Movie Mood V1 is already implemented and deployed.

V1 currently allows users to:

* choose one of six moods
* receive three movie recommendations
* rotate results with “Another three”
* browse a local movie dataset of about 26 films
* view movie metadata including title, year, director, country, genres, description, `whyWatch`, moods, and color palette

V1 uses CSS-generated title/poster graphics rather than official movie posters.

V2 should expand the product without changing its fundamental architecture.

---

# 2. V2 Product Goal

V2 should help users **choose a movie for themselves through richer browsing and decision-support information**.

Do not attempt to build an advanced recommendation algorithm.

The intended experience is:

**Mood → optional viewing situation → recommendations → optional filters → inspect movie → save favorites**

Mood remains the primary entry point.

The site should remain:

* beginner-friendly
* static
* easy to understand
* easy to maintain
* deployable through the existing GitHub Pages workflow

---

# 3. Hard Scope Constraints

Do not add:

* backend
* database
* authentication
* accounts
* external movie APIs
* AI or chatbot features
* Redux
* Zustand
* React Context unless absolutely necessary
* React Router unless absolutely necessary
* CSS framework
* component framework
* external state-management library
* recommendation-scoring algorithm
* numerical recommendation scores
* official poster API integration

Use only:

* React
* TypeScript
* Vite
* plain CSS
* browser `localStorage`
* local movie data

Keep the architecture simple enough for a beginner to understand.

---

# 4. Preserve Existing V1 Features

Do not remove or redesign working V1 behavior unnecessarily.

Keep the existing six moods:

* Funny
* Exciting
* Thought-provoking
* Relaxing
* Emotional
* Suspenseful

Keep:

* three recommendations at a time
* “Another three”
* local movie dataset
* dark cinematic design direction
* reusable React components
* GitHub Pages deployment
* TypeScript types
* existing color-palette poster system

Do not add Cozy or Curious in V2.

Those are postponed.

---

# 5. V2 Features to Implement

V2 should add five feature areas.

## 5.1 Viewing Situation

After selecting a mood, users may optionally choose one viewing situation.

Supported situations:

```ts
type ViewingSituation =
  | "alone"
  | "date-night"
  | "friends"
  | "family"
  | "easy-watch"
```

User-facing labels:

* Quiet night alone
* Date night
* With friends
* Family movie night
* Don’t want to think too hard

Also provide:

* No preference

Situation selection must be optional.

Selecting a mood should be enough to see movie recommendations.

---

# 5.2 Practical Filters

Add optional filters for:

1. Genre
2. Runtime
3. Language
4. Pace
5. Emotional weight

Do not add more filters in V2.

### Genre

Multi-select.

A movie may have multiple genres.

### Runtime

Use three UI categories:

* Under 100 min
* 100–130 min
* Over 130 min

Recommended internal type:

```ts
type RuntimeFilter =
  | "short"
  | "medium"
  | "long"
```

Rules:

```text
short: runtimeMinutes < 100
medium: runtimeMinutes >= 100 && runtimeMinutes <= 130
long: runtimeMinutes > 130
```

### Language

Single-select is sufficient for V2.

The values should be generated from or based on the local dataset rather than hard-coded unnecessarily.

The movie data itself should store actual language names.

Example:

```ts
languages: ["Japanese"]
```

or:

```ts
languages: ["Korean", "English"]
```

### Pace

Allowed values:

```ts
type Pace =
  | "slow"
  | "medium"
  | "fast"
```

Definitions:

**slow**
Patient, observational, meditative, or deliberately paced.

**medium**
Neither notably slow nor strongly propulsive.

**fast**
Energetic, plot-driven, action-oriented, or rapidly moving.

### Emotional Weight

Allowed values:

```ts
type EmotionalWeight =
  | "light"
  | "moderate"
  | "heavy"
```

Definitions:

**light**
Generally emotionally easy to watch.

**moderate**
Contains meaningful tension, sadness, or emotional stakes without being especially exhausting.

**heavy**
Contains sustained grief, dread, violence, tragedy, distress, or emotionally demanding material.

---

# 5.3 Richer Movie Information

Each movie should gain:

```ts
runtimeMinutes: number
languages: string[]
situations: ViewingSituation[]
pace: Pace
emotionalWeight: EmotionalWeight
curiosityHook: string
vibeSummary: string
```

Also add a stable `id`.

Recommended V2 movie type:

```ts
type Movie = {
  id: string

  title: string
  year: number
  director: string

  countries: string[]
  languages: string[]
  genres: string[]

  runtimeMinutes: number

  moods: Mood[]
  situations: ViewingSituation[]

  pace: Pace
  emotionalWeight: EmotionalWeight

  description: string
  whyWatch: string
  curiosityHook: string
  vibeSummary: string

  palette: MoviePalette
}
```

Preserve any currently working movie fields required by the existing application.

Do not rename existing fields unnecessarily unless required for consistency.

---

# 5.4 Movie Details

The recommendation card should remain readable and not display every field at once.

The compact movie card should display approximately:

* title
* year
* director
* country
* genre
* runtime
* mood tags where appropriate
* curiosity hook
* pace
* emotional weight
* existing `whyWatch`
* favorite button
* “More details” control

Create a richer detail view using either:

* expandable card
* simple modal

Prefer the simpler implementation.

Do not add a dedicated route for each movie.

The detailed view may show:

* description
* director
* year
* countries
* languages
* genres
* runtime
* moods
* situations
* pace
* emotional weight
* curiosity hook
* vibe summary
* whyWatch

---

# 5.5 Favorites and My List

Add a favorite button to each movie.

Use:

```text
♡
```

for unsaved and:

```text
♥
```

or equivalent selected styling for saved.

Store only movie IDs in `localStorage`.

Example:

```ts
[
  "parasite-2019",
  "perfect-days-2023"
]
```

Do not store full movie objects.

Suggested storage key:

```text
movieMoodFavorites
```

Create:

```text
src/hooks/useFavorites.ts
```

Suggested public interface:

```ts
const {
  favoriteIds,
  toggleFavorite,
  isFavorite
} = useFavorites()
```

The implementation should:

* load favorites safely
* tolerate missing localStorage data
* tolerate malformed localStorage data
* save updates automatically
* not crash if stored data is invalid

Add a header control such as:

```text
My List (3)
```

The My List view should display saved movies using the same existing movie components wherever possible.

Do not create a separate duplicate card component for favorites.

Users must be able to:

* save a movie
* remove a movie
* reload the page and retain favorites
* remove a movie directly from My List
* return to recommendations

If no favorites exist, show a friendly empty state.

Example concept:

```text
No movies saved yet.

Tap the heart on a movie you might want to watch later.
```

---

# 6. Recommendation and Filtering Rules

This behavior must be implemented explicitly.

## 6.1 Mood

Mood is required.

Every recommendation must match the selected mood.

Do not silently recommend movies outside the selected mood unless using the fallback behavior defined below.

---

# 6.2 Situation

Situation is optional.

If no situation is selected:

```text
match mood + filters
```

If a situation is selected:

```text
match mood + situation + filters
```

---

# 6.3 Practical Filters

Active practical filters are strict.

If the user chooses:

```text
Genre: Drama
Runtime: Under 100 min
Pace: Slow
```

the primary result pool must satisfy all three.

Do not silently remove practical filters.

---

# 6.4 Fallback Rule

The dataset is small, so some combinations may produce fewer than three movies.

Use this behavior.

### Case A: 3 or more exact matches

Show three exact matches.

### Case B: 1 or 2 exact matches and a situation is selected

Keep:

* mood
* genre
* runtime
* language
* pace
* emotional weight

Relax only the **situation** constraint.

Fill the remaining recommendation slots using movies that match:

```text
mood + practical filters
```

Clearly tell the user that fallback results were added.

Example:

```text
Only 1 movie matched everything, so we added 2 more that fit your mood and filters.
```

Do not pretend fallback movies match the selected situation.

### Case C: fewer than 3 matches even after relaxing situation

Show only the available movies.

Do not silently remove practical filters.

Show a useful message such as:

```text
Only 2 movies match these preferences.
Try removing a filter to see more.
```

### Case D: zero matches

Show an empty state.

Example:

```text
No movies match all of these preferences.

Try removing one filter.
```

Provide an obvious way to clear filters.

---

# 7. “Another Three” Behavior

“Another three” must operate on the current eligible result pool.

It must respect:

* selected mood
* selected situation when applicable
* all practical filters
* fallback behavior

Do not show movies outside the current eligible pool.

Avoid repeating movies until the user has seen all available matches.

A simple deterministic cycling implementation is acceptable.

For example:

```text
matches 0–2
matches 3–5
matches 6–8
```

Then cycle back to the beginning.

Randomization is optional.

Do not overengineer this.

Behavior:

* if 1–3 eligible movies exist, hide or disable “Another three”
* if more than 3 exist, allow cycling
* changing mood, situation, or filters should reset the current recommendation offset

---

# 8. Proposed Application State

Keep state simple.

A reasonable structure is:

```ts
const [selectedMood, setSelectedMood] = useState<Mood | null>(null)

const [selectedSituation, setSelectedSituation] =
  useState<ViewingSituation | null>(null)

const [filters, setFilters] = useState<Filters>(initialFilters)

const [recommendationOffset, setRecommendationOffset] =
  useState(0)

const [view, setView] =
  useState<"recommendations" | "favorites">("recommendations")
```

Suggested filter type:

```ts
type Filters = {
  genres: string[]
  runtime: RuntimeFilter | null
  language: string | null
  pace: Pace | null
  emotionalWeight: EmotionalWeight | null
}
```

Normal React state is sufficient.

Do not introduce global state management.

---

# 9. Filtering Architecture

Do not place all filtering logic inside `App.tsx`.

Create a pure utility.

Suggested file:

```text
src/utils/filterMovies.ts
```

Suggested responsibility:

```ts
filterMovies(
  movies,
  selectedMood,
  selectedSituation,
  filters
)
```

The function should be deterministic and easy to test.

If fallback behavior makes a single function too complicated, split into small pure functions such as:

```ts
getExactMatches(...)
getFallbackMatches(...)
getRecommendationPool(...)
```

Prefer readable code over clever code.

---

# 10. Suggested V2 File Structure

Aim for approximately:

```text
src/
  components/
    CategorySelector.tsx
    SituationSelector.tsx
    FilterPanel.tsx
    Header.tsx
    Footer.tsx
    MovieCard.tsx
    MovieDetails.tsx
    MovieGrid.tsx

  data/
    movies.ts

  hooks/
    useFavorites.ts

  utils/
    filterMovies.ts

  types/
    movie.ts

  App.tsx
  styles.css
```

Do not create many tiny files without a clear purpose.

Do not restructure the entire repository merely to match this suggested layout.

Preserve good existing code.

---

# 11. Data Curation Rules

The V2 dataset must remain human-curated.

For each existing movie, manually add:

* stable ID
* runtime
* languages
* situations
* pace
* emotional weight
* curiosity hook
* vibe summary

Use consistent tagging.

## Stable IDs

Recommended pattern:

```text
lowercase-title-year
```

Examples:

```text
parasite-2019
perfect-days-2023
before-sunrise-1995
```

IDs must remain stable after release.

---

# 12. Writing Style for Movie Metadata

## curiosityHook

Purpose:

Make the user curious without summarizing the whole movie.

Length:

Approximately one short sentence.

Good example:

```text
A lonely Tokyo routine gradually becomes a meditation on what makes an ordinary life meaningful.
```

Avoid:

* reviews
* ratings
* spoilers
* marketing language
* generic praise such as “a masterpiece”

---

## vibeSummary

Purpose:

Give quick comparative guidance.

Keep it brief.

Examples:

```text
Slow, warm, and more comforting than dramatic.
```

```text
Fast, tense, and emotionally heavier than it first appears.
```

```text
Playful and romantic without becoming too sentimental.
```

Prefer natural language.

Do not create numerical scores.

---

# 13. Family Movie Night Rule

Treat the `family` situation conservatively.

Do not infer official age ratings.

Only tag a movie as:

```ts
"family"
```

when it is reasonably appropriate for a broad family movie-night context.

This field is not a replacement for an official content-rating system.

Do not display claims such as:

```text
Safe for children
```

unless manually verified and explicitly supported.

Prefer the UI wording:

```text
Family movie night
```

rather than:

```text
Kid safe
```

or:

```text
Suitable for all ages
```

---

# 14. Implementation Sequence

Implement V2 in small phases.

Do not make one giant rewrite.

Each phase should keep the project buildable.

---

## Phase 0 — Preserve V1

Before changing application code:

1. Check repository status.
2. Ensure V1 is committed.
3. Complete any remaining documentation-only V1 updates if still needed.
4. Do not mix unrelated V1 cleanup with V2 implementation.

Optional:

Create or preserve a clean V1 checkpoint/tag if appropriate.

Do not modify the deployment architecture.

---

## Phase 1 — Data Model

Update TypeScript types first.

Add:

* `id`
* `runtimeMinutes`
* `languages`
* `situations`
* `pace`
* `emotionalWeight`
* `curiosityHook`
* `vibeSummary`

Update every movie in the local dataset.

Goal:

```text
pnpm run build
```

must pass before continuing.

Do not change the UI significantly during this phase.

---

## Phase 2 — Richer Movie Card

Update the existing `MovieCard`.

Add useful compact metadata.

Do not implement filters yet.

The goal is to confirm that the enriched dataset improves browsing.

Keep the card readable.

Do not display every movie field simultaneously.

---

## Phase 3 — Movie Details

Add a simple movie detail interaction.

Use:

* expandable card

or:

* basic accessible modal

Prefer whichever requires less complexity within the current application.

Do not add routing.

---

## Phase 4 — Viewing Situation

Create:

```text
SituationSelector.tsx
```

Add optional situation state.

Ensure:

* mood still works alone
* No preference works
* changing mood resets recommendation pagination
* changing situation resets recommendation pagination

Do not add practical filters yet.

---

## Phase 5 — Filter Utility

Create the pure filtering logic before building the full filter UI.

Implement:

* genre
* runtime
* language
* pace
* emotional weight

Implement exact-match and fallback behavior.

Keep the filtering logic independent of JSX.

---

## Phase 6 — Filter UI

Create:

```text
FilterPanel.tsx
```

Requirements:

* genre supports multiple selections
* runtime is single-select
* language is single-select
* pace is single-select
* emotional weight is single-select
* clear filters control
* active filters should be visually obvious

Filters should appear after recommendations are already accessible.

Do not make the user complete filters before seeing movies.

Mobile layout must remain usable.

---

## Phase 7 — Recommendation Cycling

Update “Another three”.

Make it operate on the filtered eligible pool.

Requirements:

* reset offset when preferences change
* no duplicate movie inside a three-movie set
* avoid repeats until all eligible movies have been shown
* hide or disable when there are no additional matches

---

## Phase 8 — Favorites

Create:

```text
useFavorites.ts
```

Add favorite buttons.

Persist movie IDs in `localStorage`.

Test reload behavior.

Handle malformed saved data safely.

---

## Phase 9 — My List

Add a My List view.

Reuse:

* `MovieGrid`
* `MovieCard`

Do not duplicate recommendation components unnecessarily.

Include:

* saved count
* empty state
* remove favorite
* return-to-recommendations action

---

## Phase 10 — UX Polish

Only after functionality works:

* improve spacing
* improve mobile filter layout
* improve active-state styling
* improve empty states
* add result count
* improve responsive behavior
* refine hover/focus states
* refine movie details interaction

Avoid excessive animation.

Preserve the dark cinematic visual identity.

---

## Phase 11 — Documentation

Update:

```text
README.md
LEARNING_NOTES.md
```

Document:

* V2 architecture
* new movie fields
* filtering flow
* fallback behavior
* favorites and localStorage
* how to add a movie
* how to tag situations
* how to add future filters
* how GitHub Pages deployment continues to work

---

# 15. UX Flow

The intended primary user flow is:

```text
Landing
  ↓
Choose mood
  ↓
Recommendations appear
  ↓
Optionally choose viewing situation
  ↓
Optionally refine using filters
  ↓
View three recommendations
  ↓
Another three
  ↓
Open more details
  ↓
Save interesting movie
  ↓
My List
```

Do not create a long questionnaire.

Recommendations should appear as soon as mood is selected.

---

# 16. Main Screen States

## Initial State

Display:

```text
What should I watch tonight?
```

and the six mood options.

No recommendation cards are required before a mood is selected.

---

## Recommendation State

After mood selection, show:

* selected mood
* optional situation selector
* result count if useful
* three recommendations
* Another three when applicable
* filters
* My List access

A possible heading:

```text
Relaxing movies for tonight
```

If a situation is selected:

```text
Relaxing movies for a quiet night alone
```

Keep wording natural.

---

## Filtered State

When filters are active:

* keep current mood visible
* keep active filters understandable
* show clear-filter control
* update result count
* reset recommendation offset

---

## Fallback State

When situation was relaxed:

show a short explanatory message.

Do not hide the fallback.

---

## Empty State

If there are zero matches:

display:

* clear explanation
* Clear filters control
* no broken empty grid

---

## My List State

Display saved movies.

If no movies are saved:

display a friendly empty state.

---

# 17. Accessibility Requirements

Keep accessibility simple but intentional.

At minimum:

* all clickable controls must be keyboard accessible
* use semantic `<button>` elements
* visible focus states
* buttons should have understandable labels
* favorite buttons should use `aria-label`
* modal, if used, must have a clear close button
* text must remain readable against the dark background
* do not communicate selected state through color alone

Avoid complicated accessibility libraries.

Use native HTML semantics first.

---

# 18. Responsive Requirements

Check:

* desktop
* tablet/narrow desktop
* phone-sized layout

On mobile:

* mood controls should wrap cleanly
* filter UI should not dominate the whole screen
* movie cards should remain readable
* buttons must remain tap-friendly
* My List must remain accessible
* detailed movie information must not overflow horizontally

Do not redesign the whole site around desktop only.

---

# 19. Testing Checklist

Before considering V2 complete, manually verify all of the following.

## Build

* `pnpm install` succeeds
* `pnpm run build` succeeds
* no TypeScript errors
* no obvious console errors

## Mood

* all six moods are selectable
* selected styling is clear
* each mood produces recommendations
* changing mood resets recommendation cycling

## Situation

* all five situations work
* No preference works
* changing situation updates results
* changing situation resets cycling

## Filters

* genre works alone
* genre multi-select works
* runtime works
* language works
* pace works
* emotional weight works
* multiple filters work together
* Clear filters works
* changing filters resets cycling

## Fallback

* exact matches are shown first
* situation relaxation happens only when needed
* practical filters remain strict
* fallback explanation appears
* fewer than three available movies display correctly
* zero-match state works

## Another Three

* only eligible movies are shown
* no duplicate movie appears in one set
* cycling works across more than three matches
* button hides/disables appropriately
* changing preferences resets cycling

## Movie Details

* details open correctly
* details close correctly
* all displayed metadata corresponds to the selected movie
* layout remains usable on mobile

## Favorites

* favorite saves
* favorite removes
* state updates immediately
* reload preserves favorites
* malformed localStorage data does not crash the app

## My List

* saved movies appear
* unsaved movies do not appear
* removing favorite updates the list
* empty state works
* return to recommendations works

## Deployment

* GitHub Actions passes
* GitHub Pages still loads correctly
* assets resolve correctly under the repository subpath
* no regression to the existing Vite base-path configuration

---

# 20. Beginner-Friendly Coding Rules

When implementing:

* prefer readable code over abstraction
* add comments only where they explain non-obvious behavior
* avoid generic utility frameworks
* avoid premature abstractions
* do not create design systems
* do not create a complex reducer unless ordinary state becomes clearly insufficient
* keep TypeScript types explicit
* keep components focused
* use pure helper functions for filtering
* preserve existing naming where reasonable
* reuse components before creating duplicates

If there are multiple valid implementations, choose the one that is easiest for a beginner to understand.

---

# 21. Git / Change Management

Implement in small logical commits.

Suggested commit progression:

```text
Add V2 movie metadata and types
Enrich movie recommendation cards
Add movie details view
Add viewing situation selector
Add movie filtering logic
Add filter controls
Update recommendation cycling
Add browser-local favorites
Add My List view
Polish V2 responsive UI
Document Movie Mood V2
```

Do not combine all V2 work into one commit.

Do not rewrite unrelated working files.

Do not alter the deployment workflow unless there is a real deployment problem.

---

# 22. Features Explicitly Postponed

Do not implement these in V2.

Possible V2.1:

* Cozy mood
* Curious mood
* release-era filter
* familiar versus adventurous
* Dinner in the background
* Short break
* Discovery
* additional data curation
* improved filter presets

Possible V3:

* larger movie library
* advanced recommendation scoring
* personalized preference weighting
* movie-to-movie similarity
* search
* sorting
* shareable URLs
* dedicated movie routes
* richer image/poster strategy
* external movie data
* account-based persistence

---

# 23. Definition of Done

V2 is complete when:

1. The six existing moods still work.
2. Users can optionally choose one of five viewing situations.
3. Users can optionally filter by genre, runtime, language, pace, and emotional weight.
4. Each movie contains richer decision-support metadata.
5. Movie cards expose useful V2 metadata without becoming overloaded.
6. Users can inspect additional movie details.
7. Recommendation fallback behavior is clear and predictable.
8. “Another three” respects all active preferences.
9. Users can save and remove favorites.
10. Favorites persist through browser reloads using `localStorage`.
11. My List displays saved movies.
12. The application remains entirely static.
13. The project still builds successfully.
14. GitHub Pages deployment still succeeds.
15. README and learning notes explain the new architecture.
16. No postponed V2.1/V3 features are accidentally introduced.

---

# 24. Codex Working Instruction

Implement this specification incrementally.

Before changing code:

1. inspect the existing repository
2. understand the current V1 component structure
3. preserve working behavior wherever possible
4. identify the smallest set of files required for the current phase

For every phase:

1. make only the changes required for that phase
2. run the appropriate build/checks
3. fix errors before proceeding
4. summarize what changed
5. keep the code beginner-readable

Do not redesign the project from scratch.

Do not introduce additional dependencies unless absolutely necessary.

If an implementation detail is ambiguous, prefer the simplest solution that satisfies this specification and preserves the existing architecture.
