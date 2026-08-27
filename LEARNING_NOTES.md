# Movie Mood learning notes

This is a small React and TypeScript app. The main pieces fit together like this:

```text
index.html → src/main.tsx → src/App.tsx
```

## How the app starts

- `index.html` is the browser entry point. It provides the `<div id="root">` container and loads `src/main.tsx`.
- `src/main.tsx` creates a React root, imports the global CSS, and renders `<App />` inside React `StrictMode`.
- `src/App.tsx` owns the page flow and state. It renders the header, mood selector, recommendation grid, and footer.

## How mood selection works

`src/components/CategorySelector.tsx` defines the six available moods and renders one button for each. When a button is clicked, it calls the `onSelect` function supplied by `App`.

`App` stores the selected mood in `selectedMood`. Mood is still the required starting point: choosing a mood is enough to show recommendations.

After a mood is selected, the app also lets the user choose an optional viewing situation, optional V3 discovery preferences, and optional practical filters. `App` passes the selected mood, situation, and practical filters into `filterMovies` from `src/utils/filterMovies.ts`. It then passes that V2-eligible pool through V3 discovery logic in `src/utils/discovery.ts`.

The **Another three** button advances the recommendation offset by three. It uses the current eligible recommendation pool, avoids repeating movies before the pool is exhausted, and hides when there are not more than three eligible movies.

Changing the mood, situation, filters, attention preference, discovery preference, or dealbreakers resets the recommendation offset to the beginning.

V4 adds **Help me choose** when a normal three-movie slate is visible. This opens Decision Mode for the current three movies without changing the recommendation pool.

## How viewing situations work

`src/components/SituationSelector.tsx` renders the optional situation buttons. The available situations are:

- Quiet night alone
- Date night
- With friends
- Family movie night
- Don’t want to think too hard
- No preference

Choosing **No preference** clears the situation by passing `null` back to `App`.

## How filters work

`src/components/FilterPanel.tsx` renders the practical filters:

- genre, which supports multiple selections
- runtime, which is single-select
- language, which is single-select
- pace, which is single-select
- emotional weight, which is single-select

Genre and language options are generated from the resolved movie dataset in `src/data/movies.ts`, so adding a new movie can automatically expand those lists.

The filter panel only renders controls and sends updated `MovieFilters` back to `App`. The filtering rules live in `src/utils/filterMovies.ts`, which keeps the logic easier to test and understand.

Runtime filters are interpreted as:

- `short`: under 100 minutes
- `medium`: 100 to 130 minutes
- `long`: over 130 minutes

## How V3 discovery preferences work

`src/components/DiscoveryPreferencesPanel.tsx` renders the optional V3 controls:

- attention demand: take it easy, keep me engaged, or full immersion
- discovery style: keep it familiar, something different, or surprise me
- dealbreakers: nothing emotionally heavy, no slow burn, and keep it under 2 hours

These controls are optional. A user can still choose only a mood and immediately get three recommendations.

The rules live in `src/utils/discovery.ts`:

- `applyDealbreakers` removes movies that cross active “Not tonight” boundaries.
- `rankByExperiencePreferences` moves attention/style matches earlier without removing non-matches.
- `getDiscoveryPool` keeps exact situation matches ahead of fallback matches, then applies V3 ordering.
- `getSimilarMovies` finds related movies using local metadata only.

Dealbreakers are strict. Soft experience preferences affect ordering, not eligibility.

## How fallback recommendations work

The dataset is intentionally small, so some mood, situation, and filter combinations may not produce three exact matches.

`filterMovies` keeps mood and practical filters strict. If a situation is selected and fewer than three exact matches exist, it relaxes only the situation and adds movies that still match the mood and practical filters.

The utility returns:

- `exactMatches`
- `fallbackMatches`
- `recommendationPool`
- `usedSituationFallback`

`App` uses that return value to show recommendations and display a short fallback note when needed.

V3 discovery runs after this fallback step, so practical V2 matching stays separate from human experience preferences.

## Where movie data lives

The app imports recommendations from `src/data/movies.ts`, but V5 builds that array by merging two sources:

- `src/data/curatedMovies.ts` for Movie Mood meaning and editorial choices
- `src/data/generated/tmdbMovies.json` for factual TMDB metadata

Movie fields include:

- stable `id`
- `tmdbId`
- TMDB `title`, `year`, and `director`
- TMDB `countries`, `spokenLanguages`, `genres`, `runtimeMinutes`, and `posterPath`
- curated `filterLanguages`, exposed as `languages` for the existing practical language filter
- `moods` and `situations`
- `pace` and `emotionalWeight`
- `attentionDemand` and `discoveryStyle`
- `description`, `whyWatch`, `curiosityHook`, and `vibeSummary`
- `palette`

## How `MovieCard` displays one recommendation

`src/components/MovieCard.tsx` receives one resolved `Movie` object and its position in the list. It uses `src/components/MoviePoster.tsx` to show a real TMDB poster when `posterPath` is available.

If a movie has no poster path, or if the TMDB image CDN fails to load the image, `MoviePoster` falls back to the CSS-generated title poster built from the movie’s title, year, symbol, and `palette` colors.

The compact card shows the most useful quick-pick details, including runtime, countries, curated viewing languages, pace, emotional weight, curiosity hook, vibe summary, and `whyWatch`.

The **More like this** button switches the recommendations area into a related-film mode seeded by that movie. The **More details** button expands an inline details section rendered by `src/components/MovieDetails.tsx`. This keeps the compact card readable while still making the full metadata available.

`MovieGrid` maps the selected movies into `MovieCard` components. The same grid and card components are reused for recommendations, similar results, and My List.

## How “More like this” works

`App` stores the active similar-movie seed in `similarToMovieId`. When this value is set, normal discovery controls are hidden and the results heading changes to `More like [Movie Title]`.

`getSimilarMovies` compares the seed movie with the local curated dataset using shared moods, genres, pace, emotional weight, attention demand, discovery style, and viewing situations. It excludes the seed movie, returns up to three movies, and uses dataset order as the final tie-breaker.

A similar result can become the next seed by clicking **More like this** again. **Back to recommendations** clears `similarToMovieId` and returns to the ordinary mood-first flow.

## How V4 Decision Mode works

`src/App.tsx` stores the active V4 decision state in `decisionState`. The state can be:

- `three-slate`, with the three current movie IDs
- `duel`, with two finalist movie IDs and optional source-slate context
- `pick`, with the chosen movie ID and enough context for **Change my mind**

`src/components/DecisionMode.tsx` renders the decision screens:

- three cards with concise relative cues
- a two-finalist duel
- a coin-flip gut check for the two finalists
- a final Tonight’s Pick ticket

The comparison rules live in `src/utils/decision.ts`. They use existing movie metadata only. Active attention, emotional, discovery, pace, and runtime preferences can influence which differences are shown first, but the app does not create a numerical recommendation score.

Changing the mood, situation, filters, discovery preferences, current view, or recommendation slate exits Decision Mode. This keeps the decision state tied to the context that produced it.

## How V4 URLs and sharing work

`src/utils/urlCodec.ts` turns a V4 decision state into a query string and decodes it back on page load.

A valid V4 decision URL can restore:

- the selected mood
- the optional situation
- practical filters
- discovery preferences and dealbreakers
- the three-slate, duel, or Tonight’s Pick state

The decoder validates URL-controlled values before using them. Unknown mood values, invalid filter values, and stale movie IDs degrade safely instead of being trusted.

While Decision Mode is active, `App` keeps the URL synchronized with the current V4 state using `history.replaceState`. Returning to normal browsing clears the V4 decision query.

The Tonight’s Pick ticket has a share button. It uses the browser’s native share sheet when available. If not, it copies the current V4 URL to the clipboard and announces the result with an accessible status message.

## How V5 TMDB data works

Movie Mood owns the meaning layer: moods, situations, curated viewing/filter languages, attention demand, discovery style, editorial copy, and fallback poster colors.

TMDB owns factual metadata: title, year, director, countries, spoken languages, genres, runtime, and poster path. The browser does not call the TMDB data API during normal use, tests, builds, or GitHub Pages deployment.

Maintainers refresh the committed snapshot with:

```bash
TMDB_READ_ACCESS_TOKEN=your_token pnpm sync:tmdb
```

The command fetches exact mapped TMDB IDs, validates the complete snapshot, writes atomically, and reports behavior-impacting runtime and genre changes for review. The token is read from the process environment only and must not be committed.

Movie Mood uses TMDB poster images from the image CDN when they load successfully. The app remains usable if those images are unavailable because `MoviePoster` falls back to the local CSS title-poster treatment.

## How favorites and My List work

`src/hooks/useFavorites.ts` manages favorite movie IDs in browser `localStorage` using the key `movieMoodFavorites`.

It stores only movie IDs, not full movie objects. This keeps saved data small and stable:

```json
["parasite", "perfect-days"]
```

The hook safely handles missing data, malformed JSON, non-array values, duplicate IDs, and storage write failures.

Each `MovieCard` has a heart button. Clicking it toggles that movie ID in the saved list. `App` uses the saved IDs to build `favoriteMovies`, and the My List view displays those movies using the same `MovieGrid` and `MovieCard` components. Favorites continue to work from normal recommendations and similar-results mode.

## How GitHub Pages deployment works

The workflow in `.github/workflows/deploy.yml` runs when changes are pushed to `main` or when it is started manually:

1. GitHub checks out the repository.
2. The workflow sets up pnpm 11 and Node 24.
3. It installs the locked dependencies and runs the Vite build.
4. It uploads the `dist` folder as a Pages artifact.
5. A second job deploys that artifact to GitHub Pages.

The repository’s Pages source must be set to **GitHub Actions** in **Settings → Pages**. Vite uses a relative asset base so the built files work at the project URL.

## How to add a new movie

1. Open `src/data/curatedMovies.ts`.
2. Add another object to the `curatedMovies` array with Movie Mood-owned fields.
3. Give it a unique, stable `id`. Do not change existing IDs after release because favorites are saved by ID.
4. Add a manually verified `tmdbId`.
5. Add one or more valid mood IDs to `moods`.
6. Add suitable situation tags to `situations`. Use `family` conservatively; it means a broad family movie-night fit, not an official content rating.
7. Add curated `filterLanguages`, pace, emotional weight, curiosity hook, vibe summary, and two CSS color values for the `palette` tuple.
8. Add the same local ID and TMDB ID to `src/data/tmdbMovieMappings.json`.
9. Run `TMDB_READ_ACCESS_TOKEN=your_token pnpm sync:tmdb`.
10. Run `pnpm test` and `pnpm build` to check the change.

## How to add a future filter

1. Add or update the TypeScript type in `src/types/movie.ts`.
2. Update `MovieFilters` if the filter should be part of recommendation matching.
3. Add the matching rule to `src/utils/filterMovies.ts`.
4. Add the UI control to `src/components/FilterPanel.tsx`.
5. Reset the recommendation offset when the filter changes.
6. Run `pnpm run build`.

## How to add a new mood

New moods are postponed beyond V2, but the code path is:

1. Add the new mood ID to the `Mood` union in `src/types/movie.ts`.
2. Add its label, icon, and short note to the `moods` array in `src/components/CategorySelector.tsx`.
3. Add that mood ID to the `moods` array of any matching movies in `src/data/curatedMovies.ts`.
4. Run `pnpm run build` and try the new button locally.

## How V5.1 curation and Tonight's Action work

### The Curation Assistant

`pnpm curate:add "<movie title>"` is a maintainer-only helper that searches TMDB and writes a curation draft to `docs/curation-drafts/`. It never auto-selects a candidate — you choose one — and it never fills in editorial meaning, so taste stays human-authored.

1. Run `pnpm curate:add "Perfect Blue"`.
2. Review the TMDB candidate matches printed in the terminal.
3. Enter the number of the matching movie, or leave empty to cancel.
4. The assistant writes `docs/curation-drafts/<movie-id>.md` with all `CuratedMovie` fields as `TODO` placeholders plus the factual TMDB director for reference.
5. Fill in Movie Mood meaning, add the entry to `src/data/curatedMovies.ts`, and add the mapping to `src/data/tmdbMovieMappings.json`.
6. Run `TMDB_READ_ACCESS_TOKEN=your_token pnpm sync:tmdb` to refresh generated facts.
7. Run `pnpm test` and `pnpm build`.

The `TMDB_READ_ACCESS_TOKEN` is read from the process environment only and is never printed, committed, or exposed to the browser. Normal build, test, and dev do not require a token.

### Tonight's Action

After Tonight's Pick (and in Movie Details), Movie Mood offers **Find where to watch**. This links to a general web search, the TMDB web page, Letterboxd, and JustWatch — all generated by centralized helpers in `src/utils/watchLinks.ts`. These are external lookups, not verified streaming availability.
