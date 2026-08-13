import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.routes import simulate_robustness
from app.engine import generate_default_parties
from app.models.config import ElectoralConfig, RobustnessRequest


def make_request(iterations=30):
    return RobustnessRequest(
        year=2023,
        iterations=iterations,
        config=ElectoralConfig(
            system_type="PR",
            total_seats=450,
            threshold=0.05,
            allocation_method="d_hondt",
            min_seats_per_city=1,
        ),
        parties=generate_default_parties(),
    )


class TestRobustness(unittest.TestCase):
    def test_returns_all_parties_and_expected_lengths(self):
        resp = simulate_robustness(make_request())
        self.assertEqual(resp.summary.iterations, 30)
        self.assertEqual(len(resp.party_rows), 7)
        self.assertEqual(len(resp.series), 30 * 7)

    def test_party_row_bounds(self):
        resp = simulate_robustness(make_request(iterations=20))
        for row in resp.party_rows:
            self.assertGreaterEqual(row.min_seats, 0)
            self.assertLessEqual(row.min_seats, row.max_seats)
            self.assertGreaterEqual(row.avg_seats, row.min_seats - 1e-9)
            self.assertLessEqual(row.avg_seats, row.max_seats + 1e-9)
            self.assertGreaterEqual(row.median_seats, row.min_seats - 1e-9)
            self.assertLessEqual(row.median_seats, row.max_seats + 1e-9)
            self.assertLessEqual(row.win_count, 20)
            self.assertLessEqual(row.majority_count, 20)

    def test_summary_ranges(self):
        resp = simulate_robustness(make_request(iterations=30))
        self.assertGreaterEqual(resp.summary.majority_rate, 0.0)
        self.assertLessEqual(resp.summary.majority_rate, 1.0)
        self.assertGreater(resp.summary.avg_effective_parties_seats, 0.0)
        self.assertGreaterEqual(resp.summary.avg_gallagher, 0.0)
        self.assertGreater(resp.summary.avg_largest_party_seats, 0.0)

    def test_deterministic_seeds(self):
        a = simulate_robustness(make_request())
        b = simulate_robustness(make_request())
        self.assertEqual([r.model_dump() for r in a.party_rows],
                         [r.model_dump() for r in b.party_rows])
        self.assertEqual(a.summary.majority_rate, b.summary.majority_rate)

    def test_iterations_respects_request(self):
        resp = simulate_robustness(make_request(iterations=5))
        self.assertEqual(resp.summary.iterations, 5)
        self.assertEqual(len(resp.series), 5 * 7)


if __name__ == "__main__":
    unittest.main()
