# V8.1 Catalogue Scaling Closure

## Decision

V8.1 is closed at the cumulative **Semantic-400** checkpoint: **400/400 valid records**. Semantic-500 is not a release requirement for V8.1.

The milestone answers the engineering question V8.1 set out to answer: can Movie Mood expand its semantic catalogue beyond its original small curated set reproducibly, economically, and without weakening its decision-product principles? The answer is yes. Infrastructure existed to continue to 500, but 400 records supplied sufficient operational evidence; continuing merely to reach a rounder number would not have materially improved that conclusion.

> Streaming platforms help you find more movies. Movie Mood helps you choose one.

> Movie Mood owns meaning. TMDB owns facts.

## What V8.1 Established

V8.1 built a maintainer-side production pipeline while keeping the runtime catalogue static and credential-free. Its safeguards and artifacts include:

- deterministic catalogue selection and TMDB factual acquisition;
- evidence packets that keep factual source material distinct from Movie Mood semantic meaning;
- immutable cumulative semantic cohorts and provenance-bound artifact identities;
- provider abstraction with structured JSON-schema generation and strict semantic/evidence validation;
- resumable manifests, hard fresh-candidate and HTTP budgets, and one-command staged orchestration;
- durable dispatch boundaries, fail-closed ambiguous transport handling, and no silent replay of an unknown dispatch;
- adaptive Kimi reasoning and explicit, offline recovery records for the two observed structurally malformed responses.

Historical Semantic-100 used **High → Max**. New Semantic-200 through Semantic-400 work used **Low → High → Max**. Escalation occurred only after a completed semantic-validation failure; provider or network failure never authorized escalation, and unknown dispatch remained fail-closed.

## Fresh-Tranche Results

Across the fresh Semantic-200, Semantic-300, and Semantic-400 tranches:

| Measure | Result |
| --- | ---: |
| Fresh films | 300 |
| Low attempts | 300 |
| Low first-pass valid | 267 (89.0%) |
| High attempts | 33 |
| Max attempts | 7 |
| Provider failures | 0 |
| Uncertain dispatches | 0 |
| Deterministic offline recoveries | 2 |
| Final valid records | 300/300 |

Some historical semantic-failure counters overlap final recovered status. That is intentional: recovery preserves the original failed response, attempt, usage, and validation provenance rather than retroactively rewriting it as a success.

Provider `total_tokens` for the three fresh tranches were:

| Tranche | Total tokens |
| --- | ---: |
| Semantic-200 | 642,384 |
| Semantic-300 | 602,286 |
| Semantic-400 | 630,992 |
| Combined | 1,875,662 |
| Mean per fresh film | approximately 6,252 |

Provider total tokens are not equivalent to Kimi membership quota units. They are retained as provider-reported planning and provenance metadata, not as a membership-billing conversion.

## Deterministic Structural Recoveries

Strict validation rejected two responses whose semantic selections were stable but whose evidence containers were malformed:

1. **Friday the 13th Part 2** in Semantic-200.
2. **The Golden Glove** in Semantic-400.

Each recovery was candidate-bound to its frozen run, TMDB ID, evidence-packet hash, source response, provider/model/prompt/schema identity, and source effort. The recovery moved only existing evidence objects into the schema-required containers. It did not make a new semantic decision, rewrite text, alter grounding or classifications, or issue another model call.

Both procedures required strict validation before any manifest transition, preserved the original raw response and historical attempts/usage, recorded explicit recovery provenance, verified source bytes and manifest state immediately before commit, and were idempotent. They are not an automatic production normalization mechanism: any future malformed response remains fail-closed until separately reviewed and explicitly authorized.

## Provider Decision

**Kimi catalogue work: CLOSED.** No further Kimi calibration, production runs, Low/High/Max experiments, or K3 experiments are planned for Movie Mood. Existing Kimi artifacts are immutable historical production records.

If the catalogue expands again, its production provider path is the **Gemini Flash family only**. The specific Gemini model is intentionally not selected here; it must be chosen when a future expansion phase is authorized. Kimi, Claude, and OpenAI are not part of that future catalogue-expansion production path.

## Lessons

1. Small calibration runs cannot expose every production failure mode.
2. Strict validation and resumability mattered more than maximizing raw model success rate.
3. A structured response can contain correct semantics and still be unusable production data.
4. Provenance made deterministic recovery possible without rewriting history.
5. Adaptive Low-first generation was operationally useful at hundreds-of-film scale.
6. Engineering rigor should address observed risks rather than endlessly expanding against hypothetical ones.
7. A stopping rule is part of good engineering: 500 or 1,000 are not inherently better milestones once feasibility is demonstrated.

## Place in the Movie Mood Arc

V1 Mood → V2 Context → V3 Discovery → V4 Decide → V5 Real Movies → V5.1 Curation & Closure → V5.2 Progressive Reveal → V6 Selective Decision Companion → V8 → **V8.1 Catalogue Scaling & Production Pipeline**

V8.1 scaled the offline catalogue-production system without reopening Movie Mood's static runtime architecture or changing the product's central purpose: helping a person choose one film.

---

V8.1: CLOSED
SEMANTIC CATALOGUE CHECKPOINT: 400/400
KIMI PRODUCTION: CLOSED
FURTHER SCALE: OPTIONAL, NOT A V8.1 REQUIREMENT
FUTURE EXPANSION PROVIDER: GEMINI FLASH FAMILY
