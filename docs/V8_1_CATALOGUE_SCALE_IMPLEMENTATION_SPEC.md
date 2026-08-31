# Movie Mood V8.1 - Catalogue Scale Implementation Spec

**Status:** Accepted architecture, implementation specification.
**Baseline:** `v8.0.0` / `e2620f5 - Implement V8 cinematic identity`
**Goal:** Scale Movie Mood from a 41-film hand-curated catalogue to a maintainable 1,000+ complete-film catalogue without sacrificing the static architecture, recommendation semantics, or V8 Editorial Wire identity.

Movie Mood's governing principle remains:

> Movie Mood owns meaning. TMDB owns facts.

At V8.1 scale, Movie Mood meaning may be assisted by maintainer-side model calls, but generated meaning is never production data until it passes validation and human review.

---

## 1. Purpose

V8.1 creates a maintainer-side offline catalogue production system for selecting, enriching, validating, reviewing, benchmarking, and promoting complete Movie Mood records.

The output remains the same kind of static production catalogue V8 already uses:

- `src/data/curatedMovies.ts`
- `src/data/tmdbMovieMappings.json`
- `src/data/generated/tmdbMovies.json`

V8.1 is not a return to the 10-20-film manual expansion model. The explicit target is a maintainable path to 1,000+ complete movies.

---

## 2. Non-Goals

V8.1 does not add:

- Runtime AI
- Runtime authenticated TMDB API calls
- A backend
- A database
- Accounts
- Streaming-provider integrations
- Runtime embeddings
- Runtime taste profiles
- Runtime recommendation scoring
- A reduced-content or metadata-only movie tier
- Auto-committed generated catalogue records
- V8 visual redesign work
- Recommendation changes before benchmark evidence proves a problem

---

## 3. Locked Architectural Constraints

V8.1 must preserve:

- Maintainer-side offline enrichment only
- Zero runtime AI
- Zero runtime authenticated TMDB API
- No backend or database
- GitHub Pages deployment
- Static Vite + React + TypeScript frontend
- Committed static production catalogue
- Complete editorial fields for every production movie
- V8 Editorial Wire visual experience
- Existing recommendation semantics unless scale measurements prove a problem
- Separate semantic classifier, editorial writer, and validation/critic stages
- Critic independence from writer hidden reasoning
- Hard validation distinct from semantic anomaly review
- Evidence-based confidence and review queue
- Solo-maintainer review as the default workflow
- Staged scale gates: 100 -> 250 -> 500 -> 1,000
- Empirical static/frontend performance benchmarks
- Empirical recommendation-at-scale benchmarks

Implementation agents may execute closely related phases as coherent work tranches when all checks pass and no stop condition is reached. This spec defines safety gates, not procedural bureaucracy.

---

## 4. Existing V8 Data Architecture To Preserve

Production V8 already has the correct split between meaning and facts.

### 4.1 Curated Meaning

Source:

```text
src/data/curatedMovies.ts
```

Shape:

```ts
interface CuratedMovie {
  id: string
  tmdbId: number
  moods: Mood[]
  situations: ViewingSituation[]
  filterLanguages: string[]
  pace: Pace
  emotionalWeight: EmotionalWeight
  attentionDemand: AttentionDemand
  discoveryStyle: DiscoveryStyle
  description: string
  whyWatch: string
  curiosityHook: string
  vibeSummary: string
  palette: [string, string]
}
```

Movie Mood owns these fields.

For V8.1, `palette` becomes deterministic poster-derived data with optional human override. A palette remains required for production because it supports fallback poster presentation, but the default source should be automated rather than manually invented for every movie.

### 4.2 TMDB Facts

Sources:

```text
src/data/tmdbMovieMappings.json
src/data/generated/tmdbMovies.json
```

Shape:

```ts
interface MovieFacts {
  tmdbId: number
  title: string
  year: number
  director: string
  countries: string[]
  spokenLanguages: string[]
  genres: string[]
  runtimeMinutes: number
  posterPath: string | null
}
```

Only factual fields genuinely required by the production resolver are hard blockers. Optional TMDB incompleteness, where compatible with the resolver and UI, should become review or data-quality flags rather than automatic batch failure.

### 4.3 Runtime Merge

Source:

```text
src/data/movies.ts
```

Runtime `Movie` merges curated meaning and TMDB facts, with `languages` resolved from curated `filterLanguages`.

V8.1 must preserve this production contract unless a later approved migration changes it.

---

## 5. Maintainer-Side Directory Architecture

Pipeline root is locked:

```text
catalogue-pipeline/
```

Proposed structure:

```text
catalogue-pipeline/
  README.md
  config/
    schemaVersion.json
    taxonomyVersion.json
    provider.example.json
  candidates/
    pilot-100.json
    batch-250.json
    batch-500.json
    batch-1000.json
  calibration/
    anchors.json
    boundaryCases.json
    voice-guide.md
    goldSubsets/
      pilot-100-gold.json
  prompts/
    semantic-classifier.v1.md
    editorial-writer.v1.md
    critic.v1.md
  schemas/
    candidate.schema.json
    tmdb-facts.schema.json
    semantic.schema.json
    editorial.schema.json
    critic.schema.json
    review-queue.schema.json
  scripts/
    runBatch.mjs
    enrichTmdb.mjs
    classifySemantic.mjs
    writeEditorial.mjs
    runCritic.mjs
    validateBatch.mjs
    checkEditorialVoice.mjs
    checkPosterSuitability.mjs
    scoreConfidence.mjs
    buildReviewQueue.mjs
    evaluateGoldSubset.mjs
    benchmarkStaticCatalogue.mjs
    benchmarkRecommendations.mjs
    promoteReviewedBatch.mjs
  adapters/
    modelProvider.ts
    tmdbProvider.ts
  generated/
    validation/
    reviewQueue/
    reports/
```

Raw caches and intermediate artifacts are ignored by default:

```text
catalogue-pipeline/cache/
catalogue-pipeline/generated/tmdbFacts/
catalogue-pipeline/generated/semantic/
catalogue-pipeline/generated/editorial/
catalogue-pipeline/generated/critic/
catalogue-pipeline/generated/posters/
catalogue-pipeline/generated/benchmarks/raw/
```

Selected final reports may be committed when useful for release audit.

---

## 6. Batch Candidate Input Format

Candidate batches are structured JSON and are not production catalogue records.

Example:

```json
{
  "batchId": "pilot-100",
  "schemaVersion": "candidate.v1",
  "createdAt": "2026-09-01T00:00:00.000Z",
  "sourcePolicy": {
    "description": "Balanced pilot set across genre, era, language, country, accessibility, and discovery bands.",
    "licensingNotes": []
  },
  "candidates": [
    {
      "candidateId": "pilot-001",
      "title": "Example Movie",
      "year": 2001,
      "tmdbId": 12345,
      "sourceTags": ["manual-seed", "family-underrepresented"],
      "inclusionRationale": "Adds family-accessible non-English animation coverage.",
      "knownRisks": []
    }
  ]
}
```

Required candidate fields:

- `candidateId`
- `title`
- `year`
- `tmdbId`
- `sourceTags`
- `inclusionRationale`

Optional fields:

- `expectedMoods`
- `expectedSituations`
- `notes`
- `knownRisks`
- `licensingNotes`

Candidate sourcing must balance quality floor, factual completeness, usable portrait poster art, mood and genre breadth, geography and language breadth, eras, mainstream accessibility, and discovery value. It must not mirror TMDB popularity alone. External lists may be considered only with explicit licensing, access, attribution, and scraping review.

---

## 7. TMDB Factual-Enrichment Stage

Inputs:

- Candidate batch
- Existing production mappings and facts
- `TMDB_READ_ACCESS_TOKEN`

Outputs:

```text
catalogue-pipeline/generated/tmdbFacts/<batchId>.json
catalogue-pipeline/cache/tmdb/<tmdbId>.json
```

Normalized output:

```json
{
  "tmdbId": 12345,
  "title": "Example Movie",
  "year": 2001,
  "director": "Example Director",
  "countries": ["Japan"],
  "spokenLanguages": ["Japanese"],
  "genres": ["Animation", "Family"],
  "runtimeMinutes": 96,
  "posterPath": "/abc.jpg",
  "posterFacts": {
    "available": true,
    "checkedImageUrl": "https://image.tmdb.org/t/p/w500/abc.jpg"
  },
  "fetchedAt": "2026-09-01T00:00:00.000Z",
  "factsHash": "sha256..."
}
```

Hard failures:

- Missing or invalid `tmdbId`
- TMDB 401/403
- TMDB 404 for selected `tmdbId`
- Missing factual field required by production resolver
- Invalid runtime
- Duplicate TMDB ID
- Duplicate local ID collision
- Invalid JSON or schema output

Review/data-quality flags:

- Missing optional TMDB detail not required by resolver
- Unusual country/language data
- `posterPath: null`
- Poster available but not yet suitability-approved

Recoverable failures:

- Temporary network failure
- HTTP 429
- HTTP 5xx

Retry policy:

- Maximum 3 TMDB attempts per request
- Respect `Retry-After`
- Exponential backoff
- Redact tokens from logs
- Never write partial production snapshots

---

## 8. Semantic Classifier Stage

The classifier assigns taxonomy fields. It does not write final editorial copy.

The classifier must be a separate structured model call from the writer.

Input:

```json
{
  "schemaVersion": "semantic-input.v1",
  "batchId": "pilot-100",
  "movieFacts": {
    "tmdbId": 12345,
    "title": "Example Movie",
    "year": 2001,
    "director": "Example Director",
    "countries": ["Japan"],
    "spokenLanguages": ["Japanese"],
    "genres": ["Animation", "Family"],
    "runtimeMinutes": 96
  },
  "taxonomyVersion": "taxonomy.v1",
  "calibrationAnchors": [],
  "boundaryCases": []
}
```

Output:

```json
{
  "schemaVersion": "semantic-output.v1",
  "promptVersion": "semantic-classifier.v1",
  "taxonomyVersion": "taxonomy.v1",
  "modelProvider": "adapter-id",
  "modelId": "provider-model-id",
  "movie": {
    "candidateId": "pilot-001",
    "tmdbId": 12345
  },
  "classification": {
    "moods": ["relaxing", "emotional"],
    "situations": ["family", "easy-watch"],
    "filterLanguages": ["Japanese"],
    "pace": "medium",
    "emotionalWeight": "light",
    "attentionDemand": "easy",
    "discoveryStyle": "different"
  },
  "evidence": {
    "moods": ["Brief observable rationale."],
    "situations": ["Brief observable rationale."],
    "pace": "Brief observable rationale.",
    "emotionalWeight": "Brief observable rationale.",
    "attentionDemand": "Brief observable rationale.",
    "discoveryStyle": "Brief observable rationale."
  },
  "boundaryFlags": [],
  "selfConfidence": {
    "moods": 0.7,
    "situations": 0.6,
    "pace": 0.8,
    "emotionalWeight": 0.8,
    "attentionDemand": 0.7,
    "discoveryStyle": 0.6
  }
}
```

Model self-confidence is retained only as weak supplementary evidence. It must not drive review priority by itself.

---

## 9. Movie Mood Voice Guide

Editorial voice is a first-class architecture asset.

Add:

```text
catalogue-pipeline/calibration/voice-guide.md
```

The voice guide must be versioned and referenced by both the editorial writer and the critic.

It must define:

- Strong accepted examples from the existing catalogue
- Negative or generic examples
- The distinct purpose of `description`, `whyWatch`, `curiosityHook`, and `vibeSummary`
- Spoiler boundaries
- Synopsis boundaries
- Generic AI phrasing patterns to avoid
- Sentence-pattern expectations
- Lexical-diversity expectations
- Tone boundaries
- Layout-fit expectations for V8 surfaces

Field purposes:

- `description`: concise non-spoilery setup; factual enough to orient, not a plot recap.
- `whyWatch`: the recommendation argument; why this belongs in tonight's shortlist.
- `curiosityHook`: the Glimpse invitation; intrigue without synopsis or spoiler.
- `vibeSummary`: compact experiential identity; used heavily in Decision and Tonight's Pick.

Tone boundaries:

- Specific, cinematic, and useful for choosing tonight.
- Warm but not cute by default.
- Confident but not hype-driven.
- Poetic only when clarity survives.
- Never generic streaming-service blurb voice.
- Never model/meta commentary.

---

## 10. Editorial Writer Stage

The writer receives frozen facts, frozen semantic classification, and the versioned voice guide.

The writer must not reclassify taxonomy fields.

Input:

```json
{
  "schemaVersion": "editorial-input.v1",
  "batchId": "pilot-100",
  "movieFacts": {},
  "classification": {},
  "voiceGuideVersion": "voice.v1",
  "copyConstraints": {
    "description": { "minChars": 80, "maxChars": 220 },
    "whyWatch": { "minChars": 60, "maxChars": 180 },
    "curiosityHook": { "minChars": 50, "maxChars": 170 },
    "vibeSummary": { "minChars": 45, "maxChars": 150 }
  }
}
```

Output:

```json
{
  "schemaVersion": "editorial-output.v1",
  "promptVersion": "editorial-writer.v1",
  "voiceGuideVersion": "voice.v1",
  "modelProvider": "adapter-id",
  "modelId": "provider-model-id",
  "movie": {
    "candidateId": "pilot-001",
    "tmdbId": 12345
  },
  "copy": {
    "description": "A concise factual setup without spoilers.",
    "whyWatch": "A Movie Mood recommendation line.",
    "curiosityHook": "A curiosity-forward Glimpse line.",
    "vibeSummary": "A compact experiential summary."
  },
  "writerNotes": {
    "intendedVoice": "Brief inspectable note.",
    "spoilerBoundary": "Brief inspectable note."
  }
}
```

Writer notes may be stored for audit, but the critic must not depend on hidden writer reasoning.

---

## 11. Critic And Validator Stage

The critic evaluates frozen facts, taxonomy output, generated copy, deterministic validation results, the rubric, and the versioned voice guide.

The critic must not receive or reproduce writer hidden reasoning. It receives only inspectable artifacts.

Input:

```json
{
  "schemaVersion": "critic-input.v1",
  "batchId": "pilot-100",
  "movieFacts": {},
  "classification": {},
  "editorialCopy": {},
  "deterministicValidation": {},
  "taxonomyVersion": "taxonomy.v1",
  "voiceGuideVersion": "voice.v1",
  "rubricVersion": "rubric.v1"
}
```

Output:

```json
{
  "schemaVersion": "critic-output.v1",
  "promptVersion": "critic.v1",
  "voiceGuideVersion": "voice.v1",
  "modelProvider": "adapter-id",
  "modelId": "provider-model-id",
  "movie": {
    "candidateId": "pilot-001",
    "tmdbId": 12345
  },
  "verdict": "needs_review",
  "issues": [
    {
      "severity": "review",
      "field": "moods",
      "code": "SEMANTIC_BOUNDARY",
      "message": "Funny + heavy may be valid but should be reviewed."
    }
  ],
  "copyAssessment": {
    "voiceConsistency": "pass",
    "specificity": "pass",
    "spoilerSafety": "pass",
    "nonSynopsisQuality": "pass",
    "distinctiveness": "review",
    "layoutFit": "pass"
  },
  "criticRecommendations": []
}
```

Allowed verdicts:

- `hard_fail`
- `needs_review`
- `approve_for_review`
- `candidate_for_auto_accept`

No record is promoted solely because the critic approves it.

---

## 12. Provider And Model Adapter Boundary

V8.1 must not assume a specific AI provider or model.

Pipeline logic should call a maintainable adapter:

```ts
interface ModelProvider {
  id: string
  generateStructured<TInput, TOutput>(request: {
    stage: 'semantic-classifier' | 'editorial-writer' | 'critic'
    schemaVersion: string
    promptVersion: string
    input: TInput
    outputSchema: unknown
    temperature: number
    maxRetries: number
  }): Promise<{
    output: TOutput
    providerMetadata: {
      modelId: string
      requestId?: string
      tokenUsage?: unknown
    }
  }>
}
```

Provider requirements:

- Structured JSON output
- Low-temperature or deterministic operation
- Enough context for facts, taxonomy, anchors, and voice guide
- Retryable transient failures
- Clear error reporting
- Usage metadata when available
- Credentials only in maintainer environment
- No runtime frontend exposure

Provider/model choice remains an implementation decision.

---

## 13. Hard Validation Rules

Hard validation failures block promotion.

Rules:

- Missing production-required field
- Invalid enum
- Empty required array
- Duplicate local ID
- Duplicate TMDB ID
- Invalid TMDB mapping
- Missing factual snapshot required by resolver
- `curatedMovie.tmdbId !== facts.tmdbId`
- Invalid runtime
- Invalid or malformed palette
- Palette values not valid hex colors
- Empty editorial copy
- Copy below hard minimum length
- Copy above hard maximum length
- Placeholder text
- Model/meta language in production copy
- Broken 1:1 mapping across curated, mapping, and generated facts
- Invalid JSON/schema output from any stage
- Unresolved spoiler hard failure
- Unresolved V8 layout-fit hard failure

Hard validators should be deterministic wherever possible.

---

## 14. Semantic Anomaly Rules

Semantic anomalies create review flags. They do not automatically block production.

Examples:

- `funny` + `heavy`
- `relaxing` + `immersive`
- `slow` + `exciting`
- `suspenseful` + `family`
- `easy-watch` + `heavy`
- `family` + adult-intensity genre signals
- `light` + sustained horror/thriller signals
- `familiar` for obscure or formally difficult films
- `adventurous` for highly mainstream films
- `easy` attention + dense puzzle structure
- `fast` pace + low-plot observational story

Each anomaly rule should include:

- `code`
- `fields`
- `severity`
- `message`
- `reviewRequired`
- `knownApprovedPrecedents`

The goal is to surface uncertainty, not flatten Movie Mood into stereotyped combinations.

---

## 15. Evidence-Based Confidence And Review Scoring

Review confidence must be based on observable evidence, not primarily on an LLM's self-reported number.

Primary signals:

- Classifier/critic agreement
- Deterministic validation results
- Calibration-anchor distance or conflict
- Taxonomy boundary flags
- Semantic anomaly flags
- Repeated-run disagreement when enabled
- Copy-similarity findings
- Lexical-diversity findings
- Poster suitability result
- Human override history for similar cases

Weak supplementary signal:

- Model self-confidence

Example:

```json
{
  "reviewConfidence": {
    "overall": "medium",
    "semantic": "low",
    "editorial": "high",
    "poster": "high",
    "factual": "high"
  },
  "evidenceSignals": {
    "hardValidationFailures": 0,
    "semanticAnomalies": 2,
    "criticDisagreements": 1,
    "calibrationConflicts": 1,
    "copySimilarityFlags": 0,
    "posterSuitability": "approved",
    "repeatedRunDisagreements": 0,
    "modelSelfConfidence": "supplementary-only"
  }
}
```

Review priorities:

- `P0`: hard failure
- `P1`: likely semantic, copy, poster, spoiler, or layout problem
- `P2`: boundary/anomaly review
- `P3`: spot-check
- `P4`: eligible for batch approval after gate criteria

---

## 16. Human Review Queue

Default workflow: one maintainer human reviewer.

Optional targeted independent second review may be used for:

- Low-confidence semantic fields
- Sensitive content
- Repeated classifier/critic disagreement
- Taxonomy boundary cases
- Pilot gold-subset calibration checks

Reviewer identity is a free-text maintainer handle.

Queue output:

```text
catalogue-pipeline/generated/reviewQueue/<batchId>.json
```

Shape:

```json
{
  "batchId": "pilot-100",
  "schemaVersion": "review-queue.v1",
  "items": [
    {
      "candidateId": "pilot-001",
      "tmdbId": 12345,
      "title": "Example Movie",
      "priority": "P2",
      "status": "needs_review",
      "reviewReasons": [
        {
          "code": "SEMANTIC_ANOMALY",
          "field": "moods",
          "message": "relaxing + immersive requires review."
        }
      ],
      "proposedCuratedMovie": {},
      "facts": {},
      "posterSuitability": {},
      "confidence": {},
      "humanReview": {
        "reviewer": null,
        "decision": null,
        "fieldOverrides": {},
        "notes": null,
        "reviewedAt": null
      }
    }
  ]
}
```

Allowed review decisions:

- `approve`
- `approve_with_overrides`
- `reject`
- `defer`
- `needs_second_review`

Human overrides should be usable as future calibration data.

---

## 17. Calibration And Golden Dataset

Files:

```text
catalogue-pipeline/calibration/anchors.json
catalogue-pipeline/calibration/boundaryCases.json
catalogue-pipeline/calibration/voice-guide.md
catalogue-pipeline/calibration/goldSubsets/<batchId>-gold.json
```

Anchor shape:

```json
{
  "taxonomyVersion": "taxonomy.v1",
  "anchors": [
    {
      "movieId": "paddington-2",
      "tmdbId": 346648,
      "field": "attentionDemand",
      "value": "easy",
      "anchorType": "positive",
      "rationale": "Low cognitive load, generous tone, family-accessible."
    },
    {
      "movieId": "parasite",
      "tmdbId": 496243,
      "field": "moods",
      "value": "funny",
      "anchorType": "boundary",
      "rationale": "Darkly funny but not emotionally light."
    }
  ]
}
```

Gold subset shape:

```json
{
  "batchId": "pilot-100",
  "schemaVersion": "gold-subset.v1",
  "selectionMethod": "stratified",
  "targetSize": 45,
  "permittedVariance": 5,
  "items": [
    {
      "candidateId": "pilot-001",
      "tmdbId": 12345,
      "humanLabels": {
        "moods": ["relaxing"],
        "situations": ["family"],
        "pace": "medium",
        "emotionalWeight": "light",
        "attentionDemand": "easy",
        "discoveryStyle": "different"
      },
      "reviewer": "maintainer-handle",
      "secondReview": null,
      "adjudicated": false
    }
  ]
}
```

Pilot gold subset target is locked at 45 films, stratified, with +/-5 permitted.

---

## 18. Prompt, Model, Schema, Taxonomy, And Voice Versioning

Every artifact records:

- `schemaVersion`
- `promptVersion`
- `taxonomyVersion`
- `voiceGuideVersion`
- `rubricVersion`
- `modelProvider`
- `modelId`
- `inputHash`
- `outputHash`
- `createdAt`

Prompt files are immutable after use. Updates create new versions:

```text
semantic-classifier.v1.md
semantic-classifier.v2.md
```

The classifier, writer, and critic artifacts must remain independently inspectable and versioned.

---

## 19. Cache Keys, Invalidation, And Idempotency

Do not simplify cache keys to `tmdbId` only.

Cache key:

```text
<stage>/<tmdbId>/<factsHash>/<schemaVersion>/<promptVersion>/<taxonomyVersion>/<voiceGuideVersion>/<modelProvider>/<modelId>
```

Stages may omit dimensions that genuinely do not affect them, but must include every versioned input that can affect their output.

Invalidate only affected cached stages when:

- TMDB facts hash changes
- Prompt version changes
- Schema version changes
- Taxonomy version changes
- Voice guide version changes
- Provider/model changes
- Validation rules change
- Human override requests regeneration

Idempotency acceptance test:

> Re-running a completed unchanged batch must make no new TMDB/model requests and produce no substantive artifact changes.

This test should use mocked providers with request counters and artifact hash comparisons.

---

## 20. Failure Recovery And Resumability

Pipeline runs must be resumable by batch, stage, and candidate.

Each stage writes:

- Started marker
- Completed artifact
- Error artifact on failure
- Input hash
- Output hash when available

Reruns should:

- Skip completed valid artifacts unless `--force`
- Retry recoverable failures within limits
- Preserve human review decisions
- Never overwrite reviewed human decisions without `--force-reviewed`
- Never modify production catalogue files unless explicit promotion is requested

---

## 21. Editorial Voice QA

Initial implementation uses deterministic lexical and n-gram checks. Embedding similarity is deferred initially.

Checks:

- Empty copy
- Placeholder copy
- Repeated sentence openings
- Recurring adjectives
- Repeated templates
- Generic AI phrasing
- Spoiler leakage
- Synopsis-like writing
- Excessive title repetition
- Over-reliance on actor/director names
- Excessive n-gram similarity across entries
- Copy that could apply to many unrelated movies
- Hard length violations
- V8 layout-fit violations

Accepted production records must have zero unresolved spoiler hard failures and zero unresolved layout hard failures.

---

## 22. Poster Suitability QA

`posterPath !== null` is factual availability only. It is not suitability approval.

Poster QA must check:

- Image exists
- Image loads successfully
- Usable resolution
- Portrait/native poster suitability
- No obviously malformed asset
- No blank or placeholder asset
- Acceptable presentation in V8's locked 2:3 movie-object geometry
- Fallback palette is acceptable when poster is unavailable or rejected

Output:

```json
{
  "posterSuitability": {
    "availability": "available",
    "suitability": "approved",
    "checkedUrl": "https://image.tmdb.org/t/p/w500/example.jpg",
    "width": 500,
    "height": 750,
    "aspectRatio": 0.6667,
    "issues": []
  }
}
```

Allowed suitability statuses:

- `approved`
- `needs_review`
- `rejected`
- `fallback_required`

Poster suitability contributes to evidence-based confidence.

---

## 23. 100-Film Pilot Procedure

The pilot generates approximately 100 complete draft records. Humans are not required to independently re-curate all 100.

Procedure:

1. Build balanced 100-film candidate set.
2. Run TMDB enrichment.
3. Run semantic classifier.
4. Run editorial writer.
5. Run deterministic validators.
6. Run independent critic.
7. Run editorial voice QA.
8. Run poster suitability QA.
9. Build evidence-based review queue.
10. Select stratified gold subset of 45 films, +/-5 permitted.
11. Collect solo-maintainer human labels for the gold subset.
12. Use targeted second review only where useful.
13. Compare model output to gold labels.
14. Run automated/editorial QA across all 100.
15. Human-review all P0/P1/P2 records and sampled P3/P4 records.
16. Produce pilot report.

The pilot is practical for a solo-maintained project while still producing quantitative signal.

---

## 24. Gold-Subset Evaluation

Ordered fields:

- `pace`
- `emotionalWeight`
- `attentionDemand`
- `discoveryStyle`

Metrics:

- Exact agreement
- Adjacent disagreement rate
- Severe disagreement rate
- Weighted Cohen's kappa

Multi-label fields:

- `moods`
- `situations`

Metrics:

- Precision
- Recall
- F1
- Jaccard similarity
- Per-label confusion

Locked targets:

- Weighted kappa >= 0.65
- Moods/situations macro F1 >= 0.75
- Major editorial rewrite rate <= 15%
- Accepted production records have zero unresolved spoiler hard failures
- Accepted production records have zero unresolved layout hard failures

These thresholds are V8.1 gate criteria and may be revisited only with explicit evidence and review.

---

## 25. Static Catalogue Performance Benchmark Harness

Benchmark synthetic catalogue sizes:

- 100
- 500
- 1,000
- 2,500
- 5,000

Measure:

- Raw JSON/TS size
- gzip size
- brotli size
- JS bundle impact
- Initial load time
- JSON parse time
- Filtering latency
- Discovery pool latency
- Recommendation slate latency
- Similar-movie latency
- URL codec validation impact
- Mobile memory impact or mobile-oriented memory proxy

Compare:

- Current bundled static import
- Static lazy-loaded JSON
- Chunked static JSON by catalogue segment

Do not introduce a backend unless measured frontend-only strategies fail.

---

## 26. Recommendation-At-Scale Benchmark Harness

Current recommendation semantics remain unchanged before benchmarking:

- Mood/situation/practical filtering
- Situation relaxation when exact matches are fewer than 3
- Dealbreakers
- Stable soft ordering by `attentionDemand` and `discoveryStyle`
- Offset-based windows of 3
- Deterministic similar-movie scoring

Benchmark risks:

- Popularity concentration
- Repeated franchises
- Repeated directors
- Genre clustering
- Decade clustering
- Language clustering
- Repeated-round overlap
- Poor diversity within the three presented movies
- Overexposure of early catalogue order
- Underexposure of niche records

Metrics:

- Unique movies shown after N rounds
- Exposure Gini coefficient
- Director/franchise repetition rate
- Genre entropy per slate
- Decade entropy per slate
- Language entropy per slate
- Mean pairwise similarity within slate
- Consecutive-round overlap
- Pool-size distribution by user context
- Empty/sparse result rate

If offset-based rotation demonstrates abundance or exposure failure, the benchmark phase may evaluate minimal deterministic remedies:

- Seeded deterministic shuffle
- Bucket rotation
- Diversity-aware deterministic windowing

Do not implement any remedy unless benchmark evidence first demonstrates the problem.

---

## 27. Release Gates

### 41 -> 100 Pilot

Acceptance:

- Baseline validates cleanly
- Candidate schema accepted
- TMDB enrichment writes only pipeline artifacts
- Classifier/writer/critic artifacts are versioned
- Voice guide exists and is referenced by writer and critic
- Review queue generated
- No production data modified

Stop if:

- Baseline production catalogue fails validation
- TMDB mapping/facts contract is unclear
- Provider adapter cannot produce structured output reliably

### 100 -> 250

Acceptance:

- 100% hard validation pass after fixes
- Gold subset evaluated
- Weighted kappa >= 0.65
- Moods/situations macro F1 >= 0.75
- Major editorial rewrite rate <= 15%
- Poster suitability resolved for all promoted records
- No unresolved spoiler/layout hard failures
- Static benchmark at 250 projects safe

Stop if:

- Taxonomy consistency is rejected
- Editorial QA finds systemic generic/template copy
- Review burden is too high for solo-maintainer scale

### 250 -> 500

Acceptance:

- Review queue distribution remains manageable
- Copy similarity does not materially worsen
- Recommendation benchmark shows acceptable diversity
- Mobile performance remains inside agreed budgets
- Cache/resume behavior proven across interrupted runs
- Idempotency test passes

Stop if:

- Abundance causes severe slate clustering
- Static bundle strategy becomes visibly slow on mobile
- Human override patterns show prompt/schema instability

### 500 -> 1,000

Acceptance:

- Full benchmark at 1,000 passes
- Reviewer workload is predictable
- Poster suitability workflow is reliable
- Recommendation diversity remains acceptable
- Production promotion process is reversible
- No backend is justified by data

Stop if:

- Runtime architecture cannot handle 1,000 within budgets
- Recommendation semantics repeatedly fail diversity metrics
- Editorial identity degrades at scale

---

## 28. Expected Automated Tests

Add tests for:

- Candidate schema validation
- TMDB fact normalization
- Required-versus-optional TMDB field handling
- Duplicate local ID detection
- Duplicate TMDB ID detection
- 1:1 mapping validation
- Semantic output schema validation
- Editorial output schema validation
- Critic output schema validation
- Voice guide version reference
- Critic independence from writer hidden reasoning
- Hard validation rule coverage
- Semantic anomaly flagging
- Evidence-based confidence scoring
- Review queue generation
- Cache key stability
- Cache invalidation by prompt/schema/taxonomy/voice/model/facts changes
- Idempotency: unchanged rerun makes no new TMDB/model requests and no substantive artifact changes
- Resume behavior
- Poster suitability classification
- Copy length validation
- Generic phrase detection
- N-gram copy similarity flagging
- Static benchmark harness smoke test
- Recommendation benchmark harness smoke test
- Production promotion dry run

Existing production tests must continue passing.

---

## 29. Git Safety And Generated-Artifact Policy

Production files may be changed only by explicit promotion:

```text
src/data/curatedMovies.ts
src/data/tmdbMovieMappings.json
src/data/generated/tmdbMovies.json
```

Committed:

- Specification docs
- Pipeline README
- Schemas
- Prompt files
- Config examples
- Calibration anchors
- Voice guide
- Gold subset definitions
- Benchmark scripts
- Validation scripts

Ignored by default:

- Raw model cache
- Raw TMDB cache
- Intermediate per-run artifacts
- Temporary failed outputs

Potentially committed after review:

- Selected final reports
- Pilot report
- Scale-gate acceptance summaries

Never commit:

- API keys
- Provider credentials
- Secret-bearing logs
- Unreviewed production catalogue expansions

---

## 30. Cost Controls And Retry Limits

Cost controls:

- Cache all TMDB and model outputs
- Skip completed valid artifacts by default
- Limit repeated-run disagreement checks to sampled or low-confidence records
- Defer embedding similarity initially
- Batch requests only where provider safely supports it
- Track token usage by stage
- Produce per-batch cost report

Retry limits:

- TMDB: 3 attempts per request
- Model calls: 2 attempts for transient failures
- JSON repair: at most 1 structured repair attempt
- Critic rerun: only after upstream artifact changes or explicit force

Stop if cost projection for the next gate exceeds approved budget.

---

## 31. Security And Secrets Handling

Secrets:

- `TMDB_READ_ACCESS_TOKEN`
- Model provider credentials

Rules:

- Read secrets only from environment or local ignored config
- Never expose secrets to runtime frontend
- Never commit secrets
- Never print full secrets
- Redact credentials in logs
- GitHub Pages build must not require TMDB or model credentials
- Provider calls stay in maintainer scripts only
- Add `.env.example` if needed, never `.env`

Runtime remains credential-free.

---

## 32. Rollback Strategy

Rollback must be possible at three levels.

### 32.1 Pipeline Artifact Rollback

Because prompts, schemas, taxonomy, and voice guides are versioned, a bad generation run can be abandoned without production impact.

### 32.2 Batch Promotion Rollback

Catalogue promotions should be grouped by explicit batch commits. Reverting a batch commit should restore the prior production catalogue.

### 32.3 Individual Movie Rollback

If one movie is defective:

- Correct or remove its `CuratedMovie`
- Correct or remove its mapping
- Refresh or correct generated facts
- Run validation, tests, and build
- Add the defect to calibration or validators when useful

Do not reuse removed IDs for different films.

---

## 33. Exact Phased Implementation Sequence

Each phase lists expected files, behavior, verification, acceptance, and stop conditions. Closely related phases may be completed as one work tranche when routine checks pass and no stop condition is reached.

### Phase 0 - Baseline Validation

Files expected:

- None

Behavior introduced:

- None

Verification:

- Confirm `v8.0.0` baseline
- Confirm 41 catalogue records resolve through facts
- Confirm required V8 fields
- Confirm no unrelated files are staged

Acceptance:

- Production repo, remote, tag, and data split are verified

Stop if:

- Baseline does not validate
- Production repo is not at expected checkpoint

### Phase 1 - Spec And Pipeline Skeleton

Files expected:

```text
docs/V8_1_CATALOGUE_SCALE_IMPLEMENTATION_SPEC.md
catalogue-pipeline/README.md
catalogue-pipeline/config/schemaVersion.json
catalogue-pipeline/config/taxonomyVersion.json
catalogue-pipeline/config/provider.example.json
catalogue-pipeline/calibration/voice-guide.md
```

Behavior introduced:

- Documentation and inert structure only

Verification:

- `git diff --check`
- Confirm no production app imports from pipeline

Acceptance:

- Root is `catalogue-pipeline/`
- Voice guide exists as a versioned calibration artifact

Stop if:

- Any runtime behavior changes

### Phase 2 - Schemas And Validators

Files expected:

```text
catalogue-pipeline/schemas/*.schema.json
catalogue-pipeline/scripts/validateBatch.mjs
catalogue-pipeline/scripts/buildReviewQueue.mjs
```

Behavior introduced:

- Candidate, semantic, editorial, critic, and queue validation
- Hard failure versus anomaly distinction

Verification:

- Unit tests for validators
- Fixture tests for hard failures and anomalies

Acceptance:

- Invalid enums, missing production-required fields, duplicate IDs, malformed palettes, and broken mappings fail deterministically
- Anomalies flag without hard-failing

Stop if:

- Validators require model calls
- Anomalies block valid edge cases by default

### Phase 3 - TMDB Offline Enrichment

Files expected:

```text
catalogue-pipeline/adapters/tmdbProvider.ts
catalogue-pipeline/scripts/enrichTmdb.mjs
```

Behavior introduced:

- Candidate facts fetched into pipeline artifacts only

Verification:

- Mocked TMDB tests
- Retry tests
- Token redaction tests
- Required-versus-optional fact tests

Acceptance:

- Facts normalize to production-required shape
- Optional incompleteness becomes data-quality flags where appropriate
- No production snapshot writes

Stop if:

- Command writes `src/data/generated/tmdbMovies.json`

### Phase 4 - Model Provider Adapter

Files expected:

```text
catalogue-pipeline/adapters/modelProvider.ts
catalogue-pipeline/adapters/providerConfig.ts
```

Behavior introduced:

- Provider/model access behind adapter boundary

Verification:

- Mock provider tests
- Structured output failure tests
- Retry limit tests

Acceptance:

- Classifier, writer, and critic can use the same adapter interface
- Credentials remain maintainer-only

Stop if:

- Provider credentials leak into frontend or committed config

### Phase 5 - Semantic Classifier

Files expected:

```text
catalogue-pipeline/prompts/semantic-classifier.v1.md
catalogue-pipeline/scripts/classifySemantic.mjs
```

Behavior introduced:

- Structured semantic classification artifacts

Verification:

- Mock provider fixture tests
- Schema validation
- Cache key tests

Acceptance:

- Output contains taxonomy fields, evidence, boundary flags, and supplementary self-confidence
- Invalid output is rejected

Stop if:

- Classifier writes editorial copy
- Classifier modifies production catalogue

### Phase 6 - Editorial Writer And Voice Guide

Files expected:

```text
catalogue-pipeline/prompts/editorial-writer.v1.md
catalogue-pipeline/calibration/voice-guide.md
catalogue-pipeline/scripts/writeEditorial.mjs
```

Behavior introduced:

- Draft V8 editorial fields from frozen facts/classification and voice guide

Verification:

- Schema validation
- Voice guide version reference test
- Copy length tests
- Placeholder/meta-language tests

Acceptance:

- Produces `description`, `whyWatch`, `curiosityHook`, and `vibeSummary`
- Does not reclassify taxonomy fields
- References versioned voice guide

Stop if:

- Writer is asked to infer semantic taxonomy

### Phase 7 - Critic, Confidence, And Review Queue

Files expected:

```text
catalogue-pipeline/prompts/critic.v1.md
catalogue-pipeline/scripts/runCritic.mjs
catalogue-pipeline/scripts/scoreConfidence.mjs
catalogue-pipeline/scripts/buildReviewQueue.mjs
```

Behavior introduced:

- Independent critic artifacts
- Evidence-based confidence scoring
- Solo-maintainer review queue

Verification:

- Critic input fixture tests
- Confidence scoring tests
- Classifier/critic disagreement tests
- Critic independence tests

Acceptance:

- Confidence primarily uses observable signals
- Model self-confidence is supplementary only
- Queue priorities are deterministic
- Critic references voice guide without receiving writer hidden reasoning

Stop if:

- Self-confidence dominates review priority

### Phase 8 - Editorial QA And Poster Suitability

Files expected:

```text
catalogue-pipeline/scripts/checkEditorialVoice.mjs
catalogue-pipeline/scripts/checkPosterSuitability.mjs
```

Behavior introduced:

- Lexical and n-gram copy QA
- Poster suitability QA
- Deterministic poster-derived palette with optional override

Verification:

- Fixture copy tests
- Similarity threshold tests
- Broken/malformed poster fixture tests
- Palette derivation tests

Acceptance:

- Generic/repeated copy is flagged
- Poster availability and suitability are separate
- 2:3 presentation suitability is checked
- Accepted records have zero unresolved spoiler/layout hard failures

Stop if:

- `posterPath !== null` is treated as automatic suitability approval

### Phase 9 - 100-Film Pilot Harness

Files expected:

```text
catalogue-pipeline/candidates/pilot-100.json
catalogue-pipeline/calibration/goldSubsets/pilot-100-gold.json
catalogue-pipeline/scripts/runBatch.mjs
catalogue-pipeline/scripts/evaluateGoldSubset.mjs
```

Behavior introduced:

- End-to-end pilot generation into pipeline artifacts only
- 45-film stratified gold subset, +/-5 permitted

Verification:

- Dry run with mock provider
- Gold metric computation tests
- Review queue output inspection
- Idempotency test

Acceptance:

- 100 draft records processed offline
- Gold subset metrics generated
- Automated QA runs across all 100
- Humans are not required to independently re-curate all 100

Stop if:

- Pilot attempts production promotion automatically

### Phase 10 - Static Performance Benchmark

Files expected:

```text
catalogue-pipeline/scripts/benchmarkStaticCatalogue.mjs
```

Behavior introduced:

- Synthetic catalogue benchmarks at 100, 500, 1,000, 2,500, and 5,000

Verification:

- Benchmark smoke test
- Output schema validation

Acceptance:

- Measures size, compression, bundle impact, parse time, filter latency, slate latency, and mobile memory proxy
- Compares bundled data with static lazy JSON

Stop if:

- Architecture recommendation is based on guessed payload sizes

### Phase 11 - Recommendation Benchmark

Files expected:

```text
catalogue-pipeline/scripts/benchmarkRecommendations.mjs
```

Behavior introduced:

- Deterministic recommendation diversity benchmark
- Optional evaluation of minimal deterministic remedies after measured failure

Verification:

- Fixture datasets for clustering and repetition
- Metric output tests

Acceptance:

- Reports exposure concentration, repeated directors/franchises, genre/decade/language clustering, and repeated-round overlap
- Does not alter production recommendation semantics

Stop if:

- Recommendation semantics are changed before evidence exists

### Phase 12 - Promotion Dry Run

Files expected:

```text
catalogue-pipeline/scripts/promoteReviewedBatch.mjs
```

Behavior introduced:

- Convert approved reviewed artifacts into production-shaped diffs in dry-run mode

Verification:

- Dry-run fixture tests
- Production schema validation
- Mapping/facts 1:1 validation

Acceptance:

- Dry run prints intended changes
- No write unless explicit non-dry-run flag
- Production files remain untouched by default

Stop if:

- Promotion can overwrite human-reviewed records accidentally

### Phase 13 - Scale Gate Reports

Files expected:

```text
catalogue-pipeline/generated/reports/
```

Behavior introduced:

- Batch reports for 100, 250, 500, and 1,000 gates

Verification:

- Gate report contains semantic metrics, editorial QA, poster QA, performance, recommendation metrics, cost, and review burden

Acceptance:

- Each gate satisfies criteria or documents an explicit reviewed exception

Stop if:

- Any gate fails thresholds without documented override

---

## 34. Production Promotion Requirements

Before any generated batch is promoted:

- All hard validators pass
- Required solo-maintainer review is complete
- Targeted second review is complete where requested
- Poster suitability is resolved
- Editorial QA is resolved
- TMDB facts are present for production-required fields
- 1:1 mapping is confirmed
- Existing tests pass
- Production build passes
- Static benchmark is acceptable for target size
- Recommendation benchmark is acceptable for target size
- Human approval is recorded

Promotion may modify only:

```text
src/data/curatedMovies.ts
src/data/tmdbMovieMappings.json
src/data/generated/tmdbMovies.json
```

---

## 35. Spec Readiness

All previously open planning decisions are now locked:

- Pipeline root: `catalogue-pipeline/`
- Raw caches/intermediate artifacts ignored by default
- Selected final reports may be committed
- Pilot gold subset target: 45, stratified, +/-5 permitted
- Embedding similarity deferred initially
- Reviewer identity: free-text maintainer handle
- Weighted kappa target >= 0.65
- Moods/situations macro F1 target >= 0.75
- Major editorial rewrite target <= 15%
- Accepted production records must have zero unresolved spoiler/layout hard failures
- Palette becomes deterministic poster-derived data with optional human override
- Only factual fields genuinely required by the production resolver are hard blockers
- Optional TMDB incompleteness becomes review/data-quality flags

SPEC READINESS: READY
