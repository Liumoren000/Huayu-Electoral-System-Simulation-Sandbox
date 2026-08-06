import json
import urllib.request
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.models.config import SimulationRequest
from app.models.result import SimulationResponse
from app.engine import DataLoader, generate_default_parties, ElectoralEngine, CoalitionEngine

router = APIRouter()
data_loader = DataLoader()

GEO_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'


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
