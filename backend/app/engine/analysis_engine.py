"""
选举分析工具集：统一摆动（Swingometer）、浪费票（Wasted Votes）、
代表性缺口（Representation Gap）。
"""
import math
from app.engine import ElectoralEngine


def _seat_structure_similarity(prev: dict, curr: dict) -> float:
    """相邻年代席位结构相似度：席位份额向量的余弦相似度（1=完全一致）。"""
    keys = set(prev) | set(curr)

    def norm(d):
        tot = sum(d.get(k, 0) for k in keys)
        return {k: d.get(k, 0) / tot for k in keys} if tot > 0 else {k: 0.0 for k in keys}

    a, b = norm(prev), norm(curr)
    dot = sum(a[k] * b[k] for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (na * nb)


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


def party_space_competition(city_data, parties, config, party_id: str,
                            axis: str = "economic", step: float = 0.25):
    """政党空间竞争模拟（Downsian 空间竞争博弈）。

    经典空间竞争理论：政党为赢得选票移动意识形态立场。对目标党沿指定轴
    扫描立场 -1..1，每次重跑选举记录得票/席位/首党归属，绘制「立场→
    选举回报」响应曲线，展示中间选民定理的博弈含义。
    """
    from app.models.party import Party
    axis_attr = {
        "economic": "economic_position",
        "social": "social_position",
        "regional": "regional_position",
        "welfare": "welfare_position",
        "environment": "environment_position",
        "nationalism": "nationalism_position",
        "urban_rural": "urban_rural_position",
    }.get(axis, "economic_position")

    base_engine = ElectoralEngine(city_data, parties, config, seed=42)
    base = base_engine.run()
    base_result = next(p for p in base.party_results if p.party_id == party_id)
    positions = [round(x, 2) for x in
                 [i * step for i in range(-4, 5)]]
    # 去重 + 保证覆盖 -1..1
    if positions[0] != -1.0:
        positions.insert(0, -1.0)
    if positions[-1] != 1.0:
        positions.append(1.0)
    positions = sorted(set(positions))

    points = []
    for pos in positions:
        moved = []
        for p in parties:
            if p.id == party_id:
                data = p.model_dump()
                data[axis_attr] = pos
                moved.append(Party(**data))
            else:
                moved.append(p)
        r = ElectoralEngine(city_data, moved, config, seed=42).run()
        target = next((x for x in r.party_results if x.party_id == party_id), None)
        top = max(r.party_results, key=lambda p: p.seats)
        points.append({
            "position": pos,
            "vote_share": round(target.vote_share, 4) if target else 0.0,
            "seats": target.seats if target else 0,
            "top_party_id": top.party_id,
            "top_party_name": top.party_name,
            "majority": any(p.seats > r.total_seats / 2 for p in r.party_results),
        })

    best = max(points, key=lambda x: x["seats"])
    return {
        "party_id": party_id,
        "axis": axis,
        "base_position": getattr(base_result, axis_attr, 0.0),
        "base_seats": base_result.seats,
        "base_vote_share": round(base_result.vote_share, 4),
        "points": points,
        "optimal_position": best["position"],
        "optimal_seats": best["seats"],
    }


ISSUE_DIMENSIONS = [
    ("economic", "经济", "国家干预↔市场自由", "economic_position"),
    ("social", "社会", "传统集体↔现代个人", "social_position"),
    ("regional", "区域", "本土内陆↔国际化沿海", "regional_position"),
    ("welfare", "福利", "低福利↔高福利再分配", "welfare_position"),
    ("environment", "环境", "发展优先↔环保优先", "environment_position"),
    ("nationalism", "民族", "国际主义↔民族主义", "nationalism_position"),
    ("urban_rural", "城乡", "农村利益↔城市利益", "urban_rural_position"),
]


def issue_ownership(city_data, parties, config):
    """议题所有权（Issue Ownership）：各党在 7 个政策维度上谁最受选民信任。

    对每个城市，用该维度距中位选民的亲和度判断该党是否"拥有"此议题；
    聚合全国后得到每个党在每个维度的所有权强度（该维度上亲和度最高、
    且与对手拉开差距的程度），识别各党议题招牌与空白领域。
    """
    from app.engine.voter_model import VoterModel
    from app.models.party import Party

    vm = VoterModel(seed=42, turnout_shift=config.turnout_shift,
                    dim_tilt=config.dim_tilt or {},
                    party_effects=config.party_effects or {},
                    voter_stratification=config.voter_stratification,
                    calibration=config.calibration,
                    affinity_power=config.affinity_power)

    # 每党每维度的所有权得分：城市加权的"该维度亲和度超均值幅度"
    dim_means = {d[0]: 0.0 for d in ISSUE_DIMENSIONS}
    counts = {d[0]: 0 for d in ISSUE_DIMENSIONS}
    for city in city_data.cities:
        dims = vm.get_city_dimensions(city)
        for dk, _l, _d, attr in ISSUE_DIMENSIONS:
            dim_means[dk] += dims.get(dk, 0.0)
            counts[dk] += 1
    for dk in dim_means:
        dim_means[dk] = dim_means[dk] / max(1, counts[dk])

    # 各党在各维度的"覆盖 + 极端度"（城市加权）
    ownership = {p.id: {dk: 0.0 for dk, *_ in ISSUE_DIMENSIONS} for p in parties}
    city_weights = 0.0
    for city in city_data.cities:
        w = float(city.population)
        city_weights += w
        dims = vm.get_city_dimensions(city)
        # 每维度：立场最接近该维度城市中位的党 = 该维度领跑者
        for dk, _l, _d, attr in ISSUE_DIMENSIONS:
            city_pos = dims.get(dk, 0.0)
            # 该党在此维度与该城市偏好的一致性（距离的反向）
            for p in parties:
                ppos = getattr(p, attr, 0.0)
                match = 1.0 - abs(ppos - city_pos)
                ownership[p.id][dk] += match * w
    for p in parties:
        for dk, *_ in ISSUE_DIMENSIONS:
            ownership[p.id][dk] = round(ownership[p.id][dk] / max(1.0, city_weights), 4)

    # 每个维度领跑者（所有权最高）与亚军差距
    dims_result = []
    for dk, label, desc, attr in ISSUE_DIMENSIONS:
        ranked = sorted(parties, key=lambda p: -ownership[p.id][dk])
        top, second = ranked[0], ranked[1]
        margin = round(ownership[top.id][dk] - ownership[second.id][dk], 4)
        dims_result.append({
            "dimension": dk,
            "label": label,
            "description": desc,
            "owner_party_id": top.id,
            "owner_party_name": top.name,
            "owner_color": top.color,
            "owner_score": ownership[top.id][dk],
            "runner_up_party_id": second.id,
            "runner_up_party_name": second.name,
            "margin": margin,
            "party_scores": {p.id: ownership[p.id][dk] for p in parties},
        })

    # 各党专属议题（唯一领跑）与空白（无领跑）
    owned = {p.id: [] for p in parties}
    for d in dims_result:
        owned[d["owner_party_id"]].append(d["label"])
    party_summary = []
    for p in parties:
        party_summary.append({
            "party_id": p.id,
            "party_name": p.name,
            "color": p.color,
            "owned_issues": owned[p.id],
            "owned_count": len(owned[p.id]),
        })
    party_summary.sort(key=lambda x: -x["owned_count"])
    return {
        "dimensions": dims_result,
        "parties": party_summary,
        "note": "议题所有权 = 政党在特定政策领域被选民视为最可信赖、最有能力处理的一方（Stokes 议题所有权理论）",
    }


def district_magnitude_effect(city_data, parties, config):
    """选区规模效应：扫描每选区议席数（magnitude），观察政党碎片化/首党变化。

    Duverger 定律的选区层面推论：选区议席规模越大（多议席制），政党碎片化
    越严重（有效政党数上升）、首党份额下降——小党派凭低门槛进入议会。
    """
    base_mag = config.district_magnitude or 1
    mags = [1, 2, 3, 5, 7]
    if base_mag not in mags:
        mags.append(base_mag)
    mags = sorted(mags)
    results = []
    for mag in mags:
        cfg = config.model_copy(update={"system_type": "STV", "district_magnitude": mag})
        try:
            r = ElectoralEngine(city_data, parties, cfg, seed=42).run()
            top = max(r.party_results, key=lambda p: p.seats)
            results.append({
                "magnitude": mag,
                "effective_parties_vote": round(r.effective_parties_vote, 2),
                "effective_parties_seats": round(r.effective_parties_seats, 2),
                "top_party_id": top.party_id,
                "top_party_name": top.party_name,
                "top_seats": top.seats,
                "top_vote": round(top.vote_share, 4),
                "gallagher": round(r.gallagher_index, 4),
            })
        except Exception as e:
            results.append({"magnitude": mag, "error": str(e)})
    return {"results": results}


def party_system_freeze(city_data, parties, config):
    """政党体系冻结度（Lipset-Rokkan 冻结假说）：跨年代席位结构稳定性。

    用 1949-2024 的研究年代库沿时间轴运行相同配置，比较各党席位的
    跨年代相关系数/波动，判断体系是"冻结"（党派结构稳定）还是
    "松动"（结构性重组）。
    """
    from app.engine.eras import ERA_LIBRARY
    from app.engine import DataLoader

    dl = DataLoader()
    years = [e["year"] for e in ERA_LIBRARY]
    era_runs = []
    prev_seats = None
    transitions = []
    for year in years:
        data = dl.get_city_data(year)
        r = ElectoralEngine(data, parties, config, seed=42).run()
        seat_map = {p.party_id: p.seats for p in r.party_results}
        vote_map = {p.party_id: p.vote_share for p in r.party_results}
        top = max(r.party_results, key=lambda p: p.seats)
        era_info = next((e for e in ERA_LIBRARY if e["year"] == year), {})
        era_runs.append({
            "year": year,
            "era_label": era_info.get("name", str(year)),
            "party_seats": seat_map,
            "party_votes": vote_map,
            "top_party_id": top.party_id,
            "top_party_name": top.party_name,
            "gallagher": round(r.gallagher_index, 4),
            "effective_parties_seats": round(r.effective_parties_seats, 2),
        })
        if prev_seats is not None:
            # 相邻年代席位份额向量的余弦相似度（结构相似度，1 = 完全冻结）
            sim = _seat_structure_similarity(prev_seats, seat_map)
            transitions.append(round(sim, 3))
        prev_seats = seat_map

    # 冻结度 = 相邻年代席位结构相似度的均值（1 = 完全冻结）
    freeze_index = round(sum(transitions) / len(transitions), 3) if transitions else 0.0
    # 第一大党保持率
    top_unchanged = sum(1 for i in range(1, len(era_runs))
                        if era_runs[i]["top_party_id"] == era_runs[i - 1]["top_party_id"])
    top_retention = round(top_unchanged / max(1, len(era_runs) - 1), 3)

    first = era_runs[0] if era_runs else None
    last = era_runs[-1] if era_runs else None
    return {
        "runs": era_runs,
        "freeze_index": freeze_index,
        "top_party_retention": top_retention,
        "first_year": first,
        "last_year": last,
        "note": f"冻结度 {freeze_index}（1=政党格局完全冻结）· 首党保持率 {top_retention}（Lipset-Rokkan 冻结假说）",
    }