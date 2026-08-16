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


DIM_LABELS = {
    "economic": "经济立场",
    "social": "社会立场",
    "regional": "区域立场",
    "welfare": "福利立场",
    "environment": "环境立场",
    "nationalism": "民族立场",
    "urban_rural": "城乡立场",
}

DIM_POLES = {
    "economic": ("国家干预/再分配", "市场自由/去管制"),
    "social": ("传统/集体主义", "现代/个人主义"),
    "regional": ("沿海/国际化", "内陆/本土化"),
    "welfare": ("低福利/自给", "高福利/再分配"),
    "environment": ("发展优先", "环保优先"),
    "nationalism": ("国际主义/多元", "民族主义/保护"),
    "urban_rural": ("农村/农业利益", "城市居民利益"),
}


def _city_structure_bullets(city) -> list[dict]:
    """把城市原始人口/经济指标翻译成可读的结构标签。"""
    bullets = []
    ur = city.urbanization_rate or 0.5
    if ur > 0.65:
        bullets.append({"label": "高度城镇化", "value": f"{ur*100:.0f}%", "note": "现代都市选民多，社会立场偏开放"})
    elif ur < 0.45:
        bullets.append({"label": "城镇化偏低", "value": f"{ur*100:.0f}%", "note": "农村/县域选民多，偏好农村利益与稳健政策"})
    else:
        bullets.append({"label": "城镇化中等", "value": f"{ur*100:.0f}%", "note": "城乡选民兼有，立场相对温和"})

    ag = city.aging_rate or 0.0
    if ag > 0.16:
        bullets.append({"label": "老龄化偏重", "value": f"{ag*100:.0f}%", "note": "老年选民比重高，更看重福利养老与稳定"})
    else:
        bullets.append({"label": "人口结构年轻", "value": f"{ag*100:.0f}%", "note": "年轻选民居多，社会立场更现代"})

    ed = city.education_index or 0.0
    if ed > 0.75:
        bullets.append({"label": "教育程度高", "value": f"{ed*100:.0f}%", "note": "高学历选民倾向市场自由与个人权利"})
    elif ed < 0.55:
        bullets.append({"label": "教育程度偏低", "value": f"{ed*100:.0f}%", "note": "低学历选民更依赖产业政策与再分配"})

    gdp = city.gdp_per_capita or 0.0
    if gdp > 120000:
        bullets.append({"label": "人均GDP高", "value": f"{gdp/10000:.1f}万", "note": "富裕地区更看重市场效率与环境"})
    elif gdp < 50000:
        bullets.append({"label": "人均GDP偏低", "value": f"{gdp/10000:.1f}万", "note": "经济压力大，偏好再分配与产业扶持"})

    sec = city.secondary_industry_pct or 0.0
    if sec > 0.45:
        bullets.append({"label": "工业主导", "value": f"{sec*100:.0f}%", "note": "产业工人多，亲近工会与产业政策"})
    ter = city.tertiary_industry_pct or 0.0
    if ter > 0.55:
        bullets.append({"label": "服务业发达", "value": f"{ter*100:.0f}%", "note": "白领与服务业主导，倾向市场与城市议题"})

    eth = getattr(city, 'ethnic_share', 0.0) or 0.0
    if eth > 0.1:
        bullets.append({"label": "少数民族占比高", "value": f"{eth*100:.0f}%", "note": "民族/区域议题显著，民族政党有稳定基本盘"})

    region_note = {
        'coastal': '沿海地区，国际化程度高，开放议题突出',
        'inland': '内陆地区，本地产业与内陆发展议题突出',
        'western': '西部民族地区，区域扶持与民族议题突出',
        'northeast': '东北老工业基地，转型压力大、产业政策诉求强',
    }.get(city.region_type, '')
    if region_note:
        bullets.append({"label": city.region_type + "地区", "value": "", "note": region_note})
    return bullets


def city_vote_explanation(city_data, parties, config, city_id: str,
                          city_result=None):
    """城市投票成因解读：为什么这座城市投给了谁。

    结合城市人口/经济结构、7 维政策偏好位置、各党亲和度分解，
    生成一份可读的「投票成因报告」——解释胜者为何胜、败者为何败、
    城市基本盘偏向何处、关键摇摆维度的权重。

    city_result: 可选，实际模拟生成的 CityResult（得票/胜者/亲和度/维度/席位）。
    传入后解读的得票、胜者与亲和度一律以实际模拟为准，避免与席位结果脱节。
    """
    from app.engine.voter_model import VoterModel

    city = next((c for c in city_data.cities if c.id == city_id), None)
    if city is None:
        return {"error": "city not found"}

    vm = VoterModel(seed=42, turnout_shift=config.turnout_shift,
                    dim_tilt=config.dim_tilt or {},
                    party_effects=config.party_effects or {},
                    voter_stratification=config.voter_stratification,
                    calibration=config.calibration,
                    affinity_power=config.affinity_power)
    expl = vm.explain_city(city, parties, config.noise_amplitude)
    city_pos = expl['city_position']

    # 全国/全省均值参照
    def avg_dim(dims_list):
        n = max(1, len(dims_list))
        return {k: sum(d.get(k, 0.0) for d in dims_list) / n for k in DIM_LABELS}

    all_dims = [vm.get_city_dimensions(c) for c in city_data.cities]
    national_dims = avg_dim(all_dims)
    prov_dims = avg_dim([vm.get_city_dimensions(c) for c in city_data.cities
                         if c.province == city.province])

    # 各党在 7 维的匹配分（explain_city 的结构分解，用于强/弱维度归因）
    party_rows = sorted(expl['parties'], key=lambda r: -r['vote_share'])
    for row in party_rows:
        dim_scores = {k: round(row.get(k, 0.0), 3) for k in DIM_LABELS}
        best = sorted(dim_scores.items(), key=lambda x: -x[1])[:2]
        worst = sorted(dim_scores.items(), key=lambda x: x[1])[:2]
        row['best_dims'] = [DIM_LABELS[k] for k, _ in best]
        row['worst_dims'] = [DIM_LABELS[k] for k, _ in worst]
        row['dim_scores'] = dim_scores

    # 实际模拟结果优先：得票 / 胜者 / 亲和度 / 席位与推演完全一致
    actual = {}
    if city_result is not None:
        actual = {
            "vote_shares": city_result.get('vote_shares') or {},
            "winner_party_id": city_result.get('winner_party_id') or '',
            "winner_party_name": city_result.get('winner_party_name') or '',
            "affinities": city_result.get('affinities') or {},
            "turnout": city_result.get('turnout') or 0.0,
            "seats": city_result.get('seats') or 0,
            "party_seats": city_result.get('party_seats') or {},
        }

    if actual.get('vote_shares'):
        # 用实际得票排序决定胜者与排序
        party_rows.sort(key=lambda r: -actual['vote_shares'].get(r['party_id'], 0.0))
        winner_id = actual['winner_party_id'] or (party_rows[0]['party_id'] if party_rows else '')
        winner = next((r for r in party_rows if r['party_id'] == winner_id), party_rows[0] if party_rows else None)
    else:
        winner = party_rows[0] if party_rows else None

    for row in party_rows:
        row['is_winner'] = bool(winner) and row['party_id'] == winner['party_id']

    # 城市最突出的立场（偏离全国最远的维度）→ 关键议题
    deviations = []
    for k in DIM_LABELS:
        dev = round(city_pos.get(k, 0.0) - national_dims.get(k, 0.0), 3)
        deviations.append((k, dev))
    key_dims = sorted(deviations, key=lambda x: abs(x[1]), reverse=True)[:3]

    if not winner:
        return {"error": "city not found"}

    # 叙事段落（使用实际得票/胜者）
    narrative = _build_city_narrative(city, city_pos, party_rows, key_dims,
                                      national_dims, prov_dims, winner, actual)

    return {
        "city": {
            "id": city.id,
            "name": city.name,
            "province": city.province,
            "population": city.population,
            "region_type": city.region_type,
        },
        "structure": _city_structure_bullets(city),
        "position": {k: round(city_pos.get(k, 0.0), 3) for k in DIM_LABELS},
        "national_position": {k: round(v, 3) for k, v in national_dims.items()},
        "province_position": {k: round(v, 3) for k, v in prov_dims.items()},
        "key_dims": [
            {"dimension": k, "label": DIM_LABELS[k],
             "deviation": dev, "pole": DIM_POLES[k][0] if dev < 0 else DIM_POLES[k][1]}
            for k, dev in key_dims
        ],
        "turnout": round(actual.get('turnout', expl['turnout']), 4),
        "seats": actual.get('seats', 0),
        "party_seats": actual.get('party_seats', {}),
        "parties": [
            {
                "party_id": r['party_id'], "party_name": r['party_name'],
                "color": r['color'],
                "vote_share": round(actual['vote_shares'].get(r['party_id'], r['vote_share']), 4) if actual.get('vote_shares') else r['vote_share'],
                "affinity": actual['affinities'].get(r['party_id'], r['affinity']) if actual.get('affinities') else r['affinity'],
                "weighted_affinity": r['weighted_affinity'],
                "distance": r['distance'], "best_dims": r['best_dims'],
                "worst_dims": r['worst_dims'], "dim_scores": r['dim_scores'],
                "is_winner": r['is_winner'],
            }
            for r in party_rows
        ],
        "winner_party_id": winner['party_id'],
        "winner_party_name": winner['party_name'],
        "winner_color": winner['color'],
        "narrative": narrative,
    }


def _build_city_narrative(city, city_pos, party_rows, key_dims, national_dims,
                          prov_dims, winner, actual=None):
    """把解读拼成自然语言段落列表。"""
    actual = actual or {}
    shares = actual.get('vote_shares') or {}
    affs = actual.get('affinities') or {}

    def share(row):
        if shares:
            return shares.get(row['party_id'], row['vote_share'])
        return row['vote_share']

    def aff(row):
        if affs:
            return affs.get(row['party_id'], row['affinity'])
        return row['affinity']

    lines = []
    reg = {'coastal': '沿海', 'inland': '内陆', 'western': '西部', 'northeast': '东北'}.get(city.region_type, city.region_type)
    lines.append(f"「{city.name}」位于{reg}，是{city.province}的一座城市，人口约{city.population//10000}万。它的选民偏好首先由产业结构与人口构成塑造——{_city_structure_bullets(city)[0]['note'] if _city_structure_bullets(city) else ''}")

    # 关键维度
    if key_dims:
        parts = []
        for k, dev in key_dims:
            pole = DIM_POLES[k][0] if dev < 0 else DIM_POLES[k][1]
            parts.append(f"{DIM_LABELS[k]}较全国{'偏左' if dev < 0 else '偏右'}（{'+' if dev > 0 else ''}{dev:.2f}，偏向「{pole}」）")
        lines.append("政策偏好上，" + "；".join(parts) + "。这是该市选情最关键的三组变量。")

    # 胜者归因（若实际席位中该党无席，提示制度因素）
    w = winner
    seat_note = ""
    if actual.get('party_seats') and w and actual['party_seats'].get(w['party_id'], 0) == 0:
        seat_note = "不过该党在市内未获议席——多数制的胜者全得让得票未能完全转化为席位。"
    lines.append(f"最终「{w['party_name']}」以 {share(w)*100:.1f}% 在该市拔得头筹——它在 {w['best_dims'][0]}、{w['best_dims'][1]} 上与本市选民最契合，亲和度达 {aff(w):.2f}，综合匹配度最高。{seat_note}")

    # 次席归因
    if len(party_rows) > 1:
        second = party_rows[1]
        lines.append(f"次席「{second['party_name']}」获得 {share(second)*100:.1f}%（亲和 {aff(second):.2f}），它的 {second['best_dims'][0]} 主张有一定号召力，但在 {second['worst_dims'][0]} 上与本市偏好存在明显落差，难以翻盘。")

    # 市内外对比
    city_econ = city_pos.get('economic', 0.0)
    lines.append(f"与省内均值相比，本市在主要维度上{'大体一致' if abs(city_econ - prov_dims.get('economic', 0.0)) < 0.1 else '有所偏离'}——市政选举的得票结构因此与全省宏观走势{'相近' if abs(city_econ - prov_dims.get('economic', 0.0)) < 0.15 else '分化'}。")

    return lines