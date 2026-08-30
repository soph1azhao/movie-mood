# Movie Mood — Visual Grammar

> **STATUS: DRAFT — NOT LOCKED FOR IMPLEMENTATION**
> Open art-direction questions must be resolved by the product owner before this grammar is used to drive implementation decisions.

Derived from inspection of `design-inspiration/`. All principles are evidence-labeled.

For individual reference analysis, see `resources/reference-index.md`.
For full analysis with rationale, see `docs/V8_VISUAL_REFERENCE_ANALYSIS.md`.

---

## The 7 Recurring Patterns

### Pattern A — Image as atmosphere source

**Evidence:** REF-3, REF-7, REF-8, REF-5  
**How often:** 4 of 5 web references

The ground is chromatically restrained. All atmospheric color comes from the artwork (photography, illustration, poster). The interface itself carries no competing chromatic energy.

**Effect:** The artwork becomes the mood-source. The interface feels transparent. The viewer's eye goes to the image.

**Movie Mood application:** A chromatically quiet ground throughout. Poster/backdrop imagery is the primary chromatic event on every surface. Ground temperature (warm-dark vs cold-dark) remains an open art-direction decision.

---

### Pattern B — Typography as spatial object

**Evidence:** REF-3, REF-7, REF-8, REF-5  
**How often:** 4 of 5 web references

The primary typographic element on each surface is large enough to function as a spatial anchor — a visual mass, a place, not just a heading. Every other typographic element is dramatically smaller. The binary between these two scales (display / near-invisible) is the entire type system in several references.

**Effect:** Hierarchy through scale and position, not through containers. Titles place rather than label.

**Movie Mood application:** Display-scale type at Tonight's Pick and mood entry. Film titles at meaningful scale at Full Reveal and Duel. All other type: smaller than instinct says.

---

### Pattern C — Absent card containers

**Evidence:** REF-3, REF-7, REF-8, REF-5  
**How often:** 4 of 5 web references

No individual content items are wrapped in a rounded-rect card with shadow. Images sit directly on the ground. Relationships between items are defined through alignment, proximity, and scale.

**Effect:** Content belongs to the ground. No "pick me up and inspect me" signal. Creates editorial authority.

**Movie Mood application:** Remove box-shadows and reduce border-radius from Glimpse cards as a starting point. Test posters placed directly on the ground without containers.

---

### Pattern D — Single accent family with intentional semantic roles

**Evidence:** REF-5, REF-7, REF-8, REF-3  
**How often:** 4 of 5 web references (one uses zero UI accent)

Each reference uses one accent family with a small number of intentional semantic roles — the headline, the primary action, or an optional inline editorial emphasis. Accent color must never be distributed merely for decoration.

**Effect:** The accent retains semantic weight every time it appears because it is never diffused across decorative elements.

**Movie Mood application:** Choose one accent family with a small number of intentional semantic roles. Never use it merely for decoration.

*Optional technique:* Selective inline accenting may be used when editorial copy naturally contains a phrase worth emphasizing. Never rewrite or mechanically highlight copy merely to satisfy a visual pattern.

---

### Pattern E — The contained complete world; frame as ending

**Evidence:** REF-1, REF-2, REF-5 (macro), REF-8 (period punctuation)  
**How often:** Present in 3 of 9 references with strongest density

A complete scene, world, or composition is given a defined frame or terminal signal (the tarot card border, a period, a macro-level card). The name or label below is not a caption — it is the name of that world. The whole says: this is finished; you may enter it.

**Effect:** Each item reads as a complete thing, not as a module in a filterable collection.

**Movie Mood application:** Each film is a complete world, not a filtered result. Tonight's Pick: the title is the film's name. The surface has arrived somewhere.

---

### Pattern F — Light from within the image

**Evidence:** REF-1, REF-2, REF-7, REF-4, REF-9  
**How often:** 5 of 9 references

The image is the light source of the composition. In REF-7, the performance photograph bleeds into the dark background — there is no hard crop edge; the performers emerge from darkness. In REF-1 and REF-2, the golden star and solar halo are the luminosity events from which the composition is illuminated. In REF-4 and REF-9, the incandescent bulbs are the warmth source.

**Effect:** The composition is illuminated by its content, not by UI chrome.

**Movie Mood application:** At Full Reveal and Tonight's Pick, the backdrop should dissolve at its edges into the ground through a luminosity/color gradient — not be cropped in a rectangle. The film is the light source of the surface. (This is a luminosity blend, not glassmorphism — no blur panel.)

---

### Pattern G — Story title over genre label

**Evidence:** REF-5, REF-7, REF-4, REF-9  
**How often:** 4 of 9 references

The entry point into content is a feeling or story, not a taxonomy. "A heartbreak-healing solo trip to the Greek Islands" (REF-5). "I COME IN A WORLD OF IRON TO MAKE A WORLD OF GOLD" (REF-7 pull-quote). "SEE YOU AT THE MOVIES" / "GOOD FILMS MAKE YOUR LIFE BETTER" (REF-4, REF-9). The editorial or emotional line is the structural primary, not the genre category.

**Effect:** Entry through feeling, not taxonomy.

**Movie Mood application:** Film imagery and editorial hook (`curiosityHook` or `vibeSummary`) dominate visually; metadata and secondary controls recede. (Any removal of existing information/actions requires surface-level product verification.)

---

## The 7 Rules for the Next Movie Mood Mockups

These synthesize the recurring patterns into actionable rules for mockup generation and design review.

**Rule 1 — The film is the atmospheric source.**
The ground is chromatically restrained. Poster/backdrop imagery supplies most chromatic and luminance character. This does not require synthetic glow, bloom, halos, or literal light-emitter effects. (Ground temperature remains an open art-direction decision.)

**Rule 2 — Typography establishes places, not headings.**
Display-scale type at Tonight's Pick and mood entry. Film titles at meaningful scale at Full Reveal and Duel. Everything else: smaller than instinct says.

**Rule 3 — Accent family with intentional semantic roles.**
One accent family with a small number of intentional semantic roles. Accent color must never be distributed merely for decoration. (Selective inline accenting is an optional editorial technique when naturally warranted.)

**Rule 4 — Name below, world above.**
Film imagery and editorial hook dominate; metadata and secondary controls recede. At Tonight's Pick, the title is the film's name, not a heading.

**Rule 5 — No individual card containers.**
Radius + shadow card wrapping removed or near-invisible on individual content items. The ground organizes; containers do not.

**Rule 6 — Editorial copy visually primary over metadata.**
`vibeSummary` and `curiosityHook` are higher in the visual hierarchy than runtime/genre/year. Metadata and secondary controls recede visually.

**Rule 7 — Backdrop dissolves into ground.**
At Full Reveal and Tonight's Pick: backdrop blends at edges into the ground through luminosity gradient. Not in a rectangle. Not with a blur panel. A genuine light-into-darkness blend.

---

## Confirmed Anti-patterns

These are anti-patterns supported by both the reference analysis and existing V8 product history.

From the references (conspicuously absent or contradicted):
- Glassmorphism / blur panels / backdrop-filter as aesthetic choice
- Card containers with high radius and drop shadow as primary content module
- Symmetric equal-weight grids / card walls
- Accent color distributed merely for decoration (not tied to a semantic role)
- Small, timid imagery
- Celebratory or reward visual language (confetti, winner glow, "you won" framing)
- Genre/category as the dominant visual entry point
- Cold streaming-service dark aesthetic (cold blue-black ground with blue-gradient vocabulary) — note: warm-dark vs cold-dark ground temperature is an open art-direction question; generic streaming-service dark is the anti-pattern, not dark grounds in general
- Body copy and large imagery at equal visual weight

From V8 playbook (confirmed via product history):
- Film-strip / projector / marquee skeuomorphism
- Movie-decoration applied because the subject is movies (fake film grain, projector glow, vintage-ticket, gold-and-serif as cinema shorthand)
- Confidence scores, rankings, ratings, percentages, VS badges, scoreboard styling in Duel
- Jumping to CSS variables before running the Composition Workflow
- Equal-weight metadata grids / pill walls

---

## Contradictions and Open Decisions in the Reference Set

**1. Cold-dark vs. warm-dark ground temperature:**
REF-3 (Francesco Gioia) and REF-7 (Bolshoi) use cold-dark grounds and feel authoritative, austere. REF-4 and REF-9 (cinema marquees) provide evidence supporting warm-dark (inviting, grounded). Both are present in the reference set. This remains an open human art-direction decision.

**2. The tarot card border:**
REF-1 and REF-2 use a visible thin border frame. This is the closest thing to a UI card in the set — but it functions as a complete-world-container, not a content module. The frame signals "one finished thing." A UI card with radius and shadow signals "one item in a collection." If a border is used at Movie Mood, it must carry the former meaning, not the latter.

**3. Duel finalists visual equality invariant:**
Both finalists must remain perceptually and semantically equal. No compositional device may imply recommendation preference. Separated fields and Shared Cinematic Frame remain live visual directions. Mobile Duel composition is unresolved and must be tested specifically for equality/top-position bias.

**4. Tonight's Pick closure mechanism:**
Must create unmistakable visual closure. Closure may come from subtraction, environmental Lights Down treatment, or a combination. The film and "Find where to watch" must emerge as the dominant remaining focal points.

**5. Mood Entry atmosphere vs interaction burden:**
Mood Entry may carry substantial perceptual atmosphere through lighting, imagery, typography, or composition, provided interaction burden does not increase.

**6. REF-6 as a mostly-negative reference:**
The film-strip motif, the agency/hustle DNA, the orange-on-black maximalism — these are the weakest elements of REF-6 and are not models for Movie Mood. The spatial "strip of frames" rhythm and the use of typography as texture are the only extractable ideas, and they are better supported elsewhere in the set.
