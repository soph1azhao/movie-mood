# Movie Mood V8 — Implementation Spec

**Authority order:** `V8_VISUAL_LOCK.md` → this document → `editorial-wire-3c-poster-2x3.html` → production source → reference library → historical research. This document does not re-litigate art direction; see the Lock doc for that. This document turns the Lock into engineering work against the real codebase.

---

## 1. Objective

**What V8 changes (perceptual):** the whole-site visual system — palette, typography, spacing rhythm, poster treatment (title bleed over 2:3 posters), separators/thresholds, and per-surface visual hierarchy — moves from V7.2's current dark-warm-neutral card system to the Editorial Wire 3C system described in `editorial-wire-3c-poster-2x3.html`.

**What V8 does not change (semantic):**
- `DecisionState` and its three kinds (`three-slate`, `duel`, `pick`) and all transition logic in `DecisionMode.tsx`
- Recommendation/filtering logic (`filterMovies`, `getDiscoveryPool`, `getPicks`, `getSimilarMovies`)
- Duel / Drop-One / companion-cue behavior
- Favorites (`useFavorites`) and URL/sharing semantics (`urlCodec`, `shareUrl`)
- Finish-time logic (`getFinishTimeLabel`)
- The TMDB factual/editorial data split (`curatedMovies.ts` fields, `tmdbImages`)
- Any new product surface, stage, score, ranking, or account/backend feature (see §12)

## 2. Architecture Constraints

Static Vite + React + TypeScript + plain CSS, deployed to GitHub Pages. No backend, no database, no accounts, no runtime AI, no authenticated runtime TMDB calls, no routing framework, no global state framework, beyond what already exists. V8 is CSS/markup/composition work on the existing component tree — it is not a rewrite and does not introduce new dependencies, build tooling, or architecture.

## 3. Final Visual System (roles, not literal pixels)

Derived from `editorial-wire-3c-poster-2x3.html`; treat its CSS custom properties as the canonical token starting point.

**Palette (role → example value from prototype):**
- `--ground` warm-dark neutral background (`#18120e`) — not cold black
- `--ink` primary text (`#f3ece2`) — avoid pure white on dark (halation)
- `--ink-dim` secondary/editorial text (`#b7a99a`)
- `--ink-faint` micro/metadata text (`#7c6f61`)
- `--line` / `--line-soft` hairline separators
- `--accent` single warm rust accent (`#c8492b`) — one role per surface only (primary action, or one inline emphasis); never decorative, never in metadata, never multiplied

**Typography — three registers only:**
- Display (`Fraunces`): movie titles, mood name, Tonight's Pick title, hero headline. Large, spatial, reserved.
- Editorial (`Fraunces` italic / body serif voice): `vibeSummary`, `curiosityHook`, `whyWatch`. Consistent voice at ~45–75 char line length.
- Micro (`IBM Plex Mono`, tracked caps): runtime/genre/year/labels/metadata. Quiet, never competing.
- Body sans (`Inter`): supporting copy, chips, buttons.

**Visual hierarchy pattern (Rule 4, "name below, world above"):** poster → title bleeding over its lower edge → editorial line (`curiosityHook`/`vibeSummary`) → (Full Reveal only) primary action → secondary actions → metadata → expandable detail.

**Rules/separators:** thin repeating-dash "threshold" rule (`.threshold`) marks commitment transitions between major stages (Refine→Reveal, Decision→Duel, Duel→Pick) — not used as a generic section divider.

**Title bleed:** poster image with a bottom gradient scrim; the movie title (`.trio-bleed-3c` / `.trio-reveal-bleed-3c` / `.pick-body h2`) sits in a negative-margin overlap so it visually breaks the poster's lower boundary. This is HTML/CSS composition over a real `<img>`, never baked into image assets.

**2:3 poster system:** `aspect-ratio: 2/3` container; real poster `<img>` (`object-fit: cover`) or existing palette-gradient fallback fills it. See §10.

**Spacing rhythm:** section padding ~84px vertical on desktop with hairline top borders between sections (`section-head`/`.wrap` pattern); tightens at narrower breakpoints per §8.

**Action hierarchy:** one `.link-btn.primary` (rust, underlined) per decision point; supporting actions as plain `.link-btn`; quiet/reversal actions smallest and least emphasized (mirrors existing `action-supporting` / `action-quiet` classes already in `styles.css`).

**Stage progression:** increasing visual commitment from Glimpse (lightest) through Full Reveal, Decision, Duel, to Tonight's Pick (most resolved/quiet chrome), per the prototype and per `skill_SKILL.md` §8 surface guidance (superseded only where it conflicts with equality — see §7 below).

## 4. Surface-by-Surface Implementation Targets

For each surface: current semantic behavior to preserve, required visual transformation, invariant, and desktop/tablet/phone behavior.

### Header
- **Preserve:** brand link to `#top`, GitHub external link. (`Header.tsx`)
- **Transform:** apply Editorial Wire header treatment — quiet 86px-tall bar, Fraunces brand mark, mono GitHub link.
- **All breakpoints:** unchanged structure; shrink only via existing responsive rules.

### Hero
- **Preserve:** static marketing copy, no state. (`App.tsx` `.hero` block)
- **Transform:** LOCKED (see Lock §3.3) — apply prototype's `--accent` display headline in Fraunces, italic "right now.", restrained supporting copy.
- **Desktop/tablet/phone:** `clamp()` type scale as in prototype; no structural change needed across breakpoints beyond the scale clamp.

### Mood Entry
- **Preserve:** `chooseMood` behavior, `aria-pressed`, single-select semantics. (`CategorySelector.tsx`)
- **Transform:** replace the current dashboard-style `.mood-grid` button tiles with the prototype's inline editorial "mood line" (Fraunces words separated by middle-dots; selected mood grows to display scale and gains the rust underline). Icons (`mood.icon`) can be dropped or kept as a small quiet mark — the prototype's version is icon-free; either is acceptable as long as the accessible name/label and `aria-pressed` semantics survive.
- **Desktop:** single inline wrapped line.
- **Tablet/phone:** same wrapped-line approach; selected-item scale via `clamp()` already handles narrowing. Ensure tap targets stay ≥44px even though the visual treatment is text-based (pad the button hit area, not just the visible glyph).

### Glimpse
- **Preserve:** `MovieGrid`/`MovieCard` glimpse variant semantics — 3 picks, `showAnotherThree`/`showPreviousThree`, `startDecisionMode` gating, glimpse→full reveal bridge actions. (`App.tsx` picks/`MovieGrid.tsx`/`MovieCard.tsx` glimpse branch)
- **Transform:** replace `.glimpse-card` box-card treatment with 3C Overlap & Bleed: real poster 2:3, bottom scrim, title bleeding over the lower edge, index label (`Glimpse 0N`), italic `curiosityHook` below — no bordered card container (Lock §3.2, Rule 5 "no individual card containers").
- **Invariant:** 2:3 poster, 3 equal columns, equal weight — no film larger/brighter than another.
- **Desktop:** 3-across flex/grid, equal gaps.
- **Tablet:** 3-across retained as long as legible; reduce gap/type scale first (prototype's 860px breakpoint) before reducing column count.
- **Phone:** single column stack (prototype's 620px breakpoint), poster stays 2:3.

### Refine (Situation + Discovery Preferences + Filters)
- **Preserve:** all existing behavior/state in `SituationSelector.tsx`, `DiscoveryPreferencesPanel.tsx`, `FilterPanel.tsx` — selection, clear, disabled-clear states, `<details>`-based optional filter panel.
- **Transform:** replace bordered-panel/pill-chip visual language with the prototype's low-chrome underline word-chip treatment (`.word-chip` / `.refine-row`). Group labels become mono micro-labels (`.refine-label`).
- **Do not:** turn this into a settings-dashboard look (Lock-adjacent constraint carried from `skill_SKILL.md`).
- **Desktop/tablet:** wrapped flex rows, as today.
- **Phone:** same wrapped rows; ensure word-chips retain ≥44px effective tap height via padding.

### Full Reveal
- **Preserve:** three-tier info structure already in `MovieCard.tsx` full variant + `MovieDetails.tsx` (why-watch → metadata → expandable full detail), `onFindSimilar`, `onChooseMovie`, favorite toggle, expand/collapse.
- **Transform:** 3C reveal treatment — poster with title bleed, `whyWatch`/`vibeSummary` as the editorial anchor line, one primary action (`That's the one`) styled as `.link-btn.primary`, secondary actions (`More like this`, `More details`) as quiet mono links, metadata compressed to a whisper cluster, full detail behind the existing expand/collapse.
- **Invariant:** same 3 candidates simultaneously visible in one equal three-column composition (Lock §3.2) — explicitly **not** the rejected giant sequential row layout.
- **Desktop:** 3-across.
- **Tablet:** 3-across as long as legible, then reflow per §8; do not drop to sequential full-width rows as a "simplification."
- **Phone:** single column stack, each reveal card's own internal hierarchy preserved.

### Decision (three-slate)
- **Preserve:** `DecisionMode.tsx` three-slate branch exactly — manual drop toggle, decision-companion outlier panel, duel-start gating, all `DecisionState` transitions untouched.
- **Transform:** `.slate-row`/`.slate-card` 2:3 poster treatment replacing the current bordered `.decision-card`; dropped state uses the existing opacity-reduction pattern (`is-dropped`), not a new visual language.
- **Invariant:** 3 equal candidates until a drop occurs; no pre-ranking.
- **Desktop:** 3-column grid.
- **Tablet/phone:** single column (existing `900px` breakpoint pattern in `styles.css` already does this for `.decision-grid`; carry the same threshold forward), 2:3 poster preserved.

### Duel
- **Preserve:** `DecisionMode.tsx` duel branch — finalist differences, coin flip state machine, "Back to all three," favorite toggle on finalists, `chooseMovie(state)` semantics.
- **Transform:** `.duel-field` two-column composition with a vertical `.threshold` rule as the "held breath" negative space (per Lock: no VS badge, no seam, no shared frame).
- **Invariant:** 2 equal finalists — absolutely no glow/scale/position/scoreboard asymmetry.
- **Desktop:** side-by-side with vertical threshold divider.
- **Tablet:** side-by-side while it fits; drop to stacked before overflow (prototype's `900px` breakpoint switches `.duel-field` to one column and the divider to horizontal — reuse this).
- **Phone:** vertical stack, horizontal threshold rule between, both posters still 2:3, both still fully interactive/equal.

### Tonight's Pick
- **Preserve:** `DecisionMode.tsx` pick branch — `WatchAction` primary/secondary links, share/favorite/reversal actions, `sourceDuel`/`sourceThreeSlateIds` back-navigation.
- **Transform:** `.pick-grid` two-column composition — 2:3 poster left, display-scale rust title with negative-margin overlap (`.pick-body`) right, editorial vibe line, reasons list with rust em-dash markers, watch-action row, quiet footer actions.
- **Invariant:** the one surface where a single film legitimately gets more spatial room — poster stays 2:3, everything else may expand.
- **Desktop:** two-column (`1fr 1.15fr`), poster left / text right.
- **Tablet (the named risk — see §8):** do **not** collapse straight to the phone single-column treatment at the first squeeze point. Hold the two-column composition longer, or if stacking is unavoidable, constrain the poster's max-width so it doesn't become a near-viewport-wide, excessively tall block.
- **Phone:** single column, poster first, constrained width, then text.

### Footer
- **Preserve:** TMDB attribution, GitHub-adjacent build note. (`Footer.tsx`)
- **Transform:** mono micro-type treatment matching prototype footer; otherwise unchanged.

## 5. Current React Component Mapping

Inspected from actual source (`/mnt/project`). No component renamed unless noted.

| Surface | Component(s) | Change type |
|---|---|---|
| Header | `Header.tsx` | CSS-only |
| Hero | `App.tsx` (`.hero` JSX block) | CSS-only |
| Mood Entry | `CategorySelector.tsx` | Markup/composition (drop icon-tile grid markup for inline word-line markup); behavior (`onSelect`, `aria-pressed`) unchanged |
| Glimpse | `MovieGrid.tsx`, `MovieCard.tsx` (glimpse branch), `MoviePoster.tsx` | Markup/composition (restructure glimpse branch to bleed layout) + CSS |
| Refine — Situation | `SituationSelector.tsx` | Markup/composition (tile → word-chip) + CSS |
| Refine — Discovery Preferences | `DiscoveryPreferencesPanel.tsx` | Markup/composition (chip → word-chip) + CSS |
| Refine — Filters | `FilterPanel.tsx` | Markup/composition (chip → word-chip) + CSS; `<details>` behavior unchanged |
| Full Reveal | `MovieCard.tsx` (full branch), `MovieDetails.tsx`, `MoviePoster.tsx` | Markup/composition + CSS; behavior (`onFindSimilar`, `onChooseMovie`, expand/collapse, favorite) unchanged |
| Decision (three-slate) | `DecisionMode.tsx` (`DecisionMovieCard`, three-slate branch), `MoviePoster.tsx` | CSS + light markup (class names) only — logic untouched |
| Duel | `DecisionMode.tsx` (duel branch), `MoviePoster.tsx` | CSS + light markup only — coin/finalist logic untouched |
| Tonight's Pick | `DecisionMode.tsx` (pick branch), `WatchAction.tsx`, `MoviePoster.tsx` | Markup/composition (two-column pick-grid) + CSS; behavior unchanged |
| Footer | `Footer.tsx` | CSS-only |
| Shared primitive | `MoviePoster.tsx` | **Behavior-sensitive.** This is the natural home for the 2:3 + title-bleed + real-poster/fallback treatment shared across Glimpse, Full Reveal, Decision, Duel, Tonight's Pick. Extending it (e.g. an optional `bleedTitle` prop/slot) avoids duplicating poster markup five times. Preserve its existing `isDecorative`, alt-text, loading/error-fallback behavior. |
| Global | `styles.css` | Token/variable replacement (palette, type, spacing) — largest single CSS-only change |

**Do not** rewrite `App.tsx`'s state management, `DecisionMode.tsx`'s branching logic, `utils/discovery.ts`, `utils/filterMovies.ts`, `utils/picks.ts`, `utils/urlCodec.ts`, `utils/decision.ts`, `utils/moviePresentation.ts`, or `hooks/useFavorites.ts`. All of V8 is achievable as CSS + JSX markup/class changes plus one optional shared-primitive extension to `MoviePoster.tsx`.

## 6. Movie Object Invariant (named acceptance rule)

> **INVARIANT-2X3:** Every rendered movie object, on every surface (Glimpse, Full Reveal, Decision, Duel, Tonight's Pick) and every viewport (desktop/tablet/phone), has `aspect-ratio: 2/3`. This is checked by computed style, not source CSS, at each phase's QA step (see §8, §14).

Any change that would require a different ratio at any single surface or breakpoint is out of scope for V8 and must be flagged, not implemented.

## 7. Equality Invariant (named acceptance rule)

> **INVARIANT-EQUAL:** While 3 recommendations are active (Glimpse, Full Reveal, Decision pre-drop), all 3 render with identical width, poster size, title scale, and brightness. While 2 finalists are active (Duel), both render identically. Only Tonight's Pick may give one film more spatial room. No visual signal (glow, scale, position, badge, color) may imply ranking, preference, or confidence at any other surface.

This directly supersedes any historical draft that treated "one movie could occupy more space" in the three-slate as still open (see `V8_VISUAL_REFERENCE_ANALYSIS.md` Part 8, Q4) — closed by the human lock in favor of strict equality.

## 8. Responsive Specification

Desktop targets: Glimpse 3-across, Full Reveal 3-across, Decision 3-across, Duel 2 equal finalists side-by-side, Tonight's Pick poster+text two-column.

Tablet: recompose deliberately per rendered quality; do not copy prototype breakpoints blindly (they were authored for a demo, not verified against production content lengths). Base actual breakpoints on rendered QA in Phase 7.

**Named tablet risk — Tonight's Pick at ~834px:** production testing during V7.2 found that around 834px width, a naive single-column collapse makes the 2:3 poster nearly viewport-wide and excessively tall. **Do not fix this by changing the poster's aspect ratio.** Acceptable fixes, chosen by rendered QA:
1. Hold the `pick-grid` two-column composition to a narrower breakpoint than the prototype's default, or
2. When stacking is unavoidable, cap the poster's `max-width` (e.g. constrain to a comfortable column width, not 100% of viewport) so `aspect-ratio: 2/3` produces a reasonable height.

Phone: single column where appropriate; poster always 2:3; Duel finalists may stack vertically but remain equal (no reordering that implies preference, no differing sizes).

## 9. Interaction States

All of the following must be visually defined and must not regress existing behavior:
- **Hover:** links/buttons — color/border shift per prototype (`.link-btn:hover`, `.mood-btn:hover`, `.word-chip:hover`)
- **Keyboard focus:** visible focus ring on every interactive element (`:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }` — already the prototype's pattern, mirrors existing `styles.css` focus-visible rule); must cover the new inline mood-line buttons and word-chips, which are less visually button-like than before
- **Active/selected mood:** `.is-selected` display-scale + underline treatment (`aria-pressed="true"` preserved)
- **Refine selection:** `.word-chip.is-selected` (accent color + underline), disabled-clear state preserved
- **Favorites:** heart toggle — preserve existing `is-favorite` class/aria-pressed pattern; restyle only the visual token, not the interaction
- **Detail expansion:** `aria-expanded`/`aria-controls`/`hidden` preserved on "More details" toggle
- **Dropped candidate (Decision):** existing `is-dropped` opacity pattern, restyled to new tokens
- **Duel:** finalist selection, differences list, equal-treatment requirement (§7)
- **Coin/gut-check:** existing flip animation semantics preserved; reduced-motion fallback preserved (`prefers-reduced-motion` already skips the flip in `DecisionMode.tsx`)
- **Final pick:** Tonight's Pick actions (share/favorite/change-mind/back) preserved
- **Reduced motion:** global `@media (prefers-reduced-motion: reduce)` rule (already present in both `styles.css` and the prototype) must continue to collapse all transition/animation durations

## 10. Real Poster Handling

- Production already uses real TMDB poster artwork via `getTmdbPosterUrl` / `posterAspectRatio` in `utils/tmdbImages.ts`, consumed by `MoviePoster.tsx`.
- **Fallback:** `MoviePoster.tsx`'s existing `PosterFallback` (palette gradient + title-in-image fallback) is preserved as-is for movies without a usable poster path or on image load error — do not remove or replace this mechanism.
- **object-fit:** `cover`, as already implemented.
- **Ratio:** `aspect-ratio: 2/3` (`posterAspectRatio()`), matching real TMDB poster geometry — avoids unnecessary cropping (Lock §10 rationale).
- **Title overlay/bleed:** implemented as HTML/CSS over the real `<img>` (bottom scrim gradient + negative-margin title block), never baked into an image asset. The existing `PosterFallback`'s in-image title (used only when there's no real poster) is a distinct, pre-existing mechanism and is not the 3C bleed treatment — do not conflate the two; the bleed title sits *outside* and *below* the poster's visual box, overlapping its lower edge, on top of whichever poster content (real or fallback) is showing.

## 11. Accessibility

- Keyboard: full tab-order parity with current production; no interactive element becomes mouse-only as a side effect of the word-chip/mood-line restyle
- Focus visibility: see §9
- Semantic elements: continue using real `<button>`/`<a>` for all interactive controls (mood line, word-chips, link-btns) — do not replace with `<span onClick>` for visual reasons
- Contrast: WCAG AA minimum for any decision-critical text (titles, primary actions, editorial cue lines) against `--ground`; verify computed contrast, not just token math (see §14)
- No state by color alone: selected/dropped/favorited states must retain a non-color signal already present in production (underline, weight change, icon fill, `aria-pressed`) — do not strip these for a "cleaner" look
- Reduced motion: full functional parity, not just animation removal (existing pattern in `DecisionMode.tsx` coin flip already models this correctly)
- Touch targets: ≥44px effective hit area on mood-line items and word-chips despite their text-only visual footprint
- Responsive readability: editorial line length stays in ~45–75 character range across breakpoints where feasible

## 12. Out of Scope (restated)

No recommendation scores, percentages, AI ranking, or confidence signals. No preselected winner outside Tonight's Pick. No new recommendation dimensions, search, watch history, ratings, diary, accounts, backend, runtime AI, group voting, "Movie Night for Two," new decision stages, or new APIs. No aspect ratio other than 2:3 for movie objects at any stage. No asymmetric Glimpse/Full Reveal/Decision recommendation display.

## 13. Implementation Phases

**Phase 0 — Baseline verification / source inventory**
Confirm current `main` builds and tests pass unmodified. Screenshot current production at desktop/tablet/phone for later regression diffing. Confirm this spec's component mapping (§5) still matches the actual repo (file names/paths may have moved since this spec was authored).

**Phase 1 — Visual foundation**
Replace `styles.css` tokens (palette, font imports, spacing scale) with the Editorial Wire 3C system. Restyle Header and Hero only. No other surface touched yet.

**Phase 2 — Mood + Refine**
Restyle `CategorySelector.tsx` (mood line) and the three Refine components (`SituationSelector.tsx`, `DiscoveryPreferencesPanel.tsx`, `FilterPanel.tsx`) to the word-chip/underline treatment. Preserve all state logic.

**Phase 3 — Shared 2:3 movie-object treatment**
Extend `MoviePoster.tsx` with the title-bleed composition (scrim + negative-margin title slot), still unused by any consuming surface yet, or applied to one surface as a pilot (recommend Glimpse, since it's simplest). Verify computed `aspect-ratio: 2/3` here first.

**Phase 4 — Glimpse + Full Reveal**
Apply the shared poster treatment to `MovieCard.tsx`'s glimpse and full branches and `MovieGrid.tsx`. Verify equality invariant (§7) visually and via computed styles (equal widths/heights).

**Phase 5 — Decision + Duel**
Restyle `DecisionMode.tsx`'s three-slate and duel branches. Verify equality invariant here too — this is the highest-risk surface for an accidental winner signal.

**Phase 6 — Tonight's Pick**
Restyle `DecisionMode.tsx`'s pick branch and `WatchAction.tsx`. Explicitly test the ~834px tablet width per §8.

**Phase 7 — Responsive pass**
Full desktop/tablet/phone sweep across all surfaces. Adjust breakpoints based on rendered content (real movie titles/copy from `curatedMovies.ts`, not prototype placeholder text), not by copying the prototype's breakpoints verbatim.

**Phase 8 — Accessibility + runtime/computed-style QA**
Tab through every surface. Verify computed contrast in default/hover/focus states. Verify no unexpected horizontal overflow at realistic narrow widths. Verify `INVARIANT-2X3` and `INVARIANT-EQUAL` via computed styles, not source inspection.

**Phase 9 — Regression / final acceptance**
Run existing test suite (`DecisionMode.test.tsx` and any others) unmodified — all must still pass, since no `DecisionState` semantics changed. Full before/after screenshot comparison at desktop/tablet/phone for every surface. Final sign-off against §15.

## 14. Per-Phase Acceptance

For every phase: state which files are expected to change, which semantics must remain provably unchanged, what to run, and the stop/report condition.

| Phase | Files expected to change | Semantics that must remain | Tests | Build | Render checks | Stop/report if |
|---|---|---|---|---|---|---|
| 0 | none | n/a | existing suite green | `npm run build` green | baseline screenshots captured | build/tests fail before any change |
| 1 | `styles.css`, `Header.tsx`, `App.tsx` (hero JSX only) | no state/props changed | existing suite green | green | Header/Hero render at 3 breakpoints, no overflow | any non-hero surface visually shifts |
| 2 | `CategorySelector.tsx`, `SituationSelector.tsx`, `DiscoveryPreferencesPanel.tsx`, `FilterPanel.tsx`, `styles.css` additions | `onSelect`/`onChange`/`onClear`, `aria-pressed`, disabled-clear logic unchanged | existing suite green | green | tab through all controls; verify focus rings | any click handler signature changes |
| 3 | `MoviePoster.tsx`, `styles.css` additions | `isDecorative`, alt text, fallback-on-error behavior unchanged | existing suite green | green | computed `aspect-ratio` = `2/3` in devtools on the pilot surface | fallback poster stops rendering on broken image URL |
| 4 | `MovieCard.tsx`, `MovieGrid.tsx`, `styles.css` | `onFindSimilar`, `onChooseMovie`, expand/collapse, favorite toggle unchanged | existing suite green | green | 3 equal-width/height posters at desktop; equal at tablet/phone stack | any of the 3 renders visually larger/brighter than the others |
| 5 | `DecisionMode.tsx`, `styles.css` | all `DecisionState` transitions identical to pre-V8 behavior; `DecisionMode.test.tsx` passes unmodified | `DecisionMode.test.tsx` green, no new/edited assertions | green | Duel finalists pixel-equal in size/position weighting; drop/keep states visually correct | any test needs editing to pass — indicates a semantic change occurred |
| 6 | `DecisionMode.tsx` (pick branch), `WatchAction.tsx`, `styles.css` | watch-link URLs, share/favorite/back logic unchanged | existing suite green | green | explicit 834px-width render check, poster not excessively tall | poster becomes near-viewport-wide and disproportionately tall at any tested tablet width |
| 7 | `styles.css` breakpoints across components | none (visual only) | existing suite green | green | full sweep at desktop/tablet/phone, all surfaces | any horizontal overflow, any 2:3 violation, any equality violation |
| 8 | `styles.css`/markup a11y fixes only | none | existing suite green | green | computed contrast pass, full keyboard traversal, reduced-motion parity check | any WCAG AA failure on decision-critical text |
| 9 | none expected (regression only) | all | full suite green | green | full before/after screenshot set | any regression found |

## 15. Final Acceptance Criteria

- **Semantic:** `DecisionMode.test.tsx` and all other existing tests pass unmodified; no `DecisionState`, filtering, favorites, or URL-sharing behavior changed.
- **Visual:** every surface listed in §4 matches the Editorial Wire 3C system's role-level description (not necessarily pixel-identical to the prototype, which used placeholder content).
- **Responsive:** `INVARIANT-2X3` holds at desktop/tablet/phone on every movie-bearing surface; Tonight's Pick tablet composition does not reproduce the 834px poster-bloat issue.
- **Accessibility:** WCAG AA contrast on decision-critical text; full keyboard operability; reduced-motion parity; ≥44px touch targets on text-styled controls.
- **Regression:** no unrelated behavior change anywhere in the app.
- **Runtime/browser:** all checks above verified via rendered browser inspection and computed CSS, not source-only inspection (per the V7.2 lesson in `V8_IMPLEMENTATION_SPEC.md` §2 / project background).
- **Computed CSS:** `aspect-ratio` computed value = `2/3` (or equivalent width:height ratio) confirmed via devtools on at least one instance per surface per breakpoint.
