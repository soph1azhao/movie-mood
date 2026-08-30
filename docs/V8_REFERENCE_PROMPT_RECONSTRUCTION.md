> **SUPERSEDED FOR DECISION PURPOSES — AND PARTIALLY BUILT ON A STALE 9-IMAGE
> LIBRARY.** This document reverse-engineers prompts for 9 references,
> including a Bolshoi Theatre reference (REF-7) since removed from
> `design-inspiration/` (now 8 files). Any REF-7-derived conclusion — notably
> around "Pattern F" / image-dissolves-into-ground mechanics — does not
> reflect the locked V8 direction; see `docs/V8_VISUAL_LOCK.md` §4 and
> `resources/visual-grammar.md`. This document's per-reference translation
> prompts remain useful as historical creative-direction notes but are not
> implementation instructions — the locked prototype
> `editorial-wire-3c-poster-2x3.html` and
> `docs/V8_IMPLEMENTATION_SPEC.md` are.

---

# Movie Mood V8 — Reference Prompt Reconstruction & Reverse-Engineering

**Document Purpose:** Systematically reverse-engineer each of the 9 local references in `design-inspiration/` into:
1. A **Faithful Reconstruction Prompt** (to reproduce the reference's exact aesthetic and composition);
2. A **Negative Prompt** (to isolate what must be excluded to protect its specific taste grammar);
3. A **Movie Mood Translation Prompt** (to adapt its spatial/visual logic into a real Movie Mood surface without altering product semantics).

Following the 9 reverse-engineered references, this document compares the prompt-derived observations against [`docs/V8_VISUAL_REFERENCE_ANALYSIS.md`](file:///Users/hermes/code/movie-mood/docs/V8_VISUAL_REFERENCE_ANALYSIS.md) and marks each existing conclusion as `[CONFIRM]`, `[REFINE]`, or `[CORRECT]`.

---

## 1. Reverse-Engineered Reference Profiles

---

### REF-1: `Moonchild Tarot Card The Star.png`

```
+---------------------------------------------+
|                     XVII                    |
|        *             *             *        |
|               ★ [GOLD STAR]                 |
|      (Crescent)                     (Tree)  |
|            *                 *              |
|               (Young Woman)                 |
|               in lilac robe                 |
|          [Urn 1]         [Urn 2]            |
|       (Rippling Pool)    (Stream & Cats)    |
|                                             |
|=============================================|
|                  THE STAR.                  |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Editorial vintage Tarot card illustration, 'XVII THE STAR.', vertical 2:3 aspect ratio, subtle aged cream border with crisp inner black framing rule. Center composition depicts a serene young woman with dark wavy hair knelt on purple-earth ground pouring water from two earthenware amphorae: one into a rippling azure circular pool, one into a flowing stream beside two attentive black cats. Above her head shines a massive golden-yellow 8-pointed celestial star flanked by seven smaller cream-white 8-pointed stars and a golden crescent moon in a muted dusk-indigo sky. Soft linework with organic stippled ink shading and weathered lithograph texture. Distinct ruled bottom banner holding wide letterspaced serif typography in deep charcoal: 'THE STAR.' with terminal period. Controlled muted palette: dusk indigo (#4A4E69), soft lilac-violet (#9A8C98), pool azure (#457B9D), warm mustard gold (#E9C46A), and deep soot black (#1A1A1A).`

#### 2. Negative Prompt
> `modern vector flat art, digital gradients, neon glow, shiny plastic gloss, 3D render, photographic realism, glassmorphism, card drop shadows, floating UI badges, sans-serif typography, sans-serif labels, cluttered decorative frames, high-saturation magenta or cyan, lens flare, bloom.`

#### 3. Movie Mood Translation Prompt (Surface: Tonight's Pick / Final Arrival)
> `Movie decision arrival screen for 'Decision to Leave'. Contained portrait canvas on a quiet warm-dark charcoal field. 80% of upper surface is dedicated to a poetic, mist-shrouded illustrated or textured film still of the coastal mountain cliff. A single quiet golden starburst glyph anchors the top center above the title. Beneath the artwork, a grounded ruled horizontal footer bar contains the film title 'DECISION TO LEAVE.' in spaced, elegant display serif capitals with a terminal period, followed by a whisper-small subtitle 'TONIGHT'S CHOSEN FILM · 138 MIN'. Below the contained frame, one single terracotta-warm button reads 'Find where to watch'. Zero cards, zero floating tags, zero confidence scores.`

---

### REF-2: `136937644917437380.png` (`Moonchild Tarot — L'Intuition`)

```
+---------------------------------------------+
|       ( ( ( ( ) ) ) ) [MOON PHASES]         |
|             \   |   /                       |
|           -- [SOLAR HALO] --                |
|             /   |   \                       |
|        (Woman holding card)    (Black Cat)  |
|          with star-cloak                    |
|       (Raven on books) (Crystals & Candle)  |
|       (Tarot cards fanned on altar floor)   |
|=============================================|
|              * L'INTUITION *                |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Mythic occult Tarot card illustration, 'L'INTUITION', vertical 2:3 aspect ratio, framed by a soft double-line parchment border with botanical corner flourishes. Center composition features a seated contemplative priestess with dark flowing hair in an off-white draped gown and deep navy celestial cloak embroidered with golden stars and crescent moons. Her right hand raises a tarot card revealing a radiant star. Behind her head radiates a vibrant golden-yellow sunburst halo, crowned above by five lunar phases from crescent to full moon. Surrounding her are sacred objects: a black raven perched on leatherbound grimoires, a lit wax candle with rising smoke, quartz crystal cluster, scattered tarot cards fanned on the ground, red poppy flowers, and a watchful black cat with a crescent-moon collar. Detailed fine-line ink engraving with hand-stippled vintage paper grain. Ruled bottom footer containing centered serif title '* L'INTUITION *' flanked by four-point star glyphs. Palette: antique parchment (#F4ECE1), radiant sun gold (#E0A93B), deep night navy (#1E2B37), poppy crimson (#C14949), and ink black (#111111).`

#### 2. Negative Prompt
> `clean UI components, SaaS design, floating cards, plastic 3D elements, blur panels, glassmorphism, modern geometric sans-serif, garish neon colors, harsh drop shadows, digital interface widgets, web layout chrome, cookie-cutter cards.`

#### 3. Movie Mood Translation Prompt (Surface: Full Reveal — Cinematic Still Framing)
> `Movie Mood Full Reveal hero presentation for 'Decision to Leave'. The film's core imagery (detective Hae-joon and Seo-rae framed against the misty blue mountain peak) is enclosed in an authoritative, finely-ruled vertical frame on a quiet dark-linen ground. Above the image, quiet micro-metadata indicates 'PICK 01 · 2022 · 138 MIN'. Below the artwork, a defined title anchor reads 'DECISION TO LEAVE' in spaced optical serif, flanked by quiet geometric star marks. Immediately beneath, an editorial synthesis paragraph ('whyWatch') sits within the vertical column with generous line spacing. One primary action 'That's the one' rests at the base in rich ochre-gold.`

---

### REF-3: `UX and web design for street photographer.png` (`Francesco Gioia`)

```
+---------------------------------------------+
| FRANCESCO GIOIA           INSTAGRAM GALLERY |
|                                             |
|          HELLO, I'M                         |
|     +--[FRAGMENT]--+                        |
|     | (Angled Photo|                        |
|     |  interlaced) |                        |
|     +--------------+                        |
|          FRANCESCO                          |
|          GIOIA                              |
|                                             |
| FRANCESCO GIOIA  A STREET PHOTOGRAPHER  2021|
+---------------------------------------------+
| [PHOTO 1] [PHOTO 2] [PHOTO 3] [PHOTO 4]     |
| 08                                  GALLERY |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `High-fashion street photography portfolio website layout on an absolute pure black (#000000) canvas. Top state: Monumental ultra-bold, ultra-condensed white sans-serif typography dominates the center: 'HELLO, I'M / FRANCESCO / GIOIA' spanning 70% viewport width. Interlaced and cutting geometrically across the text layers is a dynamic, slightly angled portrait photograph of a woman smoking in dramatic street lighting, sliced with subtle spatial layering behind and in front of the lettering. Corner navigation in whisper-small (11px) uppercase tracking: 'FRANCESCO GIOIA' top-left, 'INSTAGRAM GALLERY CONTACT' top-right, 'A STREET PHOTOGRAPHER BASED IN LONDON' bottom-center, '©2021' bottom-right. Bottom state: Horizontal contact-sheet film strip with zero-gutter rectangular street stills with rich saturated red and deep blue shadows. Lower footer displays massive stark white numbers '08' at bottom-left and 'GALLERY' at bottom-right in wide display sans. Absolute high-contrast editorial minimalism.`

#### 2. Negative Prompt
> `rounded card containers, box shadows, soft gray backgrounds, pastel colors, center-aligned body text blocks, floating buttons, gradient buttons, conversational AI widgets, pill badges, friendly illustrations, modal overlays, skeuomorphic wood or paper textures.`

#### 3. Movie Mood Translation Prompt (Surface: Duel — Side-by-Side Finalist Tension)
> `Movie Mood Duel screen comparing 'Decision to Leave' against 'Drive My Car'. Pitch black (#000000) canvas. Two uncontained, full-bleed vertical cinematic stills sit side-by-side separated by a stark negative space void. Spanning across the top in massive ultra-condensed white display type is the tension header: 'THE FINAL DECISION'. Beneath each still, whisper-small uppercase tracked type lists the title and core cue: '01 / DECISION TO LEAVE — MISTY OBSESSION' on the left, '02 / DRIVE MY CAR — QUIET RECKONING' on the right. In the bottom corners, stark minimal action triggers: 'CHOOSE 01' (bottom-left) and 'CHOOSE 02' (bottom-right) in bold white sans with zero button chrome.`

---

### REF-4: `1024850458924873575.jpeg` (`Cinema Marquee Night — "See You At The Movies"`)

```
+---------------------------------------------+
|                                    | H |    |
|               ( ( CINEMA ) )       | O |    |
|             [Red Neon Outline]     | U |    |
|        +-------------------------+ | S |    |
|        | NOW SHOWING             | | E |    |
|        | ======================= | |   |    |
|        |   SEE YOU AT THE        | |   |    |
|        |       MOVIES            | |   |    |
|        | ======================= | |   |    |
|        +-------------------------+ |   |    |
|          o o o o o o o o o o o o            |
|          [Incandescent Bulb Row]            |
|                     *                       |
|               [Dark Night]                  |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Low-angle night photograph of an authentic vintage Art Deco cinema marquee glowing against a pitch-black night sky. Atop the marquee, glowing red neon cursive letters spell 'CINEMA'. Beneath, a large white illuminated changeable-letter readerboard framed in glowing warm-white incandescent lightbulbs reads in bold black industrial sans-serif tracked block letters: 'NOW SHOWING / SEE YOU AT THE MOVIES'. The right facade shows a vertical neon blade sign with glowing red letters spelling 'HOUSE'. The warm 2700K incandescent bulbs cast a soft downward glow onto subtle architectural details below. Film grain, deep analog shadow contrast, authentic 35mm night photography aesthetic, moody, atmospheric, nostalgic, unpretentious civic cinema.`

#### 2. Negative Prompt
> `daylight, CGI render, digital vector illustration, modern LED strip lighting, futuristic sci-fi interface, oversaturated purple/magenta cyberpunk neon, clean web mockup, generic flat UI, stock photo smiles, motion blur.`

#### 3. Movie Mood Translation Prompt (Surface: Tonight's Pick — Atmospheric Header & Closure)
> `Movie Mood Tonight's Pick celebration screen for 'Decision to Leave'. Deep warm-charcoal (#121110) ground. At top center, a quiet illuminated readerboard-style typography treatment displays: 'TONIGHT'S CHOICE / DECISION TO LEAVE' set in clean, spaced, high-contrast industrial grotesque caps. Soft, warm ambient light (2700K temperature) radiates subtly downward onto a large, crisp vertical poster of the film. Beneath, a clean metadata strip ('2022 · 138 MIN · FINISHES 11:20 PM') is followed by a single amber-warm pill CTA: 'Find where to watch'. The entire screen feels like standing outside a repertory cinema under warm marquee lights.`

---

### REF-5: `649925790022103006.jpeg` (`The Late Checkout`)

```
+---------------------------------------------+
|  [ABOUT    SERVICES    DESTINATIONS]        |
|                                             |
|    the late checkout                        |
|    STORY-LED TRAVEL PLANNING FOR PEOPLE     |
|                                             |
|  +---------------------------------------+  |
|  | (Balcony overlooking coastal town,    |  |
|  |  wine glasses, warm sunny hill)       |  |
|  +---------------------------------------+  |
|                                             |
|  featured itineraries    places that stay   |
|  +--------+ +-------------+ +--------+      |
|  | Photo  | | Large Photo | | Photo  |      |
|  | (Solo) | | (Greek Isle)| | (Arch) |      |
|  +--------+ +-------------+ +--------+      |
|  A MOTHER   A HEARTBREAK-   A SUNNY         |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Warm editorial travel publication website layout displayed as a floating rounded card over a textured warm-grain background. Palette is rich warm cream (#FAF7F2), terracotta cinnabar (#D94A38), and natural sun-drenched earth tones. Hero section features massive lowercase display serif title: 'the late checkout' in vibrant terracotta red, with uppercase tracked sans subtitle 'STORY-LED TRAVEL PLANNING FOR PEOPLE WHO WANT TO FEEL' directly beneath. Below is a warm landscape photograph of a Mediterranean balcony with wine glasses overlooking a coastal town. Lower section: 'featured itineraries' in red display serif beside small sans tagline 'places that stay with you'. Asymmetric 3-column photo grid: one prominent center portrait photo of a swimmer in sunlit waters flanked by smaller vertical vignettes. Story titles beneath each image in red uppercase sans ('A HEARTBREAK-HEALING SOLO TRIP TO THE GREEK ISLANDS'). Editorial, poetic, warm, aspirational, tactile paper feel.`

#### 2. Negative Prompt
> `dark mode, pure black ground, high-tech neon, glassmorphism, generic dashboard widgets, blue links, star rating bars, corporate SaaS styling, cold grays, heavy drop shadows, plastic UI icons.`

#### 3. Movie Mood Translation Prompt (Surface: Glimpse — Three-Slate Recommendation Grid)
> `Movie Mood Glimpse three-slate browsing screen on a warm cream-linen (#F9F6F0) or warm-dark ground. Header displays 'TONIGHT'S THREE DIRECTIONS' in terracotta display serif. An asymmetric 3-slate layout places Film 1 ('Decision to Leave') as a larger centerpiece still (45% width) flanked by Film 2 and Film 3 in narrower vertical frames. Beneath each still, an editorial hook leads in bold terracotta small caps: 'A MISTY OBSESSION IN BUSAN' (for Decision to Leave), 'A QUIET DRIVE THROUGH GRIEF' (for Drive My Car), and 'A HEATWAVE CRIME SPREE' (for Burning). Factual metadata recedes into micro-caps below the hook. Clicking 'Decision to Leave' smoothly expands into Full Reveal.`

---

### REF-6: `Stunning Figma Website Mockup for 2025.jpeg` (`Frank Ponce — Consigliere`)

```
+---------------------------------------------+
| THE CREATIVE CONSIGLIERE                    |
| FOR EMPIRE BUILDERS                         |
| (Man in black cap portrait)                 |
|                                             |
| SCROLLTRIGGER  [Orange Marquee Text]        |
|                                             |
| +-[FILM STRIP]----------------------------+ |
| | [KODAK] [DIY]   [KODAK] [DFY]   [KODAK] | |
| +-----------------------------------------+ |
|                                             |
| PACKAGES DONE FOR YOU                       |
| [Tier 1: $12K]  [Tier 2: $8K]  [Tier 3]     |
| (Orange Cards)  (Orange Button)             |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Dark aggressive personal brand & marketing agency website mockup in Figma. Dark charcoal/black canvas (#0D0D0D) with high-octane electric orange (#FF4500) and white accents. Top hero: heavy, all-caps condensed grotesque sans typography 'THE CREATIVE / CONSIGLIERE FOR / EMPIRE BUILDERS' left-aligned beside a gritty, high-contrast monochrome photo of a founder in a black cap. Below: giant scrolling marquee banner text 'SCROLLTRIGGER' in outlined orange typography. Middle: horizontal sprocket-holed 35mm film-strip carousel with 'KODAK' branding framing pricing tier cards ('DIY', 'DWY', 'DFY'). Bottom: 3-column pricing grid with bright orange CTA buttons ('Let's Connect', 'Get Started'). Maximalist, high-energy, creator-economy, heavy typography, bold contrast.`

#### 2. Negative Prompt
> `quiet minimalism, delicate serif fonts, pastel palettes, calm editorial whitespace, vintage tarot illustration, subtle literary tone, art-house cinema aesthetic, delicate poetry, understated typography.`

#### 3. Movie Mood Translation Prompt (Surface: Rapid Exploration / Film-Strip Carousel Idea)
> `Movie Mood recommendation cycling strip on a charcoal-black canvas. A horizontal sequence of crisp 16:9 movie stills flows across the viewport with continuous horizontal rhythm. As the user cycles, the active film ('Decision to Leave') snaps to the center with bold condensed white display typography above reading '01 / DECISION TO LEAVE' with a single vibrant orange/vermilion indicator pill 'MYSTERY · ROMANCE'. Secondary actions remain quiet in white outline. (Note: sprockets and literal Kodak branding are explicitly stripped; only the horizontal frame rhythm is adapted).`

---

### REF-7: `The Bolshoi Theatre - redesign.jpeg` (`Bolshoi Theatre Redesign`)

```
+---------------------------------------------+
| BOLSHOI                                     |
|                                             |
| EUGENE ONEGIN       (Performance photo      |
|                      emerging from black    |
|                      ground seamlessly)     |
|                                             |
| CREDITS                                     |
| PREMIERED ON         [Libretto details &    |
| SEPTEMBER 1, 2006.    production table]     |
|                      (Crimson CTA Badge)    |
|                                             |
| "THE LOVE CAN CONQUER ANY AGES"             |
| [Crimson italic keyword]                    |
|                                             |
| CAST TABLE & SCHEDULE ROWS                  |
| 15 Sunday   Eugene Onegin  [BUY TICKET]     |
| 16 Monday   Eugene Onegin  [BUY TICKET]     |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Prestigious cultural institution website redesign for the Bolshoi Theatre on a velvety pure dark canvas (#0A0A0A). Top production hero: High-contrast white serif typography 'EUGENE ONEGIN' sits alongside a dramatic stage photography still where the performers (opera singer in tuxedo and gown) emerge organically from the black darkness with zero hard crop borders or boxes. Middle section: 'CREDITS' section with premier date 'PREMIERED ON SEPTEMBER 1, 2006' in crisp white caps, production credits table, and a solitary vibrant crimson red (#C9182B) circular badge. Mid-page pull-quote in large editorial serif: 'THE LOVE CAN CONQUER ANY AGES' with 'THE LOVE' highlighted in crimson italics. Below: horizontal strip of production stills with actor attributions, clean cast list table, and schedule booking rows where a single active date row is filled with a rich crimson highlight banner. Sovereign, theatrical, austere, masterclass hierarchy without cards.`

#### 2. Negative Prompt
> `SaaS card layout, floating cards with drop shadows, border-radius on images, colorful tag pills, glassmorphism blur panels, casual playful fonts, multi-colored button gradients, cluttered icon grids, streaming service hero carousel.`

#### 3. Movie Mood Translation Prompt (Surface: Full Reveal — Complete Editorial Field)
> `Movie Mood Full Reveal screen for 'Decision to Leave'. Deep black ground (#080808). Upper right features a cinematic still of Park Hae-il and Tang Wei on the misty cliff seamlessly dissolving on all sides into the black ground. On the upper left, the title 'DECISION TO LEAVE' is set in a majestic white display serif, with micro-metadata ('2022 · 138 MIN · FINISHES 11:20 PM') in quiet off-white caps below. Center stage is anchored by a large editorial pull-quote: 'An intoxicating romance disguised as a murder investigation' with 'intoxicating romance' rendered in rich crimson italic. Below, the 'Why it fits tonight' synthesis and factual credits sit in an aligned two-column table. One primary CTA 'That's the one' sits at bottom-left in solid crimson.`

---

### REF-8: `Work _ Charlotte Evans.jpeg` (`Film Director Charlotte Evans`)

```
+---------------------------------------------+
| FILM DIRECTOR · CHARLOTTE EVANS WORK CONTACT|
|                                             |
| WORK.                                       |
|                                             |
| [ (NARRATIVE)   (COMMERCIAL)   (MUSIC VIDEO)|
|                                             |
| +-------------------+ +-------------------+ |
| | [STILL 1: Car]    | | [STILL 2: Cave]   | |
| +-------------------+ +-------------------+ |
| MUSIC VIDEO           MUSIC VIDEO           |
| Aldous Harding –      Nadia Reid –          |
| Imagining My Man      Best Thing            |
|                                             |
| +-------------------+ +-------------------+ |
| | [STILL 3: Water]  | | [STILL 4: Bed]    | |
| +-------------------+ +-------------------+ |
| MUSIC VIDEO           MUSIC VIDEO           |
| BAYNK – Naked         Marlon Williams –     |
|                       Beautiful Dress       |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Art film director portfolio website layout on a very pale, cool periwinkle-gray canvas (#E6E8F2). Massive display headline at top left in bold, high-contrast serif typography in blazing cinnabar orange-red (#FF4500): 'WORK.' with a prominent period. Below are three thin outlined filter pills: 'NARRATIVE', 'COMMERCIAL', 'MUSIC VIDEO'. 2-column grid of uncontained, sharp-edged landscape film stills (16:9 aspect ratio) resting directly on the ground with zero drop shadows, zero card frames, and zero border radius. Above each image is a micro tracked uppercase category label 'MUSIC VIDEO'; directly below each image is the artist and project title in high-contrast cinnabar serif ('Aldous Harding – Imagining My Man', 'Nadia Reid – Best Thing'). Pristine gallery layout, bold personality typography, clean Scandinavian editorial aesthetic.`

#### 2. Negative Prompt
> `dark mode, pure black canvas, heavy drop shadows, card wrappers, glossy 3D buttons, blur glassmorphism, generic sans-serif fonts, rainbow tag colors, star rating widgets, busy navigation sidebars.`

#### 3. Movie Mood Translation Prompt (Surface: Full Reveal — Work on Ground Gallery)
> `Movie Mood Full Reveal presentation for 'Decision to Leave' on a curated cool-neutral ground (#E8EBF2) or inverted dark-slate ground (#13161C). At top-left, the title 'DECISION TO LEAVE.' is rendered in a commanding cinnabar-red display serif with a deliberate period. Directly below, a crisp 16:9 or vertical poster still sits uncontained on the ground with zero card wrapping and zero shadow. Above the still, a whisper-small micro-label reads '01 / MYSTERY · ROMANCE'; below the still, the editorial hook 'Why it fits tonight' is set in high-contrast cinnabar serif, followed by the concise rationale. A single cinnabar pill CTA at bottom reads 'That's the one'.`

---

### REF-9: `_.jpeg` (`Cinema Marquee Interior — "Good Films Make Your Life Better"`)

```
+---------------------------------------------+
| [Concrete Industrial Ceiling / Beam]        |
|                                             |
| ||||||||||||||||||||||||||||||||||||||||||| |
| [Red Ribbed Acoustic Slat Wall]             |
|                                             |
| +-----------------------------------------+ |
| | o o o o o o o o o o o o o o o o o o o o | |
| |                                         | |
| |         GOOD FILMS                      | |
| |     MAKE YOUR LIFE                      | |
| |         BETTER                          | |
| |                                         | |
| | o o o o o o o o o o o o o o o o o o o o | |
| +-----------------------------------------+ |
|                                             |
| [Dark Brick / Tile Lower Wall]              |
+---------------------------------------------+
```

#### 1. Faithful Reconstruction Prompt
> `Straight-on eye-level photograph of an authentic vintage illuminated cinema marquee sign inside an independent movie theater lobby. The rectangular sign features a clean white milk-glass readerboard bordered by a double row of exposed warm-amber incandescent lightbulbs (2700K). On the white board, black plastic changeable block letters in a bold, condensed industrial sans-serif spell out the 3-line statement: 'GOOD FILMS / MAKE YOUR LIFE / BETTER'. The sign is mounted against a dark red vertically-ribbed acoustic felt wall, with exposed gray board-formed concrete ceiling above and dark glazed brick tiles below. Warm, tactile, institutional architectural warmth, authentic cinematic atmosphere, 35mm film still quality, rich contrast.`

#### 2. Negative Prompt
> `digital web mockup, flat vector graphics, modern futuristic LED screen, cold blue neon, generic office building, stock photo smiling people, shiny plastic 3D objects, glassmorphism, glowing futuristic holograms.`

#### 3. Movie Mood Translation Prompt (Surface: Tonight's Pick — The Cinema Conviction)
> `Movie Mood Tonight's Pick terminal decision screen. Deep crimson-ribbed or warm charcoal ground. The top of the screen features a warm, softly illuminated readerboard enclosure containing the chosen film's title in bold industrial caps: 'GOOD FILMS MAKE YOUR LIFE BETTER / TONIGHT: DECISION TO LEAVE'. Below, the film's poster stands proudly illuminated by warm ambient lighting, accompanied by the finish time ('Finishes by 11:20 PM') and a single solid amber button: 'Find where to watch'. The entire experience reinforces cinema as an intentional, life-enriching evening ritual.`

---

## 2. Comparison Against `V8_VISUAL_REFERENCE_ANALYSIS.md`

By reverse-engineering the exact prompts required to generate and translate each reference, we can test every major conclusion in the original analysis document for validity.

| # | Major Conclusion in Analysis Doc | Prompt Reverse-Engineering Finding | Status | Rationale & Refinement |
|---|----------------------------------|------------------------------------|:------:|------------------------|
| **1** | **Pattern A: Image as Atmosphere Source**<br>*(The ground is quiet; artwork supplies color).* | Web designs (REF-3, REF-5, REF-7, REF-8) strictly isolate chromatic energy to photography. Non-web references (tarot, marquees) contain their own internal atmospheres rather than UI grounds. | **REFINE** | **Narrows to web subset:** The rule that UI ground stays neutral applies directly to the 4 web references, while photos/illustrations supply color. |
| **2** | **Pattern B: Typography as Spatial Object**<br>*(Type scale establishes place/layout, not just hierarchy).* | In REF-3, REF-5, REF-7, REF-8, display type is the primary compositional anchor (occupying up to 70% viewport width). | **CONFIRM** | Confirmed by direct visual inspection. Typography is layout architecture. |
| **3** | **Pattern C: Absent Card Containers**<br>*(No rounded-rect drop-shadow cards).* | In the web references, 3 of 5 (REF-3, REF-7, REF-8) have zero individual cards, 1 (REF-5) has a macro page frame, and 1 (REF-6) uses cards. | **CONFIRM** | Confirmed by direct inspection of web layouts; card elimination is the key differentiator from generic SaaS. |
| **4** | **Pattern D: Single Accent Family with Intentional Roles**<br>*(Disciplined single accent; never decorative fill).* | Web references use a single deliberate accent (crimson in REF-7, cinnabar in REF-5/REF-8, orange in REF-6, zero in REF-3). Tarot cards (REF-1/REF-2) are multicolor illustrations. | **REFINE** | **Narrows to web subset:** Single accent family is a web interface discipline, not a property of the tarot illustrations. |
| **5** | **Pattern E: Contained Complete World (Tarot)**<br>*(Frame as completion, name below).* | The tarot prompts (REF-1, REF-2) clarify that the outer border and bottom name bar function as a *completion frame* for a finished scene, not a list-item card. | **CONFIRM** | Confirmed as a structural attitude for arrival surfaces (Tonight's Pick). |
| **6** | **Pattern F: Light From Within Image**<br>*(Backdrop dissolves into ground, not in a rectangle).* | The Bolshoi reference (REF-7) specifically demonstrates seamless vignetting of stage photography into the dark ground. Tarot stars and marquee bulbs are metaphorically related but physically distinct. | **REFINE** | **Narrows UI evidence:** The specific UI mechanism (edge dissolving into ground) is directly observed in 1 reference (REF-7 Bolshoi). |
| **7** | **Pattern G: Story Title Over Genre Label**<br>*(Editorial hook visually dominates taxonomy).* | Editorial sentences lead in REF-5 (`A heartbreak-healing solo trip...`) and REF-7 (pull-quote), establishing feeling before metadata. | **CONFIRM** | Confirmed by direct observation in REF-5 and REF-7. |
| **8** | **Ground Temperature: Warm-Dark vs. Cold-Dark**<br>*(Both exist in reference library; temperature is open).* | Direct observation confirms distinct ground families: cold/pure black in REF-3 & REF-7 vs. warm charcoal/cream in REF-4, REF-5, REF-9. | **CONFIRM** | Confirmed as an open human art-direction choice. |
| **9** | **Treatment of REF-6 (Consigliere Agency Site)**<br>*(Mostly negative reference; film-strip skeuomorphism rejected).* | Prompt reconstruction confirms that while Kodak sprockets and marketing hustle are rejected, the *horizontal frame rhythm* is an extractable layout idea. | **REFINE** | The horizontal frame sequence is technically adaptable for recommendation cycling without skeuomorphism. |
| **10** | **Tarot Frame vs. UI Card Distinction**<br>*(Tarot border is a completion container, not a card).* | Reconstructing the tarot prompt isolates the specific spatial mechanic: the **Ruled Footer Anchor** (Image above, ruled dividing line, spaced title below). | **REFINE** | The ruled footer bar is an operational layout mechanic separable from tarot illustration styling. |

---

## 3. Genuinely New / Refined Insights Identified

1. **The "Ruled Footer Anchor" (Decomposition from Tarot REF-1 & REF-2):**
   * *Decomposition insight:* The structural mechanic that gives the tarot cards their grounded authority is the **ruled bottom footer strip containing the spaced title**. Placing a clean, letterspaced title in an anchored footer directly beneath an uncontained visual field provides closure without wrapping the content in a drop-shadow card.

2. **Negative Prompting as an Internal Art-Direction Quality Rubric:**
   * *Operational insight:* Negative prompt terms (`no generic dark gradients, no floating pill clouds, no drop-shadow cards, no synthetic neon glow`) serve as a practical internal checklist for reviewing mockups before presentation.

---

## 4. Evidence Integrity Audit

To ensure the visual grammar rests strictly on genuine evidence, this audit classifies the support for each major claim into four distinct epistemological tiers:
1. **DIRECT OBSERVATION:** Visible directly in the supplied reference image itself.
2. **PROMPT-DECOMPOSITION INSIGHT:** An operational layout description revealed by attempting to reconstruct the composition.
3. **MOVIE MOOD TRANSLATION:** A design inference or adaptation for Movie Mood (not literally present in the source).
4. **CIRCULAR / NOT INDEPENDENT EVIDENCE:** An assertion that appears confirmed only because the prompt or negative prompt was written to match a prior hypothesis.

### Audit Table

| Conclusion | Original Evidence | Reverse-Prompt Contribution | Classification | Keep / Refine / Correct | Effect on Movie Mood Grammar |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Pattern A: Image as Atmosphere Source (Quiet Ground)** | 4 of 5 web references (REF-3, 5, 7, 8) use neutral/quiet grounds; photos supply color. | Prompt reconstruction required specifying exact neutral hex colors (`#000000`, `#FAF7F2`, `#E6E8F2`). Non-web references (tarot, marquees) have no UI ground. | **DIRECT OBSERVATION** *(for web)* / **CIRCULAR** *(if claimed for all 9)* | **REFINE** | **Narrow claim:** Ground must be chromatically quiet across web interfaces; do not cite tarot illustrations or marquee photos as "UI ground" evidence. |
| **Pattern B: Typography as Spatial Architecture** | Massive display type in REF-3 (70% width), REF-8 (`WORK.`), REF-5 (`the late checkout`). | Prompt reconstruction forced measuring exact viewport scale ratios and layout interactions between type and image. | **DIRECT OBSERVATION** | **KEEP** | Titles act as spatial anchors and structural layout dividers, not merely labels. |
| **Pattern C: Card Elimination** | 3 of 5 web references (REF-3, 7, 8) have zero cards; REF-5 has macro frame; REF-6 has cards. | Negative prompts excluded card wrappers. *(Note: Agent-written negative prompts are circular, but direct image inspection holds).* | **DIRECT OBSERVATION** *(via images)* / **CIRCULAR** *(via negative prompts)* | **CORRECT (justification)** | **Preserve rule, fix evidence:** Base card elimination strictly on direct image inspection of REF-3, 7, 8, discarding negative prompts as independent proof. |
| **Pattern D: Single Accent Family** | Web references (REF-5, 7, 8) use 1 accent; REF-3 uses 0; REF-6 uses 1 (orange). Tarot is multicolor. | Reconstruction prompts isolated single semantic hex roles in web layouts (e.g. crimson in Bolshoi). | **DIRECT OBSERVATION** *(for web)* | **REFINE** | **Narrow claim:** Single accent family is a web interface rule. Tarot's multicolor palette does not contradict this because tarot is illustrative art, not UI. |
| **Pattern E: Contained Complete World (Tarot)** | Thin border and footer label in REF-1 and REF-2 frame a single self-contained narrative. | Prompt reconstruction decomposed the frame into border + ruled footer bar. | **DIRECT OBSERVATION** + **PROMPT-DECOMPOSITION INSIGHT** | **KEEP** | Valid model for terminal screens (Tonight's Pick), representing completion rather than a list item. |
| **Pattern F: Backdrop Dissolves into Ground** | REF-7 (Bolshoi) performance photo vignetting into dark ground. | Prompt reconstruction detailed soft edge gradient transitions. Calling tarot celestial glow or physical marquee bulbs "UI light from within" was metaphorical. | **DIRECT OBSERVATION** *(Bolshoi)* / **MOVIE MOOD TRANSLATION** *(others)* | **REFINE** | **Narrow claim:** Dissolving backdrop into ground is directly evidenced by REF-7 (Bolshoi); do not claim 5/9 references show UI edge vignetting. |
| **Pattern G: Story Title Over Genre Taxonomy** | REF-5 headline leads with story (`A heartbreak-healing solo trip...`); REF-7 uses large pull-quote. | Prompt reconstruction placed editorial quotes in primary typographic registers. | **DIRECT OBSERVATION** + **MOVIE MOOD TRANSLATION** | **KEEP** | Direct evidence that editorial feeling precedes taxonomy. Translation to Movie Mood (`whyWatch` > metadata) is sound. |
| **Ground Temperature Remains Open** | REF-3 & 7 use cold black; REF-4, 5, 9 use warm tones. | Reconstructed prompts confirm two distinct aesthetic palettes with different emotional readings. | **DIRECT OBSERVATION** | **KEEP** | Ground temperature (warm-dark vs. cold-dark) is legitimately open and supported by real references on both sides. |
| **Ruled Footer Anchor** | Ruled black line with centered serif text at bottom of REF-1 and REF-2. | Extracted as an isolatable layout mechanism during reverse-prompt structuring. | **PROMPT-DECOMPOSITION INSIGHT** | **KEEP (as candidate technique)** | Provides a concrete, non-card layout pattern for anchoring uncontained imagery with a grounded title bar. |
| **Horizontal Frame Rhythm (from REF-6)** | Kodak film strip in REF-6 creates continuous horizontal cadence. | Stripped sprockets and creator marketing in translation prompt, retaining only frame pacing. | **PROMPT-DECOMPOSITION INSIGHT** + **MOVIE MOOD TRANSLATION** | **KEEP (as cycling concept)** | Spatial rhythm of uncarded horizontal frames is extractable without importing movie-skeuomorphism. |

---

*Audit complete. All conclusions strictly classified by evidence source. `design-inspiration/` read-only integrity preserved.*

