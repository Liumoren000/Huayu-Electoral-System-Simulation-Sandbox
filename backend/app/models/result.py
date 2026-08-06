from pydantic import BaseModel
from typing import Optional


class CityResult(BaseModel):
    city_id: str
    city_name: str
    winner_party_id: str
    winner_party_name: str
    vote_shares: dict[str, float]  # party_id -> vote share
    turnout: float
    seats: int = 0


class PartySeatResult(BaseModel):
    party_id: str
    party_name: str
    seats: int
    vote_share: float
    color: str


class ProvinceResult(BaseModel):
    province_name: str
    winner_party_id: str
    winner_party_name: str
    vote_shares: dict[str, float]
    num_cities: int
    population: int
    seats: int


class ElectionResult(BaseModel):
    config_name: str
    system_type: str
    total_seats: int
    city_results: list[CityResult]
    province_results: list[ProvinceResult]
    party_results: list[PartySeatResult]
    total_votes: int


class CoalitionOption(BaseModel):
    parties: list[str]
    party_names: list[str]
    total_seats: int
    ideological_distance: float
    is_majority: bool


class CoalitionResult(BaseModel):
    has_majority: bool
    majority_party: Optional[str]
    majority_party_name: Optional[str]
    coalition_options: list[CoalitionOption]
    recommended_coalition: Optional[CoalitionOption]


class SimulationResponse(BaseModel):
    result_a: ElectionResult
    result_b: ElectionResult
    coalition_a: CoalitionResult
    coalition_b: CoalitionResult
