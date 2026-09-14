# Movie Mood V8.2 — Catalogue Promotion & Runtime Scale

**Status:** Phase 0 implemented; later phases proposed and gated.

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

## 5. Phase 2 — Editorial pilot

No paid provider or model is selected or authorized here. Provider/model selection is a separate gate before any external call.

The deterministic Phase 0 selector proposes 16 films by greedy set coverage across mood, spoken language, era, attention demand, emotional weight, discovery style, runtime band, and genre, with `candidateId` as the tie-breaker. The exact cohort and selection features are stored in the audit report.

The pilot must test:

- `description`, `whyWatch`, `curiosityHook`, and `vibeSummary` completeness and differentiation;
- setup-only spoiler control;
- Movie Mood voice consistency and specificity;
- semantic alignment and factual grounding;
- syntactic repetition and generic-language risk across the cohort;
- real card and detail-layout fit.

Passing requires schema validation, hard editorial validation, independent critic review, and human review for every pilot record. Pilot failures lead to prompt, contract, or workflow revision; they do not lower thresholds.

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
