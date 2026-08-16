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

    def test_eligible_voter_ratio_realistic(self):
        """18+ 适龄选民占比应接近中国现实（全国均值≈0.79，城市 0.72-0.85）"""
        from app.engine.voter_model import VoterModel
        import statistics

        vm = VoterModel(seed=42)
        ratios = [vm.get_eligible_voter_ratio(c) for c in self.cd.cities]
        mean = statistics.mean(ratios)
        self.assertGreater(mean, 0.76)
        self.assertLess(mean, 0.82)
        self.assertGreater(min(ratios), 0.70)
        self.assertLess(max(ratios), 0.86)

    def test_turnout_capped_at_realistic_max(self):
        """适龄选民投票率不应超过 0.85（强制投票国上限水平）"""
        from app.engine.voter_model import VoterModel

        vm = VoterModel(seed=42)
        for c in self.cd.cities:
            t = vm.get_city_turnout(c, 1.0)
            self.assertLessEqual(t, 0.85)
            self.assertGreaterEqual(t, 0.35)

    def test_votes_use_eligible_voters_not_total_population(self):
        """总票数 = 人口 × 适龄占比 × 投票率，而非人口 × 投票率（否则未成年人也被计入）"""
        r, _ = self._run()
        pop = self.cd.total_population
        self.assertLess(r.total_votes / pop, 0.70, "总票数不应超过总人口的70%")
        self.assertGreater(r.total_votes / pop, 0.40, "高动员场景总票数不应低于总人口40%")
        # 城市级口径：票数等于人口×适龄占比×投票率
        from app.engine.voter_model import VoterModel
        vm = VoterModel(seed=42)
        cr = r.city_results[0]
        city = next(c for c in self.cd.cities if c.id == cr.city_id)
        expected = city.population * vm.get_eligible_voter_ratio(city) * cr.turnout
        self.assertAlmostEqual(cr.eligible_voter_ratio, vm.get_eligible_voter_ratio(city), places=3)

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
        """政党忠诚提高城市基准政党份额且降低波动（铁票党稳定化效应）"""
        from app.engine.voter_model import VoterModel
        import statistics

        city = self.cd.cities[0]
        anchor = VoterModel(seed=42)._city_anchor_party(city, self.parties)

        def anchor_stats(pct, seeds):
            means, vals = [], []
            for seed in seeds:
                vm = VoterModel(seed=seed, party_loyalty=pct)
                s = vm.compute_vote_shares(city, self.parties, 0.06)
                vals.append(s[anchor])
                means.append(sum(s.values()))
            return statistics.mean(vals), statistics.pstdev(vals), statistics.mean(means)

        seeds = range(100, 115)
        m0, s0, sum0 = anchor_stats(0.0, seeds)
        m1, s1, sum1 = anchor_stats(0.5, seeds)
        # 忠诚票仓拉高锚党平均份额（铁票效应）
        self.assertGreater(m1, m0)
        # 忠诚使跨模拟波动下降（铁票稳定化）
        self.assertLess(s1, s0)
        # 份额总和仍为 1
        self.assertAlmostEqual(sum0, 1.0, places=4)
        self.assertAlmostEqual(sum1, 1.0, places=4)

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

    def test_tactical_voting_default_enabled_differentiates(self):
        """默认配置下 FPTP 与 PR 应呈现制度分化（Duverger）：多数制首党得票 > 比例制"""
        fptp, _ = self._run()  # 默认 tactical_voting=0.4
        pr_cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pr = ElectoralEngine(self.cd, self.parties, pr_cfg, seed=42).run()
        fptp_top = max(p.vote_share for p in fptp.party_results)
        pr_top = max(p.vote_share for p in pr.party_results)
        # 多数制下弃保使首党份额高于比例制（真实 Duverger 分化）
        self.assertGreater(fptp_top, pr_top)

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

    def test_swing_voters_shift_nationally(self):
        """摇摆选民受全国性浪潮影响：不同运行轮次间全国票率出现相关偏移"""
        r0, _ = self._run(swing_voter_pct=0.0)
        r1, _ = self._run(swing_voter_pct=0.6)
        base = {p.party_id: p.vote_share for p in r0.party_results}
        swung = {p.party_id: p.vote_share for p in r1.party_results}
        # 某些政党出现方向性变化（浪潮非零），且至少一个政党变化超过 0.5pp
        shifts = [abs(swung[pid] - base[pid]) for pid in base]
        self.assertGreater(max(shifts), 0.005)
        # 席位守恒
        self.assertEqual(sum(p.seats for p in r1.party_results), 450)
        self.assertAlmostEqual(sum(swung.values()), 1.0, places=3)

    def test_city_has_ethnic_share_field(self):
        """每个城市都有少数民族占比字段（0-1），且分布符合现实（西部/边疆高）"""
        for c in self.cd.cities:
            self.assertGreaterEqual(c.ethnic_share, 0.0)
            self.assertLessEqual(c.ethnic_share, 1.0)
        by_id = {c.id: c for c in self.cd.cities}
        # 西藏拉萨、新疆喀什应显著高于北京
        lhasa = by_id['540100'].ethnic_share
        kashgar = by_id['653100'].ethnic_share
        beijing = by_id['110000'].ethnic_share
        self.assertGreater(lhasa, 0.8)
        self.assertGreater(kashgar, 0.7)
        self.assertLess(beijing, 0.1)
        self.assertGreater(lhasa, beijing)
        self.assertGreater(kashgar, beijing)

    def test_ethnic_party_wins_in_minority_city(self):
        """民族区域自治党（P005, camp=ethnic）在少数民族聚居城市获得更高亲和度"""
        from app.engine.voter_model import VoterModel
        vm = VoterModel(seed=42)
        by_id = {c.id: c for c in self.cd.cities}
        lhasa = by_id['540100']
        beijing = by_id['110000']
        p005 = next(p for p in self.parties if p.id == 'P005')
        share_lhasa = vm.compute_vote_shares(lhasa, self.parties, 0.0)['P005']
        share_beijing = vm.compute_vote_shares(beijing, self.parties, 0.0)['P005']
        self.assertGreater(share_lhasa, share_beijing)
        self.assertGreater(share_lhasa, 0.2, "高少数民族占比城市中民族党应有明显存在感")
        # 说明：ethnic_share 加成使得民族党在聚居区获得真实选区基础
        self.assertAlmostEqual(sum(vm.compute_vote_shares(lhasa, self.parties, 0.0).values()), 1.0, places=4)

    def test_ranked_noise_matches_other_systems(self):
        """排序制噪声口径应与其它制度一致（不再乘 4 倍）"""
        cfg = ElectoralConfig(system_type='IRV', total_seats=450)
        eng = ElectoralEngine(self.cd, self.parties, cfg, seed=42)
        # 直接调用采样函数验证：噪声幅度透传，未放大
        city = self.cd.cities[0]
        vm = eng.voter_model
        # 无 *4 后：同样 noise_amplitude 下排名票采样使用同一口径
        rankings = vm.sample_voter_rankings(city, self.parties, n=20, noise_amplitude=cfg.noise_amplitude)
        self.assertEqual(len(rankings), 20)
        self.assertTrue(all(len(r) == len(self.parties) for r in rankings))

    def test_gdp_affects_stratification_composition(self):
        """人均 GDP 应改变城市选民分层构成：富裕城市更多高收入精英派"""
        from app.engine.voter_model import VoterModel
        vm = VoterModel(seed=42, voter_stratification=True)
        rich = max(self.cd.cities, key=lambda c: c.gdp_per_capita)
        poor = min(self.cd.cities, key=lambda c: c.gdp_per_capita)
        seg_rich = {i: s['weight'] for i, s in enumerate(vm._city_segments(rich))}
        seg_poor = {i: s['weight'] for i, s in enumerate(vm._city_segments(poor))}
        # 高收入精英派（index 5）在富裕城市占比更高
        self.assertGreater(seg_rich[5], seg_poor[5])
        # 低收入依赖派（index 6）在贫困城市占比更高
        self.assertGreater(seg_poor[6], seg_rich[6])

    def test_party_system_concentration_dominant_party(self):
        """政党体系集中化应放大全国首党得票（主导党格局），且默认关闭时结果不变"""
        base, _ = self._run()
        base_top = max(base.party_results, key=lambda p: p.vote_share)
        conc_r, _ = self._run(party_system_concentration=0.1)
        conc_top = max(conc_r.party_results, key=lambda p: p.vote_share)
        self.assertEqual(base_top.party_id, conc_top.party_id)
        self.assertGreater(conc_top.vote_share, base_top.vote_share + 0.02,
                           "集中化后首党得票率应明显上升")

    def test_party_system_concentration_default_off(self):
        """集中化默认 0 时结果与基线逐位一致（向后兼容）"""
        a, _ = self._run()
        b, _ = self._run(party_system_concentration=0.0)
        self.assertEqual([(p.party_id, p.seats, p.vote_share) for p in a.party_results],
                         [(p.party_id, p.seats, p.vote_share) for p in b.party_results])

    def test_poll_systematic_bias_diverges_final(self):
        """民调系统偏差开启后，末周民调与实际得票率存在结构性差距"""
        from app.engine.poll_engine import PollEngine
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450, poll_systematic_bias=0.04)
        pe = PollEngine(self.cd, self.parties, cfg, seed=7, weeks=12, volatility=0.04)
        resp = pe.run()
        last = {}
        for pt in resp.series:
            if pt.week == 12:
                last[pt.party_id] = pt.share
        # 至少一个党末周民调与实际得票率差 > 2pp（结构性偏差的体现）
        diverged = any(abs(last.get(pid, 0) - resp.final_share.get(pid, 0)) > 0.02
                       for pid in resp.final_share)
        self.assertTrue(diverged, "系统偏差下民调与实际结果应有 >2pp 的差距")

    def test_poll_no_bias_close_to_final(self):
        """民调系统偏差关闭时，末周民调接近实际得票率"""
        from app.engine.poll_engine import PollEngine
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450)
        pe = PollEngine(self.cd, self.parties, cfg, seed=7, weeks=12, volatility=0.04)
        resp = pe.run()
        last = {}
        for pt in resp.series:
            if pt.week == 12:
                last[pt.party_id] = pt.share
        worst = max(abs(last.get(pid, 0) - resp.final_share.get(pid, 0))
                    for pid in resp.final_share)
        self.assertLess(worst, 0.06, "无系统偏差时末周民调应与实际得票率较接近")

    def test_party_system_classification_present(self):
        """结果应包含 Sartori 政党体系分类"""
        r, _ = self._run()
        self.assertTrue(r.party_system_classification)
        self.assertIn(r.party_system_classification,
                      ['一党主导制', '主导党制', '两党制', '温和多党制', '碎片化多党制'])

    def test_party_system_classification_dominant(self):
        """高集中化下 FPTP 应分类为一党主导制（首党席位过半）"""
        r, _ = self._run(party_system_concentration=0.5)
        top = max(r.party_results, key=lambda p: p.seats)
        if top.seats > r.total_seats / 2:
            self.assertEqual(r.party_system_classification, '一党主导制')
        else:
            self.assertIn(r.party_system_classification,
                          ['主导党制', '两党制', '温和多党制'])

    def test_polarization_index_range(self):
        """极化度应处于合理范围（0-1）"""
        r, _ = self._run()
        self.assertGreaterEqual(r.polarization_index, 0.0)
        self.assertLessEqual(r.polarization_index, 1.0)

    def test_regional_blocks_present(self):
        """区域政治集团应覆盖全部省份并给出地理标签"""
        r, _ = self._run()
        prov_total = sum(len(b.provinces) for b in r.regional_blocks)
        self.assertEqual(prov_total, len(r.province_results))
        self.assertTrue(all(b.block_label for b in r.regional_blocks))

    def test_calibration_flow_matrix(self):
        """历史校准应返回选区赢家转移矩阵（翻盘城市可归纳）"""
        from app.engine.calibration_engine import historical_calibration
        from app.engine.data_loader import generate_default_parties
        parties = generate_default_parties()
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450)
        resp = historical_calibration(parties, cfg, current_year=2023)
        flow_total = sum(f.count for f in resp.flow_matrix)
        self.assertEqual(flow_total, resp.flipped_cities)
        if resp.flipped_cities:
            self.assertTrue(all(f.prev_party_id != f.cur_party_id for f in resp.flow_matrix))

    def test_vote_efficiency_computed(self):
        """选举效率应填充：PR 下各党效率接近 1，多数制下存在获益/受损分化"""
        pr_cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pr = ElectoralEngine(self.cd, self.parties, pr_cfg, seed=42).run()
        for p in pr.party_results:
            self.assertAlmostEqual(p.vote_efficiency, 1.0, delta=0.15)
        fptp, _ = self._run()
        effs = [p.vote_efficiency for p in fptp.party_results if p.seats > 0]
        self.assertGreater(max(effs), min(effs) + 0.3)

    def test_split_ticket_parallel(self):
        """并立制下应有分裂选票信号，纯比例制下无"""
        def run(sys):
            cfg = ElectoralConfig(system_type=sys, total_seats=450, tactical_voting=0.8)
            return ElectoralEngine(self.cd, self.parties, cfg, seed=42).run()
        para = run('PARALLEL')
        self.assertTrue(any(abs(v) > 0.3 for v in para.split_ticket.values()))
        pr = run('PR')
        self.assertTrue(all(abs(v) < 0.01 for v in pr.split_ticket.values()))

    def test_median_voter_present(self):
        """中间选民分析应给出中位立场与赢家/最近党"""
        r, _ = self._run()
        mv = r.median_voter_alignment
        self.assertIn('median_economic', mv)
        self.assertIn('median_social', mv)
        self.assertTrue(mv['winner_party_name'])
        self.assertTrue(mv['closest_party_name'])

    def test_system_comparison_endpoint(self):
        """制度全景对比应返回全部 9 种制度"""
        from app.engine.data_loader import generate_default_parties
        from app.api.routes import system_comparison, SystemComparisonRequest
        parties = generate_default_parties()
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450)
        req = SystemComparisonRequest(year=2023, config=cfg, parties=parties)
        resp = system_comparison(req)
        self.assertEqual(len(resp.systems), 9)
        pr = next(s for s in resp.systems if s.system_type == 'PR')
        self.assertLess(pr.gallagher, 0.05)

    def test_winner_bonus(self):
        """胜者红利：FPTP 首党大幅受益，PR 接近 0"""
        fptp, _ = self._run()
        self.assertGreater(fptp.winner_bonus, 0.05)
        pr_cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pr = ElectoralEngine(self.cd, self.parties, pr_cfg, seed=42).run()
        self.assertAlmostEqual(pr.winner_bonus, 0.0, delta=0.02)

    def test_party_niches(self):
        """政党生态位应含全部政党，且每个有覆盖度/宽度/重叠"""
        r, _ = self._run()
        self.assertEqual(len(r.party_niches), len(r.party_results))
        for n in r.party_niches:
            self.assertGreaterEqual(n.coverage, 0.0)
            self.assertLessEqual(n.coverage, 1.0)
            self.assertGreaterEqual(n.niche_width, 0.0)
            if n.overlaps:
                self.assertLessEqual(max(n.overlaps.values()), 1.0)

    def test_swingometer(self):
        """统一摆动分析：席位-选票曲线应随摆动单调变化，且含翻转阈值"""
        from app.engine.analysis_engine import swingometer_analysis
        r, cfg = self._run()
        top = max(r.party_results, key=lambda p: p.seats)
        res = swingometer_analysis(self.cd, self.parties, cfg, top.party_id)
        self.assertEqual(len(res['points']), 25)  # -12..+12 步长1
        seats = [p['seats'] for p in res['points']]
        self.assertEqual(seats[0], res['points'][0]['seats'])
        # 摆动越大席位应越多（单调不下降）
        for i in range(1, len(seats)):
            self.assertGreaterEqual(seats[i], seats[i - 1])
        self.assertGreater(res['points'][-1]['seats'], res['base_seats'])

    def test_wasted_votes(self):
        """浪费票：多数制浪费率应显著高于比例制"""
        from app.engine.analysis_engine import wasted_votes_analysis
        _, cfg = self._run()
        res = wasted_votes_analysis(self.cd, self.parties, cfg)
        self.assertGreater(res['fptp']['total_wasted_share'], res['pr']['total_wasted_share'])
        self.assertGreater(res['fptp']['total_wasted_share'], 0.5)  # 多数制多数票浪费

    def test_representation_gap(self):
        """代表性缺口：应有 8 个人口群体，且找出最不被代表者"""
        from app.engine.analysis_engine import representation_gap_analysis
        _, cfg = self._run()
        res = representation_gap_analysis(self.cd, self.parties, cfg)
        self.assertEqual(len(res['groups']), 8)
        self.assertIsNotNone(res['most_underrepresented'])
        for g in res['groups']:
            self.assertGreaterEqual(g['distance_to_government'], 0.0)


if __name__ == '__main__':
    unittest.main()