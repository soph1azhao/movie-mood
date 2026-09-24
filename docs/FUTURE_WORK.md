# Movie Mood — Future Work & Exploration Map

**Status:** post-`v8.2.0` exploration notes, not commitments.
**Released baseline:** 180 runtime films (41 original + 139 promoted).
**Semantic-production checkpoint:** 400 V8.1 semantic records.

This document records promising questions without turning them into unfinished obligations.

> A future idea becomes work only after it has a concrete user problem, a bounded validation plan, and a stopping rule.

---

## 1. Catalogue expansion: coverage, not a round number

V8.1 reached Semantic-400. V8.2 did **not** establish that only 139 of those records “fit Movie Mood.” It established that only the accepted T3 population received the complete V8.2 production/promotion/runtime authority chain.

Earlier semantic-production records should therefore be treated as **unpromoted evidence**, not automatically as rejected movies and not automatically as release-ready movies.

A future expansion should not start with “deploy the remaining records.” It should start with:

1. inventory the remaining semantic-production pool under the current production contract;
2. determine which records already have reusable facts/evidence and which need current-contract requalification;
3. select a bounded tranche based on product coverage gaps rather than round-number scale;
4. run deterministic hygiene/source-boundary routing;
5. apply the minimum human review required by the then-authorized protocol;
6. promote only the population that earns current production authority.

### Coverage-aware expansion hypothesis

The next tranche may be more valuable if it fills thin parts of the current catalogue rather than simply increasing total count.

A post-release read-only analysis of the 180-film runtime found:

- every one of the 30 `mood × situation` cells currently has at least 4 films;
- mood distribution is uneven: `relaxing` is much smaller than `emotional` or `suspenseful`;
- attention demand is dominated by `engaged` relative to `easy` and `immersive`;
- discovery style is dominated by `different` relative to `adventurous`;
- sparse pools appear mainly after multiple hard practical filters are stacked.

This is not proof of a defect. It is a useful selection signal for a future tranche.

**Possible next study:** rank unpromoted semantic records by how much they improve coverage of sparse runtime cells, then compare that coverage-aware tranche with a random tranche before any promotion work.

---

## 2. Filter semantics: distinguish “must”, “prefer”, and “avoid”

The released filter implementation currently behaves approximately as follows:

- mood: required;
- situation: exact first, then relaxed if fewer than three exact matches;
- genre: hard filter; multiple selected genres currently mean the movie must contain **every** selected genre;
- runtime: hard bucket match;
- language: hard match;
- pace: hard exact match;
- emotional weight: hard exact match;
- attention demand: soft ranking signal;
- discovery style: soft ranking signal;
- dealbreakers: hard exclusions.

This model is coherent, but several practical axes may be stricter than a user mentally intends.

### Evidence from the current 180-film runtime

Core `mood × situation` coverage is healthy: none of the 30 cells falls below three films.

Sparsity appears when additional hard dimensions are stacked. For example, among all theoretical `mood × pace × emotional-weight × runtime` cells, many contain fewer than three films and many are empty. That does **not** mean the catalogue is broken; most users will not request every dimension simultaneously. It does show that exact conjunction is an increasingly brittle interpretation of “help me narrow this down.”

### Exploration options

**A. Make genre semantics explicit.**
Current multi-genre behavior is AND. Test whether users actually expect “Action + Comedy” to mean both genres or “either Action or Comedy.” Possible UI choices:

- default OR (“any of these”);
- explicit Any / All control;
- keep one genre selection only.

**B. Move pace/emotional weight from hard filters to soft preferences.**
If a user says “fast” or “light,” rank exact matches first but keep transparent near-matches available unless the wording is explicitly a dealbreaker.

**C. Introduce a transparent relaxation ladder.**

```text
exact mood + hard constraints + preferences
→ relax situation (existing behavior)
→ relax soft pace/weight preference
→ show “closest fits” label
→ never violate explicit hard constraints silently
```

**D. Preserve true hard constraints.**
Language, an explicit runtime ceiling, and “Not tonight” dealbreakers may deserve hard semantics because violating them can make a recommendation unusable.

### Recommended validation before code

Build an offline coverage matrix across the current catalogue and test 20–30 realistic user scenarios manually. Compare:

- current exact-conjunction behavior;
- tiered hard/soft behavior;
- user-visible fallback explanations.

Do not change production filtering until this demonstrates lower decision friction rather than merely larger result pools.

---

## 3. TMDB ratings as a late-stage confidence cue

TMDB exposes rating/vote data such as `vote_average` and `vote_count`. A future maintainer-time snapshot could therefore add these factual fields without creating a runtime authenticated API dependency.

The product question is not “can Movie Mood show a rating?” It is:

> **Can rating information help break a tie without turning Movie Mood into a popularity-ranking product?**

### Safer first experiment

- do not use rating in initial recommendation ranking;
- do not show it during Glimpse;
- test it only in Movie Details or the final Duel / tie-break stage;
- show `vote_average` together with `vote_count`, not the average alone;
- snapshot the data at maintainer time under `TMDB owns facts`;
- test whether users mechanically choose the higher number even when the lower-rated film better fits tonight.

A positive result would justify implementation. A strong anchoring effect would justify rejecting the feature.

---

## 4. Source-boundary automation: reduce work only after prospective evidence

V8.2 showed that automation can block obvious structural/source-boundary risk, but it cannot simply redefine semantic acceptability.

Future work may revisit source-boundary verifier automation only if a new prospective protocol can demonstrate that it safely reduces human workload.

Important constraints remain:

- retrospective development performance is not prospective validation;
- containment is not semantic detection;
- zero observed severe failures is not proof of zero severe risk;
- a critic/verifier supplies evidence, not positive production authority;
- raw failures and provenance must remain durable.

The goal is not “remove the human.” The goal is “route scarce human attention to the cases where it matters most.”

---

## 5. Static architecture: keep until evidence says otherwise

At 180 films the static runtime remains a feature, not a limitation.

Do not add a backend, account system, vector database, runtime recommendation model, or authenticated runtime TMDB API simply because future catalogue size might be larger.

Revisit architecture only if measured bundle size, load time, update workflow, or product behavior demonstrates a concrete problem.

---

## 6. Current exploration queue

These are the strongest current options, in suggested order of **cheap learning**, not commitment:

1. **Filter Coverage Study** — test hard vs soft filter semantics against real user scenarios.
2. **Coverage-Aware Catalogue Expansion Study** — inspect whether unpromoted semantic records fill sparse catalogue cells.
3. **TMDB Rating Tie-Break Experiment** — test rating/vote count only at late decision stages.
4. **Prospective Source-Boundary Automation Study** — only if reducing human review becomes the actual scaling bottleneck.
5. **Architecture Reassessment** — only after measured static-runtime limits appear.

The next version does not need to choose any of these. A toy project is allowed to remain finished until a question becomes interesting enough to reopen it.

