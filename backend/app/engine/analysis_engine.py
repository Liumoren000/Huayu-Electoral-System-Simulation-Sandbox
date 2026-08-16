"""
选举分析工具集：统一摆动（Swingometer）、浪费票（Wasted Votes）、
代表性缺口（Representation Gap）。
"""
import math
from app.engine import ElectoralEngine


def swingometer_analysis(city_data, parties, config, party_id: str,
                         max_swing: float = 12.0, step: float = 1.0):
    """统一摆动分析：对目标党全国得票统一增减 ±max_swing pp，绘制席位-选票曲线。

    经典选情学（Swingometer）：多数制下选票小幅摆动经胜者全得放大为席位
    非线性变化（凸曲线），比例制则近似直线。返回各摆动点席位/得票，
    并识别「翻转阈值」（首次席位变化的摆动点）与「过半摆动」。
    """
    swings = []
    base_engine = ElectoralEngine(city_data, parties, config, seed=42)
    base_result = base_engine.run()
    base_seats = {p.party_id: p.seats for p in base_result.party_results}
    base_vote = {p.party_id: p.vote_share for p in base_result.party_results}

    steps = []
    s = -max_swing
    while s <= max_swing + 1e-9:
        steps.append(round(s, 1))
        s += step
    if steps[-1] != max_swing:
        steps.append(max_swing)

    for pp in steps:
        cfg = config.model_copy(update={"swing_party": party_id, "swing_pp": pp})
        r = ElectoralEngine(city_data, parties, cfg, seed=42).run()
        target = next((p for p in r.party_results if p.party_id == party_id), None)
        seats = target.seats if target else 0
        vote = target.vote_share if target else 0.0
        top = max(r.party_results, key=lambda p: p.seats)
        swings.append({
            "swing_pp": pp,
            "vote_share": round(vote, 4),
            "seats": seats,
            "seat_share": round(seats / r.total_seats, 4) if r.total_seats else 0.0,
            "top_party_id": top.party_id,
            "top_party_name": top.party_name,
            "majority": any(p.seats > r.total_seats / 2 for p in r.party_results),
        })

    # 翻转阈值：与基准（0 swing）相比席位变化的首次摆动点（正/负方向）
    flip_points = []
    for pp in steps:
        pt = next(x for x in swings if x["swing_pp"] == pp)
        if pt["seats"] != base_seats.get(party_id, 0):
            flip_points.append({
                "swing_pp": pp,
                "seats": pt["seats"],
                "vote_share": pt["vote_share"],
                "delta_seats": pt["seats"] - base_seats.get(party_id, 0),
            })

    # 过半阈值：该党席位首次超过半数的摆动点
    majority_point = None
    for pt in swings:
        if pt["majority"] and pt["top_party_id"] == party_id:
            majority_point = {
                "swing_pp": pt["swing_pp"],
                "seats": pt["seats"],
                "vote_share": pt["vote_share"],
            }
            break

    return {
        "party_id": party_id,
        "base_seats": base_seats.get(party_id, 0),
        "base_vote_share": round(base_vote.get(party_id, 0.0), 4),
        "total_seats": base_result.total_seats,
        "points": swings,
        "flip_points": flip_points,
        "majority_point": majority_point,
    }


def wasted_votes_analysis(city_data, parties, config):
    """浪费票分析：多数制下投给非赢家的票 + 赢家超出第二名之盈余。

    FPTP 等赢者全得制度中，浪费票 = 失败者得票 + 赢家盈余（超过次席部分）。
    比例制中浪费票仅来自未过门槛的政党。逐党统计并对比 FPTP vs PR。
    """
    def _compute(system_type):
        cfg = config.model_copy(update={"system_type": system_type})
        engine = ElectoralEngine(city_data, parties, cfg, seed=42)
        result = engine.run()
        total_votes = max(1, result.total_votes)
        wasted = {p.id: 0.0 for p in parties}
        surplus = {p.id: 0.0 for p in parties}
        loser_votes = {p.id: 0.0 for p in parties}
        if system_type == "PR":
            # 比例制：浪费票 = 未获席位政党的得票（门槛以下/未达配额）
            vote_by_id = {pr.party_id: pr.vote_share for pr in result.party_results}
            seat_by_id = {pr.party_id: pr.seats for pr in result.party_results}
            for pid, v in vote_by_id.items():
                if seat_by_id.get(pid, 0) == 0:
                    wasted[pid] = v
            total_wasted = sum(wasted.values())
            rows = []
            for p in parties:
                wasted_v = wasted.get(p.id, 0.0)
                rows.append({
                    "party_id": p.id,
                    "party_name": p.name,
                    "color": p.color,
                    "wasted_share": round(wasted_v, 4),
                    "surplus_share": 0.0,
                    "loser_share": round(wasted_v, 4),
                    "wasted_votes": round(wasted_v * total_votes),
                })
            rows.sort(key=lambda r: -r["wasted_votes"])
            return {
                "system_type": system_type,
                "total_wasted_share": round(total_wasted, 4),
                "total_wasted_votes": int(total_wasted * total_votes),
                "total_votes": int(total_votes),
                "parties": rows,
            }
        for cr in result.city_results:
            votes = cr.vote_shares  # 得票率
            if not votes:
                continue
            ranked = sorted(votes.items(), key=lambda kv: kv[1], reverse=True)
            city_votes = cr.turnout * cr.eligible_voter_ratio  # 归一化人口系数
            # 用相对比例计算，不依赖真实票数（得票率为份额）
            winner_id, top = ranked[0]
            runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
            winner_share = top
            surplus_share = max(0.0, winner_share - runner_up)
            for pid, share in votes.items():
                if pid != winner_id:
                    wasted[pid] += share
                    loser_votes[pid] += share
                else:
                    wasted[pid] += surplus_share
                    surplus[pid] += surplus_share
        n_cities = max(1, len(result.city_results))
        rows = []
        for p in parties:
            rows.append({
                "party_id": p.id,
                "party_name": p.name,
                "color": p.color,
                "wasted_share": round(wasted.get(p.id, 0.0) / n_cities, 4),
                "surplus_share": round(surplus.get(p.id, 0.0) / n_cities, 4),
                "loser_share": round(loser_votes.get(p.id, 0.0) / n_cities, 4),
                "wasted_votes": round(wasted.get(p.id, 0.0) / n_cities * total_votes),
            })
        rows.sort(key=lambda r: -r["wasted_votes"])
        total_wasted = sum(wasted.values()) / n_cities
        return {
            "system_type": system_type,
            "total_wasted_share": round(total_wasted, 4),
            "total_wasted_votes": int(total_wasted * total_votes),
            "total_votes": int(total_votes),
            "parties": rows,
        }

    fptp = _compute("FPTP")
    pr = _compute("PR")
    return {"fptp": fptp, "pr": pr}


def representation_gap_analysis(city_data, parties, config):
    """代表性缺口：各人口群体（年龄/教育/城乡/收入）的政策立场
    与执政党/中位选民的距离，识别「谁最不被代表」。

    群体立场 = 城市基准维度 + 群体偏好偏移，按人口加权取中位。
    距离 = 群体立场与执政党立场（经济+社会两轴曼哈顿距离）。
    """
    from app.engine.voter_model import VoterModel

    vm = VoterModel(seed=42, turnout_shift=config.turnout_shift,
                    dim_tilt=config.dim_tilt or {},
                    party_effects=config.party_effects or {},
                    voter_stratification=config.voter_stratification,
                    calibration=config.calibration,
                    affinity_power=config.affinity_power)
    result = ElectoralEngine(city_data, parties, config, seed=42).run()
    top = max(result.party_results, key=lambda p: p.seats)

    def _weighted_median(pts):
        total = sum(w for _, w in pts)
        if total <= 0:
            return 0.0
        pts.sort()
        acc = 0.0
        for v, w in pts:
            acc += w
            if acc >= total / 2.0:
                return v
        return pts[-1][0]

    # 中位选民
    econ_pts, soc_pts = [], []
    for city in city_data.cities:
        dims = vm.get_city_dimensions(city)
        econ_pts.append((dims.get('economic', 0.0), float(city.population)))
        soc_pts.append((dims.get('social', 0.0), float(city.population)))
    median_econ = _weighted_median(econ_pts)
    median_soc = _weighted_median(soc_pts)

    groups = []
    structure = vm._STRUCTURE_GROUPS
    for dim_key, dim in structure.items():
        for (gkey, glabel, _spec, offset) in dim['groups']:
            ge, gs = [], []
            for city in city_data.cities:
                dims = vm.get_city_dimensions(city)
                e = dims.get('economic', 0.0) + offset.get('economic', 0.0)
                s = dims.get('social', 0.0) + offset.get('social', 0.0)
                w = float(city.population)
                ge.append((max(-1.0, min(1.0, e)), w))
                gs.append((max(-1.0, min(1.0, s)), w))
            g_econ = _weighted_median(ge)
            g_soc = _weighted_median(gs)
            dist_gov = round(abs(g_econ - top.economic_position) + abs(g_soc - top.social_position), 3)
            dist_median = round(abs(g_econ - median_econ) + abs(g_soc - median_soc), 3)
            groups.append({
                "group_key": gkey,
                "group_label": glabel,
                "dimension": dim_key,
                "dimension_label": dim['label'],
                "economic": round(g_econ, 3),
                "social": round(g_soc, 3),
                "distance_to_government": dist_gov,
                "distance_to_median": dist_median,
            })

    # 最不被代表：到执政党距离最远、且与中位选民也远（双重偏离）
    if groups:
        worst = max(groups, key=lambda g: g["distance_to_government"])
    else:
        worst = None

    return {
        "government_party_id": top.party_id,
        "government_party_name": top.party_name,
        "government_color": top.color,
        "government_economic": top.economic_position,
        "government_social": top.social_position,
        "median_economic": round(median_econ, 3),
        "median_social": round(median_soc, 3),
        "groups": groups,
        "most_underrepresented": worst,
    }