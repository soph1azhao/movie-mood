---
name: movie-mood-cinematic-design
description: >
  Visual design skill for Movie Mood V8 and beyond.
  Combines the V8 cinematic-design playbook, visual grammar derived from
  design-inspiration reference inspection, Movie Mood semantic invariants,
  a composition-first workflow, and runtime screenshot comparison requirements.
  Use whenever doing significant Movie Mood visual work — including mockups,
  CSS, component restyling, or design review.
---

> **STATUS: DRAFT — NOT LOCKED FOR IMPLEMENTATION**
> Open art-direction questions in Section 15 must be resolved by the product owner before this skill is used to drive implementation decisions.

# Movie Mood — Cinematic Design Skill

## How to use this skill

Before any significant Movie Mood visual work:

1. Read this file completely.
2. Read `resources/visual-grammar.md` for reference-derived principles.
3. Read `resources/reference-index.md` for a summary of the design-inspiration source files.
4. Only then proceed to implementation.

If you are producing mockups, follow the **Composition Workflow** in Section 5 before generating any image.

If you are proposing CSS or component changes, trace each change back to a specific numbered principle in this skill. "This looks more cinematic" is not a valid justification.

---

## 1. Purpose

This skill translates "make it cinematic" into checkable decisions for Movie Mood V8.

V8 exists because V7.2 was technically sound but perceptually too subtle — this version does not treat V7.2's choices as settled precedent. Where V7.2 made a conservative call, that call is one input among several, not inherited law.

The visual grammar in this skill is derived from two evidence sources:
- **Reference inspection** — `design-inspiration/` (see `resources/reference-index.md`)
- **Product history** — V7/V8 research documents in `docs/`

Both sources are cited throughout. Inferences from neither should be presented as facts from the other.

---

## 2. Product Principles

> Streaming platforms help you find more movies. Movie Mood helps you choose one.

> **Be conservative with semantics. Be ambitious with experience.**
> **Preserve semantics ≠ preserve layout.**

Every visual decision is tested against one question: does this help the user feel closer to choosing, or does it just look good?

The following are out of scope and must never be touched:
- Recommendation logic and DecisionState
- Duel / Drop-One behavior
- Favorites and URL/sharing semantics
- Finish-time logic
- The TMDB factual/editorial split

Almost everything about *how those semantics are presented* is legitimately open for V8.

---

## 3. Semantic Invariants

Non-negotiable regardless of styling:

**Two Duel finalists are semantically equal.** No glow, no larger scale, no leading position, no scoreboard, no percentage, no implied "winner." Any single visual cue that could suggest one is ahead is a failure.

**All three recommendations remain semantically equal unless the product logic explicitly identifies a preferred candidate.** The composition may be asymmetric, but no individual movie may appear algorithmically preferred through scale, brightness, placement, or action prominence.

**Movie Mood knows more than it shows.** Rich internal metadata does not obligate a badge grid or a wall of equal-weight pills. Silence on a neutral field is a valid design decision.

**Mood is one environment, not five separate skins.** However far the environmental shift goes, the same type system, spatial language, and motion character must survive it. A screenshot of one mood state should never be mistakable for a different product.

**The coin never chooses.** Both finalists remain genuinely selectable after any flip treatment.

---

## 4. Reference-Derived Visual Principles

These principles are derived from visual inspection of `design-inspiration/`. For individual reference analysis, see `resources/reference-index.md`. For the full analysis, see `docs/V8_VISUAL_REFERENCE_ANALYSIS.md`.

### Rule 1 — The film is the atmospheric source

The ground absorbs and frames. The film is the atmospheric source. Poster/backdrop imagery supplies most chromatic and luminance character. This does not require synthetic glow, bloom, halos, or literal light-emitter effects. The ground stays chromatically restrained and does not compete with the artwork.

In practice: a chromatically quiet ground (dark or light, warm or cool — see Section 15, open question 1) with poster/backdrop imagery as the primary color and tone event. The exact ground temperature is an open art-direction decision. What is settled: the ground must not assert its own chromatic personality over the film's imagery.

### Rule 2 — Typography establishes places, not headings

Movie titles, the mood name, and "Tonight's Pick" need to be large enough to function as spatial anchors. Every other typographic element should be smaller than instinct says. If something is not the primary title, it should not fight for scale.

### Rule 3 — Accent family with intentional semantic roles

One accent family. A small number of intentional semantic roles — the primary action, a typographic emphasis, a selection state. Accent color must never be distributed merely for decoration. It is not applied to metadata, decorative dividers, or background fills.

*Optional technique:* Selective inline accenting may be used when editorial copy naturally contains a phrase worth emphasizing. Never rewrite or mechanically highlight copy merely to satisfy a visual pattern.

### Rule 4 — Name below, world above

At Glimpse: film imagery and editorial hook are the dominant compositional elements; metadata and secondary controls recede. At Tonight's Pick: the film's title is its name, not a heading — the title is the terminal act. This hierarchy is non-negotiable; the specific information present at each surface requires product verification before any removal.

### Rule 5 — No individual card containers

Radius + shadow card wrapping is removed or reduced to near-invisible on individual content items. Relationships between items are defined by alignment, proximity, and scale. The ground is the organizing surface, not the container.

### Rule 6 — Editorial copy visually primary over metadata

`vibeSummary` and `curiosityHook` sit higher in the visual hierarchy than runtime/genre/year metadata. Metadata should be barely visible at Glimpse — there when needed, not competing.

### Rule 7 — Backdrop dissolves into ground, not sits in a container

At Full Reveal and Tonight's Pick, the backdrop image should blend at its edges into the ground through luminosity/color gradient — not be cropped in a rectangle. The film should feel like the light source of the surface. (This is a luminosity blend, not glassmorphism — no blur panel.)

---

## 5. Composition Workflow

Before any CSS, token, or component-level detail is proposed or generated, describe — for both desktop and mobile — in this order:

1. What is the image doing and how dominant is it?
2. What is the single, nameable primary focal point?
3. What does the typographic hierarchy communicate before any copy is read?
4. What is present versus deliberately withheld?
5. Where is the negative space and what does it protect?
6. Which action, if any, is visually primary?
7. What happens on transition in and out?
8. How does all of the above *change* (not just shrink) at phone width?

Only once this is agreed does implementation detail become the right conversation. Jumping straight to CSS variables is an anti-pattern.

This sequence applies equally when generating mockup images: describe the composition before generating, adjust the description if needed, then generate.

---

## 6. Typography System

Three registers. No more.

**Display:** movie titles, mood name headline, Tonight's Pick title. Used at genuinely large scale. Reserved — appearing at display scale on every surface destroys its meaning.

**Editorial:** `vibeSummary`, `curiosityHook`, `whyWatch`. A warm, readable register with a genuinely readable line length (~45–75 characters). Consistent voice regardless of how ambitious the surrounding screen gets.

**Micro:** runtime, genre, year, labels, metadata. Small. Quiet. Never competing.

Perceptual facts to apply (from V8 research):
- Avoid pure-white text on dark surfaces (halation)
- Tighten letter-spacing slightly at large display sizes
- Pair any size-based hierarchy distinction with a weight or color change so it survives at a glance

---

## 7. Imagery and Backdrops

Backdrops establish environment and depth. V8 should test backdrop imagery at genuinely large scale — the working design question is whether Full Reveal can feel like entering the film, not like a card getting larger.

The one non-negotiable regardless of scale: legibility over any backdrop must be guaranteed structurally (a scrim, gradient, or fixed-contrast overlay engineered to work regardless of the specific image). Bigger imagery raises the stakes on accessibility; it does not excuse it.

Where poster/backdrop dominance is used, size it to do its actual job on that specific surface. Do not follow a fixed stage-by-stage scale curve inherited from prior versions.

---

## 8. Surface-by-Surface Guidance

### Mood Entry
Mood Entry may carry substantial perceptual atmosphere through lighting, imagery, typography, or composition, provided interaction burden does not increase. Visual richness and interaction complexity are separate concerns. The mood name is the typographic anchor — it should read as a place, not a button label.

### Glimpse
Film imagery and editorial hook (curiosityHook or vibeSummary) are the dominant compositional elements. Metadata and secondary controls recede visually. Explicit content-field removal at this surface requires product verification. No individual card container is required; the poster may sit directly on the ground.

### Full Reveal
Most direct reference is Bolshoi Theatre redesign in `design-inspiration/`. Photography dissolves into the ground (Rule 7). `whyWatch` or `vibeSummary` is the typographic anchor (pull-quote equivalent). Metadata grid is the most visually compressed layer, not the most prominent. Three information tiers: description/why-it-fits (tier 1, largest), factual metadata (tier 2, compact), taxonomy (tier 3, smallest/collapsible).

### Duel
Both finalists must remain perceptually and semantically equal. No compositional device may imply recommendation preference — no glow, no scale advantage, no leading position, no VS badge, no scoring bar.

Two live visual directions remain open for testing:
- **Separated fields:** two posters on the quiet ground with real negative space between them — the ground as a held breath.
- **Shared Cinematic Frame:** two posters meeting at one seam within a single encompassing composition.

Neither direction is locked. Both must be verified against the equality invariant before either is chosen.

Mobile Duel composition is unresolved. Vertical stacking must be explicitly designed and tested for equality and top-position bias rather than assumed. Do not prescribe mobile layout before testing.

### Tonight's Pick
Tonight's Pick must create unmistakable visual closure. The film and "Find where to watch" must emerge as the dominant remaining focal points.

Closure may come from:
- **Subtraction** — fewer competing elements, receded secondary actions, more whitespace.
- **Environmental Lights Down** — the surrounding surface visibly quiets or darkens as an ambient consequence of arrival.
- **A combination of both.**

None of these mechanisms is mandated over the others. The right mechanism is an open art-direction decision (see Section 15).

The title is not a heading. It is the film's name. (See Rule 4, Pattern E in the reference analysis.)

---

## 9. Motion

Every motion needs a stated narrative purpose before it is proposed.

Motion belongs at transitions that carry real meaning: narrowing from three to two, a coin settling, arriving at the final pick.

Routine browsing actions (cycling recommendations, toggling a filter) should feel instant rather than animated — motion should carry state-meaning, not decorate interaction.

**Reduced-motion parity is mandatory** in the same breath as the full version. It must preserve the state change being communicated, not just remove the animation.

---

## 10. Accessibility

Non-negotiable regardless of visual ambition:
- Semantic HTML and logical focus order preserved through any restyle
- Visible, consistent focus indicators
- WCAG AA contrast minimum for anything decision-critical
- No state ever conveyed by color alone
- Legible text over any image guaranteed structurally
- Full functional parity for reduced-motion users

Bigger imagery makes accessibility harder to get right by construction, not easier.

---

## 11. Responsive Composition

Mobile is a first-class composition, not a compressed desktop layout.

For any surface with real spatial meaning (Duel's opposition, Tonight's Pick's negative space, a large-format backdrop), state explicitly how that meaning survives at narrow width. Vertical stacking is not automatically equivalent to a horizontal relationship.

Use the Composition Workflow (Section 5) for mobile as a separate step — not as "the same, but smaller."

---

## 12. Anti-patterns

Any proposal that triggers one of these needs an explicit justification that overrides it — or it should be cut.

**Reference-derived + V8 playbook confirmed:**
- Glassmorphism / blur panels / backdrop-filter as aesthetic choice
- Card containers with high radius and drop shadow as primary content module
- Symmetric equal-weight grids
- Film-strip / projector / marquee skeuomorphism
- Small, timid imagery
- Decorative gradients untied to content or imagery
- Accent color distributed merely for decoration (not tied to a semantic role)
- Confidence scores, rankings, ratings, percentages, winner glow, VS badges, scoring bars
- Cold streaming-service dark aesthetic (cold blue-black ground with blue-gradient vocabulary) — note: warm-dark vs cold-dark ground temperature is an open art-direction question; generic streaming-service dark is the anti-pattern, not dark grounds in general
- Body copy and large imagery competing at equal visual weight
- Genre/category as the dominant visual entry point

**V8 playbook additions:**
- Jumping to CSS variables before the Composition Workflow (Section 5)
- Movie-decoration applied because the subject is movies rather than because a specific screen's composition calls for it (fake film grain, projector glow, vintage-ticket skeuomorphism, gold-and-serif as cinema shorthand)
- A marketing-style giant hero headline inside a working application screen
- Excessive tilt/parallax/floating particles with no informational purpose
- Scoreboards, winner glow, or confidence implications in Duel
- Celebratory or reward visual language at Tonight's Pick (confetti, "you won" framing)

---

## 13. Runtime Visual QA

Verify against actual rendered output, not just what the CSS appears to say.

At minimum:
- Computed contrast in actual rendered states (default, hover, focus)
- Unexpected horizontal overflow at realistic narrow widths
- Focus order and visibility verified by actually tabbing through, not inspecting markup
- Real before/after screenshots rather than memory of the previous version

Categorical severity only: Critical / Major / Minor / Enhancement. No numeric scores.

---

## 14. Evidence Levels

Throughout all Movie Mood visual work, clearly distinguish:

- **[REF]** — derived from `design-inspiration/` reference inspection
- **[MM]** — existing Movie Mood principle from product history
- **[PROP]** — art-direction inference

Do not blur these categories.

---

## 15. Open Questions (as of V8 analysis)

These require the product owner's explicit taste judgment before being treated as resolved. None of the following should be treated as settled by this skill.

1. **Ground temperature:** warm-dark (cinema-marquee emotional register, REF-4/REF-9) or cold-dark (authoritative/austere, REF-3/REF-7)? The reference set supports both. The locked principle is that the ground must remain chromatically restrained; the temperature is open.
2. **Typography character:** strong personality face (as in the references) or legible neutral?
3. **Card-removal extent:** zero containers (REF-3, REF-7) or near-invisible quiet containers (REF-8)?
4. **Accent color temperature:** warm red (REF-5, REF-8) or crimson (REF-7)?
5. **Mood environmental shift amplitude:** how much can the six moods diverge environmentally before they stop reading as one product?
6. **Tonight's Pick closure mechanism:** subtraction, environmental Lights Down, or a combination?
7. **Duel visual direction:** Separated Fields or Shared Cinematic Frame? Requires equality testing before either is chosen.
