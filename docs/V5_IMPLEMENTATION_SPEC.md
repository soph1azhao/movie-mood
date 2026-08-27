# Movie Mood V5 — Implementation Specification

## 1. Project Context

**Project:** Movie Mood
**Repository:** `soph1azhao/movie-mood`
**Current release:** `v4.0.0`
**V4 checkpoint:** `686e6e62f44ff4789524e105e6a21407a8b3270d`

**Stack:** Vite + React + TypeScript + plain CSS
**Hosting:** GitHub Pages
**Persistence:** browser-local favorites / My List
**Testing:** Vitest

V4 is complete.

Current accepted V1–V4 behavior includes:

* six mood-first entry points
* optional viewing situations
* practical movie filters
* situation fallback
* attention-demand and discovery-style preferences
* strict dealbreakers
* deterministic discovery ordering
* three-card recommendation cycling
* More like this
* favorites and My List
* Movie Details
* Help Me Choose
* three-film Decision Mode
* two-film duel
* contextual deciding factors
* coin-flip gut check
* Tonight's Pick
* Change my mind
* versioned/restorable V4 URL state
* Web Share / clipboard fallback
* CSS-generated movie posters

Current V4 automated verification reports:

```text
pnpm test
64 tests passed

pnpm build
passed

git diff --check
passed
```

V5 must build on the accepted V4 product rather than redesigning it.

---

# 2. Version Story

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
Connect the completed Movie Mood experience to real movie data.
```

V5 is an infrastructure, data-quality, and presentation version.

It is not a new recommendation system.

---

# 3. V5 Product Goal

Movie Mood V5 should make the curated experience feel connected to the real movie world by enriching every existing curated movie with verified factual metadata and real poster imagery from TMDB.

The defining architectural principle is:

> **Movie Mood owns meaning. TMDB owns facts.**

Movie Mood continues to decide:

* why a movie fits a mood
* how demanding it feels
* how emotionally heavy it feels
* whether it is familiar or adventurous
* what situations it suits
* how movies relate for discovery
* what distinctions matter tonight

TMDB supplies factual movie information.

TMDB must not become Movie Mood's recommendation engine.

---

# 4. Hard Architecture Constraints

V5 must remain:

* static
* backend-free
* database-free
* account-free
* deployable through the existing GitHub Pages workflow
* deterministic during normal application use
* understandable by one developer
* inexpensive/free to operate for the current non-commercial project
* usable without runtime TMDB API access

Do not add:

* backend services
* serverless functions
* databases
* authentication
* TMDB user authentication
* cloud persistence
* runtime TMDB data API calls from the browser
* browser-exposed TMDB API credentials
* automatic scheduled metadata refresh
* GitHub Actions metadata synchronization
* TMDB search in the product UI
* universal movie catalogue browsing
* popularity-based ranking
* vote/rating-based recommendation logic
* AI-generated editorial annotations
* machine learning
* React Router
* Redux
* Zustand
* another state-management framework
* TV support
* streaming-provider availability
* broad redesign of V1–V4 interaction flows

Normal Movie Mood usage must remain a static client application.

---

# 5. Preserve V1–V4

V5 must preserve all accepted V1–V4 interaction semantics unless factual metadata legitimately changes the result of an existing factual rule.

In particular, preserve:

* existing local Movie Mood IDs
* existing favorites/localStorage IDs
* existing V4 URL movie IDs
* mood matching
* situation fallback
* practical filtering semantics
* V3 dealbreaker semantics
* V3 soft-preference ordering
* More like this scoring rules
* cycling behavior
* Decision Mode behavior
* duel behavior
* Tonight's Pick
* Change my mind
* share/restoration behavior

Do not rename existing movie IDs.

Do not replace Movie Mood IDs with TMDB IDs.

The following must remain true:

```text
Movie Mood local ID = application identity
TMDB ID             = external factual-data mapping
```

---

# 6. V5 Data Ownership Model

V5 separates the current monolithic movie data into three conceptual layers.

## 6.1 Movie Mood Identity

Every curated movie retains:

```ts
id: string
tmdbId: number
```

Example:

```ts
{
  id: 'movie-mood-stable-id',
  tmdbId: 123456,
}
```

`id` remains authoritative inside Movie Mood.

`tmdbId` identifies the corresponding TMDB movie.

A `tmdbId` must never replace the Movie Mood `id` in:

* favorites
* My List
* URLs
* recommendation state
* decision state
* similarity seed state

---

## 6.2 Movie Mood Editorial Data

Movie Mood continues to own and manually curate:

```ts
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
```

`description` remains Movie Mood editorial copy.

Do not replace it with TMDB's overview.

`palette` remains because it provides the visual fallback when a real poster is unavailable.

---

## 6.3 TMDB Factual Data

TMDB supplies:

```ts
title
year
director
countries
languages
genres
runtimeMinutes
posterPath
```

Do not import into V5:

```text
popularity
voteAverage
voteCount
trending rank
TMDB recommendations
TMDB overview
cast lists
backdrops
keywords
reviews
watch providers
```

unless explicitly required by a future specification.

---

# 7. Target Type Structure

The exact naming may follow repository conventions, but the conceptual model should be approximately:

```ts
export interface CuratedMovie {
  id: string
  tmdbId: number

  moods: Mood[]
  situations: ViewingSituation[]

  pace: Pace
  emotionalWeight: EmotionalWeight
  attentionDemand: AttentionDemand
  discoveryStyle: DiscoveryStyle

  description: string
  whyWatch: string
  curiosityHook: string
  vibeSummary: string

  palette: [string, string]
}

export interface MovieFacts {
  title: string
  year: number
  director: string

  countries: string[]
  languages: string[]
  genres: string[]

  runtimeMinutes: number
  posterPath: string | null
}

export interface Movie extends CuratedMovie, MovieFacts {}
```

The final application should continue consuming a resolved `Movie[]`.

Existing application components should not need to understand where each field originated.

---

# 8. Repository Data Architecture

Preferred direction:

```text
src/
  data/
    curatedMovies.ts
    movies.ts
    generated/
      tmdbMovies.json

  types/
    movie.ts

scripts/
  syncTmdb.ts
  # or another simple Node-compatible equivalent
```

Responsibilities:

### `curatedMovies.ts`

Hand-authored Movie Mood meaning layer.

Contains:

```text
local ID
TMDB ID
Movie Mood editorial metadata
```

### `generated/tmdbMovies.json`

Generated factual TMDB snapshot.

Committed to Git.

Never manually edited except when deliberately repairing corrupted repository state.

### `movies.ts`

Resolves:

```text
curated Movie Mood data
+
generated TMDB facts
=
Movie[]
```

Keep `movies.ts` as the normal application import where practical so that V1–V4 components do not need unnecessary import churn.

The exact file arrangement may vary slightly if an existing repository convention is clearly simpler.

---

# 9. Generated Snapshot Schema

The generated snapshot must use the Movie Mood local ID as its top-level key.

Conceptually:

```json
{
  "movie-mood-stable-id": {
    "tmdbId": 123456,
    "title": "Example Movie",
    "year": 2024,
    "director": "Example Director",
    "countries": ["Example Country"],
    "languages": ["Example Language"],
    "genres": ["Drama"],
    "runtimeMinutes": 108,
    "posterPath": "/example.jpg"
  }
}
```

The snapshot should include `tmdbId` so one-to-one correspondence can be validated.

Do not key the application by TMDB ID.

---

# 10. Snapshot Determinism

The generated file must be deterministic.

Do not include volatile or synchronization-only fields such as:

```text
fetchedAt
updatedAt
popularity
voteAverage
voteCount
request timestamp
trending position
```

Normalize generated values consistently.

For string arrays such as:

```text
genres
languages
countries
```

remove duplicates and produce a stable ordering.

Serialize local movie entries in stable curated dataset order or another explicitly deterministic order.

Repeated synchronization against unchanged TMDB responses must produce no Git diff.

---

# 11. TMDB Mapping Rules

Every V4 curated movie must receive exactly one manually verified `tmdbId`.

Do not add or remove movies merely because V5 introduces TMDB.

Mapping requirements:

* every curated movie has one positive integer `tmdbId`
* every `tmdbId` maps to exactly one Movie Mood movie
* duplicate `tmdbId` values are invalid
* duplicate local IDs remain invalid
* existing Movie Mood local IDs must not change

A one-time TMDB search may be used by a maintainer to locate candidate IDs.

However:

> **The production synchronization command must never search by title or automatically choose a movie.**

Synchronization must fetch only the exact committed `tmdbId`.

A candidate mapping should be reviewed using sufficient identifying information such as:

* title
* release year
* director

Do not silently choose the first search result.

---

# 12. Maintainer-Time Synchronization

Add:

```text
pnpm sync:tmdb
```

This is an explicit maintainer operation.

Conceptually:

```text
curatedMovies
      ↓
exact tmdbId values
      ↓
TMDB API
      ↓
validate all responses
      ↓
normalize all facts
      ↓
compare with existing snapshot
      ↓
write complete new snapshot
```

Synchronization is **not** part of:

```text
pnpm dev
pnpm test
pnpm build
GitHub Pages deployment
```

The normal application build must work without any TMDB credential.

---

# 13. Authentication and Secret Handling

Use the TMDB API Read Access Token through:

```text
TMDB_READ_ACCESS_TOKEN
```

The token must be read from the maintainer process environment.

Do not:

* commit a token
* hard-code a token
* serialize a token into generated data
* expose it through `import.meta.env`
* include it in frontend code
* place it into the built JavaScript bundle
* print it in logs
* include it in errors
* place it in normal GitHub Pages deployment configuration

If a local environment file is used, it must already be ignored or be added safely to `.gitignore`.

Prefer environment-based authentication over command-line arguments containing the token.

---

# 14. TMDB Request Scope

Use the TMDB movie-details endpoint for each exact mapped movie ID.

Use a single explicit localization:

```text
language=en-US
```

Use `append_to_response` for credits if needed so director information can be obtained without unnecessary request proliferation.

The synchronization implementation should remain simple.

Prefer:

* sequential requests
* or very low concurrency
* native platform HTTP/fetch capabilities

Do not add a TMDB SDK.

A small dev-only script-running dependency is acceptable only if genuinely needed to execute the synchronization script cleanly.

Do not add a runtime application dependency merely for synchronization.

---

# 15. TMDB Fact Normalization

Normalize TMDB responses into Movie Mood's factual schema.

## Title

Use the localized TMDB movie title returned for the configured language.

Must be a non-empty string.

---

## Year

Derive from the TMDB release date.

A missing or invalid release year is a synchronization failure.

---

## Runtime

Must be a positive integer number of minutes.

A missing, zero, negative, non-numeric, or otherwise invalid runtime is a synchronization failure.

Runtime is behaviorally important because Movie Mood currently uses runtime for filters, dealbreakers, and decision contrasts.

---

## Genres

Use TMDB movie genre names.

Must produce a valid non-empty string array for the current curated catalogue.

Normalize deterministically.

---

## Languages

Use stable human-readable language names from TMDB's spoken-language data.

Prefer English display names where available because Movie Mood's current language filters are human-readable English labels.

Normalize deterministically.

---

## Countries

Use TMDB production-country names.

Normalize deterministically.

---

## Director

Derive from appended credits by crew entries identified as directors.

If multiple directors exist, preserve all identified directors in one stable display string rather than silently dropping co-directors.

A missing usable director for an existing curated feature film is a synchronization failure.

---

## Poster

Store only:

```ts
posterPath: string | null
```

A missing poster is allowed.

Do not treat:

```ts
posterPath === null
```

as synchronization failure.

---

# 16. Explicit Synchronization Failure Policy

Synchronization is atomic.

> **Either every curated movie produces one valid factual snapshot entry, or the existing generated snapshot remains unchanged.**

Never leave a partially updated snapshot.

## Hard Data / Configuration Failures

The following fail immediately or fail the synchronization:

| Condition                                            | Required behavior                                 |
| ---------------------------------------------------- | ------------------------------------------------- |
| `TMDB_READ_ACCESS_TOKEN` missing                     | Fail immediately. Do not modify snapshot.         |
| Invalid/missing local movie ID                       | Fail.                                             |
| Missing/invalid `tmdbId`                             | Fail.                                             |
| Duplicate local ID                                   | Fail.                                             |
| Duplicate `tmdbId`                                   | Fail.                                             |
| TMDB `401`                                           | Fail immediately. Do not retry as transient.      |
| TMDB `403`                                           | Fail immediately. Do not retry as transient.      |
| TMDB `404` for committed `tmdbId`                    | Fail. Never search automatically for replacement. |
| Response movie ID differs from requested ID          | Fail.                                             |
| Invalid response structure                           | Fail.                                             |
| Missing/invalid title                                | Fail.                                             |
| Missing/invalid year                                 | Fail.                                             |
| Missing/invalid runtime                              | Fail.                                             |
| Malformed required genre data                        | Fail.                                             |
| Malformed required language data                     | Fail.                                             |
| Missing usable director                              | Fail.                                             |
| Snapshot count differs from curated movie count      | Fail.                                             |
| Snapshot cannot resolve one-to-one with curated data | Fail.                                             |

---

## Transient Failures

The following may be retried:

```text
HTTP 429
HTTP 5xx
temporary network failures
```

Retry behavior must be bounded.

Use a small fixed maximum number of attempts.

Use simple exponential/backoff behavior.

When a `Retry-After` response is provided for rate limiting, respect it where practical.

If the bounded retries are exhausted:

```text
fail entire synchronization
preserve previous snapshot
```

Do not retry indefinitely.

---

## Allowed Graceful Degradation

The following are not synchronization failures:

```text
posterPath === null
```

At browser runtime:

```text
poster CDN image load failure
```

must also degrade gracefully to the existing Movie Mood poster treatment.

Movie recommendation functionality must remain usable without poster delivery.

---

# 17. Atomic Write Requirement

Do not overwrite the generated snapshot movie-by-movie.

The synchronization process must:

1. load and validate the curated mapping
2. fetch all required TMDB records
3. validate every response
4. construct the complete candidate snapshot
5. validate one-to-one correspondence
6. serialize the complete deterministic candidate
7. only then replace the existing generated snapshot

A safe implementation may write a temporary file beside the final snapshot and rename/promote it only after complete validation.

If any failure occurs before final promotion:

```text
existing snapshot remains untouched
```

Temporary artifacts should be cleaned up when practical.

---

# 18. Behavior-Impact Classification

Not every factual TMDB change has the same product impact.

The synchronization report must distinguish at least:

## Behavior-impacting fields

```text
runtimeMinutes
genres
languages
```

These currently participate in filtering, dealbreakers, similarity, or other V1–V4 behavior.

Changes to these fields must be prominently reported.

---

## Primarily display-oriented fields

```text
title
year
director
countries
posterPath
```

These should still appear in the generated Git diff but do not currently define the same filtering/similarity semantics.

---

# 19. Initial V5 Behavior Review Gate

Phase 1 is the migration from existing hand-entered facts to the first TMDB factual snapshot.

The agent must compare the first TMDB snapshot against the existing V4 factual values before committing the phase.

If any behavior-impacting field differs:

```text
runtimeMinutes
genres
languages
```

the agent must stop before commit and report a concise review table containing:

```text
Movie Mood ID
movie title
field
old V4 value
new TMDB value
```

This is a deliberate human review gate and counts as a valid reason to stop before commit under `AGENTS.md`.

Do not change filtering/similarity algorithms merely to compensate for factual differences.

After the user approves the factual changes, continue the phase normally.

Display-only differences do not require this special stop unless they reveal a likely incorrect TMDB mapping.

---

# 20. Future Metadata Refreshes

After V5, normal metadata maintenance should be:

```text
maintainer runs pnpm sync:tmdb
        ↓
script validates and updates snapshot
        ↓
maintainer reviews behavior-impact warnings
        ↓
maintainer reviews Git diff
        ↓
pnpm test
pnpm build
        ↓
commit
```

Do not implement automatic scheduled refresh in V5.

Manual review is intentional because factual changes can alter Movie Mood behavior.

---

# 21. Normal Build and Deployment Contract

The following must work with no TMDB credential:

```text
pnpm dev
pnpm test
pnpm build
```

GitHub Pages deployment must also require no TMDB credential.

Do not modify the existing deployment workflow to call TMDB.

The deployed application reads only:

```text
committed Movie Mood editorial data
+
committed TMDB factual snapshot
```

The TMDB data API is therefore not a runtime dependency.

---

# 22. Real Poster Integration

V5 should replace the normal visual preference from CSS-only poster treatment to real TMDB poster imagery where available.

Create or reuse one centralized poster-rendering component/helper.

Do not scatter TMDB image URL construction across components.

Use one documented, appropriate poster size such as a medium card-friendly size.

A poster should render:

```text
TMDB poster available and loads
        ↓
real movie poster

posterPath null OR image load fails
        ↓
existing Movie Mood CSS/palette poster
```

Do not show a broken-image icon.

Do not collapse the card layout when poster loading fails.

---

# 23. Poster Runtime Dependency Boundary

TMDB's data API must not be called at runtime.

However, TMDB-hosted poster images may be loaded from TMDB's image CDN.

Therefore the correct resilience model is:

```text
TMDB data API unavailable
→ Movie Mood continues to work from committed factual snapshot.

TMDB image CDN unavailable
→ Movie Mood remains fully usable but falls back to local CSS/palette posters.
```

Do not describe V5 as fully offline if remote poster images remain enabled.

---

# 24. Poster Coverage

Use the same poster behavior anywhere the current application meaningfully presents the movie visually.

At minimum review:

* normal recommendation cards
* More like this results
* My List
* Movie Details
* Decision Mode
* duel/finalist presentation
* Tonight's Pick

Prefer reuse of one poster component rather than separate TMDB-image logic in each view.

Do not broadly redesign those views.

---

# 25. TMDB Attribution

V5 is incomplete without TMDB attribution.

Add an About/Credits-style attribution area appropriate to the existing application.

It must include:

* an approved TMDB logo
* the required TMDB attribution notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The TMDB logo must not be presented more prominently than Movie Mood's own identity and must not imply endorsement.

Use an approved, unmodified TMDB logo asset consistent with TMDB's current branding requirements.

Do not invent a custom TMDB logo.

---

# 26. No New Recommendation Semantics

TMDB data must not introduce new recommendation factors in V5.

Do not use:

```text
popularity
ratings
vote count
trending status
TMDB recommendations
release recency
cast popularity
external recommendation scores
```

to change Movie Mood ranking.

The only TMDB factual fields that may affect existing recommendation behavior are fields that V1–V4 already use:

```text
runtime
genres
languages
```

The algorithms consuming those fields must retain their existing semantics.

---

# 27. Automated Tests

Use the existing Vitest setup.

Do not make automated tests depend on live TMDB availability.

Use fixtures/mocked responses for synchronization tests.

At minimum add targeted coverage for:

## Mapping validation

* every curated movie has a valid positive `tmdbId`
* duplicate `tmdbId` is rejected
* duplicate local IDs remain rejected
* snapshot/local mapping is one-to-one

## Snapshot validation

* valid TMDB response normalizes correctly
* response ID must match requested ID
* invalid title fails
* invalid year fails
* invalid runtime fails
* malformed genre/language data fails
* null poster is accepted
* output ordering/serialization is deterministic

## Failure behavior

* authentication failure does not replace snapshot
* missing movie/404 does not replace snapshot
* one failed movie prevents partial snapshot replacement
* bounded transient retry eventually succeeds or fails predictably
* exhausted retries preserve the previous snapshot

## Merge/resolution

* every curated movie resolves to one final `Movie`
* every generated fact entry belongs to a curated movie
* `tmdbId` correspondence is validated
* Movie Mood local IDs remain the final application IDs

## Poster behavior

Where practical without broad component-test infrastructure:

* missing poster path chooses fallback
* failed poster load chooses fallback
* valid poster URL construction is centralized and deterministic

Do not add live-network tests to `pnpm test`.

---

# 28. Phase 1 — TMDB Identity and Synchronization Foundation

Implement the external factual-data foundation without switching the application to it yet.

## Scope

* add `tmdbId` mapping for every current curated movie
* manually verify mappings
* add TMDB synchronization command
* use environment-based API Read Access Token
* exact-ID movie fetching
* fixed localization
* credits/director extraction
* deterministic normalization
* generated factual snapshot
* atomic write behavior
* bounded retry handling
* explicit failure handling
* behavior-impact classification/reporting
* tests for synchronization/mapping/failure logic

The existing application may continue using the current monolithic movie facts during this phase.

Do not add real-poster UI yet.

Do not split the complete application movie model yet unless required minimally for the synchronization foundation.

## Phase 1 Human Review Gate

Before committing the initial TMDB snapshot:

* compare TMDB `runtimeMinutes`, `genres`, and `languages` with V4 values
* if any differ, stop and report them for user review
* do not silently preserve incorrect old values
* do not silently accept behavior-changing new values
* do not modify recommendation algorithms

After explicit user approval of reviewed differences, complete the phase.

## Phase 1 Acceptance

* all current curated movies have one verified `tmdbId`
* no local Movie Mood IDs changed
* `pnpm sync:tmdb` works with a valid token
* missing token fails safely
* hard API/data failures preserve existing snapshot
* transient retries are bounded
* generated snapshot is deterministic
* behavior-impact changes are clearly reported
* no runtime application API calls exist
* existing V1–V4 behavior still runs from old data
* all tests pass
* production build passes
* `git diff --check` passes

Risk: **high**.

---

# 29. Phase 2 — Factual / Editorial Model Separation

Migrate Movie Mood from the monolithic local movie objects to resolved editorial + TMDB snapshot data.

## Scope

* create the curated editorial data layer
* move Movie Mood-owned fields into that layer
* move factual fields to the generated TMDB snapshot
* create/retain a single resolved `Movie[]`
* keep normal application imports simple
* validate one-to-one merge behavior
* remove redundant manually maintained factual values
* preserve all stable local movie IDs
* preserve V4 URL compatibility
* preserve favorites/My List compatibility
* preserve recommendation algorithms
* update/filter dataset-derived options using resolved movie facts

Do not add poster UI yet unless a minimal structural helper is required.

## Important Semantic Rule

TMDB factual values may cause legitimate result changes when existing V1–V4 behavior already depends on:

```text
runtime
genres
languages
```

Do not rewrite algorithms to reproduce previous results artificially.

Instead verify that:

* the algorithm itself is unchanged
* changed behavior is explainable by reviewed factual-data changes

## Phase 2 Acceptance

* application movie data resolves from editorial + generated factual layers
* existing local IDs are unchanged
* existing V4 URLs remain valid
* existing favorites remain addressable by the same IDs
* practical filters still use the same semantics
* dealbreakers still use the same semantics
* More like this uses the same scoring semantics
* Decision Mode still consumes the resolved `Movie` model normally
* no duplicated manually maintained factual metadata remains unnecessarily
* normal build requires no TMDB token
* normal tests require no network
* all tests pass
* production build passes
* `git diff --check` passes

Risk: **high**.

---

# 30. Phase 3 — Real Posters, Attribution, Integration, Documentation

Complete the visible V5 experience and maintainer documentation.

## Scope

* reusable TMDB poster rendering
* centralized image URL construction
* real posters throughout relevant existing views
* CSS/palette poster fallback
* image-load failure fallback
* responsive poster behavior
* accessibility sanity checks
* TMDB Credits/About attribution
* approved TMDB logo
* required attribution notice
* README update
* LEARNING_NOTES update
* document TMDB setup
* document `TMDB_READ_ACCESS_TOKEN`
* document `pnpm sync:tmdb`
* document manual review workflow
* document failure behavior
* document factual/editorial architecture
* final V1–V5 regression review

Do not add new TMDB-derived product features.

## Phase 3 Acceptance

Verify:

* recommendation cards show real posters where available
* More like this works with posters
* My List works with posters
* Movie Details works
* Decision Mode works
* duel works
* Tonight's Pick works
* missing poster paths fall back cleanly
* image CDN failures fall back cleanly
* no broken-image state remains
* attribution is present and compliant
* no TMDB token exists in frontend source/bundle
* `pnpm dev` does not require a token
* `pnpm test` does not require a token
* `pnpm build` does not require a token
* GitHub Pages deployment does not contact the TMDB data API
* existing V4 shared URLs remain valid
* favorites/My List remain compatible
* README and learning notes reflect V5 architecture

Required verification:

```text
pnpm test
pnpm build
git diff --check
```

All must pass.

Risk: **medium/high**.

---

# 31. Real Blockers

The following are legitimate reasons to stop and ask the user:

* repository or remote is incorrect
* unrelated user changes create Git safety risk
* TMDB credential is required but unavailable
* an existing curated movie cannot be mapped confidently to one TMDB movie
* behavior-impacting differences are found during the initial migration and require user review
* TMDB attribution requirements cannot be satisfied with an approved asset
* the specification contains a material contradiction
* required verification cannot be made to pass safely
* implementation would require violating the static/backend-free architecture

Minor implementation decisions are not blockers.

Make reasonable local decisions and continue.

---

# 32. Explicitly Out of V5

Do not opportunistically implement ideas documented in:

```text
docs/POST_V5_IDEAS.md
```

That file is non-normative.

It is not part of V5 acceptance criteria.

V5 explicitly excludes:

* streaming availability
* automated scheduled synchronization
* universal TMDB search
* large-catalogue expansion
* curation automation
* AI annotation
* TMDB accounts
* cloud watchlists
* ratings/popularity ranking
* TV
* self-hosted poster infrastructure
* additional subjective movie taxonomies

---

# 33. V5 Completion Criteria

V5 is complete when:

1. every existing curated Movie Mood movie has one verified TMDB identity
2. Movie Mood local IDs remain unchanged
3. Movie Mood editorial meaning remains locally curated
4. factual movie metadata comes from a committed generated TMDB snapshot
5. synchronization is explicit, validated, deterministic, atomic, and reviewable
6. failed synchronization cannot partially corrupt the snapshot
7. normal builds and deployment require no TMDB credential
8. the browser makes no authenticated TMDB data API calls
9. existing recommendation semantics remain intact
10. behavior-impacting factual changes are reviewable rather than silent
11. real TMDB posters appear where available
12. poster failures degrade to the existing Movie Mood visual fallback
13. TMDB attribution requirements are implemented
14. all V1–V4 flows continue to work
15. tests and production build pass

## V5 in one sentence

> **V5 connects Movie Mood's carefully curated meaning layer to verified real-world TMDB facts and posters through a static, reviewable snapshot—making the movies real without giving the API control over what they mean.**
