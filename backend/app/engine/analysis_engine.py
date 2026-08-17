"""
选举分析工具集：浪费票（Wasted Votes）、政党空间竞争、
选举取证审计、城市投票成因解读。
"""
import math
from app.engine import ElectoralEngine


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


def _benford_chi_square(counts: list[int]) -> tuple[float, float]:
    """首位数 Benford 分布拟合：返回 (chi2, max_deviation)。

    Benford 定律：真实选举中政党得票数的首位数字近似对数分布（1 最多，9 最少）。
    完全均匀的首位分布或强烈偏向某位往往提示数据被"捏造"或大量相同取整。
    """
    digits = {str(d): 0 for d in range(1, 10)}
    for c in counts:
        if c <= 0:
            continue
        first = str(c)[0]
        digits[first] = digits.get(first, 0) + 1
    total = sum(digits.values())
    if total < 20:
        return 0.0, 0.0
    chi2 = 0.0
    max_dev = 0.0
    for d in range(1, 10):
        expected = total * math.log10(1 + 1.0 / d)
        observed = digits[str(d)]
        chi2 += (observed - expected) ** 2 / max(1e-9, expected)
        max_dev = max(max_dev, abs(observed - expected) / max(1, total))
    return chi2, max_dev


def _last_digit_uniformity(counts: list[int]) -> float:
    """末位数字分布均匀性：真实手工投票数据末位接近均匀分布。

    伪造数据往往有规律的末位偏好（偏爱 0/5 或某些数字）。用 chi2 衡量
    与均匀分布的偏离，返回 0（偏离大）~1（完全均匀）。
    """
    freq = {d: 0 for d in range(10)}
    for c in counts:
        if c <= 0:
            continue
        freq[c % 10] += 1
    total = sum(freq.values())
    if total < 20:
        return 0.0
    expected = total / 10.0
    chi2 = sum((v - expected) ** 2 / max(1e-9, expected) for v in freq.values())
    return max(0.0, 1.0 - chi2 / (expected * 3.0))


def election_forensics(city_data, parties, config):
    """选举取证审计：检验模拟投票数据在统计形态上是否"像真实选举"。

    四项检验（真实选举数据取证常用）：
    1. Benford 首位数：政党得票数首位分布应近似对数分布（1 最多）。
    2. 末位数字均匀性：手工/真实计票末位近似均匀，无规律偏好。
    3. 投票率-竞争度关联：胶着选区投票率显著更高，碾压选区偏低。
    4. 边际选区密度：真实多数制存在相当比例的 5% 内胶着选区。

    返回每项检验的统计量与 0-100 真实性评分。
    """
    engine = ElectoralEngine(city_data, parties, config, seed=42)
    result = engine.run()

    # 1/2. 收集全市各党整数票（无整数票时退回得票率×总票估算）
    counts = []
    for cr in result.city_results:
        if cr.votes:
            counts.extend(v for v in cr.votes.values() if v > 0)
        else:
            total = cr.total_votes or int(cr.turnout * 0.78 * 1_000_000)
            counts.extend(int(v * total) for v in cr.vote_shares.values() if v > 0)

    benford_chi2, benford_dev = _benford_chi_square(counts)
    # chi2 越小越接近 Benford：自由度为 8，chi2<15.5 (p>0.05) 视为真实形态
    benford_score = max(0.0, min(1.0, 1.0 - benford_chi2 / 40.0))
    last_score = _last_digit_uniformity(counts)

    # 3. 投票率-竞争度关联：计算各市胜差与投票率的 Spearman 相关
    margins = []
    turnouts = []
    for cr in result.city_results:
        shares = sorted(cr.vote_shares.values(), reverse=True)
        if len(shares) < 2:
            continue
        margins.append(shares[0] - shares[1])
        turnouts.append(cr.turnout)
    n = len(margins)
    rho = 0.0
    if n >= 10:
        # Spearman 秩相关（用名次而非原值，稳健于非线性）
        rank = lambda xs: {v: i / max(1, len(xs) - 1) for i, v in enumerate(sorted(xs))}
        rm, rt = [rank(margins)[m] for m in margins], [rank(turnouts)[t] for t in turnouts]
        mean_m, mean_t = sum(rm) / n, sum(rt) / n
        num = sum((rm[i] - mean_m) * (rt[i] - mean_t) for i in range(n))
        den = math.sqrt(sum((x - mean_m) ** 2 for x in rm) * sum((y - mean_t) ** 2 for y in rt))
        rho = num / den if den > 0 else 0.0
    # 真实形态：胜差越小投票率越高 → rho 显著为负
    competition_score = max(0.0, min(1.0, 0.5 - rho * 1.5))

    # 4. 边际选区密度：胜差 <5pp 的城市占比
    tight = sum(1 for m in margins if m < 0.05) / max(1, len(margins))
    # 真实 FPTP 体系 5% 内边际选区占比约 10-20%，太高（摆荡机器）或太低（无竞争）都不真
    tight_score = 1.0 - abs(tight - 0.15) / 0.15

    scores = {
        "benford": round(benford_score, 3),
        "last_digit": round(last_score, 3),
        "competition_turnout": round(competition_score, 3),
        "marginal_seats": round(max(0.0, tight_score), 3),
    }
    realism = round(sum(scores.values()) / 4 * 100, 1)

    return {
        "realism_score": realism,
        "scores": scores,
        "checks": {
            "benford": {
                "chi2": round(benford_chi2, 2),
                "max_deviation": round(benford_dev, 4),
                "conclusion": "首位数分布接近 Benford 对数分布，符合真实选举形态"
                if benford_chi2 < 15.5 else "首位分布偏离 Benford，可能存在取整/造数痕迹",
            },
            "last_digit": {
                "uniformity": round(last_score, 3),
                "conclusion": "末位数字接近均匀分布，无系统性凑整偏好"
                if last_score > 0.6 else "末位数字存在规律偏好，提示数据被加工",
            },
            "competition_turnout": {
                "spearman_rho": round(rho, 3),
                "conclusion": "胶着选区投票率更高，符合现实动员规律"
                if rho < -0.1 else "投票率与竞争度关联偏弱",
            },
            "marginal_seats": {
                "share": round(tight, 3),
                "conclusion": f"边际选区（5%内）占比 {tight*100:.1f}%，处于现实多数制常见区间"
                if 0.05 <= tight <= 0.35 else f"边际选区占比 {tight*100:.1f}%，偏离现实多数制典型分布",
            },
        },
        "verdict": "数据形态高度接近真实选举公报" if realism >= 75
        else "数据形态基本接近真实选举" if realism >= 55
        else "数据形态偏离真实选举，建议开启真实感参数",
        "note": "本审计针对数据统计形态（非选举操纵判定）：模拟数据应避免过于工整的首位/末位分布与异常整齐的边际结构。",
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