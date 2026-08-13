import unittest

from app.engine import DataLoader, ElectoralEngine, generate_default_parties
from app.models.config import ElectoralConfig


class RealismFeatureTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.cd = cls.dl.get_city_data(2023)
        cls.parties = generate_default_parties()

    def _run(self, **kwargs):
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450, **kwargs)
        return ElectoralEngine(self.cd, self.parties, cfg, seed=42).run(), cfg

    def test_defaults_unchanged(self):
        """新真实感参数默认关闭时，结果与基线逐位一致（确定性）"""
        a, _ = self._run()
        b, _ = self._run()
        self.assertEqual([(p.party_id, p.seats) for p in a.party_results],
                         [(p.party_id, p.seats) for p in b.party_results])
        self.assertEqual(sum(p.seats for p in a.party_results), a.total_seats)

    def test_seat_sum_preserved_with_features(self):
        """开启全部真实感机制后，席位总数仍然守恒"""
        for kw in [
            dict(voter_stratification=True),
            dict(party_loyalty=0.3),
            dict(swing_voter_pct=0.3, abstention_sensitivity=0.5),
            dict(malapportionment=0.8),
            dict(calibration=True),
            dict(voter_stratification=True, party_loyalty=0.2, swing_voter_pct=0.2,
                 abstention_sensitivity=0.4, malapportionment=0.5, calibration=True),
        ]:
            r, cfg = self._run(**kw)
            self.assertEqual(sum(p.seats for p in r.party_results), cfg.total_seats,
                             msg=f'seat sum broken for {kw}')

    def test_party_effects_scandal_hurts_target(self):
        """候选人丑闻显著压低目标党席位"""
        base, _ = self._run()
        scandal, _ = self._run(party_effects={'P001': -0.3})
        base_seats = {p.party_id: p.seats for p in base.party_results}
        scandal_seats = {p.party_id: p.seats for p in scandal.party_results}
        self.assertLess(scandal_seats['P001'], base_seats['P001'])

    def test_malapportionment_boosts_small_cities(self):
        """选区不均衡：小城市/农业城市获得更多相对席位"""
        city = min(self.cd.cities, key=lambda c: c.population)
        big = max(self.cd.cities, key=lambda c: c.population)
        cfg = ElectoralConfig(system_type='PR', total_seats=450, malapportionment=0.8)
        eng = ElectoralEngine(self.cd, self.parties, cfg, seed=42)
        small_boost = eng._effective_population(city) / city.population
        big_boost = eng._effective_population(big) / big.population
        self.assertGreater(small_boost, 1.0)
        self.assertGreater(small_boost, big_boost)
        self.assertLess(small_boost, 1.0 + 0.8 * 2)

    def test_turnout_responds_to_competitiveness(self):
        """竞争越胶着，投票率越高（abstention_sensitivity 开启时）"""
        from app.engine.voter_model import VoterModel

        vm = VoterModel(seed=42)
        city = self.cd.cities[0]
        tight = vm.get_city_turnout(city, 1.0, competitiveness=0.95,
                                    abstention_sensitivity=0.5)
        blowout = vm.get_city_turnout(city, 1.0, competitiveness=0.05,
                                      abstention_sensitivity=0.5)
        self.assertGreater(tight, blowout)

    def test_loyalty_concentrates_votes(self):
        """政党忠诚提高城市基准政党份额（铁票党效应）"""
        from app.engine.voter_model import VoterModel

        vm_base = VoterModel(seed=42)
        city = self.cd.cities[0]
        anchor = vm_base._city_anchor_party(city, self.parties)
        base = vm_base.compute_vote_shares(city, self.parties, 0.03)

        vm_loyal = VoterModel(seed=42, party_loyalty=0.4)
        loyal = vm_loyal.compute_vote_shares(city, self.parties, 0.03)
        self.assertGreater(loyal[anchor], base[anchor])
        self.assertAlmostEqual(sum(loyal.values()), 1.0, places=4)

    def test_stratification_changes_shares(self):
        """开启城市内选民分层后，得票率变化但总和为 1"""
        from app.engine.voter_model import VoterModel

        vm_base = VoterModel(seed=42)
        city = self.cd.cities[0]
        base = vm_base.compute_vote_shares(city, self.parties, 0.03)
        vm_strat = VoterModel(seed=42, voter_stratification=True)
        strat = vm_strat.compute_vote_shares(city, self.parties, 0.03)
        self.assertAlmostEqual(sum(strat.values()), 1.0, places=4)
        self.assertTrue(any(abs(strat[p] - base[p]) > 0.005 for p in base))


if __name__ == '__main__':
    unittest.main()