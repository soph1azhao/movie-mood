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
- V6 Decision Mode with an adaptive one-question companion when the current three-film slate supports a useful distinction, plus silent manual drop when it does not.
- Shareable V6 decision URLs that can restore the active preference context, Decision Mode slate, manual drop, adaptive answer, duel, or Tonight’s Pick.
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

The V6 Adaptive Decision Companion scope is documented in [docs/V6_ADAPTIVE_DECISION_COMPANION_SPEC.md](docs/V6_ADAPTIVE_DECISION_COMPANION_SPEC.md).

The phase-by-phase Codex implementation prompt is documented in [docs/V6_CODEX_IMPLEMENTATION_PROMPT.md](docs/V6_CODEX_IMPLEMENTATION_PROMPT.md).

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

## V6 Architecture Notes

- `src/utils/decision.ts` now derives one adaptive Help Me Choose question from clean 2:1 splits across attention demand, pace, emotional weight, and runtime category.
- Context-redundant dimensions are removed before the explicit priority tiebreaker is used; no numerical score or hidden taste profile is introduced.
- `src/components/DecisionMode.tsx` renders the adaptive companion only inside the three-film Help Me Choose state. No-question contexts stay silent and keep the manual drop path.
- `src/utils/urlCodec.ts` emits V6 decision URLs for new decisions while preserving V4 URL decoding for older shared links.

## V5 Architecture Notes

- `src/data/curatedMovies.ts` owns Movie Mood meaning: local IDs, moods, situations, viewing/filter languages, experience fields, editorial copy, and fallback poster palettes.
- `src/data/generated/tmdbMovies.json` is the committed TMDB factual snapshot: title, year, director, countries, spoken languages, genres, runtime, and poster path.
- `src/data/movies.ts` resolves those layers into the existing `Movie[]` import surface so app components keep using stable Movie Mood IDs.
- `src/components/MoviePoster.tsx` centralizes TMDB poster URL usage and falls back to the CSS title poster when `posterPath` is missing or the image fails to load.
- Runtime TMDB data API calls are not made by the browser. The browser may load poster images from TMDB's image CDN.
- This product uses the TMDB API but is not endorsed or certified by TMDB.

## V5.1 Architecture Notes

- `scripts/curateCore.mjs` holds the pure, testable Curation Assistant logic: local-ID suggestion, duplicate detection, candidate normalization, scaffold generation, and orchestration with injected side effects.
- `scripts/curateAdd.mjs` is the `pnpm curate:add` CLI wrapper. It performs the network search and interactive selection, then writes a curation draft to `docs/curation-drafts/`.
- The curation assistant does not decide Movie Mood editorial meaning. All taste, mood, and editorial fields are `TODO` placeholders for the maintainer to fill in.
- The curation assistant never writes to `src/data/generated/tmdbMovies.json`. `pnpm sync:tmdb` remains the only normal producer of the TMDB factual snapshot.
- `src/utils/watchLinks.ts` centralizes all external "Find where to watch" lookup URLs (general web search, TMDB web page, Letterboxd, JustWatch).
- `src/components/WatchAction.tsx` renders Tonight's Action links. It appears on the Tonight's Pick ticket and in Movie Details.
- Poster loading now reserves a 2/3 aspect ratio before images load (layout stability), fades images in on load, and keeps the CSS title-poster fallback consistent on error.

## V5.1 — Adding Movies Safely (Curation Assistant)

`pnpm curate:add "<movie title>"` helps a maintainer add a new curated movie by reducing manual TMDB lookup and schema-copying work. It searches TMDB for the given title, shows the candidate matches in the terminal, and requires an explicit maintainer selection — it never auto-selects the first result.

After a candidate is selected, the assistant writes a scaffold draft to `docs/curation-drafts/<movie-id>.md` with all `CuratedMovie` fields included as `TODO` placeholders. The maintainer then fills in Movie Mood meaning, adds the entry to `src/data/curatedMovies.ts`, adds the mapping to `src/data/tmdbMovieMappings.json`, and runs `pnpm sync:tmdb` with `TMDB_READ_ACCESS_TOKEN` available to refresh generated facts.

```bash
pnpm curate:add "Perfect Blue"
```

The command requires `TMDB_READ_ACCESS_TOKEN` only for the search step. It fails clearly and safely without modifying any project files if the token is missing, the query is empty, no candidates are found, or the selection is cancelled.

Movie Mood meaning remains human-authored. The assistant does not guess moods, situations, pace, emotional weight, attention demand, discovery style, whyWatch, curiosityHook, vibeSummary, or filterLanguages.

## V5.1 — Tonight's Action

After Tonight's Pick, Movie Mood offers a "Find where to watch" action with deterministic outbound links. These are external lookups, not verified streaming availability — the app does not claim regional availability, provider logos, or real-time status.

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
