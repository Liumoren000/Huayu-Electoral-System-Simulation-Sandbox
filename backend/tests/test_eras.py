import unittest
from app.engine.eras import ERA_LIBRARY, get_era, apply_era_city
from app.engine import DataLoader, generate_default_parties, ElectoralEngine
from app.models.config import ElectoralConfig


class EraPresetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dl = DataLoader()
        cls.parties = generate_default_parties()

    def test_library_years_sorted_and_unique(self):
        years = [e["year"] for e in ERA_LIBRARY]
        self.assertEqual(len(years), len(set(years)))
        self.assertEqual(years, sorted(years))
        self.assertGreaterEqual(years[0], 1949)
        self.assertLessEqual(years[-1], 2024)

    def test_era_structure(self):
        for e in ERA_LIBRARY:
            self.assertIn("year", e)
            self.assertIn("name", e)
            self.assertIn("city", e)
            self.assertIn("config", e)
            self.assertIn("param_diffs", e)
            self.assertIn("gdp_factor", e["city"])
            self.assertIn("population_factor", e["city"])
            self.assertIn("dim_tilt", e["config"])

    def test_get_era(self):
        self.assertIsNotNone(get_era(1978))
        self.assertIsNone(get_era(1990))

    def test_apply_era_city(self):
        base = self.dl.get_city_data(2024).cities[0]
        era1949 = get_era(1949)
        adj = apply_era_city(base, era1949)
        self.assertLess(adj.gdp_per_capita, base.gdp_per_capita)
        self.assertLess(adj.population, base.population)
        self.assertLess(adj.urbanization_rate, base.urbanization_rate)
        total_industry = adj.primary_industry_pct + adj.secondary_industry_pct + adj.tertiary_industry_pct
        self.assertAlmostEqual(total_industry, 1.0, places=4)
        self.assertTrue(0.0 <= adj.urbanization_rate <= 1.0)

    def test_era_city_data_monotonic_population(self):
        pops = []
        for e in ERA_LIBRARY:
            cd = self.dl.get_city_data(e["year"])
            pops.append(cd.total_population)
        self.assertEqual(pops, sorted(pops))

    def test_every_era_simulates(self):
        for e in ERA_LIBRARY:
            cd = self.dl.get_city_data(e["year"])
            cfg = ElectoralConfig(
                system_type="PR", total_seats=450, min_seats_per_city=1,
                dim_tilt=e["config"]["dim_tilt"],
                turnout_shift=e["config"]["turnout_shift"],
                noise_amplitude=e["config"]["noise_amplitude"],
            )
            res = ElectoralEngine(cd, self.parties, cfg, seed=42).run()
            total = sum(p.seats for p in res.party_results)
            self.assertEqual(total, 450, f"era {e['year']} seats != 450")

    def test_non_era_year_falls_back_to_linear(self):
        cd1990 = self.dl.get_city_data(1990)
        cd2000 = self.dl.get_city_data(2000)
        factor = (1.0 + (1990 - 2020) * 0.01) / (1.0 + (2000 - 2020) * 0.01)
        self.assertAlmostEqual(
            cd1990.cities[0].gdp_per_capita,
            cd2000.cities[0].gdp_per_capita * factor,
            places=1,
        )


if __name__ == "__main__":
    unittest.main()
