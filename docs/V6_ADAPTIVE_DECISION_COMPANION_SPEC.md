# Movie Mood V6 - Adaptive Decision Companion Implementation Spec

## Status

Draft implementation specification.

Target version:

`v6.0.0`

Current foundation:

`v5.2.0`

V6 must preserve the accepted V5.2 product model:

> Glimpse -> Refine -> Reveal -> Decide

V6 changes only the Decision stage.

---

# 1. Product Goal

V5.2 helps users gradually discover what they want instead of requiring them to describe it upfront.

V6 addresses the next remaining friction:

> Three good options can still feel like too many.

The Adaptive Decision Companion may ask one useful question about the current three movies when that question can genuinely help reduce the slate from three candidates to two.

Core principle:

> When three good movies still feel like too many, Movie Mood may ask one useful question - not another questionnaire.

The word **may** is essential.

The companion must remain silent when the current slate and user context do not support a genuinely useful question.

---

# 2. Version Story

V1 - Mood
V2 - Context
V3 - Discovery
V4 - Decide
V5 - Real Movies
V5.1 - Curation & Closure
V5.2 - Progressive Reveal
V6 - Adaptive Decision Companion

V6 is not a new recommendation system.

It is a deterministic decision-support layer operating only on the three movies the existing recommendation system has already produced.

---

# 3. Research Basis

The committed feasibility audit is:

`docs/V6_FEASIBILITY_AUDIT.md`

Its measured V5.2 reachable-state results include:

- 73,728 UI states analyzed
- 8,992 states with recommendation pools of at least three movies
- 534 distinct reachable three-movie slates
- 526 / 534 slates with at least one raw clean 2:1 split
- 512 / 534 slates with at least one context-valid useful split in at least one reachable context
- 14,170 / 21,148 slate-context pairs with a useful question
- 6,978 / 21,148 slate-context pairs where no question should be asked

Therefore:

> Asking nothing is a normal V6 behavior, not an exceptional fallback.

The audit also found:

- attentionDemand has the broadest useful slate coverage
- pace is frequently the sole remaining useful distinction
- emotionalWeight remains useful but does not dominate
- runtime remains viable but is the most context-redundant dimension

The implementation must follow these findings rather than older assumptions about fixed dimension priority.

---

# 4. Hard Scope Boundary

V6 implements:

- deterministic inspection of the current three-film Decision Mode slate
- detection of useful binary distinctions
- contextual redundancy removal
- at most one adaptive binary question
- transparent reduction from three movies to two finalists
- preservation of direct manual elimination
- preservation of Duel, gut check, Tonight's Pick and Change My Mind
- restorable/shareable V6 decision state

V6 does NOT implement:

- multiple-question questionnaires
- runtime AI
- ML
- numerical recommendation scoring
- hidden taste profiles
- new subjective movie metadata
- automatic recommendation replacement
- new catalogue search
- universal TMDB search
- streaming-provider integration
- Movie Mood Together
- accounts
- backend services
- global state framework
- router framework
- catalogue expansion

Do not begin later-version features while implementing V6.

---

# 5. Entry Point

The Adaptive Decision Companion exists only inside:

`Help Me Choose`

It must not appear during:

- mood selection
- Glimpse
- refinement
- Full Reveal
- More Like This
- My List
- ordinary recommendation browsing

Existing V5.2 flow remains:

Mood
-> Glimpse
-> Refine if useful
-> Full Reveal if desired
-> Help Me Choose

Only then may V6 participate.

---

# 6. Three-Movie Decision Entry

When Help Me Choose opens with three movies, Movie Mood first evaluates whether the slate supports a useful adaptive question.

There are three possible paths.

## Path A - User already knows

The user may select a movie immediately.

No adaptive question is required.

Existing direct-pick behavior must remain available.

## Path B - Adaptive question available

Movie Mood may offer one useful binary question.

Answering it transparently reduces the slate from three movies to two finalists.

The resulting two enter the existing Duel flow.

## Path C - No useful question

Movie Mood does not invent one.

The user remains in the accepted V5.2 three-card flow and may:

- choose a movie immediately
- explicitly drop one movie

Dropping one produces the existing two-film Duel.

The adaptive feature must therefore enhance V5.2, never gate it.

---

# 7. Candidate Dimensions

V6 may inspect only existing Movie Mood metadata:

- `attentionDemand`
- `pace`
- `emotionalWeight`
- `runtimeMinutes` using existing product runtime semantics

No new movie fields may be introduced for V6.

Do not use:

- discoveryStyle
- genre
- mood
- situation tags
- TMDB popularity
- ratings
- vote counts
- keywords
- reviews
- cast
- external recommendation data

Those fields may influence existing recommendation or decision behavior where already accepted, but they are not V6 adaptive-question dimensions.

---

# 8. Useful Split Definition

For a candidate dimension to support an adaptive question:

1. the current three movies must form a clean 2:1 distinction on that dimension;
2. the distinction must be expressible as one understandable binary choice;
3. the dimension must not already be materially resolved by active user context;
4. answering the question must map transparently to keeping two movies and eliminating one.

Examples:

`easy, easy, immersive`
-> clean 2:1 attention split

`fast, medium, medium`
-> clean 2:1 pace split

`light, light, moderate`
-> clean 2:1 emotional-weight split

`short, medium, medium`
-> clean 2:1 runtime split

Not eligible:

`easy, engaged, immersive`
-> three-way distinction

`fast, fast, fast`
-> uniform

A distinction must not be manufactured from tiny numerical runtime differences or arbitrary hidden thresholds beyond existing runtime semantics.

---

# 9. Context Redundancy

Before selecting a question, V6 must remove dimensions the user has already substantially constrained.

At minimum:

## Attention

If the user already selected an explicit `attentionDemand` preference:

-> do not ask an attention question.

## Pace

If:

- explicit pace filter is active, or
- `avoidSlow` already materially resolves the proposed distinction

-> do not ask that pace question.

## Emotional weight

If:

- explicit emotionalWeight filter is active, or
- `avoidHeavy` already materially resolves the proposed distinction

-> do not ask that emotional-weight question.

## Runtime

If:

- explicit runtime filter is active, or
- `underTwoHours` already materially resolves the proposed distinction

-> do not ask that runtime question.

The implementation should evaluate the actual current slate/context rather than blindly treating every dealbreaker as universally disabling the dimension.

Core rule:

> Do not ask the user something they have already told Movie Mood.

---

# 10. Question Selection

V6 must not use a numerical score.

Question selection should be deterministic and explainable.

Required selection process:

1. derive all clean 2:1 candidate dimensions for the current three movies;
2. remove context-redundant dimensions;
3. if none remain:
   - ask nothing;
4. if exactly one remains:
   - use it;
5. if several remain:
   - choose using a small explicit deterministic priority informed by the feasibility audit and active context.

Initial default priority:

1. attentionDemand
2. pace
3. emotionalWeight
4. runtime

This priority is only a deterministic tiebreaker after contextual elimination. It must not be used to pretend the feasibility audit measured subjective question quality.

Do not implement an opaque weighted score.

The helper should return something structurally similar to:

```ts
type AdaptiveDecisionQuestion = {
  dimension: AdaptiveDecisionDimension
  prompt: string
  options: [
    AdaptiveDecisionOption,
    AdaptiveDecisionOption,
  ]
}
```

---

# 11. Silence and Manual Drop

When no context-valid useful question remains, silence is the required behavior.

The interface must keep the accepted V5.2 three-card decision flow available:

- the user can directly pick a movie;
- the user can manually drop one movie;
- dropping one movie produces the existing two-film Duel.

Do not force a distinction. Do not show a fake adaptive question. Do not block the user until a question can be asked.

Optional polish may explain that the three options are close, but such copy is not required and must not replace the manual drop path.

---

# 12. Implementation Notes

The adaptive companion should be implemented as deterministic application logic, ideally in a small pure helper that can be unit-tested without rendering the UI.

The helper should:

- accept exactly the current three-movie slate and the active user context;
- derive clean 2:1 splits only from allowed dimensions;
- apply contextual redundancy checks before priority;
- return `null` when no useful question remains;
- return one question when exactly one useful distinction or one priority tiebreaker remains;
- include enough option metadata to map an answer transparently to the two kept movies and the one eliminated movie.

The UI should:

- call the helper only inside Help Me Choose;
- show at most one adaptive question;
- reduce three movies to two finalists after an answer;
- keep direct pick and manual drop available;
- continue into the existing Duel flow once two finalists remain;
- preserve existing Tonight's Pick, gut check, and Change My Mind behavior.

Persistence should include enough V6 decision state to restore or share:

- the original three-movie decision slate;
- whether an adaptive question was available;
- the selected adaptive answer, if any;
- the manually dropped movie, if any;
- the resulting two finalists.

