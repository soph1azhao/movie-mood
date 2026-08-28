# Movie Mood V5.2 — Decision Axis Audit

## Method

This audit reviewed the 41 resolved curated movies at the V5.1.1 catalogue-trial checkpoint. For each mood pool, it compared the base first-three slate with slates produced by applying one axis at a time, preserving current deterministic catalogue order and existing filter/dealbreaker semantics.

The audit is supporting evidence for V5.2 UI hierarchy. It is not authority to change matching algorithms, delete fields, add scoring, or invent a new taxonomy.

## Summary Findings

Situation is highly useful as a user-facing prompt. It varies inside every mood pool and changes the displayed slate for most moods. It also exposes sparse edges, especially suspenseful + family/easy-watch, which currently has no direct candidates.

Attention demand is discriminating for most moods. It changes the slate across exciting, thoughtful, emotional, and suspenseful pools, while funny and relaxing have no immersive candidates. It belongs in the lightweight refinement section because it maps to how much effort the user has tonight.

Pace and emotional weight overlap with attention, but not enough to remove them. They are strong practical refinements in thoughtful, emotional, exciting, and suspenseful moods. They are less useful for funny/relaxing because those pools avoid heavy or slow extremes, so they should stay in Get Specific rather than lead the experience.

The strict dealbreakers behave as intended. `avoidHeavy` matters most for exciting, thoughtful, emotional, and suspenseful. `avoidSlow` matters most for thoughtful. `underTwoHours` often reduces pools and frequently changes the slate, especially outside funny.

Runtime filters are very discriminating and often sparse. Short runtime can produce fewer than three candidates in most mood pools. Long runtime is empty for relaxing and very small for funny. Runtime should remain available, but it is best as a practical filter rather than a first question.

Genre and language are powerful but highly specific. They often change the slate and can sharply reduce pools. They belong under Get Specific so users can reach for them once the Glimpse has made the options concrete.

Discovery style changes ordering in every mood pool, but it is abstract compared with situation, focus, and dealbreakers. Keeping it out of upfront controls in V5.2 is reasonable while preserving it in underlying movie data, similarity, decision logic, and URL restoration.

## Mood-Level Notes

| Mood | Pool | Most Useful Axes | Sparse / Low-Impact Notes |
|---|---:|---|---|
| Funny | 13 | situation, pace, emotional weight, discovery style, genre, language | no slow, heavy, or immersive candidates; strict dealbreakers leave first slate unchanged; short and long runtime are sparse |
| Exciting | 11 | situation, attention, pace, emotional weight, runtime, discovery style, language | date-night, family, and easy-watch are sparse; medium pace has one candidate |
| Thoughtful | 16 | situation, attention, pace, emotional weight, dealbreakers, runtime, discovery style, language | short runtime has one candidate; light emotional weight has one candidate |
| Relaxing | 11 | situation, pace, emotional weight, under two hours, runtime, discovery style, language | no immersive or heavy candidates; long runtime has no candidates |
| Emotional | 19 | situation, attention, pace, emotional weight, dealbreakers, runtime, discovery style, language | short runtime is small; most axes meaningfully change slate |
| Suspenseful | 14 | attention, pace, emotional weight, dealbreakers, runtime, discovery style, language | family and easy-watch have no candidates; slow runtime/pace edges are sparse |

## Axis Assessment

### Situation

Discrimination: High. Every mood pool has multiple situation distributions.

Slate impact: High. Situation changed the displayed three in 4/5 funny, 4/5 exciting, 4/5 thoughtful, 5/5 relaxing, 5/5 emotional, and 2/5 suspenseful options with candidates.

Pool impact: Moderate to high. It can narrow broad mood pools into a more recognizable viewing context.

Sparsity: Present. Suspenseful has no family/easy-watch candidates; exciting has only one date-night, family, and easy-watch candidate.

Redundancy: Some overlap with attention and emotional weight, but situation captures social context those axes do not.

### Attention Demand

Discrimination: Medium to high. Exciting, thoughtful, emotional, and suspenseful distribute well across engaged/immersive. Funny and relaxing skew easy/engaged and have no immersive options.

Slate impact: Medium. It changes the slate strongly when the selected mood has meaningful attention spread.

Pool impact: Moderate. It reorders soft preference matches rather than removing nonmatches.

Sparsity: Easy attention is sparse in exciting; immersive is absent in funny and relaxing.

Redundancy: Overlaps with pace/emotional weight, but it is easier for users to answer early.

### Pace

Discrimination: High except funny/exciting extremes. Thoughtful, relaxing, emotional, and suspenseful show meaningful variation.

Slate impact: High. Pace changes the slate for most non-empty values.

Pool impact: High because it is a practical filter.

Sparsity: Slow is absent in funny/exciting; slow suspenseful has one candidate.

Redundancy: Overlaps with attention demand but expresses a more concrete viewing preference.

### Emotional Weight

Discrimination: High in thoughtful/emotional/suspenseful/exciting; lower in funny/relaxing, where heavy is absent.

Slate impact: High where moods include multiple weights.

Pool impact: High because it is a practical filter and powers `avoidHeavy`.

Sparsity: Light thoughtful and light exciting each have one candidate; heavy is absent in funny and relaxing.

Redundancy: Overlaps with attention and some situations, but dealbreaker behavior makes it important to preserve.

### Strict Dealbreakers

Discrimination: Contextual.

Slate impact: `avoidHeavy` changes exciting, thoughtful, emotional, and suspenseful slates. `avoidSlow` changes thoughtful most clearly. `underTwoHours` changes most moods except funny and some relaxing/runtime-medium cases.

Pool impact: Moderate to high, especially under-two-hours and avoid-heavy.

Sparsity: Can reduce pools below three in already narrow combinations, but this is expected strict-boundary behavior.

Redundancy: They overlap with filters, but their "Not tonight" framing is more human and should remain prominent.

### Runtime

Discrimination: High.

Slate impact: High. Short, medium, and long buckets frequently change the visible slate.

Pool impact: High because runtime is a strict practical filter.

Sparsity: Short runtime is often fewer than three; long runtime is absent in relaxing and sparse in funny.

Redundancy: Under-two-hours overlaps with runtime, but runtime gives a more specific practical choice.

### Genre

Discrimination: High. Genre varies substantially within most mood pools.

Slate impact: High for specific genres, especially outside broad comedy/drama clusters.

Pool impact: High and sometimes severe.

Sparsity: Many genre + mood combinations produce one or two candidates.

Redundancy: Genre partially overlaps with mood but remains an expected practical filter.

### Language

Discrimination: Medium to high after the catalogue trial. English remains common, but Japanese, Korean, French, Mandarin, Telugu, German, Spanish, and Other / International create meaningful paths.

Slate impact: High when non-English languages are selected.

Pool impact: High because language is a strict practical filter.

Sparsity: Many non-English mood pools have one to three candidates.

Redundancy: Some overlap with discovery style, but language is a concrete viewing constraint.

### Discovery Style

Discrimination: High on paper and in slate ordering.

Slate impact: High. Every mood pool changed when familiar/different/adventurous was selected.

Pool impact: Soft reorder only; it does not remove nonmatching movies.

Sparsity: Not applicable as a strict pool reducer, though some styles have small counts inside a mood.

Redundancy: It overlaps with language, genre, and familiarity signals while being harder for users to answer before seeing movies. V5.2 should remove it from upfront controls and preserve it underneath for similarity, decision, and restored shared states.

## UI Implications For V5.2

Lead with mood and a concrete Glimpse. Then ask for situation, focus, and dealbreakers because they have strong slate impact and are easy to answer once movies are visible.

Place genre, language, runtime, pace, and emotional weight behind Get Specific. They are valuable and should not be removed, but several are sparse enough that presenting them too early can make the experience feel like configuration instead of discovery.

Do not expose discovery style as a first-pass control. The audit supports keeping it as underlying movie meaning rather than a prospective question.
