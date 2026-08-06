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


class CityData(BaseModel):
    year: int
    cities: list[City]
    total_population: int
