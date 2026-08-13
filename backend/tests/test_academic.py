import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.routes import simulate_sensitivity
from app.engine import DataLoader, generate_default_parties, ElectoralEngine, CoalitionEngine
from app.models.config import ElectoralConfig, SensitivityRequest


def run(system_type, **overrides):
    cfg = ElectoralConfig(system_type=system_type, total_seats=450, **overrides)
    dl = DataLoader()
    return ElectoralEngine(dl.get_city_data(2023), generate_default_parties(), cfg, seed=42).run()


class TestAcademicIndices(unittest.TestCase):
    def test_indices_in_range(self):
        for st in ["FPTP", "PR", "MMP"]:
            res = run(st)
            self.assertGreaterEqual(res.loosemore_hanby, 0)
            self.assertLessEqual(res.rose_index, 1)
            self.assertGreaterEqual(res.malapportionment_index, 0)
            self.assertGreaterEqual(res.party_nationalization_index, 0)
            self.assertLessEqual(res.party_nationalization_index, 1)

    def test_pr_more_proportional_than_fptp(self):
        fptp = run("FPTP")
        pr = run("PR")
        self.assertLess(pr.loosemore_hanby, fptp.loosemore_hanby)
        self.assertGreater(pr.rose_index, fptp.rose_index)

    def test_power_indices_normalize(self):
        dl = DataLoader()
        parties = generate_default_parties()
        for st in ["FPTP", "PR"]:
            res = run(st)
            coal = CoalitionEngine(parties).find_coalitions(res)
            self.assertTrue(coal.power_indices)
            self.assertAlmostEqual(sum(p.banzhaf for p in coal.power_indices), 1.0, places=2)
            self.assertAlmostEqual(sum(p.shapley_shubik for p in coal.power_indices), 1.0, places=2)
            self.assertLessEqual(max(p.banzhaf for p in coal.power_indices), 1.0)

    def test_noise_amplitude_changes_results(self):
        a = run("PR", noise_amplitude=0.0)
        b = run("PR", noise_amplitude=0.2)
        seats_a = sorted(p.seats for p in a.party_results)
        seats_b = sorted(p.seats for p in b.party_results)
        self.assertNotEqual(seats_a, seats_b)

    def test_sensitivity_endpoint(self):
        parties = [p.model_dump() for p in generate_default_parties()]
        req = SensitivityRequest(
            year=2023,
            config=ElectoralConfig(system_type="PR", total_seats=450),
            parties=parties,
            delta=0.2,
            iterations=2,
            params=["threshold", "mixed_ratio", "noise_amplitude"],
        )
        resp = simulate_sensitivity(req)
        self.assertEqual(len(resp.points), 3)
        for p in resp.points:
            for snap in (p.low, p.baseline, p.high):
                self.assertGreaterEqual(snap.gallagher, 0)
                self.assertLessEqual(snap.majority_rate, 1)

    def test_turnout_shift_increases_votes(self):
        base = run("PR")
        covid = run("PR", turnout_shift=0.08)
        self.assertGreater(covid.total_votes, base.total_votes)
        self.assertAlmostEqual(covid.total_votes / base.total_votes, 1.08, delta=0.05)

    def test_dim_tilt_changes_outcome(self):
        base = run("PR")
        boom = run("PR", dim_tilt={"economic": 0.3, "environment": 0.2})
        seats_base = sorted(p.seats for p in base.party_results)
        seats_boom = sorted(p.seats for p in boom.party_results)
        self.assertNotEqual(seats_base, seats_boom)
        # 市场自由偏好上升后，经济偏右政党应获益
        p003 = next(p for p in base.party_results if p.party_id == "P003")  # 工人联合阵线 economic=-0.8
        p003b = next(p for p in boom.party_results if p.party_id == "P003")
        p001 = next(p for p in base.party_results if p.party_id == "P001")  # 沿海商业联盟 economic=0.7
        p001b = next(p for p in boom.party_results if p.party_id == "P001")
        self.assertGreaterEqual(p001b.seats, p001.seats)
        self.assertLessEqual(p003b.seats, p003.seats)

    def test_disprop_decomposition_fptp_mechanical_dominant(self):
        """FPTP 总偏差主要来自制度机制（胜者全得）"""
        res = run("FPTP")
        d = res.disproportionality_decomposition
        self.assertGreater(d.total, 0.05)
        self.assertGreater(d.mechanical, d.geographic)
        self.assertGreater(d.mechanical, d.malapportionment)

    def test_disprop_decomposition_pr_near_proportional(self):
        """PR 下总偏差极小，名额失衡分量最小（省席≈人口）"""
        res = run("PR")
        d = res.disproportionality_decomposition
        self.assertLess(d.total, 0.02)
        self.assertLess(d.malapportionment, d.geographic)

    def test_coalition_matrix_counts(self):
        dl = DataLoader()
        parties = generate_default_parties()
        for st in ["FPTP", "PR"]:
            res = run(st)
            cm = CoalitionEngine(parties).find_coalitions(res).coalition_matrix
            self.assertIsNotNone(cm)
            self.assertGreaterEqual(cm.total, 1)
            self.assertGreaterEqual(cm.minimal_count, 1)
            self.assertLessEqual(cm.minimal_count, cm.total)
            self.assertTrue(all(0 <= i.minimal_count <= i.total_count for i in cm.inclusion))

    def test_coalition_matrix_minimal_property(self):
        dl = DataLoader()
        parties = generate_default_parties()
        res = run("FPTP")
        cm = CoalitionEngine(parties).find_coalitions(res).coalition_matrix
        threshold = res.total_seats / 2
        for row in cm.rows:
            self.assertGreater(row.total_seats, threshold)
            if row.minimal:
                for pid in row.parties:
                    self.assertLessEqual(row.total_seats - next(r.seats for r in res.party_results if r.party_id == pid), threshold)


if __name__ == "__main__":
    unittest.main()
