# Movie Mood Voice Guide

**Voice guide version:** `voice.v2`

This is the versioned Movie Mood editorial calibration artifact. Writer and critic inputs must name this version; the critic receives frozen facts, taxonomy, copy, deterministic results, and this guide, never writer hidden reasoning.

## Editorial Job Boundaries

| Field | Job | Must not become |
| --- | --- | --- |
| `description` | Setup, status quo, and central premise. Orient a viewer with only opening-world information. | A plot recap, review, or later-event summary. |
| `whyWatch` | The case for choosing this film tonight: its particular reward, texture, and fit. | A generic quality claim, awards language, or premise restatement. |
| `curiosityHook` | A paradox, question, texture, or spark that earns a closer look. | A `description` paraphrase, synopsis, or twist tease. |
| `vibeSummary` | Compact experiential identity plus viewing cost. | A feature list or generic adjective pile. |

`description` and `curiosityHook` must do different work. The description says where the film starts; the hook finds one intriguing pressure, image, or question within that setup. Deterministic duplication detection flags close paraphrases for review.

## Accepted Calibration Sets

These four-field sets are accepted references, not immutable truth. They are taken from distinct existing Movie Mood archetypes and should be revisited when a record reveals an undocumented distinction.

### Brisk/stylized comedy: `grand-budapest`

- Description: "A meticulous hotel concierge and his lobby boy become entangled in a stolen painting and an improbable inheritance."
- Why watch: "A perfectly composed confection: playful, quick, and comforting without ever feeling slight."
- Curiosity hook: "A vanished painting sends a fussy hotel legend into a perfectly timed caper."
- Vibe summary: "Playful, brisk, and stylish without asking for much emotional recovery."

### Conversational/intimate romance: `before-sunrise`

- Description: "Two strangers meet on a train and spend one unplanned night wandering through Vienna."
- Why watch: "Unhurried, intimate conversation that feels like a late-night walk with someone fascinating."
- Curiosity hook: "A chance train conversation becomes one night of walking, wondering, and almost-love."
- Vibe summary: "Talky, romantic, and low-stakes in the best late-night way."

### Puzzle/tension: `knives-out`

- Description: "A detective investigates a celebrated crime novelist's death in a deeply dysfunctional family."
- Why watch: "A satisfyingly twisty mystery with a sharp sense of humor and a great ensemble."
- Curiosity hook: "A mansion full of heirs turns one death into a very funny maze of motives."
- Vibe summary: "Clever, talky, and propulsive with suspense that stays more fun than grim."

### Quiet/contemplative film: `perfect-days`

- Description: "A Tokyo toilet cleaner finds beauty, ritual, and small surprises in the shape of ordinary days."
- Why watch: "A calm, deeply observant reset button with one of cinema's most generous hearts."
- Curiosity hook: "A quiet daily routine keeps opening into small, luminous moments."
- Vibe summary: "Slow, warm, and more comforting than dramatic."

## Negative Patterns

The following are generic, unsupported, or interchangeable across many films:

- "A must-watch film with unforgettable performances."
- "This movie has something for everyone."
- "A powerful journey of love, loss, and self-discovery."
- "Fans of cinema will appreciate this acclaimed masterpiece."
- "It explores themes of family, identity, and resilience."

Avoid generic critical language such as `tour de force`, `rich tapestry`, `masterful blend`, `stellar ensemble`, `heartwarming tale`, `a love letter to`, `deeply moving`, `breathtaking cinematography`, and `keeps you on the edge of your seat`. These are review flags, not automatic hard failures; a reviewer may retain a rare justified use.

Hard-invalid model or meta language includes claims such as "as an AI", "language model", "I cannot", prompts/instructions, confidence reports, or references to the generation process.

## Setup-Only Spoiler Horizon

Copy may use only characters or central subjects, the starting situation, premise, initial conflict, tone, texture, and viewing experience. It must not expose major reversals, hidden identities, later deaths, culprit information, late relationship outcomes, third-act events, endings, or later revelations.

No universal minute or fixed-act cutoff is used. Deterministic spoiler patterns are weak flags only because wording alone cannot judge context; the critic and human reviewer make semantic spoiler decisions.

`writerNotes.spoilerBoundary` is an auditable structured declaration of the allowed setup material used, excluded late information, and a short source-reference list. It is never provided to the critic.

## Sentence And Lexical Diversity

Across a batch, vary sentence openings, verbs, and adjective clusters. Avoid repeatedly starting with "A [adjective]..." or "This film/movie...", and do not lean on the title in every field. Batch QA flags repeated openings, recurring tricolon constructions ("adjective, adjective, and adjective"), and repeated templates. It does not decide literary quality by itself.

Embedding similarity is intentionally deferred for the initial pilot. Semantic or paraphrase-level cliche convergence is an accepted pilot risk to measure through critic and human review.

## Tone And Layout

Movie Mood is concise, specific, cinematic, and useful for choosing tonight. It may be lyrical when clarity survives. It is warm but not cute by default, confident but not hype-driven, and elegant but not vague. Never write streaming-metadata voice, rankings, awards claims, or model commentary.

`curiosityHook` and `vibeSummary` must retain texture while fitting V8's compact poster-led surfaces; layout fit is assessed separately by the critic and later visual QA.
