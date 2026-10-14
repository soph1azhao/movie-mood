"""MovieLens 100K held-out recommendation benchmark. Python 3 standard library only.

Data is downloaded separately; no benchmark data ships to the browser.
Usage:
  python3 experiments/v9-ranking/benchmark.py --download
  python3 experiments/v9-ranking/benchmark.py
"""
import argparse
import csv
import io
import math
from collections import Counter, defaultdict
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
URL = "https://files.grouplens.org/datasets/movielens/ml-100k.zip"
K = 10


def download():
    DATA.mkdir(exist_ok=True)
    archive = DATA / "ml-100k.zip"
    if not archive.exists():
        with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as dest:
            import shutil
            shutil.copyfileobj(response, dest)
    with zipfile.ZipFile(archive) as z:
        for name in ("ml-100k/u.data", "ml-100k/u.item"):
            target = DATA / Path(name).name
            if not target.exists():
                target.write_bytes(z.read(name))
    print("Data source:", URL)


def load():
    if not (DATA / "u.data").exists() or not (DATA / "u.item").exists():
        raise SystemExit("Run with --download first (MovieLens 100K from GroupLens).")
    users = defaultdict(list)
    for line in (DATA / "u.data").read_text().splitlines():
        user, movie, rating, timestamp = map(int, line.split("\t"))
        users[user].append((movie, rating, timestamp))
    genres = {}
    for row in csv.reader(io.StringIO((DATA / "u.item").read_text(encoding="latin-1")), delimiter="|"):
        genres[int(row[0])] = tuple(int(x) for x in row[5:24])
    return users, genres


def evaluate():
    users, genres = load()
    train_by_user, test_by_user = {}, {}
    positive_counts = Counter()
    available = set()
    for user, rows in users.items():
        # Per-user chronological holdout: most recent 20%, never used during training.
        ordered = sorted(rows, key=lambda r: (r[2], r[0]))
        cut = max(1, math.floor(len(rows) * 0.8))
        train_by_user[user], test_by_user[user] = ordered[:cut], ordered[cut:]
        for movie, rating, _ in ordered[:cut]:
            available.add(movie)
            if rating >= 4:
                positive_counts[movie] += 1
    maximum = max(positive_counts.values())
    metrics = defaultdict(list)
    exposure = defaultdict(set)
    eligible_positive_count = 0
    for user, train in train_by_user.items():
        seen = {movie for movie, _, _ in train}
        positives = [movie for movie, rating, _ in train if rating >= 4]
        relevant = {movie for movie, rating, _ in test_by_user[user]
                    if rating >= 4 and movie in available and movie not in seen}
        if not positives or not relevant:
            continue
        profile = [0] * 19
        for movie in positives:
            for j, flag in enumerate(genres[movie]):
                profile[j] += flag
        norm = math.sqrt(sum(v * v for v in profile))
        if not norm:
            continue
        candidates = available - seen
        baseline = []
        personalized = []
        for movie in candidates:
            flags = genres[movie]
            m_norm = math.sqrt(sum(flags))
            cosine = (sum(a * b for a, b in zip(profile, flags)) / (norm * m_norm)) if m_norm else 0
            pop = math.log1p(positive_counts[movie]) / math.log1p(maximum)
            baseline.append((movie, pop))
            personalized.append((movie, 0.7 * cosine + 0.3 * pop))
        for name, scored in (("popularity", baseline), ("content_70_pop_30", personalized)):
            # Fixed, deterministic tie-breaking.
            top = [movie for movie, _ in sorted(scored, key=lambda row: (-row[1], row[0]))[:K]]
            exposure[name].update(top)
            hits = [int(movie in relevant) for movie in top]
            recall = sum(hits) / len(relevant)
            dcg = sum(hit / math.log2(rank + 2) for rank, hit in enumerate(hits))
            ideal = sum(1 / math.log2(rank + 2) for rank in range(min(K, len(relevant))))
            metrics[name].append((recall, dcg / ideal))
        eligible_positive_count += len(relevant)
    assert len(users) == 943
    assert sum(map(len, train_by_user.values())) + sum(map(len, test_by_user.values())) == 100000
    print(f"users={len(users)} ratings=100000 train={sum(map(len, train_by_user.values()))} test={sum(map(len, test_by_user.values()))}")
    print(f"eligible_evaluation_users={len(metrics['popularity'])} relevant_test_interactions={eligible_positive_count} candidates={len(available)}")
    for name in ("popularity", "content_70_pop_30"):
        values = metrics[name]
        print(f"{name}: Recall@10={sum(x for x, _ in values)/len(values):.6f} "
              f"NDCG@10={sum(y for _, y in values)/len(values):.6f} "
              f"coverage@10={len(exposure[name]) / len(available):.6f}")
    print("WARNING: content_70_pop_30 underperforms popularity on this split. No improvement claim.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        download()
    else:
        evaluate()
