"""
历史选举校准

以「上一届」（默认 year-4）与不同随机种子为基准，对比本届结果的席位变化、
城市翻盘与第一大党易主，衡量模型稳定性/波动性。
"""
from app.engine import ElectoralEngine
from app.models.result import CalibrationResponse, CalibrationPartyRow, CalibrationCityRow


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