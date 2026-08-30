# Movie Mood V7 — Match the Moment Implementation Spec

## Status

V7.1 is **released and frozen** at:

```text
v7.1.0 — Movie Mood V7.1 — Match the Moment
4bf51ce — Implement V7 Phase 4 — Favorite Affordance Continuity
```

V7.2 is **locked for visual / interaction implementation**.

V7.2 changes presentation and interaction feel only.

Accepted baseline: `v6.0.0`

Original V7.1 released baseline commit:

```text
71615b8 — Implement V6 decision companion
```

This document is the canonical source of truth for both V7.1 (accepted history) and V7.2 (locked active implementation).

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

# V7.2 — Earned Atmosphere

## Status

Locked for **V7.2 visual / interaction implementation** after the released V7.1.0 checkpoint.

V7.1 is accepted and frozen.

V7.2 changes presentation and interaction feel only.

It must preserve the accepted product flows:

```text
Glimpse -> Refine -> Reveal -> Decide
```

and:

```text
three movies
-> direct choice OR Drop One
-> Duel
-> optional gut check
-> Tonight's Pick
```

---

## Product Thesis — Earned Atmosphere

V7.2 follows one visual rule:

```text
Visual weight increases as commitment increases.
```

Movie Mood already has a visual identity.

V7.2 does **not** redesign that identity from scratch.

Instead:

```text
Glimpse stays light.
Refine stays useful.
Full Reveal stays considered.
Three-slate feels like narrowing.
Duel gains tension.
Tonight's Pick gains stillness and closure.
```

The interface earns more atmosphere only as the user gets closer to one movie.

Core test:

```text
Does this visual decision help the user feel closer to pressing Play?
```

If not, remove it.

---

## Existing Visual Identity — Preserve

The released V7.1 application already has a coherent visual language:

- dark evening background;
- warm amber / gold accents;
- DM Sans body typography;
- DM Mono metadata / eyebrow typography;
- Playfair Display editorial emphasis;
- subtle ambient radial light;
- thin borders;
- restrained radii;
- poster-led cards;
- existing card entrance motion;
- existing `prefers-reduced-motion` fallback.

V7.2 must build on this system.

Do not replace the typography stack.

Do not redesign the palette.

Do not introduce a new UI framework, animation framework, or component library.

Do not perform a broad design-system rewrite.

---

## Protected Upstream Surfaces

The following surfaces are intentionally outside V7.2 redesign scope:

### Glimpse

Current Glimpse already shows only:

- poster;
- Glimpse label;
- movie title;
- `curiosityHook`.

Preserve this lightweight state.

Do not add:

- finish time;
- favorite;
- Direct Pick;
- metadata blocks;
- glow effects;
- card tilt;
- parallax;
- extra hover motion;
- extra editorial copy.

### Refine

Situation, discovery preferences, dealbreakers, and filters remain utility surfaces.

Do not cinematicize them.

Preserve their existing chip / panel interaction language unless a regression fix is required.

### Mood Entry

Do not introduce a global mood-reactive background system.

Do not add heavy animation or per-mood cinematic scenes.

Existing mood selection semantics and visual structure remain intact.

### Full Reveal

V7.2 does not perform a full information-architecture rewrite of Full Reveal or `MovieDetails`.

Direct Pick, finish-time cue, favorites, More Like This, and More Details behavior remain unchanged.

Minor class-role adjustments needed to safely style downstream actions are allowed.

---

## Locked V7.2 Scope

V7.2 implements only four user-visible areas:

1. **Tonight's Pick Closure**
2. **WatchAction Hierarchy**
3. **Duel Atmosphere**
4. **Tactile Coin**

One implementation prerequisite is also allowed:

5. **Semantic action-role class modifiers**

This prerequisite exists only to prevent shared CSS classes from leaking downstream visual changes into unrelated controls.

It is not a new product feature and must not become a design-system rewrite.

---

## V7.2 Architecture Guardrails

Preserve:

- Vite;
- React;
- TypeScript;
- plain CSS;
- GitHub Pages;
- existing state architecture;
- existing DecisionState types;
- existing URL codec;
- existing TMDB snapshot model;
- existing Favorites persistence;
- existing WatchAction URL builders.

Do not add:

- backend;
- database;
- accounts;
- runtime AI;
- runtime authenticated TMDB API;
- provider availability API;
- routing library;
- global state framework;
- animation library unless native CSS is proven insufficient.

For the locked V7.2 scope, native CSS is expected to be sufficient.

---

## Frozen V7.1 Semantics

V7.2 must not change the semantics of:

- `getDecisionCompanionCue`;
- Salience-First logic;
- V6 coherence logic;
- `Not tonight`;
- `Keep it in`;
- manual Drop One;
- Duel finalist selection;
- `Back to all three`;
- pairwise decision copy;
- Direct Pick;
- finish-time cue;
- Previous Three;
- Favorites behavior;
- Share Pick;
- Change My Mind;
- WatchAction destinations;
- coin winner selection;
- gut-check meaning.

The coin remains a gut-check mechanism, not an authority.

The product meaning remains:

```text
The random result reveals the user's reaction.
It does not decide for the user.
```

---

## V7.2 Implementation Prerequisite — Semantic Action Roles

### Problem

Current shared classes such as `.details-toggle` and `.another-button` span multiple unrelated roles, including:

- disclosure;
- commit;
- reversal;
- navigation;
- outbound links.

V7.2 needs to change visual hierarchy downstream without accidentally restyling unrelated upstream controls.

### Required approach

Prefer small semantic modifiers rather than new component architecture.

Conceptually acceptable roles include:

```text
commit
secondary
quiet
disclosure
navigation
```

Exact class names are implementation details.

Requirements:

- preserve native `<button>` / `<a>` semantics;
- preserve existing focus-visible behavior;
- preserve keyboard access;
- avoid broad markup refactors;
- do not introduce a Button component solely for V7.2;
- do not replace existing classes everywhere if a modifier is sufficient.

Core rule:

```text
Modifier, not rewrite.
```

---

## V7.2 Feature 1 — Tonight's Pick Closure

### Product Goal

Tonight's Pick should communicate:

```text
The decision is made.
This is tonight.
```

The existing screen already contains the right functional pieces.

V7.2 should improve hierarchy, not add information.

### Preserve

Keep:

- poster;
- title;
- year;
- director;
- runtime;
- finish-time cue;
- `vibeSummary`;
- Why It Fits Tonight reasons;
- WatchAction;
- Favorite;
- Share Pick;
- Change My Mind;
- Back to Browsing.

Do not add:

- another confirmation button;
- committed / confirmed boolean state;
- celebration effects;
- autoplay trailer;
- new recommendation reasoning;
- new share state.

### Hierarchy

The movie itself must dominate.

Desired ordering:

```text
Movie identity / poster
-> why it fits
-> primary real-world next action
-> supporting utilities
-> reversal / exit actions
```

#### Primary next action

The strongest downstream action should be:

```text
Find where to watch
```

This should use the existing general where-to-watch search destination.

#### Supporting actions

Keep:

- Favorite;
- Share Pick.

These should remain useful but must not visually compete with the watch action.

#### Reversal / exit

Keep:

- Change My Mind;
- Back to Browsing.

Both should be visually quieter than the primary next action.

`Back to browsing` must no longer compete as a primary CTA with `Share pick`.

### Visual treatment

Increase closure through:

- stronger poster presence where space allows;
- more negative space;
- clearer title dominance;
- restrained supporting metadata;
- more separation between decision content and utility controls;
- reduced competition among buttons.

Do not turn the screen into literal ticket skeuomorphism.

Do not add confetti or theatrical celebration.

### Motion

A subtle entrance treatment is allowed.

Use CSS-only arrival animation if it improves the shift into the final state.

Do not stage or delay DecisionState transitions.

Do not retain the previous screen to animate it out.

Rule:

```text
Animate the arriving state, not the state transition machinery.
```

Reduced-motion users must receive the final layout immediately.

---

## V7.2 Feature 2 — WatchAction Hierarchy

### Product Goal

The user who has chosen a movie should have one obvious next step:

```text
Find where to watch
```

Movie Mood still does not verify streaming availability.

### Existing destinations

Preserve the existing outbound destinations:

- general where-to-watch search;
- TMDB;
- Letterboxd;
- JustWatch.

Do not change URL-builder semantics unless fixing an actual defect.

### Locked hierarchy

#### Primary

Use the existing general search as:

```text
Find where to watch
```

It should receive clear primary treatment.

#### Secondary

Keep the service-specific destinations as secondary:

```text
JustWatch
Letterboxd
TMDB
```

Exact secondary ordering may follow existing product conventions, but they must not visually compete with the primary search.

### Disclaimer

Preserve:

```text
Movie Mood does not verify streaming availability.
```

Do not add:

- provider logos;
- availability badges;
- subscription state;
- region detection;
- streaming-provider API;
- claims that a movie is currently available somewhere.

### Accessibility

Preserve normal anchor behavior.

Do not rely on visual styling alone to communicate destination.

Existing external-link safety (`target="_blank"` + `rel="noopener noreferrer"`) must survive.

---

## V7.2 Feature 3 — Duel Atmosphere

### Product Goal

Duel should feel different from three-slate browsing because only two finalists remain.

It should create restrained tension without becoming competitive spectacle.

### Preserve

Keep:

- exact finalist IDs;
- exact pairwise decision copy;
- favorite controls;
- finish-time cues;
- choose actions;
- Back to All Three;
- coin gut-check route.

Do not add:

- score bars;
- percentages;
- winner badges;
- versus iconography;
- recommendation confidence;
- automatic winner styling.

### Desktop composition

Increase the sense of finality using:

- slightly stronger poster presence;
- deliberate negative space between finalists;
- quieter surrounding chrome;
- clearer separation between finalist cards and `duel-differences`;
- more breathing room before the coin panel.

The two cards should feel like finalists, not two generic grid cards.

### Mobile composition

Do not force desktop confrontation onto narrow screens.

At mobile widths, prefer a deliberate vertical sequence.

Conceptual rhythm:

```text
Finalist 1
-> comparison breathing space
-> Finalist 2
-> deciding differences
-> gut check
```

Do not use horizontal overflow or force two narrow columns.

### Motion

A small CSS-only Duel entrance is optional.

If used:

- animate the arriving Duel state;
- keep it short;
- do not animate the discarded movie out;
- do not delay state transitions.

Reduced-motion fallback should render the final Duel immediately.

---

## V7.2 Feature 4 — Tactile Coin

### Product Goal

Upgrade the existing styled coin button and result-settle treatment into a short tactile flip.

The coin remains a gut check.

### State Model

Keep state minimal.

Conceptually:

```text
idle
-> flipping
-> result
```

Do not build a multi-stage animation state machine.

Winner selection may remain immediate at click time.

The visible result should appear after the short flip animation completes.

### Interaction

Existing trigger remains:

```text
Flip a coin
```

Expected sequence:

```text
click
-> determine winner
-> short physical flip
-> settle
-> reveal existing Gut check result
-> "How does that feel?"
```

The full sequence should feel immediate, not suspenseful.

### Timing

Target philosophy:

```text
roughly 600–800 ms total
```

This is guidance, not a requirement for exact millisecond values.

Avoid multi-second animation.

### Visual treatment

Native CSS 3D is preferred.

Use:

- transform / rotateY or equivalent;
- perspective;
- `transform-style: preserve-3d`;
- `backface-visibility` as appropriate.

No animation library is expected.

No canvas or WebGL.

No sound.

No confetti.

No slot-machine / roulette treatment.

No casino colors or flashing effects.

### Result

After the coin settles, preserve the existing result semantics and controls:

- winner name;
- `Gut check`;
- `How does that feel?`;
- `Go with the coin`;
- choose the other finalist.

Do not remove the user's ability to reject the random result.

### Reduced Motion

Under `prefers-reduced-motion: reduce`:

- do not perform 3D spinning;
- reveal a settled result immediately or near-immediately;
- preserve the same Gut check semantics;
- do not require motion to understand who the result is.

Avoid adding artificial delay solely to imitate the full animation.

Accessibility takes priority over preserving a dramatic pause.

### Repeat flip

If the existing UI allows another flip only through normal state flow, preserve that behavior.

Do not add gambling-like repeated-spin affordances or counters.

---

## V7.2 Motion Policy

### MUST

- tactile coin flip.

### NICE

Only if achieved with simple CSS and no state complexity:

- Duel arrival;
- Tonight's Pick arrival.

### REJECT

- Glimpse hover tilt;
- poster parallax;
- recommendation cycling animation;
- filter / chip animation beyond existing transitions;
- loser card visibly receding before Pick;
- elaborate Direct Pick transition;
- retained outgoing-screen transition;
- autoplay background movement;
- global mood-reactive animation;
- confetti;
- cinematic intro splash.

Core rule:

```text
Motion must explain or deepen a meaningful downstream moment.
It must not become atmosphere wallpaper.
```

---

## V7.2 Responsive Requirements

V7.2 must be designed and verified at both desktop and narrow mobile widths.

### Tonight's Pick

Desktop may preserve poster + copy composition.

Mobile should remain readable as a single-column composition with:

- poster;
- title / metadata;
- Why It Fits;
- primary watch action;
- supporting actions;
- quiet reversal actions.

Do not allow action hierarchy to collapse into a stack of visually identical full-width buttons.

### Duel

Desktop may use spatial opposition.

Mobile must use intentional vertical sequencing.

### Coin

Coin must remain comfortably tappable and legible.

Do not let 3D transforms create horizontal overflow.

---

## V7.2 Accessibility Requirements

Preserve or improve:

- native button / anchor semantics;
- keyboard operability;
- visible focus states;
- `aria-pressed` favorite state;
- movie-specific accessible labels;
- sufficient contrast;
- readable text independent of poster imagery;
- `prefers-reduced-motion`.

Do not hide essential information inside motion.

Do not use hover as the only way to reveal a control.

Do not suppress focus outlines for visual polish.

---

## Explicit V7.2 Non-Goals

Do not implement:

- Glimpse redesign;
- Refine redesign;
- mood-reactive background system;
- new font system;
- new color palette;
- broad typography rewrite;
- global card redesign;
- Full Reveal information-architecture rewrite;
- MovieDetails redesign;
- general design-system rewrite;
- new Button component framework;
- animation library;
- page-transition state machine;
- parallax;
- card tilt;
- poster hover 3D;
- autoplay trailers;
- sound;
- confetti;
- literal ornate ticket UI;
- provider logos;
- provider availability claims;
- new streaming API;
- new preference model;
- new recommendation logic;
- new DecisionState type;
- URL schema change;
- new V6 companion logic;
- new V7.1 behavior.

---

## V7.2 Implementation Phases

### Phase 1 — Action Hierarchy + Tonight's Pick + WatchAction

Implement only:

- semantic action-role modifiers needed for safe styling;
- Tonight's Pick action hierarchy;
- WatchAction primary / secondary hierarchy;
- restrained Tonight's Pick closure styling.

Do not change Duel or coin behavior in this phase.

#### Expected files

Likely:

- `src/components/DecisionMode.tsx`
- `src/components/WatchAction.tsx`
- `src/styles.css`
- focused existing tests if markup / labels change

Avoid unrelated files.

#### Phase 1 Acceptance

- `Find where to watch` is the clear primary next action;
- existing general search URL behavior is reused;
- JustWatch / Letterboxd / TMDB remain available as secondary destinations;
- disclaimer remains;
- Favorite and Share Pick remain available but subordinate;
- Change My Mind and Back to Browsing remain available but visually quiet;
- Back to Browsing is no longer a competing primary action;
- no V7.1 semantics change;
- no upstream control styling regression;
- keyboard / focus behavior remains intact;
- mobile hierarchy remains understandable;
- tests/build pass.

---

### Phase 2 — Duel Atmosphere

Implement only Duel visual composition.

Expected work:

- stronger finalist presence;
- deliberate desktop spacing;
- clearer separation of deciding differences;
- quieter surrounding UI;
- intentional mobile vertical composition;
- optional CSS-only Duel entrance if it adds value without state complexity.

Do not implement coin animation in this phase.

#### Expected files

Likely:

- `src/components/DecisionMode.tsx` only if small semantic wrappers/classes are needed;
- `src/styles.css`.

#### Phase 2 Acceptance

- exact Duel finalist semantics unchanged;
- pairwise copy unchanged;
- favorite and finish-time behavior unchanged;
- Back to All Three unchanged;
- desktop finalists feel visually distinct from generic cards;
- mobile remains single-column and deliberate;
- no horizontal overflow;
- no score / versus / winner treatment;
- reduced-motion remains valid;
- tests/build pass.

---

### Phase 3 — Tactile Coin

Implement only tactile coin interaction.

Expected work:

- minimal `flipping` presentation state if required;
- preserve existing random winner selection;
- delay visible result only for the short flip;
- native CSS 3D coin treatment;
- reduced-motion fallback;
- retain existing gut-check controls and semantics.

#### Expected files

Likely:

- `src/components/DecisionMode.tsx`
- `src/styles.css`
- `src/components/DecisionMode.test.tsx` or focused equivalent

No new dependency.

#### Phase 3 Acceptance

- click still selects one of the exact two finalist IDs;
- visual coin flips briefly before result appears under normal motion settings;
- result settles in under roughly one second;
- no multi-stage suspense;
- no casino / game-show styling;
- Gut check copy remains;
- user can still choose the other finalist;
- reduced-motion path does not rely on spinning;
- no animation library;
- no DecisionState schema change;
- tests/build pass.

---

### Phase 4 — Integrated Visual Acceptance

Do not add features.

Do not broaden scope.

Review the integrated V7.2 result only.

Allowed work:

- small spacing corrections;
- responsive fixes;
- contrast fixes;
- focus-state fixes;
- animation timing refinement;
- overflow fixes;
- class leakage corrections.

Not allowed:

- new visual concepts;
- new surfaces;
- new animations;
- upstream redesign;
- "while we're here" cleanup.

#### Phase 4 Acceptance

V7.2 should satisfy:

```text
Glimpse remains light.
Duel feels narrower and more consequential.
Coin feels tactile but not playful/casino-like.
Tonight's Pick feels resolved.
The next real-world action is obvious.
```

---

## V7.2 Required Automated Verification

Use existing Vitest tooling.

Do not add a new UI testing framework solely for V7.2.

At minimum preserve all existing V7.1 tests.

Add/update focused tests only where behavior-bearing markup changes.

### WatchAction

Verify:

- general search link still uses the existing general search builder;
- JustWatch remains available;
- Letterboxd remains available;
- TMDB remains available;
- disclaimer remains.

If visible label changes from `General search` to `Find where to watch`, update focused assertions accordingly.

### DecisionMode

Preserve tests for:

- V6 Form B;
- V6 silence;
- manual Drop One;
- Duel finalists;
- favorite controls;
- Tonight's Pick;
- finish-time cue.

For coin behavior, add coverage for stable state semantics rather than animation pixels.

Do not snapshot CSS animation internals.

---

## V7.2 Manual / Runtime Verification

After each phase, perform focused runtime smoke checks.

After full V7.2 integration, verify:

### Glimpse / Refine protection

- Glimpse content remains unchanged;
- no new Glimpse animation or visual weight;
- Refine controls remain usable and visually stable.

### Full Reveal protection

- Direct Pick still works;
- finish-time cue still appears;
- Favorite still works;
- More Like This / More Details still work.

### Duel

- exact finalists preserved;
- finish-time cues preserved;
- favorites preserved;
- deciding differences readable;
- desktop spacing intentional;
- mobile vertical flow intentional;
- Back to All Three works.

### Coin

- flip is short;
- result is readable;
- Gut check appears correctly;
- user can accept or reject result;
- reduced-motion behavior works.

### Tonight's Pick

- poster/title hierarchy is strong;
- `Find where to watch` is obvious;
- all secondary watch destinations remain available;
- Favorite works;
- Share Pick works;
- Change My Mind works;
- Back to Browsing works;
- finish-time cue remains;
- no action hierarchy confusion.

### Accessibility

Verify:

- keyboard navigation;
- focus-visible treatment;
- narrow mobile viewport;
- `prefers-reduced-motion`.

---

## V7.2 Validation

Before V7.2 is accepted:

```text
pnpm test
pnpm build
```

Both must pass.

Also perform production/runtime smoke testing because V7.2 is primarily experiential and cannot be accepted from unit tests alone.

If deployed before release, verify GitHub Pages deployment success.

---

## V7.2 Acceptance Criteria

V7.2 is accepted only if:

1. V7.1 functional behavior remains unchanged;
2. Glimpse remains structurally and visually lightweight;
3. Refine is not redesigned;
4. existing typography and palette remain the product foundation;
5. Tonight's Pick has one clear primary real-world action;
6. `Find where to watch` reuses the existing general search destination;
7. service-specific WatchAction links remain available but secondary;
8. streaming availability is not claimed;
9. Share / Favorite remain available;
10. reversal / browsing actions are visually subordinate;
11. Duel feels more final without introducing scoring or winner semantics;
12. Duel remains intentionally usable on mobile;
13. coin flip gains short tactile motion;
14. coin result semantics remain a gut check;
15. reduced-motion users do not depend on 3D animation;
16. no animation library is added;
17. no outgoing-state transition machinery is introduced;
18. no V6 / V7.1 recommendation or decision semantics change;
19. no URL schema change occurs;
20. existing tests remain green;
21. production build passes;
22. desktop/mobile runtime smoke passes;
23. accessibility smoke passes.

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

# Release / Sequencing

The completed sequence to date:

```text
v6.0.0
-> V7.1 Functional Deference (Phases 1–4)
-> v7.1.0 release checkpoint  ← released
-> V7.2 Earned Atmosphere specification locked  ← current
-> V7.2 implementation
-> v7.2.0 release checkpoint
```

Do not tag or release V7.2 until integrated runtime verification passes.
