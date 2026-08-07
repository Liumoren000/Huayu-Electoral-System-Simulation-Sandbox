from pydantic import BaseModel


class Party(BaseModel):
    id: str
    name: str
    color: str
    economic_position: float = 0.0  # -1.0 (国家干预/再分配) to 1.0 (市场自由/去管制)
    social_position: float = 0.0    # -1.0 (传统/集体主义) to 1.0 (现代/个人主义)
    regional_position: float = 0.0  # -1.0 (本土化/内陆) to 1.0 (国际化/沿海)
    welfare_position: float = 0.0   # -1.0 (低福利) to 1.0 (高福利/再分配)
    environment_position: float = 0.0  # -1.0 (发展优先) to 1.0 (环保优先)
    nationalism_position: float = 0.0  # -1.0 (国际主义) to 1.0 (民族主义)
    urban_rural_position: float = 0.0  # -1.0 (农业农村利益) to 1.0 (城市居民利益)
    description: str = ""
