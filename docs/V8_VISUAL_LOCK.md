# Movie Mood V8 — Visual Lock

**Status: LOCKED FOR IMPLEMENTATION.**
This document is the single current authority on V8 art direction. If any other document — including `V8_DESIGN_SKILL_RESEARCH_AND_PLAYBOOK_V2.md`, `V8_VISUAL_REFERENCE_ANALYSIS.md`, `V8_REFERENCE_PROMPT_RECONSTRUCTION.md`, or the `movie-mood-cinematic-design` skill — appears to leave any decision below open, that other document is stale. Do not re-derive art direction from first principles. Do not reopen anything listed under "Discarded Alternatives."

---

## 1. Selected Direction

**Editorial Wire 3C — Overlap & Bleed**, native 2:3 poster geometry (Variant P).

**Accepted baseline artifact:** `editorial-wire-3c-poster-2x3.html` (supplied prototype). This file is the visual source of truth for every surface it demonstrates: Header, Hero, Mood Entry, Glimpse, Refine, Full Reveal, Decision (three-slate), Duel, Tonight's Pick, Footer. Where a production surface has behavior the prototype doesn't show (e.g. favorites, My List view, share/copy feedback, coin gut-check follow-up), extend the prototype's visual language rather than inventing a new one.

## 2. Evidence Hierarchy (in priority order)

1. **This document** (final human decisions)
2. `editorial-wire-3c-poster-2x3.html` (accepted prototype — visual intent)
3. Current production source (`App.tsx` and component tree) and current-site screenshots — actual component names, actual behavior, actual semantics
4. The current 8-image reference library (`design-inspiration/`)
5. Historical V8 research markdowns — useful only where compatible with 1–4

## 3. Core Invariants

### 3.1 Movie-Object Invariant — 2:3 Native Poster
Every movie-bearing surface — Glimpse, Full Reveal, Decision (three-slate), Duel, Tonight's Pick — renders each film as a **2:3 aspect-ratio poster object**, on desktop, tablet, and phone, without exception. Pixel size, column count, and surrounding layout may change per surface and per breakpoint. The object's shape never does. The user should feel the *same* film objects moving through the flow, not a new card shape invented at each stage.

### 3.2 Recommendation Equality Invariant
- **Glimpse (desktop):** 3 films, equal width, equal poster size, equal title hierarchy, equal brightness, equal placement importance. No Lead Pick, no Featured slot, no algorithmic visual winner.
- **Full Reveal (desktop):** same 3 candidates, simultaneously visible, one equal three-column composition — more information than Glimpse, still easily comparable as a single shortlist. **Not** three sequential full-width editorial feature rows.
- **Decision (three-slate):** 3 equal active candidates until the person drops one. The product never visually pre-ranks.
- **Duel:** 2 equal finalists. No glow, no larger scale, no leading position, no scoreboard, no percentage, no implied winner.
- **Tonight's Pick:** the only surface where one film legitimately gains greater spatial prominence. This is earned closure, not a ranking signal.

### 3.3 Hero Lock
The hero (`Find the right film for right now.`) is locked in character as demonstrated in the prototype: large rust (`--accent`) display headline in Fraunces, strong negative space, warm-dark ground, restrained supporting copy, quiet header. Do not redesign it during implementation except for genuine responsive/accessibility fixes.

### 3.4 Whole-Site Coherence
V8 is a coherent whole-site system, not an isolated redesign of one surface. Every surface listed in the prototype must ship in the same pass conceptually — a mixture of "new cinematic Full Reveal" and "old V7.2 everything else" is an explicit failure mode (see §5).

### 3.5 Responsive Principle
Responsive design may change: column count, spacing, text scale, ordering, alignment, surrounding whitespace. Responsive design must **not** change: 2:3 poster geometry, semantic equality, or product behavior. See `V8_IMPLEMENTATION_SPEC.md` §8 for the specific tablet Tonight's Pick issue that must be handled without touching the aspect ratio.

## 4. Current 8-Reference Library

There are exactly **8** reference images in `design-inspiration/`. There is **no** Bolshoi Theatre reference in the current library — it existed in an earlier phase and was deliberately removed. Any Bolshoi-specific claim in historical docs is a historical hypothesis, not current evidence.

| # | File | Contributes |
|---|---|---|
| 1 | `backgroun_2.jpeg` | Cinema marquee, "SEE YOU AT THE MOVIES" — warmth/sincerity register, not literal marquee styling |
| 2 | `background_1.jpeg` | Cinema marquee, "GOOD FILMS MAKE YOUR LIFE BETTER" — same register |
| 3 | `card_1.png` | Tarot illustration "L'INTUITION" — completion/naming/worldhood idea, not mystical styling |
| 4 | `card_2.png` | Tarot illustration "THE STAR" — same idea |
| 5 | `weblayout_0.png` | Francesco Gioia portfolio — type/image spatial scale contrast |
| 6 | `weblayout_1.jpeg` | The Late Checkout — story-led editorial hierarchy |
| 7 | `weblayout_2.jpeg` | Creative Consigliere — rhythm/composition notes only; agency aesthetic rejected |
| 8 | `weblayout_3.jpeg` | Charlotte Evans — film-work presentation, image/title relationship |

Do not search for or assume a 9th image.

## 5. Discarded Alternatives (do not reopen)

| Alternative | Why discarded |
|---|---|
| Asymmetric "Lead Pick" (one film visually larger/brighter at Glimpse or Reveal) | Violates the Equality Invariant (§3.2) |
| Giant sequential Full Reveal rows (each film as a full-width editorial feature, stacked) | Produces vertical bloat and breaks shortlist comparability; explicitly rejected historical failure |
| 3A — Column & Threshold | Superseded by 3C |
| 3B — Continuous Strip | Superseded by 3C |
| 3:4 editorial crop geometry | Superseded by 2:3 native poster (Variant P) |
| Aspect ratio changing by stage (e.g. square Glimpse → landscape Reveal → different-ratio Duel) | Violates the Movie-Object Invariant (§3.1); this is "Geometry drift," a named historical failure |
| Isolated single-surface redesign (only Full Reveal made cinematic) | Produces visual incoherence ("old Movie Mood → new cinematic cards → old Movie Mood"); named historical Failure A/B |
| Cold-dark / Bolshoi-derived ground temperature as the final answer | Superseded by the warm-dark ground actually in the accepted prototype (`--ground:#18120e`) |

## 6. What Remains Genuinely Open

Only **implementation-level responsive tuning** remains open — e.g., exactly how many pixels wide the Tonight's Pick poster/text composition holds before it must recompose at tablet widths. This is a rendered-QA decision, not an art-direction decision, and is scoped in `V8_IMPLEMENTATION_SPEC.md` §8.

No aesthetic direction, no color, no typography family, no geometry, and no equality/hierarchy question is open. If an implementation agent believes one of these is unresolved, it should re-read this document rather than propose a new direction.
