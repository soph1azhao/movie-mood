# Movie Mood V7 — Match the Moment Implementation Spec

## Status

Locked for **V7.1 functional implementation**.

Target first V7 checkpoint: `v7.1.0`

Accepted baseline: `v6.0.0`

Released baseline commit:

```text
71615b8 — Implement V6 decision companion
```

This document is the canonical source of truth for V7.1 implementation work.

V7.2 is reserved for a later cinematic visual/interaction pass. V7.2 is **not executable from this document yet** beyond the boundary constraints recorded below; its visual details must be locked separately after the Claude design handoff.

Movie Mood continues to preserve the accepted upstream flow:

```text
Glimpse -> Refine -> Reveal -> Decide
```

and the accepted manual decision flow:

```text
three movies
-> direct choice OR Drop One
-> Duel
-> optional gut check
-> Tonight's Pick
```

V7.1 does not redesign those flows. It removes small points where the existing product gets in the user's way.

---

## Product Goal

Movie Mood's core principle remains:

```text
Streaming platforms help you find more movies.
Movie Mood helps you choose one.
```

V6 established a sufficiently mature single-person decision engine. V7.1 does **not** attempt to make that engine smarter.

V7.1 adopts a deference principle:

```text
Match the moment.
If the user already knows, get out of the way.
If time matters, translate runtime into tonight.
If the user accidentally leaves a shortlist, let them recover it once.
```

Working product thesis:

```text
Movie Mood already knows how to help when the user is undecided.
V7.1 improves how the surrounding product responds when the user is already moving toward a decision.
```

V7.1 should feel obvious rather than feature-heavy. A user should not need to learn a new mode, preference model, or taxonomy.

---

## V7.1 Locked Scope

V7.1 implements only:

1. **Direct Pick — "That's the one"**
   - available only on the primary recommendation **Full Reveal** cards;
   - enters the existing Tonight's Pick state immediately;
   - preserves the current shortlist position when the user chooses `Change my mind`.

2. **Finish-Time Cue — "Ends around XX:XX"**
   - derived only from the existing `runtimeMinutes` fact and the browser's current local time;
   - presented inside existing compact metadata lines;
   - shown only in primary Full Reveal, Duel, and Tonight's Pick.

3. **Single-Step Previous Three**
   - one ephemeral recovery step after `Another three`;
   - current recommendation session only;
   - never serialized into the URL;
   - invalidated whenever the recommendation pool/context changes.

4. **Favorite Affordance Continuity**
   - wire the existing Favorites behavior into Duel and Tonight's Pick;
   - reuse the existing `useFavorites` source of truth;
   - no new persistence model.

Everything else is out of V7.1 unless explicitly added to this specification before implementation.

---

## Architecture Guardrails

V7.1 must preserve the existing architecture:

- Vite;
- React;
- TypeScript;
- plain CSS;
- GitHub Pages;
- no backend;
- no database;
- no accounts;
- no runtime authenticated TMDB API;
- no runtime AI;
- no routing library;
- no global state framework;
- no new dependency unless a genuine blocker is demonstrated.

V7.1 must also preserve:

```text
Movie Mood owns meaning. TMDB owns facts.
```

No new subjective movie metadata is introduced.

No external service is queried at runtime for V7.1.

---

## Frozen V6 Boundary

The V6 decision companion is accepted and frozen.

Do not modify the product semantics of:

- `getDecisionCompanionCue`;
- Salience-First ordering;
- coherence rules;
- V6 salience boundaries;
- V6 outlier mapping;
- `Not tonight`;
- `Keep it in`;
- manual Drop One;
- Duel finalist semantics;
- coin-flip gut-check semantics.

A V7.1 implementation must not reopen V6 algorithm design merely because a nearby component is being edited.

Regression fixes are allowed only if implementation work exposes an actual defect.

---

# Feature 1 — Direct Pick

## User Problem

A user may reach Full Reveal and already know which movie they want.

The current normal recommendation card does not provide a direct transition to Tonight's Pick. Requiring an already-decided user to enter `Help me choose` would make Movie Mood add process after the decision has already happened.

Core rule:

```text
If the user already knows the answer, Movie Mood stops helping.
```

## Entry Surface

Direct Pick is shown only on the **primary recommendation Full Reveal** cards.

Locked behavior:

```text
Glimpse
-> no Direct Pick

Primary Full Reveal
-> Direct Pick available

My List / Favorites
-> no new Direct Pick in V7.1

More Like This
-> no new Direct Pick in V7.1
```

Do not broaden the surface during implementation for consistency alone.

The visible action should use concise human-facing copy such as:

```text
That's the one
```

Minor punctuation typography differences are acceptable, but do not replace it with technical language such as `Select`, `Set Pick`, or `Enter Decision Mode`.

## State Transition

Direct Pick must reuse the existing Decision State shape.

The intended transition is semantically:

```ts
setDecisionState({
  kind: 'pick',
  selectedId: movieId,
})
```

The Direct Pick transition must be **source-less**:

- do not attach a synthetic Duel;
- do not attach a synthetic three-slate;
- do not invent a new DecisionState kind;
- do not create a new Direct Pick state type.

This allows the existing Tonight's Pick view to render without changing the V6 state model.

## Change My Mind Behavior

Direct Pick must preserve the user's current recommendation context.

Example:

```text
user cycles to offset 6
-> opens Full Reveal
-> chooses "That's the one"
-> Tonight's Pick
-> Change my mind
-> returns to the same Full Reveal at offset 6
```

Do not reset recommendation offset to `0`.

Do not collapse the view back to Glimpse.

Do not enter a synthetic three-slate Decision Mode.

The released application already keeps recommendation offset and reveal state in `App`; therefore the Direct Pick path should avoid resetting those values.

For a source-less Pick, the existing `Change my mind -> onExit()` behavior should remain the preferred path.

## URL / Share Semantics

Direct Pick must continue to work with existing pick serialization.

V7.1 does **not** introduce a new URL schema.

Keep the existing Decision URL schema version unless the serialized state shape actually changes.

Specifically:

- do not add `V7_SCHEMA_VERSION` merely because the product version is V7;
- do not serialize recommendation offset for Direct Pick;
- do not serialize Full Reveal state;
- do not change existing V4/V6 compatibility behavior.

The current source-less `pick` state is already a valid portable Decision state and should remain so.

## Component Boundary

Prefer the smallest existing-component extension.

A clean implementation may use optional callback plumbing such as:

```text
App
-> MovieGrid
-> MovieCard
-> onChooseMovie(movieId)
```

The callback must be passed only where Direct Pick is actually allowed.

Do not make `MovieCard` infer global app state.

---

# Feature 2 — Finish-Time Cue

## User Problem

A runtime such as:

```text
116 min
```

is factual but still asks a tired user to convert duration into a real evening consequence.

V7.1 translates the existing runtime fact into:

```text
Ends around 11:24 PM
```

This is presentation, not recommendation logic.

## Data Boundary

Use only:

- `movie.runtimeMinutes`;
- current browser-local time.

Do not add:

- bedtime preference;
- preferred finish time;
- future start-time picker;
- "too late" judgment;
- "great for an early night" judgment;
- schedule/calendar semantics;
- buffer-time assumptions.

The cue describes time. It does not tell the user what they should do.

## Pure/Testable Helper

Implement a deterministic helper with a test-injectable clock, for example:

```ts
getFinishTimeLabel(
  runtimeMinutes: number,
  now: Date = new Date(),
): string
```

The helper should:

1. add `runtimeMinutes` to `now`;
2. format the resulting local clock time;
3. return human-facing copy in the form:

```text
Ends around 11:24 PM
```

Use an explicit, deterministic formatting strategy suitable for the application's English UI.

Required behavior includes correct next-day formatting:

```text
11:10 PM + 140 minutes
-> Ends around 1:30 AM
```

Do not display `tomorrow` unless later explicitly specified.

## No Live Timer

V7.1 does not need a ticking clock.

Do not add:

- `setInterval`;
- minute-by-minute React state;
- background timer state.

The cue may be calculated from current time when the relevant surface renders. Incidental rerenders may naturally update it.

The product value is the approximate finish-time translation, not second-by-second precision.

## Presentation Surfaces

Show the cue only in:

1. primary recommendation **Full Reveal**;
2. Duel;
3. Tonight's Pick.

Do not show it in:

- Glimpse;
- mood selection;
- refinement controls;
- My List cards;
- More Like This cards;
- Decision Companion copy.

If a shared full-card component is used across multiple views, the finish-time cue must be controlled explicitly by prop/context rather than leaking automatically into every `variant="full"` card.

## Visual Placement

Do not create a new standalone card section.

Fold the cue into the existing metadata/facts line.

Examples:

```text
2023 · 116 min · Ends around 11:24 PM
```

Duel may use the existing decision metadata line:

```text
116 min · Ends around 11:24 PM · Drama
```

Tonight's Pick may extend its existing metadata line similarly.

Exact ordering may follow current visual rhythm, but the cue must remain compact and secondary.

## Presentation Helper Boundary

The existing `moviePresentation.ts` is an appropriate home for this behavior.

Do not create a broad time-management subsystem.

`formatCompactFacts()` may remain unchanged if changing it would cause finish-time copy to leak into Favorites or More Like This. Surface-specific composition is preferred over global behavioral leakage.

---

# Feature 3 — Single-Step Previous Three

## User Problem

A user may select `Another three` and immediately realize that a movie in the prior slate was the better choice.

The product should allow one simple recovery without becoming a recommendation-history browser.

Core rule:

```text
Exploration should not make the immediately previous shortlist irretrievable.
```

## Existing Offset Semantics

The released `App` state variable is named `round`, but it is passed directly to `getPicks()` as an offset.

V7.1 may:

- keep the existing name to minimize unrelated refactoring; or
- rename it to a clearer offset name only if the rename is contained and materially improves clarity.

Do not perform a broad refactor merely for naming consistency.

## Ephemeral State

Maintain one component-level value such as:

```ts
previousPickOffset: number | null
```

This state:

- lives in `App`;
- exists only during the current page session;
- is not stored in localStorage;
- is not written into the Decision URL;
- is not part of `DecisionState`;
- is not part of V6 logic.

## Another Three Transition

When `Another three` succeeds:

```text
current offset
-> store as previousPickOffset
-> compute next offset with existing getNextPickOffset()
-> show next three
```

`previousPickOffset` always represents only the slate immediately before the latest `Another three`.

There is no history stack.

## Previous Three Action

After a valid `Another three`, expose:

```text
Previous three
```

in the normal recommendation actions near `Another three`.

On activation:

```text
set current offset = previousPickOffset
set previousPickOffset = null
```

Then preserve the current reveal mode unless another accepted existing behavior requires otherwise.

The action disappears after use.

This intentionally prevents an implicit back/forward history system.

If the user later presses `Another three` again, a fresh one-step previous offset may be recorded.

## Reset / Invalidation Rules

Clear `previousPickOffset` whenever the underlying recommendation pool or recommendation context can change.

At minimum clear it on:

- mood change;
- situation change;
- filter change;
- filter clear;
- discovery preference change;
- discovery preference clear.

Discovery preferences are explicitly included because they change `discoveryPool`.

Also clear the previous offset when leaving the normal recommendation context for a distinct catalogue view such as:

- My List / Favorites;
- More Like This.

Returning to Recommendations starts without a stale Previous Three affordance.

Direct Pick or entering Decision Mode does not need to clear the previous offset; exiting back to the same recommendation slate may preserve the valid one-step recovery state.

## URL Boundary

Previous Three is intentionally non-portable.

Do not modify `urlCodec.ts` to encode:

- current recommendation offset;
- previous recommendation offset;
- recommendation-history state.

Do not bump URL schema version for this feature.

A shared Decision URL should continue to encode the decision state, not the user's transient browsing navigation.

---

# Feature 4 — Favorite Affordance Continuity

## User Problem

Favorites already exist on ordinary Movie Mood cards, but the affordance disappears in later decision surfaces.

V7.1 restores access to the same existing favorite action in:

- Duel;
- Tonight's Pick.

This is continuity of an existing capability, not a new collection system.

## State / Persistence Boundary

Reuse the existing:

```text
useFavorites()
```

source of truth in `App`.

Pass only the existing favorite semantics into DecisionMode:

- check whether a movie is favorite;
- toggle that movie's favorite state.

Do not create:

- separate DecisionMode favorite state;
- separate localStorage key;
- automatic favorite-on-pick behavior;
- favorite ranking;
- favorite-aware recommendation scoring.

## UI Boundary

Use the existing heart/favorite language and accessibility semantics where practical.

Required:

- visible state;
- `aria-pressed`;
- movie-specific accessible label;
- keyboard-operable button.

V7.1 adds favorite affordance only to:

```text
Duel finalist cards
Tonight's Pick
```

Do not add a new favorite control to the three-slate Decision Mode in this version unless this specification is explicitly amended.

Do not redesign the full favorite/My List system.

## Implementation Cost Note

Although this is conceptually simple, treat it as normal prop/UI wiring rather than assuming it is literally a three-line patch.

The implementation must preserve accessibility and existing component boundaries.

---

# V7.2 Reserved Boundary — Cinematic Expression

V7.2 is a separate later phase.

Its purpose is:

```text
Keep V7.1 semantics stable.
Change how the experience feels.
```

Candidate V7.2 territory already reserved for later design work includes:

- cinematic visual identity;
- typography system;
- ambient visual treatment;
- editorial/card physicality;
- restrained micro-motion;
- mobile-specific cinematic composition;
- Duel tension;
- tactile 3D coin presentation;
- `prefers-reduced-motion` fallback;
- Tonight's Pick closure;
- outbound WatchAction hierarchy;
- visual treatment of Direct Pick, Finish-Time Cue, and Previous Three.

The later Claude visual handoff may refine this list.

V7.2 must not silently introduce:

- new recommendation semantics;
- new DecisionState kinds;
- new preference dimensions;
- new filtering logic;
- new V6 companion logic.

Do not implement V7.2 from this document before its visual direction is explicitly locked.

---

# Explicit V7.1 Non-Goals

V7.1 does not implement:

- Seen It / watched history;
- watched-date tracking;
- ratings;
- reviews;
- diary/logging;
- curated catalogue search;
- Browse mode;
- semantic search;
- new catalogue metadata;
- subtitle-availability claims;
- dialogue-density claims;
- cold-open/hook-time claims;
- viewing-posture recommendations;
- calendar export;
- future scheduling;
- user-configurable start time;
- streaming subscription filtering;
- provider availability APIs;
- group voting;
- Movie Mood Together;
- Share Shortlist;
- new share-state schema;
- new recommendation scoring;
- new decision dimensions;
- automatic opponent selection;
- automatic top-two selection;
- new V6 salience/coherence rules;
- runtime-triggered V6 logic;
- AI/ML recommendation;
- backend/account infrastructure.

---

# Existing Behavior That Must Survive

Preserve without regression:

- mood selection;
- immediate three-film Glimpse;
- Refine tonight;
- Full Reveal;
- `Another three`;
- situation/filter/discovery behavior;
- dealbreakers;
- More Like This;
- My List;
- existing Favorites persistence;
- Help Me Choose;
- V6 selective Decision Companion;
- manual Drop One;
- undo manual drop;
- Duel;
- Back to all three;
- pairwise decision copy;
- coin flip;
- gut check;
- Tonight's Pick;
- Change My Mind;
- existing WatchAction links;
- Share Pick;
- V4/V6 Decision URL decoding;
- GitHub Pages deployment.

---

# Implementation Phases

## Phase 1 — Direct Pick

Implement only Direct Pick.

Expected work:

- add optional Direct Pick callback plumbing through the normal recommendation grid/card path;
- render `That's the one` only on primary Full Reveal cards;
- transition directly to source-less existing `pick` state;
- verify Tonight's Pick renders normally;
- verify `Change my mind` returns to the same Full Reveal / current pick offset;
- preserve existing sharing and WatchAction behavior;
- do not alter URL schema.

### Phase 1 Acceptance

- no Direct Pick on Glimpse;
- Direct Pick visible on primary Full Reveal;
- no new Direct Pick in Favorites or More Like This;
- clicking Direct Pick reaches the existing Tonight's Pick;
- `Change my mind` returns to the same recommendation slate and Full Reveal;
- V6 logic unchanged;
- tests/build pass.

---

## Phase 2 — Finish-Time Cue

Implement only finish-time presentation.

Expected work:

- add `getFinishTimeLabel(runtimeMinutes, now = new Date())`;
- add deterministic helper tests with a pinned clock;
- cover same-day and after-midnight outcomes;
- show finish time in primary Full Reveal compact facts;
- show finish time in Duel metadata;
- show finish time in Tonight's Pick metadata;
- do not add timer state;
- do not leak the cue into Glimpse, Favorites, or More Like This.

### Phase 2 Acceptance

- exact helper behavior is deterministic under injected `now`;
- runtime remains unchanged as a fact;
- finish-time copy is descriptive only;
- no bedtime judgment exists;
- no scheduling UI exists;
- no live interval exists;
- required surfaces show the cue;
- excluded surfaces do not;
- tests/build pass.

---

## Phase 3 — Previous Three

Implement only single-step shortlist recovery.

Expected work:

- add one ephemeral previous-offset state value;
- store current offset before `Another three`;
- show `Previous three` only when a valid prior offset exists;
- restore the prior offset once;
- clear the previous value immediately after restoration;
- reset it on every locked invalidation condition;
- keep it out of DecisionState, localStorage, and URL codec.

### Phase 3 Acceptance

- no Previous Three before cycling;
- one `Another three` exposes Previous Three;
- Previous Three restores exactly the immediately prior slate;
- the action disappears after restoration;
- a later new `Another three` may create a fresh one-step recovery;
- pool/context changes remove stale Previous Three;
- Favorites / More Like This navigation removes stale Previous Three;
- URL serialization is unchanged;
- tests/build pass.

---

## Phase 4 — Favorite Affordance Continuity

Implement only existing Favorites wiring in Duel and Tonight's Pick.

Expected work:

- pass favorite state/toggle capability from App into DecisionMode;
- show accessible favorite controls for Duel finalists;
- show an accessible favorite control on Tonight's Pick;
- reuse the existing Favorites storage behavior;
- avoid adding favorite controls elsewhere in DecisionMode.

### Phase 4 Acceptance

- Duel finalists accurately show favorite state;
- favorite can be toggled in Duel;
- Tonight's Pick accurately shows favorite state;
- favorite can be toggled at Tonight's Pick;
- state remains synchronized with My List;
- no new storage key/state model exists;
- three-slate DecisionMode is not expanded with new favorite controls;
- tests/build pass.

---

# Required Automated Tests

Use existing Vitest tooling. Do not add a UI testing framework solely for V7.1.

At minimum add/update tests for:

## Finish Time

- deterministic same-day label using fixed `now`;
- after-midnight label;
- representative runtime;
- formatting output expected by the English UI.

## Presentation

- Full Reveal can include finish-time cue when explicitly enabled;
- Glimpse does not include finish time;
- existing compact-facts behavior remains valid where finish time is disabled.

## DecisionMode

- Duel markup includes finish-time cues;
- Tonight's Pick markup includes finish-time cue;
- Duel can render existing favorite state/action;
- Tonight's Pick can render existing favorite state/action;
- existing V6 Form-B and Silence tests continue to pass.

## URL Codec

No new V7 URL behavior is required.

Existing `urlCodec` tests must remain green.

Do not rewrite codec tests merely to label the product version V7.

## Cycling

Existing `picks` tests must remain green.

Add focused test coverage for any new pure offset helper only if such a helper is introduced. Do not create abstractions solely to make state wiring testable.

---

# Focused Manual Verification

After all four phases are integrated, manually verify at least:

1. choose mood -> Glimpse:
   - no Direct Pick;
   - no finish-time cue.

2. Full Reveal:
   - `That's the one` appears;
   - finish-time cue appears;
   - normal More Details / Favorites behavior remains.

3. Direct Pick:
   - select a movie from a non-zero recommendation offset;
   - Tonight's Pick appears;
   - Share Pick works;
   - WatchAction remains present;
   - Change My Mind returns to the same Full Reveal slate.

4. Another Three:
   - cycle once;
   - Previous Three appears;
   - restore previous slate;
   - Previous Three disappears.

5. Invalidation:
   - cycle;
   - change mood/situation/filter/discovery preference;
   - stale Previous Three is gone.

6. Duel:
   - V6/manual route still reaches exact two finalists;
   - finish-time cues appear;
   - favorite controls work;
   - coin flip and gut check remain unchanged.

7. Tonight's Pick:
   - finish-time cue appears;
   - favorite control works;
   - Change My Mind still respects the source path;
   - Share Pick and outbound WatchAction remain intact.

8. Existing V6 companion:
   - one known Form-B case still fires;
   - one known conflicting-salient case remains silent.

---

# Validation

Before V7.1 is accepted, run:

```text
pnpm test
pnpm build
```

Both must pass.

Because V7.1 touches normal recommendation navigation and DecisionMode presentation, also perform the focused manual verification above.

If deployed for release, verify the GitHub Pages deployment and perform production smoke checks for:

- Full Reveal Direct Pick;
- Finish-Time Cue;
- Previous Three;
- Duel favorite;
- Tonight's Pick favorite;
- Change My Mind.

---

# Acceptance Criteria

V7.1 is accepted only if:

1. Direct Pick exists only on the locked primary Full Reveal surface;
2. Direct Pick reuses the existing source-less `pick` state;
3. Direct Pick does not reset recommendation offset or reveal state;
4. Direct Pick `Change my mind` returns to the same Full Reveal slate;
5. no new URL schema is introduced;
6. Finish-Time Cue uses only runtime plus current local time;
7. Finish-Time Cue is testable with an injected fixed clock;
8. Finish-Time Cue appears only on the locked surfaces;
9. no live timer, scheduling UI, or bedtime judgment exists;
10. Previous Three is exactly one-step and ephemeral;
11. Previous Three is invalidated whenever its recommendation pool/context is no longer valid;
12. Previous Three never enters URL or persistent state;
13. Favorites in Duel/Tonight's Pick reuse existing favorite state and persistence;
14. no new recommendation logic or V6 decision logic is introduced;
15. V5.2/V6 behaviors remain intact;
16. existing URL-state compatibility remains intact;
17. automated tests pass;
18. production build passes;
19. focused manual verification passes.

Only after these criteria pass should V7.1 be considered ready for release/tagging.

---

# Release / Sequencing Boundary

The intended sequence is:

```text
v6.0.0
-> V7.1 Functional Deference
-> v7.1.0 release checkpoint
-> Claude visual-system handoff
-> V7.2 Cinematic Expression specification update
-> V7.2 implementation
```

Do not start V7.2 merely because V7.1 is complete.

V7.2 requires its own locked visual/product direction before code changes begin.
