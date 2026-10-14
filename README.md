# Movie Mood

**Movie Mood helps you choose one.** This static movie companion turns a mood and practical viewing constraints into a small shortlist from **180 curated films**, then helps you settle on tonight’s pick. V9 adds an opt-in **For you** order: saved films in the browser-local My List create a genre-similarity profile that reorders eligible picks while preserving hard constraints and exact-situation priority.

Separately, an **offline MovieLens 100K study** implements a popularity baseline, ItemKNN collaborative filtering, and an ItemKNN–popularity hybrid. It uses a global chronological train/validation/test split, selects model settings on validation only, and evaluates the locked methods on the same warm, unseen candidates. These MovieLens models are research code; the product uses the local content-based ranking above.

[Live demo (V8.2 on `main`)](https://soph1azhao.github.io/movie-mood/) · [V9 product architecture and original benchmark](experiments/v9-ranking/README.md) · [Global-time ItemKNN results](experiments/v9-ranking/ITEMKNN_RESULTS.md) · [Project history](docs/PROJECT_RETROSPECTIVE.md)

## Recommendation architecture

```text
PRODUCT · 180 curated films
Mood → hard filters + situation priority + dealbreakers → eligible pool
     → discovery order → optional local "For you" genre ranking → three picks → choose one

OFFLINE STUDY · MovieLens 100K (separate from the product)
Global time split → train positive interactions → popularity / ItemKNN / hybrid
                  → validation-only selection → locked test on shared candidates
```

## Offline benchmark: locked test results

| Method | Recall@10 | NDCG@10 | Coverage@10 |
| --- | ---: | ---: | ---: |
| Popularity | **0.111058** | **0.150902** | 0.046683 |
| ItemKNN | 0.074513 | 0.147481 | **0.085381** |
| ItemKNN + popularity | 0.069965 | 0.149710 | 0.074324 |

**Result:** Popularity had higher aggregate held-out relevance; collaborative filtering exposed more of the warm catalogue. The test covers 75 eligible users in one global time window. These offline ratings do not measure whether Movie Mood users prefer the deployed picks, and the earlier [per-user-split benchmark](experiments/v9-ranking/README.md) is not directly comparable.

To reproduce the global-time comparison with Python 3 (standard library only), download the dataset once, then run the tests and benchmark from this V9 branch’s repository root:

```bash
python3 experiments/v9-ranking/benchmark.py --download
PYTHONDONTWRITEBYTECODE=1 python3 experiments/v9-ranking/itemknn.test.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/v9-ranking/itemknn.py
```

See the [frozen protocol, selected parameters, error analysis, and limitations](experiments/v9-ranking/ITEMKNN_RESULTS.md). Application setup and checks are below.

## About the product

Start with how you want to feel, optionally refine the night, then move from a three-film glimpse to a closer look or the deterministic Help Me Choose flow. The V8.2 expansion brought the static runtime catalogue from 41 to 180 films after offline validation and human review. The separate offline production pipeline previously reached a 400 validated semantic-record checkpoint; its full history remains in the [project retrospective](docs/PROJECT_RETROSPECTIVE.md).

## Current experience

- Six mood-first entry points: funny, exciting, thought-provoking, relaxing, emotional, and suspenseful.
- Optional situations, practical filters, attention preference, discovery preference, and dealbreakers.
- A progressive Glimpse → Full Reveal flow that keeps the first decision lightweight.
- Direct selection or a deterministic Help Me Choose flow with transparent elimination and a two-film duel.
- An optional coin flip used as a gut check, followed by a focused Tonight’s Pick ticket.
- “More like this,” finish-time context, external watch-search links, shareable state, and favorites stored in `localStorage`.

## Runtime catalogue and offline production

The runtime catalogue is committed static data:

- `src/data/curatedMovies.ts` contains Movie Mood-owned meaning and editorial choices.
- `src/data/generated/tmdbMovies.json` contains the committed factual snapshot.
- `src/data/movies.ts` joins the two into the app’s stable movie model.

The separate `catalogue-pipeline/` is maintainer tooling for candidate selection, factual acquisition, evidence packets, semantic generation, validation, provenance, recovery, and resumable batch production. In V8.2, 139 offline-produced records passed strict source-boundary and contract verification and were promoted into the static runtime catalogue, expanding the live collection from 41 to 180 films.

> Movie Mood owns meaning. TMDB owns facts.

## Architecture principles

- The browser app is static, deterministic, and deployable to GitHub Pages.
- Recommendation and decision behavior uses local data and pure TypeScript utilities.
- There is no runtime backend, database, account system, authenticated TMDB API, or AI/LLM call.
- Movie facts are refreshed only by explicit maintainer tooling and committed as a reviewed snapshot.
- Browser poster requests may use TMDB’s image CDN; a local CSS title poster is the fallback.
- Offline model-assisted catalogue work remains separate from runtime product behavior and must pass deterministic validation before use.

## Tech stack

- React 19
- TypeScript
- Vite
- Plain CSS
- Vitest
- pnpm
- GitHub Actions and GitHub Pages

## Run locally

Prerequisites: a Node version matching `package.json` and pnpm 11.

```bash
git clone https://github.com/soph1azhao/movie-mood.git
cd movie-mood
git switch exploration/v9-personalized-ranking-mvp
pnpm install --frozen-lockfile
pnpm dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Test and build

Portable application and deployment checks for a fresh clone are:

```bash
pnpm test:runtime
pnpm build
pnpm exec tsc -b
```

`pnpm test` runs the broader maintainer and research suite, including historical `catalogue-pipeline/` checks. Some of those checks intentionally bind preserved local ignored artifacts and research state, so they are not prerequisites for deploying the application from a clean clone.

Runtime development, runtime tests, building, and deployment require no provider credentials.

## Project structure

```text
src/
  components/          UI building blocks and decision surfaces
  data/                curated meaning and committed TMDB facts
  hooks/               browser-local favorites
  types/               shared domain and state types
  utils/               filtering, discovery, decisions, URLs, presentation
catalogue-pipeline/    maintainer-only offline catalogue production
experiments/v9-ranking/ standalone MovieLens recommendation benchmarks
scripts/               maintainer curation and TMDB snapshot tools
docs/                  specifications, research, history, and closure records
.github/workflows/     tested GitHub Pages deployment
```

## Documentation

- [Documentation index](docs/README.md) — the map of current and historical project documents.
- [Project retrospective](docs/PROJECT_RETROSPECTIVE.md) — long-form product and engineering history.
- [V8 implementation specification](docs/V8_IMPLEMENTATION_SPEC.md) — current visual-system architecture.
- [V8.1 catalogue scaling specification](docs/V8_1_CATALOGUE_SCALE_IMPLEMENTATION_SPEC.md) — offline pipeline architecture.
- [V8.1 closure](docs/V8_1_CATALOGUE_SCALING_CLOSURE.md) — final scaling evidence and stopping decision.
- [Learning notes](LEARNING_NOTES.md) — approachable explanations of how the application works.
- [Contributing](CONTRIBUTING.md) — setup, boundaries, and contribution guidance.

Older specifications remain available as historical records and may be superseded by later versions. Start with the [documentation index](docs/README.md) rather than treating every document as current authority.

## Version history

- **V1–V3:** mood-first recommendations grew into context-aware filtering and discovery controls.
- **V4–V6:** Decision Mode, progressive reveal, and a selective decision companion made choosing—not browsing—the central interaction.
- **V7–V8:** visual research and the Editorial Wire system established the current cinematic identity.
- **V8.1:** a reproducible, bounded, offline catalogue-production pipeline proved semantic scaling through 400 validated records.
- **V8.2:** promoted 139 validated films from offline production into the static runtime catalogue, expanding the live collection to 180 films with zero runtime semantic or factual mutation.
- **V9 development branch:** added opt-in local genre-based ordering and separate MovieLens benchmarks; the locked global-time test favored popularity on relevance and ItemKNN on coverage.

See [Releases](https://github.com/soph1azhao/movie-mood/releases) and the [project retrospective](docs/PROJECT_RETROSPECTIVE.md) for the detailed history.

## TMDB attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Factual data is stored in a committed snapshot; normal runtime use does not call the authenticated TMDB data API. Poster images may be loaded from TMDB’s image CDN.

## Project status

The live GitHub Pages demo deploys from `main` and presents the V8.2 product with 180 curated films. V9 is documented on the `exploration/v9-personalized-ranking-mvp` development branch; its ItemKNN models remain offline. The application remains static and self-contained.

## License

[MIT](LICENSE) © 2026 Sophia Zhao.
