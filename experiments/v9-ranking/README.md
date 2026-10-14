# V9 personalized ranking MVP — bounded experiment

## Architecture
Movie Mood stays static (React / TypeScript / Vite, 180 committed curated films). The released recommendation path is mood → practical hard filters → situation-first fallback → hard dealbreakers → soft attention/discovery ranking → three picks.

**Opt-in For you** adds a *local content-based heuristic ranking* over the existing eligible recommendation pool using saved films in the existing browser-local My List. Genre frequencies of saved films form the preference vector; candidates receive cosine similarity scores. Exact situation matches remain ahead of fallback matches; all hard filters and dealbreakers still apply. No model is trained, no account, backend, new API, or user data transmission exists. Off by default. No favorites => released behavior. The two-stage path is: **(A) existing eligible movie generation; (B) optional content-based ranking**.

This is a controlled MVP, not collaborative filtering, online learning, production-scale recommender infrastructure or evidence of measured in-product lift. The online heuristic and independent benchmark use related genre cosine signals but are **not the same algorithm or dataset**; MovieLens results must not be attributed to the production Movie Mood catalogue.

## Benchmark (standalone, Python 3 standard library)

1. `python3 experiments/v9-ranking/benchmark.py --download` (downloads MovieLens 100K directly from GroupLens; network required once).
2. `python3 experiments/v9-ranking/benchmark.py` (completely offline thereafter).

Source: https://grouplens.org/datasets/movielens/100k/ (100,000 ratings, 943 users, 1,682 movies). Downloaded data is ignored and remains outside product/runtime code. Per-user chronological split by timestamp (oldest floor(80%) train, newest remaining 20% test; tie item ID); relevant = rating ≥ 4. Evaluate users with ≥1 positive train and ≥1 eligible positive held-out item, excluding previously seen movies and test-only new movies from rankings. Item popularity uses **only training ratings**. Movie genre flags are static public item metadata. Fixed candidate universe across methods: all items observed in training, excluding each user's training history. Positive rating popularity baseline uses log(1+positive count). Personalized candidate uses 70% cosine similarity of training positive genre profile and 30% normalized training popularity. Both rank all eligible unseen items, tie-breaking by item ID. Top K=10. Macro-average Recall@10 and binary NDCG@10 over eligible users; report exposure-based catalogue coverage. Parameters are declared upfront rather than tuned to test outcomes. No validation-driven model selection or hyperparameter tuning is claimed.

A preliminary independent calculation of this specification on a public MovieLens 100K mirror gave:
- 100,000 ratings: 79,619 train / 20,381 test.
- 907 eligible evaluation users.
- Popularity: Recall@10 **0.070946**, NDCG@10 **0.098337**.
- Content 70/30: Recall@10 **0.051960**, NDCG@10 **0.071948**.

**The personalized approach underperforms the baseline on this split.** These are preliminary observed values, not independently verified by executing this committed Python script in the target checkout. Reproduce locally before treating them as checked project evidence; benchmark reports its own computed values. Since a single fixed 70/30 mix was not tuned, do not claim learned optimality. The split can reflect historical popularity and strongly favor popularity; analyze, do not hide, that limitation.

## Verification and constraints
- Run `pnpm test:runtime`, `pnpm build`, `pnpm exec tsc -b` in the repository after syncing branch.
- Optionally `pnpm exec vitest run src/utils/personalizedRanking.test.ts`.
- No user-interaction logging; favorites remain browser local via the existing hook.
- Genre similarity captures one narrow taste dimension, not mood or semantic suitability; rankings are heuristic rather than fitted from Movie Mood feedback.
- The packet from earlier filter-semantics study is unrelated and is not a V9 gate.
- The Python benchmark does not establish Movie Mood's actual runtime recommendation quality. Evaluating the deployed feature would require an ethically collected, independently held-out user-interaction dataset.
- Cold start: original released order, with no forced new selections.

## Boundaries
No promotion to `main` or release by this branch. No V10 work. Resume evidence should state the true underperformance and the difference between a working heuristic feature and separately benchmarked methods. Do not claim empirical improvement or business impact.
