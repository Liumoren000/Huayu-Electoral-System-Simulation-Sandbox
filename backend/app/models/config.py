from pydantic import BaseModel, Field
from typing import Optional
from .party import Party


class ElectoralConfig(BaseModel):
    system_type: str = Field(..., description="FPTP or PR")
    total_seats: int = Field(default=450, ge=50, le=2000)
    threshold: float = Field(default=0.0, ge=0.0, le=0.2, description="Vote share threshold for PR")
    allocation_method: str = Field(default="d_hondt", description="d_hondt or sainte_lague")
    district_magnitude: int = Field(default=1, ge=1, le=20, description="Seats per district for FPTP")
    name: str = "方案 A"


class SimulationRequest(BaseModel):
    year: int = Field(default=2023, ge=2010, le=2024)
    config_a: ElectoralConfig
    config_b: ElectoralConfig
    parties: list[Party]
