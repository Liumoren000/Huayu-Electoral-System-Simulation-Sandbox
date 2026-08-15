import math
import random
from app.models.city import City, CityData
from app.models.party import Party


# 省级政治文化倾向：在数据驱动的城市维度基础上叠加地区性偏移，
# 使各区域投票倾向更贴近现实（沿海发达→商业/进步/绿色，东北→工人，
# 内陆农业→发展/传统，边疆民族→民族自治党，等等）。
# 键为省份名，值为对各政策维度的偏移量（社会/经济/区域/福利/环保/民族/城乡）。
PROVINCE_TILT = {
    # 沿海发达：现代、国际化、市场、低福利依赖、重环保
    "北京市": {"social": 0.25, "regional": -0.15, "nationalism": -0.2, "welfare": -0.1, "environment": 0.15, "economic": 0.15},
    "上海市": {"social": 0.3, "regional": -0.2, "nationalism": -0.25, "welfare": -0.2, "environment": 0.2, "economic": 0.2},
    "天津市": {"social": 0.2, "regional": -0.1, "nationalism": -0.15, "welfare": -0.1, "economic": 0.15},
    "江苏省": {"social": 0.2, "regional": -0.1, "nationalism": -0.15, "welfare": -0.15, "economic": 0.2, "environment": 0.1},
    "浙江省": {"social": 0.25, "regional": -0.1, "nationalism": -0.2, "welfare": -0.15, "economic": 0.2, "environment": 0.15},
    "福建省": {"social": 0.15, "regional": -0.1, "nationalism": -0.1, "welfare": -0.1, "economic": 0.15},
    "广东省": {"social": 0.2, "regional": -0.15, "nationalism": -0.2, "welfare": -0.15, "economic": 0.2, "environment": 0.15},
    "山东省": {"social": 0.05, "regional": -0.05, "nationalism": -0.05, "welfare": -0.05, "economic": 0.1},
    "海南省": {"social": 0.15, "regional": -0.15, "nationalism": -0.15, "welfare": -0.05, "economic": 0.15, "environment": 0.15},
    "台湾省": {"social": 0.25, "regional": -0.2, "nationalism": -0.25, "welfare": -0.05, "economic": 0.2, "environment": 0.15},
    # 东北：产业衰退、老龄化、福利依赖、略传统
    "辽宁省": {"social": -0.1, "nationalism": 0.1, "welfare": 0.15, "economic": -0.1},
    "吉林省": {"social": -0.15, "nationalism": 0.1, "welfare": 0.2, "economic": -0.1},
    "黑龙江省": {"social": -0.15, "nationalism": 0.15, "welfare": 0.2, "economic": -0.15},
    # 中部/华北农业工业带：温和传统、偏福利、偏本土
    "河北省": {"social": -0.05, "nationalism": 0.05, "welfare": 0.05},
    "山西省": {"social": -0.1, "nationalism": 0.15, "welfare": 0.1, "economic": -0.05},
    "河南省": {"social": -0.15, "nationalism": 0.15, "welfare": 0.1, "economic": -0.05},
    "安徽省": {"social": -0.1, "nationalism": 0.1, "welfare": 0.1},
    "江西省": {"social": -0.1, "nationalism": 0.1, "welfare": 0.1},
    "湖北省": {"social": 0.0, "nationalism": 0.05, "welfare": 0.05},
    "湖南省": {"social": -0.05, "nationalism": 0.1, "welfare": 0.1},
    "四川省": {"social": -0.05, "nationalism": 0.1, "welfare": 0.05},
    "重庆市": {"social": 0.0, "nationalism": 0.05, "welfare": 0.05},
    "陕西省": {"social": -0.1, "nationalism": 0.15, "welfare": 0.15},
    # 西部/边疆民族地区：传统、本土化、民族意识强、高福利需求
    "甘肃省": {"social": -0.2, "nationalism": 0.25, "welfare": 0.2, "regional": 0.15, "economic": -0.1},
    "青海省": {"social": -0.25, "nationalism": 0.3, "welfare": 0.2, "regional": 0.25, "economic": -0.15},
    "宁夏回族自治区": {"social": -0.25, "nationalism": 0.4, "welfare": 0.2, "regional": 0.3, "economic": -0.1},
    "新疆维吾尔自治区": {"social": -0.25, "nationalism": 0.35, "welfare": 0.25, "regional": 0.3, "economic": -0.15},
    "西藏自治区": {"social": -0.3, "nationalism": 0.4, "welfare": 0.3, "regional": 0.35, "economic": -0.2},
    "内蒙古自治区": {"social": -0.25, "nationalism": 0.4, "welfare": 0.2, "regional": 0.3, "economic": -0.1},
    "广西壮族自治区": {"social": -0.2, "nationalism": 0.35, "welfare": 0.15, "regional": 0.3, "economic": -0.05},
    "云南省": {"social": -0.2, "nationalism": 0.25, "welfare": 0.2, "regional": 0.2, "economic": -0.1},
    "贵州省": {"social": -0.25, "nationalism": 0.25, "welfare": 0.25, "regional": 0.2, "economic": -0.15},
}


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

    def __init__(self, seed: int = 42, turnout_shift: float = 0.0, dim_tilt: dict = None,
                 party_effects: dict = None, party_loyalty: float = 0.0,
                 swing_voter_pct: float = 0.0, voter_stratification: bool = False,
                 calibration: bool = False, turnout_differential: float = 0.0,
                 affinity_power: float = 4.0):
        self.rng = random.Random(seed)
        self.seed = seed
        self.turnout_shift = turnout_shift
        self.dim_tilt = dim_tilt or {}
        self.party_effects = party_effects or {}
        self.party_loyalty = party_loyalty
        self.swing_voter_pct = swing_voter_pct
        self.voter_stratification = voter_stratification
        self.calibration = calibration
        self.turnout_differential = turnout_differential
        self.affinity_power = affinity_power
        self._national_swing = {}

    def reset_run(self, seed: int = None) -> None:
        """
        开始新一轮模拟：清空全国性"竞选浪潮"缓存。

        现实中的摇摆选民会受全国性事件（辩论/丑闻/经济数据）影响，产生
        跨城市相关的整体偏移。浪潮按 (run_seed, party_id) 确定性采样，
        同轮内各城市一致、不同轮之间不同，模拟一轮选战的全国性氛围。
        """
        self._national_swing = {}

    def _national_swing_for(self, party_id: str) -> float:
        """该轮内对某党的全国性浪潮冲击（确定性：同一轮内恒定）"""
        if party_id not in self._national_swing:
            # 用稳定哈希（zlib.crc32）而非内置 hash()，保证跨进程/会话确定性
            import zlib
            h = zlib.crc32(f"{self.seed}:{party_id}".encode())
            r = random.Random(h)
            self._national_swing[party_id] = r.gauss(0.0, 0.045)
        return self._national_swing[party_id]

    def _tilt(self, dim: str, base: float) -> float:
        """全国选民在某一政策维度上的偏好偏移（选举剧本机制）"""
        return base + self.dim_tilt.get(dim, 0.0)

    def _city_tilt(self, city: City, dim: str, base: float) -> float:
        """城市维度：叠加全国 dim_tilt 与省级政治文化 PROVINCE_TILT"""
        return base + self.dim_tilt.get(dim, 0.0) + PROVINCE_TILT.get(city.province, {}).get(dim, 0.0)

    POLICY_DIMS = ['economic', 'social', 'regional', 'welfare', 'environment', 'nationalism', 'urban_rural']

    def _policy_distance(self, vpos: dict, ppos: dict) -> float:
        """选民与政党的政策空间距离（7 维欧氏距离）"""
        return math.sqrt(sum((vpos.get(d, 0) - ppos.get(d, 0)) ** 2 for d in self.POLICY_DIMS))

    def _city_segments(self, city: City) -> list[dict]:
        """
        城市内选民分层中心（多中心混合分布）。

        依据城市人口结构生成多个偏好亚群体：
        - 老年保守派（aging_rate 高 → 传统/福利）
        - 年轻进步派（城镇化/教育高 → 现代/环保）
        - 高学历国际派（education_index 高 → 市场自由/国际主义）
        - 产业工人派（secondary_industry_pct 高 → 干预/福利）
        - 农村农业派（primary_industry_pct 高 → 农业利益/本土化）
        各亚群占比由城市人口结构决定，分布更接近真实选民异质性。
        """
        aging = city.aging_rate
        edu = city.education_index
        secondary = city.secondary_industry_pct
        primary = city.primary_industry_pct
        urban = city.urbanization_rate

        segments = []
        # 老年保守派：老龄化越高占比越大
        elder_w = aging
        segments.append({
            'weight': elder_w,
            'offset': {'social': -0.35, 'welfare': 0.35, 'environment': -0.15,
                       'nationalism': 0.2, 'economic': -0.1, 'urban_rural': -0.2},
        })
        # 年轻进步派：城镇化高/教育高占比大
        youth_w = 0.15 + (urban - 0.4) * 0.5
        segments.append({
            'weight': max(0.02, youth_w),
            'offset': {'social': 0.4, 'environment': 0.3, 'economic': 0.1,
                       'nationalism': -0.2, 'urban_rural': 0.2},
        })
        # 高学历国际派
        edu_w = max(0.0, (edu - 0.55) * 1.5)
        segments.append({
            'weight': edu_w,
            'offset': {'economic': 0.3, 'social': 0.25, 'regional': -0.3,
                       'environment': 0.15, 'nationalism': -0.3},
        })
        # 产业工人派
        sec_w = secondary * 1.2
        segments.append({
            'weight': max(0.0, sec_w),
            'offset': {'economic': -0.5, 'welfare': 0.5, 'social': -0.15,
                       'environment': -0.2, 'urban_rural': -0.1},
        })
        # 农村农业派
        agr_w = primary * 2.0
        segments.append({
            'weight': max(0.0, agr_w),
            'offset': {'economic': -0.3, 'regional': 0.4, 'nationalism': 0.3,
                       'welfare': 0.2, 'urban_rural': -0.5},
        })
        # 补足基础人群（接近城市中心）
        total_w = sum(s['weight'] for s in segments) + 0.35
        base_w = max(0.0, 1.0 - total_w + 0.35)
        segments.append({'weight': base_w, 'offset': {}})
        return segments

    def _pick_segment(self, segments: list[dict], rng: random.Random) -> dict:
        """按权重随机选择一个选民亚群"""
        r = rng.random()
        total = sum(s['weight'] for s in segments)
        acc = 0.0
        for s in segments:
            acc += s['weight'] / total
            if r <= acc:
                return s
        return segments[-1]

    def sample_voter_rankings(self, city: City, parties: list[Party], n: int = 80,
                              noise_amplitude: float = 0.12) -> list[list[str]]:
        """
        为排名票制度生成市内选民对政党的偏好排序（排名票基础）。

        每位虚拟选民位置 = 城市政策维度 + 高斯噪声（幅度可调），
        按到各政党政策位置的距离升序排名。使用独立种子，不影响
        compute_vote_shares 等既有随机序列，保证 FPTP/PR 结果与之前逐位一致。

        当 voter_stratification 开启时，选民位置从多个亚群中心混合采样，
        反映城市内年龄/收入/教育分层。
        """
        rng = random.Random(self.seed * 1000000 + int(city.id))
        city_pos = self.get_city_dimensions(city)
        segments = self._city_segments(city) if self.voter_stratification else [{'weight': 1, 'offset': {}}]
        party_pos = {p.id: {d: getattr(p, d + '_position', 0.0) for d in self.POLICY_DIMS} for p in parties}
        rankings = []
        for _ in range(n):
            seg = self._pick_segment(segments, rng)
            noise = noise_amplitude * (rng.uniform(1.5, 3.0) if self._is_swing(rng) else 1.0)
            vpos = {d: city_pos.get(d, 0) + seg['offset'].get(d, 0) + rng.gauss(0, noise)
                    for d in self.POLICY_DIMS}
            ordered = sorted(parties, key=lambda p: self._policy_distance(vpos, party_pos[p.id]))
            rankings.append([p.id for p in ordered])
        return rankings

    def _is_swing(self, rng: random.Random) -> bool:
        """按摇摆选民比例判定该虚拟选民是否为摇摆选民"""
        return self.swing_voter_pct > 0 and rng.random() < self.swing_voter_pct

    def _apply_party_effects(self, scores: dict, parties: list[Party]) -> dict:
        """叠加政党特定事件效应（丑闻减分、领袖魅力加分等）"""
        if not self.party_effects:
            return scores
        out = dict(scores)
        for pid, delta in self.party_effects.items():
            if pid in out:
                out[pid] = max(0.001, out[pid] + delta)
        return out

    def compute_city_party_affinity(self, city: City, party: Party, noise_amplitude: float = 0.03,
                                    segment_offset: dict = None) -> float:
        """
        计算城市对政党的综合亲和度（7 维加权）。

        权重反映现实政治中各方争夺选民的核心维度：
        经济(25%) > 社会(15%) = 区域(15%) = 民族认同(15%) > 福利(10%) = 环保(10%) = 城乡(10%)。
        民族/区域认同给予足额权重——多民族国家中文化认同是选票结构的重要来源。
        """
        scores = []

        # 经济维度匹配 (25%)
        econ_score = self._economic_match(city, party, segment_offset)
        scores.append(('economic', econ_score, 0.25))

        # 社会维度匹配 (15%)
        social_score = self._social_match(city, party, segment_offset)
        scores.append(('social', social_score, 0.15))

        # 区域维度匹配 (15%)
        regional_score = self._regional_match(city, party, segment_offset)
        scores.append(('regional', regional_score, 0.15))

        # 福利维度匹配 (10%)
        city_welfare = self._city_tilt(city, 'welfare', self._city_welfare_preference(city))
        city_welfare += (segment_offset or {}).get('welfare', 0.0)
        welfare_score = max(0, 1.0 - abs(city_welfare - getattr(party, 'welfare_position', 0)) * 0.8)
        scores.append(('welfare', welfare_score, 0.10))

        # 环保维度匹配 (10%)
        city_env = self._city_tilt(city, 'environment', self._city_environment_preference(city))
        city_env += (segment_offset or {}).get('environment', 0.0)
        env_score = max(0, 1.0 - abs(city_env - getattr(party, 'environment_position', 0)) * 0.8)
        scores.append(('environment', env_score, 0.10))

        # 民族认同匹配 (15%)
        city_nat = self._city_tilt(city, 'nationalism', self._city_nationalism(city))
        city_nat += (segment_offset or {}).get('nationalism', 0.0)
        nat_score = max(0, 1.0 - abs(city_nat - getattr(party, 'nationalism_position', 0)) * 1.0)
        scores.append(('nationalism', nat_score, 0.15))

        # 城乡利益匹配 (10%)
        city_ur = self._city_tilt(city, 'urban_rural', self._city_urban_rural(city))
        city_ur += (segment_offset or {}).get('urban_rural', 0.0)
        ur_score = max(0, 1.0 - abs(city_ur - getattr(party, 'urban_rural_position', 0)) * 0.9)
        scores.append(('urban_rural', ur_score, 0.10))

        raw_score = sum(s * w for _, s, w in scores)

        # 添加随机扰动模拟现实不确定性（幅度可调）
        noise = self.rng.gauss(0, noise_amplitude)
        return max(0.01, raw_score + noise)

    def get_city_dimensions(self, city: City) -> dict[str, float]:
        """获取城市在各维度的位置（叠加全国偏好偏移 dim_tilt 与省级政治文化 PROVINCE_TILT）"""
        tilt = PROVINCE_TILT.get(city.province, {})
        base = {
            'economic': self._tilt('economic', self._city_economic_position(city)),
            'social': self._tilt('social', self._city_social_position(city)),
            'regional': self._tilt('regional', self._city_regional_position(city)),
            'welfare': self._tilt('welfare', self._city_welfare_preference(city)),
            'environment': self._tilt('environment', self._city_environment_preference(city)),
            'nationalism': self._tilt('nationalism', self._city_nationalism(city)),
            'urban_rural': self._tilt('urban_rural', self._city_urban_rural(city)),
        }
        return {d: round(max(-1.0, min(1.0, base[d] + tilt.get(d, 0.0))), 3) for d in base}

    def get_city_turnout(self, city: City, urban_rural_weight: float = 1.0,
                         competitiveness: float = None, abstention_sensitivity: float = 0.0) -> float:
        """
        计算城市投票率 (0.35 - 0.80)

        考虑因素：
        - 城镇化率（高→投票率高）
        - 教育水平（高→投票率高）
        - 老龄化（中等→投票率高，过高→投票率下降）
        - 区域差异（沿海→高，偏远农村→低）
        - 竞争激烈程度（可选，竞争越激烈投票率越高）

        Args:
            city: 城市数据
            urban_rural_weight: 城乡投票率差异权重 (0.0-2.0)
                0.0 = 城乡无差异
                1.0 = 默认差异
                2.0 = 差异加倍
            competitiveness: 竞争度 0~1（1-胜差），越接近 1 越胶着
            abstention_sensitivity: 竞争度对投票率的调节强度
        """
        base = 0.55

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

        # 群体差异化投票率：老年/高学历/高收入/城市选民投票率更高。
        # 采用"相对强度×城市基准"的增量方式，保留城市间区域/结构差异
        # （避免整体替换导致全国投票率塌缩到狭窄区间）。
        d = self.turnout_differential or 0.0
        if d > 0:
            weights = self._group_turnout_weights(city)
            # 各群体相对基准的投票率乘数（围绕 1.0 的差异化强度）
            group_mult = {
                'elder': 1.10, 'youth': 0.92,
                'high_edu': 1.10, 'low_edu': 0.92,
                'urban': 1.06, 'rural': 0.94,
                'high_income': 1.08, 'low_income': 0.94,
            }
            total_w = sum(weights.values())
            mult = 1.0
            if total_w > 0:
                mult = sum(w * group_mult.get(k, 1.0) for k, w in weights.items()) / total_w
            # 强度 0 → 城市基准；强度 1 → 城市基准 × 群体相对乘数
            turnout *= (1.0 - d + d * mult)

        # 竞争激烈调节：胜差越小（越胶着）投票率越高
        if abstention_sensitivity > 0 and competitiveness is not None:
            # competitiveness = 1 - 胜差，胶着 → 投票率提高；碾压 → 略降
            turnout += (competitiveness - 0.6) * abstention_sensitivity * 0.20

        turnout += self.turnout_shift
        return round(max(0.35, min(0.95, turnout)), 4)

    def _group_turnout_weights(self, city: City) -> dict[str, float]:
        """
        城市人口结构 → 各差异化投票群体的相对占比。
        复用 _STRUCTURE_GROUPS 的画像权重逻辑，但输出归一化占比
        （同维度两群体互补，和为 1），供群体差异化投票率加权使用。
        """
        aging = max(0.0, min(1.0, city.aging_rate))
        edu = max(0.0, min(1.0, city.education_index))
        urban = max(0.0, min(1.0, city.urbanization_rate))
        gdp = city.gdp_per_capita
        # 收入高低占比：与 gdp 对数相关（gdp 分布高度右偏，用 log 映射覆盖
        # 真实范围 1k~200k 元；避免固定线性阈值使多数城市高收入占比贴地板）
        gmin, gmax = 2000.0, 200000.0
        ln_ratio = (math.log(max(gdp, 1.0)) - math.log(gmin)) / max(1e-9, math.log(gmax) - math.log(gmin))
        income_high = max(0.02, min(0.98, 0.08 + 0.8 * ln_ratio))
        return {
            'elder': aging,
            'youth': 1.0 - aging,
            'high_edu': edu,
            'low_edu': 1.0 - edu,
            'urban': urban,
            'rural': 1.0 - urban,
            'high_income': income_high,
            'low_income': 1.0 - income_high,
        }

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
        # 与 compute_city_party_affinity 完全一致的 7 维权重
        weights = {'economic': 0.25, 'social': 0.15, 'regional': 0.15,
                   'welfare': 0.10, 'environment': 0.10, 'nationalism': 0.15,
                   'urban_rural': 0.10}

        rows = []
        raw = {}
        for p in parties:
            econ = self._economic_match(city, p)
            social = self._social_match(city, p)
            regional = self._regional_match(city, p)
            welfare = self._policy_dim_match(city, p, 'welfare', 0.8)
            environment = self._policy_dim_match(city, p, 'environment', 0.8)
            nationalism = self._policy_dim_match(city, p, 'nationalism', 1.0)
            urban_rural = self._policy_dim_match(city, p, 'urban_rural', 0.9)
            weighted = econ * weights['economic'] + social * weights['social'] \
                + regional * weights['regional'] + welfare * weights['welfare'] \
                + environment * weights['environment'] + nationalism * weights['nationalism'] \
                + urban_rural * weights['urban_rural']
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
                'welfare': round(welfare, 4),
                'environment': round(environment, 4),
                'nationalism': round(nationalism, 4),
                'urban_rural': round(urban_rural, 4),
                'weighted_affinity': round(weighted, 4),
                'noise': round(noise, 4),
                'affinity': round(affinity, 4),
                'distance': round(self._policy_distance(city_pos, {
                    d: getattr(p, d + '_position', 0.0) for d in self.POLICY_DIMS
                }), 4),
            })

        # 得票率与引擎同口径：浓缩后归一化（而非线性归一化）
        conc = self._concentrate({pid: max(0.0, v) for pid, v in raw.items()})
        total = sum(conc.values())
        for r in rows:
            r['vote_share'] = round(conc[r['party_id']] / total, 4) if total > 0 else 0.0

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
        - 人均GDP高→自给能力强，倾向低福利低税收
        """
        score = 0.0
        # 老龄化→高福利需求
        score += city.aging_rate * 1.5
        # 城镇化→公共服务需求
        score += (city.urbanization_rate - 0.4) * 0.8
        # 农业→补贴依赖
        score += city.primary_industry_pct * 1.0
        # 高GDP→低福利低税收偏好
        score -= (city.gdp_per_capita / 200000 - 0.3) * 2.0
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
        score -= city.secondary_industry_pct * 1.5
        # 服务业→环保友好
        score += city.tertiary_industry_pct * 0.8
        # 城镇化→环保需求
        score += (city.urbanization_rate - 0.5) * 0.5
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

    def _economic_match(self, city: City, party: Party, segment_offset: dict = None) -> float:
        """经济立场匹配"""
        city_pos = self._city_tilt(city, 'economic', self._city_economic_position(city))
        city_pos += (segment_offset or {}).get('economic', 0.0)
        diff = abs(city_pos - party.economic_position)
        return max(0, 1.0 - diff * 1.1)

    def _social_match(self, city: City, party: Party, segment_offset: dict = None) -> float:
        """社会立场匹配"""
        city_pos = self._city_tilt(city, 'social', self._city_social_position(city))
        city_pos += (segment_offset or {}).get('social', 0.0)
        diff = abs(city_pos - party.social_position)
        return max(0, 1.0 - diff * 1.0)

    def _regional_match(self, city: City, party: Party, segment_offset: dict = None) -> float:
        """区域立场匹配"""
        city_pos = self._city_tilt(city, 'regional', self._city_regional_position(city))
        city_pos += (segment_offset or {}).get('regional', 0.0)
        diff = abs(city_pos - party.regional_position)
        return max(0, 1.0 - diff * 1.2)

    def _policy_dim_match(self, city: City, party: Party, dim: str, penalty: float,
                          segment_offset: dict = None) -> float:
        """单政策维度匹配（与 compute_city_party_affinity 的对应分支完全一致）"""
        off = segment_offset or {}
        if dim == 'welfare':
            city_val = self._city_tilt(city, 'welfare', self._city_welfare_preference(city))
            city_val += off.get('welfare', 0.0)
        elif dim == 'environment':
            city_val = self._city_tilt(city, 'environment', self._city_environment_preference(city))
            city_val += off.get('environment', 0.0)
        elif dim == 'nationalism':
            city_val = self._city_tilt(city, 'nationalism', self._city_nationalism(city))
            city_val += off.get('nationalism', 0.0)
        else:  # urban_rural
            city_val = self._city_tilt(city, 'urban_rural', self._city_urban_rural(city))
            city_val += off.get('urban_rural', 0.0)
        party_val = getattr(party, dim + '_position', 0)
        return max(0, 1.0 - abs(city_val - party_val) * penalty)

    def compute_vote_shares(self, city: City, parties: list[Party], noise_amplitude: float = 0.03) -> dict[str, float]:
        """计算各政党得票率（含真实感机制：分层/忠诚/摇摆/事件/校准）"""
        # 校准：以城市基准政党作为历史锚点，回拉得票率
        if self.calibration:
            return self._compute_calibrated_shares(city, parties, noise_amplitude)

        # 分层：按亚群中心分别计算再按权重混合
        if self.voter_stratification:
            segments = self._city_segments(city)
            agg = {p.id: 0.0 for p in parties}
            total_w = sum(s['weight'] for s in segments)
            for seg in segments:
                seg_share = self._shares_with_loyalty(city, parties, noise_amplitude, seg['offset'], seg['weight'])
                for pid, v in seg_share.items():
                    agg[pid] += v * seg['weight'] / total_w
            return self._concentrate(self._normalize(agg))

        return self._concentrate(self._normalize(self._shares_with_loyalty(city, parties, noise_amplitude, None, 1.0)))

    def _concentrate(self, shares: dict) -> dict[str, float]:
        """
        得票率浓缩：对得票率做幂次加权后归一化，放大政党间差距。

        现实多党制中首党常获 30%+、末党 <5%，而线性归一化会使其趋近 1/N。
        以 p = affinity_power 做 s^p 归一化，模拟选民"偏好集中"而非均匀分散。
        """
        p = self.affinity_power or 1.0
        if p <= 1.0:
            return shares
        powered = {pid: max(0.0, v) ** p for pid, v in shares.items()}
        total = sum(powered.values())
        if total <= 0:
            return shares
        return {pid: v / total for pid, v in powered.items()}

    def _normalize(self, raw: dict) -> dict[str, float]:
        total = sum(raw.values())
        if total <= 0:
            return {pid: 1.0 / max(1, len(raw)) for pid in raw}
        return {pid: v / total for pid, v in raw.items()}

    def _shares_with_loyalty(self, city: City, parties: list[Party], noise_amplitude: float,
                             segment_offset: dict, segment_weight: float) -> dict[str, float]:
        """计算单亚群得票率，并应用政党忠诚与摇摆噪声"""
        raw_scores = {}
        for party in parties:
            # 摇摆选民噪声更大
            amp = noise_amplitude
            base = self.compute_city_party_affinity(city, party, amp, segment_offset)
            # 摇摆选民：全国性竞选浪潮（跨城市相关的系统冲击）+ 局部扰动
            if self.swing_voter_pct > 0 and segment_offset is None:
                swing_amp = noise_amplitude * 2.0
                local = self.compute_city_party_affinity(city, party, swing_amp, segment_offset)
                wave = self._national_swing_for(party.id)
                # 浪潮使亲和度按比例整体抬升/压低（全国同步），局部噪声补充城市级波动
                swing_base = max(0.001, base * (1.0 + wave) * 0.9 + local * 0.1)
                base = base * (1 - self.swing_voter_pct) + swing_base * self.swing_voter_pct
            raw_scores[party.id] = base

        raw_scores = self._apply_party_effects(raw_scores, parties)

        # 政党忠诚（铁票党）：每个政党按其在城市中的噪声无关亲和度份额
        # 获得固定忠诚票仓（占 party_loyalty 比例），其余选票随议题/噪声浮动。
        # 与现实一致：忠诚票仓按政党真实支持强度分布，而非全部归于单一锚党。
        if self.party_loyalty > 0:
            base_aff = {p.id: self.compute_city_party_affinity(city, p, 0.0, segment_offset)
                        for p in parties}
            total_aff = sum(base_aff.values())
            base_share = {pid: v / total_aff if total_aff > 0 else 1.0 / max(1, len(parties))
                          for pid, v in base_aff.items()}
            loyal = {pid: base_share[pid] * self.party_loyalty for pid in raw_scores}
            issue = {pid: v * (1 - self.party_loyalty) for pid, v in raw_scores.items()}
            raw_scores = {pid: loyal[pid] + issue[pid] for pid in raw_scores}

        return raw_scores

    def _city_anchor_party(self, city: City, parties: list[Party]) -> str:
        """城市基准政党：与城市7维位置距离最近的政党（历史倾向锚点）"""
        city_pos = self.get_city_dimensions(city)
        best = min(parties, key=lambda p: self._policy_distance(city_pos, {
            d: getattr(p, d + '_position', 0.0) for d in self.POLICY_DIMS}))
        return best.id

    def _compute_calibrated_shares(self, city: City, parties: list[Party],
                                   noise_amplitude: float) -> dict[str, float]:
        """校准模式：以城市基准政党为核心，结合亲和度分配。

        锚点份额按基准党在城市中的真实亲和强度缩放：强区 40-55%、
        弱区 <10%，而非固定 30%——避免制造"双头垄断"。
        """
        anchor = self._city_anchor_party(city, parties)
        # 基准党亲和度相对各党的优势程度 → 锚点强度
        raw = self._shares_with_loyalty(city, parties, noise_amplitude, None, 1.0)
        total_raw = sum(raw.values())
        anchor_aff = raw.get(anchor, 0.0)
        share_of_total = anchor_aff / total_raw if total_raw > 0 else 1.0 / max(1, len(parties))
        # 锚点份额随优势程度从 0.08 到 0.55 线性映射（优势越明显锚点越强）
        anchor_share = 0.08 + 0.47 * max(0.0, min(1.0, (share_of_total - 1.0 / max(1, len(parties))) * len(parties)))
        base = {pid: v / total_raw if total_raw > 0 else 0 for pid, v in raw.items()}
        out = {pid: base[pid] * (1 - anchor_share) for pid in base}
        out[anchor] = out.get(anchor, 0.0) + anchor_share
        return self._concentrate(self._normalize(out))

    # ========== 选民结构分解（按年龄/教育/城乡/收入） ==========

    # 各人口群体的政策偏好偏移（沿用 _city_segments 的亚群画像）
    _STRUCTURE_GROUPS = {
        'age': {
            'label': '年龄结构',
            'groups': [
                ('elder', '老年选民', 'aging_rate',
                 {'social': -0.35, 'welfare': 0.35, 'environment': -0.15, 'nationalism': 0.2, 'economic': -0.1, 'urban_rural': -0.2}),
                ('youth', '中青年选民', None,
                 {'social': 0.4, 'environment': 0.3, 'economic': 0.1, 'nationalism': -0.2, 'urban_rural': 0.2}),
            ],
        },
        'education': {
            'label': '教育程度',
            'groups': [
                ('high_edu', '高学历选民', 'education_index',
                 {'economic': 0.3, 'social': 0.25, 'regional': -0.3, 'environment': 0.15, 'nationalism': -0.3}),
                ('low_edu', '中低学历选民', None,
                 {'economic': -0.25, 'social': -0.25, 'regional': 0.25, 'welfare': 0.3, 'nationalism': 0.25}),
            ],
        },
        'urban_rural': {
            'label': '城乡分布',
            'groups': [
                ('urban', '城市选民', 'urbanization_rate',
                 {'social': 0.3, 'environment': 0.25, 'economic': 0.15, 'nationalism': -0.2, 'urban_rural': 0.25}),
                ('rural', '乡村选民', None,
                 {'economic': -0.3, 'regional': 0.4, 'nationalism': 0.3, 'welfare': 0.2, 'urban_rural': -0.5}),
            ],
        },
        'income': {
            'label': '收入水平',
            'groups': [
                ('high_income', '高收入选民', 'income_high',
                 {'economic': 0.35, 'welfare': -0.3, 'social': 0.2, 'environment': 0.15}),
                ('low_income', '中低收入选民', None,
                 {'economic': -0.4, 'welfare': 0.4, 'social': -0.1, 'environment': -0.2}),
            ],
        },
    }

    def compute_structure(self, city_data: CityData, parties: list[Party],
                          scope_provinces: list[str] = None,
                          noise_amplitude: float = 0.0,
                          city_vote_shares: dict[str, dict[str, float]] = None,
                          party_results: list = None) -> dict:
        """
        按人口群体分解全国/某省选票构成。

        对每个维度（年龄/教育/城乡/收入），将人口划分为两个互斥群体，
        用该群体的政策偏好偏移与城市基准位置计算各政党亲和度，
        再按（城市人口 × 群体占比）加权聚合，得到每个群体的政党得票率。

        若传入 city_vote_shares（引擎实际模拟的城市级得票率），则把每个城市
        的真实得票按群体占比分解，保证总体=实际推演结果、赢家与主表一致。
        """
        cities = [c for c in city_data.cities
                  if not scope_provinces or c.province in scope_provinces]
        if not cities or not parties:
            return {}

        gdps = sorted(c.gdp_per_capita for c in city_data.cities)
        gmin, gmax = (gdps[0], gdps[-1]) if gdps else (0, 1)

        def _weight(city, spec):
            if spec == 'aging_rate':
                return max(0.0, city.aging_rate)
            if spec == 'education_index':
                return max(0.0, min(1.0, city.education_index))
            if spec == 'urbanization_rate':
                return max(0.0, min(1.0, city.urbanization_rate))
            if spec == 'income_high':
                r = 0.15 + 0.7 * (city.gdp_per_capita - gmin) / max(1e-9, gmax - gmin)
                return max(0.02, min(0.98, r))
            return None  # 互补群体

        def _group_shares(city, offset, noise):
            """某城市在给定群体偏好下的政党份额（含忠诚/摇摆/事件，与引擎一致）"""
            seg = self._shares_with_loyalty(city, parties, noise, offset, 1.0)
            total = sum(seg.values())
            if total <= 0:
                return {p.id: 0.0 for p in parties}
            return {pid: v / total for pid, v in seg.items()}

        def _city_vote(city):
            if city_vote_shares:
                vs = city_vote_shares.get(city.id)
                if vs:
                    return {pid: max(0.0, v) for pid, v in vs.items()}
            return _group_shares(city, None, noise_amplitude)

        dimensions = {}
        for dim_key, dim in self._STRUCTURE_GROUPS.items():
            entries = []
            for (gkey, glabel, spec, offset) in dim['groups']:
                votes = {p.id: 0.0 for p in parties}
                pop = 0.0
                for city in cities:
                    w = _weight(city, spec)
                    if spec is None:
                        w = max(0.0, 1.0 - _weight(city, dim['groups'][0][2]))
                    if w <= 0:
                        continue
                    city_pop = city.population * w
                    # 该群体在给定偏好下的政党份额（噪声 0，稳定可解读）
                    grp_share = _group_shares(city, offset, 0.0)
                    for pid, v in grp_share.items():
                        votes[pid] += v * city_pop
                    pop += city_pop
                if pop <= 0:
                    shares = {p.id: 0.0 for p in parties}
                else:
                    shares = {pid: v / pop for pid, v in votes.items()}
                winner = max(parties, key=lambda p: shares[p.id])
                entries.append({
                    'key': gkey,
                    'label': glabel,
                    'weight': round(pop, 1),
                    'shares': {pid: round(s, 4) for pid, s in shares.items()},
                    'winner': winner.id,
                })
            dimensions[dim_key] = {'label': dim['label'], 'groups': entries}

        # 总体：优先使用引擎真实 party_results（含 turnout/人口加权），
        # 保证与主表完全一致；否则回退为群体加权平均
        if party_results:
            overall = {pr.party_id: round(pr.vote_share, 4) for pr in party_results}
            # 赢家按席位排序（与主表一致）；备注得票率第一名
            winner = max(party_results, key=lambda pr: pr.seats)
            runner_up = sorted(party_results, key=lambda pr: -pr.seats)[1] if len(party_results) > 1 else None
            vote_leader = max(party_results, key=lambda pr: pr.vote_share)
            winner = {
                'party_id': winner.party_id, 'party_name': winner.party_name,
                'color': winner.color, 'share': overall[winner.party_id],
                'seats': winner.seats,
            }
            runner_up = ({
                'party_id': runner_up.party_id, 'party_name': runner_up.party_name,
                'color': runner_up.color, 'share': overall[runner_up.party_id],
                'seats': runner_up.seats,
            } if runner_up else None)
            vote_leader = {
                'party_id': vote_leader.party_id, 'party_name': vote_leader.party_name,
                'color': vote_leader.color, 'share': overall[vote_leader.party_id],
            }
        else:
            if city_vote_shares:
                agg_votes = {p.id: 0.0 for p in parties}
                agg_pop = 0.0
                for city in cities:
                    cv = _city_vote(city)
                    tot = sum(cv.values())
                    if tot <= 0:
                        continue
                    w = city.population
                    for pid, v in cv.items():
                        agg_votes[pid] += (v / tot) * w
                    agg_pop += w
                overall = {pid: round(v / agg_pop, 4) if agg_pop else 0
                           for pid, v in agg_votes.items()}
            else:
                agg_votes = {p.id: 0.0 for p in parties}
                agg_pop = 0.0
                for dim in dimensions.values():
                    for g in dim['groups']:
                        for pid, s in g['shares'].items():
                            agg_votes[pid] += s * g['weight']
                        agg_pop += g['weight']
                overall = {pid: round(v / agg_pop, 4) if agg_pop else 0
                           for pid, v in agg_votes.items()}
            winner = max(parties, key=lambda p: overall[p.id])
            runner_up = sorted(parties, key=lambda p: -overall[p.id])[1] if len(parties) > 1 else None
            winner = {
                'party_id': winner.id, 'party_name': winner.name,
                'color': winner.color, 'share': overall[winner.id],
            }
            runner_up = ({
                'party_id': runner_up.id, 'party_name': runner_up.name,
                'color': runner_up.color, 'share': overall[runner_up.id],
            } if runner_up else None)

        return {
            'scope': (scope_provinces[0] if scope_provinces and len(scope_provinces) == 1
                      else '全国'),
            'city_count': len(cities),
            'total_population': int(sum(c.population for c in cities)),
            'overall': overall,
            'winner': winner,
            'runner_up': runner_up,
            'vote_leader': vote_leader if party_results else None,
            'dimensions': dimensions,
        }
