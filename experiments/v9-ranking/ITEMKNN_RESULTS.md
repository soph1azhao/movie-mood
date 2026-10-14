# V9 offline ItemKNN extension

## Frozen protocol (recorded before running the comparison)

This is a separate MovieLens 100K experiment, not a measurement of the 180-film Movie Mood runtime. The earlier `benchmark.py` and its per-user 80/20 results remain historical evidence; scores from that split are not directly comparable to scores here.

- Input: local GroupLens MovieLens 100K `u.data` (user, item, 1–5 rating, Unix timestamp). Positive means rating >= 4. No item metadata or test labels enter fitting.
- Split: sort all 100,000 interactions by `(timestamp, user ID, item ID)` and select the timestamps at the 70% and 85% positions. Every event at or before the first cutoff is train; events after it and at or before the second are validation; later events are test. Timestamp ties stay together. Assert `max(train time) < min(validation time)` and `max(validation time) < min(test time)`.
- Validation fits on train only. After selecting parameters on validation, test fits afresh on train + validation with the selected values. Test is evaluated once; no changes to the parameter grid or selection rule based on test scores.
- Warm items are items with *any rating* in the fitting period. Candidate set for a user is every warm item minus all items the user rated in the fitting period. The same set is ranked by all methods, including items with zero positive popularity. Test-only items are excluded. Relevant targets are positive target-period interactions in this candidate set. Eligible users have at least one positive fitting-period interaction and one relevant target item. All three methods use exactly these eligible users and candidate sets for each phase.
- A: popularity score `log1p(number of distinct positive fitting users) / log1p(maximum count)`. B: binary positive-history ItemKNN. Pair co-occurrence counts distinct training users; similarity `co_count / sqrt(item_count_i * item_count_j) * co_count / (co_count + shrinkage)`. Keep each item's top `neighbors` by `(descending similarity, ascending item ID)`. Candidate CF score is the sum of retained neighbor similarities from all of the user's positive historical items, divided by positive-history size, then normalized by that user's maximum candidate CF score. When all candidate CF scores are zero, B ranks by popularity. For any CF ties, B uses popularity, then item ID. C: `alpha * normalized CF + (1-alpha) * normalized popularity`, then item ID. All ranking is deterministic. Top 10 only.
- Validation grid: `neighbors in {20, 50}`, `shrinkage in {0, 20}`, and for C `alpha in {0.25, 0.50, 0.75}`. Select B and C independently by highest validation macro NDCG@10, then Recall@10, then the listed grid order. A has no parameters. No test-driven tuning.
- Metrics: per-user Recall@10 = relevant top-10 hits / number of relevant warm unseen positives; binary NDCG@10 uses `1/log2(rank+1)` gain and ideal DCG up to `min(10, relevant count)`. Macro-average over eligible users. Coverage@10 = distinct items displayed in all eligible users' top 10 / warm-item count. Report eligible users, relevant target interactions, warm-item count and excluded target positives. Error analysis counts per-user NDCG wins/losses/ties against A and users with no CF evidence.

## First execution and locked results

Input `u.data` SHA-256: `06416e597f82b7342361e41163890c81036900f418ad91315590814211dca490` (100,000 ratings, 943 users, 1,682 rated items). Global time cutoffs: `887039271` and `891036414`; 70,001 train / 14,999 validation / 15,000 test interactions. Timestamp ties explain the one-event deviation from 70,000/15,000/15,000.

Validation, with train-only fitting: 104 eligible users, 1,343 relevant warm unseen positives, 1,573 warm items, 101 excluded target positives. Validation NDCG@10 selected **ItemKNN (20 neighbors, 0 shrinkage)** from the four B configurations and **hybrid (50 neighbors, 0 shrinkage, 0.50 CF weight)** from the twelve C configurations. Their validation metrics, alongside A, were:

| Method | Recall@10 | NDCG@10 | Coverage@10 |
| --- | ---: | ---: | ---: |
| Popularity | 0.069743 | 0.123860 | 0.042594 |
| Selected ItemKNN | 0.072621 | 0.125224 | 0.094723 |
| Selected hybrid | 0.074433 | 0.128953 | 0.071837 |

All validation grid scores are printed by the reproduction command; only the above choices were carried to test. After refitting on train + validation, the **single locked test evaluation** used 75 eligible users, 1,249 relevant warm unseen positives, 1,628 warm items, and 59 excluded target positives:

| Method | Recall@10 | NDCG@10 | Coverage@10 |
| --- | ---: | ---: | ---: |
| Popularity | **0.111058** | **0.150902** | 0.046683 |
| ItemKNN (20, 0) | 0.074513 | 0.147481 | **0.085381** |
| Hybrid (50, 0, 0.50) | 0.069965 | 0.149710 | 0.074324 |

Neither collaborative method beat popularity on test relevance metrics. ItemKNN exposed about 8.54% of the warm catalogue versus popularity's 4.67%; the hybrid exposed 7.43%. These coverage differences represent recommendation diversity, not demonstrated user benefit.

### Error analysis and interpretation

Against popularity, ItemKNN had higher per-user NDCG for 24 users, lower for 20, and ties for 31; the hybrid had 21 higher, 20 lower, and 34 ties. Thus the macro metric loss is not a uniform per-user loss. None of the 75 eligible test users lacked CF similarity evidence in the candidate set, so the pure model's popularity fallback did not explain this result. Test eligible users had 3–375 positive historical items (median 74), 1–190 relevant target items (median 3), and 1,008–1,622 unseen warm candidates (median 1,495). The long tail of target counts and only 75 eligible users make the point estimates sensitive to the global time window and user activity. There were 226 unique users with any test-period rating, but the defined warm, unseen, positive-history eligibility reduces that to 75. Test-only new items and other ineligible target positives are excluded from every method equally.

A plausible explanation is that dense historical item co-occurrence retrieves narrower taste neighborhoods while popularity captures broadly popular future positives; validation's small gain did not transfer across the later global window. This is a hypothesis, not a causal finding. The larger coverage shows more distinct recommendations, but offline rating relevance cannot establish whether users would prefer them. Only one temporal split and one small grid were studied; there are no confidence intervals, repeated windows, implicit-feedback data, or in-product outcomes. MovieLens item IDs do not map to the curated Movie Mood catalogue, and this offline model is not integrated into the app.

### Reproduce

Use Python 3 standard library only. Keep the historical benchmark and ignored dataset in place. If the dataset is absent, run the historical `python3 experiments/v9-ranking/benchmark.py --download` once, then run:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 experiments/v9-ranking/itemknn.test.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/v9-ranking/itemknn.py
```

The script prints every validation configuration, the validation-selected pair, the locked test table, and per-user NDCG win/loss/tie counts. No dependency or runtime code changes are needed.
