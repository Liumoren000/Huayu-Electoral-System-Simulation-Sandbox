import unittest

from app.engine import DataLoader, generate_default_parties
from app.models.config import ElectoralConfig
from app.engine.calibration_engine import historical_calibration


class CalibrationTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.cd = cls.dl.get_city_data(2023)
        cls.parties = generate_default_parties()

    def test_calibration_baseline_is_earlier(self):
        """校准基准年应早于当前年"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.cd, self.parties, cfg, current_year=2024)
        self.assertEqual(cal.baseline_year, 2020)
        self.assertEqual(cal.current_year, 2024)
        self.assertLess(cal.baseline_year, cal.current_year)

    def test_calibration_stability_bounds(self):
        """稳定性指数在 0-1，城市级汇总与翻盘数一致"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.cd, self.parties, cfg, current_year=2024)
        self.assertGreaterEqual(cal.stability_index, 0.0)
        self.assertLessEqual(cal.stability_index, 1.0)
        self.assertEqual(len(cal.cities), cal.total_cities)
        self.assertEqual(cal.flipped_cities, sum(1 for c in cal.cities if c.flipped))

    def test_calibration_seat_volatility(self):
        """席位波动量为席位差绝对和占总席位的比例"""
        cfg = ElectoralConfig(system_type='PR', total_seats=450)
        cal = historical_calibration(self.cd, self.parties, cfg, current_year=2024)
        total_delta = sum(abs(p.delta) for p in cal.parties)
        self.assertAlmostEqual(cal.seat_volatility, total_delta / 450, places=4)


if __name__ == '__main__':
    unittest.main()