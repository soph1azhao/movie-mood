# Movie Mood V8.2 — Catalogue Promotion & Runtime Scale

**Status:** Phases 0 and 1 implemented; Phase 2A pilot infrastructure and preflight implemented; live editorial pilot not yet executed.

**Baseline:** `v8.1.0`; deployed static catalogue: 41 films.

**Authoritative audit:** `catalogue-pipeline/generated/catalogue-promotion/v8-2-readiness-v1.json`.

> Streaming platforms help you find more movies. Movie Mood helps you choose one.

> Movie Mood owns meaning. TMDB owns facts.

## 1. Goal

Convert every eligible unique record from the accepted Semantic-400 checkpoint into a complete, reviewed Movie Mood production record and deploy the promoted static catalogue.

Phase 0 establishes 400 unique Semantic-400 TMDB identities, zero identity overlap with the existing 41-film runtime, zero duplicate or conflicting identities, and complete local MovieFacts for all 400. The identity-reconciled full-promotion target is therefore 441 runtime films. Promotion and closure must still derive the deployed count from the final accepted records; they must never substitute this planning target for an actual manifest count. Any later rejection or deferral must be explicit and must explain why that record is no longer eligible.

The target is all eligible Semantic-400 records, not an arbitrary round number.

## 2. Non-goals and boundaries

V8.2 does not:

- create Semantic-500 or resume Kimi catalogue production;
- change the six-mood taxonomy or recommendation semantics;
- redesign V8 Editorial Wire;
- introduce runtime AI, an authenticated runtime TMDB client, a backend, database, or accounts;
- reopen C1b confirmatory research or incorporate Phase 5C Wikipedia findings into production semantics;
- automatically trust model-written editorial copy;
- lower validation standards to increase catalogue size.

The runtime remains Vite, React, TypeScript, plain CSS, GitHub Pages, and a committed static catalogue. Raw model artifacts never become runtime inputs. C1b, Wikipedia, calibration diagnostics, and Scale-500 research artifacts remain isolated from this production transaction unless a later decision explicitly authorizes them.

## 3. Phase 0 — Promotion readiness audit

Phase 0 is a zero-network, zero-model deterministic audit. Its executable is `catalogue-pipeline/scripts/auditPromotionReadiness.mjs`; its focused tests use synthetic fixtures and do not depend on ignored live artifacts.

### 3.1 Authoritative checkpoint

The cumulative cohort is defined jointly by:

- `catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/cohort-manifest.json`;
- `catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json`;
- the immutable accepted semantic artifacts referenced by each manifest state;
- the matching Expansion-100 and Scale-500 evidence packets and factual snapshots.

The audit fails closed if the cohort ID, cohort hash, declared counts, state membership, candidate identity, or TMDB identity disagree. It does not reconstruct missing artifacts. Every semantic artifact is rerun through the existing hard semantic validator.

### 3.2 Reconciliation result

The accepted result is:

| Measure | Count |
| --- | ---: |
| Semantic records independently validated | 400 |
| Unique semantic candidate IDs | 400 |
| Unique semantic TMDB IDs | 400 |
| Current runtime films | 41 |
| Semantic/runtime TMDB overlap | 0 |
| New unique promotion candidates | 400 |
| Duplicate semantic identities | 0 |
| Identity conflicts | 0 |
| Locally complete MovieFacts records | 400 |
| Complete editorial records | 0 |
| Validated palettes | 0 |
| Promotion-ready records now | 0 |

The report stores source paths, byte hashes, per-record manifest status, semantic and evidence availability, validation results, facts readiness, identity disposition, human-decision readiness, and readiness categories. Its timestamp is derived from the frozen semantic manifest rather than wall-clock time, so repeated runs over unchanged sources are byte-identical.

Phase 0 exposes a temporary `humanDecisionReadinessByCandidateId` input. It defaults to empty and may contain `true` only for an approval already validated elsewhere. This temporary signal is never inferred from editorial or palette completeness, and raw production booleans are not a future authority. Phase 1 replaces it with the versioned, hash-bound human-review decision contract. Promotion readiness requires semantic, facts, editorial, palette, and human-decision readiness, with no identity conflict and no existing runtime membership.

### 3.3 Phase 0 stop gate

Phase 0 changes no runtime data and makes no external calls. Editorial generation is not authorized by this specification alone. Work stops after the audit checkpoint until Phase 1 is accepted.

## 4. Phase 1 — Production contract

Phase 1 defines versioned schemas and executable validation for these concepts:

- **promotion candidate:** one unique, reconciled Semantic-400 identity with accepted semantic and factual inputs;
- **complete record:** the full `CuratedMovie` and `MovieFacts` contract, including four editorial fields and a two-color palette;
- **human review decision:** approve, revise, or reject, with reviewer, timestamp, notes, field-level revisions, and hashes of every reviewed input;
- **promotion manifest:** immutable source and output hashes plus accepted, rejected, deferred, and unchanged identities;
- **promotion transaction:** deterministic before/after catalogue assembly with collision and completeness checks;
- **production validation report:** all schema, identity, runtime, build, and benchmark outcomes bound to the transaction.

Every promoted record must trace through:

```text
candidate identity
→ TMDB identity and factual snapshot
→ accepted semantic output and evidence packet
→ editorial output
→ independent critic output
→ human decision
→ palette derivation or reviewed override
→ promotion version and output hashes
```

Schemas must reject unknown or partial identities, missing required fields, unaccepted semantic states, mutable/unhashed source references, and approvals that do not bind to the exact reviewed bytes. Existing 41 local IDs and curated values remain stable unless separately reviewed.

### 4.1 Implemented schema set

Phase 1 adds:

- `promotion-candidate.schema.json` — reconciled cohort identity bound to semantic, evidence, and facts hashes;
- `editorial-artifact.schema.json` — the existing `editorial-output.v1` inside an envelope bound to semantic, evidence, and facts;
- `critic-artifact.schema.json` — the existing `critic-output.v1` bound to semantic, evidence, facts, and the exact editorial artifact, with an explicit independence assertion;
- `palette.schema.json` — two-color palette, poster identity/hash, algorithm version, and explicit human-override metadata;
- `human-review.schema.json` — approve/revise/reject decision bound to every reviewed artifact and reviewed complete-record bytes;
- `production-record.schema.json` — exact curated meaning, runtime facts, and complete upstream provenance;
- `promotion-transaction.schema.json` — baseline, accepted hashes, proposed runtime identities, reconciliation, derived counts, and dry-run validation;
- `promotion-manifest.schema.json` — accepted/rejected/deferred/unchanged dispositions, actual output count, and validation/benchmark hashes;
- `production-validation-report.schema.json` — transaction-bound production checks and derived pass/fail result.

`catalogue-pipeline/config/schemaVersion.json` records all Phase 1 versions. Existing `semantic.schema.json`, `editorial.schema.json`, and `critic.schema.json` remain the inner output contracts and are not weakened.

### 4.2 Executable validation

`catalogue-pipeline/scripts/validatePromotionContract.mjs` provides canonical key-sorted serialization and SHA-256 hashing plus pure validators for promotion candidates, editorial envelopes, critic envelopes, palettes, human decisions, approval freshness, cross-artifact identity, complete production records, promotion transactions, promotion manifests, and production-validation reports.

V8.2 artifact hashes use `serializeArtifactForPersistence`: recursive stable key ordering, compact valid JSON, and exactly one terminal newline. `hashArtifact` hashes exactly those persisted bytes, and every future V8.2 artifact writer must write that representation unchanged. Historical V8.1 semantic/evidence provenance remains a `historicalSourceHash` over its original bytes; parsed-object recanonicalization is a distinct `V8.2ArtifactHash` and must never be substituted for the historical byte hash. `hashBytes` preserves this raw-byte distinction.

A human approval binds semantic, evidence, facts, editorial, critic, palette, and reviewed complete-record hashes. The reviewed complete-record hash deliberately excludes only the later human-decision hash, avoiding a circular hash; the final production record then binds the resulting human-decision hash. Any source mutation makes approval freshness fail.

An `approve` record cannot contain unapplied revisions. Revisions must first be incorporated into a new complete record and its artifact hashes, then that exact record must receive a new approval. `revise` and `reject` never authorize promotion.

### 4.3 Critic authority

Critic verdicts have these V8.2 meanings:

- `hard_fail`: blocks review and promotion;
- `needs_review`: blocks production eligibility until correction and a new critic artifact;
- `approve_for_review`: may advance to explicit human review;
- `candidate_for_auto_accept`: may advance to explicit human review but has no automatic promotion authority.

Every verdict, including `candidate_for_auto_accept`, requires a fresh human `approve`. Critic execution must assert that writer hidden reasoning was not provided.

Verdict and assessment consistency is also binding. `approve_for_review` may contain `pass` or `review` assessments but no `fail`. `candidate_for_auto_accept` requires all ten assessments to be `pass` and an empty issues array. The blocking verdicts need no further assessment-shape restriction beyond the existing critic schema.

### 4.4 Dry-run transaction boundary

Phase 1 assembles proposed transactions only in memory. It validates each complete record, refuses candidate-ID, local-ID, or TMDB-ID collisions, preserves every baseline identity and record hash in order, derives before/after counts from actual arrays, and deterministically serializes the result. Baseline and proposed output hashes must contain exactly `curatedMovies`, `tmdbMovieMappings`, and `tmdbMovies`.

The manifest persists a candidate-ID-sorted authoritative `candidateRoster` plus its V8.2 artifact hash and the historical candidate cohort hash. Accepted, rejected, and deferred must be individually unique, pairwise disjoint, preserve roster TMDB identity, and form an exhaustive union equal to the roster. `unchanged` is the baseline runtime and does not participate in that equation. The manifest derives `outputRuntimeCount` from unchanged plus accepted records; planning targets are non-authoritative.

Phase 1 implements no editorial writer, critic runner, palette generator, review UI, runtime writer, benchmark runner, provider selection, or external call. It does not modify production sources.

## 5. Phase 2 — Editorial pilot

The accepted pilot configuration is the Google Gemini Developer API with `gemini-3.8-flash`, writer thinking level `low`, and critic thinking level `medium`. This is a narrow pilot configuration, not a permanent 400-film production policy. No external call is authorized by Phase 2A; the 16-film live pilot must be separately accepted and will determine whether this configuration advances to Phase 3.

The deterministic Phase 0 selector proposes 16 films by greedy set coverage across mood, spoken language, era, attention demand, emotional weight, discovery style, runtime band, and genre, with `candidateId` as the tie-breaker. The exact cohort and selection features are stored in the audit report.

The pilot must test:

- `description`, `whyWatch`, `curiosityHook`, and `vibeSummary` completeness and differentiation;
- setup-only spoiler control;
- Movie Mood voice consistency and specificity;
- semantic alignment and factual grounding;
- syntactic repetition and generic-language risk across the cohort;
- real card and detail-layout fit.

Passing requires schema validation, hard editorial validation, independent critic review, and human review for every pilot record. Pilot failures lead to prompt, contract, or workflow revision; they do not lower thresholds.

### 5.1 Phase 2A — zero-network preflight

Phase 2A adds a dedicated Gemini editorial/critic adapter without changing the historical semantic Gemini adapter or its defaults. The adapter projects the existing `editorial-output.v1` and `critic-output.v1` contracts into structured JSON response schemas, locks each response to the requested candidate and TMDB identity, preserves exact usage metadata and raw responses outside runtime, and classifies response-bearing HTTP failures separately from model-output validation failures. Retries are bounded and fail closed; an ambiguous transport outcome is never silently redispatched. Requests contain no temperature, top-p, top-k, or search-grounding controls, and credentials are never persisted.

The runner supports only these zero-network commands:

```text
node catalogue-pipeline/scripts/editorialPilot.mjs prepare
node catalogue-pipeline/scripts/editorialPilot.mjs inspect
node catalogue-pipeline/scripts/editorialPilot.mjs estimate
```

Live execution is explicit and gated: `run-writers --execute` and `run-critics --execute` require `GEMINI_API_KEY` from the environment; bare commands cannot dispatch. Requests send the exact versioned prompt through `systemInstruction` and the exact canonical input packet through `contents`. Prompt raw-byte, packet canonical-byte, schema canonical-byte, and complete-request hashes are bound to every dispatch. Each response-bearing retry is preserved and delayed using Retry-After, Google RetryInfo, provider retry messaging, or a bounded exponential fallback; ambiguous transports are never redispatched. Deterministic packets and preflight metadata are stored under `catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/`. Each packet binds the authoritative historical semantic, evidence, and facts hashes while separately recording V8.2 canonical artifact hashes. The critic packet builder is created only after a hard-valid editorial artifact and forwards facts, accepted semantics, visible copy, voice guidance, and non-hard validation flags; it excludes writer notes, hidden reasoning, chain-of-thought, and provider thought content.

The materialized preflight contains 16 writer calls and 16 critic calls. Writer inputs total 186,910 bytes, approximately 46,728–93,455 input tokens. Estimated critic inputs total 198,542 bytes, approximately 49,636–99,271 input tokens. Combined planned input is 385,452 bytes. Maximum configured output is 8,192 tokens per writer call and 12,288 per critic call. These are deterministic byte-based planning ranges, not provider billing or pricing data; actual usage metadata belongs in the later live manifest.

The local poster-readiness audit found 400 of 400 Semantic-400 facts records and 16 of 16 pilot records with non-null `posterPath`; both null-candidate lists are empty. No posters were fetched and no palettes were generated. A future null poster must trigger a separately reviewed fallback-policy decision, never an invented poster-derived palette.

## 6. Phase 3 — Editorial production and solo review

Production scales only after the pilot passes. The separation is binding:

```text
semantic classifier ≠ editorial writer ≠ critic
```

The critic may receive facts, accepted semantics, visible editorial copy, voice rules, and validation flags. It must not receive writer hidden reasoning. Writer output cannot become production data until it passes:

1. editorial schema validation;
2. hard editorial and voice validation;
3. independent critic assessment;
4. explicit human approval of the exact hashed record.

The solo-maintainer review surface must avoid giant raw JSON files. For each film it should show poster, title/year, semantic tags, four copy fields, critic flags, source/evidence linkages, and approve/revise/reject controls. Decisions must be resumable, deterministic, exportable, and invalidated whenever a reviewed source changes.

The existing `buildReviewQueue.mjs` is reusable as a validation-summary mapper, but it is not yet a complete editorial review workflow. Phase 3 must add editorial and critic provenance, decision validation and persistence, hash binding, and a compact report or local UI.

## 7. Phase 4 — Deterministic promotion

Promotion generates or writes only the established runtime contract:

```text
src/data/curatedMovies.ts
src/data/tmdbMovieMappings.json
src/data/generated/tmdbMovies.json
```

The promotion builder must:

- consume only complete, approved records;
- preserve all existing local IDs and existing curated values;
- assign new local IDs deterministically and reject collisions;
- use TMDB ID as factual identity;
- be deterministic and idempotent;
- refuse partial records, missing fields, duplicate TMDB IDs, conflicting facts, stale approvals, and partial-batch output;
- emit before/after source hashes and accepted/rejected/deferred counts;
- validate the complete merged runtime catalogue and exact one-to-one mapping;
- write atomically or fail without modifying production sources;
- retain provenance in a committed promotion manifest;
- support exact rollback through the recorded parent commit and Git history.

No runtime module may import raw semantic, editorial, critic, review, or provider-response artifacts.

## 8. Phase 5 — At-scale product benchmark

A successful build is necessary but insufficient. Benchmark the expanded runtime against the 41-film baseline without automatically changing ranking behavior.

### 8.1 Static/runtime measures

- catalogue count, runtime data payload, build output size, and build time;
- typecheck, production build, runtime tests, and URL/state compatibility;
- favorites compatibility with existing and newly assigned stable IDs.

### 8.2 Coverage measures

- mood, situation, filter, language, discovery-style, attention-demand, pace, and emotional-weight coverage;
- zero-, one-, two-, and 3+-result product states across the supported state space.

### 8.3 Recommendation measures

- distinct three-film slate count;
- duplicate or repetitive slate behavior;
- Another Three cycling depth;
- More Like This coverage;
- Decision Companion split usefulness;
- Duel compatibility;
- deterministic URL and state restoration.

The benchmark must preserve the baseline and expanded results in a committed report. Distribution changes alone do not authorize recommendation changes. Any ranking or recommendation modification requires a separate evidence-backed decision.

## 9. Phase 6 — Runtime promotion and closure

V8.2 is releasable only when:

- every promoted film has a complete Movie Mood record and accepted human decision;
- identity uniqueness and complete one-to-one runtime mapping pass;
- no required production field is missing;
- full runtime tests, build, and typecheck pass;
- the at-scale benchmark has no unresolved release blocker;
- the committed runtime catalogue equals the validated promotion transaction;
- GitHub Pages deployment succeeds;
- README reports the actual deployed count derived from runtime data;
- a closure document records exact baseline, eligible, promoted, rejected, deferred, and deployed counts plus transaction hashes.

Only after these gates may the maintainer tag and release V8.2. Phase 0 does not tag, push, deploy, or release.

## 10. Infrastructure gap locked by Phase 0

Executable now:

- semantic, editorial, critic, curated-record, facts, and one-to-one validation primitives;
- editorial voice checks;
- a generic validation-summary review-queue builder.

Still required:

- editorial writer runner;
- critic runner and enforced execution-level independence boundary;
- complete editorial/critic review packet or local review UI;
- validated, hash-bound human acceptance persistence;
- palette generator and override contract;
- deterministic promotion builder and merged transaction validator;
- rollback/reproducibility manifest;
- recommendation-at-scale benchmark;
- static catalogue/build benchmark.

Schemas or proposed filenames do not count as implemented capabilities. Later phases must demonstrate executable code and tests.
