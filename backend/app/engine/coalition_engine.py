import itertools
import math
from app.models.party import Party
from app.models.result import (
    ElectionResult, CoalitionResult, CoalitionOption, PartyPowerIndex,
    CoalitionMatrix, CoalitionMatrixRow, CoalitionInclusion,
)


class CoalitionEngine:
    """
    组阁推演引擎

    考虑因素：
    1. 席位多数：绝对多数 vs 相对少数
    2. 意识形态距离：8维空间中的政党距离
    3. 政策兼容性：关键政策立场的一致性
    4. 联盟稳定性：内部分歧程度
    5. 最小获胜：刚好过半的最小联盟
    """

    def __init__(self, parties: list[Party]):
        self.parties = parties
        self.party_map = {p.id: p for p in parties}

    def find_coalitions(self, result: ElectionResult) -> CoalitionResult:
        majority_threshold = result.total_seats / 2
        party_results = {r.party_id: r for r in result.party_results}

        # 检查单一政党多数
        for r in result.party_results:
            if r.seats > majority_threshold:
                return CoalitionResult(
                    has_majority=True,
                    majority_party=r.party_id,
                    majority_party_name=r.party_name,
                    coalition_options=[],
                    recommended_coalition=None,
                    majority_type='absolute' if r.seats > result.total_seats * 0.6 else 'simple',
                    power_indices=self.compute_power_indices(result),
                    coalition_matrix=self.coalition_matrix(result),
                )

        eligible = [(r.party_id, r.seats) for r in result.party_results if r.seats > 0]
        eligible.sort(key=lambda x: x[1], reverse=True)

        coalition_options = []

        # 搜索2-5党联盟
        for size in range(2, min(len(eligible) + 1, 6)):
            for combo in itertools.combinations(eligible, size):
                total_seats = sum(s for _, s in combo)
                if total_seats > majority_threshold:
                    party_ids = [pid for pid, _ in combo]
                    option = self._build_coalition_option(
                        party_ids, total_seats, majority_threshold, result.total_seats
                    )
                    coalition_options.append(option)

        # 排序：优先稳定性高、意识形态接近的
        coalition_options.sort(key=lambda c: (
            c.stability_score * -1,
            c.ideological_distance,
        ))

        recommended = coalition_options[0] if coalition_options else None

        return CoalitionResult(
            has_majority=False,
            majority_party=None,
            majority_party_name=None,
            coalition_options=coalition_options[:15],
            recommended_coalition=recommended,
            majority_type=None,
            power_indices=self.compute_power_indices(result),
            coalition_matrix=self.coalition_matrix(result),
        )

    def coalition_matrix(self, result: ElectionResult) -> CoalitionMatrix:
        """
        枚举全部过半联盟，标记最小获胜联盟（去掉任一成员即不过半），
        并统计各政党出现在过半/最小获胜联盟中的次数（联盟参与度）。
        """
        threshold = result.total_seats / 2
        prs = [r for r in result.party_results if r.seats > 0]

        # 单一政党绝对多数：唯一"获胜集"
        winners = [r for r in prs if r.seats > threshold]
        if winners:
            w = winners[0]
            return CoalitionMatrix(
                single_party_majority=w.party_id,
                total=1,
                minimal_count=1,
                rows=[CoalitionMatrixRow(
                    parties=[w.party_id],
                    party_names=[w.party_name],
                    total_seats=w.seats,
                    excess=int(w.seats - threshold - 1),
                    size=1,
                    minimal=True,
                    stability_score=1.0,
                )],
                inclusion=[CoalitionInclusion(
                    party_id=w.party_id, party_name=w.party_name, total_count=1, minimal_count=1,
                )],
            )

        ids = [r.party_id for r in prs]
        names = {r.party_id: r.party_name for r in prs}
        seats = {r.party_id: r.seats for r in prs}

        rows = []
        for size in range(2, len(ids) + 1):
            for combo in itertools.combinations(ids, size):
                total = sum(seats[pid] for pid in combo)
                if total <= threshold:
                    continue
                minimal = all(total - seats[pid] <= threshold for pid in combo)
                opt = self._build_coalition_option(list(combo), total, int(threshold), result.total_seats)
                rows.append(CoalitionMatrixRow(
                    parties=list(combo),
                    party_names=[names[pid] for pid in combo],
                    total_seats=total,
                    excess=int(total - threshold - 1),
                    size=size,
                    minimal=minimal,
                    stability_score=opt.stability_score,
                ))

        rows.sort(key=lambda r: (not r.minimal, r.size, r.total_seats))

        minimal_rows = [r for r in rows if r.minimal]
        total_count = {pid: 0 for pid in ids}
        minimal_count = {pid: 0 for pid in ids}
        for r in rows:
            for pid in r.parties:
                total_count[pid] += 1
        for r in minimal_rows:
            for pid in r.parties:
                minimal_count[pid] += 1

        inclusion = [
            CoalitionInclusion(
                party_id=pid,
                party_name=names[pid],
                total_count=total_count[pid],
                minimal_count=minimal_count[pid],
            )
            for pid in ids
        ]
        inclusion.sort(key=lambda x: (-x.minimal_count, -x.total_count))

        return CoalitionMatrix(
            single_party_majority=None,
            total=len(rows),
            minimal_count=len(minimal_rows),
            rows=rows[:120],
            inclusion=inclusion,
        )

    def compute_power_indices(self, result: ElectionResult) -> list[PartyPowerIndex]:
        """
        计算 Banzhaf 与 Shapley-Shubik 权力指数（加权投票博弈）。

        - Banzhaf：统计该党在多少"获胜联盟"中处于关键位置（去掉即不达多数），
          指数 = 关键次数 / 全体关键次数之和。
        - Shapley-Shubik：统计所有政党排列中该党为"转折者"的比例。
        - pivotal：该党加入某联盟即可凑够多数，即"关键少数"。
        """
        weights = {r.party_id: r.seats for r in result.party_results if r.seats > 0}
        quota = math.floor(result.total_seats / 2) + 1
        party_ids = list(weights)
        n = len(party_ids)

        banzhaf = {pid: 0 for pid in party_ids}
        for mask in range(1 << n):
            total = sum(weights[party_ids[j]] for j in range(n) if (mask >> j) & 1)
            if total >= quota:
                continue
            for j in range(n):
                if (mask >> j) & 1:
                    continue
                if total + weights[party_ids[j]] >= quota:
                    banzhaf[party_ids[j]] += 1
        bz_sum = sum(banzhaf.values()) or 1

        shapley = {pid: 0.0 for pid in party_ids}
        for perm in itertools.permutations(party_ids):
            acc = 0
            for pid in perm:
                acc += weights[pid]
                if acc >= quota:
                    shapley[pid] += 1.0
                    break
        sh_sum = sum(shapley.values()) or 1.0

        max_weight = max(weights.values()) if weights else 0
        del max_weight
        indices = []
        for r in result.party_results:
            pid = r.party_id
            w = weights.get(pid, 0)
            indices.append(PartyPowerIndex(
                party_id=pid,
                party_name=r.party_name,
                seats=w,
                banzhaf=round(banzhaf.get(pid, 0) / bz_sum, 4),
                shapley_shubik=round(shapley.get(pid, 0) / sh_sum, 4),
                pivotal=banzhaf.get(pid, 0) > 0,
            ))
        return indices

    def _build_coalition_option(self, party_ids: list[str], total_seats: int,
                                 majority_threshold: int, total_parliament: int) -> CoalitionOption:
        """构建详细的联盟选项信息"""
        id_dist = self._ideological_distance_8d(party_ids)
        policy_compat = self._policy_compatibility(party_ids)
        stability = self._stability_score(party_ids, id_dist, policy_compat)
        excess = total_seats - majority_threshold - 1

        return CoalitionOption(
            parties=party_ids,
            party_names=[self.party_map[pid].name for pid in party_ids],
            total_seats=total_seats,
            ideological_distance=round(id_dist, 4),
            is_majority=True,
            policy_compatibility=round(policy_compat, 4),
            stability_score=round(stability, 4),
            excess=excess,
            majority_type='comfortable' if total_seats > total_parliament * 0.6 else 'narrow',
        )

    def _ideological_distance_8d(self, party_ids: list[str]) -> float:
        """8维意识形态距离"""
        if len(party_ids) < 2:
            return 0.0

        positions = []
        for pid in party_ids:
            p = self.party_map[pid]
            positions.append((
                p.economic_position, p.social_position,
                p.regional_position, p.welfare_position,
                p.environment_position, p.nationalism_position,
                p.urban_rural_position,
            ))

        total_dist = 0.0
        count = 0
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(positions[i], positions[j])))
                total_dist += dist
                count += 1
        return total_dist / count if count > 0 else 0.0

    def _policy_compatibility(self, party_ids: list[str]) -> float:
        """
        政策兼容性评分 (0-1)

        测量联盟内各党在关键政策维度上的立场一致性
        """
        if len(party_ids) < 2:
            return 1.0

        dimensions = [
            'economic_position', 'social_position', 'regional_position',
            'welfare_position', 'environment_position',
            'nationalism_position', 'urban_rural_position',
        ]

        compat_scores = []
        for dim in dimensions:
            values = [getattr(self.party_map[pid], dim) for pid in party_ids]
            avg = sum(values) / len(values)
            variance = sum((v - avg) ** 2 for v in values) / len(values)
            compat_scores.append(1.0 - math.sqrt(variance) / 2.0)

        return sum(compat_scores) / len(compat_scores)

    def _stability_score(self, party_ids: list[str], id_dist: float, policy_compat: float) -> float:
        """
        联盟稳定性评分 (0-1)

        综合考虑：
        - 意识形态距离（小→稳定）
        - 政策兼容性（高→稳定）
        - 政党数量（少→稳定）
        """
        id_score = max(0, 1.0 - id_dist / 3.0)
        size_penalty = max(0, 1.0 - (len(party_ids) - 2) * 0.15)
        stability = (id_score * 0.4 + policy_compat * 0.4 + size_penalty * 0.2)
        return max(0.0, min(1.0, stability))
