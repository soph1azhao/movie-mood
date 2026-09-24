# Movie Mood

Streaming platforms help you find more movies.

Movie Mood helps you choose one.

A mood-first, decision-focused movie companion for one deceptively difficult question: **What should I watch tonight?**

[Live demo](https://soph1azhao.github.io/movie-mood/) · [Latest releases](https://github.com/soph1azhao/movie-mood/releases) · [Project retrospective](docs/PROJECT_RETROSPECTIVE.md) · [Documentation index](docs/README.md)

## About

Movie Mood replaces an endless catalogue with a small, considered shortlist. Start with how you want to feel, optionally refine the night, and work toward one film through progressive reveal and lightweight decision support.

The V8.2 runtime catalogue contains **180 curated movies** (the original 41-film baseline plus 139 movies promoted through the governed V8.2 pipeline). Separately, the offline production pipeline previously established a **400 validated semantic record** checkpoint; V8.2 promoted 139 human-adjudicated, contract-validated films into the static runtime catalogue.

## How it works

```text
Choose a mood
      ↓
Glimpse — three visual invitations
      ↓
Refine tonight (optional) or Take a closer look
      ↓
Full Reveal — three films with decision-ready detail
      ↓
That's the one ──────────────────────────────┐
      or                                     │
Help me choose                              │
      ↓                                      │
Decision companion where useful,             │
or manually mark one Not tonight             │
      ↓                                      │
Final duel → optional coin-flip gut check     │
      └───────────────────────────────────────┘
                         ↓
                   Tonight's Pick
```

The app also supports practical filters, strict “Not tonight” boundaries, another-three cycling, related-film exploration, shareable decision states, expandable details, and a browser-local My List.

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

See [Releases](https://github.com/soph1azhao/movie-mood/releases) and the [project retrospective](docs/PROJECT_RETROSPECTIVE.md) for the detailed history.

## TMDB attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Factual data is stored in a committed snapshot; normal runtime use does not call the authenticated TMDB data API. Poster images may be loaded from TMDB’s image CDN.

## Project status

Movie Mood V8.2 is prepared for release at `v8.2.0`. The runtime catalogue contains 180 curated movies. The runtime application remains static, deterministic, and fully self-contained, with offline maintainer tooling kept strictly separate from browser execution.

## License

[MIT](LICENSE) © 2026 Sophia Zhao.
