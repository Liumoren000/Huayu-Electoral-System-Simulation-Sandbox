from pydantic import BaseModel
from typing import Optional


class CityResult(BaseModel):
    city_id: str
    city_name: str
    province: str = ""  # 所属省，供报告/导出按省份聚合
    winner_party_id: str
    winner_party_name: str
    vote_shares: dict[str, float]  # party_id -> vote share
    turnout: float
    eligible_voter_ratio: float = 0.0  # 18+ 适龄选民占总人口比例
    seats: int = 0
    affinities: dict[str, float] = {}  # party_id -> raw affinity score
    dimensions: dict[str, float] = {}  # economic, social, regional position
    party_seats: dict[str, int] = {}  # party_id -> seats won in this city


class PartySeatResult(BaseModel):
    party_id: str
    party_name: str
    seats: int
    vote_share: float
    color: str
    economic_position: float = 0.0
    social_position: float = 0.0
    camp: str = ""
    vote_efficiency: float = 0.0  # 每获1%议席需票%（<1 过代表，>1 欠代表）


class ProvinceResult(BaseModel):
    province_name: str
    winner_party_id: str
    winner_party_name: str
    vote_shares: dict[str, float]
    num_cities: int
    population: int
    seats: int
    avg_turnout: float = 0.6
    party_seats: dict[str, int] = {}  # party_id -> seats won in this province


class RegionalBlock(BaseModel):
    """区域政治集团：由同一政党赢得的省份集合（政治地理版图）"""
    party_id: str
    party_name: str
    color: str = ""
    province_count: int = 0
    total_seats: int = 0
    total_population: int = 0
    provinces: list[str] = []
    block_label: str = ""  # 集团政治地理标签（如"边疆民族区"）


class DisproportionalityDecomposition(BaseModel):
    """
    不比例性三源分解（基于 Loosemore-Hanby 口径）：
    - geographic: 选票地理分布效应 —— 全国选票在全国化比例分配下的固有偏差
    - malapportionment: 选区名额失衡效应 —— 省际席位与人口错配造成的偏差
    - mechanical: 制度机制效应 —— 胜者全得/门槛/选区内部赢家拿全部席位的剩余偏差
    - total: 总偏差 = 0.5 * Σ|票份额 - 席份额|
    """
    geographic: float = 0.0
    malapportionment: float = 0.0
    mechanical: float = 0.0
    total: float = 0.0


class ElectionResult(BaseModel):
    config_name: str
    system_type: str
    total_seats: int
    city_results: list[CityResult]
    province_results: list[ProvinceResult]
    party_results: list[PartySeatResult]
    total_votes: int
    effective_parties_vote: float = 0.0
    effective_parties_seats: float = 0.0
    gallagher_index: float = 0.0
    loosemore_hanby: float = 0.0  # 0.5*Σ|票份额-席份额|
    rose_index: float = 1.0  # 1 - Loosemore-Hanby，越高越成比例
    malapportionment_index: float = 0.0  # 0.5*Σ|省席份额-省人口份额|
    party_nationalization_index: float = 0.0  # 0-1，越高政党越全国化
    disproportionality_decomposition: DisproportionalityDecomposition = DisproportionalityDecomposition()
    upper_house_party_results: list[PartySeatResult] = []
    upper_house_province_results: list[ProvinceResult] = []
    upper_house_total_seats: int = 0
    party_system_classification: str = ""  # Sartori 类型学：一党主导制/两党制/温和多党制/碎片化多党制
    party_system_classification_detail: str = ""  # 分类依据（含关键指标）
    polarization_index: float = 0.0  # 议会极化度：席位加权意识形态标准差（0-1，越高越两极化）
    regional_blocks: list[RegionalBlock] = []  # 区域政治集团（按省份赢家归纳）
    overhang_seats: int = 0  # MMP 超额席位（悬空席）总数
    overhang_by_party: dict[str, int] = {}  # MMP 各党超额席位数（party_id -> n）
    median_voter_alignment: dict = {}  # 中间选民分析：赢家/各党与选民中位立场的距离
    split_ticket: dict[str, float] = {}  # 分裂选票：各党名单票-选区票差（pp）


class CoalitionOption(BaseModel):
    parties: list[str]
    party_names: list[str]
    total_seats: int
    ideological_distance: float
    is_majority: bool
    policy_compatibility: float = 0.0
    stability_score: float = 0.0
    excess: int = 0
    majority_type: str = "narrow"


class PartyPowerIndex(BaseModel):
    party_id: str
    party_name: str
    seats: int = 0
    banzhaf: float = 0.0
    shapley_shubik: float = 0.0
    pivotal: bool = False  # 该党加入联盟即凑够多数（关键少数）


class CoalitionMatrixRow(BaseModel):
    """一个能凑够多数的政党组合"""
    parties: list[str]
    party_names: list[str]
    total_seats: int
    excess: int = 0  # 超过多数门槛的冗余席位数
    size: int = 2
    minimal: bool = False  # 最小获胜联盟：去掉任一党即不过半
    stability_score: float = 0.0


class CoalitionInclusion(BaseModel):
    """政党出现在各获胜联盟中的参与度"""
    party_id: str
    party_name: str
    total_count: int = 0  # 出现在多少个过半联盟中
    minimal_count: int = 0  # 出现在多少个最小获胜联盟中


class CoalitionMatrix(BaseModel):
    single_party_majority: Optional[str] = None  # 单一政党绝对多数时记录其 id
    total: int = 0  # 过半联盟总数
    minimal_count: int = 0  # 其中最小获胜联盟数
    rows: list[CoalitionMatrixRow] = []
    inclusion: list[CoalitionInclusion] = []


class CoalitionResult(BaseModel):
    has_majority: bool
    majority_party: Optional[str]
    majority_party_name: Optional[str]
    coalition_options: list[CoalitionOption]
    recommended_coalition: Optional[CoalitionOption]
    majority_type: Optional[str] = None
    power_indices: list[PartyPowerIndex] = []  # Banzhaf / Shapley-Shubik 权力指数
    coalition_matrix: Optional[CoalitionMatrix] = None  # 全部过半联盟枚举


class SimulationResponse(BaseModel):
    result_a: ElectionResult
    result_b: ElectionResult
    coalition_a: CoalitionResult
    coalition_b: CoalitionResult


class RobustnessPartyRow(BaseModel):
    party_id: str
    party_name: str
    color: str = "#888"
    min_seats: int = 0
    max_seats: int = 0
    median_seats: float = 0.0
    avg_seats: float = 0.0
    win_count: int = 0
    majority_count: int = 0
    ci_low: float = 0.0  # 95% 置信区间下限（2.5 百分位）
    ci_high: float = 0.0  # 95% 置信区间上限（97.5 百分位）


class RobustnessChangePoint(BaseModel):
    iteration: int
    party_id: str
    seats: int


class CityUncertainty(BaseModel):
    """城市级稳健性：模态胜者及其胜率（蒙特卡洛跨迭代）"""
    city_id: str
    city_name: str
    winner_party_id: str = ""
    winner_party_name: str = ""
    win_rate: float = 0.0  # 模态胜者获胜频率 0-1
    seat_low: float = 0.0
    seat_high: float = 0.0
    iter_count: int = 0


class ProvinceUncertainty(BaseModel):
    """省级稳健性：模态胜者及其胜率（蒙特卡洛跨迭代）"""
    province_name: str
    winner_party_id: str = ""
    winner_party_name: str = ""
    win_rate: float = 0.0
    seat_low: float = 0.0
    seat_high: float = 0.0
    iter_count: int = 0


class RobustnessSummary(BaseModel):
    iterations: int
    majority_rate: float = 0.0  # 任一政党过半的概率
    avg_effective_parties_seats: float = 0.0
    avg_gallagher: float = 0.0
    avg_largest_party_seats: float = 0.0


class RobustnessResponse(BaseModel):
    summary: RobustnessSummary
    party_rows: list[RobustnessPartyRow]
    series: list[RobustnessChangePoint]
    province_uncertainty: list[ProvinceUncertainty] = []
    city_uncertainty: list[CityUncertainty] = []


class MetricSnapshot(BaseModel):
    gallagher: float = 0.0
    effective_parties_seats: float = 0.0
    majority_rate: float = 0.0
    largest_party_seats: float = 0.0


class SensitivityPoint(BaseModel):
    param: str
    base_value: float = 0.0
    low: MetricSnapshot
    baseline: MetricSnapshot
    high: MetricSnapshot


class SensitivityResponse(BaseModel):
    points: list[SensitivityPoint]


class DimensionExplain(BaseModel):
    """选民模型：单一政策维度解释"""
    key: str
    label: str
    description: str
    value: float = 0.0  # 城市在此维度的位置


class PartyAffinityExplain(BaseModel):
    """选民模型：某政党在该城市的亲和度分解"""
    party_id: str
    party_name: str
    color: str
    economic: float = 0.0   # 经济匹配 (权重25%)
    social: float = 0.0     # 社会匹配 (权重15%)
    regional: float = 0.0   # 区域匹配 (权重15%)
    welfare: float = 0.0    # 福利匹配 (权重10%)
    environment: float = 0.0  # 环保匹配 (权重10%)
    nationalism: float = 0.0  # 民族匹配 (权重15%)
    urban_rural: float = 0.0  # 城乡匹配 (权重10%)
    weighted_affinity: float = 0.0  # 加权原始亲和度
    noise: float = 0.0      # 随机扰动
    affinity: float = 0.0   # 最终亲和度（含噪声）
    vote_share: float = 0.0  # 归一化得票率
    distance: float = 0.0   # 7维欧氏距离


class VoterExplainResponse(BaseModel):
    city_id: str
    city_name: str
    province: str
    turnout: float = 0.0
    ethnic_share: float = 0.0
    weights: dict[str, float] = {}  # {'economic': 0.3, ...}
    city_position: list[DimensionExplain] = []
    parties: list[PartyAffinityExplain] = []


class PollPoint(BaseModel):
    week: int
    party_id: str
    share: float = 0.0  # 该周民调支持率 0-1


class PollEvent(BaseModel):
    week: int
    label: str
    description: str = ""
    party_id: str = ""
    direction: float = 0.0  # 支持率冲击方向（正/负）


class PollForecast(BaseModel):
    party_id: str
    party_name: str
    color: str = "#888"
    poll_share: float = 0.0       # 最终一周民调
    seat_projection: int = 0      # 按最终民调换算的席位预测
    win_prob: float = 0.0         # 蒙特卡洛预测胜率（最大党）
    majority_prob: float = 0.0    # 过半概率


class PollResponse(BaseModel):
    weeks: int = 12
    final_share: dict[str, float] = {}     # 实际选举得票率（基准）
    series: list[PollPoint] = []           # 各周民调曲线
    events: list[PollEvent] = []           # 舆论事件
    forecasts: list[PollForecast] = []     # 选前预测
    iterations: int = 80                   # 蒙特卡洛迭代次数（按制度自适应）
    note: str = ""


class SwingDistrict(BaseModel):
    city_id: str
    city_name: str
    province: str = ""
    winner_party_id: str = ""
    winner_party_name: str = ""
    runnerup_party_id: str = ""
    runnerup_party_name: str = ""
    margin: float = 0.0          # 前两名胜差
    seats: int = 0
    swing_level: str = "safe"    # safe / lean / tossup
    bellwether: bool = False     # 风向标：与全国最大党一致且接近全国均值
    bellwether_score: float = 0.0


class SwingAnalysisResponse(BaseModel):
    total_seats: int = 0
    tossup_count: int = 0
    lean_count: int = 0
    safe_count: int = 0
    bellwether_count: int = 0
    national_leader: str = ""       # 全国最大党 id
    national_leader_name: str = ""
    districts: list[SwingDistrict] = []


class CalibrationPartyRow(BaseModel):
    party_id: str
    party_name: str
    color: str = "#888"
    prev_seats: int = 0
    cur_seats: int = 0
    delta: int = 0
    prev_vote: float = 0.0
    cur_vote: float = 0.0
    vote_delta: float = 0.0


class CalibrationCityRow(BaseModel):
    city_id: str
    city_name: str
    province: str = ""
    prev_winner: str = ""
    cur_winner: str = ""
    flipped: bool = False
    margin: float = 0.0           # 本届胜差


class FlowCell(BaseModel):
    """选票流转移单元：上届赢家 party_id → 本届赢家 party_id 的翻盘城市数"""
    prev_party_id: str
    prev_party_name: str
    cur_party_id: str
    cur_party_name: str
    count: int = 0


class CalibrationResponse(BaseModel):
    baseline_year: int = 0
    current_year: int = 0
    flipped_cities: int = 0
    total_cities: int = 0
    stability_index: float = 0.0  # 连任城市占比（0-1）
    seat_volatility: float = 0.0  # 席位变动总量（Σ|Δ|/总席位数）
    national_leader_prev: str = ""
    national_leader_prev_name: str = ""
    national_leader_cur: str = ""
    national_leader_cur_name: str = ""
    gov_changed: bool = False     # 第一大党是否易主
    parties: list[CalibrationPartyRow] = []
    cities: list[CalibrationCityRow] = []
    flow_matrix: list[FlowCell] = []  # 选区赢家转移矩阵（上届赢家→本届赢家）


# ========== 政府任期/寿命模拟 ==========


class TermEvent(BaseModel):
    month: int  # 0-120
    month_label: str
    type: str  # policy_pass / policy_fail / scandal / economic_shock / no_confidence / survived
    title: str
    description: str = ""


class TermMonthSnapshot(BaseModel):
    month: int
    survival_prob: float  # 存活到该月（含）的累计概率
    hazard: float  # 该月倒阁瞬时概率
    approvals: float = 0.0  # 该月民众支持率（50 基线 ± 波动）


class GovernmentTermResult(BaseModel):
    ruling_parties: list[str] = []
    ruling_party_names: list[str] = []
    term_months: int = 0  # 法定最长任期（默认 60 个月，5 年）
    expected_months: float = 0.0  # 预期存活月数
    survival_prob_full_term: float = 0.0  # 走完全程概率
    survival_curve: list[TermMonthSnapshot] = []
    events: list[TermEvent] = []  # 代表性事件时间线
    base_stability: float = 0.0  # 联盟内在稳定性 0-1
    seat_margin: int = 0  # 超过多数门槛的冗余席位
    policy_pass_rate: float = 0.0  # 平均政策通过率
    passed_bills: int = 0
    total_bills: int = 0
    expected_passed_bills: float = 0.0
    no_confidence_risk: float = 0.0  # 任期内倒阁累计概率
    reason_breakdown: dict[str, float] = {}  # 各倒阁原因占比
    single_party: bool = False  # 单党绝对多数执政
    confidence_vote: float = 0.0  # 就职信任投票通过率


# ========== 制度全景对比 ==========


class SystemComparisonRow(BaseModel):
    """单制度在统一选情配置下的结果摘要"""
    system_type: str
    top_party: str = ""          # 第一大党名
    top_seats: int = 0
    top_vote: float = 0.0
    total_seats: int = 0
    gallagher: float = 0.0       # 比例性（越低越成比例）
    eff_parties_vote: float = 0.0
    eff_parties_seats: float = 0.0
    effective_threshold: float = 0.0  # 首党席位过半所需票%（近似）
    majority_possible: bool = False   # 是否存在过半政党
    overhang: int = 0
    polarization: float = 0.0
    classification: str = ""     # Sartori 格局类型


class SystemComparisonResponse(BaseModel):
    year: int = 0
    systems: list[SystemComparisonRow] = []
