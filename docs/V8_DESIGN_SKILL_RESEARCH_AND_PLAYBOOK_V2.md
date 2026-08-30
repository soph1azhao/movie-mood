> **SUPERSEDED FOR DECISION PURPOSES.** This document is historical research
> from V8's exploratory phase. All open questions it raises — mood-environment
> amplitude, backdrop scale, Duel composition mechanism, Tonight's Pick closure
> mechanism, three-slate asymmetry, ground temperature — have since been
> resolved by human decision. The current, authoritative answers are recorded
> in `docs/V8_VISUAL_LOCK.md`. Where this document's "Closing Questions"
> section (bottom of file) lists something as requiring human judgment, treat
> that as answered by the Lock doc, not as still open. Read this document only
> for historical rationale, never as a source of current design direction.

---

# Movie Mood V8 — Design Skill Research, Critique & Synthesis (v2)

**Status:** research → critique → synthesis only. No V8 implementation spec, no code, no repo changes, no token system.
**Supersedes:** the previous draft's Deliverables 3–5, which let V7.2's specific "atmosphere rationed to Duel→Pick" thesis leak into what was supposed to be a fresh evaluation. Deliverables 1–2 below are carried forward unchanged — re-checked for the same issue and found clean, since they evaluate external sources on their own terms rather than against Movie Mood's prior internal thesis.
**Current released checkpoint (for reference only, not inspected):** `v7.2.0 — Movie Mood V7.2 — Earned Atmosphere`, HEAD `7728eca`.

---

## Deliverable 1 — Research catalogue

*(Unchanged from the prior draft — reproduced here so this document is self-contained.)*

| Source | Repository | Purpose | License | Strongest relevant ideas | Irrelevant / risky ideas | Compatibility notes |
|---|---|---|---|---|---|---|
| **PencilPlaybook** | `stevembarclay/pencilplaybook` (fetched directly; 29 stars, MIT, active) | Perceptual-design defaults + structured workflow for editing Pencil.dev canvas files | **MIT** (verified) | Specific, measurable perceptual defaults stated as researched values, not opinions — a disabled-state opacity threshold set lower than the common default because the common one visually competes with active elements; a minimum lightness delta for hover states below which the change is imperceptible on typical monitors; avoiding pure-white text on dark surfaces (halation); tighter letter-spacing at large display sizes; a minimum touch-target size. Also: survey/inventory a canvas before editing it; scope prompts to touch only what's asked. | Nine scaffold archetypes are all SaaS-shaped (Dashboard, Wizard, Form/Data-Entry) — none map to Movie Mood's actual surfaces. Seven named aesthetic presets are prepackaged brand personalities; adopting one wholesale would be exactly the "external skill becomes the art director" failure mode. | **Verified:** Claude Code + Pencil.dev only, from its own README. **Not documented:** Codex or Antigravity. |
| **unslop-ui-skill** | `claudiusararu/unslop-ui-skill` (fetched directly; 2 stars, MIT) | A catalog of ~100 named "AI design tells" across 9 categories, each with a fix | **MIT** (verified) | The *format* — name the tell, state why it reads as generic, name the fix — generalizes well past this repo's own scope. Several specific tells do too: a default gradient accent used without a deliberate reason, low-contrast gray body text used as a default rather than a decision, universal fade-up-on-scroll applied indiscriminately. | Several tells are explicitly marketing/landing-page conventions (a decorative eyebrow over a hero headline, three-icon-card grids, a specific pale "minimalist" background value) — Movie Mood isn't a marketing site, so importing this vocabulary wholesale imports the wrong product category. | **Verified:** Claude Code, Cursor, Windsurf, v0, Lovable, Bolt, "anything that reads plain Markdown." **Not documented:** Antigravity. |
| **ux-ui-agent-skills** | `plugin87/ux-ui-agent-skills` (fetched directly; 411 stars, 33 forks, MIT, mature — v2.4.0, real CI) | Large design-system + accessibility + motion + runtime-QA kit | **MIT** (verified) | By far the strongest single idea across all three: **render-based verification gates** — measuring actual computed contrast in default/hover/focus states, actual keyboard focus-trap behavior, actual RTL overflow, actual responsive overflow at specific breakpoints, rather than trusting what source code appears to say. Maps directly onto Movie Mood's own documented failure (a responsive rule that read correctly in source and lost in the runtime cascade). Also strong: categorical severity labels (Critical/Major/Minor/Enhancement) as a lightweight triage format; reduced-motion parity treated as mandatory alongside every motion spec; a three-tier token *concept* (raw value → purpose-based alias → component-scoped name), independent of its specific tooling. | Overall scope (138 packaged design systems, 50 component specs, adapters for a dozen-plus frameworks, a full DTCG token pipeline) is wildly oversized for a static six-screen app. Its design-review process assigns numeric percentage weights and produces a score — a process detail, but one that sits uncomfortably close to the same "confidence number" instinct the brief bans from Movie Mood's actual UI. Its packaged aesthetic library is the single biggest "external art director" risk of any source found — well-built, and exactly the kind of thing to study for principles and never copy as a direction. | **Verified:** Claude Code CLI or "any Claude-powered IDE." **Not documented:** Antigravity or Codex. |
| *(unverified, snippet-only)* **design-anti-slop** | `prathameshagrawal/design-anti-slop` | Anti-generic-design audit skill | *Not independently confirmed* | Not evaluated in depth — flagged only because its own listing explicitly claims Codex compatibility, the most direct such claim found. | N/A | **Unverified** — worth an independent fetch before relying on it. |

**On Antigravity specifically:** none of the three verified sources document Antigravity compatibility. Separately (from earlier research this session), Antigravity has adopted its own `SKILL.md`-format skill system compatible with the same open convention — a *reasonable inference*, not a documented fact from these repos.

---

## Deliverable 2 — ADOPT / ADAPT / REJECT analysis

*(Unchanged from the prior draft — re-checked specifically for V7.2-thesis contamination and found clean; these evaluate external ideas against Movie Mood's real constraints, not against V7.2's specific atmosphere-rationing answer.)*

| Idea | Source | Decision | Reason | Movie Mood application |
|---|---|---|---|---|
| Measurable perceptual defaults (hover lightness delta, disabled-opacity ceiling, halation-avoiding text color, minimum touch target) | PencilPlaybook | **ADOPT** | Facts about perception, not a "look" — adopting them doesn't hand over art direction. | Section 6 (Typography) below. |
| "Survey before editing" / scoped-change workflow discipline | PencilPlaybook | **ADOPT** | Directly reinforces composition-first working and "preserve semantics" discipline. | Section 5 (Composition workflow) below. |
| Named aesthetic presets as a starting point | PencilPlaybook | **REJECT** | Prepackaged brand personalities risk anchoring Movie Mood's identity to someone else's palette. | None. |
| SaaS-shaped scaffold archetypes | PencilPlaybook | **REJECT** | None correspond to any of Movie Mood's actual surfaces. | None. |
| Naming specific, checkable "tells" with a stated fix, as a catalog format | unslop-ui-skill | **ADOPT** | The format is directly reusable for Section 13 (Anti-patterns), independent of the specific list. | Structure for Section 13. |
| Cross-product tells: default gradient-as-accent, low-contrast gray as a default, indiscriminate scroll-fade | unslop-ui-skill | **ADAPT** | Generalize past marketing pages, but Movie Mood needs its own list derived from its own code, not a copied catalog. | Cross-referenced into Section 13. |
| Marketing-specific tells (eyebrow pills, icon-card grids, a specific background value) | unslop-ui-skill | **REJECT (as listed)** | Movie Mood isn't a marketing product; forcing this vocabulary in imports the wrong category. | None directly. |
| Render-based verification of actual computed output | ux-ui-agent-skills | **ADOPT** | The strongest idea found; maps precisely onto a real Movie Mood bug. | Section 15 (Runtime visual QA). |
| Numeric, weighted design-review scoring | ux-ui-agent-skills | **REJECT** | Same instinct the product explicitly forbids in its UI; unneeded at this project's scale. | None. |
| Categorical severity labels without numeric scores | ux-ui-agent-skills | **ADAPT** | Keep the triage, drop the percentage weighting. | Deliverable 4 below. |
| Reduced-motion parity as mandatory, not a fallback | ux-ui-agent-skills | **ADOPT** | Already this project's operating standard; independently confirmed as correct practice. | Section 10 (Motion). |
| Three-tier token concept, independent of DTCG tooling | ux-ui-agent-skills | **ADAPT** | Useful mental model; actual token system is explicitly out of scope for this task. | Section 16 (Implementation handoff), noted only. |
| 138-entry design-system library, multi-framework adapters | ux-ui-agent-skills | **REJECT** | Oversized for a static six-screen single-stack app; clearest "external art director" risk found. | None. |
| Backdrop-led composition | this task's own brief | **ADOPT** | Directly named, and matches Movie Mood's own `backdropPath` exploration. | Section 7 (Imagery/backdrops) — see rework below. |
| Glassmorphism / arbitrary blur as default | independently flagged by both this brief and unslop-ui-skill | **REJECT** | Two independent sources naming the same pattern. | Section 13. |

---

## Deliverable 3 — Proposed playbook: `movie-mood-cinematic-design`

*Agent-neutral — Claude Code, Codex, or Antigravity equally. No wording copied from any source.*

### 1. Purpose

This playbook turns "make it cinematic" into checkable decisions. It's written for V8 specifically, which exists because V7.2 was technically sound but perceptually too subtle — so this version does not treat V7.2's specific choices as settled precedent. Where V7.2 made a conservative call, that call is available as one input among several, not as inherited law.

### 2. Product principles

> Streaming platforms help you find more movies. Movie Mood helps you choose one.

> **Be conservative with semantics. Be ambitious with experience.**
> **Preserve semantics ≠ preserve layout.**

Every visual decision is tested against one question: does this help the user feel closer to choosing, or does it just look good? Recommendation logic, `DecisionState`, Duel/Drop-One behavior, favorites, URL/sharing semantics, finish-time logic, and the TMDB factual/editorial split are out of scope and must never be touched — but almost everything about *how those semantics are presented* is legitimately open for V8, including layout decisions V7.2 settled one way.

### 3. Semantic invariants

Non-negotiable regardless of styling:

- **Two finalists in Duel are semantically equal.** No glow, no larger scale, no leading position, no scoreboard, no percentage, no implied "winner."
- **Movie Mood knows more than it shows.** Rich internal metadata doesn't obligate a badge grid or a wall of equal-weight pills. Silence on a neutral field is a valid design decision.
- **Mood is one environment, not five separate skins.** However far the environmental shift goes (see Section 8 — deliberately left open), the same type system, spatial language, and motion character must survive it. If a screenshot of one mood state could be mistaken for a different product entirely, the shift has gone too far — but "too subtle to notice" is an equally real failure mode this version should not default toward.
- **The coin never chooses.** Both finalists remain genuinely selectable after any flip treatment.

### 4. Visual principles

**Cinematic emerges from composition, not decoration** — image placement, typographic hierarchy, lighting, sequencing, and what's deliberately left out, never from film grain, projector-glow filters, vintage-ticket skeuomorphism, or gold-and-serif applied because the product happens to be about movies.

**Every surface earns its atmosphere from what it's actually doing, not from its position in a funnel.** This directly retires V7.2's "atmosphere is rationed to Duel→Pick, upstream stays light" rule as an assumed default. The question for any surface is: what is this screen's actual job right now — fast recognition, comfortable browsing, focused comparison, or commitment — and does more visual ambition here serve that job or fight it? A dense information surface can carry real atmosphere if the atmosphere clarifies rather than competes with the content. A fast-recognition surface can too, if it speeds recognition rather than adding things to parse. "This is early in the journey, so it should stay minimal" is no longer, on its own, a valid reason to reject an idea.

**The real ceiling is Section 3 and Section 13, not a position-in-the-journey rule.** A proposal either violates a semantic invariant or an anti-pattern, or it doesn't — "is this appropriate for how far along the user is" is a question worth asking, but it no longer resolves automatically in favor of restraint.

### 5. Composition workflow

Before any CSS, token, or component-level detail is proposed, describe — for both desktop and mobile — in this order: (1) what the image is doing and how dominant it is; (2) the single, nameable primary focal point; (3) what the typographic hierarchy communicates before any copy is read; (4) what's present versus deliberately withheld; (5) where the negative space is and what it protects; (6) which action, if any, is visually primary; (7) what happens on transition in and out; (8) how all of the above changes — not just shrinks — at phone width. Only once this is agreed does implementation detail become the right conversation. Jumping straight to CSS variables is an anti-pattern (Section 13).

### 6. Typography

Roles, not just sizes: display, movie title, editorial copy (`vibeSummary`, `curiosityHook`, `whyWatch` — a consistent voice regardless of how ambitious the surrounding screen gets), metadata, decision/button microcopy. Editorial copy line length in a genuinely readable range (~45–75 characters). Checkable perceptual facts adopted from research: avoid pure-white text on dark surfaces; tighten letter-spacing slightly at large display sizes; pair any size-based hierarchy distinction with a weight or color change so it survives at a glance.

### 7. Imagery / backdrops

Backdrops establish environment and depth. **V8 should test backdrop imagery at genuinely large, meaningful scale** — the working design question is whether Full Reveal can feel like entering the film, and a backdrop cropped small and tucked into a corner is unlikely to ever answer that honestly. This explicitly reopens ground V7.2 didn't push very far. The one non-negotiable regardless of scale: legibility over any backdrop must be guaranteed structurally (a scrim, gradient, or fixed-contrast overlay engineered to work regardless of the specific image), not assumed from one test image — bigger imagery raises the stakes on this, it doesn't excuse it. Where poster/backdrop dominance is used, size it to do its actual job on that specific surface rather than following a fixed stage-by-stage curve.

### 8. Environmental mood

This is one of V8's genuinely open questions, not a mechanism to be applied cautiously by default. The real constraint — stated directly, not inherited from V7.2 — is: **can the six moods feel environmentally different while remaining one coherent Movie Mood visual universe?** That's a boundary (Section 3's invariant: structural language survives every mood state) to hold, not an amplitude to cap in advance. The right way to find the amplitude is empirically, through Deliverable 5's mood-comparison study — not by assuming a narrow shift is correct because a narrower version was chosen previously.

### 9. Information hierarchy

Default to editorial judgment over completeness. A field existing in the data model isn't sufficient reason to display it at every stage — decide per surface what's tier-one (drives the decision), tier-two (useful context), tier-three (disclosed on demand), and resist equal visual weight across all three just because it's easy to render that way.

### 10. Motion

Every motion needs a stated narrative purpose before it's proposed. Motion belongs at transitions that carry real meaning (narrowing from three to two, a coin settling, arriving at the final pick); routine browsing actions (cycling recommendations, toggling a filter) should feel instant rather than under- or over-animated — this is about whether motion carries state-meaning, not about upstream/downstream position. **Reduced-motion parity is mandatory in the same breath as the full version**, and must preserve the state change being communicated, not just vanish alongside the animation.

### 11. Responsive composition

Mobile is a first-class composition, not a compressed desktop layout. For any surface with real spatial meaning (Duel's opposition, the negative space around Tonight's Pick, a large-format backdrop at Full Reveal), state explicitly how that meaning survives at narrow width — vertical stacking is not automatically equivalent to a horizontal relationship, and if the meaning can't survive the stack, the surface needs a genuine mobile-specific answer.

### 12. Accessibility

Non-negotiable regardless of visual ambition: semantic HTML and logical focus order preserved through any restyle; visible, consistent focus indicators; WCAG AA contrast minimum for anything decision-critical; no state ever conveyed by color alone; legible text over any image guaranteed structurally; full functional parity for reduced-motion users. Bigger, more ambitious imagery (Section 7) makes this harder to get right by construction, not easier — treat it as a bigger obligation, not a smaller one.

### 13. Anti-patterns

Confirmed across multiple sources, plus Movie Mood-specific additions: glassmorphism/arbitrary blur as a default surface treatment; a default gradient accent without a deliberate reason; low-contrast gray body text as a default rather than a decision; equal-weight metadata grids/pill walls; scroll-fade-in applied indiscriminately rather than reserved for meaningful transitions; every section boxed as a bordered card; fake film grain, projector-glow, vintage-ticket skeuomorphism, gold-and-serif, or any movie-decoration applied because the subject is movies rather than because a specific screen's composition calls for it; a marketing-style giant hero headline inside a working application screen; excessive tilt/parallax/floating particles with no informational purpose; scoreboards, VS badges, winner glow, or any confidence/ranking implication in Duel; jumping to CSS variables before the composition workflow (Section 5).

### 14. Perceptual acceptance

See Deliverable 4. Findings triaged categorically — Critical/Major/Minor/Enhancement — never scored numerically.

### 15. Runtime visual QA

Verify against actual rendered output, not just what the CSS appears to say — Movie Mood has already had a bug of exactly this shape. At minimum: computed contrast in actual rendered states (default, hover, focus); unexpected horizontal overflow at a few realistic narrow widths; focus order and visibility verified by actually tabbing through, not by inspecting markup; real before/after screenshots rather than memory of the previous version.

### 16. Implementation handoff

This playbook governs decisions, not files. The three-tier token concept (raw value → alias → component-scoped name) is worth carrying forward as a mental model in plain CSS custom properties, without needing a token-build pipeline. Any proposed change should be traceable to a specific section here — "this serves Section 4's per-surface-job principle" is a legitimate justification; "this looks more premium" is not, on its own.

---

## Deliverable 4 — Perceptual acceptance framework

Categorical triage only (Critical/Major/Minor/Enhancement) — never a numeric score.

**V7.2 vs. V8 screenshot test.** Side by side, unlabeled: would a normal user recognize V8 as a substantial visual evolution within a few seconds, or as the same product photographed twice? This is the task's own stated acceptance bar, and it's a harder bar than "looks nicer" — a spacing/radius pass fails it outright.

**Mood-environment test.** With the mood control hidden, can a viewer still sense which of the six moods produced this state — or at least that *something* environmental shifted? And separately: does a grid of all six together still read as one product? Both directions of failure matter equally now — too subtle is as much a failure as too fragmented.

**Glimpse → Full Reveal test.** Not "does Full Reveal look good" in isolation, but does the *transition into it* read as entering the film, or as the same card getting larger with more fields visible? If the honest description is "it's the same card, just more of it," this fails regardless of how polished the added content is.

**Duel test.** Do the two finalists read as genuine cinematic opposition — real posters, real spatial tension — while remaining checkably equal? Could a viewer point to any single visual cue and say "this one seems to be winning"? If yes, fail, independent of how good the composition looks.

**Tonight's Pick closure test.** Does arriving here feel like a door closing, or like one more card in a longer scroll? Does the surrounding chrome visibly recede compared to earlier surfaces?

**Mobile-composition test.** Does the mobile version of a spatially meaningful surface preserve *why* the desktop composition looks the way it does, or does it just stack the same blocks vertically? "We let it wrap" is a fail condition here, not a pass.

**Additional — the render check.** Independent of visual intent: does the surface survive Section 15's runtime QA? A surface can pass every test above and still ship a real accessibility or responsive regression if this is skipped.

*(The previous draft included a "restraint check" — flagging anything upstream that added weight as a likely violation. That test directly encoded the now-retired atmosphere-rationing thesis and has been dropped rather than carried forward.)*

---

## Deliverable 5 — Visual exploration recommendations

Five studies, each in the requested format. Not more — the brief's own instruction to keep this small still holds.

**1. Full Reveal — backdrop scale**
- *What's mocked:* two treatments of the same movie's Full Reveal — one with a large-format backdrop genuinely establishing environment, one composition-only (typography/spacing/hierarchy alone, no backdrop change).
- *Desktop/mobile:* both required — backdrop-at-scale is the item most likely to behave very differently at narrow width.
- *Design question resolved:* is backdrop imagery load-bearing for "entering the film," or can composition alone achieve it? Directly affects how much V8's scope depends on `backdropPath` data coverage.
- *Competing directions:* large-format backdrop vs. composition-only — presented as genuinely open, not as a bold option versus a safe default.

**2. Duel — spatial opposition**
- *What's mocked:* two finalists with genuine negative space between them (no shared border/seam) vs. a shared-frame treatment (two tiles meeting at one visible seam).
- *Desktop/mobile:* both required — this is the surface most likely to lose its meaning under naive stacking.
- *Design question resolved:* which mechanism reads as cinematic tension without drifting toward VS-spectacle, while staying checkably equal per Section 3.
- *Competing directions:* genuine negative space vs. shared-frame opposition.

**3. Tonight's Pick — closure mechanism**
- *What's mocked:* a subtraction-led closure (fewer competing elements, one clear primary action, more whitespace) vs. a literal ambient "lights down" effect (the screen's background itself visibly quiets).
- *Desktop/mobile:* both required.
- *Design question resolved:* does "Lights Down" need to be a literal environmental effect to land, or does hierarchy discipline alone produce the same felt closure? These carry different implementation cost for a potentially similar payoff.
- *Competing directions:* subtraction/hierarchy-only vs. literal ambient shift — treated as equally live options, not weighted toward the lower-risk one by default.

**4. Mood-environment comparison grid**
- *What's mocked:* all six moods' ambient states on the same surface — Glimpse is the right candidate (busiest information density, most likely to reveal whether a shift reads as one product or five).
- *Desktop/mobile:* desktop primary; mobile only if desktop reveals something worth checking narrower.
- *Design question resolved:* directly answers the mood-environment test from Deliverable 4 before any code exists.
- *Competing directions:* not a two-option comparison — a single six-state grid, amplitude genuinely unconstrained going in, per Section 8.

**5. Winning Duel composition — mobile recomposition**
- *What's mocked:* whichever Duel treatment wins study 2, built out properly for phone width rather than assumed.
- *Desktop/mobile:* mobile-focused by design — this study exists specifically to test the mobile side.
- *Design question resolved:* does the winning composition actually survive Section 5/11's mobile-recomposition requirement, or is it secretly a desktop-only idea?
- *Competing directions:* none — this is a validation study on the output of study 2, not a fresh comparison.

---

## Closing question

> **What visual decisions still require human judgment before this playbook should be treated as locked?**

1. **How large and literal should backdrop imagery get at Full Reveal** — Section 7 deliberately reopens this rather than pre-capping it; study 1 informs it, but committing to a scale is a human call.
2. **How much amplitude the mood-environment shift should have** before it stops reading as one coherent universe — Section 8 sets the boundary, not the amplitude; study 4 is the evidence, the line itself is a taste decision.
3. **How far atmosphere is now welcome upstream** (Glimpse, Refine, mood entry) now that the blanket "stays light" rule is retired — Section 4 replaces a fixed rule with a per-surface test, and applying that test still takes judgment, not just permission.
4. **Duel: genuine negative space vs. shared-frame opposition** — both are defensible against the equality invariant; which one Movie Mood actually wants is a taste call this playbook can't make unilaterally.
5. **Tonight's Pick: literal "lights down" vs. hierarchy-only closure** — different implementation cost, an open question on payoff; worth taking the literal version seriously rather than treating it as the riskier option by reflex.
6. **How much of the categorical-severity / render-QA process (Sections 14–15) is worth running by hand** at Movie Mood's actual one-person, six-screen scale, versus approximated — a proportionality call, not something this document should decide alone.
