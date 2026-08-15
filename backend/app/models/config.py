from pydantic import BaseModel, Field
from typing import Optional
from .party import Party


class ElectoralConfig(BaseModel):
    system_type: str = Field(..., description="FPTP, PR, or RUNOFF")
    total_seats: int = Field(default=450, ge=50, le=2000)
    threshold: float = Field(default=0.0, ge=0.0, le=0.2, description="Vote share threshold for PR")
    allocation_method: str = Field(default="d_hondt", description="d_hondt, sainte_lague or largest_remainder")
    mixed_ratio: float = Field(default=0.4, ge=0.1, le=0.9, description="MMP/并行制中名单比例代表席位占比")
    noise_amplitude: float = Field(default=0.03, ge=0.0, le=0.12, description="选民行为随机噪声幅度 (std)；过高会淹没城市间结构性差异")
    voter_samples: int = Field(default=80, ge=10, le=500, description="排名票制度每市虚拟选民抽样数")
    turnout_shift: float = Field(default=0.0, ge=-0.3, le=0.3, description="全局投票率偏移（危机/动员等情景）")
    dim_tilt: dict[str, float] = Field(default_factory=dict, description="全国选民政策维度偏好偏移（剧本用）")
    min_seats_per_city: int = Field(default=1, ge=0, le=10, description="Guaranteed minimum seats per city")
    district_magnitude: int = Field(default=1, ge=1, le=20, description="Seats per district for FPTP")
    name: str = "方案 A"
    urban_rural_weight: float = Field(default=1.0, ge=0.0, le=2.0, description="城乡投票率差异权重")
    runoff_enabled: bool = False
    runoff_threshold: float = Field(default=0.5, ge=0.3, le=0.6, description="Runoff threshold")
    upper_house_enabled: bool = False
    upper_house_seats: int = Field(default=96, ge=32, le=500)
    upper_house_method: str = Field(default="equal", description="equal, proportional, or mixed")
    upper_house_mixed_ratio: float = Field(default=0.5, ge=0.0, le=1.0)

    # ===== 真实感增强参数（默认关闭，保持向后兼容）=====
    voter_stratification: bool = Field(default=False, description="城市内选民多中心分层（年龄/收入/教育）")
    party_loyalty: float = Field(default=0.0, ge=0.0, le=0.5, description="政党认同/惯性投票比例（铁票党）")
    swing_voter_pct: float = Field(default=0.0, ge=0.0, le=0.6, description="摇摆选民比例（对短期因素更敏感）")
    abstention_sensitivity: float = Field(default=0.0, ge=0.0, le=1.0, description="竞争程度对投票率的调节强度（激烈选区投票率更高）")
    malapportionment: float = Field(default=0.0, ge=0.0, le=1.0, description="选区人口不均衡度（小城市/农村超代表）")
    party_effects: dict[str, float] = Field(default_factory=dict, description="政党特定亲和度扰动（丑闻/领袖魅力等事件，party_id->delta）")
    calibration: bool = Field(default=False, description="启用历史倾向锚点校准（每城基准政党）")
    tactical_voting: float = Field(default=0.4, ge=0.0, le=1.0, description="策略性投票/弃保比例：小选区制下弱势候选人支持者转投可赢政党（Duverger 效应），多数制默认启用")
    turnout_differential: float = Field(default=0.0, ge=0.0, le=1.0, description="群体差异化投票率：老年/高学历/高收入/城市选民投票率显著更高，城市投票率按人口结构加权（0=关闭，1=完全差异化）")
    affinity_power: float = Field(default=6.0, ge=1.0, le=8.0, description="得票率浓缩指数：对亲和度做幂次变换后归一化，放大政党间差距（1=线性均匀，6≈中国式高动员分化，首党约25%，越高越两极）")
    party_system_concentration: float = Field(default=0.0, ge=0.0, le=0.5, description="政党体系集中度：全国领先党（第一党+b、第二党+b/2）获声望加成，模拟主导党/两强对峙格局（0=关闭）")
    poll_systematic_bias: float = Field(default=0.0, ge=0.0, le=0.08, description="民调系统偏差：民调对实际结果的结构性抽样偏差（1=±8pp 随机偏差，模拟现实中民调经常失准）")


class SimulationRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config_a: ElectoralConfig
    config_b: ElectoralConfig
    parties: list[Party]


class RobustnessRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]
    iterations: int = Field(default=30, ge=5, le=200)


class SensitivityRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]
    delta: float = Field(default=0.2, ge=0.05, le=1.0, description="单因素扰动幅度（相对±delta）")
    iterations: int = Field(default=5, ge=1, le=30, description="每情形模拟次数（用于过半率）")
    params: list[str] = Field(default=["threshold", "mixed_ratio", "noise_amplitude"])


class VoterExplainRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    city_id: str
    config: ElectoralConfig
    parties: list[Party]


class VoterStructureRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    scope: str = Field(default="全国", description="'全国' 或省份名")
    config: ElectoralConfig
    parties: list[Party]


class PollRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]
    weeks: int = Field(default=12, ge=4, le=30)
    volatility: float = Field(default=0.04, ge=0.0, le=0.2, description="民调随机波动幅度")


class SwingAnalysisRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]


class CalibrationRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]
    baseline_year: int = Field(default=0, ge=0, le=2024, description="0 = 自动取 year-4（上一届）")


class GovernmentRequest(BaseModel):
    year: int = Field(default=2023, ge=1949, le=2024)
    config: ElectoralConfig
    parties: list[Party]
    ruling_parties: list[str] = Field(default_factory=list, description="指定执政联盟（空 = 自动推荐）")
    term_months: int = Field(default=60, ge=24, le=120, description="法定最长任期（月）")
