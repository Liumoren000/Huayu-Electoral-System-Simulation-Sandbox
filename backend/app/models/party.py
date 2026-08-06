from pydantic import BaseModel


class Party(BaseModel):
    id: str
    name: str
    color: str
    economic_position: float  # -1.0 (left/progressive) to 1.0 (right/free-market)
    social_position: float    # -1.0 (liberal) to 1.0 (conservative)
    regional_position: float  # -1.0 (coastal/urban) to 1.0 (inland/rural)
    description: str = ""
