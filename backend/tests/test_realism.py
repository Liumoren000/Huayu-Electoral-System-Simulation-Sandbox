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

    def test_tactical_voting_preserves_seats(self):
        """弃保开启后 FPTP 席位总数守恒"""
        r, cfg = self._run(tactical_voting=0.6)
        self.assertEqual(sum(p.seats for p in r.party_results), cfg.total_seats)
        self.assertAlmostEqual(sum(p.vote_share for p in r.party_results), 1.0, places=3)

    def test_tactical_voting_squeezes_minor_parties_fptp(self):
        """弃保效应（Duverger）：FPTP 下弱势政党被挤压，前两大党份额上升"""
        base, _ = self._run()
        tactical, _ = self._run(tactical_voting=0.8)
        base_shares = sorted((p.vote_share for p in base.party_results), reverse=True)
        tact_shares = sorted((p.vote_share for p in tactical.party_results), reverse=True)
        # 前两名（可赢集合）份额上升
        self.assertGreater(tact_shares[0] + tact_shares[1], base_shares[0] + base_shares[1])
        # 最末党被挤压
        self.assertLess(tact_shares[-1], base_shares[-1])

    def test_tactical_voting_does_not_affect_pr_list_votes(self):
        """比例代表制下名单席位反映真实偏好，弃保不应改变 PR 总得票"""
        def run_pr(tv):
            cfg = ElectoralConfig(system_type='PR', total_seats=450, tactical_voting=tv)
            eng = ElectoralEngine(self.cd, self.parties, cfg, seed=42)
            r = eng.run()
            return {p.party_id: p.vote_share for p in r.party_results}
        no_tv = run_pr(0.0)
        with_tv = run_pr(0.8)
        for pid in no_tv:
            self.assertAlmostEqual(with_tv[pid], no_tv[pid], places=6)

    def test_tactical_voting_weakens_under_runoff(self):
        """两轮制首轮弃保压力弱于小选区制：RUNOFF 得票挤压程度 ≤ FPTP"""
        def run(sys, tv):
            cfg = ElectoralConfig(system_type=sys, total_seats=450, tactical_voting=tv)
            eng = ElectoralEngine(self.cd, self.parties, cfg, seed=42)
            r = eng.run()
            return sorted((p.vote_share for p in r.party_results), reverse=True)
        fptp_base, fptp_tac = run('FPTP', 0.0), run('FPTP', 0.8)
        runoff_base, runoff_tac = run('RUNOFF', 0.0), run('RUNOFF', 0.8)
        squeeze_fptp = (fptp_tac[0] + fptp_tac[1]) - (fptp_base[0] + fptp_base[1])
        squeeze_runoff = (runoff_tac[0] + runoff_tac[1]) - (runoff_base[0] + runoff_base[1])
        self.assertGreater(squeeze_fptp, 0)
        self.assertGreaterEqual(squeeze_fptp, squeeze_runoff)

    def test_turnout_differential_preserves_seats(self):
        """群体差异化投票率开启后席位总数守恒"""
        r, cfg = self._run(turnout_differential=0.8)
        self.assertEqual(sum(p.seats for p in r.party_results), cfg.total_seats)
        self.assertAlmostEqual(sum(p.vote_share for p in r.party_results), 1.0, places=3)

    def test_turnout_differential_raises_elderly_city(self):
        """老龄化高的城市投票率上升、年轻城市下降（差异化开启时）"""
        from app.engine.voter_model import VoterModel
        elder = max(self.cd.cities, key=lambda c: c.aging_rate)
        young = min(self.cd.cities, key=lambda c: c.aging_rate)

        vm_off = VoterModel(seed=42)
        vm_on = VoterModel(seed=42, turnout_differential=1.0)

        elder_off = vm_off.get_city_turnout(elder, 1.0)
        elder_on = vm_on.get_city_turnout(elder, 1.0)
        young_off = vm_off.get_city_turnout(young, 1.0)
        young_on = vm_on.get_city_turnout(young, 1.0)

        self.assertGreater(elder_on, elder_off)   # 老年城市投票率升
        self.assertLess(young_on, young_off)       # 年轻城市投票率降
        self.assertGreater(elder_on, young_on)      # 老年城市 > 年轻城市

    def test_turnout_differential_zero_is_noop(self):
        """turnout_differential=0 时投票率与默认完全一致（确定性）"""
        from app.engine.voter_model import VoterModel
        vm_a = VoterModel(seed=42)
        vm_b = VoterModel(seed=42, turnout_differential=0.0)
        for city in self.cd.cities[:5]:
            self.assertEqual(vm_a.get_city_turnout(city, 1.0),
                             vm_b.get_city_turnout(city, 1.0))

    def test_turnout_income_weight_covers_range(self):
        """收入维度的差异化权重随 GDP 平滑分布，而非贴地板（修复固定阈值 bug）"""
        from app.engine.voter_model import VoterModel
        vm = VoterModel(seed=42, turnout_differential=1.0)
        weights = []
        for city in self.cd.cities:
            w = vm._group_turnout_weights(city)
            self.assertAlmostEqual(w['high_income'] + w['low_income'], 1.0, places=6)
            weights.append(w['high_income'])
        low = sum(1 for w in weights if w < 0.2)
        # 绝大多数城市的高收入占比不应被压到地板（修复前 94/350 贴地板）
        self.assertLess(low, 20)
        self.assertGreater(max(weights), 0.7)
        self.assertLess(min(weights), 0.15)

    def test_affinity_power_concentrates_vote_shares(self):
        """得票率浓缩：affinity_power 放大政党间差距，避免全国得票率趋近 1/N"""
        flat, _ = self._run(affinity_power=1.0)
        concentrated, _ = self._run(affinity_power=5.0)
        flat_shares = sorted((p.vote_share for p in flat.party_results), reverse=True)
        conc_shares = sorted((p.vote_share for p in concentrated.party_results), reverse=True)
        # 浓缩后首末党差距更大
        flat_span = flat_shares[0] - flat_shares[-1]
        conc_span = conc_shares[0] - conc_shares[-1]
        self.assertGreater(conc_span, flat_span)
        # 全国首党份额应更高（贴近现实多党制 20%+）
        self.assertGreater(conc_shares[0], flat_shares[0])
        self.assertAlmostEqual(sum(conc_shares), 1.0, places=3)

    def test_affinity_power_default_is_realistic(self):
        """默认 affinity_power=4 下全国首党得票率应显著高于 1/N"""
        r, cfg = self._run()
        top = max(p.vote_share for p in r.party_results)
        self.assertGreater(top, 0.19)
        self.assertLess(top, 0.45)

    def test_tactical_voting_camp_aware(self):
        """弃保转投应主要流向同阵营，跨阵营仅折半"""
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450, tactical_voting=1.0)
        eng = ElectoralEngine(self.cd, self.parties, cfg, seed=42)
        r = eng.run()
        self.assertEqual(sum(p.seats for p in r.party_results), cfg.total_seats)
        self.assertAlmostEqual(sum(p.vote_share for p in r.party_results), 1.0, places=3)

    def test_turnout_base_raised(self):
        """基准投票率应贴近现实东亚水平，且群体差异化开启后保留区域差异"""
        from app.engine.voter_model import VoterModel
        import statistics
        vm0 = VoterModel(seed=42)
        vm1 = VoterModel(seed=42, turnout_differential=1.0)
        off = [vm0.get_city_turnout(c, 1.0) for c in self.cd.cities]
        on = [vm1.get_city_turnout(c, 1.0) for c in self.cd.cities]
        self.assertGreater(statistics.mean(off), 0.60)
        coastal = [c for c in self.cd.cities if c.region_type == 'coastal']
        western = [c for c in self.cd.cities if c.region_type == 'western']
        m_c = statistics.mean(vm1.get_city_turnout(c, 1.0) for c in coastal)
        m_w = statistics.mean(vm1.get_city_turnout(c, 1.0) for c in western)
        # 差异化开启后沿海-西部投票率差异仍保留（>5pp），而非塌缩
        self.assertGreater(m_c - m_w, 0.05)


if __name__ == '__main__':
    unittest.main()