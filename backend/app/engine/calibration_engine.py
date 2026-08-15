"""
历史选举校准

以「上一届」（默认 year-4）与不同随机种子为基准，对比本届结果的席位变化、
城市翻盘与第一大党易主，衡量模型稳定性/波动性。

基准年份的城市数据统一走数据加载器的年代库（era），与沙盒其它面板
（1949/1966/1978/1992/2001/2008/2013/2020/2024）完全一致，
不再用手工 GDP 线性近似。
"""
from app.engine import ElectoralEngine, DataLoader
from app.models.result import (
    CalibrationResponse, CalibrationPartyRow, CalibrationCityRow, FlowCell,
)


def historical_calibration(parties, config, current_year: int,
                           baseline_year: int = 0, seed: int = 42,
                           data_loader: DataLoader = None):
    """对比本届与上一届选举结果（默认 baseline_year = current_year - 4）

    城市数据通过 DataLoader.get_city_data 加载，内部自动应用年代库；
    非年代收录年份回退为线性折算，与主推演同口径。
    """
    dl = data_loader or DataLoader()
    if baseline_year <= 0:
        baseline_year = max(2010, current_year - 4)
    baseline_year = min(baseline_year, current_year - 1)

    base_data = dl.get_city_data(current_year)
    prev_data = dl.get_city_data(baseline_year)

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
    flow_counts = {}
    for cr in city_rows:
        if cr.prev_winner and cr.cur_winner and cr.prev_winner != cr.cur_winner:
            key = (cr.prev_winner, cr.cur_winner)
            flow_counts[key] = flow_counts.get(key, 0) + 1
    flow_matrix = [
        FlowCell(
            prev_party_id=pw, prev_party_name=pname.get(pw, pw),
            cur_party_id=cw, cur_party_name=pname.get(cw, cw),
            count=cnt,
        )
        for (pw, cw), cnt in sorted(flow_counts.items(), key=lambda kv: -kv[1])
    ]
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
        flow_matrix=flow_matrix,
    )