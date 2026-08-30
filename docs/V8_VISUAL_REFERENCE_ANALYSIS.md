> **SUPERSEDED FOR DECISION PURPOSES — AND EVIDENCE BASE PARTIALLY STALE.**
> This analysis was performed against a 9-image reference library that
> included a Bolshoi Theatre redesign reference (referred to as REF-7 in this
> document). That reference has since been **deliberately removed** from
> `design-inspiration/`, which now contains exactly 8 files. Any conclusion in
> this document that depends primarily on the Bolshoi reference (notably
> "Pattern F — Light from within the image" / backdrop edge-dissolve) does
> **not** reflect the locked V8 direction — see `resources/visual-grammar.md`'s
> correction notice and `docs/V8_VISUAL_LOCK.md` §4. "Part 8 — Questions
> Requiring Human Taste Judgment" in this document is fully resolved; see the
> Lock doc. Read this document only for historical rationale on the 8 patterns
> still evidenced by the current library, never as a source of current
> open questions.

---

# Movie Mood V8 — Visual Reference Analysis

**Status:** research only. No implementation, no source changes.
**Evidence basis:** visual inspection of all 9 files in `design-inspiration/`, cross-referenced with V8 playbook and Movie Mood product history.

**Evidence levels:**
- **[REF]** — directly derived from `design-inspiration/` images
- **[MM]** — existing Movie Mood principle from V7/V8 research
- **[PROP]** — my own art-direction inference, clearly labeled

---

## Part 1 — Reference Inventory

All 9 files were visually inspected and confirmed rendered.

| # | Filename | Type | Source | Depicts | Confirmed |
|---|----------|------|--------|---------|-----------|
| 1 | `Moonchild Tarot Card The Star.png` | PNG 3.4 MB | Moonchild Tarot — "The Star" (XVII) | Illustrated tarot card: woman pouring water at night under stars and moon, two black cats, footer "THE STAR." | ✓ |
| 2 | `136937644917437380.png` | PNG 3.0 MB | Moonchild Tarot — "L'Intuition" | Illustrated tarot: woman with solar halo holding a card, raven, black cat, candles, crystals, flora, tarot cards, footer "L'INTUITION" | ✓ |
| 3 | `UX and web design for street photographer.png` | PNG 430 KB | Francesco Gioia — street photographer portfolio | Two states: (a) full-bleed black hero + enormous white condensed type + fragmented angled photo; (b) horizontal contact-sheet gallery + "08 / GALLERY" typographic footer | ✓ |
| 4 | `1024850458924873575.jpeg` | JPEG 60 KB | Cinema marquee — night photograph | Classic cinema marquee at night: neon "CINEMA" sign, changeable-letter board "SEE YOU AT THE MOVIES," incandescent bulb outlining | ✓ |
| 5 | `649925790022103006.jpeg` | JPEG 219 KB | "The Late Checkout" — travel website mockup | Two states: (a) editorial hero with warm serif title over landscape photo; (b) asymmetric story-titled photo grid | ✓ |
| 6 | `Stunning Figma Website Mockup for 2025.jpeg` | JPEG 128 KB | Frank Ponce / "Creative Consigliere" agency site | Dark agency: heavy condensed orange/white type, film-strip motif, full-bleed photography, scrolling marquee text elements | ✓ |
| 7 | `The Bolshoi Theatre - redesign.jpeg` | JPEG 86 KB | Bolshoi Theatre website redesign | Dark cultural-institution design: production detail pages, photography bleeding into dark ground, large editorial pull-quotes, crimson single accent, cast/schedule tables | ✓ |
| 8 | `Work _ Charlotte Evans.jpeg` | JPEG 85 KB | Charlotte Evans — film director portfolio | Light periwinkle background: giant display serif "WORK.", warm orange-red accent, 2-column full-bleed still grid with serif titles below | ✓ |
| 9 | `_.jpeg` | JPEG 73 KB | Cinema marquee — interior, bulb-lit | White marquee board framed in incandescent bulbs: "GOOD FILMS / MAKE YOUR LIFE / BETTER," red ribbed wall behind | ✓ |

---

## Part 2 — Perceptual Analysis Per Reference

### REF-1: Moonchild Tarot — "The Star"

**Composition:** Portrait card. Image field ~85% of area. Footer name-bar ~10%. Focal hierarchy: large golden 8-pointed star (center-top) → figure → water pool → footer label. Mildly asymmetric — crescent moon upper-left, tree upper-right — but the central star anchors. Thin border with low corner radius visibly frames; the frame is deliberate.

**Imagery:** Fully self-contained environment within the card — sky, earth, water, figure, animals, celestial objects. Illustration; palette fully controlled: muted violet sky, warm gold star, lavender earth, black cats as punctuation. Imagery as complete atmosphere, not accent.

**Typography:** Two elements only: "XVII" (small Roman numerals, top-center) and "THE STAR." (spaced serif capitals, footer). Generous letterspacing. The period is structural — it ends, does not elaborate. No body copy, no metadata. Typography has exactly two jobs: index number and name.

**Space:** Border contains calm. Narrow margin between image edge and card edge is a visual breath. Footer strip is a defined anchor, not floating. Negative space is within the image (sky area), not UI whitespace.

**Color:** Dominant violet-blue sky. Warm gold as single high-chroma accent. No true black — deepest areas are purple-navy. The star-to-sky luminosity contrast is the composition's single strongest event.

---

### REF-2: Moonchild Tarot — "L'Intuition"

**Composition:** Same portrait card format, ~87% image. Footer "L'INTUITION" with flanking diamond-star ornaments. Denser than REF-1 but the solar halo creates a strong radial focal point. Eye: halo-glow → upturned face → raised card (containing its own star — nested reference) → cards at feet.

**Imagery:** Maximum layering — floor, figure, objects, background, sky, astronomical elements — yet reads as one unified scene. Warm gold halo is primary light source; candles and gold lettering echo it. Black cats repeat from REF-1 — recurring symbols, not arbitrary decoration.

**Typography:** Same footer structure as REF-1. One identification label placed definitively below. Nothing else.

**Color:** Warmer than REF-1 — golden-teal with rose tertiary. Anchored by one dominant warm-luminosity source.

**Cross-REF-1/2 observation:** The Moonchild Tarot is about symbolic density within a contained frame. Each card is one complete world. The label below is not a caption; it is the name of that world. This structural principle — one complete world, named below — is what is interesting for Movie Mood, not the illustration style.

---

### REF-3: Francesco Gioia — Street Photographer Portfolio

**State A (Hero):** Full-bleed black ground. Enormous condensed white type ("HELLO, I'M / FRANCESCO / GIOIA") at ~60% viewport width. A fragmented, angled portrait photograph is threaded through the type — neither in front nor behind, cutting across. Eye: type mass (by scale) → photograph fragment → whisper-small tracked caps at lower-center. Navigation near-invisible in corners. The black ground absorbs everything; subject matter lives on it.

**State B (Gallery):** Horizontal contact-sheet strip — photographs butted together without gutters. Series names in small spaced caps beneath. Footer: "08" (large numeral as object) and "GALLERY" at equal scale but opposite corners — a typographic conversation across the horizontal field. Typography used as layout.

**Imagery:** Not contained — fragmented, angled, bleeding. The portrait in State A is geometrically sliced into triangles and rectangles floating in the black field.

**Typography:** Ultra-condensed near-full-width sans (display) versus whisper-small tracked caps (everything else). That binary — gigantic / almost-invisible — is the entire type system.

**Color:** Black field. White type. All color comes from the photographs. The images carry atmosphere; the UI has none.

---

### REF-4: Cinema Marquee — Night (Photography)

Not a web design. A found-object photograph.

**What to read from it:** Cinema as civic architecture. The marquee board is industrial caps in three horizontal lines. Message: "SEE YOU AT THE MOVIES" — a promise, a social contract. Warmth from incandescent bulbs outlining the frame. Familiar, comforting, not spectacular.

**[PROP]** This and REF-9 were collected as emotional anchors, not compositional instructions. They say how the owner feels about cinema: warm, public, unpretentious — an invitation rather than a product.

---

### REF-5: "The Late Checkout" — Travel Website

**State A (Hero):** White-framed page card floated on blurred real-world background. Inside: warm landscape photograph with large display serif title laid over it — not in a safe corner, at sufficient contrast (warm red on light sky). Script inscription "scroll down to explore" as a light mark at lower-right. Navigation: minimal warm-red small caps.

**State B (Grid):** Asymmetric: one large center image flanked by smaller strips. Story titles beneath in all-caps. "featured itineraries" in display serif left-aligned; beside it, "places that stay with you" in very small sans at a fraction of the scale. That pairing — enormous serif / tiny sans tagline — is a recurring editorial device. Arrow navigation at lower-right.

**Typography:** Large warm display serif with slightly irregular stroke weight — editorial, not corporate. Two roles only: display serif and tracked-cap metadata/nav.

**Color:** Cream/warm white ground. One warm red accent (not pure red — has orange). Photography supplies warmth. One-accent system.

**Surface language:** Macro card frame has subtle corner radius; individual image items have none. No radius or shadow on images.

**Key principle:** Leads with story ("A heartbreak-healing solo trip to the Greek Islands"), not category. Editorial title is the entry point, not a genre filter.

---

### REF-6: Frank Ponce / "Creative Consigliere" — Agency Site

Dark, aggressive, maximalist. Heavy condensed orange/white type, film-strip motifs with Kodak branding, full-bleed photography, scrolling marquee text, pricing grids.

**What to extract:**
- [REF] The film-strip creates a horizontal rhythm of contained frames — a spatial "strip of frames" idea separable from the film-strip motif
- [REF] Horizontal scrolling marquee text as transition element — typography as texture

**[PROP]** This is the hardest reference to reconcile with Movie Mood. Its DNA is self-promotion and hustle; Movie Mood is quiet and chose. Almost every aesthetic decision violates Movie Mood's restraint principle. The spatial ideas (horizontal strip, contained frame rhythm) are extractable; the aesthetic is not.

---

### REF-7: Bolshoi Theatre Redesign

**Composition:** Two production pages side-by-side. Full dark background. Performance photograph at full width, top — performers partially dissolve into the dark background (no hard crop edge; image bleeds into darkness). Large editorial pull-quote in white serif; the italic word mid-phrase is set in warm crimson — one word, highlighted by color change alone. Production photo strip with actor attributions. Cast table. Schedule/booking rows.

**Imagery:** Photography as atmosphere, not illustration. Performers emerge from darkness rather than sitting in a container. Most explicit example in the set of image as environment.

**Typography:** Pull-quote is large enough to be a layout event, not a text block. The crimson-italic injection: one word, highlighted by color, not by enclosure or weight. No bolding. No underline.

**Color:** Near-black ground. Off-white text. One accent: rich crimson (the crimson of stage lighting and theater seats — not orange, not pink). Photography supplies warm mid-tones. The accent appears once per view section in a meaningful role; never decoratively.

**Surface language:** No card containers. No borders on images. No radius anywhere. Hierarchy through scale and position alone. The schedule table's single crimson-highlighted row (next performance) is informational, not celebratory.

**This is the single reference with the most direct application to Movie Mood's design problems.**

---

### REF-8: Charlotte Evans — Film Director Portfolio

**Composition:** Very light periwinkle/blue-gray background (specific temperature — not white, not neutral gray). "WORK." as display headline: enormous, left-aligned, warm orange-red. Period included — it ends. Three filter pills below in outlined style. 2-column image grid: full-bleed landscape stills, no gutter. Category tag ("MUSIC VIDEO") in micro caps above the title; title in warm red serif below the image.

**Typography:** High-contrast serif with optical weight and ink-trap quality — character, not neutrality. Warm orange-red gives it immediacy. Two registers only: display serif and micro tracked caps.

**Color:** Cold-ground / warm-accent system. Light periwinkle ground. One warm red accent. Photography supplies all other color.

**Surface language:** Grid cells have no radius, no shadow. Images sit directly on the ground. Filter pills: thin outline, minimal radius — restrained.

**Key principle:** Gallery logic — photographs on a ground, named below, categorized above. No marketing framing. No persuasion structure.

---

### REF-9: Cinema Marquee — "Good Films Make Your Life Better" (Photography)

Not a web design. A found-object photograph.

White marquee board in incandescent bulb frame. Three-line message in square capitals: "GOOD FILMS / MAKE YOUR LIFE / BETTER." Red ribbed acoustic wall behind. Concrete ceiling above. Rough, real, warm.

With REF-4: these two marquee photographs reveal a specific conviction about cinema — not glamour, not streaming-service luxury, but the practical warmth of a public building where people go to feel things together. Warm, grounded, unpretentious.

**[PROP]** Movie Mood should feel warm and grounded, not cold-premium or aspirational-brand.

---

## Part 3 — Recurring Visual Grammar

### Pattern A — The image supplies atmosphere; the UI ground stays chromatically quiet

**Evidence:** REF-3 (black ground, all color from photography), REF-7 (dark ground, all color from photography + single accent), REF-8 (light neutral ground, all color from still photographs), REF-5 partially (cream ground, photography supplies warmth).

**Frequency:** 4 of 5 web references.

**Effect:** The artwork becomes the mood-source. The ground does not compete. The viewer's eye goes to the image; the interface feels transparent.

**Structural or decorative?** Structural. The ground must be chromatically quiet for this to hold.

**Movie Mood compatibility:** Yes. Movie posters and backdrops carry enormous chromatic energy. If the ground is quiet, the artwork sets the atmosphere — semantically correct.

---

### Pattern B — Typography as spatial object, not content label

**Evidence:** REF-3 (type at near-full-width, primary composition element), REF-7 (pull-quote as layout event), REF-8 ("WORK." as spatial anchor), REF-5 ("the late checkout" as atmosphere before it is read as a name).

**Frequency:** 4 of 5 web references.

**Effect:** Titles place rather than label. The eye arrives at a title as a visual mass before parsing content. Hierarchy through scale and position, not through containers.

**Structural or decorative?** Structural. Requires genuine commitment to a scale ramp where display type is large enough to be a place.

**Movie Mood compatibility:** Yes, with restraint. Movie titles, mood names, and "Tonight's Pick" are the natural sites. If every surface uses giant type, the pattern loses meaning.

---

### Pattern C — Absent card containers; relationships defined by alignment and ground

**Evidence:** REF-3 (contact-sheet strip, no containers), REF-7 (no cards anywhere), REF-8 (grid without gutter or container), REF-5 (images named below, not wrapped).

**Frequency:** 4 of 5 web references.

**Effect:** Content belongs to the ground rather than being packaged for inspection. No "pick me up" signal from a shadow/radius container. Creates editorial authority.

**Structural or decorative?** Structural. Removing containers means relationships must be defined through alignment, proximity, and scale.

**Movie Mood compatibility:** Translation needed. The "Glimpse card" is a UX mental model — but it does not require a visual card container. Posters placed directly on a quiet ground, named below in editorial type, is a valid Movie Mood option.

---

### Pattern D — Single accent color, used with discipline

**Evidence:** REF-5 (warm red, one accent), REF-7 (crimson, one accent), REF-8 (warm orange-red, one accent), REF-3 (zero UI accent — all color from photography).

**Frequency:** 4 of 5 web references (one uses no UI accent at all).

**Effect:** The accent means something every time it appears because it is never diffused across decorative use.

**Structural or decorative?** Structural when used correctly.

**Movie Mood compatibility:** Yes. Movie Mood's current accent inconsistency is a documented weakness.

---

### Pattern E — The contained complete world; frame as ending

**Evidence:** REF-1 and REF-2 (tarot card: one complete scene, one name below, frame as completion). REF-5 macro level (entire page as a card inside real-world context). REF-8 ("WORK." with a period).

**Frequency:** 3 of 9 references — the tarot cards are the most dense references in the set.

**Effect:** "This is a complete thing" rather than "this is a module in a collection." The frame or the period or the name below say: this world is finished; you may enter it.

**Structural or decorative?** Structural.

**Movie Mood compatibility:** Yes, especially at Full Reveal and Tonight's Pick.

---

### Pattern F — Light from within the image, not applied to the UI

**Evidence:** REF-1 (golden star as light source), REF-2 (solar halo as light source), REF-7 (stage lighting bleeds into dark background — image lit from inside), REF-4 and REF-9 (incandescent bulbs as warmth source).

**Frequency:** 5 of 9 references.

**Effect:** The composition is illuminated by its content, not by UI chrome.

**Structural or decorative?** Structural in REF-1, REF-2, REF-7. Ambient in REF-4, REF-9.

**Movie Mood compatibility:** Yes. This directly answers V8's open question about backdrop behavior. If the backdrop dissolves into the ground rather than sitting in a rectangle, the film becomes the light source of the surface.

---

### Pattern G — Emotional anchor as content; story title over genre label

**Evidence:** REF-5 ("A heartbreak-healing solo trip to the Greek Islands" — story title is the product), REF-4 and REF-9 (marquee messages as feeling, not metadata), REF-7 (pull-quote as primary structural element, not the cast list).

**Frequency:** 4 of 9 references.

**Effect:** Entry into content through feeling, not taxonomy.

**Movie Mood compatibility:** Yes. Movie Mood's `vibeSummary`, `curiosityHook`, and `whyWatch` already pursue this at the content level. The visual hierarchy must reflect it.

---

## Part 4 — What the References Reveal You Do NOT Like

**Absent: Cards as the fundamental content module.**
No reference uses rounded-rect cards with shadow as its primary organizational unit.

**Absent: Symmetric grid layouts.**
REF-5 is asymmetric. REF-3 is horizontal and continuous. REF-7's imagery section is an uneven strip. Symmetric equal-weight card walls do not appear.

**Absent: Glassmorphism or blur-panel surfaces.**
Not a single reference uses backdrop-filter blur, frosted-glass overlays, or blur panels as aesthetic choices.

**Absent: Confidence signals, scoring, or quantification.**
No percentages, ratings, star scores, or numbered rankings appear in any reference — including REF-6, the most marketing-oriented site.

**Absent: Multiple competing accent colors.**
No reference uses more than one deliberate UI accent (excluding photography/illustration).

**Absent: Small, timid imagery.**
Every web reference uses full-bleed photography or imagery at a scale that dominates the composition.

**Absent: Celebratory or reward visual language.**
No confetti, emphasis animations, or "you won" framing. REF-7's crimson schedule highlight is informational, not celebratory.

**Absent: Decoration as subject.**
REF-1 and REF-2 are maximally dense — but every element is symbolic content, not decorative fill. No web reference uses decorative patterns or textures without content function.

**Absent: Generic streaming-service hero.**
No reference uses the dark-gradient-over-movie-poster composition of Netflix/Prime/HBO. REF-7 is the closest, but the photography dissolves into the ground rather than sitting as a contained hero image.

**Contradiction — the film-strip motif (REF-6):**
REF-6 uses film-strip decoration — movie-adjacent skeuomorphism. The V8 playbook already names this an anti-pattern. Its presence in REF-6 is the weakest, most generic element of the site. The spatial idea (strip of contained frames as horizontal rhythm) is separable from the film-strip reference. The motif itself is rejected.

**Contradiction — the tarot card frame (REF-1, REF-2):**
The tarot card's thin visible border is the closest thing in the set to a UI card — but it functions differently. The tarot border says "this is one finished thing." A UI card with radius and shadow says "this is one item in a filterable collection." The structural attitude is what matters; the frame itself is not the answer.

---

## Part 5 — Mapping Reference Grammar onto Movie Mood

### Mood Entry / Glimpse

**Relevant patterns:** B (type as spatial object), A (image supplies atmosphere), G (story over taxonomy).

Entry into a work in the references — photo series (REF-3), film stills (REF-8), travel itinerary (REF-5) — begins with a large grounding title and then the imagery itself. Not through category filters at equal visual weight.

For Glimpse: `curiosityHook` or `vibeSummary` is the film's entry point. Currently it competes with a full metadata field at equal weight. Pattern G implies the story line should dominate; metadata should be nearly invisible. The poster supplies atmosphere (Pattern A); the ground stays quiet.

**Open question for human judgment:** how large can a title/curiosityHook be at Glimpse level before it feels like the screen is spending visual authority too early?

---

### Full Reveal

**Relevant patterns:** E (complete world), F (light from within), G (editorial over metadata). REF-7 is the most direct comparison in the set.

A Bolshoi production detail page is structurally Full Reveal: one production, photography, editorial pull-quote, credits, cast, schedule — but without equal-weight field lists. Photography dissolves into the dark ground (Pattern F). The pull-quote is the typographic anchor. The credits table is the most compressed element.

For Full Reveal: the backdrop should not be contained in a rectangle — it should dissolve into the page's ground. `whyWatch` or `vibeSummary` becomes the typographic anchor (the pull-quote equivalent). The metadata grid is the most visually compressed layer.

---

### Duel

**Relevant patterns:** A (imagery supplies contrast), B (type as spatial anchor), C (no containers), absence of scoring signals.

None of the references show a two-item comparison decision interface. This is the surface that must be most translated from reference grammar, not copied.

What the references show: compositions where two photographic elements coexist without visual hierarchy between them. REF-3's gallery strip puts photographs side by side with no privileging. REF-8's two-column grid treats each work as genuinely equal. The ground between them creates the separation.

For Duel: both finalists' posters sit on the quiet ground with real negative space between them — not a divider, not a seam, not a "VS" badge — a held breath. Film names placed below their respective posters. Neither poster has decoration the other lacks.

---

### Tonight's Pick

**Relevant patterns:** E (complete world), F (light from within), G (emotional declaration). REF-4 and REF-9 as feeling targets.

The marquee photographs speak to the feeling of this screen — not their visual vocabulary (not importing marquee skeuomorphism), but the emotional register: a thing worth saying is said once, in warm light.

Pattern E maps precisely. The film is the world. The title is the name of that world. The surface has gone quiet.

Design action: subtraction, not addition. The poster and title dominate. All secondary actions have receded to near-invisible weight. The ground may be slightly warmer or darker than the browsing state — not as decoration, but as the ambient consequence of arrival.

---

### Mobile

**What survives narrow screens:**
- Large display title (scales down in size, remains proportionally dominant)
- Image-first composition (one poster/backdrop filling horizontal width)
- Name-below-image (simple stack, valid at any width)
- Single accent color
- Chromatically restrained ground

**What does NOT survive:**
- REF-3's fragmented-photo-in-type hero requires viewport width
- REF-7's side-by-side production pages are desktop-only
- Duel's spatial opposition (two posters with held breath between them) cannot work at phone width without deliberate vertical stacking

For Duel on mobile: vertical stack of two posters with strong typographic separation (negative space and film names as anchors, not a "VS" badge) is the required mobile design.

---

## Part 6 — ADOPT / ADAPT / REJECT

| Principle | Evidence | Decision | Why | Movie Mood application |
|-----------|----------|----------|-----|------------------------|
| Image supplies atmosphere; UI ground stays chromatically quiet | REF-3, REF-7, REF-8, REF-5 (Pattern A) | **ADOPT** | Semantically correct: film artwork should be the mood-source, not interface decoration | Warm-dark neutral ground throughout; poster/backdrop is the primary chromatic event |
| Typography as spatial object — scale creates place, not just hierarchy | REF-3, REF-7, REF-8, REF-5 (Pattern B) | **ADOPT** | Directly addresses Movie Mood's lack of typographic anchors | Display-scale type at Tonight's Pick and mood entry; film titles at meaningful scale at Full Reveal and Duel |
| No card containers — alignment and ground define relationships | REF-3, REF-7, REF-8 (Pattern C) | **ADAPT** | Full removal requires compositional rebuild; partial application is immediately viable | Remove box-shadows and reduce border-radius on Glimpse cards; test posters directly on the ground |
| Single accent color, used with discipline | REF-5, REF-7, REF-8 (Pattern D) | **ADOPT** | Movie Mood's current accent inconsistency is a documented weakness | One warm accent; reserved for exactly one semantic role per surface (primary action only); never decorative |
| The contained complete world — frame as ending, name below | REF-1, REF-2 (Pattern E) | **ADAPT** | The tarot format itself is not Movie Mood; the structural attitude (film as complete world, named definitively) is | Tonight's Pick: the title is the film's name, not a heading |
| Light from within the image | REF-1, REF-2, REF-7 (Pattern F) | **ADAPT** | Applies to backdrop at Full Reveal and Tonight's Pick | Backdrop gradient-to-ground blend at edges — not glassmorphism (no blur panel), a genuine luminosity blend |
| Story line as entry point over taxonomy | REF-5, REF-7, REF-4, REF-9 (Pattern G) | **ADOPT** | Movie Mood already has this at content level; the visual hierarchy must reflect it | At Glimpse, `curiosityHook`/`vibeSummary` is visually primary; metadata is barely visible |
| Warmth as emotional grounding | REF-4, REF-9 | **ADAPT** | Feeling is correct; specific visual vocabulary (marquee, bulbs) is not Movie Mood | Warmth as ground temperature — warm-dark neutral, not cold-dark streaming aesthetic |
| Film-strip motif | REF-6 | **REJECT** | Movie-adjacent skeuomorphism, existing V8 anti-pattern | None |
| Agency/hustle aesthetic overall | REF-6 overall | **REJECT** | Wrong product category; contradicts Movie Mood's quiet certainty | None |
| Large-format photography as structural element | REF-3, REF-5, REF-7, REF-8 | **ADOPT** | Confirms V8's existing commitment to genuinely large backdrop/poster scale | Backdrop at Full Reveal and Tonight's Pick should be compositionally dominant |
| Two typographic registers only | REF-3, REF-7, REF-8 | **ADAPT** | The binary works in portfolios; Movie Mood needs an intermediate editorial register | Three registers: display (title/mood), editorial (vibeSummary/curiosityHook), micro (metadata/labels) |
| Single inline accent for one word/phrase | REF-7 (crimson italic in pull-quote) | **ADOPT** | Very specific and useful — highlight a single concept by color alone, without enclosure | In `whyWatch` or `curiosityHook`, one phrase can carry the accent color inline |
| Asymmetric sizing within a set | REF-5 grid | **ADAPT** | Asymmetric sizing principle applies to the three-slate | In the three-slate, one movie could occupy more space — subject to the semantic equality question |
| One world, one name below | REF-1, REF-2, REF-8 | **ADAPT** | Structural attitude, not illustration style | At Glimpse: poster above, title + curiosityHook below, nothing else |
| Generic streaming-service dark aesthetic | — | **REJECT** | Conspicuously absent from the entire reference set | Never |
| Glassmorphism / blur panels | — | **REJECT** | Not present in any reference; existing V8 anti-pattern | Never |

---

## Part 7 — The 8 Strongest Visual Rules for the Next Movie Mood Mockups

Based on the actual reference library.

**Rule 1 — The film is the light source.**
[REF: Patterns A + F] The ground absorbs and frames. The film's poster or backdrop is the primary chromatic event on every surface. The ground stays warm-dark-neutral and does not compete. The artwork sets the atmosphere of the screen it is on.

**Rule 2 — Typography establishes places, not headings.**
[REF: Pattern B] Movie titles, the mood name, and "Tonight's Pick" need to be large enough to function as spatial anchors. Every other typographic element should be smaller than instinct says.

**Rule 3 — One accent, one role, one position per surface.**
[REF: Pattern D] One warm accent color. It appears at most once per surface in a single specific semantic role (the primary action, or one inline editorial emphasis). It never appears in metadata, dividers, icons, or background fills.

**Rule 4 — Name below, world above.**
[REF: Patterns E + G, MM] At Glimpse: poster above, title + `curiosityHook` below, nothing else. At Tonight's Pick: the film becomes the named world — the title is the film's name, not a heading.

**Rule 5 — No individual card containers.**
[REF: Pattern C] Radius + shadow card wrapping is removed or reduced to near-invisible on individual content items. Relationships between items are defined by alignment, proximity, and scale. The ground is the organizing surface, not the container.

**Rule 6 — Editorial copy visually primary over metadata.**
[REF: Pattern G] `vibeSummary` and `curiosityHook` sit higher in the visual hierarchy than runtime/genre/year metadata. Metadata should be barely visible at Glimpse.

**Rule 7 — Backdrop dissolves into ground, not sits in a container.**
[REF: Pattern F] At Full Reveal and Tonight's Pick, the backdrop image should blend at its edges into the dark ground through luminosity/color gradient — not be cropped in a rectangle. The film should feel like the light source of the surface.

**Rule 8 — Warm-dark, not cold-dark.**
[REF: REF-4, REF-9, REF-7 + PROP] The ground should be a warm-dark neutral, not a cold blue-black or pure black streaming-service dark. The warmth comes from the ground temperature itself, not from decorative warm-light overlays.

---

## Part 8 — Questions Requiring Human Taste Judgment

1. **Ground temperature: warm-dark or cold-dark?** Both are present in the reference set. REF-3/REF-7 are cold-dark (authoritative, austere). REF-4/REF-9 imply warm-dark (inviting, grounded). These produce meaningfully different emotional registers.

2. **Typography character: personality or neutral system?** The web references all use typefaces with strong individual personalities. Does Movie Mood commit to a distinctive type character, or use a legible neutral?

3. **How far does card-removal go?** Zero containers like REF-3/REF-7, or near-invisible quiet containers like REF-8? These require different amounts of layout rebuild.

4. **Asymmetric three-slate:** should one of the three movies carry visual primacy as an implicit "lead"? This is a product decision — it changes what the browsing phase communicates about how recommendations work.

5. **Accent color temperature:** warm red (REF-5, REF-8) or crimson (REF-7)? Pure red reads as alert/warning in most UI systems. Which specific warm temperature is right for Movie Mood?

6. **Mood environmental shift amplitude:** the references show one-environment designs. Movie Mood's six moods have no reference equivalent. The right amplitude is a pure taste decision.

---

## Part 9 — Anti-patterns Confirmed by References

**Both references and V8 playbook agree:**
- Glassmorphism / blur panels
- Card containers with high radius and drop shadow as primary content module
- Symmetric equal-weight grids
- Film-strip / projector skeuomorphism
- Small, timid imagery
- Decorative gradients untied to content
- Multiple competing accent colors
- Confidence scores, rankings, ratings, percentages

**New evidence from references — anti-patterns not previously explicit in the playbook:**
- **Generic cold-dark streaming aesthetic** — the entire cold-dark-blue-gradient vocabulary of Netflix/Prime/HBO. The references either avoid dark entirely (REF-5, REF-8) or use warm grounded dark (REF-7). Cold streaming-service dark is conspicuously absent from the inspiration set.
- **Body copy at equal visual weight with imagery** — in every web reference with an image, text is either whisper-small or deliberately subordinate. Large copy blocks and large images never compete.
- **Category/genre as the dominant entry point** — the references consistently lead with emotional/editorial content, not taxonomy.

---

*Document complete. No implementation proposed. No source files modified. `design-inspiration/` was read only.*
