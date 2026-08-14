"""政府任期/寿命模拟引擎

给定执政联盟（或单党多数），模拟政府在整个法定任期内的存活过程：
- 逐月存活概率曲线（与联盟内在稳定度、席位冗余度相关）
- 政策通过率（基于多数冗余席次与政策兼容度）
- 倒阁原因分解（联盟内讧 / 丑闻 / 经济冲击 / 不信任动议）
- 代表性事件时间线（政策通过、丑闻、经济冲击、倒阁或期满）
"""

import math
import random
from app.models.party import Party
from app.models.result import (
    ElectionResult,
    GovernmentTermResult, TermEvent, TermMonthSnapshot,
)


class GovernmentEngine:
    """模拟政府任期的存活、政策绩效与倒阁风险"""

    def __init__(self, parties: list[Party], seed: int = 7):
        self.parties = parties
        self.party_map = {p.id: p for p in parties}
        self.rng = random.Random(seed)

    def run(self, result: ElectionResult, ruling_parties: list[str] = None,
            term_months: int = 60) -> GovernmentTermResult:
        """
        模拟一次完整任期。

        ruling_parties: 指定执政联盟。若为空，自动选单一多数党或
        推荐联盟（复用 CoalitionEngine 的推荐逻辑）。
        """
        single_party, ruling = self._resolve_ruling(result, ruling_parties)
        base_stability = self._base_stability(result, ruling)
        seat_margin = self._seat_margin(result, ruling)

        months = self._simulate(result, ruling, base_stability, seat_margin, term_months)
        return GovernmentTermResult(
            ruling_parties=ruling,
            ruling_party_names=[self.party_map[p].name for p in ruling],
            term_months=term_months,
            expected_months=self._expected_months(months),
            survival_prob_full_term=months[-1].survival_prob if months else 0.0,
            survival_curve=months,
            events=self._build_events(months, ruling, base_stability, term_months),
            base_stability=round(base_stability, 4),
            seat_margin=seat_margin,
            policy_pass_rate=round(self._policy_pass_rate(result, ruling), 4),
            passed_bills=self._passed_bills_count(result, ruling),
            total_bills=self._total_bills(),
            expected_passed_bills=round(self._policy_pass_rate(result, ruling) * self._total_bills(), 2),
            no_confidence_risk=round(1.0 - months[-1].survival_prob if months else 0.0, 4),
            reason_breakdown=self._reason_breakdown(months, ruling),
            single_party=single_party,
            confidence_vote=round(self._confidence_vote(result, ruling), 4),
        )

    # ========== 联盟解析 ==========

    def _resolve_ruling(self, result: ElectionResult, ruling_parties: list[str]) -> tuple[bool, list[str]]:
        """确定执政联盟：指定 > 单党多数 > 推荐联盟（席位多→稳定高）"""
        if ruling_parties:
            return len(ruling_parties) == 1, ruling_parties
        threshold = result.total_seats / 2
        prs = [r for r in result.party_results if r.seats > 0]
        majority = [r for r in prs if r.seats > threshold]
        if majority:
            return True, [majority[0].party_id]
        # 无多数：取席位最多的前几个党凑够多数（最小获胜联盟启发式）
        seats = {r.party_id: r.seats for r in prs}
        ordered = sorted(seats, key=seats.get, reverse=True)
        ruling = []
        acc = 0
        for pid in ordered:
            ruling.append(pid)
            acc += seats[pid]
            if acc > threshold:
                break
        return False, ruling

    def _base_stability(self, result: ElectionResult, ruling: list[str]) -> float:
        """联盟内在稳定性（0-1）：
        - 单党多数：1.0（无内讧）
        - 多党联盟：意识形态接近 + 政策兼容 + 成员少 → 稳定
        """
        if len(ruling) <= 1:
            return 1.0
        ids = [p for p in ruling if p in self.party_map]
        if len(ids) < 2:
            return 1.0
        id_dist = self._ideological_distance(ids)
        policy_compat = self._policy_compat(ids)
        size_penalty = max(0.0, 1.0 - (len(ids) - 2) * 0.18)
        id_score = max(0.0, 1.0 - id_dist / 3.0)
        return max(0.0, min(1.0, id_score * 0.4 + policy_compat * 0.4 + size_penalty * 0.2))

    def _seat_margin(self, result: ElectionResult, ruling: list[str]) -> int:
        """超过多数门槛的冗余席位（负值=少数派执政）"""
        threshold = result.total_seats / 2
        seats = sum(r.seats for r in result.party_results if r.party_id in ruling)
        return int(seats - threshold)

    # ========== 逐月状态机 ==========

    def _simulate(self, result: ElectionResult, ruling: list[str],
                  base_stability: float, seat_margin: int,
                  term_months: int) -> list[TermMonthSnapshot]:
        """
        逐月模拟：计算每月瞬时倒阁概率与累计存活概率。
        - 基础风险：1 - stability（稳定度越高越安全）
        - 席位冗余：冗余越多越稳（每冗余 10 席风险 -0.006，封底）
        - 政策失败压力：政策通过率越低，不信任风险越高
        - 随机事件：每月有小概率触发丑闻/经济冲击放大风险
        """
        pass_rate = self._policy_pass_rate(result, ruling)
        margin_adj = max(-0.02, min(0.02, seat_margin * 0.0008))  # 冗余席 → 减风险
        base_hazard = (1.0 - base_stability) * 0.08 - margin_adj

        months = []
        survival = 1.0
        for m in range(1, term_months + 1):
            # 任期后期（法定满期前）内讧概率上升：选季临近
            endgame = 0.0
            if m > term_months - 12:
                endgame = (m - (term_months - 12)) / 12 * 0.012
            # 政策失败 → 不信任压力（通过率低时累积）
            policy_stress = max(0.0, (1.0 - pass_rate) * 0.01)
            # 随机事件（每月 3% 概率触发，放大风险）
            shock = 0.0
            if self.rng.random() < 0.03:
                shock = 0.01 + self.rng.random() * 0.03
            hazard = max(0.001, base_hazard + endgame + policy_stress + shock)
            survival *= (1.0 - hazard)
            months.append(TermMonthSnapshot(
                month=m,
                survival_prob=round(survival, 4),
                hazard=round(hazard, 4),
                approvals=round(self._approval(m, pass_rate, hazard), 4),
            ))
        return months

    def _approval(self, month: int, pass_rate: float, hazard: float) -> float:
        """民众支持率：50 基线 + 政策通过加成 + 倒阁风险折损 + 任期周期波动"""
        base = 50.0
        base += (pass_rate - 0.5) * 20.0  # 政策强 → 支持率高
        base -= hazard * 150.0  # 动荡期支持率下滑
        base += math.sin(month / 5.0) * 3.0  # 周期性波动（蜜月/疲劳期）
        return max(5.0, min(90.0, base))

    # ========== 政策绩效 ==========

    def _policy_pass_rate(self, result: ElectionResult, ruling: list[str]) -> float:
        """平均政策通过率：
        - 多数冗余席（seat_margin）越高 → 通过越稳
        - 联盟内政策兼容度越高 → 内部共识越易达成
        """
        if len(ruling) <= 1:
            stability = 1.0
        else:
            ids = [p for p in ruling if p in self.party_map]
            stability = self._policy_compat(ids) if len(ids) >= 2 else 1.0
        margin = self._seat_margin(result, ruling)
        base = 0.5 + stability * 0.25 + max(-0.15, min(0.2, margin * 0.004))
        return max(0.15, min(0.95, base))

    def _total_bills(self) -> int:
        """任期内提交法案数（简化为每年 12 项 × 5 年）"""
        return 60

    def _passed_bills_count(self, result: ElectionResult, ruling: list[str]) -> int:
        return int(self._policy_pass_rate(result, ruling) * self._total_bills())

    def _confidence_vote(self, result: ElectionResult, ruling: list[str]) -> float:
        """就职信任投票通过率：过半冗余席 → 高通过"""
        margin = self._seat_margin(result, ruling)
        return max(0.3, min(1.0, 0.5 + margin * 0.01))

    # ========== 倒阁原因分解 ==========

    def _reason_breakdown(self, months: list[TermMonthSnapshot], ruling: list[str]) -> dict[str, float]:
        """倒阁原因占比：内讧 / 政策失败 / 丑闻冲击 / 经济冲击"""
        total_hazard = sum(m.hazard for m in months) or 1.0
        multi = len(ruling) > 1
        if multi:
            infight = sum(m.hazard * 0.45 for m in months)
            policy = sum(m.hazard * 0.25 for m in months)
            scandal = sum(m.hazard * 0.18 for m in months)
            econ = sum(m.hazard * 0.12 for m in months)
        else:
            infight = sum(m.hazard * 0.15 for m in months)
            policy = sum(m.hazard * 0.30 for m in months)
            scandal = sum(m.hazard * 0.30 for m in months)
            econ = sum(m.hazard * 0.25 for m in months)
        norm = infight + policy + scandal + econ or 1.0
        return {
            '联盟内讧': round(infight / norm, 4),
            '政策失败': round(policy / norm, 4),
            '丑闻冲击': round(scandal / norm, 4),
            '经济冲击': round(econ / norm, 4),
        }

    def _build_events(self, months: list[TermMonthSnapshot], ruling: list[str],
                      base_stability: float, term_months: int) -> list[TermEvent]:
        """生成代表性事件时间线（采样少数关键节点）"""
        events = []
        # 就职
        events.append(TermEvent(
            month=0, month_label='就职',
            type='survived', title='政府就职',
            description=f'由 {"、".join(self.party_map[p].name for p in ruling)} 组成的政府宣誓就职',
        ))
        # 信任投票
        events.append(TermEvent(
            month=1, month_label='第1个月', type='survived', title='信任投票通过',
            description='议会信任投票通过，政府获得执政合法性',
        ))
        # 中途抽样：政策通过/失败/事件
        n_months = len(months)
        if n_months >= 24:
            for m in [6, 18, 30, 42]:
                snap = months[min(m - 1, n_months - 1)]
                if snap.hazard > 0.02:
                    events.append(TermEvent(
                        month=m, month_label=f'第{m}个月', type='no_confidence',
                        title='不信任动议威胁', description='反对党提出不信任动议，政府面临考验',
                    ))
                elif snap.approvals > 60:
                    events.append(TermEvent(
                        month=m, month_label=f'第{m}个月', type='policy_pass',
                        title='关键法案通过', description='执政联盟在议会推动关键法案获得通过',
                    ))
                else:
                    events.append(TermEvent(
                        month=m, month_label=f'第{m}个月', type='policy_fail',
                        title='法案受阻', description='部分法案在议会受阻，政府政策空间收窄',
                    ))
        # 结局
        if months:
            survival = months[-1].survival_prob
            if survival >= 0.5:
                events.append(TermEvent(
                    month=term_months, month_label=f'第{term_months}个月', type='survived',
                    title='完成任期', description='政府顺利完成法定任期，进入选举周期',
                ))
            else:
                events.append(TermEvent(
                    month=term_months, month_label=f'第{term_months}个月', type='no_confidence',
                    title='提前倒阁', description='政府未能撑满任期，议会提前解散或重新组阁',
                ))
        return events

    def _expected_months(self, months: list[TermMonthSnapshot]) -> float:
        """预期存活月数 = Σ 存活概率（离散期望）"""
        return round(sum(m.survival_prob for m in months), 2)

    # ========== 联盟内部指标（复用 CoalitionEngine 口径） ==========

    def _ideological_distance(self, party_ids: list[str]) -> float:
        """联盟成员 7 维意识形态平均两两距离"""
        positions = []
        for pid in party_ids:
            p = self.party_map[pid]
            positions.append((
                p.economic_position, p.social_position, p.regional_position,
                p.welfare_position, p.environment_position,
                p.nationalism_position, p.urban_rural_position,
            ))
        total = 0.0
        count = 0
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                total += math.sqrt(sum((a - b) ** 2 for a, b in zip(positions[i], positions[j])))
                count += 1
        return total / count if count else 0.0

    def _policy_compat(self, party_ids: list[str]) -> float:
        """联盟成员 7 维政策立场一致性（0-1）"""
        dims = ['economic_position', 'social_position', 'regional_position',
                'welfare_position', 'environment_position',
                'nationalism_position', 'urban_rural_position']
        scores = []
        for d in dims:
            vals = [getattr(self.party_map[pid], d) for pid in party_ids]
            avg = sum(vals) / len(vals)
            var = sum((v - avg) ** 2 for v in vals) / len(vals)
            scores.append(1.0 - math.sqrt(var) / 2.0)
        return sum(scores) / len(scores)