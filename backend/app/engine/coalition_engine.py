import itertools
import math
from app.models.party import Party
from app.models.result import ElectionResult, CoalitionResult, CoalitionOption


class CoalitionEngine:
    def __init__(self, parties: list[Party]):
        self.parties = parties
        self.party_map = {p.id: p for p in parties}

    def find_coalitions(self, result: ElectionResult) -> CoalitionResult:
        majority_threshold = result.total_seats / 2
        party_results = {r.party_id: r for r in result.party_results}

        for r in result.party_results:
            if r.seats > majority_threshold:
                return CoalitionResult(
                    has_majority=True,
                    majority_party=r.party_id,
                    majority_party_name=r.party_name,
                    coalition_options=[],
                    recommended_coalition=None,
                )

        eligible = [(r.party_id, r.seats) for r in result.party_results if r.seats > 0]
        eligible.sort(key=lambda x: x[1], reverse=True)

        coalition_options = []
        for size in range(2, min(len(eligible) + 1, 5)):
            for combo in itertools.combinations(eligible, size):
                total_seats = sum(s for _, s in combo)
                if total_seats > majority_threshold:
                    party_ids = [pid for pid, _ in combo]
                    id_dist = self._ideological_distance(party_ids)
                    coalition_options.append(CoalitionOption(
                        parties=party_ids,
                        party_names=[self.party_map[pid].name for pid in party_ids],
                        total_seats=total_seats,
                        ideological_distance=round(id_dist, 4),
                        is_majority=True,
                    ))

        coalition_options.sort(key=lambda c: (c.ideological_distance, -c.total_seats))

        recommended = coalition_options[0] if coalition_options else None

        return CoalitionResult(
            has_majority=False,
            majority_party=None,
            majority_party_name=None,
            coalition_options=coalition_options[:10],
            recommended_coalition=recommended,
        )

    def _ideological_distance(self, party_ids: list[str]) -> float:
        if len(party_ids) < 2:
            return 0.0
        positions = []
        for pid in party_ids:
            p = self.party_map[pid]
            positions.append((p.economic_position, p.social_position, p.regional_position))

        total_dist = 0.0
        count = 0
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                dist = math.sqrt(
                    (positions[i][0] - positions[j][0]) ** 2 +
                    (positions[i][1] - positions[j][1]) ** 2 +
                    (positions[i][2] - positions[j][2]) ** 2
                )
                total_dist += dist
                count += 1
        return total_dist / count if count > 0 else 0.0
