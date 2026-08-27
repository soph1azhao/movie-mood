# Movie Mood

A small, cinematic movie-discovery site for the question: **what should I watch tonight?** Choose a feeling and Movie Mood gives you three carefully selected films, along with practical details, human discovery preferences, clear “not tonight” boundaries, related-film exploration, and a save-for-later list.

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
- “More like this” mode for exploring up to three related films from the local curated dataset.
- Expandable movie details with runtime, countries, languages, moods, situations, pace, emotional weight, attention demand, discovery style, and recommendation notes.
- Browser-local favorites stored as movie IDs in `localStorage`, plus a reusable My List view.
- A local, TypeScript-typed collection of 36 films spanning decades, countries, directors, genres, and curated V3 metadata.
- Responsive, keyboard-friendly single-page interface with an intentional initial state.
- Custom title posters created in CSS, so there are no fragile external image links or API keys.

Note: posters are CSS-generated title posters, not official movie posters.

## Implementation Specs

The V2 implementation plan is documented in [docs/V2_IMPLEMENTATION_SPEC.md](docs/V2_IMPLEMENTATION_SPEC.md).

The V3 implementation plan is documented in [docs/V3_IMPLEMENTATION_SPEC.md](docs/V3_IMPLEMENTATION_SPEC.md).

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
├── data/movies.ts # Local movie collection and metadata
├── hooks/         # Browser-local favorites state
├── types/         # Shared TypeScript types
├── utils/         # Pure filtering, discovery, similarity, and cycling helpers
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

## Adding Movies and Filters

To add a movie, update `src/data/movies.ts` with every field required by `Movie` in `src/types/movie.ts`, including `runtimeMinutes`, `languages`, `situations`, `pace`, `emotionalWeight`, `attentionDemand`, `discoveryStyle`, `curiosityHook`, and `vibeSummary`. Keep IDs stable because favorites are stored by ID.

Situation tags are curated manually. Use `family` conservatively for broad family movie-night picks, and do not treat it as an official age rating.

Future filters should be added first to the shared types, then to the pure filtering utility, and only after that to the UI. Keep practical filters strict unless the V2 spec explicitly changes the fallback rule.

V3 experience labels are editorial categories, not scores. Keep `attentionDemand` and `discoveryStyle` categorical and avoid adding numerical recommendation percentages or hidden taste-profile data.

## Learning notes

See [LEARNING_NOTES.md](LEARNING_NOTES.md) for a beginner-friendly guide to the app and its deployment.
