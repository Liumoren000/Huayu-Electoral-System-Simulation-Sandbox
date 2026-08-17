import math
from app.models.city import City, CityData
from app.models.party import Party
from app.models.config import ElectoralConfig
from app.models.result import (
    CityResult, PartySeatResult, ElectionResult, ProvinceResult, DisproportionalityDecomposition,
    RegionalBlock, PartyNiche,
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
            affinity_power=config.affinity_power,
            party_system_concentration=config.party_system_concentration or 0.0,
            turnout_structure_sensitivity=config.turnout_structure_sensitivity or 0.0,
            spatial_autocorrelation=config.spatial_autocorrelation or 0.0,
        )
        self.party_map = {p.id: p for p in parties}
        self._split_ticket_cache = {}

    def _concentration_bonus(self, party_votes: dict[str, float]) -> dict[str, float]:
        """政党体系集中化加成：全国领先党（第一党+b、第二党+b/2）获得声望加成，
        模拟主导党/两强对峙格局；返回 party_id -> 份额加成。"""
        b = self.config.party_system_concentration or 0.0
        if b <= 0 or not party_votes:
            return {}
        top_two = sorted(party_votes.items(), key=lambda kv: kv[1], reverse=True)[:2]
        if len(top_two) >= 2:
            return {top_two[0][0]: b, top_two[1][0]: b * 0.5}
        return {top_two[0][0]: b}

    def _apply_national_concentration(self, party_votes: dict[str, float],
                                      city_shares: dict[str, dict[str, float]],
                                      total_votes: float) -> dict[str, float]:
        """对全国得票率与各城市份额应用集中化加成，返回修正后的 party_votes。"""
        bonus = self._concentration_bonus(party_votes)
        if not bonus:
            return party_votes
        for pid in bonus:
            party_votes[pid] += bonus[pid] * total_votes
        for cid, shares in city_shares.items():
            adj = {pid: s + bonus.get(pid, 0.0) for pid, s in shares.items()}
            t = sum(adj.values())
            city_shares[cid] = {pid: v / t for pid, v in adj.items()} if t > 0 else shares
        return party_votes

    def _compute_party_niches(self, party_results: list[PartySeatResult],
                              city_results: list[CityResult]) -> list[PartyNiche]:
        """
        政党生态位（政治生态学）：各党在意识形态空间的位置与选民覆盖。

        - 位置：经济/社会双轴（政党纲领固有立场）
        - 宽度：该党在城市间得票率的标准差（越大覆盖越广、生态位越宽）
        - 覆盖：得票超过城市均值的城市比例（0-1）
        - 重叠：两党在城市级得票向量的余弦相似度（越接近 1 竞争越直接）
        """
        if not city_results or not party_results:
            return []
        shares_by_city = {cr.city_id: cr.vote_shares for cr in city_results}
        city_ids = [cr.city_id for cr in city_results]
        n = max(1, len(city_ids))
        mean_share = {p.party_id: sum(shares_by_city[cid].get(p.party_id, 0.0) for cid in city_ids) / n
                      for p in party_results}
        niches = []
        for p in party_results:
            vals = [shares_by_city[cid].get(p.party_id, 0.0) for cid in city_ids]
            avg = mean_share[p.party_id]
            var = sum((v - avg) ** 2 for v in vals) / n
            width = round(math.sqrt(var), 4)
            coverage = round(sum(1 for v in vals if v > avg) / n, 3)
            niches.append(PartyNiche(
                party_id=p.party_id,
                party_name=p.party_name,
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
                vote_share=p.vote_share,
                niche_width=width,
                coverage=coverage,
            ))
        # 重叠：城市得票向量余弦相似度
        for a in niches:
            va = [shares_by_city[cid].get(a.party_id, 0.0) for cid in city_ids]
            for b in niches:
                if b.party_id == a.party_id:
                    continue
                vb = [shares_by_city[cid].get(b.party_id, 0.0) for cid in city_ids]
                num = sum(x * y for x, y in zip(va, vb))
                den = math.sqrt(sum(x * x for x in va)) * math.sqrt(sum(y * y for y in vb))
                a.overlaps[b.party_id] = round(num / den, 3) if den > 0 else 0.0
        return niches

    def _compute_split_ticket(self, party_results: list[PartySeatResult]) -> dict[str, float]:
        """分裂选票：各党名单票-选区票差异（pp），正=名单票更多（弃保受益），负=选区票更多"""
        return {p.party_id: self._split_ticket_cache.get(p.party_id, 0.0) for p in party_results}

    def _compute_median_voter(self, party_results: list[PartySeatResult]) -> dict:
        """
        中间选民定理（median voter）验证：全国选民在关键议题上的中位立场，
        与各党立场距离及胜者对照，判断赢家是否接近中间立场。
        """
        econ_pts = []
        soc_pts = []
        for city in self.city_data.cities:
            w = float(city.population)
            dims = self.voter_model.get_city_dimensions(city)
            econ_pts.append((dims.get('economic', 0.0), w))
            soc_pts.append((dims.get('social', 0.0), w))
        total = max(1.0, sum(w for _, w in econ_pts))
        econ_pts.sort(); soc_pts.sort()
        median_econ = self._weighted_median(econ_pts, total)
        median_soc = self._weighted_median(soc_pts, total)
        winner = max(party_results, key=lambda p: p.seats)
        win_dist = abs(winner.economic_position - median_econ) + abs(winner.social_position - median_soc)
        dists = {}
        for p in party_results:
            d = abs(p.economic_position - median_econ) + abs(p.social_position - median_soc)
            dists[p.party_id] = round(d, 3)
        return {
            "median_economic": round(median_econ, 3),
            "median_social": round(median_soc, 3),
            "winner_party_id": winner.party_id,
            "winner_party_name": winner.party_name,
            "winner_distance": round(win_dist, 3),
            "closest_party_id": min(dists, key=dists.get),
            "closest_party_name": self.party_map[min(dists, key=dists.get)].name,
            "party_distances": dists,
        }

    def _weighted_median(self, pts: list[tuple[float, float]], total: float) -> float:
        acc = 0.0
        for v, w in pts:
            acc += w
            if acc >= total / 2.0:
                return v
        return pts[-1][0] if pts else 0.0

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
        self.voter_model.reset_run()
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

        现实化：
        1) 可赢集合 = 前二 + 与第二名差距 <5pp 的"边缘可赢党"，避免
           三强并列城市第三名被整体抹除；
        2) 转投比例按落后度梯度化（越接近可赢线越少弃保），而非全有全无；
        3) 优先转投同阵营（camp）的可赢党；无同阵营可赢党时才跨阵营，
           幅度折半（阵营认同仍约束投票行为）。

        intensity: 阻尼系数。两轮制首轮弃保压力弱于小选区制（可用 <1）。
        """
        t = (self.config.tactical_voting or 0.0) * intensity
        if t <= 0 or len(self.parties) < 3:
            return shares
        ranked = sorted(shares, key=shares.get, reverse=True)
        top, second = ranked[0], ranked[1]
        top_share, second_share = shares[top], shares[second]
        # 可赢集合：前二 + 与第二名差距 <5pp
        viable = set(ranked[:2])
        for pid in ranked[2:]:
            if second_share - shares[pid] < 0.05:
                viable.add(pid)
        # 各政党在该城市的亲和度（弃保时按偏好排序，噪声置 0 保证确定性）
        affinities = {
            p.id: self.voter_model.compute_city_party_affinity(city, p, 0.0)
            for p in self.parties
        }
        camp_of = {p.id: getattr(p, 'camp', '') for p in self.parties}
        out = dict(shares)
        for pid, share in shares.items():
            if pid in viable or share <= 0:
                continue
            # 落后度：落后越多越"无望"，弃保率越高（距可赢线 15pp 以上全转）
            lag = max(0.0, top_share - share)
            rate = t * min(1.0, lag / 0.15)
            if rate <= 0:
                continue
            transfer = share * rate
            out[pid] -= transfer
            # 转投目标：同阵营可赢党优先
            my_camp = camp_of.get(pid, '')
            same_camp = [v for v in viable if camp_of.get(v) and camp_of.get(v) == my_camp]
            candidates = same_camp or list(viable)
            cross_camp = not same_camp
            best_viable = max(candidates, key=lambda v: affinities.get(v, 0.0))
            out[best_viable] += transfer * (0.5 if cross_camp else 1.0)
            if cross_camp:
                out[pid] += transfer * 0.5  # 跨阵营时保留一半（阵营认同）
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
            eligible = self.voter_model.get_eligible_voter_ratio(city)
            city_votes_total = city.population * eligible * turnout

            city_info[city.id] = {
                'city': city,
                'shares': shares,
                'turnout': turnout,
                'eligible_voter_ratio': eligible,
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

        # 政党体系集中化：全国领先党获得声望加成（第一党+b、第二党+b/2，作用于
        # 所有城市份额后重算），模拟主导党/两强对峙格局，但保留城市内部竞争悬念。
        city_shares = {cid: info['shares'] for cid, info in city_info.items()}
        party_votes = self._apply_national_concentration(party_votes, city_shares, total_votes)
        total_votes = sum(party_votes.values())
        for cid, shares in city_shares.items():
            city_info[cid]['shares'] = shares

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
                camp=p.camp,
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
            eligible = self.voter_model.get_eligible_voter_ratio(city)
            city_votes = city.population * eligible * turnout

            for pid, share in shares.items():
                party_votes_round1[pid] += share * city_votes
            total_votes_round1 += city_votes

            winner_id = max(shares, key=shares.get)
            city_results_round1.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                province=city.province,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=turnout,
                eligible_voter_ratio=self.voter_model.get_eligible_voter_ratio(city),
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        # 政党体系集中化（第一轮得票与进入第二轮的对象受影响）
        city_shares_r1 = {cr.city_id: cr.vote_shares for cr in city_results_round1}
        party_votes_round1 = self._apply_national_concentration(party_votes_round1, city_shares_r1, total_votes_round1)
        total_votes_round1 = sum(party_votes_round1.values())
        for cr in city_results_round1:
            if cr.city_id in city_shares_r1:
                cr.vote_shares = {pid: round(s, 4) for pid, s in city_shares_r1[cr.city_id].items()}

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
                eligible = self.voter_model.get_eligible_voter_ratio(city)
                city_votes = city.population * eligible * turnout

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
                camp=p.camp,
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
            # 竞争度调节投票率（abstention_sensitivity）：与 FPTP 口径一致
            comp = 1.0 - self._top_margin(shares)
            base_turnout = self.voter_model.get_city_turnout(
                city, self.config.urban_rural_weight,
                competitiveness=comp,
                abstention_sensitivity=self.config.abstention_sensitivity or 0.0)

            eligible = self.voter_model.get_eligible_voter_ratio(city)
            city_votes = city.population * eligible * base_turnout
            for pid, share in shares.items():
                party_votes[pid] += share * city_votes
            total_votes += city_votes

            winner_id = max(shares, key=shares.get)
            city_results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                province=city.province,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=base_turnout,
                eligible_voter_ratio=self.voter_model.get_eligible_voter_ratio(city),
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        # 政党体系集中化（全国领先党声望加成，作用于各市份额）
        city_shares = {cr.city_id: cr.vote_shares for cr in city_results}
        party_votes = self._apply_national_concentration(party_votes, city_shares, total_votes)
        total_votes = sum(party_votes.values())
        for cr in city_results:
            if cr.city_id in city_shares:
                cr.vote_shares = {pid: round(s, 4) for pid, s in city_shares[cr.city_id].items()}

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
                camp=p.camp,
            ))

        return self._build_result(city_results, party_results, total_votes,
                                  city_party_seats=city_party_seats, province_proportional=True)

    # ========== 混合制 ==========

    def _run_mmp(self) -> ElectionResult:
        """混合成员比例代表制 (MMP)：选区席 + 名单席补位到比例代表

        真实 MMP 允许超额席位（overhang）：若政党通过选区赢得的席位超过其
        名单比例应得份额，该党保留全部选区席，议会总席数随之膨胀
        （如德国/新西兰）。名单补位在其余政党间按比例分配。
        """
        total = self.config.total_seats
        district_total = self._district_count(total)
        list_total = total - district_total

        city_info, city_seats, party_votes, total_votes = self._district_base(district_total)
        city_winners = {cid: max(info['shares'], key=info['shares'].get) for cid, info in city_info.items()}

        district_seats = self._count_city_seats(city_seats, city_winners)
        # 各党名单比例应得席（以总席数为分母）
        ideal = self._allocate_pr(party_votes, total, threshold=self.config.threshold)
        # 选区超额：选区席超过理想席的部分 → 悬空席（overhang）
        overhang_by_party = {pid: district_seats.get(pid, 0) - ideal[pid]
                             for pid in party_votes if district_seats.get(pid, 0) > ideal[pid]}
        overhang_seats = sum(overhang_by_party.values())
        # 名单补位：先补选区未达理想席的部分；超额政党不再补
        list_seats = {pid: max(0, ideal[pid] - district_seats.get(pid, 0)) for pid in party_votes}

        # 超额政党让出的名单额（其理想席中已被选区占用的超额部分）重新分配：
        # 超额释放的名单席数额 = overhang_seats，在未超额政党间按剩余缺口补足。
        released = overhang_seats
        s = sum(list_seats.values())
        while released > 0 and s < total - district_total + overhang_seats:
            # 每轮把 1 席给当前缺口最大的未超额政党
            candidates = [p for p in list_seats if p not in overhang_by_party]
            if not candidates:
                break
            pid = max(candidates, key=lambda p: ideal[p] - district_seats.get(p, 0) - list_seats[p])
            list_seats[pid] += 1
            s += 1
            released -= 1

        # 超发名单席回退（浮点余数可能使 list 略超）
        while s > list_total + overhang_seats:
            pid = max((p for p in list_seats if list_seats[p] > 0),
                      key=lambda p: district_seats.get(p, 0) - ideal[p])
            list_seats[pid] -= 1
            s -= 1

        total_party = {pid: district_seats.get(pid, 0) + list_seats.get(pid, 0) for pid in party_votes}
        actual_total = sum(total_party.values())
        party_results = [
            PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=total_party.get(p.id, 0),
                vote_share=round(party_votes[p.id] / total_votes, 4) if total_votes > 0 else 0,
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
                camp=p.camp,
            )
            for p in self.parties
        ]

        city_results = self._build_city_results(city_info, city_winners)
        city_party_seats = {cid: {city_winners[cid]: n} for cid, n in city_seats.items() if city_winners.get(cid)}
        return self._build_result(city_results, party_results, total_votes, city_seats_map=city_seats,
                                  city_party_seats=city_party_seats, province_proportional=True,
                                  actual_total_seats=actual_total,
                                  overhang_seats=overhang_seats,
                                  overhang_by_party=overhang_by_party)

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
                camp=p.camp,
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

    def _ranked_sample_size(self, population: float) -> int:
        """按城市人口平方根缩放排名票采样数，兼顾大城代表性与小城多样性"""
        base = self.config.voter_samples
        scale = max(1.0, (population / 1_000_000) ** 0.5)
        return max(base, min(int(round(base * scale)), 400))

    def _run_ranked(self, winner_fn) -> ElectionResult:
        """IRV / 同意投票 / 波达计分 共用：每城市按人口得若干议席，城市胜者一致"""
        total = self.config.total_seats
        city_info, city_seats, party_votes, total_votes = self._district_base(total)

        city_winners = {}
        for cid, info in city_info.items():
            n = self._ranked_sample_size(info['city'].population)
            rankings = self.voter_model.sample_voter_rankings(
                info['city'], self.parties, n=n,
                noise_amplitude=self.config.noise_amplitude)
            city_winners[cid] = winner_fn(rankings)

        party_seats = self._count_city_seats(city_seats, city_winners)
        # 排名票制度：得票率以全国人口加权首偏好为口径，与席位同源
        first_shares = self._ranked_vote_shares()
        party_results = [
            PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(first_shares.get(p.id, 0.0), 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
                camp=p.camp,
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
        # STV 默认以整省为多议席选区（保留比例性）；仅当用户显式调大
        # district_magnitude 时才按该 magnitude 拆分为更小的多议席选区。
        mag = self.config.district_magnitude if (self.config.district_magnitude or 1) > 1 else 1_000_000

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
            prov_seats_n = max(1, prov_seats_map.get(prov, 1))
            # 按 magnitude 把省内城市聚合成多个多议席选区
            districts = self._group_cities_into_districts(cities, prov_seats_n, mag)
            prov_winners = {}
            for group, seats_n in districts:
                ballots = []
                ballot_weights = []
                for c in group:
                    rankings = self.voter_model.sample_voter_rankings(
                        c, self.parties, n=self.config.voter_samples,
                        noise_amplitude=self.config.noise_amplitude)
                    ballots.extend(rankings)
                    # 城市人口加权：大城市选票权重更高，避免被小城等权稀释
                    ballot_weights.extend([max(1.0, float(c.population))] * len(rankings))
                    first_prefs = {p.id: 0 for p in self.parties}
                    for ranking in rankings:
                        if ranking:
                            first_prefs[ranking[0]] += 1
                    city_winners[c.id] = max(first_prefs, key=first_prefs.get)
                    prov_winners[c.id] = max(first_prefs, key=first_prefs.get)
                prov_seats = self._stv_province(ballots, seats_n, ballot_weights)
                for pid, n in prov_seats.items():
                    province_party_seats[prov] = province_party_seats.get(prov, {})
                    province_party_seats[prov][pid] = province_party_seats[prov].get(pid, 0) + n
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
            comp = 1.0 - self._top_margin(shares)
            city_results.append(CityResult(
                city_id=city.id,
                city_name=city.name,
                province=city.province,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=self.voter_model.get_city_turnout(
                    city, self.config.urban_rural_weight,
                    competitiveness=comp,
                    abstention_sensitivity=self.config.abstention_sensitivity or 0.0),
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))

        party_results = []
        # 排名票制度：得票率以全国人口加权首偏好为口径，与席位同源
        first_shares = self._ranked_vote_shares()
        for p in self.parties:
            party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=party_seats.get(p.id, 0),
                vote_share=round(first_shares.get(p.id, 0.0), 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
                camp=p.camp,
            ))

        return self._build_result(city_results, party_results, 0,
                                  city_party_seats=city_party_seats,
                                  province_party_seats=province_party_seats)

    def _ranked_vote_shares(self) -> dict[str, float]:
        """全国人口加权首偏好得票率（与排名票制度席位同源）"""
        first = {p.id: 0.0 for p in self.parties}
        total = 0.0
        for city in self.city_data.cities:
            for ranking in self.voter_model.sample_voter_rankings(
                    city, self.parties, n=self.config.voter_samples,
                    noise_amplitude=self.config.noise_amplitude):
                if ranking:
                    first[ranking[0]] += city.population
                total += city.population
        if total <= 0:
            return {p.id: 1.0 / len(self.parties) for p in self.parties}
        return {pid: v / total for pid, v in first.items()}

    def _group_cities_into_districts(self, cities: list, prov_seats: int, mag: int) -> list:
        """把省内城市按人口聚合成多议席选区（每选区 mag 席）。

        贪心：累加城市人口直到累计席位达到 mag，切成一个选区。
        剩余城市并入最后一个选区，保证席位数总和 = prov_seats。
        返回 [(cities 子列表, seats_n), ...]
        """
        n = len(cities)
        if n <= 0:
            return []
        if prov_seats <= mag or n <= 1:
            return [(cities, prov_seats)]
        # 拆成 n_full 个 mag 席选区 + 1 个余数选区（余数为 0 则无尾区）
        n_full, rem = divmod(prov_seats, mag)
        seat_per_district = [mag] * n_full
        if rem > 0:
            seat_per_district.append(rem)
        n_districts = len(seat_per_district)
        # 按人口把城市分进 n_districts 个连续组
        total_pop = sum(c.population for c in cities)
        groups = []
        idx = 0
        for d in range(n_districts):
            target = (d + 1) * total_pop / n_districts
            acc = 0
            group = []
            while idx < n and acc + cities[idx].population <= target + 1:
                group.append(cities[idx])
                acc += cities[idx].population
                idx += 1
            if not group:
                if idx < n:
                    group.append(cities[idx])
                    idx += 1
            groups.append(group)
        # 剩余城市并入最后一组
        if idx < n:
            groups[-1].extend(cities[idx:])
        result = [(g, seat_per_district[d]) for d, g in enumerate(groups) if g]
        # 兜底：若分组结果为空或席位数不足，退回单一选区
        total_seats_assigned = sum(s for _, s in result)
        if total_seats_assigned != prov_seats or not result:
            return [(cities, prov_seats)]
        return result

    def _stv_province(self, ballots: list[list[str]], seats: int,
                      ballot_weights: list[float] = None) -> dict[str, int]:
        """
        STV（省级多议席，政党可连任）：Droop 配额 + 盈余降权转移 + 末位淘汰。

        政党每次当选占用一个议席；当选后其票重按 (votes-quota)/votes 收缩，
        盈余继续参与后续轮次，从而支持同一政党赢得多个议席。

        ballot_weights 可传入城市人口权重，使大城市选票不被小城市稀释。
        """
        party_ids = {p.id for p in self.parties}
        weights = list(ballot_weights) if ballot_weights else [1.0] * len(ballots)
        total_weight = sum(weights)
        quota = math.floor(total_weight / (seats + 1)) + 1
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
                if v >= quota:
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
            shares = self.voter_model.compute_vote_shares(city, self.parties, self.config.noise_amplitude)
            shares = self._adjust_shares_for_urban_rural(shares, city)
            # 名单席位/比例代表反映"真实偏好"；选区席赢者通吃才受弃保影响
            honest = dict(shares)
            shares = self._apply_tactical_voting(shares, city)
            # 竞争度调节投票率（abstention_sensitivity）：与 FPTP 口径一致
            comp = 1.0 - self._top_margin(shares)
            turnout = self.voter_model.get_city_turnout(
                city, self.config.urban_rural_weight,
                competitiveness=comp,
                abstention_sensitivity=self.config.abstention_sensitivity or 0.0)
            eligible = self.voter_model.get_eligible_voter_ratio(city)
            city_votes = city.population * eligible * turnout
            for pid, share in honest.items():
                party_votes[pid] += share * city_votes
            total_votes += city_votes
            city_info[city.id] = {
                'city': city,
                'shares': shares,
                'turnout': turnout,
                'eligible_voter_ratio': eligible,
                'city_votes': city_votes,
            }

        # 政党体系集中化：全国领先党声望加成，作用于"真实偏好"得票与各市份额
        city_shares = {cid: info['shares'] for cid, info in city_info.items()}
        party_votes = self._apply_national_concentration(party_votes, city_shares, total_votes)
        total_votes = sum(party_votes.values())
        for cid, shares in city_shares.items():
            city_info[cid]['shares'] = shares

        min_seats = min(self.config.min_seats_per_city, district_total // max(1, len(city_info)))
        city_seats = self._largest_remainder_seats(
            {cid: info['city'].population for cid, info in city_info.items()},
            district_total,
            min_seats=min_seats,
        )
        # 分裂选票：选区票（弃保后，按投票人口加权）vs 名单票（party_votes / total_votes）
        district_agg = {p.id: 0.0 for p in self.parties}
        for info in city_info.values():
            cv = info['city_votes']
            for pid, s in info['shares'].items():
                district_agg[pid] += s * cv
        self._split_ticket_cache = {}
        for pid in party_votes:
            list_share = party_votes[pid] / total_votes if total_votes > 0 else 0.0
            dist_share = district_agg[pid] / total_votes if total_votes > 0 else 0.0
            self._split_ticket_cache[pid] = round((list_share - dist_share) * 100, 2)
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
                province=city.province,
                winner_party_id=winner_id,
                winner_party_name=self.party_map[winner_id].name,
                vote_shares={pid: round(s, 4) for pid, s in shares.items()},
                turnout=info['turnout'],
                eligible_voter_ratio=info.get('eligible_voter_ratio', 0.0),
                affinities=self.voter_model.get_city_affinities(city, self.parties, self.config.noise_amplitude),
                dimensions=self.voter_model.get_city_dimensions(city),
            ))
        return results

    def _integer_votes_for_city(self, cr: CityResult) -> tuple[dict[str, int], int]:
        """
        将城市得票率转为整数票数（真实选举公报形态）。

        用最大余数法（Hamilton 法）：先按份额取整，把剩余票按小数部分从大到小
        逐个分配给各党，保证各党票数总和恰为该市总票数。总票数 =
        人口 × 适龄占比 × 投票率，取整。
        """
        city = next((c for c in self.city_data.cities if c.id == cr.city_id), None)
        if city is None:
            return {}, 0
        total = int(city.population * (cr.eligible_voter_ratio or 0.78) * (cr.turnout or 0.6))
        if total <= 0 or not cr.vote_shares:
            return {}, 0
        raw = {pid: share * total for pid, share in cr.vote_shares.items()}
        votes = {pid: int(v) for pid, v in raw.items()}
        diff = sum(votes.values()) - total
        if diff > 0:
            # 份额 4 位舍入使总和略超 1：反复从小数部分最小的政党回退
            order = sorted(raw.items(), key=lambda kv: kv[1] - int(kv[1]))
            idx = 0
            while diff > 0:
                pid = order[idx % len(order)][0]
                if votes[pid] > 0:
                    votes[pid] -= 1
                    diff -= 1
                idx += 1
        elif diff < 0:
            # 最大余数法：把不足的部分按小数部分从大到小逐个分配给各党
            order = sorted(raw.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True)
            idx = 0
            while diff < 0:
                pid = order[idx % len(order)][0]
                votes[pid] += 1
                diff += 1
                idx += 1
        return votes, total

    def _build_result(self, city_results: list[CityResult], party_results: list[PartySeatResult],
                      total_votes: float, city_seats_map: dict = None,
                      city_party_seats: dict = None, province_party_seats: dict = None,
                      province_proportional: bool = False,
                      actual_total_seats: int = None,
                      overhang_seats: int = 0,
                      overhang_by_party: dict = None) -> ElectionResult:
        eff_total = actual_total_seats or self.config.total_seats
        # 选举效率：每获 1% 议席所需票%（<1 过代表，>1 欠代表；0 席→高值）
        for pr in party_results:
            seat_share = (pr.seats / eff_total) if eff_total > 0 else 0.0
            pr.vote_efficiency = round(pr.vote_share / seat_share, 3) if seat_share > 0 else 99.0
        # 胜者红利：首党席位%-得票%（政治学经典制度指标）
        if party_results:
            top = max(party_results, key=lambda p: p.seats)
            winner_bonus = round((top.seats / eff_total) - top.vote_share, 3) if eff_total > 0 else 0.0
        else:
            winner_bonus = 0.0
        # 分裂选票：名单票（真实偏好 = party_results.vote_share）vs 选区票（弃保后聚合）
        split_ticket = self._compute_split_ticket(party_results)
        province_results = self._aggregate_provinces(city_results)
        if city_seats_map:
            for cr in city_results:
                cr.seats = city_seats_map.get(cr.city_id, cr.seats)
        if city_party_seats:
            for cr in city_results:
                ps = city_party_seats.get(cr.city_id)
                if ps:
                    cr.party_seats = ps
        # 数据投票真实性：整数票数（真实选举公报形态）
        if self.config.integer_votes:
            for cr in city_results:
                votes, total = self._integer_votes_for_city(cr)
                if total > 0:
                    cr.votes = votes
                    cr.total_votes = total
            # 全国公报口径：总票数 = 各市整数票之和（而非浮点 share 累积）
            sum_city_votes = sum(cr.total_votes for cr in city_results)
            if sum_city_votes > 0:
                total_votes = sum_city_votes
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
        uh_party_results, uh_province_results, uh_total = self._compute_upper_house(province_results, party_results)
        env, ens, gallagher = self._compute_diversity_metrics(party_results)
        lh, rose, mal, pns = self._compute_additional_indices(party_results, province_results)
        decomp = self._compute_disprop_decomposition(party_results, province_results)
        classification, classification_detail = self._classify_party_system(party_results, actual_total_seats or self.config.total_seats, env)
        polarization = self._compute_polarization(party_results)
        regional_blocks = self._compute_regional_blocks(province_results, party_results)
        median_voter = self._compute_median_voter(party_results)
        party_niches = self._compute_party_niches(party_results, city_results)
        return ElectionResult(
            config_name=self.config.name,
            system_type=self.config.system_type,
            total_seats=actual_total_seats or self.config.total_seats,
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
            party_system_classification=classification,
            party_system_classification_detail=classification_detail,
            polarization_index=polarization,
            regional_blocks=regional_blocks,
            overhang_seats=overhang_seats,
            overhang_by_party=overhang_by_party or {},
            split_ticket=split_ticket,
            median_voter_alignment=median_voter,
            winner_bonus=winner_bonus,
            party_niches=party_niches,
        )

    def _compute_polarization(self, party_results: list[PartySeatResult]) -> float:
        """议会极化度：席位加权意识形态标准差（economic + social 两轴 0-1 空间）。

        衡量议会光谱的两极化程度——政党立场越分散、席位越向两极集中，极化度越高。
        """
        import math
        total_seats = sum(p.seats for p in party_results)
        if total_seats <= 0:
            return 0.0
        dims = ['economic_position', 'social_position']
        sd_sum = 0.0
        for d in dims:
            mean = sum(getattr(p, d, 0.0) * p.seats for p in party_results) / total_seats
            var = sum(p.seats * (getattr(p, d, 0.0) - mean) ** 2 for p in party_results) / total_seats
            sd_sum += math.sqrt(var)
        return round(sd_sum / len(dims), 4)

    def _compute_regional_blocks(self, province_results: list[ProvinceResult],
                                 party_results: list[PartySeatResult]) -> list[RegionalBlock]:
        """区域政治集团：按各省赢家归纳政治地理版图，并打上地理标签。

        真实政治地理分析中，同一政党赢得的相邻省份常构成稳定的"选区集团/带"
        （如铁锈带、阳光地带）。按赢家聚合并标注人口/席位规模。
        """
        pname = {p.party_id: p.party_name for p in party_results}
        pcolor = {p.party_id: p.color for p in party_results}
        blocks = {}
        for pr in province_results:
            wid = pr.winner_party_id
            blk = blocks.setdefault(wid, {
                'party_id': wid, 'provinces': [], 'seats': 0, 'pop': 0,
            })
            blk['provinces'].append(pr.province_name)
            blk['seats'] += pr.seats
            blk['pop'] += pr.population
        out = []
        for wid, blk in blocks.items():
            out.append(RegionalBlock(
                party_id=wid,
                party_name=pname.get(wid, wid),
                color=pcolor.get(wid, ''),
                province_count=len(blk['provinces']),
                total_seats=blk['seats'],
                total_population=blk['pop'],
                provinces=blk['provinces'],
                block_label=self._regional_block_label(blk['provinces']),
            ))
        out.sort(key=lambda b: b.total_seats, reverse=True)
        return out

    def _regional_block_label(self, provinces: list[str]) -> str:
        """基于省份集合给出政治地理标签（启发式规则）"""
        coastal = {'北京市', '上海市', '天津市', '广东省', '浙江省', '江苏省', '福建省',
                   '山东省', '辽宁省', '河北省', '海南省', '广西壮族自治区'}
        western = {'新疆维吾尔自治区', '西藏自治区', '青海省', '甘肃省', '宁夏回族自治区',
                   '内蒙古自治区', '云南省', '贵州省', '四川省', '重庆市', '陕西省'}
        n_coastal = sum(1 for p in provinces if p in coastal)
        n_western = sum(1 for p in provinces if p in western)
        n = len(provinces)
        if n == 0:
            return ''
        if n_coastal >= n * 0.7:
            return '沿海带'
        if n_western >= n * 0.7:
            return '边疆西部带'
        if n_coastal >= 2 and n_western >= 2:
            return '跨区域带'
        return '区域混合'

    def _classify_party_system(self, party_results: list[PartySeatResult], total_seats: int,
                               effective_parties_vote: float) -> tuple[str, str]:
        """
        Sartori 政党体系类型学分类：基于第一大党席位主导性、得票集中度与有效政党数。

        - 一党主导制：首党独立过半席位（≥50%）
        - 主导党制：首党得票 ≥40% 且远抛次党（首/次党得票比 ≥2）
        - 两党制：有效政党数 <3.5 且次党有竞争性（次党得票 ≥20%）
        - 温和多党制：有效政党数 <5
        - 碎片化多党制：有效政党数 ≥5
        """
        if not party_results:
            return "无有效结果", "无政党数据"
        ranked = sorted(party_results, key=lambda p: p.vote_share, reverse=True)
        top = ranked[0]
        second = ranked[1] if len(ranked) > 1 else None
        top_seat_share = (top.seats / total_seats) if total_seats else 0
        top_vote = top.vote_share
        second_vote = second.vote_share if second else 0
        n_eff = effective_parties_vote
        ratio = (top_vote / second_vote) if second_vote > 0 else 99

        detail = (f"首党{top.party_name}席位{top_seat_share * 100:.0f}%（{top.seats}/{total_seats}）、"
                  f"得票{top_vote * 100:.0f}%；次党得票{second_vote * 100:.0f}%；有效政党数{n_eff:.1f}")

        if top_seat_share >= 0.5:
            return "一党主导制", detail
        if top_vote >= 0.40 and ratio >= 2.0:
            return "主导党制", detail
        if n_eff < 3.5 and second_vote >= 0.20:
            return "两党制", detail
        if n_eff < 5.0:
            return "温和多党制", detail
        return "碎片化多党制", detail

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
        total_pop = sum(pr.population for pr in province_results) or 1
        for p in party_results:
            nat = p.vote_share
            dev = 0.0
            for pr in province_results:
                # 按省人口份额加权：偏差有界于 2·nat·(1-nat)，保证 PNS∈[0,1]
                w = pr.population / total_pop
                prov_vote = pr.vote_shares.get(p.party_id, 0)
                dev += w * abs(prov_vote - nat)
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

    def _compute_upper_house(self, province_results: list[ProvinceResult], lower_party_results: list[PartySeatResult] = None) -> tuple[list[PartySeatResult], list[ProvinceResult], int]:
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
        lower_share = {}
        if lower_party_results:
            lower_share = {pr.party_id: pr.vote_share for pr in lower_party_results}
        for p in self.parties:
            vote_share = lower_share.get(p.id)
            if vote_share is None:
                vote_share = uh_party_seats.get(p.id, 0) / max(1, uh_seats)
            uh_party_results.append(PartySeatResult(
                party_id=p.id,
                party_name=p.name,
                seats=uh_party_seats.get(p.id, 0),
                vote_share=round(vote_share, 4),
                color=p.color,
                economic_position=p.economic_position,
                social_position=p.social_position,
                camp=p.camp,
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
