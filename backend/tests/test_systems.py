import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.engine import DataLoader, generate_default_parties, ElectoralEngine
from app.models.config import ElectoralConfig

MIXED = ["MMP", "PARALLEL"]
RANKED = ["IRV", "APPROVAL", "BORDA", "STV"]


def run(system_type, total_seats=450, seed=42, **overrides):
    cfg = ElectoralConfig(system_type=system_type, total_seats=total_seats, **overrides)
    dl = DataLoader()
    city_data = dl.get_city_data(2023)
    return ElectoralEngine(city_data, generate_default_parties(), cfg, seed=seed).run()


class TestNewSystems(unittest.TestCase):
    def test_all_systems_seat_sum(self):
        for st in ["FPTP", "RUNOFF", "PR", "MMP", "PARALLEL", "IRV", "APPROVAL", "BORDA", "STV"]:
            for seats in (100, 450, 500):
                res = run(st, seats)
                self.assertEqual(sum(p.seats for p in res.party_results), seats, st)
                self.assertEqual(len(res.party_results), 7, st)

    def test_deterministic(self):
        for st in ["MMP", "PARALLEL", "IRV", "STV", "APPROVAL", "BORDA"]:
            a = run(st, 450, seed=7)
            b = run(st, 450, seed=7)
            self.assertEqual([p.seats for p in a.party_results],
                             [p.seats for p in b.party_results], st)

    def test_seed_changes_ranked_outcomes(self):
        for st in ["IRV", "STV"]:
            a = run(st, 450, seed=1)
            b = run(st, 450, seed=2)
            self.assertNotEqual([p.seats for p in a.party_results],
                                [p.seats for p in b.party_results], st)

    def test_mixed_ratio_effect(self):
        low = run("MMP", 450, mixed_ratio=0.2)
        high = run("MMP", 450, mixed_ratio=0.8)
        self.assertLess(
            low.effective_parties_seats,
            high.effective_parties_seats + 0.01,
            "名单占比越高，比例性应越强（有效政党数越高）",
        )

    def test_threshold_blocks_small_parties(self):
        strict = run("PR", 450, threshold=0.15, allocation_method="d_hondt")
        loose = run("PR", 450, threshold=0.0, allocation_method="d_hondt")
        strict_zero = sum(1 for p in strict.party_results if p.seats == 0)
        loose_zero = sum(1 for p in loose.party_results if p.seats == 0)
        self.assertGreaterEqual(strict_zero, loose_zero)

    def test_largest_remainder_matches_total(self):
        res = run("PR", 450, allocation_method="largest_remainder")
        self.assertEqual(sum(p.seats for p in res.party_results), 450)

    def test_proportionality_of_pr(self):
        pr = run("PR", 450, allocation_method="d_hondt")
        fptp = run("FPTP", 450)
        self.assertLess(pr.gallagher_index, fptp.gallagher_index,
                        "PR 的 Gallagher 指数应显著低于 FPTP")


if __name__ == "__main__":
    unittest.main()
