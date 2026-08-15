from pydantic import BaseModel
from typing import Optional


class City(BaseModel):
    id: str
    name: str
    name_en: str
    province: str  # actual province name e.g. "广东省"
    population: int
    gdp_per_capita: float
    urbanization_rate: float
    aging_rate: float
    education_index: float
    primary_industry_pct: float
    secondary_industry_pct: float
    tertiary_industry_pct: float
    region_type: str  # "coastal", "inland", "western", "northeast"
    ethnic_share: float = 0.0  # 少数民族人口占比（0-1），民族党的真实选区基础


class CityData(BaseModel):
    year: int
    cities: list[City]
    total_population: int
