import json
import statistics
import urllib.request
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.models.config import (
    SimulationRequest, RobustnessRequest, SensitivityRequest, VoterExplainRequest,
    VoterStructureRequest, PollRequest, SwingAnalysisRequest, CalibrationRequest,
    GovernmentRequest,
)
from app.models.result import (
    SimulationResponse,
    RobustnessResponse,
    RobustnessSummary,
    RobustnessPartyRow,
    RobustnessChangePoint,
    SensitivityPoint,
    SensitivityResponse,
    MetricSnapshot,
    CityUncertainty,
    ProvinceUncertainty,
    DimensionExplain,
    PartyAffinityExplain,
    VoterExplainResponse,
    PollResponse,
    SwingAnalysisResponse,
    CalibrationResponse,
)
from app.engine import DataLoader, generate_default_parties, ElectoralEngine, CoalitionEngine
from app.engine.voter_model import VoterModel
from app.engine.poll_engine import PollEngine, swing_analysis
from app.engine.calibration_engine import historical_calibration
from app.engine.government_engine import GovernmentEngine

router = APIRouter()
data_loader = DataLoader()

GEO_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'


def _percentile95(values: list) -> tuple[float, float]:
    """线性插值法计算 95% 置信区间（2.5 / 97.5 百分位）"""
    n = len(values)
    if n == 0:
        return 0.0, 0.0
    if n == 1:
        return float(values[0]), float(values[0])
    s = sorted(values)
    def pct(p: float) -> float:
        pos = p * (n - 1)
        lo = int(pos)
        hi = min(lo + 1, n - 1)
        frac = pos - lo
        return s[lo] * (1 - frac) + s[hi] * frac
    return round(pct(0.025), 1), round(pct(0.975), 1)


@router.get("/geojson/{adcode}")
def get_city_geojson(adcode: str):
    try:
        url = f'https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json'
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = resp.read()
        return JSONResponse(content=json.loads(data))
    except Exception as e:
        return {"error": str(e)}


@router.get("/geojson")
def get_geojson():
    try:
        with urllib.request.urlopen(GEO_URL, timeout=10) as resp:
            data = resp.read()
        return JSONResponse(content=json.loads(data))
    except Exception as e:
        return {"error": str(e)}


@router.get("/parties")
def get_default_parties():
    parties = generate_default_parties()
    return {"parties": [p.model_dump() for p in parties]}


@router.get("/eras")
def get_eras():
    """研究年代库：建国至今的重大变动年代及其参数差异说明"""
    from app.engine.eras import ERA_LIBRARY

    return {"eras": ERA_LIBRARY}


@router.get("/cities")
def get_cities(year: int = 2023):
    city_data = data_loader.get_city_data(year)
    return {
        "year": city_data.year,
        "total_population": city_data.total_population,
        "cities": [c.model_dump() for c in city_data.cities],
    }


@router.post("/simulate")
def simulate(request: SimulationRequest):
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})
    city_data = data_loader.get_city_data(request.year)

    engine_a = ElectoralEngine(city_data, request.parties, request.config_a)
    result_a = engine_a.run()

    engine_b = ElectoralEngine(city_data, request.parties, request.config_b)
    result_b = engine_b.run()

    coalition_engine = CoalitionEngine(request.parties)
    coalition_a = coalition_engine.find_coalitions(result_a)
    coalition_b = coalition_engine.find_coalitions(result_b)

    return SimulationResponse(
        result_a=result_a,
        result_b=result_b,
        coalition_a=coalition_a,
        coalition_b=coalition_b,
    )


@router.post("/simulate/government")
def simulate_government(request: GovernmentRequest):
    """政府任期/寿命模拟：给定方案与执政联盟，模拟任期存活、政策绩效与倒阁风险"""
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})
    city_data = data_loader.get_city_data(request.year)
    engine = ElectoralEngine(city_data, request.parties, request.config, seed=42)
    result = engine.run()
    gov = GovernmentEngine(request.parties, seed=7)
    return gov.run(result, ruling_parties=request.ruling_parties,
                   term_months=request.term_months)


@router.post("/simulate/robustness")
def simulate_robustness(request: RobustnessRequest):
    """
    蒙特卡洛稳健性分析：以不同随机种子运行多次选举，
    统计各政党席位区间、胜率与过半概率。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})

    city_data = data_loader.get_city_data(request.year)
    n = request.iterations

    seats_hist = {p.id: [] for p in request.parties}
    win_count = {p.id: 0 for p in request.parties}
    majority_count = {p.id: 0 for p in request.parties}
    majority_total = 0
    effs, gallaghers, largest_seats = [], [], []
    series = []

    prov_win = {}  # province_name -> {party_id: count}
    prov_seats = {}  # province_name -> {party_id: [seats]}
    city_win = {}  # city_id -> {party_id: count}
    city_seats = {}  # city_id -> {party_id: [seats]}

    total = request.config.total_seats

    for i in range(n):
        engine = ElectoralEngine(city_data, request.parties, request.config, seed=1000 + i)
        result = engine.run()
        for pr in result.party_results:
            seats_hist[pr.party_id].append(pr.seats)
            if pr.seats == max(r.seats for r in result.party_results) and pr.seats > 0:
                win_count[pr.party_id] += 1
            if pr.seats > total / 2:
                majority_count[pr.party_id] += 1
            series.append(RobustnessChangePoint(iteration=i, party_id=pr.party_id, seats=pr.seats))
        if any(pr.seats > total / 2 for pr in result.party_results):
            majority_total += 1
        effs.append(result.effective_parties_seats or 0)
        gallaghers.append(result.gallagher_index or 0)
        largest_seats.append(max((pr.seats for pr in result.party_results), default=0))

        for pr in result.province_results:
            prov_win.setdefault(pr.province_name, {}).setdefault(pr.winner_party_id, 0)
            prov_win[pr.province_name][pr.winner_party_id] += 1
            prov_seats.setdefault(pr.province_name, {}).setdefault(pr.winner_party_id, []).append(pr.seats)
        for cr in result.city_results:
            city_win.setdefault(cr.city_id, {}).setdefault(cr.winner_party_id, 0)
            city_win[cr.city_id][cr.winner_party_id] += 1
            city_seats.setdefault(cr.city_id, {}).setdefault(cr.winner_party_id, []).append(cr.seats)

    party_rows = []
    for p in request.parties:
        h = seats_hist[p.id]
        ci_low, ci_high = _percentile95(h) if h else (0.0, 0.0)
        party_rows.append(RobustnessPartyRow(
            party_id=p.id,
            party_name=p.name,
            color=p.color,
            min_seats=min(h) if h else 0,
            max_seats=max(h) if h else 0,
            median_seats=round(statistics.median(h), 1) if h else 0.0,
            avg_seats=round(statistics.mean(h), 1) if h else 0.0,
            win_count=win_count[p.id],
            majority_count=majority_count[p.id],
            ci_low=ci_low,
            ci_high=ci_high,
        ))

    pname = {p.id: p.name for p in request.parties}

    def _modal_uncertainty(win: dict, seats: dict) -> tuple[str, str, float, float, float]:
        """返回 (模态胜者id, 胜率, 席位低, 席位高)"""
        if not win:
            return "", "", 0.0, 0.0, 0.0
        best = max(win.items(), key=lambda kv: kv[1])
        pid, count = best
        rate = count / n
        sh = seats.get(pid, [0.0])
        return pid, count, rate, float(min(sh)) if sh else 0.0, float(max(sh)) if sh else 0.0

    province_uncertainty = []
    for name, win in prov_win.items():
        pid, count, rate, lo, hi = _modal_uncertainty(win, prov_seats.get(name, {}))
        province_uncertainty.append(ProvinceUncertainty(
            province_name=name,
            winner_party_id=pid,
            winner_party_name=pname.get(pid, ""),
            win_rate=round(rate, 4),
            seat_low=lo,
            seat_high=hi,
            iter_count=count,
        ))

    city_id_lookup = {c.id: c.name for c in city_data.cities}
    city_uncertainty = []
    for cid, win in city_win.items():
        pid, count, rate, lo, hi = _modal_uncertainty(win, city_seats.get(cid, {}))
        city_uncertainty.append(CityUncertainty(
            city_id=cid,
            city_name=city_id_lookup.get(cid, cid),
            winner_party_id=pid,
            winner_party_name=pname.get(pid, ""),
            win_rate=round(rate, 4),
            seat_low=lo,
            seat_high=hi,
            iter_count=count,
        ))

    return RobustnessResponse(
        summary=RobustnessSummary(
            iterations=n,
            majority_rate=round(majority_total / n, 4),
            avg_effective_parties_seats=round(statistics.mean(effs), 2),
            avg_gallagher=round(statistics.mean(gallaghers), 4),
            avg_largest_party_seats=round(statistics.mean(largest_seats), 1),
        ),
        party_rows=party_rows,
        series=series,
        province_uncertainty=province_uncertainty,
        city_uncertainty=city_uncertainty,
    )


PARAM_RANGES = {
    "threshold": (0.0, 0.2),
    "mixed_ratio": (0.1, 0.9),
    "noise_amplitude": (0.0, 0.12),
    "voter_samples": (10.0, 500.0),
    "urban_rural_weight": (0.0, 2.0),
}

RANKED_SYSTEMS = {"IRV", "STV", "APPROVAL", "BORDA"}


def _with_param(cfg, param: str, value: float):
    lo, hi = PARAM_RANGES.get(param, (None, None))
    v = value
    if lo is not None:
        v = max(lo, min(hi, v))
    v = int(v) if param == "voter_samples" else v
    return cfg.model_copy(update={param: v})


def _run_metrics(city_data, parties, config, n: int) -> MetricSnapshot:
    """对给定配置跑 n 次模拟，返回平均指标快照"""
    gs, es, ls, majority = [], [], [], 0
    total = config.total_seats
    for i in range(n):
        res = ElectoralEngine(city_data, parties, config, seed=1000 + i).run()
        gs.append(res.gallagher_index or 0)
        es.append(res.effective_parties_seats or 0)
        seats = [p.seats for p in res.party_results]
        ls.append(max(seats) if seats else 0)
        if any(s > total / 2 for s in seats):
            majority += 1
    return MetricSnapshot(
        gallagher=round(sum(gs) / max(1, n), 4),
        effective_parties_seats=round(sum(es) / max(1, n), 2),
        majority_rate=round(majority / max(1, n), 4),
        largest_party_seats=round(sum(ls) / max(1, n), 1),
    )


@router.post("/simulate/sensitivity")
def simulate_sensitivity(request: SensitivityRequest):
    """
    单因素敏感性分析（tornado）：对每个参数做 ±delta 扰动，
    输出低/基准/高三种情形的指标快照，用于识别关键参数。
    """
    city_data = data_loader.get_city_data(request.year)
    n = request.iterations if request.config.system_type not in RANKED_SYSTEMS else 1
    baseline = _run_metrics(city_data, request.parties, request.config, n)

    points = []
    for param in request.params:
        base_val = getattr(request.config, param, None)
        if base_val is None:
            continue
        low = _run_metrics(city_data, request.parties,
                           _with_param(request.config, param, base_val * (1 - request.delta)), n)
        high = _run_metrics(city_data, request.parties,
                            _with_param(request.config, param, base_val * (1 + request.delta)), n)
        points.append(SensitivityPoint(param=param, base_value=round(float(base_val), 4),
                                       low=low, baseline=baseline, high=high))
    return SensitivityResponse(points=points)


DIMENSION_META = [
    ("economic", "经济", "国家干预 vs 市场自由",
     "由人均GDP（高→市场）、第二产业比重（高→干预）、第三产业比重（高→市场）、第一产业比重（高→补贴依赖）与教育水平合成"),
    ("social", "社会", "传统/集体 vs 现代/个人",
     "由城镇化率（高→现代）、教育水平（高→现代）、老龄化（高→传统）与区域文化（西部传统/沿海现代）合成"),
    ("regional", "区域", "沿海/国际化 vs 内陆/本土化",
     "由是否沿海、城镇化率与区域发展策略决定；沿海偏国际化，内陆偏本土化"),
    ("welfare", "福利", "低福利 vs 高福利/再分配",
     "由老龄化（高→高福利需求）、城镇化（高→公共服务）、第一产业比重（高→补贴依赖）与人均GDP（低→再分配）合成"),
    ("environment", "环境", "发展优先 vs 环保优先",
     "由人均GDP（高→环保意识）、第二产业比重（高→发展优先）、第三产业比重（高→环保友好）与城镇化（高→环保需求）合成"),
    ("nationalism", "民族", "国际主义 vs 民族主义/保护",
     "由沿海性（沿海→国际主义）、教育水平（高→国际主义）与人均GDP（低→保护主义）合成"),
    ("urban_rural", "城乡", "农业农村利益 vs 城市居民利益",
     "由城镇化率（高→城市利益）、第一产业比重（高→农业利益）与人口规模（大城市→城市利益）合成"),
]


@router.post("/simulate/poll")
def simulate_poll(request: PollRequest):
    """
    竞选期民调与舆论模拟：生成各周民调支持率曲线、舆论事件冲击，
    并基于当前制度给出选前席位预测与蒙特卡洛胜率/过半率。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})
    city_data = data_loader.get_city_data(request.year)
    engine = PollEngine(city_data, request.parties, request.config,
                        weeks=request.weeks, volatility=request.volatility)
    return engine.run()


@router.post("/simulate/swing")
def simulate_swing(request: SwingAnalysisRequest):
    """
    选区级摇摆/风向标分析：按胜差划分 tossup/lean/safe 选区，
    并识别与全国最大党一致、胜差接近全国均值的方向标选区（bellwether）。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})
    city_data = data_loader.get_city_data(request.year)
    return swing_analysis(city_data, request.parties, request.config)


@router.post("/simulate/calibrate")
def simulate_calibrate(request: CalibrationRequest):
    """
    历史选举校准：对比本届与上一届（默认 year-4）的席位变化、城市翻盘
    与第一大党易主，衡量模型的稳定性与波动性。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})
    city_data = data_loader.get_city_data(request.year)
    return historical_calibration(city_data, request.parties, request.config,
                                  current_year=request.year,
                                  baseline_year=request.baseline_year)


@router.post("/voter-model/explain")
def explain_voter_model(request: VoterExplainRequest):
    """
    选民行为模型透明度：返回某城市选民偏好与各政党亲和度的完整分解。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})

    city = next((c for c in data_loader.get_city_data(request.year).cities
                 if c.id == request.city_id), None)
    if city is None:
        return JSONResponse(status_code=404, content={"error": "city not found"})

    vm = VoterModel(seed=42, turnout_shift=request.config.turnout_shift,
                    dim_tilt=request.config.dim_tilt or {},
                    party_effects=request.config.party_effects or {},
                    party_loyalty=request.config.party_loyalty or 0.0,
                    swing_voter_pct=request.config.swing_voter_pct or 0.0,
                    voter_stratification=request.config.voter_stratification,
                    calibration=request.config.calibration,
                    turnout_differential=request.config.turnout_differential or 0.0,
                    affinity_power=request.config.affinity_power)
    expl = vm.explain_city(city, request.parties, request.config.noise_amplitude)

    city_position = [
        DimensionExplain(key=k, label=label, description=desc,
                         value=round(expl['city_position'].get(k, 0.0), 3))
        for k, label, _, desc in DIMENSION_META
    ]

    parties = []
    for r in expl['parties']:
        parties.append(PartyAffinityExplain(
            party_id=r['party_id'],
            party_name=r['party_name'],
            color=r['color'],
            economic=r['economic'],
            social=r['social'],
            regional=r['regional'],
            welfare=r['welfare'],
            environment=r['environment'],
            nationalism=r['nationalism'],
            urban_rural=r['urban_rural'],
            weighted_affinity=r['weighted_affinity'],
            noise=r['noise'],
            affinity=r['affinity'],
            vote_share=r['vote_share'],
            distance=r['distance'],
        ))

    return VoterExplainResponse(
        city_id=city.id,
        city_name=city.name,
        province=city.province,
        turnout=expl['turnout'],
        ethnic_share=expl.get('ethnic_share', 0.0),
        weights=expl['weights'],
        city_position=city_position,
        parties=parties,
    )


@router.post("/voter-model/structure")
def voter_structure(request: VoterStructureRequest):
    """
    选民结构构成：按年龄/教育/城乡/收入拆分全国或某省的选票构成，
    展示各人口群体投给哪些政党，解释获胜原因。
    """
    if not request.parties:
        return JSONResponse(status_code=400, content={"error": "至少需要一个参选政党"})

    city_data = data_loader.get_city_data(request.year)
    scope = request.scope.strip()
    provinces = None
    if scope and scope != "全国":
        provinces = [p.strip() for p in scope.split("、") if p.strip()]

    vm = VoterModel(seed=42, turnout_shift=request.config.turnout_shift,
                    dim_tilt=request.config.dim_tilt or {},
                    party_effects=request.config.party_effects or {},
                    party_loyalty=request.config.party_loyalty or 0.0,
                    swing_voter_pct=request.config.swing_voter_pct or 0.0,
                    voter_stratification=request.config.voter_stratification,
                    calibration=request.config.calibration,
                    )
    # 用与主推演完全一致的引擎跑一遍，拿到真实城市级得票率，
    # 保证结构分解的总体与赢家始终等于界面主表结果。
    engine = ElectoralEngine(city_data, request.parties, request.config, seed=42)
    result = engine.run()
    city_vote_shares = {cr.city_id: cr.vote_shares for cr in result.city_results}
    return vm.compute_structure(city_data, request.parties, provinces,
                                request.config.noise_amplitude or 0.0,
                                city_vote_shares, result.party_results)
