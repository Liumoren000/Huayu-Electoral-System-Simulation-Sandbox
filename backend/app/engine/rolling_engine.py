"""
选举日实时开票 + 历史选举校准

- RollingCountEngine: 模拟选举日各选区逐步开票，随时间推进累计席位、
  实时领先党、过半可达性（实时开票直播）。
- 历史校准: 以「上一届」（默认 year-4）与不同随机种子为基准，对比本届
  结果的席位变化、城市翻盘与第一大党易主，衡量模型稳定性/波动性。
"""
import random

from app.engine import ElectoralEngine
from app.models.result import (
    RollingCountResponse, RollingCountStep,
    CalibrationResponse, CalibrationPartyRow, CalibrationCityRow,
)


class RollingCountEngine:
    def __init__(self, city_data, parties, config, steps: int = 30,
                 order_seed: int = 2023, seed: int = 42):
        self.city_data = city_data
        self.parties = parties
        self.config = config
        self.steps = steps
        self.order_seed = order_seed
        self.seed = seed

    def run(self) -> RollingCountResponse:
        engine = ElectoralEngine(self.city_data, self.parties, self.config, seed=self.seed)
        result = engine.run()
        total = self.config.total_seats
        quota = int(total / 2) + 1

        # 各选区结果（席位 + 首名党）
        city_outcomes = []
        for cr in result.city_results:
            sorted_shares = sorted(cr.vote_shares.items(), key=lambda x: x[1], reverse=True)
            city_outcomes.append({
                'city_id': cr.city_id,
                'city_name': cr.city_name,
                'winner': cr.winner_party_id,
                'party_seats': dict(cr.party_seats) if cr.party_seats else {cr.winner_party_id: 1},
                'votes': dict(cr.vote_shares),
            })

        # 开票顺序：模拟各选区投票站进度不同（随机但稳定）
        rng = random.Random(self.order_seed)
        order = list(range(len(city_outcomes)))
        rng.shuffle(order)

        # 确定每个步长开几个选区
        n = len(order)
        increments = []
        for i in range(self.steps):
            increments.append(max(1, round((i + 1) * n / self.steps) - sum(increments)))

        steps_out = []
        seats = {p.id: 0 for p in self.parties}
        votes = {p.id: 0.0 for p in self.parties}
        counted = 0

        for step_i, inc in enumerate(increments):
            for k in range(inc):
                if counted >= n:
                    break
                oc = city_outcomes[order[counted]]
                counted += 1
                for pid, s in oc['party_seats'].items():
                    seats[pid] = seats.get(pid, 0) + s
                for pid, share in oc['votes'].items():
                    votes[pid] = votes.get(pid, 0.0) + share
            if counted == 0:
                continue

            # 归一化得票
            vtotal = sum(votes.values())
            norm_votes = {pid: v / vtotal for pid, v in votes.items()} if vtotal > 0 else votes

            # 领先党
            leader = max(seats, key=lambda pid: (seats[pid], norm_votes.get(pid, 0)))
            leader_seats = seats[leader]
            second = sorted(seats.values(), reverse=True)[1] if len(seats) > 1 else 0

            # 过半可达性：剩余席位全给领先党能否过半
            remaining = n - counted
            majority_reachable = leader_seats + remaining >= quota

            steps_out.append(RollingCountStep(
                step=step_i + 1,
                counted=counted,
                total=n,
                party_seats=dict(seats),
                party_votes={pid: round(v, 4) for pid, v in norm_votes.items()},
                leader_party_id=leader,
                leader_seats=leader_seats,
                majority_reachable=majority_reachable,
                leading_margin=round(leader_seats - second, 2),
            ))

        final = steps_out[-1] if steps_out else None
        final_leader = final.leader_party_id if final else ""
        pname = {p.id: p.name for p in self.parties}

        return RollingCountResponse(
            total_seats=total,
            quota=quota,
            steps=steps_out,
            final_leader=final_leader,
            final_leader_name=pname.get(final_leader, ""),
            party_names=pname,
            party_colors={p.id: p.color for p in self.parties},
        )


def historical_calibration(city_data, parties, config, current_year: int,
                           baseline_year: int = 0, seed: int = 42):
    """对比本届与上一届选举结果（默认 baseline_year = current_year - 4）"""
    if baseline_year <= 0:
        baseline_year = max(2010, current_year - 4)
    baseline_year = min(baseline_year, current_year - 1)

    base_data = city_data  # 本届数据
    # 上一届数据：用更早年份的人口/GDP缩放近似（DataLoader 之外手工近似）
    from app.models.city import CityData

    def _scale_year(cd, year):
        if year == current_year:
            return cd
        factor = 1.0 + (year - current_year) * 0.01
        cities = []
        for c in cd.cities:
            adj = c.model_copy()
            adj.gdp_per_capita *= factor
            adj.population = int(adj.population * (1 + (year - current_year) * 0.001))
            cities.append(adj)
        return CityData(year=year, cities=cities, total_population=sum(c.population for c in cities))

    prev_data = _scale_year(base_data, baseline_year)

    # 上届用不同随机种子（"历史"的另一种实现）
    prev_engine = ElectoralEngine(prev_data, parties, config, seed=2020)
    prev_result = prev_engine.run()
    cur_engine = ElectoralEngine(base_data, parties, config, seed=seed)
    cur_result = cur_engine.run()

    prev_seats = {p.party_id: p.seats for p in prev_result.party_results}
    cur_seats = {p.party_id: p.seats for p in cur_result.party_results}
    prev_votes = {p.party_id: p.vote_share for p in prev_result.party_results}
    cur_votes = {p.party_id: p.vote_share for p in cur_result.party_results}

    party_rows = []
    for p in parties:
        party_rows.append(CalibrationPartyRow(
            party_id=p.id,
            party_name=p.name,
            color=p.color,
            prev_seats=prev_seats.get(p.id, 0),
            cur_seats=cur_seats.get(p.id, 0),
            delta=cur_seats.get(p.id, 0) - prev_seats.get(p.id, 0),
            prev_vote=round(prev_votes.get(p.id, 0.0), 4),
            cur_vote=round(cur_votes.get(p.id, 0.0), 4),
            vote_delta=round(cur_votes.get(p.id, 0.0) - prev_votes.get(p.id, 0.0), 4),
        ))

    # 城市级：赢家是否翻转
    prev_winners = {cr.city_id: cr.winner_party_id for cr in prev_result.city_results}
    cur_winners = {cr.city_id: cr.winner_party_id for cr in cur_result.city_results}
    city_rows = []
    flipped = 0
    for cr in cur_result.city_results:
        prev_win = prev_winners.get(cr.city_id, "")
        cur_win = cr.winner_party_id
        is_flip = prev_win and cur_win and prev_win != cur_win
        if is_flip:
            flipped += 1
        sorted_shares = sorted(cr.vote_shares.items(), key=lambda x: x[1], reverse=True)
        margin = (sorted_shares[0][1] - sorted_shares[1][1]) if len(sorted_shares) > 1 else 0.0
        city_rows.append(CalibrationCityRow(
            city_id=cr.city_id,
            city_name=cr.city_name,
            province=cr.province if hasattr(cr, 'province') else "",
            prev_winner=prev_win,
            cur_winner=cur_win,
            flipped=is_flip,
            margin=round(margin, 4),
        ))

    total_cities = len(city_rows)
    stability = round(1.0 - flipped / max(1, total_cities), 4)
    seat_vol = round(sum(abs(r.delta) for r in party_rows) / max(1, cur_result.total_seats), 4)

    prev_leader = max(prev_result.party_results, key=lambda x: x.seats)
    cur_leader = max(cur_result.party_results, key=lambda x: x.seats)

    pname = {p.id: p.name for p in parties}
    return CalibrationResponse(
        baseline_year=baseline_year,
        current_year=current_year,
        flipped_cities=flipped,
        total_cities=total_cities,
        stability_index=stability,
        seat_volatility=seat_vol,
        national_leader_prev=prev_leader.party_id,
        national_leader_prev_name=prev_leader.party_name,
        national_leader_cur=cur_leader.party_id,
        national_leader_cur_name=cur_leader.party_name,
        gov_changed=prev_leader.party_id != cur_leader.party_id,
        parties=party_rows,
        cities=city_rows,
    )