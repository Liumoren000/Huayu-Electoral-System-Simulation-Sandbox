import math
from app.models.city import City, CityData
from app.models.party import Party
from app.models.config import ElectoralConfig
from app.models.result import (
    CityResult, PartySeatResult, ElectionResult, ProvinceResult, DisproportionalityDecomposition,
)
from .voter_model import VoterModel


class ElectoralEngine:
    def __init__(self, city_data: CityData, parties: list[Party], config: ElectoralConfig, seed: int = 42):
        self.city_data = city_data
        self.parties = parties
        self.config = config
        self.voter_model = VoterModel(
            seed=seed, turnout_shift=config.turnout_shift, dim_tilt=config.dim_tilt or {},
            party_effects=config.party_effects or {},
            party_loyalty=config.party_loyalty or 0.0,
            swing_voter_pct=config.swing_voter_pct or 0.0,
            voter_stratification=config.voter_stratification,
            calibration=config.calibration,
            turnout_differential=config.turnout_differential or 0.0,
        )
        self.party_map = {p.id: p for p in parties}

    def _effective_population(self, city: City) -> float:
        """应用 malapportionment：小城市/农业城市超代表"""
        m = self.config.malapportionment or 0.0
        if m <= 0:
            return float(city.population)
        max_pop = max((c.population for c in self.city_data.cities), default=1)
        pop_ratio = city.population / max_pop if max_pop > 0 else 0.0
        # 人口越少，权重放大越明显（上限 +malapportionment）
        boost = m * (1.0 - pop_ratio) * (1.0 + city.primary_industry_pct)
        return city.population * (1.0 + boost)

    def run(self) -> ElectionResult:
        if not self.parties:
            return ElectionResult(
                config_name=self.config.name,
                system_type=self.config.system_type,
                total_seats=self.config.total_seats,
                city_results=[],
                province_results=[],
                party_results=[],
                total_votes=0,
            )
        st = self.config.system_type
        if st == "FPTP":
            return self._run_fptp()
        elif st == "RUNOFF":
            return self._run_runoff()
        elif st == "MMP":
            return self._run_mmp()
        elif st == "PARALLEL":
            return self._run_parallel()
        elif st == "IRV":
            return self._run_ranked(self._irv_winner)
        elif st == "APPROVAL":
            return self._run_ranked(self._approval_winner)
        elif st == "BORDA":
            return self._run_ranked(self._borda_winner)
        elif st == "STV":
            return self._run_stv()
        else:
            return self._run_pr()

    def _top_margin(self, shares: dict) -> float:
        """第一名与第二名得票率之差"""
        vals = sorted(shares.values(), reverse=True)
        if len(vals) < 2:
            return 0.0
        return vals[0] - vals[1]

    def _apply_tactical_voting(self, shares: dict, city: City, intensity: float = 1.0) -> dict:
        """
        策略性投票/弃保（Duverger 效应）：适用于赢者全得的小选区制。

        选民事前基于民调/感知判断哪些政党"有望获胜"。若自己首选政党
        不在可赢之列，则按 tactical_voting 比例"弃保"——把票转投给
        可赢政党中最接近自己偏好的一个（按亲和度）。

        intensity: 阻尼系数。两轮制首轮弃保压力弱于小选区制（可用 <1）。
        """
        t = (self.config.tactical_voting or 0.0) * intensity
        if t <= 0 or len(self.parties) < 3:
            return shares
        # 可赢集合：当前得票率前二（M+1 法则下 M=1 → 2 个可赢候选人）
        viable = sorted(shares, key=shares.get, reverse=True)[:2]
        viable_set = set(viable)
        # 各政党在该城市的亲和度（弃保时按偏好排序，噪声置 0 保证确定性）
        affinities = {
            p.id: self.voter_model.compute_city_party_affinity(city, p, 0.0)
            for p in self.parties
        }
        out = dict(shares)
        for pid, share in shares.items():
            if pid in viable_set or share <= 0:
                continue
            # 该党的支持者中，按弃保比例转投可赢政党中最偏好者
            transfer = share * t
            out[pid] -= transfer
            best_viable = max(viable, key=lambda v: affinities.get(v, 0.0))
            out[best_viable] += transfer
        total = sum(out.values())
        if total <= 0:
            return shares
        return {pid: v / total for pid, v in out.items()}

    def _adjust_shares_for_urban_rural(self, shares: dict, city: City) -> dict:
        """
        根据城乡差异调整各政党得票率

        在高城镇化城市，城市倾向政党获益更多
        在低城镇化城市，农村倾向政党获益更多
        """
        weight = self.config.urban_rural_weight
        if weight == 0:
            return shares

        urbanization = city.urbanization_rate
        adjusted = {}

        for pid, share in shares.items():
            party = self.party_map.get(pid)
            if party:
                party_ur = getattr(party, 'urban_rural_position', 0)
                if urbanization > 0.6:
                    factor = (urbanization - 0.6) * weight * party_ur * 0.5
                else:
                    factor = (0.6 - urbanization) * weight * party_ur * 0.3
                adjusted[pid] = share * (1 + factor)
            else:
                adjusted[pid] = share

        total = sum(adjusted.values())
        if total > 0:
            return {pid: v / total for pid, v in adjusted.items()}
        return shares

    def _run_fptp(self) -> ElectionResult:
        city_results = []
        party_seats = {p.id: 0 for p in self.parties}
        party_votes = {p.id: 0.0 for p in self.parties}
        total_votes = 0

        # 一次性计算每个城市的得票率、投票率，保证胜者与得票分布一致
        city_info = {}
        for city in self.city_data.cities:
            turnout = self.voter_model.get_city_turnout(city, self.config.urban_rural_weight)
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            # 策略性投票/弃保：弱势候选人支持者转投可赢政党
            shares = self._apply_tactical_voting(shares, city)
            # 竞争度调节投票率（abstention_sensitivity）
            comp = 1.0 - self._top_margin(shares)
            turnout = self.voter_model.get_city_turnout(
                city, self.config.urban_rural_weight,
                competitiveness=comp, abstention_sensitivity=self.config.abstention_sensitivity or 0.0)
            city_votes_total = city.population * turnout

            city_info[city.id] = {
                'city': city,
                'shares': shares,
                'turnout': turnout,
                'votes_per_seat': city_votes_total,
            }

            for pid, share in shares.items():
                party_votes[pid] += share * city_votes_total
            total_votes += city_votes_total

        # 按有效人口以最大余数法分配议席（尊重 min_seats_per_city 保底），
        # 保证每个城市至少 1 席——旧实现先 max(1,round) 再截断，会整城丢席。
        eff_pops = {cid: self._effective_population(info['city']) for cid, info in city_info.items()}
        min_seats = min(self.config.min_seats_per_city, self.config.total_seats // max(1, len(eff_pops)))
        city_seats = self._largest_remainder_seats(eff_pops, self.config.total_seats, min_seats=min_seats)

        # 每市席位全部归于该市得票最高的政党（胜者全得）
        city_winners = {cid: max(info['shares'], key=info['shares'].get) for cid, info in city_info.items()}
        for cid, n in city_seats.items():
            party_seats[city_winners[cid]] += n

        city_party_seats = {cid: {city_winners[cid]: n} for cid, n in city_seats.items() if city_winners.get(cid)}
        city_seats_map = {c.id: city_seats.get(c.id, 0) for c in self.city_data.cities}

        city_results = self._build_city_results(city_info, city_winners)

        party_results = []
        for p in self.parties:
            vote_share = party_votes[p.id] / total_votes if total_votes > 0 else 0
            psr = PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats[p.id],
                vote_share=round(vote_share, 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            )
            party_results.append(psr)

        return self._build_result(city_results, party_results, total_votes,
                                  city_seats_map=city_seats_map, city_party_seats=city_party_seats)

    def _run_runoff(self) -> ElectionResult:
        """两轮投票制：第一轮无人过半则前两名进入第二轮"""
        party_votes_round1 = {p.id: 0.0 for p in self.parties}
        total_votes_round1 = 0
        city_results_round1 = []

        for city in self.city_data.cities:
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            # 两轮制首轮弃保压力弱于小选区制：转投者可等第二轮再表达，故阻尼 0.5
            shares = self._apply_tactical_voting(shares, city, intensity=0.5)
            turnout = self.voter_model.get_city_turnout(city, self.config.urban_rural_weight)
            city_votes = city.population * turnout

            for pid, share in shares.items():
                party_votes_round1[pid] += share * city_votes
            total_votes_round1 += city_votes

            winner_id = max(shares, key=shares.get)
            city_results_round1.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=turnout,
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        max_share = max(party_votes_round1.values()) / total_votes_round1 if total_votes_round1 > 0 else 0
        sorted_parties = sorted(party_votes_round1.items(), key=lambda x: x[1], reverse=True)

        if max_share >= self.config.runoff_threshold or len(sorted_parties) < 2:
            winner_id = sorted_parties[0][0]
        else:
            top2_ids = [sorted_parties[0][0], sorted_parties[1][0]]

            party_votes_round2 = {pid: 0.0 for pid in top2_ids}

            for city in self.city_data.cities:
                shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
                shares = self._adjust_shares_for_urban_rural(shares, city)
                turnout = self.voter_model.get_city_turnout(city, self.config.urban_rural_weight)
                city_votes = city.population * turnout

                eliminated = {pid: share for pid, share in shares.items() if pid not in top2_ids}
                eliminated_total = sum(eliminated.values())

                for pid in top2_ids:
                    own = shares.get(pid, 0)
                    transferred = eliminated_total * (own / max(0.01, sum(shares.get(p, 0) for p in top2_ids)))
                    party_votes_round2[pid] += (own + transferred) * city_votes

            winner_id = max(party_votes_round2, key=party_votes_round2.get)

        party_results = []
        for p in self.parties:
            # 得票率统一使用第一轮全国得票率（合计为 1），席位由第二轮决出
            vote_share = party_votes_round1[p.id] / total_votes_round1 if total_votes_round1 > 0 else 0
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=0,
                vote_share=round(vote_share, 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            ))

        for pr in party_results:
            pr.seats = self.config.total_seats if pr.party_id == winner_id else 0

        city_party_seats = {
            cid: {winner_id: n} for cid, n in self._city_seats_display(self.config.total_seats).items()
        }
        return self._build_result(city_results_round1, party_results, total_votes_round1,
                                  city_party_seats=city_party_seats)

    def _run_pr(self) -> ElectionResult:
        city_results = []
        party_votes = {p.id: 0.0 for p in self.parties}
        total_votes = 0

        for city in self.city_data.cities:
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            base_turnout = self.voter_model.get_city_turnout(city, self.config.urban_rural_weight)

            city_votes = city.population * base_turnout
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
                turnout=base_turnout,
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        party_seats = self._allocate_pr(party_votes, self.config.total_seats, threshold=self.config.threshold)

        city_by_id = {cr.city_id: cr for cr in city_results}
        city_party_seats = {}
        for cid, n in self._city_seats_display(self.config.total_seats).items():
            cr = city_by_id.get(cid)
            if not cr:
                continue
            alloc = self._allocate_pr(cr.vote_shares, n, threshold=None)
            city_party_seats[cid] = {pid: s for pid, s in alloc.items() if s > 0}

        party_results = []
        for p in self.parties:
            vote_share = party_votes[p.id] / total_votes if total_votes > 0 else 0
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(vote_share, 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            ))

        return self._build_result(city_results, party_results, total_votes,
                                  city_party_seats=city_party_seats, province_proportional=True)

    # ========== 混合制 ==========

    def _run_mmp(self) -> ElectionResult:
        """混合成员比例代表制 (MMP)：选区席 + 名单席补位到比例代表"""
        total = self.config.total_seats
        district_total = self._district_count(total)
        list_total = total - district_total

        city_info, city_seats, party_votes, total_votes = self._district_base(district_total)
        city_winners = {cid: max(info['shares'], key=info['shares'].get) for cid, info in city_info.items()}

        district_seats = self._count_city_seats(city_seats, city_winners)
        ideal = self._allocate_pr(party_votes, total, threshold=self.config.threshold)
        list_seats = {pid: max(0, ideal[pid] - district_seats.get(pid, 0)) for pid in party_votes}

        # 名单席位调整到恰好 list_total（处理悬空席/余数）
        s = sum(list_seats.values())
        if s < list_total:
            while s < list_total:
                pid = max(list_seats, key=lambda p: ideal[p] - district_seats.get(p, 0) - list_seats[p])
                list_seats[pid] += 1
                s += 1
        elif s > list_total:
            while s > list_total:
                pid = max((p for p in list_seats if list_seats[p] > 0),
                          key=lambda p: district_seats.get(p, 0) - ideal[p])
                list_seats[pid] -= 1
                s -= 1

        total_party = {pid: district_seats.get(pid, 0) + list_seats.get(pid, 0) for pid in party_votes}
        party_results = [
            PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=total_party.get(p.id, 0),
                vote_share=round(party_votes[p.id] / total_votes, 4) if total_votes > 0 else 0,
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            )
            for p in self.parties
        ]

        city_results = self._build_city_results(city_info, city_winners)
        city_party_seats = {cid: {city_winners[cid]: n} for cid, n in city_seats.items() if city_winners.get(cid)}
        return self._build_result(city_results, party_results, total_votes, city_seats_map=city_seats,
                                  city_party_seats=city_party_seats, province_proportional=True)

    def _run_parallel(self) -> ElectionResult:
        """并立制：选区席 + 名单席（二者互不关联）"""
        total = self.config.total_seats
        district_total = self._district_count(total)
        list_total = total - district_total

        city_info, city_seats, party_votes, total_votes = self._district_base(district_total)
        city_winners = {cid: max(info['shares'], key=info['shares'].get) for cid, info in city_info.items()}

        district_seats = self._count_city_seats(city_seats, city_winners)
        list_seats = self._allocate_pr(party_votes, list_total, threshold=self.config.threshold)

        total_party = {pid: district_seats.get(pid, 0) + list_seats.get(pid, 0) for pid in party_votes}
        party_results = [
            PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=total_party.get(p.id, 0),
                vote_share=round(party_votes[p.id] / total_votes, 4) if total_votes > 0 else 0,
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            )
            for p in self.parties
        ]

        city_results = self._build_city_results(city_info, city_winners)
        city_party_seats = {cid: {city_winners[cid]: n} for cid, n in city_seats.items() if city_winners.get(cid)}
        province_party_seats = self._aggregate_province_party_seats(city_party_seats)
        prov_of = {c.id: c.province for c in self.city_data.cities}
        prov_votes, prov_pop = {}, {}
        for cid, info in city_info.items():
            p = prov_of.get(cid, "未知")
            prov_pop[p] = prov_pop.get(p, 0) + info['city'].population
            d = prov_votes.setdefault(p, {})
            for pid, s in info['shares'].items():
                d[pid] = d.get(pid, 0) + s * info['city'].population
        total_pop = sum(prov_pop.values()) or 1
        for p, dseats in province_party_seats.items():
            list_share = round(list_total * prov_pop.get(p, 0) / total_pop)
            if list_share > 0:
                alloc = self._allocate_pr(prov_votes.get(p, {}), list_share, threshold=None)
                for pid, n in alloc.items():
                    dseats[pid] = dseats.get(pid, 0) + n
        return self._build_result(city_results, party_results, total_votes, city_seats_map=city_seats,
                                  city_party_seats=city_party_seats,
                                  province_party_seats=province_party_seats)

    def _district_count(self, total: int) -> int:
        n = round(total * (1 - self.config.mixed_ratio))
        n = max(1, min(total - 1, n))
        # 保底：选区席不得少于城市数×每市最低席（否则 min_seats 保底会被静默清零）。
        # 允许名单席降为 0，保证每市至少 1 席优先于 mixed_ratio。
        min_district = len(self.city_data.cities) * self.config.min_seats_per_city
        return min(total, max(n, min_district))

    # ========== 排名票制度（单议席） ==========

    def _run_ranked(self, winner_fn) -> ElectionResult:
        """IRV / 同意投票 / 波达计分 共用：每城市按人口得若干议席，城市胜者一致"""
        total = self.config.total_seats
        city_info, city_seats, party_votes, total_votes = self._district_base(total)

        city_winners = {}
        for cid, info in city_info.items():
            rankings = self.voter_model.sample_voter_rankings(info['city'], self.parties, n=self.config.voter_samples, noise_amplitude=self.config.noise_amplitude * 4.0)
            city_winners[cid] = winner_fn(rankings)

        party_seats = self._count_city_seats(city_seats, city_winners)
        party_results = [
            PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(party_votes[p.id] / total_votes, 4) if total_votes > 0 else 0,
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            )
            for p in self.parties
        ]

        city_results = self._build_city_results(city_info, city_winners)
        city_party_seats = {cid: {city_winners[cid]: n} for cid, n in city_seats.items() if city_winners.get(cid)}
        return self._build_result(city_results, party_results, total_votes, city_seats_map=city_seats,
                                  city_party_seats=city_party_seats)

    def _irv_winner(self, rankings: list[list[str]]) -> str:
        """即时复选制 (IRV/AV)：逐轮淘汰首偏好最低者，直到某党过半"""
        remaining = {p.id for p in self.parties}
        while len(remaining) > 1:
            counts = {pid: 0 for pid in remaining}
            for ranking in rankings:
                for pid in ranking:
                    if pid in remaining:
                        counts[pid] += 1
                        break
            total = sum(counts.values()) or 1
            leader = max(counts, key=counts.get)
            if counts[leader] / total > 0.5:
                return leader
            lowest = min(counts, key=counts.get)
            remaining.discard(lowest)
        return remaining.pop()

    def _approval_winner(self, rankings: list[list[str]]) -> str:
        """同意投票：每选民认可其排序前一半政党，得认可最多者胜"""
        votes = {p.id: 0 for p in self.parties}
        for ranking in rankings:
            k = max(1, len(ranking) // 2)
            for pid in ranking[:k]:
                votes[pid] += 1
        return max(votes, key=votes.get)

    def _borda_winner(self, rankings: list[list[str]]) -> str:
        """波达计分：每选民按名次给分（倒数第 n 名得 n-1 分），总分最高者胜"""
        n = len(self.parties)
        scores = {p.id: 0 for p in self.parties}
        for ranking in rankings:
            for i, pid in enumerate(ranking):
                scores[pid] += (n - 1 - i)
        return max(scores, key=scores.get)

    # ========== STV 单一可转移投票（省级多议席） ==========

    def _run_stv(self) -> ElectionResult:
        total = self.config.total_seats

        prov_cities = {}
        for c in self.city_data.cities:
            prov_cities.setdefault(c.province, []).append(c)

        # 省级按人口分配议席（每省至少 1 席，总和精确等于 total）
        prov_pops = {prov: sum(c.population for c in cities) for prov, cities in prov_cities.items()}
        min_prov_seats = min(1, total // max(1, len(prov_pops)))
        prov_seats_map = self._largest_remainder_seats(prov_pops, total, min_seats=min_prov_seats)

        party_seats = {p.id: 0 for p in self.parties}
        city_winners = {}
        province_party_seats = {}

        for prov, cities in prov_cities.items():
            ballots = []
            first_prefs = {p.id: 0 for p in self.parties}
            for c in cities:
                rankings = self.voter_model.sample_voter_rankings(c, self.parties, n=self.config.voter_samples, noise_amplitude=self.config.noise_amplitude * 4.0)
                ballots.extend(rankings)
                for ranking in rankings:
                    if ranking:
                        first_prefs[ranking[0]] += 1
                # 城市显示胜者 = 首偏好最高者
                city_winners[c.id] = max(first_prefs, key=first_prefs.get)
            seats_n = max(1, prov_seats_map.get(prov, 1))
            prov_seats = self._stv_province(ballots, seats_n)
            province_party_seats[prov] = prov_seats
            for pid, n in prov_seats.items():
                party_seats[pid] = party_seats.get(pid, 0) + n

        city_party_seats = {
            cid: {city_winners.get(cid, self.parties[0].id): n}
            for cid, n in self._city_seats_display(total).items()
        }

        city_results = []
        for city in self.city_data.cities:
            info_city = city
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            winner_id = city_winners.get(city.id, max(shares, key=shares.get))
            city_results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=self.voter_model.get_city_turnout(city, self.config.urban_rural_weight),
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        party_results = []
        for p in self.parties:
            vote_share = sum(
                cr.vote_shares.get(p.id, 0) for cr in city_results
            ) / len(city_results) if city_results else 0
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(vote_share, 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
            ))

        return self._build_result(city_results, party_results, 0,
                                  city_party_seats=city_party_seats,
                                  province_party_seats=province_party_seats)

    def _stv_province(self, ballots: list[list[str]], seats: int) -> dict[str, int]:
        """
        STV（省级多议席，政党可连任）：Droop 配额 + 盈余降权转移 + 末位淘汰。

        政党每次当选占用一个议席；当选后其票重按 (votes-quota)/votes 收缩，
        盈余继续参与后续轮次，从而支持同一政党赢得多个议席。
        """
        party_ids = {p.id for p in self.parties}
        quota = math.floor(len(ballots) / (seats + 1)) + 1
        weights = [1.0] * len(ballots)
        party_seats = {pid: 0 for pid in party_ids}
        eliminated: set[str] = set()

        def current_top(i: int):
            for pid in ballots[i]:
                if pid in eliminated:
                    continue
                return pid
            return None

        while sum(party_seats.values()) < seats and len(eliminated) < len(party_ids):
            counts = {pid: 0.0 for pid in party_ids}
            for i in range(len(ballots)):
                top = current_top(i)
                if top is not None:
                    counts[top] += weights[i]

            progressed = False
            for pid, v in sorted(counts.items(), key=lambda x: -x[1]):
                if sum(party_seats.values()) >= seats:
                    break
                if pid in eliminated or v < quota:
                    continue
                party_seats[pid] += 1
                progressed = True
                if v > quota:
                    frac = max(0.0, (v - quota) / v)
                    for i in range(len(ballots)):
                        if current_top(i) == pid:
                            weights[i] *= frac
            if progressed:
                continue

            active = [pid for pid in party_ids if pid not in eliminated]
            if not active:
                break
            lowest = min(active, key=lambda pid: counts.get(pid, 0))
            eliminated.add(lowest)

        # 安全兜底：极端情况下把剩余席位按当前得票顺位补齐
        remaining = seats - sum(party_seats.values())
        if remaining > 0:
            order = sorted(party_ids, key=lambda pid: -counts.get(pid, 0))
            i = 0
            while remaining > 0:
                pid = order[i % len(order)]
                party_seats[pid] += 1
                remaining -= 1
                i += 1
        return party_seats

    # ========== 基础设施 ==========

    def _district_base(self, district_total: int) -> tuple[dict, dict, dict, float]:
        """按人口把 district_total 席分配到各城市，返回 (city_info, city_seats, party_votes, total_votes)"""
        city_info = {}
        party_votes = {p.id: 0.0 for p in self.parties}
        total_votes = 0.0

        for city in self.city_data.cities:
            turnout = self.voter_model.get_city_turnout(city, self.config.urban_rural_weight)
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            # 名单席位/比例代表反映"真实偏好"；选区席赢者通吃才受弃保影响
            honest = dict(shares)
            shares = self._apply_tactical_voting(shares, city)
            city_votes = city.population * turnout
            for pid, share in honest.items():
                party_votes[pid] += share * city_votes
            total_votes += city_votes
            city_info[city.id] = {
                'city': city,
                'shares': shares,
                'turnout': turnout,
            }

        min_seats = min(self.config.min_seats_per_city, district_total // max(1, len(city_info)))
        city_seats = self._largest_remainder_seats(
            {cid: info['city'].population for cid, info in city_info.items()},
            district_total,
            min_seats=min_seats,
        )
        return city_info, city_seats, party_votes, total_votes

    def _count_city_seats(self, city_seats: dict, city_winners: dict) -> dict[str, int]:
        seats = {p.id: 0 for p in self.parties}
        for cid, n in city_seats.items():
            w = city_winners.get(cid)
            if w:
                seats[w] = seats.get(w, 0) + n
        return seats

    def _build_city_results(self, city_info: dict, city_winners: dict) -> list[CityResult]:
        results = []
        for city in self.city_data.cities:
            info = city_info.get(city.id)
            if not info:
                continue
            shares = info['shares']
            winner_id = city_winners.get(city.id, max(shares, key=shares.get))
            results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=info['turnout'],
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))
        return results

    def _build_result(self, city_results: list[CityResult], party_results: list[PartySeatResult],
                      total_votes: float, city_seats_map: dict = None,
                      city_party_seats: dict = None, province_party_seats: dict = None,
                      province_proportional: bool = False) -> ElectionResult:
        province_results = self._aggregate_provinces(city_results)
        if city_seats_map:
            for cr in city_results:
                cr.seats = city_seats_map.get(cr.city_id, cr.seats)
        if city_party_seats:
            for cr in city_results:
                ps = city_party_seats.get(cr.city_id)
                if ps:
                    cr.party_seats = ps
        if not province_party_seats:
            if province_proportional:
                province_party_seats = self._province_proportional_seats(province_results)
            elif city_party_seats:
                province_party_seats = self._aggregate_province_party_seats(city_party_seats)
            else:
                province_party_seats = self._province_proportional_seats(province_results)
        for pr in province_results:
            province_party_seats.setdefault(pr.province_name, {})
        for pr in province_results:
            ps = province_party_seats.get(pr.province_name)
            if ps is not None:
                pr.party_seats = ps
                pr.seats = sum(ps.values())
                if ps:
                    top = max(ps, key=ps.get)
                    if ps[top] > 0:
                        pr.winner_party_id = top
                        pr.winner_party_name = self.party_map[top].name
        uh_party_results, uh_province_results, uh_total = self._compute_upper_house(province_results)
        env, ens, gallagher = self._compute_diversity_metrics(party_results)
        lh, rose, mal, pns = self._compute_additional_indices(party_results, province_results)
        decomp = self._compute_disprop_decomposition(party_results, province_results)
        return ElectionResult(
            config_name=self.config.name,
            system_type=self.config.system_type,
            total_seats=self.config.total_seats,
            city_results=city_results,
            province_results=province_results,
            party_results=party_results,
            total_votes=int(total_votes),
            effective_parties_vote=env,
            effective_parties_seats=ens,
            gallagher_index=gallagher,
            loosemore_hanby=round(lh, 4),
            rose_index=round(rose, 4),
            malapportionment_index=round(mal, 4),
            party_nationalization_index=round(pns, 4),
            disproportionality_decomposition=decomp,
            upper_house_party_results=uh_party_results,
            upper_house_province_results=uh_province_results,
            upper_house_total_seats=uh_total,
        )

    def _compute_disprop_decomposition(self, party_results: list[PartySeatResult],
                                       province_results: list[ProvinceResult]) -> DisproportionalityDecomposition:
        """
        不比例性三源分解（Loosemore-Hanby 口径，每个分量均为 0.5*Σ|·|）：

        - geographic: 选票地理分布效应。若各省按人口配席、省内按选票比例配席
          （即最理想的联邦比例制），仍与全国选票份额存在偏差——纯地理集中。
        - malapportionment: 选区名额失衡效应。省内配席改为实际省席份额后
          相对人口配席的增量偏差——省际席位与人口错配。
        - mechanical: 制度机制效应。省内配席改为实际赢得席位（胜者全得/门槛）后
          的剩余增量偏差——选举制度的机械性扭曲。
        - total: 实际 Loosemore-Hanby = 0.5*Σ|票份额-席份额|。
        """
        v_map = {p.party_id: p.vote_share for p in party_results}
        s_map = {p.party_id: p.seats / max(1, self.config.total_seats) for p in party_results}
        prov_seat_total = sum(pr.seats for pr in province_results) or 1
        prov_pop_total = sum(pr.population for pr in province_results) or 1
        prov_seat_share = {pr.province_name: pr.seats / prov_seat_total for pr in province_results}
        prov_pop_share = {pr.province_name: pr.population / prov_pop_total for pr in province_results}

        r_map = {pid: 0.0 for pid in v_map}  # 人口配席 + 省内比例
        q_map = {pid: 0.0 for pid in v_map}  # 实际省席 + 省内比例
        for pr in province_results:
            vs = pr.vote_shares
            tot = sum(vs.values())
            if tot <= 0:
                continue
            for pid in v_map:
                pv = vs.get(pid, 0) / tot
                r_map[pid] += prov_pop_share[pr.province_name] * pv
                q_map[pid] += prov_seat_share[pr.province_name] * pv

        geo = 0.5 * sum(abs(v_map[pid] - r_map[pid]) for pid in v_map)
        mal = 0.5 * sum(abs(r_map[pid] - q_map[pid]) for pid in v_map)
        mech = 0.5 * sum(abs(q_map[pid] - s_map[pid]) for pid in v_map)
        total = 0.5 * sum(abs(v_map[pid] - s_map[pid]) for pid in v_map)

        return DisproportionalityDecomposition(
            geographic=round(geo, 4),
            malapportionment=round(mal, 4),
            mechanical=round(mech, 4),
            total=round(total, 4),
        )

    def _city_seats_display(self, total: int) -> dict[str, int]:
        """按人口把 total 席分配到各城市（展示/分组用）"""
        min_seats = min(self.config.min_seats_per_city, total // max(1, len(self.city_data.cities)))
        return self._largest_remainder_seats(
            {c.id: c.population for c in self.city_data.cities}, total, min_seats=min_seats)

    def _compute_additional_indices(self, party_results: list[PartySeatResult],
                                    province_results: list[ProvinceResult]) -> tuple[float, float, float, float]:
        """
        计算比例性与政治地理学指标：
        - Loosemore-Hanby = 0.5 * Σ|票份额 - 席份额|
        - Rose 指数 = 1 - Loosemore-Hanby
        - Malapportionment = 0.5 * Σ|省席份额 - 省人口份额|
        - 政党国家化指数 = Σ_p 全国票份额_p * (1 - 0.5 Σ_i |省票份额_{p,i} - 全国票份额_p|)
        """
        total = max(1, self.config.total_seats)
        v_map = {p.party_id: p.vote_share for p in party_results}
        s_map = {p.party_id: p.seats / total for p in party_results}
        lh = 0.5 * sum(abs(v_map.get(pid, 0) - s_map.get(pid, 0)) for pid in v_map)

        prov_seats = sum(pr.seats for pr in province_results) or 1
        prov_pop = sum(pr.population for pr in province_results) or 1
        mal = 0.5 * sum(abs(pr.seats / prov_seats - pr.population / prov_pop) for pr in province_results)

        pns = 0.0
        for p in party_results:
            nat = p.vote_share
            dev = 0.0
            for pr in province_results:
                prov_vote = pr.vote_shares.get(p.party_id, 0)
                dev += abs(prov_vote - nat)
            pns += nat * (1.0 - 0.5 * dev)
        return lh, 1.0 - lh, mal, pns

    def _aggregate_province_party_seats(self, city_party_seats: dict) -> dict:
        """把各市实际赢得席位按省聚合"""
        prov_map = {c.id: c.province for c in self.city_data.cities}
        out = {}
        for cid, ps in city_party_seats.items():
            prov = prov_map.get(cid, "未知")
            d = out.setdefault(prov, {})
            for pid, n in ps.items():
                d[pid] = d.get(pid, 0) + n
        return out

    def _province_proportional_seats(self, province_results: list[ProvinceResult]) -> dict:
        """按省级选票比例分配该省议席（PR/MMP 整体比例性展示用）"""
        out = {}
        for pr in province_results:
            total = sum(pr.vote_shares.values())
            if total > 0:
                votes = {pid: s * pr.population for pid, s in pr.vote_shares.items()}
            else:
                votes = {p.id: 1 for p in self.parties}
            out[pr.province_name] = self._allocate_pr(votes, pr.seats, threshold=None)
        return out

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

        city_seats_map = self._largest_remainder_seats(
            all_city_pops,
            total_seats,
            min_seats=min(self.config.min_seats_per_city, total_seats // max(1, len(all_city_pops))),
        )

        for cr in city_results:
            cr.seats = city_seats_map.get(cr.city_id, 1)

        results = []
        for prov, data in province_data.items():
            total = sum(data["shares"].values())
            avg_shares = {pid: s / total for pid, s in data["shares"].items()}
            winner_id = max(avg_shares, key=avg_shares.get)
            prov_pop = data["population"]
            prov_seats = sum(city_seats_map.get(cr.city_id, 1) for cr in data["city_results"])
            avg_turnout = sum(cr.turnout for cr in data["city_results"]) / max(1, len(data["city_results"]))

            results.append(ProvinceResult(
                province_name=prov,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in avg_shares.items()},
                num_cities=data["count"],
                population=prov_pop,
                seats=prov_seats,
                avg_turnout=round(avg_turnout, 4),
            ))
        return results

    def _largest_remainder_seats(self, entity_pops: dict[str, int], total_seats: int, min_seats: int = 0) -> dict[str, int]:
        total_pop = sum(entity_pops.values())
        if total_pop == 0 or total_seats <= 0:
            return {k: 0 for k in entity_pops}

        entity_count = len(entity_pops)
        reserved = entity_count * min_seats
        if total_seats < reserved:
            # 席位不足以保障每方最低席位时，退化为无保底的最大余数法
            return self._largest_remainder_seats(entity_pops, total_seats, min_seats=0)

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

    def _allocate_pr(self, party_votes: dict[str, float], total_seats: int, threshold: float = None) -> dict[str, int]:
        """按配置的分配法（d_hondt/sainte_lague/largest_remainder）分配比例席，可选得票门槛过滤"""
        votes = dict(party_votes)
        if threshold and sum(votes.values()) > 0:
            total = sum(votes.values())
            eligible = {pid: v for pid, v in votes.items() if v / total >= threshold}
            if eligible:
                votes = eligible

        method = self.config.allocation_method
        if method == "sainte_lague":
            seats = self._sainte_lague(votes, total_seats)
        elif method == "largest_remainder":
            seats = self._largest_remainder_seats(votes, total_seats, min_seats=0)
        else:
            seats = self._d_hondt(votes, total_seats)
        return {pid: seats.get(pid, 0) for pid in party_votes}

    def _compute_diversity_metrics(self, party_results: list[PartySeatResult]) -> tuple[float, float, float]:
        """
        计算政治多样性指标

        Returns:
            (effective_parties_vote, effective_parties_seats, gallagher_index)
        """
        vote_shares = [p.vote_share for p in party_results if p.vote_share > 0]
        seat_shares = [p.seats / max(1, self.config.total_seats) for p in party_results if p.seats > 0]

        if not vote_shares:
            return 0.0, 0.0, 0.0

        # 有效政党数 N = 1 / Σ(pi²)
        env = 1.0 / sum(v ** 2 for v in vote_shares) if vote_shares else 0.0
        ens = 1.0 / sum(s ** 2 for s in seat_shares) if seat_shares else 0.0

        # Gallagher 最小二乘指数 = sqrt(0.5 * Σ(vi - si)²)
        all_ids = {p.party_id for p in party_results}
        v_map = {p.party_id: p.vote_share for p in party_results}
        s_map = {p.party_id: p.seats / max(1, self.config.total_seats) for p in party_results}

        gallagher = math.sqrt(0.5 * sum(
            (v_map.get(pid, 0) - s_map.get(pid, 0)) ** 2 for pid in all_ids
        ))

        return round(env, 2), round(ens, 2), round(gallagher, 4)

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

            party_seats = self._allocate_pr(
                {pid: s * pr.population for pid, s in prov_shares.items()},
                prov_seat_count,
                threshold=None,
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
                economic_position=p.economic_position,
                social_position=p.social_position,
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
