import math
import random
from app.models.city import City
from app.models.party import Party


class VoterModel:
    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)

    def compute_city_party_affinity(self, city: City, party: Party) -> float:
        economic_affinity = self._economic_match(city, party)
        social_affinity = self._social_match(city, party)
        regional_affinity = self._regional_match(city, party)

        raw_score = (
            economic_affinity * 0.45 +
            social_affinity * 0.25 +
            regional_affinity * 0.30
        )

        noise = self.rng.gauss(0, 0.05)
        return max(0.01, raw_score + noise)

    def get_city_dimensions(self, city: City) -> dict[str, float]:
        return {
            'economic': round(self._city_economic_position(city), 3),
            'social': round(self._city_social_position(city), 3),
            'regional': round(self._city_regional_position(city), 3),
        }

    def get_city_affinities(self, city: City, parties: list[Party]) -> dict[str, float]:
        affinities = {}
        for party in parties:
            affinities[party.id] = round(self.compute_city_party_affinity(city, party), 4)
        return affinities

    def _economic_match(self, city: City, party: Party) -> float:
        city_economic = self._city_economic_position(city)
        diff = abs(city_economic - party.economic_position)
        return max(0, 1.0 - diff * 1.2)

    def _social_match(self, city: City, party: Party) -> float:
        city_social = self._city_social_position(city)
        diff = abs(city_social - party.social_position)
        return max(0, 1.0 - diff * 1.0)

    def _regional_match(self, city: City, party: Party) -> float:
        city_regional = self._city_regional_position(city)
        diff = abs(city_regional - party.regional_position)
        return max(0, 1.0 - diff * 1.3)

    def _city_economic_position(self, city: City) -> float:
        score = 0.0
        score += (city.gdp_per_capita / 200000 - 0.5) * 1.5
        score += city.tertiary_industry_pct * 0.5
        score -= city.primary_industry_pct * 2.0
        score += (city.education_index - 0.7) * 0.8
        return max(-1.0, min(1.0, score))

    def _city_social_position(self, city: City) -> float:
        score = 0.0
        score += (city.urbanization_rate - 0.6) * 0.8
        score -= (city.education_index - 0.7) * 1.2
        score += city.aging_rate * 1.5
        if city.region_type in ("western", "northeast"):
            score += 0.2
        if city.region_type == "coastal":
            score -= 0.15
        return max(-1.0, min(1.0, score))

    def _city_regional_position(self, city: City) -> float:
        if city.region_type == "coastal":
            return -0.6 - city.urbanization_rate * 0.3
        elif city.region_type == "western":
            return 0.5 + (1 - city.urbanization_rate) * 0.3
        elif city.region_type == "northeast":
            return 0.2 + city.aging_rate * 0.5
        else:
            return 0.1 + city.primary_industry_pct * 2.0

    def compute_vote_shares(self, city: City, parties: list[Party]) -> dict[str, float]:
        raw_scores = {}
        for party in parties:
            raw_scores[party.id] = self.compute_city_party_affinity(city, party)

        total = sum(raw_scores.values())
        shares = {pid: score / total for pid, score in raw_scores.items()}
        return shares
