"""
研究年代库：从建国至今的重大变动年代。

每个年代定义：
- city: 城市数据相对 2020 基准的调整（GDP/人口/城市化/老龄化/教育/产业结构）
- config: 该年代选民政见的默认影响（dim_tilt / 投票率 / 噪声 / 门槛 等）
- param_diffs: 供前端展示的参数差异说明

基准说明：CHINA_CITIES_RAW 约代表 2020 年水平；「当前基准」年代（2024）
沿用旧版线性折算，保证与既有行为连续。
"""

ERA_LIBRARY = [
    {
        "year": 1949,
        "name": "建国与计划经济",
        "period": "1949–1956",
        "summary": "百废待兴，计划经济体制确立，农业社会主导。",
        "description": (
            "新中国成立初期，实行生产资料公有化与统购统销的计划经济。"
            "城市化率极低，绝大多数人口从事农业生产，受教育程度整体偏低，"
            "人口结构年轻。政治动员强、民族独立热情高涨，国家强力干预经济。"
        ),
        "city": {
            "gdp_factor": 0.06,
            "population_factor": 0.42,
            "urbanization_delta": -0.55,
            "aging_delta": -0.05,
            "education_delta": -0.35,
            "primary_shift": 0.25,
            "tertiary_shift": -0.15,
        },
        "config": {
            "turnout_shift": 0.10,
            "noise_amplitude": 0.04,
            "dim_tilt": {"economic": -0.5, "welfare": 0.4, "nationalism": 0.3, "social": -0.2, "urban_rural": -0.4},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 6%（百废待兴）",
            "总人口约为当前基准的 42%",
            "城市化率约低 55 个百分点（约 25%）",
            "老龄化率更低（年轻型人口结构）",
            "平均受教育程度大幅偏低",
            "第一产业占比显著更高（农业社会）",
            "高度国家干预：经济维度 -0.5",
            "福利/再分配诉求强烈：+0.4",
            "民族主义高涨：+0.3，投票动员 +10%",
        ],
    },
    {
        "year": 1966,
        "name": "文革动荡",
        "period": "1966–1976",
        "summary": "社会高度政治化，经济停滞，秩序冲击严重。",
        "description": (
            "十年动乱期间，正常经济与社会秩序受到冲击，计划生产停滞。"
            "社会不确定性极高、选民行为不可预测，国家干预与政治动员同时强化，"
            "对外安全与统一议题压倒经济议题。"
        ),
        "city": {
            "gdp_factor": 0.10,
            "population_factor": 0.55,
            "urbanization_delta": -0.30,
            "aging_delta": -0.04,
            "education_delta": -0.20,
            "primary_shift": 0.10,
            "tertiary_shift": -0.10,
        },
        "config": {
            "turnout_shift": 0.15,
            "noise_amplitude": 0.10,
            "dim_tilt": {"social": -0.4, "nationalism": 0.5, "economic": -0.3, "urban_rural": -0.2},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 10%（经济停滞）",
            "城市化率约低 30 个百分点",
            "受教育程度明显偏低",
            "社会不确定性极高：噪声 0.10（最高）",
            "强力政治动员：投票率 +15%",
            "民族/安全议题压倒一切：民族主义 +0.5",
            "国家干预强化：经济维度 -0.3",
        ],
    },
    {
        "year": 1978,
        "name": "改革开放元年",
        "period": "1978–1991",
        "summary": "农村改革先行，市场机制开始萌芽，沿海逐步开放。",
        "description": (
            "十一届三中全会开启改革开放。家庭联产承包、经济特区相继落地，"
            "市场机制开始替代计划指令。城市化仍低，但教育逐步恢复，"
            "对外开放与地方积极性上升，民众对改革的期待较高。"
        ),
        "city": {
            "gdp_factor": 0.18,
            "population_factor": 0.68,
            "urbanization_delta": -0.20,
            "aging_delta": -0.03,
            "education_delta": -0.15,
            "primary_shift": 0.05,
            "tertiary_shift": -0.08,
        },
        "config": {
            "turnout_shift": 0.03,
            "noise_amplitude": 0.05,
            "dim_tilt": {"economic": 0.2, "regional": 0.2, "nationalism": 0.1},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 18%",
            "城市化率约低 20 个百分点",
            "受教育程度仍偏低（教育恢复初期）",
            "市场取向初启：经济维度 +0.2",
            "区域/地方自主性上升：+0.2",
            "民族主义温和上升：+0.1",
        ],
    },
    {
        "year": 1992,
        "name": "南方谈话·市场经济",
        "period": "1992–2000",
        "summary": "社会主义市场经济确立，沿海开放与外资涌入，工业化加速。",
        "description": (
            "邓小平南方谈话后，社会主义市场经济体制正式确立。国企改制、"
            "外资大量进入沿海，工业化与城市化双双提速，教育改善。"
            "民众对市场与效率的认同上升，地区差距开始拉大。"
        ),
        "city": {
            "gdp_factor": 0.35,
            "population_factor": 0.78,
            "urbanization_delta": -0.10,
            "aging_delta": -0.02,
            "education_delta": -0.08,
            "primary_shift": -0.05,
            "tertiary_shift": -0.06,
        },
        "config": {
            "turnout_shift": 0.02,
            "noise_amplitude": 0.04,
            "dim_tilt": {"economic": 0.4, "regional": 0.3, "environment": -0.1, "nationalism": 0.1},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 35%",
            "城市化率约低 10 个百分点，工业化加速",
            "市场经济取向显著：经济维度 +0.4",
            "沿海/区域开放红利：区域维度 +0.3",
            "环保议题边缘化：-0.1",
        ],
    },
    {
        "year": 2001,
        "name": "加入WTO·全球化",
        "period": "2001–2007",
        "summary": "全面融入全球市场，出口与制造业扩张，沿海-内陆差距扩大。",
        "description": (
            "中国加入世界贸易组织，深度融入全球分工。出口与制造业高速扩张，"
            "城市化与教育继续提升，市场与效率观念主流化。沿海地区显著受益，"
            "区域差距扩大，环境代价开始累积。"
        ),
        "city": {
            "gdp_factor": 0.55,
            "population_factor": 0.88,
            "urbanization_delta": -0.02,
            "aging_delta": 0.0,
            "education_delta": -0.03,
            "primary_shift": -0.08,
            "tertiary_shift": -0.02,
        },
        "config": {
            "turnout_shift": 0.0,
            "noise_amplitude": 0.03,
            "dim_tilt": {"economic": 0.5, "regional": 0.3, "nationalism": -0.1},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 55%",
            "城市化接近当前水平，工业化成熟",
            "市场/效率取向主流：经济维度 +0.5",
            "沿海-内陆差距扩大：区域维度 +0.3",
            "国际主义上升：民族主义 -0.1",
        ],
    },
    {
        "year": 2008,
        "name": "金融危机·四万亿",
        "period": "2008–2012",
        "summary": "全球金融危机冲击，大规模基建刺激，福利与稳定议题上升。",
        "description": (
            "全球金融危机冲击出口导向，中央政府推出四万亿基建刺激。"
            "城市化快速推进、老龄化开始显现，社会保障与分配公平成为焦点，"
            "民众对市场信心受挫、对稳定与福利诉求上升。"
        ),
        "city": {
            "gdp_factor": 0.78,
            "population_factor": 0.95,
            "urbanization_delta": 0.02,
            "aging_delta": 0.02,
            "education_delta": 0.0,
            "primary_shift": -0.10,
            "tertiary_shift": -0.01,
        },
        "config": {
            "turnout_shift": -0.02,
            "noise_amplitude": 0.06,
            "dim_tilt": {"welfare": 0.3, "economic": -0.2, "nationalism": 0.2},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 78%",
            "城市化快速推进，老龄化初现（+0.02）",
            "福利/分配公平诉求上升：+0.3",
            "对市场信心受挫：经济维度 -0.2",
            "民族/稳定议题上升：+0.2，不确定性 +0.06",
        ],
    },
    {
        "year": 2013,
        "name": "新常态·反腐",
        "period": "2013–2019",
        "summary": "增速换挡进入新常态，反腐深化，环保与治理议题凸显。",
        "description": (
            "经济增速换挡进入「新常态」，供给侧结构性改革推进。"
            "反腐与作风建设改变政治生态，环保、治理、公平议题上升。"
            "老龄化加深、城市中产壮大，公众对质量与制度的期待提高。"
        ),
        "city": {
            "gdp_factor": 0.88,
            "population_factor": 0.98,
            "urbanization_delta": 0.05,
            "aging_delta": 0.03,
            "education_delta": 0.02,
            "primary_shift": -0.12,
            "tertiary_shift": 0.01,
        },
        "config": {
            "turnout_shift": -0.01,
            "noise_amplitude": 0.05,
            "dim_tilt": {"social": 0.2, "welfare": 0.2, "nationalism": 0.2, "environment": 0.1},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 88%",
            "老龄化加深（+0.03），城市中产壮大",
            "社会/治理议题上升：社会维度 +0.2",
            "环保议题凸显：+0.1",
            "福利诉求持续：+0.2，民族主义 +0.2",
        ],
    },
    {
        "year": 2020,
        "name": "新冠疫情·百年变局",
        "period": "2020–2022",
        "summary": "疫情冲击经济与社会，公共卫生与数字治理成为核心议题。",
        "description": (
            "新冠疫情冲击全球供应链与国内经济，公共卫生、社会保障、"
            "数字治理成为压倒性议题。社会不确定性升高，民众对国家动员"
            "与统筹能力的依赖增强，数字化加速改变生活与参与方式。"
        ),
        "city": {
            "gdp_factor": 0.95,
            "population_factor": 1.0,
            "urbanization_delta": 0.08,
            "aging_delta": 0.04,
            "education_delta": 0.03,
            "primary_shift": -0.13,
            "tertiary_shift": 0.03,
        },
        "config": {
            "turnout_shift": 0.05,
            "noise_amplitude": 0.07,
            "dim_tilt": {"welfare": 0.4, "nationalism": 0.3, "social": 0.1, "economic": -0.1},
        },
        "param_diffs": [
            "人均 GDP 约为当前基准的 95%（疫情冲击）",
            "老龄化加深（+0.04），数字化加速",
            "公共卫生/社保成为核心：福利维度 +0.4",
            "民族主义高涨：+0.3",
            "不确定性升高：噪声 0.07，投票动员 +5%",
        ],
    },
    {
        "year": 2024,
        "name": "高质量发展·当前基准",
        "period": "2024–",
        "summary": "当前基准年代，高质量发展、绿色转型与老龄化社会。",
        "description": (
            "作为研究基准的当前年代：经济转向高质量发展，绿色低碳、科技创新、"
            "共同富裕成为主线。深度老龄化与少子化并存，数字社会成熟，"
            "选民偏好多元而稳定。此年代为旧版线性折算的延续（基准参数）。"
        ),
        "city": {
            "gdp_factor": 1.04,
            "population_factor": 1.004,
            "urbanization_delta": 0.10,
            "aging_delta": 0.05,
            "education_delta": 0.04,
            "primary_shift": -0.15,
            "tertiary_shift": 0.04,
        },
        "config": {
            "turnout_shift": 0.0,
            "noise_amplitude": 0.03,
            "dim_tilt": {},
        },
        "param_diffs": [
            "人均 GDP 为当前基准 100%（基准参考）",
            "深度老龄化（+0.05），高质量城镇化",
            "绿色低碳、共同富裕主线",
            "选民偏好多元稳定：噪声 0.03",
            "无额外政见偏移（dim_tilt 空）",
        ],
    },
]


def get_era(year: int):
    """返回指定年份的年代预设；未收录年份返回 None"""
    for era in ERA_LIBRARY:
        if era["year"] == year:
            return era
    return None


def apply_era_city(city, era: dict):
    """按年代预设调整单个城市的基础数据（相对 2020 基准）"""
    c = era["city"]
    import copy

    adj = copy.copy(city)
    adj.gdp_per_capita = adj.gdp_per_capita * c["gdp_factor"]
    adj.population = int(adj.population * c["population_factor"])
    adj.urbanization_rate = max(0.05, min(1.0, adj.urbanization_rate + c["urbanization_delta"]))
    adj.aging_rate = max(0.02, min(0.6, adj.aging_rate + c["aging_delta"]))
    adj.education_index = max(0.1, min(1.0, adj.education_index + c["education_delta"]))
    primary = max(0.0, adj.primary_industry_pct + c["primary_shift"])
    tertiary = max(0.0, adj.tertiary_industry_pct + c["tertiary_shift"])
    secondary = max(0.0, 1.0 - primary - tertiary)
    total = primary + secondary + tertiary
    adj.primary_industry_pct = primary / total
    adj.secondary_industry_pct = secondary / total
    adj.tertiary_industry_pct = tertiary / total
    return adj
