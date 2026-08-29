# Movie Mood V6 - Selective Decision Companion Implementation Spec

## Status

Locked for implementation.

Target version: `v6.0.0`

Current accepted product foundation: `v5.2.0`

This document is the canonical V6 source of truth. `docs/V6_ADAPTIVE_DECISION_COMPANION_SPEC.md` and the implementation checkpoint at `81c0874` are historical research/implementation context and are superseded wherever they conflict with this specification.

V6 preserves the accepted V5.2 flow:

```text
Glimpse -> Refine -> Reveal -> Decide
```

V6 changes only the three-to-two transition inside Decision Mode.

## Product Goal

Movie Mood's product principle remains:

```text
Streaming platforms help you find more movies. Movie Mood helps you choose one.
```

V5.2 gets the user to three meaningful candidates. V6 addresses the remaining friction:

```text
Three good options can still be difficult to reduce to two.
```

V6 is a Selective Decision Companion. When one movie meaningfully stands apart from the other two, Movie Mood may point that out and let the user decide whether that movie still belongs tonight.

Core principle:

```text
Movie Mood notices a useful difference, then lets the user react.
```

V6 optimizes precision over recall. Silence is a valid and successful V6 outcome.

## Locked Interaction Model

V6 does not ask an abstract preference question. It uses film-specific recognition.

When a valid outlier exists:

```text
Decision companion

[Movie] stands a little apart.

[one neutral, human-readable observation]

[vibeSummary]

[ Not tonight ]    [ Keep it in ]
```

`Not tonight` explicitly rejects the highlighted outlier. Movie Mood removes only that movie, preserves the other two exactly as the pair, and enters the existing Duel. The system must never rank, split, or arbitrarily choose between the other two movies.

`Keep it in` removes nothing. All three candidates remain available. The companion may be dismissed for the current three-card decision session so the user can continue with manual Drop One or a direct pick. `Keep it in` must never secretly reduce or reorder the slate.

## Scope Boundary

V6 implements only:

- deterministic inspection of the current three-film Decision Mode slate;
- contextual redundancy removal;
- salient split detection;
- coherence checking;
- one optional film-specific Form-B intervention;
- explicit rejection of the outlier;
- fallback to existing manual Drop One;
- preservation of existing Duel and downstream decision behavior.

V6 does not implement multiple adaptive questions, preference questionnaires, runtime-triggered intervention, numerical scoring, confidence scores, ML/AI, hidden ranking, replacement movies, catalogue expansion, backend services, accounts, external APIs, routing, or global state frameworks.

## Entry Point

V6 exists only inside `Help Me Choose` with exactly three current candidate movies.

It must not alter mood selection, Glimpse, Refine, Reveal, recommendation generation, filters, discovery ordering, More Like This, My List, or ordinary browsing.

The user may always choose one of the three movies directly. V6 never gates Decision Mode.

## Candidate Dimensions

V6 eligibility may inspect only:

- `attentionDemand`;
- `emotionalWeight`;
- `pace`.

`runtimeMinutes` is not an eligibility dimension. Runtime may continue to appear elsewhere in normal Movie Mood UI and Duel information, but it must not independently cause the Decision Companion to appear.

Do not use `discoveryStyle`, genre, mood, situation, TMDB data, popularity, ratings, cast, or external information for V6 outlier eligibility.

## Clean 2:1 Split

V6 begins from the raw metadata values of the current three movies.

A dimension has a clean split only when:

- exactly two distinct raw values are present;
- one value belongs to exactly two movies;
- the other value belongs to exactly one movie.

The singleton movie is the candidate outlier for that dimension.

Examples:

```text
easy / easy / engaged -> clean attention split
heavy / moderate / moderate -> clean emotional-weight split
slow / fast / fast -> clean pace split
```

Not clean:

```text
easy / engaged / immersive -> three raw values -> no attention split
light / moderate / heavy -> three raw values -> no emotional-weight split
```

Do not collapse raw metadata categories before split detection. `easy <-> non-easy` means the pairwise raw contrasts `easy <-> engaged` and `easy <-> immersive` may qualify. It does not merge `engaged` and `immersive` into a synthetic value. Likewise, `heavy <-> non-heavy` means `heavy <-> moderate` and `heavy <-> light` may qualify; it does not merge `light` and `moderate` before split detection.

## Context Redundancy

After extracting raw clean splits, remove a split if the user has already materially resolved that dimension.

Suppress attention when an explicit `attentionDemand` preference is active.

Suppress emotional weight when an explicit emotional-weight filter is active, or when `avoidHeavy` already resolves a split involving `heavy`.

Suppress pace when an explicit pace filter is active, or when `avoidSlow` already resolves a split involving `slow`.

Core rule:

```text
Do not tell the user something they have already told Movie Mood.
```

Context redundancy is suppression logic only. It must not create a new split.

## Salience Filter

After context redundancy, apply salience. Non-salient splits are discarded completely. A discarded split cannot trigger Form B, veto another split, increase confidence, or influence copy.

Emotional weight is salient only for:

```text
heavy <-> moderate
heavy <-> light
```

`light <-> moderate` is non-salient.

Attention demand is salient only for:

```text
easy <-> engaged
easy <-> immersive
```

`engaged <-> immersive` is non-salient.

Pace is salient only for:

```text
slow <-> fast
```

`slow <-> medium` and `medium <-> fast` are non-salient.

Runtime never enters the V6 salience set.

## Required Evaluation Order

The ordering is locked:

```text
exactly 3 movies
      |
1. extract raw clean 2:1 splits
      |
2. remove context-redundant splits
      |
3. apply salience filter
      |
0 salient splits?
   -> SILENCE
      |
>=1 salient splits
      |
4. coherence check
```

A non-salient split must be removed before coherence. A weak distinction therefore cannot veto a strong one.

## Coherence

After salience filtering, inspect only surviving salient splits.

If no salient split survives, return `null` and preserve the normal V5.2 manual decision flow.

If all salient splits identify the same movie, that movie is the V6 outlier. Return Form-B companion data for that movie. The number of agreeing salient dimensions does not increase confidence, ranking, recommendation strength, or elimination semantics.

If salient splits identify different movies, return `null`. Movie Mood must remain silent. Do not use fixed dimension priority, array order, numerical scoring, or hidden tiebreakers to resolve competing salient outliers.

Core invariant:

```text
If Movie Mood cannot truthfully identify one coherent outlier, it says nothing.
```

## Pure Helper

Implement V6 eligibility as deterministic pure TypeScript using a semantic model such as:

```ts
type DecisionCompanionDimension =
  | 'attentionDemand'
  | 'emotionalWeight'
  | 'pace'

type DecisionCompanionCue = {
  outlierMovieId: string
  majorityMovieIds: [string, string]
  salientDimensions: DecisionCompanionDimension[]
  observation: string
}
```

Requirements:

- input must contain exactly three movies;
- output is either one coherent companion cue or `null`;
- output must not contain two answer-defined finalist pairs;
- majority pair must always be the exact two non-outlier movies;
- movie array order must never determine which majority movie survives;
- runtime must not appear in eligibility output.

## Observation Copy

The companion must describe difference, not quality. Do not expose enum labels mechanically. Avoid language implying recommendation strength, inferiority, warning, or predicted dislike.

Acceptable orientation-aware observations:

- Attention, outlier more demanding: "It asks for more of your attention; the other two are easier to settle into."
- Attention, outlier easier: "It asks less of your attention than the other two."
- Emotional weight, outlier heavier: "It carries a heavier emotional charge than the other two."
- Emotional weight, outlier lighter: "It stays emotionally lighter than the other two."
- Pace, outlier faster: "It moves at a much quicker clip; the other two take their time."
- Pace, outlier slower: "It takes its time more than the other two."

Always accompany the observation with the highlighted movie's existing `vibeSummary`.

Multiple salient dimensions may identify the same outlier. This remains valid Form B. They are not separate votes and do not increase confidence. For V6.0, multi-salient observation-copy synthesis is deferred; implementation may select one single-dimension observation deterministically for display as copy only.

## Silence Path

When V6 returns no coherent salient outlier, render the accepted V5.2 three-card Decision Mode. The user may choose one immediately, manually mark one `Not tonight`, undo that manual drop, and start Duel once exactly two remain.

Do not show "we couldn't decide" messaging, weaker fallback observations, Form C, or a fake adaptive question.

## Form-B State Transition

When the user selects `Not tonight` for the companion outlier:

```text
three-slate -> drop exact outlier -> exact two remaining movies -> duel
```

The reduction state should record explicit companion rejection/drop:

```ts
{
  kind: 'companion-drop',
  droppedMovieId: string
}
```

When the user selects `Keep it in`, the decision state remains a three-slate. No movie is removed. The UI may dismiss the companion for the current Decision Mode session.

## V5.2 Behavior That Must Survive

Preserve direct pick from three, manual Drop One, undo manual drop, Duel, Back to all three, Duel comparison information, coin flip, gut check, Tonight's Pick, Change My Mind, WatchAction, sharing, and accepted URL/state behavior unless the V6 state shape requires a minimal forward-compatible adjustment.

Do not redesign these flows.

## Superseded Experimental Concepts

The following concepts are superseded and must not survive in final V6 behavior:

- abstract adaptive preference questions;
- two symmetric adaptive answer options;
- arbitrary majority survivor selection;
- `ADAPTIVE_DIMENSION_PRIORITY` as product logic;
- runtime adaptive eligibility;
- `getAdaptiveDecisionQuestion()` semantics;
- question prompts such as "What kind of attention do you want to spend tonight?";
- option labels that expose two different finalist pairs.

Salvage reusable mechanics where appropriate, but do not preserve obsolete semantics merely because tests encode them.

## Locked Behavioral Oracle

Under the locked `easy <-> non-easy` attention rule:

| Slate | Expected |
| --- | --- |
| Rear Window / Children of Men / Petite Maman | Form B - Children of Men |
| A Separation / Arrival / Parasite | Form B - Arrival |
| Moonlight / Shoplifters / Rye Lane | Form B - Rye Lane |
| Aftersun / Spirited Away / Perfect Days | Form B - Aftersun |
| Amelie / School of Rock / Edge of Tomorrow | Form B - Edge of Tomorrow |
| Portrait of a Lady on Fire / Get Out / Inception | Silence |
| Before Sunrise / Perfect Days / My Neighbor Totoro | Form B - Before Sunrise |
| Shoplifters / Rye Lane / Petite Maman | Silence |

The final Shoplifters / Rye Lane / Petite Maman slate is Silence because pace saliently identifies Rye Lane, attention saliently identifies Shoplifters, and coherence fails.

## Required Automated Tests

At minimum test:

- helper returns `null` unless exactly three movies are supplied;
- uniform dimension produces no split;
- three raw values produce no split;
- no category collapsing before split extraction;
- attention salience boundaries: `easy/easy/engaged`, `easy/easy/immersive`, `engaged/engaged/immersive`, `easy/engaged/immersive`;
- emotional salience boundaries: `moderate/moderate/heavy`, `light/light/heavy`, `light/light/moderate`, `light/moderate/heavy`;
- pace salience boundaries: `slow/slow/fast`, `slow/slow/medium`, `medium/medium/fast`;
- runtime-only distinction never produces Form B;
- context redundancy for active attention, active emotional-weight filter, `avoidHeavy`, active pace filter, and `avoidSlow`;
- salience-first ordering;
- coherent vs conflicting salient outliers;
- mapping invariant and practical slate permutations;
- UI Form B visibility only when helper returns a cue;
- `Not tonight` enters Duel with the exact majority pair;
- `Keep it in` removes nothing;
- Silence retains manual Drop One;
- direct pick remains available;
- A-H oracle.

## Validation

Before V6 is accepted, run:

```text
pnpm test
pnpm build
```

Both must pass.

Also perform focused Decision Mode verification for:

- one attention Form-B case;
- one emotional-weight Form-B case;
- one pace Form-B case;
- one conflicting-salient Silence case;
- manual Drop One;
- Duel;
- gut check;
- Tonight's Pick;
- Change My Mind.

## Audit Metrics

Do not reuse the earlier `44/84` raw-slate figure as a final V6 metric. If a raw cycling-slate firing-rate metric is retained, recompute it under this exact final specification and record the method. The rate is an audit observation, not a target KPI.

## Known V6.0 Deferral

Multi-salient observation-copy synthesis is not covered by the eight-slate behavioral suite. Decision logic for same-outlier multi-salient cases is fully defined and must work. Natural-language synthesis of multiple salient reasons is deferred and must not block V6.0.

## Acceptance Criteria

V6 is accepted only if:

1. canonical implementation follows salience-first ordering;
2. raw three-way categories are never silently collapsed;
3. runtime never independently triggers the companion;
4. competing salient outliers result in Silence;
5. no array-order survivor exists;
6. `Not tonight` removes only the identified outlier;
7. `Keep it in` removes nothing;
8. manual Drop One remains fully available;
9. A-H produce the locked oracle;
10. Duel and all accepted V5.2 downstream behavior remain intact;
11. tests pass;
12. production build passes.

Only after these criteria pass should V6 be considered ready for release/tagging.
