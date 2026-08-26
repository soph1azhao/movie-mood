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

After a mood is selected, the app also lets the user choose an optional viewing situation and optional practical filters. `App` passes the selected mood, situation, and filters into `filterMovies` from `src/utils/filterMovies.ts`.

The **Another three** button advances the recommendation offset by three. It uses the current eligible recommendation pool, avoids repeating movies before the pool is exhausted, and hides when there are not more than three eligible movies.

Changing the mood, situation, or filters resets the recommendation offset to the beginning.

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

Genre and language options are generated from the local movie dataset in `src/data/movies.ts`, so adding a new movie can automatically expand those lists.

The filter panel only renders controls and sends updated `MovieFilters` back to `App`. The filtering rules live in `src/utils/filterMovies.ts`, which keeps the logic easier to test and understand.

Runtime filters are interpreted as:

- `short`: under 100 minutes
- `medium`: 100 to 130 minutes
- `long`: over 130 minutes

## How fallback recommendations work

The dataset is intentionally small, so some mood, situation, and filter combinations may not produce three exact matches.

`filterMovies` keeps mood and practical filters strict. If a situation is selected and fewer than three exact matches exist, it relaxes only the situation and adds movies that still match the mood and practical filters.

The utility returns:

- `exactMatches`
- `fallbackMatches`
- `recommendationPool`
- `usedSituationFallback`

`App` uses that return value to show recommendations and display a short fallback note when needed.

## Where movie data lives

The recommendations are in `src/data/movies.ts`. Each item follows the `Movie` type in `src/types/movie.ts`.

V2 movie fields include:

- stable `id`
- `title`, `year`, and `director`
- `countries`, `languages`, and `genres`
- `runtimeMinutes`
- `moods` and `situations`
- `pace` and `emotionalWeight`
- `description`, `whyWatch`, `curiosityHook`, and `vibeSummary`
- `palette`

## How `MovieCard` displays one recommendation

`src/components/MovieCard.tsx` receives one `Movie` object and its position in the list. It creates a CSS-generated title poster from the movie’s title, year, symbol, and `palette` colors.

The compact card shows the most useful quick-pick details, including runtime, countries, languages, pace, emotional weight, curiosity hook, vibe summary, and `whyWatch`.

The **More details** button expands an inline details section rendered by `src/components/MovieDetails.tsx`. This keeps the compact card readable while still making the full metadata available.

`MovieGrid` maps the selected movies into `MovieCard` components. The same grid and card components are reused for recommendations and My List.

## How favorites and My List work

`src/hooks/useFavorites.ts` manages favorite movie IDs in browser `localStorage` using the key `movieMoodFavorites`.

It stores only movie IDs, not full movie objects. This keeps saved data small and stable:

```json
["parasite", "perfect-days"]
```

The hook safely handles missing data, malformed JSON, non-array values, duplicate IDs, and storage write failures.

Each `MovieCard` has a heart button. Clicking it toggles that movie ID in the saved list. `App` uses the saved IDs to build `favoriteMovies`, and the My List view displays those movies using the same `MovieGrid` and `MovieCard` components.

## How GitHub Pages deployment works

The workflow in `.github/workflows/deploy.yml` runs when changes are pushed to `main` or when it is started manually:

1. GitHub checks out the repository.
2. The workflow sets up pnpm 11 and Node 24.
3. It installs the locked dependencies and runs the Vite build.
4. It uploads the `dist` folder as a Pages artifact.
5. A second job deploys that artifact to GitHub Pages.

The repository’s Pages source must be set to **GitHub Actions** in **Settings → Pages**. Vite uses a relative asset base so the built files work at the project URL.

## How to add a new movie

1. Open `src/data/movies.ts`.
2. Add another object to the `movies` array with every field required by the `Movie` type.
3. Give it a unique, stable `id`. Do not change existing IDs after release because favorites are saved by ID.
4. Add one or more valid mood IDs to `moods`.
5. Add suitable situation tags to `situations`. Use `family` conservatively; it means a broad family movie-night fit, not an official content rating.
6. Add runtime, countries, languages, genres, pace, emotional weight, curiosity hook, and vibe summary.
7. Choose two CSS color values for the `palette` tuple.
8. Run `pnpm run build` to check the change.

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
3. Add that mood ID to the `moods` array of any matching movies in `src/data/movies.ts`.
4. Run `pnpm run build` and try the new button locally.
