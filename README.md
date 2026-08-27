# Movie Mood

A small, cinematic movie-discovery site for the question: **what should I watch tonight?** Choose a feeling and Movie Mood gives you three carefully selected films, along with practical details, human discovery preferences, clear “not tonight” boundaries, related-film exploration, a save-for-later list, and a lightweight decision flow for landing on tonight’s pick.

## Live demo

Try the [live demo](https://soph1azhao.github.io/movie-mood/).

## Screenshot

Run the site locally and add a screenshot here whenever you’re ready.

## Features

- Six mood-first ways to browse: funny, exciting, thought-provoking, relaxing, emotional, and suspenseful.
- Optional viewing situations, including quiet solo watches, date night, friends, family movie night, and easy-watch picks.
- Optional V3 discovery controls for attention demand, comfort-zone distance, and strict “Not tonight” boundaries.
- Practical filters for genre, runtime, language, pace, and emotional weight.
- Three focused recommendations at a time, with “Another three” cycling through the current eligible pool.
- V4 Decision Mode with three-film comparison cues, two-finalist duels, a coin-flip gut check, and a final Tonight’s Pick ticket.
- Shareable V4 decision URLs that can restore the active preference context, Decision Mode slate, duel, or Tonight’s Pick.
- “More like this” mode for exploring up to three related films from the local curated dataset.
- Expandable movie details with runtime, countries, viewing languages, TMDB spoken languages, moods, situations, pace, emotional weight, attention demand, discovery style, and recommendation notes.
- Browser-local favorites stored as movie IDs in `localStorage`, plus a reusable My List view.
- A local, TypeScript-typed curated layer for 36 films, resolved with a committed TMDB factual snapshot.
- Responsive, keyboard-friendly single-page interface with an intentional initial state.
- Real TMDB poster images where available, with CSS-generated Movie Mood title posters as the fallback.

Note: normal app usage, tests, builds, and GitHub Pages deployment do not require a TMDB token. Poster images are loaded from TMDB's image CDN when available.

## Implementation Specs

The V2 implementation plan is documented in [docs/V2_IMPLEMENTATION_SPEC.md](docs/V2_IMPLEMENTATION_SPEC.md).

The V3 implementation plan is documented in [docs/V3_IMPLEMENTATION_SPEC.md](docs/V3_IMPLEMENTATION_SPEC.md).

The V4 implementation plan is documented in [docs/V4_IMPLEMENTATION_SPEC.md](docs/V4_IMPLEMENTATION_SPEC.md).

The V5 implementation plan is documented in [docs/V5_IMPLEMENTATION_SPEC.md](docs/V5_IMPLEMENTATION_SPEC.md).

## Tech stack

- React
- TypeScript
- Vite
- Plain CSS
- GitHub Pages + GitHub Actions

## Run locally

```bash
git clone https://github.com/soph1azhao/movie-mood.git
cd movie-mood
pnpm install
pnpm dev
```

Vite will print a local URL, normally `http://localhost:5173`.

The repository uses pnpm in CI and includes a pnpm lockfile.

## Build

```bash
pnpm build
pnpm preview
```

## Test

```bash
pnpm test
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes the site whenever changes are pushed to `main`.

1. Push this repository to GitHub.
2. Open **Settings → Pages** in the GitHub repository.
3. Under **Build and deployment**, set the source to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the Actions tab).

Vite is configured with a relative asset base, so the built site works at either a repository URL such as `/movie-mood/` or a custom project path.

## Project structure

```text
src/
├── components/    # Small visual building blocks
├── data/          # Curated movie meaning plus generated TMDB facts
├── hooks/         # Browser-local favorites state
├── types/         # Shared TypeScript types
├── utils/         # Pure filtering, discovery, decision, URL, and cycling helpers
├── App.tsx        # Page state and recommendation selection
└── styles.css     # The responsive visual system
.github/workflows/ # GitHub Pages deployment
```

## V3 Architecture Notes

- `src/App.tsx` owns page state: selected mood, optional situation, practical filters, V3 discovery preferences, recommendation offset, current view, and optional similar-movie seed.
- `src/utils/filterMovies.ts` preserves V2 matching and situation fallback behavior.
- `src/utils/discovery.ts` applies V3 dealbreakers, soft experience ordering, discovery-pool composition, and deterministic similar-movie matching.
- `src/utils/picks.ts` handles three-card slate selection and wraps the final cycle without duplicating a movie within one slate.
- `src/components/DiscoveryPreferencesPanel.tsx` renders the optional V3 controls; it does not contain matching logic.
- `src/components/FilterPanel.tsx` renders controls only; it does not duplicate filtering rules.
- `src/hooks/useFavorites.ts` stores only favorite movie IDs under `movieMoodFavorites`.
- `src/components/MovieGrid.tsx` and `src/components/MovieCard.tsx` are reused for recommendations, similar results, and My List.

## V4 Architecture Notes

- `src/App.tsx` owns the active `DecisionState` and resets it whenever upstream mood, situation, filter, discovery preference, view, or slate offset changes.
- `src/components/DecisionMode.tsx` renders the three-slate comparison, duel, coin gut check, and Tonight’s Pick ticket.
- `src/utils/decision.ts` keeps decision cues deterministic and context-aware without adding a numerical recommendation score.
- `src/utils/urlCodec.ts` serializes V4 decision URLs and validates decoded mood, situation, filters, discovery preferences, and movie IDs against the local dataset.
- While Decision Mode is active, `App` keeps the browser URL synchronized with the current decision state. Valid V4 URLs restore the preference context and decision phase on load; malformed or stale URLs fall back to the normal start state.
- Tonight’s Pick uses the native Web Share API when available and copies the share URL to the clipboard as a fallback.

## V5 Architecture Notes

- `src/data/curatedMovies.ts` owns Movie Mood meaning: local IDs, moods, situations, viewing/filter languages, experience fields, editorial copy, and fallback poster palettes.
- `src/data/generated/tmdbMovies.json` is the committed TMDB factual snapshot: title, year, director, countries, spoken languages, genres, runtime, and poster path.
- `src/data/movies.ts` resolves those layers into the existing `Movie[]` import surface so app components keep using stable Movie Mood IDs.
- `src/components/MoviePoster.tsx` centralizes TMDB poster URL usage and falls back to the CSS title poster when `posterPath` is missing or the image fails to load.
- Runtime TMDB data API calls are not made by the browser. The browser may load poster images from TMDB's image CDN.
- This product uses the TMDB API but is not endorsed or certified by TMDB.

## TMDB Snapshot Maintenance

`pnpm sync:tmdb` is a maintainer-only command that refreshes the committed TMDB snapshot from exact mapped TMDB IDs.

```bash
TMDB_READ_ACCESS_TOKEN=your_token pnpm sync:tmdb
```

The token is read only from the process environment. It must not be committed, exposed through `import.meta.env`, or added to GitHub Pages deployment.

The sync command validates the complete snapshot before replacing it. Missing tokens, hard API/data failures, exhausted transient retries, duplicate mappings, and one-to-one merge failures stop the command without partially updating the snapshot. Behavior-impacting runtime and genre changes are reported for review.

## Adding Movies and Filters

To add a movie, update `src/data/curatedMovies.ts` with Movie Mood-owned fields, including `id`, `tmdbId`, `filterLanguages`, `situations`, `pace`, `emotionalWeight`, `attentionDemand`, `discoveryStyle`, `curiosityHook`, `vibeSummary`, and `palette`. Then add the exact TMDB mapping and run `pnpm sync:tmdb` with `TMDB_READ_ACCESS_TOKEN` available so generated factual data is refreshed. Keep IDs stable because favorites are stored by ID.

Situation tags are curated manually. Use `family` conservatively for broad family movie-night picks, and do not treat it as an official age rating.

Future filters should be added first to the shared types, then to the pure filtering utility, and only after that to the UI. Keep practical filters strict unless the V2 spec explicitly changes the fallback rule.

V3 experience labels are editorial categories, not scores. Keep `attentionDemand` and `discoveryStyle` categorical and avoid adding numerical recommendation percentages or hidden taste-profile data.

## Learning notes

See [LEARNING_NOTES.md](LEARNING_NOTES.md) for a beginner-friendly guide to the app and its deployment.
