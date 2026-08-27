# Movie Mood V4 — Implementation Specification

## 1. Project Context

**Project:** Movie Mood
**Repository:** `soph1azhao/movie-mood`
**Stack:** Vite + React + TypeScript + plain CSS
**Hosting:** GitHub Pages
**Data:** local curated TypeScript movie dataset

V3 is complete.

V3 provides:

* six mood-first entry points
* optional viewing situations
* genre, runtime, language, pace, and emotional-weight filters
* three movie choices at a time
* situation fallback behavior
* richer movie details
* browser-local favorites and My List
* local CSS-generated posters
* attention-demand and discovery-style experience preferences
* explicit dealbreakers
* "More like this" discovery

---

## 2. V4 Product Goal

Movie Mood V4 helps finish the choice: when three good movies still feel like too many, **Help Me Choose** surfaces the differences that matter tonight, supports a lightweight final duel and optional gut check, and turns the result into a shareable Tonight's Pick.

The implementation must remain:
* static
* local-first
* transparent
* small
* backend-free
* account-free
* understandable
* deterministic except for the explicitly identified coin flip

Do not introduce numerical recommendation systems, new movie taxonomies, or external APIs.

---

## 3. V4 Scope

### Included

* `Help me choose` button on the three-movie slate
* three-film Decision Mode
* concise relative cues showing why movies differ
* direct `Choose this tonight` from the three
* intentional narrowing to two
* lightweight duel view with decisive differences
* return from duel to three-film state
* gut-check `Flip a coin` for the two finalists
* post-flip `How does that feel?` confirmation step
* final `Tonight's Pick` state
* deterministic `Why it fits tonight` explanation
* `Change my mind` to return to prior decision context
* URL-state serialization for V4 modes
* state reset when upstream preferences change
* native Web Share API with clipboard fallback

### Explicitly Deferred to V5

* TMDb integration
* official movie posters/backdrops
* API authentication
* build-time or runtime movie API fetching
* API caching
* feature images

---

## 4. Decision Mode State Types

### 4.1 DecisionModeSchemaVersion

```ts
export type DecisionModeSchemaVersion = 'v4'
```

### 4.2 DecisionState

The decision state has three phases:

```ts
export type DecisionState =
  | { kind: 'three-slate', movieIds: [string, string, string] }
  | { kind: 'duel', finalistIds: [string, string] }
  | { kind: 'pick', selectedId: string }
```

### 4.3 DecisionModeState

Complete V4 decision state includes the context needed to restore:

```ts
export interface DecisionModeState {
  schemaVersion: DecisionModeSchemaVersion
  mood: string
  situation: string | null
  filters: MovieFilters
  discoveryPreferences: DiscoveryPreferences
  decisionState: DecisionState
}
```

---

## 5. URL State Codec

### 5.1 URL Format

```
?mode=decision&m=...&s=...&filters=...&discovery=...&state=...
```

- `mode=decision` indicates V4 decision mode
- All other parameters encode the upstream recommendation context
- `state` encodes the decision phase (three-slate | duel | pick)

### 5.2 Encoding/Decoding

Create `src/utils/urlCodec.ts`:

```ts
export function encodeDecisionState(state: DecisionModeState): string
export function decodeDecisionState(url: string): DecisionModeState | null
```

Degenerate/stale URLs should decode to `null` for graceful degradation.

---

## 6. Comparison Utility

### 6.1 MovieComparison

```ts
export interface MovieComparison {
  movieId: string
  differences: string[]
}

export function compareMoviesForDuel(
  first: Movie,
  second: Movie,
  context: Pick<Mood, 'id'>
): MovieComparison
```

### 6.2 Why It Fits Tonight

```ts
export function whyItFitsTonight(
  movie: Movie,
  options: {
    mood: Mood
    situation: ViewingSituation | null
    filters: MovieFilters
  }
): string[]
```

Returns an array of concise reasons (the user's corrections mention "concise differences" and "one or two strongest deciding factors").

---

## 7. Phase 1 Acceptance Criteria

### Must Pass

* existing V1–V3 behavior remains unchanged
* decision logic uses only existing metadata
* active preferences influence deciding-factor priority
* no numerical recommendation system is introduced
* no new movie taxonomy is introduced
* decision logic is deterministic
* URL state round-trips supported values
* malformed URL values degrade safely
* schema version is represented
* existing tests continue to pass
* new targeted tests pass
* production build passes

### Verification

```text
pnpm test
pnpm build
```

### Risk: high

This phase defines reusable V4 decision/state behavior that interacts with existing application behavior.

---

## 8. Implementation Phases

### Phase 1 — Decision and URL Foundations

Implement the reusable non-UI foundations.

#### Scope

* V4 decision-state types or equivalent state structure
* pure decision comparison utility
* relative-cue logic
* context-aware deciding-factor priority
* deterministic `Why it fits tonight` helper
* URL-state schema/version
* URL codec
* URL-value validation
* required unit tests

Do not add the complete V4 Decision Mode UI yet.

---

### Phase 2 — Help Me Choose and Decision Closure

Implement the V4 decision experience.

#### Scope

* `Help me choose`
* three-film Decision Mode
* concise relative cues
* direct `Choose this tonight`
* optional narrowing to two
* lightweight duel view
* one or two strongest deciding factors
* return from duel to three-film state
* gut-check `Flip a coin`
* reduced-motion-compatible coin behavior
* post-flip `How does that feel?`
* confirmation of either finalist
* `Tonight's Pick` / Tonight's Ticket

---

### Phase 3 — Sharing, Restoration, Integration, Documentation

Complete V4.

#### Scope

* initialize application state from valid V4 URLs
* restore recommendation context
* restore three-film Decision Mode
* restore duel state
* restore valid Tonight's Pick
* ongoing URL synchronization
* native Web Share
* clipboard fallback
* accessible share feedback
* responsive Decision Mode
* responsive duel
* responsive Tonight's Pick
* accessibility sanity checks
* final V1–V4 regression review
* README update
* LEARNING_NOTES update
* document V4 architecture and URL-state behavior

#### Acceptance Criteria

A fresh valid URL can restore:

* normal Movie Mood preference context
* Decision Mode candidates
* duel finalists
* Tonight's Pick

Malformed or stale URLs degrade safely.

---

## V4 Completion Status

V4 implementation is complete.

* Phase 1 completed the decision-state foundation, context-aware deciding factors, deterministic `Why it fits tonight` logic, versioned URL codec, runtime URL validation, movie-ID validation, decision-context preservation, decoder isolation, and targeted tests.
* Phase 2 completed Help Me Choose, three-film Decision Mode, direct selection, two-film duel, context-aware deciding factors, intentional finalist selection, the coin-flip gut check, Tonight's Pick, Change my mind, and incompatible-state reset behavior.
* Phase 3 completed initial restoration from valid V4 URLs, ongoing Decision Mode URL synchronization using browser-native history replacement, native Web Share with clipboard fallback, accessible share feedback, and V4 README / learning-note documentation.
* Final automated verification currently reports:
  * `pnpm test`: 64 tests passed
  * `pnpm build`: passed
  * `git diff --check`: passed
* Overlapping active user-intent signals are treated as meaningful decision dimensions rather than independently double-counted.
* The coin flip is only a gut-check between the two current finalists. The user can accept the coin-selected movie or explicitly choose the other finalist.
* Invalid or stale V4 decision URLs currently degrade safely to normal application state rather than attempting partial upstream-context restoration.
* No numerical recommendation scoring, backend, account system, external movie API, routing dependency, or new subjective movie taxonomy was introduced in V4.
