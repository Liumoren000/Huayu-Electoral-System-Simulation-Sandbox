"""
民调与舆论模型 + 选区级摇摆/风向标分析

- PollEngine: 模拟竞选期（如12周）各党民调支持率演化，叠加舆论事件冲击，
  生成民调曲线与选前席位预测/胜率预测（蒙特卡洛）。
- 摇摆/风向标: 基于城市级胜差将选区分为 safe / lean / tossup，
  并识别与全国最大党一致且接近全国平均胜差的"风向标选区"（bellwether）。
"""
import random
from app.engine import ElectoralEngine
from app.models.result import (
    PollPoint, PollEvent, PollForecast, PollResponse,
    SwingDistrict, SwingAnalysisResponse,
)

# 民调舆论事件模板（week 为相对竞选期中的触发周）
POLL_EVENTS_TEMPLATE = [
    (2, "首场电视辩论", "在任党表现稳定，民调小幅回稳", 0.015),
    (4, "经济数据意外走弱", "就业与增长数据不及预期，冲击执政联盟", -0.03),
    (6, "地方选举风向标", "关键省地方选举结果带来动量波动", 0.02),
    (8, "候选人丑闻传闻", "针对最大党的负面舆情发酵", -0.025),
    (10, "终场辩论", "最后一场辩论，摇摆选民加速决定", 0.02),
]


class PollEngine:
    def __init__(self, city_data, parties, config, seed: int = 7,
                 weeks: int = 12, volatility: float = 0.04):
        self.city_data = city_data
        self.parties = parties
        self.config = config
        self.rng = random.Random(seed)
        self.weeks = weeks
        self.volatility = volatility
        self.party_map = {p.id: p for p in parties}

    def run(self) -> PollResponse:
        # 基准：实际选举得票率（以该配置的确定性运行结果为准）
        engine = ElectoralEngine(self.city_data, self.parties, self.config, seed=42)
        result = engine.run()
        final_share = {p.party_id: p.vote_share for p in result.party_results}

        series = []
        events = []

        # 各党当前民调支持率，从最终结果回退到起点（起点略分散）
        cur = {}
        for pid, share in final_share.items():
            start = max(0.01, share + self.rng.gauss(0, self.volatility * 1.5))
            cur[pid] = start

        event_by_week = {w: (label, desc, mag) for w, label, desc, mag in POLL_EVENTS_TEMPLATE}

        # 竞选期演化：每周向基准得票率收敛 + 随机波动 + 事件冲击
        for week in range(1, self.weeks + 1):
            # 事件冲击：作用于最大的党（"在任党"）
            ev = event_by_week.get(week)
            if ev:
                label, desc, mag = ev
                target_id = max(final_share, key=final_share.get)
                direction = 1.0 if mag > 0 else -1.0
                # 对在任党冲击；若为负面，分给其它党
                if mag > 0:
                    cur[target_id] += mag
                else:
                    cur[target_id] += mag
                    for pid in cur:
                        if pid != target_id:
                            cur[pid] += (-mag) / max(1, len(cur) - 1)
                events.append(PollEvent(week=week, label=label, description=desc,
                                        party_id=target_id, direction=direction))

            # 向基准收敛 + 随机波动
            for pid in cur:
                target = final_share[pid]
                cur[pid] += (target - cur[pid]) * 0.12 + self.rng.gauss(0, self.volatility)

            # 归一化
            total = sum(cur.values())
            if total > 0:
                for pid in cur:
                    cur[pid] = max(0.005, cur[pid] / total)
                t2 = sum(cur.values())
                if t2 > 0:
                    for pid in cur:
                        cur[pid] /= t2

            for pid, share in cur.items():
                series.append(PollPoint(week=week, party_id=pid, share=round(share, 4)))

        # 预测：以最后一周民调做席位投影 + 蒙特卡洛胜率
        forecasts = self._forecast(result, cur, final_share)

        return PollResponse(
            weeks=self.weeks,
            final_share={k: round(v, 4) for k, v in final_share.items()},
            series=series,
            events=events,
            forecasts=forecasts,
            note="民调曲线由确定性选举结果回退生成，竞选期向基准收敛并叠加随机波动与舆论事件冲击。",
        )

    def _forecast(self, result, last_poll: dict, final_share: dict) -> list[PollForecast]:
        """基于最后一周民调进行席位投影与蒙特卡洛胜率/过半率预测

        - seat_projection: 民调收敛于确定性基准，席位投影即基准席位
        - win_prob / majority_prob: 对当前配置做 200 次蒙特卡洛（不同种子），
          反映竞选期真实的不确定性（与稳健性分析同口径）
        """
        n = 200
        total = self.config.total_seats
        wins = {p.id: 0 for p in self.parties}
        majority = {p.id: 0 for p in self.parties}
        seat_sum = {p.id: 0 for p in self.parties}

        for i in range(n):
            engine = ElectoralEngine(self.city_data, self.parties, self.config, seed=1000 + i)
            r = engine.run()
            top = max(r.party_results, key=lambda x: x.seats)
            wins[top.party_id] += 1
            if top.seats > total / 2:
                majority[top.party_id] += 1
            for pr in r.party_results:
                seat_sum[pr.party_id] += pr.seats / n

        # 确定性基准席位（民调预测的"最可能结果"）
        base_seats = {pr.party_id: pr.seats for pr in result.party_results}

        forecasts = []
        for p in self.parties:
            forecasts.append(PollForecast(
                party_id=p.id,
                party_name=p.name,
                color=p.color,
                poll_share=round(last_poll.get(p.id, 0.0), 4),
                seat_projection=base_seats.get(p.id, 0),
                win_prob=round(wins[p.id] / n, 4),
                majority_prob=round(majority[p.id] / n, 4),
            ))
        forecasts.sort(key=lambda f: f.seat_projection, reverse=True)
        return forecasts


def swing_analysis(city_data, parties, config) -> SwingAnalysisResponse:
    """识别选区摇摆程度（tossup/lean/safe）与风向标选区"""
    engine = ElectoralEngine(city_data, parties, config, seed=42)
    result = engine.run()

    national = max(result.party_results, key=lambda x: x.seats)
    total = result.total_seats

    # 全国平均胜差（加权）与分布分位数
    margins = []
    for cr in result.city_results:
        sorted_shares = sorted(cr.vote_shares.values(), reverse=True)
        if len(sorted_shares) >= 2:
            margins.append((cr, sorted_shares[0] - sorted_shares[1]))

    avg_margin = sum(m for _, m in margins) / max(1, len(margins))

    # 分位数阈值：保证 tossup/lean/safe 分布始终有区分度
    # （模型下各城胜差普遍较小，固定阈值会误判为全员胶着）
    sorted_m = sorted(m for _, m in margins)
    def pct(p):
        idx = min(len(sorted_m) - 1, int(p * len(sorted_m)))
        return sorted_m[idx]
    tossup_thresh = pct(0.25)
    lean_thresh = pct(0.60)

    districts = []
    tossup = lean = safe = bellwether = 0

    for cr, margin in margins:
        if margin <= tossup_thresh:
            level = "tossup"
            tossup += 1
        elif margin <= lean_thresh:
            level = "lean"
            lean += 1
        else:
            level = "safe"
            safe += 1

        # 风向标：与全国最大党一致，胜差落在"代表性区间"内（前25%至60%之间
        # 的中等竞争带），并与全国平均胜差接近。
        is_bellwether = (
            cr.winner_party_id == national.party_id
            and tossup_thresh < margin <= lean_thresh
            and abs(margin - avg_margin) < 0.04
        )
        bell_score = 1.0 - min(1.0, abs(margin - avg_margin) / 0.2) if is_bellwether else 0.0
        if is_bellwether:
            bellwether += 1

        runnerup = sorted(cr.vote_shares.items(), key=lambda x: x[1], reverse=True)[1]
        party_name_lookup = {p.id: p.name for p in parties}
        districts.append(SwingDistrict(
            city_id=cr.city_id,
            city_name=cr.city_name,
            province=cr.province if hasattr(cr, 'province') else "",
            winner_party_id=cr.winner_party_id,
            winner_party_name=cr.winner_party_name,
            runnerup_party_id=runnerup[0],
            runnerup_party_name=party_name_lookup.get(runnerup[0], runnerup[0]),
            margin=round(margin, 4),
            seats=cr.seats,
            swing_level=level,
            bellwether=is_bellwether,
            bellwether_score=round(bell_score, 4),
        ))

    districts.sort(key=lambda d: d.margin)
    return SwingAnalysisResponse(
        total_seats=total,
        tossup_count=tossup,
        lean_count=lean,
        safe_count=safe,
        bellwether_count=bellwether,
        national_leader=national.party_id,
        national_leader_name=national.party_name,
        districts=districts,
    )