"""Synthetic checks for the offline temporal ItemKNN benchmark."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("itemknn", Path(__file__).with_name("itemknn.py"))
itemknn = importlib.util.module_from_spec(SPEC)
import sys
sys.modules[SPEC.name] = itemknn
SPEC.loader.exec_module(itemknn)
R = itemknn.Rating


class BenchmarkChecks(unittest.TestCase):
    def test_global_time_boundaries_keep_ties_together(self):
        rows = [R(i, i, 4, i) for i in range(1, 101)]
        rows[70] = R(71, 71, 4, 70)
        train, validation, test, first, second = itemknn.chronological_split(rows)
        self.assertEqual(first, 70)
        self.assertTrue(all(r.time <= first for r in train))
        self.assertTrue(all(first < r.time <= second for r in validation))
        self.assertTrue(all(r.time > second for r in test))
        self.assertEqual(sum(map(len, (train, validation, test))), 100)

    def test_fit_uses_only_supplied_history_and_positive_ratings(self):
        model = itemknn.fit([R(1, 1, 5, 1), R(1, 2, 4, 2),
                             R(2, 1, 4, 3), R(2, 2, 2, 4), R(3, 3, 5, 5)])
        self.assertEqual(model.item_counts[1], 2)
        self.assertEqual(model.item_counts[2], 1)
        self.assertEqual(model.pair_counts[(1, 2)], 1)
        self.assertEqual(model.pair_counts[(1, 3)], 0)
        self.assertEqual(itemknn.neighbor_lists(model, 20, 0)[1][0][0], 2)

    def test_common_candidates_and_cold_start_fallback(self):
        model = itemknn.fit([R(1, 1, 5, 1), R(2, 2, 4, 1),
                             R(3, 3, 2, 1)])
        cases, excluded = itemknn.target_cases(model, [R(1, 2, 5, 2),
                                                        R(1, 4, 5, 2)])
        self.assertEqual(cases, [(1, {2, 3}, {2})])
        self.assertEqual(excluded, 1)
        self.assertEqual(itemknn.rank(cases[0][1], model.popularity, {}), [2, 3])

    def test_metrics_and_tie_order(self):
        self.assertEqual(itemknn.rank({3, 2, 1}, {1: 0, 2: 0, 3: 0}), [1, 2, 3])
        recall, ndcg = itemknn.user_metrics([1, 2], {1, 2})
        self.assertEqual((recall, ndcg), (1.0, 1.0))
        recall, ndcg = itemknn.user_metrics([2, 1], {1})
        self.assertEqual(recall, 1.0)
        self.assertAlmostEqual(ndcg, 1 / itemknn.log2(3))


if __name__ == "__main__":
    unittest.main()
