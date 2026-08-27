# Movie Mood V5.1 — Curation & Closure Implementation Specification

## 1. Project Context

**Project:** Movie Mood
**Repository:** `soph1azhao/movie-mood`
**Current release:** `v5.0.0`
**V5 checkpoint:** `88ca2d6084a9277c5115fb636551fbb064bcaf78`

**Stack:** Vite + React + TypeScript + plain CSS
**Hosting:** GitHub Pages
**Persistence:** browser-local favorites / My List
**Movie facts:** committed TMDB factual snapshot
**Movie meaning:** local Movie Mood editorial layer
**Testing:** Vitest

V5 is complete and released.

V5 established:

- manually verified TMDB identity mapping
- maintainer-side `pnpm sync:tmdb`
- committed generated TMDB factual snapshot
- factual/editorial data split
- `curatedMovies.ts` as the source of Movie Mood meaning
- `tmdbMovies.json` as the source of TMDB facts
- `movies.ts` resolving both layers into the existing `Movie[]`
- preserved local Movie Mood IDs
- preserved favorites and V4 URLs
- preserved curated behavioral `filterLanguages`
- separate TMDB factual `spokenLanguages`
- real TMDB posters
- poster fallback behavior
- TMDB attribution and official logo
- no frontend TMDB token
- no runtime authenticated TMDB data API call

V5.1 must build on V5 rather than redesigning it.

---

## 2. Version Story

Movie Mood evolves through:

```text
V1 — Mood
How do I feel?

V2 — Context
What fits tonight?

V3 — Discovery
What kind of experience do I want?

V4 — Decide
Which one should I actually watch?

V5 — Real Movies
Connect Movie Mood to real movie facts and posters.

V5.1 — Curation & Closure
Make the real-movie system easier to maintain and help the user take the next step after Tonight's Pick.
```

V5.1 is a focused post-V5 consolidation release.

It is not a new recommendation system.

---

## 3. Product Goal

Movie Mood V5.1 should do two things:

1. make adding a new curated movie less error-prone without automating Movie Mood's editorial judgment;
2. make Tonight's Pick feel more complete by giving the user a clear external path to find where the selected movie can be watched.

The guiding principle remains:

> **Movie Mood owns meaning. TMDB owns facts.**

V5.1 may reduce clerical work.

V5.1 must not automate taste, mood, or editorial interpretation.

---

## 4. Hard Scope Constraints

V5.1 must remain:

- static
- backend-free
- database-free
- account-free
- deployable through the existing GitHub Pages workflow
- usable without runtime TMDB API access
- compatible with the committed TMDB snapshot architecture
- compatible with existing V1–V5 user flows

Do not add:

- backend services
- serverless functions
- databases
- authentication
- TMDB user authentication
- cloud persistence
- runtime authenticated TMDB data API calls from the browser
- browser-exposed TMDB API credentials
- automatic scheduled metadata refresh
- GitHub Actions metadata synchronization
- universal TMDB search in the product UI
- uncurated movie browsing
- popularity/rating-based ranking
- AI-generated editorial annotations
- machine learning
- React Router
- Redux
- Zustand
- another state-management framework
- streaming-provider API integration
- regional availability database
- provider logos or verified availability claims
- broad visual redesign

---

## 5. Preserve V5 Architecture

V5.1 must preserve:

- local Movie Mood IDs as application identity
- `tmdbId` as external factual-data mapping only
- `curatedMovies.ts` as the Movie Mood meaning layer
- `tmdbMovies.json` as generated factual snapshot
- `movies.ts` as the resolved app-facing `Movie[]`
- existing `pnpm sync:tmdb` ownership of generated facts
- existing TMDB attribution
- existing poster fallback behavior
- existing recommendation semantics
- existing favorites/My List behavior
- existing V4 URL compatibility
- existing deployment workflow

Do not manually edit generated TMDB facts as a normal curation path.

Do not create a second writer for `tmdbMovies.json`.

---

## 6. V5.1 Scope Summary

V5.1 contains three bounded improvements:

1. **Curation Assistant**
   - maintainer-side CLI helper for finding a TMDB movie and producing a Movie Mood editorial scaffold.

2. **Tonight's Action**
   - user-facing external lookup links from Tonight's Pick and, optionally, Movie Details.

3. **Poster Resilience Polish**
   - small polish to poster loading, layout stability, and fallback consistency.

Anything else is out of scope unless required to fix a defect discovered during implementation.

---

# Part A — Curation Assistant

## 7. Curation Assistant Goal

Add a maintainer-side command:

```text
pnpm curate:add "<movie title or search query>"
```

The command should help a maintainer add a new Movie Mood movie by reducing manual TMDB lookup and schema-copying work.

It must not decide Movie Mood editorial meaning.

---

## 8. Curation Assistant Flow

The intended flow is:

```text
pnpm curate:add "Perfect Blue"
        ↓
search TMDB using maintainer token
        ↓
show candidate matches in terminal
        ↓
maintainer explicitly selects one candidate
        ↓
generate a Movie Mood editorial scaffold
        ↓
maintainer fills in meaning fields manually
        ↓
pnpm sync:tmdb
        ↓
existing atomic TMDB snapshot machinery updates facts
```

The assistant must not automatically choose the first TMDB result.

Human identity selection is required.

---

## 9. Authentication

The curation assistant may use:

```text
TMDB_READ_ACCESS_TOKEN
```

from the maintainer process environment.

Do not:

- commit a token
- hard-code a token
- print the token
- expose the token through frontend code
- add the token to the Vite app environment
- place the token in generated output
- require the token for normal build/test/dev

If the token is missing, the command must fail clearly and safely without modifying project files.

---

## 10. TMDB Search Behavior

The curation assistant may use TMDB search only as a maintainer aid.

Requirements:

- search only when explicitly invoked through `pnpm curate:add`
- display multiple candidate matches when available
- show enough information to disambiguate candidates, such as title, release year, TMDB ID, and available overview/director information if fetched
- require explicit maintainer selection
- support cancellation
- never silently select a candidate
- never modify application state if selection is cancelled

The production app must not gain TMDB search.

---

## 11. Scaffold Output

The assistant should produce a complete Movie Mood editorial scaffold containing:

```ts
id
tmdbId

moods
situations
pace
emotionalWeight
attentionDemand
discoveryStyle

description
whyWatch
curiosityHook
vibeSummary

palette
filterLanguages
```

Use the exact fields currently required by the V5 `CuratedMovie` structure.

If repository naming differs, follow the current codebase.

The scaffold should make incomplete editorial fields obvious.

Do not generate final editorial copy.

Do not guess:

- moods
- situations
- pace
- emotional weight
- attention demand
- discovery style
- whyWatch
- curiosityHook
- vibeSummary
- filterLanguages

A suggested local ID may be generated from the selected TMDB title and year, but the maintainer must be able to review it.

---

## 12. Source Modification Policy

Prefer the safest maintainable implementation.

Acceptable V5.1 approaches:

### Preferred

Write a draft scaffold file under a clearly maintainer-facing location, for example:

```text
src/data/curationDrafts/<movie-id>.ts
```

or:

```text
docs/curation-drafts/<movie-id>.md
```

and print clear instructions for manually adding it to `curatedMovies.ts`.

### Also acceptable if simple and safe

Print a ready-to-paste TypeScript object to the terminal.

### Avoid unless already straightforward in the repository

Automatically editing `curatedMovies.ts`.

If automatic insertion is implemented, it must be robust, tested, formatting-safe, and must not risk corrupting the existing curated dataset.

Do not add a large AST-manipulation dependency solely for this feature unless absolutely necessary.

---

## 13. Generated Snapshot Policy

The curation assistant must not directly append to or modify:

```text
src/data/generated/tmdbMovies.json
```

or whatever path currently contains the generated TMDB factual snapshot.

The only normal producer of generated TMDB facts remains:

```text
pnpm sync:tmdb
```

After producing a scaffold, the assistant should instruct the maintainer to:

```text
1. add/fill the curated editorial entry
2. run pnpm sync:tmdb
3. review behavior-impact warnings and Git diff
4. run pnpm test
5. run pnpm build
```

---

## 14. Curation Validation

Add validation where practical so the assistant catches obvious issues:

- duplicate proposed local ID
- duplicate selected `tmdbId`
- missing token
- empty search query
- no search results
- cancelled selection
- malformed TMDB response
- filesystem write failure

None of these should corrupt existing data.

---

## 15. Curation Tests

Use mocked TMDB responses.

Do not use live network tests.

At minimum, test reusable logic for:

- local ID suggestion
- duplicate local ID detection
- duplicate `tmdbId` detection
- candidate normalization
- scaffold generation includes all required fields
- missing token fails before modification
- cancelled selection does not write output
- generated TMDB snapshot is not modified by `curate:add`

---

# Part B — Tonight's Action

## 16. Tonight's Action Goal

After Movie Mood helps the user choose a movie, V5.1 should help the user move from:

```text
Tonight's Pick
```

to:

```text
find where to watch it
```

without adding provider APIs or regional availability complexity.

---

## 17. User-Facing Wording

Do not claim verified availability.

Preferred label:

```text
Find where to watch
```

Avoid labels that imply Movie Mood knows availability, such as:

```text
Stream now
Available on
Watch on Netflix
```

unless future verified provider data is implemented.

---

## 18. External Lookup Links

Add one or more deterministic outbound lookup links.

Preferred minimal set:

- a general web search for where to watch the movie
- a TMDB web page link if the TMDB ID is available

Optional:

- Letterboxd search link
- JustWatch search link

All outbound URLs must be generated by centralized helpers.

Do not scatter URL-construction logic across components.

---

## 19. Link Safety and Semantics

External lookup links must:

- open safely as external links
- use encoded query parameters
- include accessible labels
- not require any API key
- not call a backend
- not claim regional availability
- not add tracking parameters unless required
- not break if a title contains punctuation, accents, or non-English characters

Use movie title and year where helpful.

---

## 20. Where to Display

At minimum, add the action to:

- Tonight's Pick

Optionally add it to:

- Movie Details

Do not add the action to every compact card if it clutters the core recommendation flow.

---

## 21. Tonight's Action Tests

Test reusable URL helpers for:

- query encoding
- title/year formatting
- TMDB web URL construction from `tmdbId`
- safe behavior with punctuation/non-English titles
- no malformed URL for missing optional fields

---

# Part C — Poster Resilience Polish

## 22. Poster Polish Goal

Improve the perceived quality of V5 posters without redesigning the app.

Focus on:

- layout stability
- loading state
- fallback consistency
- mobile sizing
- accessibility

---

## 23. Poster Behavior

Preserve the V5 behavior:

```text
TMDB poster available and loads
        ↓
show real poster

posterPath null OR image load fails
        ↓
show Movie Mood palette/CSS fallback
```

Do not remove the existing fallback.

Do not show broken image icons.

Do not collapse card layout when a poster fails.

---

## 24. Poster Polish Scope

Allowed improvements:

- reserve poster aspect ratio before image load
- prevent layout shift
- add subtle loading treatment
- keep fallback visually consistent with cards
- improve `alt` text
- ensure image-error fallback remains reliable
- verify responsive sizing in key views

Review at least:

- recommendation cards
- More like this
- My List
- Movie Details
- Decision Mode
- duel/finalist presentation
- Tonight's Pick

Do not add backdrop images in V5.1.

Do not add poster zoom unless it is extremely small and does not broaden the detail-modal scope.

---

## 25. Poster Tests

Where practical, test reusable poster helpers for:

- valid TMDB poster URL construction
- null poster path fallback decision
- image-error fallback state if already testable in the current setup

Do not introduce heavyweight component-testing infrastructure solely for poster polish.

---

# Part D — Documentation and Release Readiness

## 26. Documentation

Update documentation to explain:

- what `pnpm curate:add` does
- what it does not do
- how it relates to `pnpm sync:tmdb`
- that Movie Mood meaning remains human-authored
- how to add a movie safely after V5.1
- Tonight's Action is external lookup, not verified availability
- poster fallback behavior remains intentional

Likely files:

```text
README.md
LEARNING_NOTES.md
```

Follow existing repository conventions.

---

## 27. Required Verification

Before V5.1 is complete, run:

```text
pnpm test
pnpm build
git diff --check
```

All must pass.

The implementation must not require a TMDB token for:

```text
pnpm test
pnpm build
pnpm dev
```

Only maintainer commands such as:

```text
pnpm curate:add
pnpm sync:tmdb
```

may require `TMDB_READ_ACCESS_TOKEN`.

---

## 28. Agent Execution Convention

V5.1 is intentionally small enough to run as one coherent implementation.

Use:

```text
Execute V5.1
```

The agent should:

1. read `AGENTS.md`
2. read `docs/V5_1_IMPLEMENTATION_SPEC.md`
3. inspect the current V5 code
4. implement only V5.1 scope
5. run required verification
6. fix failures
7. inspect the final diff
8. stage only V5.1 files
9. commit with a concise message
10. push to `origin/main`
11. confirm clean/aligned repository
12. report concisely

Stop before commit only for a real blocker.

---

## 29. Real Blockers

Legitimate blockers include:

- wrong repository or remote
- unrelated user changes in the working tree
- missing `TMDB_READ_ACCESS_TOKEN` when testing live curation flow is required
- inability to identify current data paths safely
- implementation would require directly modifying generated TMDB facts outside `sync:tmdb`
- implementation would require adding backend/runtime API architecture
- test/build failure that cannot be fixed safely
- contradiction between this spec and existing V5 architecture

Minor naming or formatting choices are not blockers.

---

## 30. Explicitly Out of V5.1

Do not implement:

- Curated Search
- universal TMDB search in the product UI
- watch-provider API integration
- verified regional availability
- provider logos
- trailers
- TMDB videos
- TMDB overview
- TMDB tagline
- backdrop banners
- top cast unless explicitly approved separately
- catalogue expansion
- automatic source-code insertion if brittle
- automated scheduled metadata refresh
- GitHub Actions TMDB sync
- curation AI
- additional subjective movie taxonomies
- search/sort UI
- account/cloud features
- new recommendation semantics

---

## 31. V5.1 Completion Criteria

V5.1 is complete when:

1. a maintainer can run a curation helper to find a TMDB movie and produce a safe Movie Mood editorial scaffold;
2. the helper requires human selection and does not automate Movie Mood meaning;
3. the helper does not directly modify generated TMDB facts;
4. the existing `sync:tmdb` remains the only normal producer of TMDB factual snapshots;
5. Tonight's Pick includes a clear external path to find where to watch the selected movie;
6. the UI does not claim verified streaming availability;
7. poster loading/fallback behavior is more stable and intentional;
8. existing V1–V5 behavior remains intact;
9. tests pass;
10. production build passes;
11. no TMDB token is exposed to the frontend.

## V5.1 in one sentence

> **V5.1 makes Movie Mood easier to curate and easier to act on: a maintainer can add real-movie candidates safely, and a user who reaches Tonight's Pick gets a clean next step toward watching without changing Movie Mood's static, human-curated architecture.**
