from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SB_", env_file=".env", extra="ignore")
    environment: Literal["development", "test", "production"] = "development"
    demo_mode: bool = True
    demo_admin: bool = False
    demo_seed_on_start: bool = True
    database_url: str = "sqlite:///./var/signalbrief.db"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    auth_mode: Literal["demo", "supabase"] = "demo"
    demo_jwt_secret: str = "LOCAL-ONLY-SYNTHETIC-DATA-DO-NOT-DEPLOY-CHANGE-ME"
    supabase_url: str = ""
    supabase_service_key: str = ""
    admin_user_ids: str = ""
    storage_mode: Literal["local", "supabase"] = "local"
    storage_path: Path = Path("var/raw")
    storage_bucket: str = "signalbrief-raw"
    dart_api_key: str = ""
    sec_user_agent: str = ""
    http_timeout: float = Field(20, gt=0, le=120)
    max_download_bytes: int = Field(25_000_000, gt=0)
    max_retries: int = Field(3, ge=0, le=8)
    sec_requests_per_second: float = Field(2, gt=0, le=5)
    dart_requests_per_second: float = Field(1, gt=0, le=5)
    openai_api_key: str = ""
    openai_model: str = ""
    openai_timeout: float = Field(60, gt=0, le=180)
    openai_input_usd_per_million: float | None = Field(None, ge=0)
    openai_output_usd_per_million: float | None = Field(None, ge=0)
    ai_daily_requests: int = Field(1000, ge=1)
    max_llm_chunks: int = Field(60, ge=1, le=300)
    auto_publish_validated: bool = False
    posthog_project_key: str = ""
    posthog_host: Literal["https://us.i.posthog.com", "https://eu.i.posthog.com"] = "https://us.i.posthog.com"
    embedding_model: str = ""
    embedding_input_usd_per_million: float | None = Field(None, ge=0)
    sentry_dsn: str = ""
    api_requests_per_minute: int = Field(120, ge=1)
    worker_lease_seconds: int = Field(240, ge=60)
    worker_poll_seconds: float = Field(2, gt=0)
    log_level: str = "INFO"

    @model_validator(mode="after")
    def secure_modes(self):
        if self.auth_mode == "demo" and not self.demo_mode:
            raise ValueError("Demo auth requires demo_mode=true")
        if self.demo_mode and self.auth_mode != "demo":
            raise ValueError("Synthetic demo and Supabase auth cannot be combined")
        if self.auth_mode == "supabase" and not self.supabase_url.startswith("https://"):
            raise ValueError("Supabase auth requires an HTTPS SB_SUPABASE_URL")
        if self.storage_mode == "supabase" and not (self.supabase_url and self.supabase_service_key):
            raise ValueError("Supabase storage requires URL and server-only service key")
        if self.environment == "production":
            if self.demo_mode or self.auth_mode != "supabase" or self.demo_admin:
                raise ValueError("Production must use Supabase auth with ALL demo features disabled")
            if not self.database_url.startswith(("postgresql", "postgres://")):
                raise ValueError("Production requires PostgreSQL")
            if self.storage_mode != "supabase":
                raise ValueError("Production requires durable Supabase object storage")
            if any(not x.startswith("https://") for x in self.origins):
                raise ValueError("Production origins must be explicit HTTPS origins")
            if "*" in self.hosts:
                raise ValueError("Production allowed hosts must not contain wildcards")
        return self

    @property
    def origins(self) -> list[str]:
        return [x.strip().rstrip("/") for x in self.allowed_origins.split(",") if x.strip()]

    @property
    def hosts(self) -> list[str]:
        return [x.strip() for x in self.allowed_hosts.split(",") if x.strip()]

    @property
    def admins(self) -> set[str]:
        return {x.strip() for x in self.admin_user_ids.split(",") if x.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
