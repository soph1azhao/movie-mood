# Movie Mood V8 — Agent Handoff

Paste everything below this line into a fresh Antigravity Flash 3.7 or Codex conversation that has repo access. This agent has not seen any prior conversation about this project.

---

## Context

You are implementing **Movie Mood V8**, a visual/experiential redesign of an already-shipped, working product. You are not being asked to design anything — all art direction is locked. Your job is engineering: apply a locked visual system to real components without changing product semantics.

**Repository:** `soph1azhao/movie-mood`
**Local path:** `/Users/hermes/code/movie-mood`
**Stack:** Vite + React + TypeScript + plain CSS, deployed via GitHub Pages. Static site — no backend, no database, no accounts, no runtime AI, no authenticated runtime TMDB calls, no new routing/state framework.
**Current baseline:** V7.2 ("Movie Mood V7.2 — Earned Atmosphere"), functionally mature and working. Product flow: `Glimpse → Refine → Reveal → Decide`, decision flow `three movies → direct pick OR Drop One → Duel → optional gut check → Tonight's Pick`.

## Read these first, in this order

1. `docs/V8_VISUAL_LOCK.md` — the final, locked art direction. Non-negotiable.
2. `docs/V8_IMPLEMENTATION_SPEC.md` — the main implementation source of truth: surface-by-surface targets, component mapping, phases, acceptance criteria.
3. `editorial-wire-3c-poster-2x3.html` (repo root or wherever it's stored) — the accepted visual prototype. Open it in a browser. This is what "done" should feel like.
4. `.agents/skills/movie-mood-cinematic-design/SKILL.md` and its `resources/` — supporting design-system reference, reconciled to match the Lock doc.

**Do not read the design exploration history as if it contains open decisions.** Files like `docs/V8_DESIGN_SKILL_RESEARCH_AND_PLAYBOOK_V2.md`, `docs/V8_VISUAL_REFERENCE_ANALYSIS.md`, and `docs/V8_REFERENCE_PROMPT_RECONSTRUCTION.md` are historical research and contain rejected alternatives (3A, 3B, 3:4 geometry, asymmetric Lead Pick, a since-removed Bolshoi Theatre reference, etc.). Where they conflict with `V8_VISUAL_LOCK.md`, the Lock doc wins, full stop. Do not re-derive design decisions from these files.

## What is already decided — do not redesign

- Direction: **Editorial Wire 3C — Overlap & Bleed**.
- Every movie object (Glimpse, Full Reveal, Decision, Duel, Tonight's Pick), every breakpoint: **2:3 aspect ratio, no exceptions.** Named acceptance rule: `INVARIANT-2X3`.
- Three active recommendations are always visually **equal** (no Lead Pick, no featured slot, no algorithmic winner). Two Duel finalists are always visually equal. Only Tonight's Pick may give one film more room. Named acceptance rule: `INVARIANT-EQUAL`.
- Palette, typography (Fraunces display / Fraunces-italic editorial / IBM Plex Mono micro / Inter body), warm-dark ground, single rust accent — all locked per the prototype.
- Do not propose a new aesthetic direction. Do not build another prototype. Do not ask the human to choose between visual options. If something in the prototype is ambiguous for a surface it doesn't fully demonstrate (e.g. My List view, share-feedback message states), extend the locked visual language yourself using the role-based description in the Implementation Spec §3–4, and note the extension in your phase report — don't stop and ask.

## Static architecture constraints

Everything you do is CSS + JSX markup/composition changes on the existing component tree, plus one optional shared-primitive extension to `MoviePoster.tsx` (see Spec §5). Do **not**:
- touch `DecisionState` logic or any function in `utils/discovery.ts`, `utils/filterMovies.ts`, `utils/picks.ts`, `utils/urlCodec.ts`, `utils/decision.ts`, `utils/moviePresentation.ts`, `hooks/useFavorites.ts`
- add a backend, database, account system, routing library, or global state library
- introduce recommendation scores, rankings, percentages, or AI-generated confidence
- add any new decision stage or API

## Implementation phases

Follow `V8_IMPLEMENTATION_SPEC.md` §13 phase-by-phase (Phase 0 through Phase 9). Do not skip ahead or batch multiple phases into one commit-worthy change without reporting each phase separately. Each phase has explicit "files expected to change," "semantics that must remain," and a "stop/report condition" in Spec §14 — honor those exactly.

## Repository verification (do this before Phase 0 work)

The Implementation Spec's component mapping (§5) was written against a source snapshot that may have since moved. Before starting Phase 0:
1. Confirm the actual current file paths/names for: `App.tsx`, `Header.tsx`, `Footer.tsx`, `CategorySelector.tsx`, `SituationSelector.tsx`, `DiscoveryPreferencesPanel.tsx`, `FilterPanel.tsx`, `MovieGrid.tsx`, `MovieCard.tsx`, `MovieDetails.tsx`, `MoviePoster.tsx`, `WatchAction.tsx`, `DecisionMode.tsx`, `styles.css`, and the `utils/`/`hooks/`/`types/` files named above.
2. If any have moved or been renamed, update your own working notes accordingly — the *behavior* described in the Spec is authoritative even if a file path has drifted.
3. If you find a **mismatch between the prototype's visual intent and actual production semantics** (e.g. a state the prototype doesn't show, a component that behaves differently than the Spec assumes), resolve it by: preserving the real production semantic behavior, and applying the closest reasonable extension of the locked visual system to it. Report the mismatch and your resolution in that phase's report — do not silently deviate and do not halt to ask, unless the mismatch suggests the Spec's component mapping is wrong in a way that changes which files a whole phase touches, in which case flag it in your Phase 0 report before proceeding.

## Testing / build / QA expectations

- Run the existing test suite (including `DecisionMode.test.tsx`) after every phase. It must pass **unmodified** — if you find yourself needing to edit a test to make it pass, that's a signal you've changed semantics, not just visuals. Stop and report rather than editing the test.
- Run `npm run build` (or the project's actual build script) after every phase.
- **Browser/render QA is mandatory, not optional.** V7.2 shipped a responsive bug that looked correct in source CSS but broke at actual runtime/computed styles. For every phase touching layout: actually render the app (dev server or build preview) at desktop, tablet (~768–900px), and phone (~375–430px) widths and inspect computed styles in devtools — do not infer correctness from source CSS alone.
- Specifically verify, via computed styles (not source): `aspect-ratio` = 2:3 on movie objects (`INVARIANT-2X3`), and equal widths/heights across active recommendation/finalist sets (`INVARIANT-EQUAL`).
- Specifically re-test the named tablet risk: **Tonight's Pick around ~834px width** must not collapse into a near-viewport-wide, excessively tall poster. See Spec §8 for acceptable fixes (hold two-column longer, or cap poster max-width on stack) — do not fix it by changing the aspect ratio.

## Commit policy

**Do not commit automatically.** Prepare changes and report them; wait for explicit human instruction before committing, unless the human's next message explicitly authorizes autonomous commits per phase.

## Phase completion report format

After each phase, report in this shape:

```
PHASE: <number and name>
FILES CHANGED: <list>
SEMANTICS VERIFIED UNCHANGED: <what you checked, and how>
TESTS: <pass/fail summary>
BUILD: <pass/fail>
BROWSER/RENDER QA: <what you rendered, at what widths, what you confirmed via computed styles>
DEVIATIONS FROM SPEC (if any): <what, why, and how you resolved it>
OPEN ISSUES FOR NEXT PHASE: <if any>
```

## Handling unexpected mismatches between prototype and production

The prototype (`editorial-wire-3c-poster-2x3.html`) is a static demo with placeholder movie data and no product logic. Production has richer state (favorites, My List, share feedback, companion-cue panel, expandable details, coin gut-check, filters). When the prototype doesn't show a state production has:
1. Identify the closest analogous treatment already locked for that surface (Spec §4).
2. Apply the same typography registers, spacing rhythm, accent discipline, and 2:3/equality invariants to it.
3. Do not invent new visual primitives beyond what §3 of the Implementation Spec defines (display/editorial/micro type, one accent, hairline threshold rule, no-card-container ground, title bleed).
4. Report what you extended and why in that phase's report.

If the mismatch is a genuine semantic question (e.g. "does this new state even belong in V8's scope") rather than a visual-extension question, stop and ask the human — but this should be rare, since V8 is explicitly scoped as visual-only.
