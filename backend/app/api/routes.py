import json
import statistics
import urllib.request
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.models.config import SimulationRequest, RobustnessRequest, SensitivityRequest
from app.models.result import (
    SimulationResponse,
    RobustnessResponse,
    RobustnessSummary,
    RobustnessPartyRow,
    RobustnessChangePoint,
    SensitivityPoint,
    SensitivityResponse,
    MetricSnapshot,
)
from app.engine import DataLoader, generate_default_parties, ElectoralEngine, CoalitionEngine

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
    )


PARAM_RANGES = {
    "threshold": (0.0, 0.2),
    "mixed_ratio": (0.1, 0.9),
    "noise_amplitude": (0.0, 0.3),
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
