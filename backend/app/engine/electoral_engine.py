import math
from app.models.city import City, CityData
from app.models.party import Party
from app.models.config import ElectoralConfig
from app.models.result import CityResult, PartySeatResult, ElectionResult, ProvinceResult
from .voter_model import VoterModel


class ElectoralEngine:
    def __init__(self, city_data: CityData, parties: list[Party], config: ElectoralConfig):
        self.city_data = city_data
        self.parties = parties
        self.config = config
        self.voter_model = VoterModel(seed=42)
        self.party_map = {p.id: p for p in parties}

    def run(self) -> ElectionResult:
        if self.config.system_type == "FPTP":
            return self._run_fptp()
        else:
            return self._run_pr()

    def _run_fptp(self) -> ElectionResult:
        city_results = []
        party_seats = {p.id: 0 for p in self.parties}
        party_votes = {p.id: 0.0 for p in self.parties}
        total_votes = 0

        total_pop = sum(c.population for c in self.city_data.cities)
        pop_per_seat = total_pop / self.config.total_seats

        election_queue = []
        for city in self.city_data.cities:
            city_votes_total = city.population * 0.6
            num_seats = max(1, round(city.population / pop_per_seat))
            shares = self.voter_model.compute_vote_shares(city, self.parties)

            city_votes_per_seat = city_votes_total / num_seats
            for pid, share in shares.items():
                party_votes[pid] += share * city_votes_per_seat
            total_votes += city_votes_per_seat

            for _ in range(num_seats):
                election_queue.append({
                    'city': city,
                    'shares': shares,
                    'votes': {pid: share * city_votes_per_seat for pid, share in shares.items()},
                })

        if len(election_queue) > self.config.total_seats:
            election_queue.sort(key=lambda x: max(x['votes'].values()), reverse=True)
            election_queue = election_queue[:self.config.total_seats]
        elif len(election_queue) < self.config.total_seats:
            while len(election_queue) < self.config.total_seats:
                idx = len(election_queue) % len(self.city_data.cities)
                city = self.city_data.cities[idx]
                shares = self.voter_model.compute_vote_shares(city, self.parties)
                city_votes_per_seat = city.population * 0.6 / max(1, round(city.population / pop_per_seat))
                election_queue.append({
                    'city': city,
                    'shares': shares,
                    'votes': {pid: share * city_votes_per_seat for pid, share in shares.items()},
                })

        city_winners = {}
        for seat in election_queue:
            winner_id = max(seat['votes'], key=seat['votes'].get)
            party_seats[winner_id] += 1
            city_winners[seat['city'].id] = winner_id

        city_results_done = set()
        for city in self.city_data.cities:
            if city.id in city_results_done:
                continue
            shares = self.voter_model.compute_vote_shares(city, self.parties)
            winner_id = city_winners.get(city.id, max(shares, key=shares.get))
            city_results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=0.6,
                affinities=self.voter_model.get_city_affinities(city, self.parties),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))
            city_results_done.add(city.id)

        party_results = []
        for p in self.parties:
            vote_share = party_votes[p.id] / total_votes if total_votes > 0 else 0
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats[p.id],
                vote_share=round(vote_share, 4),
                color=p.color,
            ))

        province_results = self._aggregate_provinces(city_results)

        uh_party_results, uh_province_results, uh_total = self._compute_upper_house(province_results)

        return ElectionResult(
            config_name=self.config.name,
            system_type=self.config.system_type,
            total_seats=self.config.total_seats,
            city_results=city_results,
            province_results=province_results,
            party_results=party_results,
            total_votes=int(total_votes),
            upper_house_party_results=uh_party_results,
            upper_house_province_results=uh_province_results,
            upper_house_total_seats=uh_total,
        )

    def _run_pr(self) -> ElectionResult:
        city_results = []
        party_votes = {p.id: 0.0 for p in self.parties}
        total_votes = 0

        for city in self.city_data.cities:
            shares = self.voter_model.compute_vote_shares(city, self.parties)
            city_votes = city.population * 0.6
            for pid, share in shares.items():
                party_votes[pid] += share * city_votes
            total_votes += city_votes

            winner_id = max(shares, key=shares.get)
            city_results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=0.6,
                affinities=self.voter_model.get_city_affinities(city, self.parties),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        eligible_parties = {
            pid: votes for pid, votes in party_votes.items()
            if (votes / total_votes if total_votes > 0 else 0) >= self.config.threshold
        }

        if not eligible_parties:
            eligible_parties = party_votes

        eligible_total = sum(eligible_parties.values())
        party_seats = {p.id: 0 for p in self.parties}

        if self.config.allocation_method == "sainte_lague":
            party_seats = self._sainte_lague(eligible_parties, self.config.total_seats)
        else:
            party_seats = self._d_hondt(eligible_parties, self.config.total_seats)

        party_results = []
        for p in self.parties:
            vote_share = party_votes[p.id] / total_votes if total_votes > 0 else 0
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(vote_share, 4),
                color=p.color,
            ))

        province_results = self._aggregate_provinces(city_results)

        uh_party_results, uh_province_results, uh_total = self._compute_upper_house(province_results)

        return ElectionResult(
            config_name=self.config.name,
            system_type=self.config.system_type,
            total_seats=self.config.total_seats,
            city_results=city_results,
            province_results=province_results,
            party_results=party_results,
            total_votes=int(total_votes),
            upper_house_party_results=uh_party_results,
            upper_house_province_results=uh_province_results,
            upper_house_total_seats=uh_total,
        )

    def _aggregate_provinces(self, city_results: list[CityResult]) -> list[ProvinceResult]:
        province_data = {}
        city_province_map = {c.id: c.province for c in self.city_data.cities}
        city_pop_map = {c.id: c.population for c in self.city_data.cities}

        for cr in city_results:
            prov = city_province_map.get(cr.city_id, "未知")
            if prov not in province_data:
                province_data[prov] = {"shares": {}, "count": 0, "population": 0, "city_results": []}
            province_data[prov]["count"] += 1
            province_data[prov]["population"] += city_pop_map.get(cr.city_id, 0)
            province_data[prov]["city_results"].append(cr)
            for pid, share in cr.vote_shares.items():
                province_data[prov]["shares"][pid] = province_data[prov]["shares"].get(pid, 0) + share

        total_seats = self.config.total_seats

        all_city_pops = {}
        city_prov_lookup = {}
        for prov, data in province_data.items():
            for cr in data["city_results"]:
                all_city_pops[cr.city_id] = city_pop_map.get(cr.city_id, 0)
                city_prov_lookup[cr.city_id] = prov

        city_seats_map = self._largest_remainder_seats(all_city_pops, total_seats, min_seats=1)

        for cr in city_results:
            cr.seats = city_seats_map.get(cr.city_id, 1)

        results = []
        for prov, data in province_data.items():
            total = sum(data["shares"].values())
            avg_shares = {pid: s / total for pid, s in data["shares"].items()}
            winner_id = max(avg_shares, key=avg_shares.get)
            prov_pop = data["population"]
            prov_seats = sum(city_seats_map.get(cr.city_id, 1) for cr in data["city_results"])

            results.append(ProvinceResult(
                province_name=prov,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in avg_shares.items()},
                num_cities=data["count"],
                population=prov_pop,
                seats=prov_seats,
            ))
        return results

    def _largest_remainder_seats(self, entity_pops: dict[str, int], total_seats: int, min_seats: int = 0) -> dict[str, int]:
        total_pop = sum(entity_pops.values())
        if total_pop == 0:
            return {k: min_seats for k in entity_pops}

        entity_count = len(entity_pops)
        reserved = entity_count * min_seats
        if total_seats <= reserved:
            return {k: min_seats for k in entity_pops}

        distributable = total_seats - reserved
        quotas = {k: (pop / total_pop) * distributable for k, pop in entity_pops.items()}

        seats = {k: min_seats + int(q) for k, q in quotas.items()}
        remainders = {k: q - int(q) for k, q in quotas.items()}

        assigned = sum(seats.values())
        remaining = total_seats - assigned

        if remaining > 0:
            sorted_entities = sorted(remainders.keys(), key=lambda k: -remainders[k])
            for i in range(remaining):
                seats[sorted_entities[i]] += 1

        return seats

    def _allocate_city_seats(self, city_results: list[CityResult], city_pop_map: dict, total_seats: int):
        if not city_results or total_seats <= 0:
            return

        city_pops = {cr.city_id: city_pop_map.get(cr.city_id, 0) for cr in city_results}
        seats_map = self._largest_remainder_seats(city_pops, total_seats, min_seats=1)

        for cr in city_results:
            cr.seats = seats_map.get(cr.city_id, 1)

    def _compute_upper_house(self, province_results: list[ProvinceResult]) -> tuple[list[PartySeatResult], list[ProvinceResult], int]:
        if not self.config.upper_house_enabled:
            return [], [], 0

        uh_seats = self.config.upper_house_seats
        uh_method = self.config.upper_house_method
        prov_count = len(province_results)

        prov_pops = {pr.province_name: pr.population for pr in province_results}
        total_pop = sum(prov_pops.values())

        if uh_method == "equal":
            base = uh_seats // prov_count
            prov_seats_map = {pr.province_name: base for pr in province_results}
            remainder = uh_seats - base * prov_count
            for i, pr in enumerate(province_results):
                if i < remainder:
                    prov_seats_map[pr.province_name] += 1
        elif uh_method == "proportional":
            prov_seats_map = self._largest_remainder_seats(prov_pops, uh_seats, min_seats=1)
        else:
            equal_share = int(uh_seats * (1 - self.config.upper_house_mixed_ratio))
            prop_share = uh_seats - equal_share
            base = equal_share // prov_count
            prov_seats_map = {pr.province_name: base for pr in province_results}
            remainder = equal_share - base * prov_count
            for i, pr in enumerate(province_results):
                if i < remainder:
                    prov_seats_map[pr.province_name] += 1
            if prop_share > 0:
                prop_map = self._largest_remainder_seats(prov_pops, prop_share, min_seats=0)
                for prov in prov_seats_map:
                    prov_seats_map[prov] += prop_map.get(prov, 0)

        uh_party_seats = {p.id: 0 for p in self.parties}
        uh_province_results = []

        for pr in province_results:
            prov_seat_count = prov_seats_map.get(pr.province_name, 1)
            total = sum(pr.vote_shares.values())
            if total > 0:
                prov_shares = {pid: s / total for pid, s in pr.vote_shares.items()}
            else:
                prov_shares = {pid: 1.0 / len(self.parties) for pid in self.party_map}

            if self.config.allocation_method == "sainte_lague":
                party_seats = self._sainte_lague(
                    {pid: s * pr.population for pid, s in prov_shares.items()},
                    prov_seat_count
                )
            else:
                party_seats = self._d_hondt(
                    {pid: s * pr.population for pid, s in prov_shares.items()},
                    prov_seat_count
                )

            for pid, seats in party_seats.items():
                uh_party_seats[pid] = uh_party_seats.get(pid, 0) + seats

            winner_id = max(prov_shares, key=prov_shares.get)
            uh_province_results.append(ProvinceResult(
                province_name=pr.province_name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in prov_shares.items()},
                num_cities=pr.num_cities,
                population=pr.population,
                seats=prov_seat_count,
            ))

        uh_party_results = []
        for p in self.parties:
            uh_party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=uh_party_seats.get(p.id, 0),
                vote_share=round(uh_party_seats.get(p.id, 0) / max(1, uh_seats), 4),
                color=p.color,
            ))

        return uh_party_results, uh_province_results, uh_seats

    def _d_hondt(self, party_votes: dict[str, float], total_seats: int) -> dict[str, int]:
        seats = {pid: 0 for pid in party_votes}
        for _ in range(total_seats):
            max_quotient = -1
            winner = None
            for pid, votes in party_votes.items():
                quotient = votes / (seats[pid] + 1)
                if quotient > max_quotient:
                    max_quotient = quotient
                    winner = pid
            if winner:
                seats[winner] += 1
        return seats

    def _sainte_lague(self, party_votes: dict[str, float], total_seats: int) -> dict[str, int]:
        seats = {pid: 0 for pid in party_votes}
        for _ in range(total_seats):
            max_quotient = -1
            winner = None
            for pid, votes in party_votes.items():
                quotient = votes / (2 * seats[pid] + 1)
                if quotient > max_quotient:
                    max_quotient = quotient
                    winner = pid
            if winner:
                seats[winner] += 1
        return seats
