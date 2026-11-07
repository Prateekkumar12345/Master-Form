from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    project_name: str = "ProfeNtra API"
    environment: str = "development"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_database: str = "Profentra"
    mongodb_collection: str = "Master_Forms"
    mongodb_value_sets_collection: str = "value_sets"
    mongodb_clients_collection: str = "Clients"
    mongodb_assessments_collection: str = "Assessments"
    mongodb_diet_plans_collection: str = "Diet_Plans"
    default_actor_id: str = "507f1f77bcf86cd799439011"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
