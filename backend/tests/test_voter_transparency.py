import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.responses import JSONResponse

from app.api.routes import explain_voter_model, simulate_robustness, voter_structure
from app.engine import generate_default_parties
from app.models.config import ElectoralConfig, RobustnessRequest, VoterExplainRequest, VoterStructureRequest


def make_robustness_request(iterations=10):
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


def make_explain_request(city_id="110000"):
    return VoterExplainRequest(
        year=2023,
        city_id=city_id,
        config=ElectoralConfig(
            system_type="FPTP",
            total_seats=450,
            threshold=0.0,
            allocation_method="d_hondt",
            min_seats_per_city=1,
        ),
        parties=generate_default_parties(),
    )


class TestVoterExplain(unittest.TestCase):
    def test_returns_city_position_dimensions(self):
        resp = explain_voter_model(make_explain_request())
        self.assertEqual(resp.city_id, "110000")
        self.assertEqual(len(resp.city_position), 7)
        for dim in resp.city_position:
            self.assertTrue(-1.0 <= dim.value <= 1.0)
            self.assertTrue(dim.key and dim.label)

    def test_returns_all_parties_with_valid_shares(self):
        resp = explain_voter_model(make_explain_request())
        self.assertEqual(len(resp.parties), 7)
        total = sum(p.vote_share for p in resp.parties)
        self.assertAlmostEqual(total, 1.0, places=3)
        for p in resp.parties:
            self.assertGreaterEqual(p.vote_share, 0.0)
            self.assertLessEqual(p.vote_share, 1.0)
            self.assertGreaterEqual(p.weighted_affinity, 0.0)
            self.assertIsNotNone(p.affinity)

    def test_unknown_city_returns_404(self):
        resp = explain_voter_model(make_explain_request(city_id="999999"))
        self.assertIsInstance(resp, JSONResponse)
        self.assertEqual(resp.status_code, 404)


def make_structure_request(scope="全国"):
    return VoterStructureRequest(
        year=2023,
        scope=scope,
        config=ElectoralConfig(
            system_type="PR",
            total_seats=450,
            threshold=0.03,
            allocation_method="d_hondt",
            min_seats_per_city=1,
            noise_amplitude=0.03,
        ),
        parties=generate_default_parties(),
    )


class TestVoterStructure(unittest.TestCase):
    def test_returns_all_dimensions_and_groups(self):
        resp = voter_structure(make_structure_request())
        self.assertEqual(resp['scope'], '全国')
        self.assertEqual(resp['city_count'], 350)
        self.assertEqual(set(resp['dimensions'].keys()),
                         {'age', 'education', 'urban_rural', 'income'})
        for dim_key, dim in resp['dimensions'].items():
            self.assertEqual(len(dim['groups']), 2)
            for g in dim['groups']:
                self.assertGreater(g['weight'], 0)
                shares = g['shares']
                self.assertAlmostEqual(sum(shares.values()), 1.0, places=2)
                self.assertIn(g['winner'], shares)

    def test_overall_matches_engine_party_results(self):
        resp = voter_structure(make_structure_request())
        overall = resp['overall']
        self.assertAlmostEqual(sum(overall.values()), 1.0, places=2)
        winner_id = resp['winner']['party_id']
        self.assertEqual(winner_id, max(overall, key=lambda k: overall[k]))

    def test_province_scope(self):
        resp = voter_structure(make_structure_request(scope="广东省"))
        self.assertEqual(resp['scope'], '广东省')
        self.assertGreater(resp['city_count'], 0)
        self.assertLess(resp['city_count'], 350)


class TestRobustnessUncertainty(unittest.TestCase):
    def test_returns_province_and_city_uncertainty(self):
        resp = simulate_robustness(make_robustness_request())
        self.assertGreaterEqual(len(resp.province_uncertainty), 30)
        self.assertEqual(len(resp.city_uncertainty), 350)
        for u in resp.province_uncertainty:
            self.assertGreaterEqual(u.win_rate, 0.0)
            self.assertLessEqual(u.win_rate, 1.0)
            self.assertGreaterEqual(u.iter_count, 0)
            self.assertTrue(u.province_name)
        for u in resp.city_uncertainty:
            self.assertGreaterEqual(u.win_rate, 0.0)
            self.assertLessEqual(u.win_rate, 1.0)
            self.assertTrue(u.city_id)

    def test_uncertainty_win_rate_bounds_match_iterations(self):
        resp = simulate_robustness(make_robustness_request(iterations=10))
        for u in resp.province_uncertainty:
            self.assertLessEqual(u.iter_count, 10)
        for u in resp.city_uncertainty:
            self.assertLessEqual(u.iter_count, 10)


if __name__ == "__main__":
    unittest.main()