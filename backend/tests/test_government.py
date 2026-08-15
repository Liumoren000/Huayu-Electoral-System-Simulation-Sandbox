import unittest

from app.engine import DataLoader, ElectoralEngine, generate_default_parties
from app.models.config import ElectoralConfig
from app.engine.government_engine import GovernmentEngine


class GovernmentTermTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.cd = cls.dl.get_city_data(2023)
        cls.parties = generate_default_parties()

    def _run(self, system_type='FPTP', ruling=None, term_months=60, **cfg_kw):
        cfg = ElectoralConfig(system_type=system_type, total_seats=450, **cfg_kw)
        r = ElectoralEngine(self.cd, self.parties, cfg, seed=42).run()
        return GovernmentEngine(self.parties, seed=7).run(r, ruling_parties=ruling, term_months=term_months)

    def test_curve_monotonic_decreasing(self):
        """存活概率曲线单调不增"""
        res = self._run()
        probs = [s.survival_prob for s in res.survival_curve]
        self.assertEqual(len(probs), res.term_months)
        for i in range(1, len(probs)):
            self.assertLessEqual(probs[i], probs[i - 1] + 1e-9)

    def test_single_party_majority_more_stable(self):
        """单党绝对多数政府比多党联盟显著更稳定"""
        coalition = self._run()
        # 找一个单党多数方案（RUNOFF 胜者全得 450 席）
        single = self._run('RUNOFF')
        self.assertTrue(single.single_party)
        self.assertGreater(single.survival_prob_full_term,
                           coalition.survival_prob_full_term)

    def test_policy_pass_rate_bounds(self):
        """政策通过率与支持率都在合理区间"""
        res = self._run()
        self.assertGreaterEqual(res.policy_pass_rate, 0.15)
        self.assertLessEqual(res.policy_pass_rate, 0.95)
        for s in res.survival_curve:
            self.assertGreaterEqual(s.approvals, 5.0)
            self.assertLessEqual(s.approvals, 90.0)

    def test_reason_breakdown_sums_to_one(self):
        """倒阁原因分解之和为 1"""
        res = self._run()
        self.assertAlmostEqual(sum(res.reason_breakdown.values()), 1.0, places=4)

    def test_expected_months_positive(self):
        """预期存活月数在 (0, term_months]"""
        res = self._run()
        self.assertGreater(res.expected_months, 0)
        self.assertLessEqual(res.expected_months, res.term_months)

    def test_events_include_inauguration(self):
        """事件时间线包含就职事件"""
        res = self._run()
        self.assertGreaterEqual(len(res.events), 3)
        self.assertEqual(res.events[0].title, '政府就职')

    def test_deterministic(self):
        """同一种子结果逐位一致"""
        a = self._run()
        b = self._run()
        self.assertEqual(a.expected_months, b.expected_months)
        self.assertEqual(a.survival_prob_full_term, b.survival_prob_full_term)

    def test_bills_scale_with_term_length(self):
        """法案提交数应随任期长度增长"""
        short = self._run(term_months=36)
        long_ = self._run(term_months=72)
        self.assertGreater(long_.total_bills, short.total_bills)
        self.assertGreaterEqual(long_.total_bills, 1)

    def test_coalition_reduces_bills(self):
        """多党联盟法案数应不高于单党多数（议程协调成本更高）"""
        single = self._run('RUNOFF', term_months=60)  # 单党 450 席
        coalition = self._run('PR', term_months=60)    # 通常为多党联盟
        if not coalition.single_party and single.single_party:
            self.assertLessEqual(coalition.total_bills, single.total_bills)
        # 单党任期：法案数≈任期月数
        self.assertEqual(single.total_bills, 60)


if __name__ == '__main__':
    unittest.main()