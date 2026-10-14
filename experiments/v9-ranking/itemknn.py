"""Offline, globally chronological MovieLens 100K ItemKNN comparison.

Protocol and fixed selection grid: ITEMKNN_RESULTS.md. Python 3 standard library only.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from math import log1p, log2, sqrt
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "u.data"
TOP_N = 10
NEIGHBORS = (20, 50)
SHRINKAGES = (0, 20)
ALPHAS = (0.25, 0.50, 0.75)


@dataclass(frozen=True)
class Rating:
    user: int
    item: int
    score: int
    time: int


def load_ratings(path=DATA):
    if not path.exists():
        raise SystemExit(f"Missing {path}; download MovieLens 100K using the historical benchmark's --download option.")
    return [Rating(*map(int, line.split())) for line in path.read_text().splitlines()]


def chronological_split(rows):
    ordered = sorted(rows, key=lambda r: (r.time, r.user, r.item))
    first = ordered[int(len(ordered) * 0.70) - 1].time
    second = ordered[int(len(ordered) * 0.85) - 1].time
    train = [r for r in ordered if r.time <= first]
    validation = [r for r in ordered if first < r.time <= second]
    test = [r for r in ordered if r.time > second]
    assert train and validation and test
    assert max(r.time for r in train) < min(r.time for r in validation)
    assert max(r.time for r in validation) < min(r.time for r in test)
    return train, validation, test, first, second


@dataclass
class Fit:
    warm: set
    seen: dict
    positives: dict
    popularity: dict
    item_counts: Counter
    pair_counts: Counter


def fit(rows):
    warm = set()
    seen = defaultdict(set)
    positives = defaultdict(set)
    for r in rows:
        warm.add(r.item)
        seen[r.user].add(r.item)
        if r.score >= 4:
            positives[r.user].add(r.item)
    item_counts = Counter(item for items in positives.values() for item in items)
    pair_counts = Counter(pair for items in positives.values()
                          for pair in combinations(sorted(items), 2))
    peak = max(item_counts.values(), default=0)
    popularity = {item: log1p(item_counts[item]) / log1p(peak) if peak else 0.0
                  for item in warm}
    return Fit(warm, seen, positives, popularity, item_counts, pair_counts)


def neighbor_lists(model, neighbors, shrinkage):
    graph = defaultdict(list)
    for (left, right), count in model.pair_counts.items():
        score = count / sqrt(model.item_counts[left] * model.item_counts[right])
        score *= count / (count + shrinkage)
        graph[left].append((right, score))
        graph[right].append((left, score))
    return {item: sorted(edges, key=lambda pair: (-pair[1], pair[0]))[:neighbors]
            for item, edges in graph.items()}


def cf_scores(profile, candidates, graph):
    raw = defaultdict(float)
    for seed in profile:
        for item, similarity in graph.get(seed, ()):
            if item in candidates:
                raw[item] += similarity
    if not raw:
        return {}, False
    maximum = max(raw.values()) / len(profile)
    return {item: (score / len(profile)) / maximum for item, score in raw.items()}, True


def rank(candidates, popularity, cf=None, alpha=None):
    if cf is None or not cf:
        return sorted(candidates, key=lambda item: (-popularity[item], item))[:TOP_N]
    if alpha is None:
        return sorted(candidates, key=lambda item: (-cf.get(item, 0.0), -popularity[item], item))[:TOP_N]
    return sorted(candidates, key=lambda item: (-(alpha * cf.get(item, 0.0)
                                                  + (1 - alpha) * popularity[item]), item))[:TOP_N]


def target_cases(model, target):
    target_by_user = defaultdict(list)
    for row in target:
        target_by_user[row.user].append(row)
    cases = []
    excluded_positive = 0
    for user in sorted(target_by_user):
        seen = model.seen.get(user, set())
        candidates = model.warm - seen
        relevant = {row.item for row in target_by_user[user]
                    if row.score >= 4 and row.item in candidates}
        excluded_positive += sum(row.score >= 4 and row.item not in candidates
                                 for row in target_by_user[user])
        if model.positives.get(user) and relevant:
            cases.append((user, candidates, relevant))
    return cases, excluded_positive


def user_metrics(top, relevant):
    hits = sum(item in relevant for item in top)
    dcg = sum((item in relevant) / log2(position + 2)
              for position, item in enumerate(top))
    ideal = sum(1 / log2(position + 2)
                for position in range(min(TOP_N, len(relevant))))
    return hits / len(relevant), dcg / ideal


def evaluate(model, target, configs):
    cases, excluded = target_cases(model, target)
    graphs = {(n, s): neighbor_lists(model, n, s)
              for n, s in {(config[0], config[1]) for config in configs
                           if config != "popularity"}}
    metrics = {config: [] for config in configs}
    exposure = {config: set() for config in configs}
    no_evidence = {key: 0 for key in graphs}
    relevant_total = 0
    for user, candidates, relevant in cases:
        relevant_total += len(relevant)
        profile = model.positives[user]
        computed = {}
        for key, graph in graphs.items():
            computed[key], evidence = cf_scores(profile, candidates, graph)
            no_evidence[key] += not evidence
        for config in configs:
            if config == "popularity":
                top = rank(candidates, model.popularity)
            else:
                n, s, alpha = config
                top = rank(candidates, model.popularity, computed[(n, s)], alpha)
            exposure[config].update(top)
            metrics[config].append(user_metrics(top, relevant))
    summary = {}
    for config, values in metrics.items():
        summary[config] = (sum(x for x, _ in values) / len(values),
                           sum(y for _, y in values) / len(values),
                           len(exposure[config]) / len(model.warm))
    return summary, metrics, len(cases), relevant_total, excluded, len(model.warm), no_evidence


def choose(summary, configs):
    # max() preserves first-listed grid entry when NDCG and Recall are equal.
    return max(configs, key=lambda config: (summary[config][1], summary[config][0]))


def print_phase(label, result, configs):
    summary, _, users, relevant, excluded, warm, _ = result
    print(f"{label}: eligible_users={users} relevant_positives={relevant} "
          f"warm_items={warm} excluded_target_positives={excluded}")
    for config in configs:
        recall, ndcg, coverage = summary[config]
        print(f"  {config}: Recall@10={recall:.6f} NDCG@10={ndcg:.6f} "
              f"Coverage@10={coverage:.6f}")


def main():
    rows = load_ratings()
    assert len(rows) == 100000, "Expected the complete MovieLens 100K dataset"
    train, validation, test, first, second = chronological_split(rows)
    print(f"global_split: train={len(train)} validation={len(validation)} "
          f"test={len(test)} cutoffs={first},{second}")
    grid_b = [(n, s, None) for n in NEIGHBORS for s in SHRINKAGES]
    grid_c = [(n, s, a) for n in NEIGHBORS for s in SHRINKAGES for a in ALPHAS]
    validation_configs = ["popularity", *grid_b, *grid_c]
    train_model = fit(train)
    val = evaluate(train_model, validation, validation_configs)
    print_phase("validation", val, validation_configs)
    selected_b = choose(val[0], grid_b)
    selected_c = choose(val[0], grid_c)
    print(f"locked_selection: ItemKNN={selected_b} hybrid={selected_c}")
    # This is the only test evaluation. The grid and selections are now locked.
    final_model = fit(train + validation)
    test_configs = ["popularity", selected_b, selected_c]
    result = evaluate(final_model, test, test_configs)
    print_phase("test", result, test_configs)
    _, per_user, _, _, _, _, no_evidence = result
    baseline = per_user["popularity"]
    for config in (selected_b, selected_c):
        paired = per_user[config]
        wins = sum(b[1] > a[1] for a, b in zip(baseline, paired))
        losses = sum(b[1] < a[1] for a, b in zip(baseline, paired))
        ties = len(baseline) - wins - losses
        print(f"error_analysis {config}: user_NDCG_wins={wins} "
              f"losses={losses} ties={ties} no_CF_evidence={no_evidence[config[:2]]}")


if __name__ == "__main__":
    main()
