import unittest

from app.engine import DataLoader, generate_default_parties
from app.models.config import ElectoralConfig
from app.engine.poll_engine import PollEngine, swing_analysis


class PollEngineTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.cd = cls.dl.get_city_data(2023)
        cls.parties = generate_default_parties()

    def test_poll_series_normalized_and_converges(self):
        """民调每周支持率归一化，且终点接近实际得票率"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pe = PollEngine(self.cd, self.parties, cfg, weeks=10)
        pr = pe.run()

        from collections import defaultdict
        weekly = defaultdict(float)
        for pt in pr.series:
            weekly[pt.week] += pt.share
        for w, total in weekly.items():
            self.assertAlmostEqual(total, 1.0, delta=0.02)

        # 终点民调应接近最终得票率（允许随机波动 ±0.2）
        for pid, final in pr.final_share.items():
            last = [s.share for s in pr.series if s.party_id == pid and s.week == pr.weeks]
            self.assertTrue(last)
            self.assertLess(abs(last[0] - final), 0.2)

        self.assertEqual(pr.forecasts, sorted(pr.forecasts, key=lambda f: f.seat_projection, reverse=True))
        self.assertEqual(sum(f.win_prob for f in pr.forecasts), 1.0)

    def test_poll_events_present(self):
        """舆论事件应被记录并带有方向"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pr = PollEngine(self.cd, self.parties, cfg, weeks=12).run()
        self.assertTrue(pr.events)
        self.assertTrue(all(e.week >= 1 and e.week <= 12 for e in pr.events))
        self.assertTrue(all(e.direction in (-1.0, 1.0) for e in pr.events))

    def test_swing_classification_sums(self):
        """tossup/lean/safe 覆盖全部选区"""
        cfg = ElectoralConfig(system_type='FPTP', total_seats=450)
        sa = swing_analysis(self.cd, self.parties, cfg)
        self.assertEqual(sa.tossup_count + sa.lean_count + sa.safe_count, len(sa.districts))
        self.assertEqual(sa.total_seats, 450)
        self.assertTrue(sa.national_leader)
        # 每类选区标注正确
        levels = {'tossup': sa.tossup_count, 'lean': sa.lean_count, 'safe': sa.safe_count}
        from collections import Counter
        actual = Counter(d.swing_level for d in sa.districts)
        for level, expected in levels.items():
            self.assertEqual(actual.get(level, 0), expected, msg=f'{level} mismatch')

    def test_bellwether_is_meaningful(self):
        """风向标选区应与全国最大党一致"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        sa = swing_analysis(self.cd, self.parties, cfg)
        for d in sa.districts:
            if d.bellwether:
                self.assertEqual(d.winner_party_id, sa.national_leader)

    def test_events_target_follows_landscape(self):
        """舆论事件冲击对象随当周政治格局动态选择（负面冲击领先党）"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        pe = PollEngine(self.cd, self.parties, cfg, weeks=12, seed=7)
        pr = pe.run()
        # 冲击对象必须是存在的政党
        party_ids = {p.id for p in self.parties}
        for e in pr.events:
            self.assertIn(e.party_id, party_ids)
        # 负面事件（direction=-1）目标应为当周领先党：解析周内领先者
        from collections import defaultdict
        weekly_leader = {}
        for pt in pr.series:
            if pt.share > weekly_leader.get(pt.week, (None, -1))[1]:
                weekly_leader[pt.week] = (pt.party_id, pt.share)
        neg_events = [e for e in pr.events if e.direction == -1.0]
        if neg_events:
            e = neg_events[0]
            leader, _ = weekly_leader.get(e.week, (None, -1))
            self.assertEqual(e.party_id, leader)


if __name__ == '__main__':
    unittest.main()