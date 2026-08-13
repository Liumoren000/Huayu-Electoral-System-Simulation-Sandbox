import math
import random
from app.models.city import City
from app.models.party import Party


class VoterModel:
    """
    现实主义选民行为模型

    考虑因素：
    1. 经济利益：产业结构、就业结构、收入水平
    2. 社会价值观：传统-现代、集体-个人
    3. 区域认同：沿海国际化 vs 内陆本土化
    4. 政策偏好：福利、环保、产业政策、文化保护
    5. 人口结构：年龄、教育、城镇化
    """

    def __init__(self, seed: int = 42, turnout_shift: float = 0.0, dim_tilt: dict = None):
        self.rng = random.Random(seed)
        self.seed = seed
        self.turnout_shift = turnout_shift
        self.dim_tilt = dim_tilt or {}

    def _tilt(self, dim: str, base: float) -> float:
        """全国选民在某一政策维度上的偏好偏移（选举剧本机制）"""
        return base + self.dim_tilt.get(dim, 0.0)

    POLICY_DIMS = ['economic', 'social', 'regional', 'welfare', 'environment', 'nationalism', 'urban_rural']

    def _policy_distance(self, vpos: dict, ppos: dict) -> float:
        """选民与政党的政策空间距离（7 维欧氏距离）"""
        return math.sqrt(sum((vpos.get(d, 0) - ppos.get(d, 0)) ** 2 for d in self.POLICY_DIMS))

    def sample_voter_rankings(self, city: City, parties: list[Party], n: int = 80,
                              noise_amplitude: float = 0.12) -> list[list[str]]:
        """
        为排名票制度生成市内选民对政党的偏好排序（排名票基础）。

        每位虚拟选民位置 = 城市政策维度 + 高斯噪声（幅度可调），
        按到各政党政策位置的距离升序排名。使用独立种子，不影响
        compute_vote_shares 等既有随机序列，保证 FPTP/PR 结果与之前逐位一致。
        """
        rng = random.Random(self.seed * 1000000 + int(city.id))
        city_pos = self.get_city_dimensions(city)
        party_pos = {p.id: {d: getattr(p, d + '_position', 0.0) for d in self.POLICY_DIMS} for p in parties}
        rankings = []
        for _ in range(n):
            vpos = {d: city_pos.get(d, 0) + rng.gauss(0, noise_amplitude) for d in self.POLICY_DIMS}
            ordered = sorted(parties, key=lambda p: self._policy_distance(vpos, party_pos[p.id]))
            rankings.append([p.id for p in ordered])
        return rankings

    def sample_first_preferences(self, city: City, parties: list[Party], n: int = 80) -> dict[str, int]:
        """各政党在该市的（排名票）首偏好票数"""
        counts = {p.id: 0 for p in parties}
        for ranking in self.sample_voter_rankings(city, parties, n):
            if ranking:
                counts[ranking[0]] += 1
        return counts

    def compute_city_party_affinity(self, city: City, party: Party, noise_amplitude: float = 0.03) -> float:
        """计算城市对政党的综合亲和度"""
        scores = []

        # 经济维度匹配 (权重30%)
        econ_score = self._economic_match(city, party)
        scores.append(('economic', econ_score, 0.30))

        # 社会维度匹配 (权重20%)
        social_score = self._social_match(city, party)
        scores.append(('social', social_score, 0.20))

        # 区域维度匹配 (权重20%)
        regional_score = self._regional_match(city, party)
        scores.append(('regional', regional_score, 0.20))

        # 政策维度匹配 (权重30%)
        policy_score = self._policy_match(city, party)
        scores.append(('policy', policy_score, 0.30))

        raw_score = sum(s * w for _, s, w in scores)

        # 添加随机扰动模拟现实不确定性（幅度可调）
        noise = self.rng.gauss(0, noise_amplitude)
        return max(0.01, raw_score + noise)

    def get_city_dimensions(self, city: City) -> dict[str, float]:
        """获取城市在各维度的位置（叠加全国偏好偏移 dim_tilt）"""
        return {
            'economic': round(self._tilt('economic', self._city_economic_position(city)), 3),
            'social': round(self._tilt('social', self._city_social_position(city)), 3),
            'regional': round(self._tilt('regional', self._city_regional_position(city)), 3),
            'welfare': round(self._tilt('welfare', self._city_welfare_preference(city)), 3),
            'environment': round(self._tilt('environment', self._city_environment_preference(city)), 3),
            'nationalism': round(self._tilt('nationalism', self._city_nationalism(city)), 3),
            'urban_rural': round(self._tilt('urban_rural', self._city_urban_rural(city)), 3),
        }

    def get_city_turnout(self, city: City, urban_rural_weight: float = 1.0) -> float:
        """
        计算城市投票率 (0.35 - 0.80)

        考虑因素：
        - 城镇化率（高→投票率高）
        - 教育水平（高→投票率高）
        - 老龄化（中等→投票率高，过高→投票率下降）
        - 区域差异（沿海→高，偏远农村→低）

        Args:
            city: 城市数据
            urban_rural_weight: 城乡投票率差异权重 (0.0-2.0)
                0.0 = 城乡无差异
                1.0 = 默认差异
                2.0 = 差异加倍
        """
        base = 0.45

        # 城镇化率影响，受权重调节
        urban_factor = (city.urbanization_rate - 0.5) * 0.25 * urban_rural_weight

        # 教育水平影响
        edu_factor = (city.education_index - 0.6) * 0.3

        # 老龄化影响（中等老龄化投票率最高）
        aging = city.aging_rate
        if aging < 0.1:
            aging_factor = aging * 1.5
        elif aging < 0.2:
            aging_factor = 0.15
        else:
            aging_factor = 0.15 - (aging - 0.2) * 1.0

        # 区域差异
        region_factor = 0.0
        if city.region_type == 'coastal':
            region_factor = 0.03
        elif city.region_type == 'western':
            region_factor = -0.08
        elif city.region_type == 'northeast':
            region_factor = -0.03

        turnout = base + urban_factor + edu_factor + aging_factor + region_factor
        turnout += self.turnout_shift
        return round(max(0.20, min(0.95, turnout)), 4)

    def get_city_affinities(self, city: City, parties: list[Party], noise_amplitude: float = 0.03) -> dict[str, float]:
        """获取城市对各政党的亲和度"""
        affinities = {}
        for party in parties:
            affinities[party.id] = round(self.compute_city_party_affinity(city, party, noise_amplitude), 4)
        return affinities

    # ========== 透明度：分解每城每党的亲和度计算 ==========

    def explain_city(self, city: City, parties: list[Party], noise_amplitude: float = 0.03) -> dict:
        """
        返回该城市选民行为模型的完整分解，用于前端解释面板。

        - city_position: 城市在 7 个政策维度上的位置（含 dim_tilt）
        - weights: 四个亲和度分项的权重
        - parties: 每党的 经济/社会/区域/政策 匹配分、加权原始亲和度、
          噪声、最终亲和度、归一化得票率，以及与城市位置的 7 维欧氏距离
        """
        city_pos = self.get_city_dimensions(city)
        weights = {'economic': 0.30, 'social': 0.20, 'regional': 0.20, 'policy': 0.30}

        rows = []
        raw = {}
        for p in parties:
            econ = self._economic_match(city, p)
            social = self._social_match(city, p)
            regional = self._regional_match(city, p)
            policy = self._policy_match(city, p)
            weighted = econ * weights['economic'] + social * weights['social'] \
                + regional * weights['regional'] + policy * weights['policy']
            noise = self.rng.gauss(0, noise_amplitude)
            affinity = max(0.01, weighted + noise)
            raw[p.id] = affinity
            rows.append({
                'party_id': p.id,
                'party_name': p.name,
                'color': p.color,
                'economic': round(econ, 4),
                'social': round(social, 4),
                'regional': round(regional, 4),
                'policy': round(policy, 4),
                'weighted_affinity': round(weighted, 4),
                'noise': round(noise, 4),
                'affinity': round(affinity, 4),
                'distance': round(self._policy_distance(city_pos, {
                    d: getattr(p, d + '_position', 0.0) for d in self.POLICY_DIMS
                }), 4),
            })

        total = sum(raw.values())
        for r in rows:
            r['vote_share'] = round(raw[r['party_id']] / total, 4) if total > 0 else 0.0

        return {
            'city_position': city_pos,
            'weights': weights,
            'turnout': round(self.get_city_turnout(city), 4),
            'parties': rows,
        }

    # ========== 城市维度计算 ==========

    def _city_economic_position(self, city: City) -> float:
        """
        经济立场: -1(国家干预/再分配) ~ +1(市场自由/去管制)

        考虑因素：
        - 国有经济比重（高→偏左/干预）
        - 人均GDP（高→偏右/市场）
        - 产业结构（工业→偏左，服务业→偏右）
        """
        score = 0.0
        # 人均GDP越高越倾向市场自由
        score += (city.gdp_per_capita / 200000 - 0.5) * 1.8
        # 第二产业(制造业)比重高→倾向产业政策和干预
        score -= city.secondary_industry_pct * 0.8
        # 第三产业(服务业)比重高→倾向市场
        score += city.tertiary_industry_pct * 0.6
        # 第一产业(农业)高→依赖补贴→偏干预
        score -= city.primary_industry_pct * 1.5
        # 教育程度高→倾向市场和个人自由
        score += (city.education_index - 0.7) * 0.6
        return max(-1.0, min(1.0, score))

    def _city_social_position(self, city: City) -> float:
        """
        社会立场: -1(传统/集体主义) ~ +1(现代/个人主义)

        考虑因素：
        - 城镇化率（高→现代）
        - 教育水平（高→现代）
        - 老龄化（高→传统）
        - 区域文化差异
        """
        score = 0.0
        # 城镇化→现代
        score += (city.urbanization_rate - 0.5) * 1.0
        # 教育→现代/个人主义
        score += (city.education_index - 0.6) * 1.2
        # 老龄化→传统/保守
        score -= city.aging_rate * 1.2
        # 区域文化调整
        if city.region_type == 'western':
            score -= 0.3  # 西部更传统
        elif city.region_type == 'coastal':
            score += 0.2  # 沿海更现代
        elif city.region_type == 'northeast':
            score -= 0.1  # 东北略传统(工业遗产)
        return max(-1.0, min(1.0, score))

    def _city_regional_position(self, city: City) -> float:
        """
        区域认同: -1(沿海/国际化) ~ +1(内陆/本土化)

        考虑因素：
        - 沿海 vs 内陆
        - 对外开放程度
        - 区域发展策略
        """
        if city.region_type == 'coastal':
            return -0.5 - city.urbanization_rate * 0.4
        elif city.region_type == 'western':
            return 0.4 + (1 - city.urbanization_rate) * 0.4
        elif city.region_type == 'northeast':
            return 0.1 + city.aging_rate * 0.3
        else:
            return 0.2 + city.primary_industry_pct * 1.5

    def _city_welfare_preference(self, city: City) -> float:
        """
        福利偏好: -1(低福利/自给) ~ +1(高福利/再分配)

        考虑因素：
        - 老龄化程度高→需要福利
        - 城镇化高→需要公共服务
        - 农业比重高→依赖补贴
        - 人均GDP低→需要再分配
        """
        score = 0.0
        # 老龄化→高福利需求
        score += city.aging_rate * 2.0
        # 城镇化→公共服务需求
        score += (city.urbanization_rate - 0.4) * 0.8
        # 农业→补贴依赖
        score += city.primary_industry_pct * 1.5
        # 低GDP→再分配需求
        score -= (city.gdp_per_capita / 200000 - 0.3) * 1.0
        return max(-1.0, min(1.0, score))

    def _city_environment_preference(self, city: City) -> float:
        """
        环保偏好: -1(发展优先) ~ +1(环保优先)

        考虑因素：
        - 人均GDP高→环保意识强
        - 工业比重高→发展优先
        - 服务业比重高→环保友好
        - 城镇化高→环保需求
        """
        score = 0.0
        # 高GDP→环保优先
        score += (city.gdp_per_capita / 200000) * 1.5
        # 工业→发展优先
        score -= city.secondary_industry_pct * 1.2
        # 服务业→环保友好
        score += city.tertiary_industry_pct * 0.8
        # 城镇化→环保需求
        score += (city.urbanization_rate - 0.5) * 0.6
        return max(-1.0, min(1.0, score))

    def _city_nationalism(self, city: City) -> float:
        """
        民族主义倾向: -1(国际主义/多元) ~ +1(民族主义/保护)

        考虑因素：
        - 沿海→更国际化
        - 内陆→更民族主义
        - 教育水平高→略国际主义
        - 边境地区→民族主义
        """
        score = 0.0
        if city.region_type == 'coastal':
            score -= 0.4
        elif city.region_type in ('western', 'inland'):
            score += 0.3
        # 教育→国际主义
        score -= (city.education_index - 0.6) * 0.8
        # 低GDP→保护主义
        score -= (city.gdp_per_capita / 200000 - 0.3) * 0.6
        return max(-1.0, min(1.0, score))

    def _city_urban_rural(self, city: City) -> float:
        """
        城乡利益: -1(农业农村利益) ~ +1(城市居民利益)

        考虑因素：
        - 城镇化率
        - 农业比重
        - 人口规模
        """
        score = 0.0
        score += (city.urbanization_rate - 0.3) * 1.5
        score -= city.primary_industry_pct * 2.5
        # 大城市→城市利益
        pop_mil = city.population / 1000000
        if pop_mil > 5:
            score += 0.3
        elif pop_mil < 1:
            score -= 0.3
        return max(-1.0, min(1.0, score))

    # ========== 匹配度计算 ==========

    def _economic_match(self, city: City, party: Party) -> float:
        """经济立场匹配"""
        city_pos = self._tilt('economic', self._city_economic_position(city))
        diff = abs(city_pos - party.economic_position)
        return max(0, 1.0 - diff * 1.1)

    def _social_match(self, city: City, party: Party) -> float:
        """社会立场匹配"""
        city_pos = self._tilt('social', self._city_social_position(city))
        diff = abs(city_pos - party.social_position)
        return max(0, 1.0 - diff * 1.0)

    def _regional_match(self, city: City, party: Party) -> float:
        """区域立场匹配"""
        city_pos = self._tilt('regional', self._city_regional_position(city))
        diff = abs(city_pos - party.regional_position)
        return max(0, 1.0 - diff * 1.2)

    def _policy_match(self, city: City, party: Party) -> float:
        """
        政策偏好匹配

        考虑多个政策维度的综合匹配
        """
        # 福利偏好匹配
        city_welfare = self._tilt('welfare', self._city_welfare_preference(city))
        party_welfare = getattr(party, 'welfare_position', 0)
        welfare_match = max(0, 1.0 - abs(city_welfare - party_welfare) * 0.8)

        # 环保偏好匹配
        city_env = self._tilt('environment', self._city_environment_preference(city))
        party_env = getattr(party, 'environment_position', 0)
        env_match = max(0, 1.0 - abs(city_env - party_env) * 0.8)

        # 民族主义匹配
        city_nat = self._tilt('nationalism', self._city_nationalism(city))
        party_nat = getattr(party, 'nationalism_position', 0)
        nat_match = max(0, 1.0 - abs(city_nat - party_nat) * 0.7)

        # 城乡利益匹配
        city_ur = self._tilt('urban_rural', self._city_urban_rural(city))
        party_ur = getattr(party, 'urban_rural_position', 0)
        ur_match = max(0, 1.0 - abs(city_ur - party_ur) * 0.7)

        # 政策维度综合（等权重）
        return (welfare_match + env_match + nat_match + ur_match) / 4

    def compute_vote_shares(self, city: City, parties: list[Party], noise_amplitude: float = 0.03) -> dict[str, float]:
        """计算各政党得票率"""
        raw_scores = {}
        for party in parties:
            raw_scores[party.id] = self.compute_city_party_affinity(city, party, noise_amplitude)

        total = sum(raw_scores.values())
        shares = {pid: score / total for pid, score in raw_scores.items()}
        return shares
