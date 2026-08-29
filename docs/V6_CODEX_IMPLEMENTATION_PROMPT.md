# Movie Mood V6 - Codex Implementation Prompt

Use this prompt to implement Movie Mood V6 in the repo.

---

You are Codex working in the `soph1azhao/movie-mood` repository.

Implement Movie Mood V6: Adaptive Decision Companion.

Before writing code:

1. Read `README.md`.
2. Read `docs/CODEX_WORKFLOW.md`.
3. Read `docs/V6_ADAPTIVE_DECISION_COMPANION_SPEC.md`.
4. Read `docs/V6_FEASIBILITY_AUDIT.md` if present.
5. Inspect the current app architecture before choosing file names, state shape, or component boundaries.

Important scope rule:

V6 changes only the Decision stage, specifically Help Me Choose. Preserve the accepted V5.2 product model:

`Glimpse -> Refine -> Reveal -> Decide`

Do not add backend services, AI, ML, numerical scoring, new subjective movie metadata, recommendation replacement, catalogue expansion, routing, accounts, streaming integrations, or any later-version features.

## Product Behavior

When Help Me Choose opens with exactly three movies, inspect only the current three-film slate and active user context.

Allowed adaptive dimensions:

- `attentionDemand`
- `pace`
- `emotionalWeight`
- `runtimeMinutes`, using existing product runtime semantics

Do not use genre, mood, situation tags, discovery style, ratings, popularity, vote counts, keywords, reviews, cast, TMDB data beyond existing runtime, or external recommendation data as adaptive-question dimensions.

## Required Decision Logic

Implement the adaptive helper as deterministic, testable logic.

Selection order is mandatory:

1. Derive all clean 2:1 candidate splits across the allowed dimensions.
2. Remove dimensions that are context-redundant.
3. If no candidate remains, return no question.
4. If exactly one candidate remains, use it.
5. If multiple candidates remain, apply explicit priority only as a deterministic tiebreaker.

Default tiebreaker priority:

1. `attentionDemand`
2. `pace`
3. `emotionalWeight`
4. `runtime`

Do not implement a score, weight, ranking formula, quality estimate, or hidden subjective heuristic. Contextual elimination comes first; priority is only a deterministic tiebreaker.

## Context Redundancy

Do not ask the user something they already told Movie Mood.

At minimum:

- Do not ask attention when an explicit `attentionDemand` preference is active.
- Do not ask pace when an explicit pace filter is active, or when `avoidSlow` already materially resolves the proposed split.
- Do not ask emotional weight when an explicit `emotionalWeight` filter is active, or when `avoidHeavy` already materially resolves the proposed split.
- Do not ask runtime when an explicit runtime filter is active, or when `underTwoHours` already materially resolves the proposed split.

Evaluate redundancy against the actual current slate/context. Do not blindly disable every dimension just because a dealbreaker exists.

## Silence Requirement

In no-question contexts, silence/manual drop is required behavior.

If no context-valid useful question exists:

- do not invent a question;
- do not force a distinction;
- do not block Help Me Choose;
- keep the existing three-card flow available;
- let the user pick directly or explicitly drop one movie;
- after a manual drop, continue into the existing two-film Duel flow.

Optional "these three are close" copy is allowed only as polish. It must not replace the manual drop path.

## UI Requirements

The adaptive companion appears only inside Help Me Choose.

It must not appear during mood selection, Glimpse, refinement, Full Reveal, More Like This, My List, or ordinary recommendation browsing.

When a question is available:

- show at most one binary question;
- each answer must transparently keep two movies and eliminate one;
- after answering, enter the existing Duel flow with the two finalists;
- keep direct pick available.

Preserve direct pick, manual elimination, Duel, gut check, Tonight's Pick, and Change My Mind behavior.

## State and Persistence

Preserve or add restorable/shareable V6 decision state for:

- original three-movie slate;
- question availability;
- selected adaptive answer, if any;
- manually dropped movie, if any;
- resulting two finalists.

Follow the repo's existing state and persistence patterns. Do not introduce a global state framework.

## Suggested Phases

Phase 0 - Repo readiness:

- Confirm the app source exists.
- Confirm existing V5.2 Decision/Help Me Choose code exists.
- If the app source is absent, stop after documenting the blocker and do not scaffold an unrelated app.

Phase 1 - Pure helper:

- Add types for adaptive dimensions, candidate splits, options, and questions using existing project style.
- Add a pure helper that accepts a three-movie slate and active context.
- Implement clean 2:1 split detection.
- Implement contextual redundancy elimination.
- Implement deterministic priority as a tiebreaker only.
- Return `null` for required silence/no-question contexts.

Phase 2 - Tests:

- Cover uniform, three-way, and clean 2:1 slates.
- Cover contextual elimination for attention, pace, emotional weight, and runtime.
- Cover priority tiebreaking only after contextual elimination.
- Cover no-question silence/manual-drop eligibility.

Phase 3 - Help Me Choose UI:

- Call the helper only when Help Me Choose starts with exactly three movies.
- Render one adaptive binary question when available.
- Map answers to two finalists and one eliminated movie.
- Preserve direct pick and manual drop.
- Continue to Duel with two finalists.

Phase 4 - Persistence/share state:

- Extend existing persistence/share encoding with V6 decision state.
- Restore adaptive answered, manual-dropped, and no-question states.
- Avoid breaking older share links if the app already supports them.

Phase 5 - Verification:

- Run the smallest meaningful test/build commands for the changed code.
- Manually inspect or exercise Help Me Choose paths:
  - adaptive question available;
  - no useful question, silent/manual drop;
  - direct pick;
  - manual drop into Duel;
  - adaptive answer into Duel;
  - restore/share state if supported.
- Inspect `git diff`.
- Confirm only expected files changed.

