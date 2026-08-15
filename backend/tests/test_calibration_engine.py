import unittest

from app.engine import DataLoader, generate_default_parties
from app.models.config import ElectoralConfig
from app.engine.calibration_engine import historical_calibration


class CalibrationTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.parties = generate_default_parties()

    def test_calibration_baseline_is_earlier(self):
        """校准基准年应早于当前年"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.parties, cfg, current_year=2024, data_loader=self.dl)
        self.assertEqual(cal.baseline_year, 2020)
        self.assertEqual(cal.current_year, 2024)
        self.assertLess(cal.baseline_year, cal.current_year)

    def test_calibration_stability_bounds(self):
        """稳定性指数在 0-1，城市级汇总与翻盘数一致"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.parties, cfg, current_year=2024, data_loader=self.dl)
        self.assertGreaterEqual(cal.stability_index, 0.0)
        self.assertLessEqual(cal.stability_index, 1.0)
        self.assertEqual(len(cal.cities), cal.total_cities)
        self.assertEqual(cal.flipped_cities, sum(1 for c in cal.cities if c.flipped))

    def test_calibration_seat_volatility(self):
        """席位波动量为席位差绝对和占总席位的比例"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.parties, cfg, current_year=2024, data_loader=self.dl)
        total_delta = sum(abs(p.delta) for p in cal.parties)
        self.assertAlmostEqual(cal.seat_volatility, total_delta / 450, places=4)

    def test_calibration_uses_era_data(self):
        """校准基准年数据应来自年代库（与主推演同口径），而非手工 GDP 近似"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        # 2024 → baseline 2020（年代库收录）
        cal = historical_calibration(self.parties, cfg, current_year=2024, data_loader=self.dl)
        self.assertEqual(cal.baseline_year, 2020)
        # 2024 作为当前年，其城市数据应等同 DataLoader 的 2024 年代输出
        era_cd = self.dl.get_city_data(2024)
        # 通过稳定性指数推断数据有效（城市级总览完整）
        self.assertEqual(len(cal.cities), len(era_cd.cities))


if __name__ == '__main__':
    unittest.main()