"""Runtime settings for api-v2.

Every value comes from the environment. Production fails fast on unsafe
defaults (see `validate_production_settings`).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # App
    app_name: str = "Bokito"
    environment: Environment = "development"
    debug: bool = False
    api_prefix: str = "/api"
    region: str = "eu"
    log_json: bool = False
    sentry_dsn: str = ""

    # Data plane
    database_url: str = "postgresql+asyncpg://bokito:bokito@127.0.0.1:5432/bokito_v2"
    redis_url: str = ""
    redis_prefix: str = "bokito2"

    # Auth and crypto
    jwt_secret: str = "dev-jwt-secret"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    refresh_cookie_name: str = "bokito2_refresh"
    credentials_key: str = ""  # Fernet key for connection credentials

    # Origins
    cors_origins: str = "http://127.0.0.1:5180,http://localhost:5180"
    public_app_url: str = "http://127.0.0.1:5180"
    public_api_url: str = "http://127.0.0.1:8090"

    # Models. The managed model is EU by default; BYOK is per connection.
    llm_mode: Literal["mock", "live"] = "mock"
    managed_model: str = "mistral:mistral-large-latest"
    managed_model_region: str = "eu"
    mistral_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    embedding_model: str = "mistral:mistral-embed"
    embedding_dimensions: int = 1024

    # Channels
    resend_api_key: str = ""
    mail_from: str = "Bokito <no-reply@bokito.ai>"
    inbound_domain: str = "in.bokito.ai"
    inbound_secret: str = ""
    meta_app_secret: str = ""
    whatsapp_verify_token: str = ""

    # Workbenches (Cursor cloud agents, Codex). Follows llm_mode unless set.
    workbench_mode: Literal["mock", "live"] | None = None
    cursor_api_base: str = "https://api.cursor.com"

    # Feature switches
    module_writes_enabled: str = ""  # comma-separated module slugs
    scheduler_enabled: bool = True

    @property
    def workbench_live(self) -> bool:
        return (self.workbench_mode or self.llm_mode) == "live"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def module_writes(self) -> set[str]:
        return {s.strip() for s in self.module_writes_enabled.split(",") if s.strip()}


def validate_production_settings(settings: Settings) -> list[str]:
    """Return a list of blocking problems for production."""
    problems: list[str] = []
    if settings.environment != "production":
        return problems
    if settings.jwt_secret in ("", "dev-jwt-secret") or len(settings.jwt_secret) < 32:
        problems.append("JWT_SECRET must be set to a random value of at least 32 characters")
    if not settings.credentials_key:
        problems.append("CREDENTIALS_KEY (Fernet) must be set")
    if settings.llm_mode != "live":
        problems.append("LLM_MODE must be live in production")
    if settings.debug:
        problems.append("DEBUG must be false in production")
    if not settings.redis_url:
        problems.append("REDIS_URL must be set")
    if "127.0.0.1" in settings.public_app_url or "localhost" in settings.public_app_url:
        problems.append("PUBLIC_APP_URL must be the public origin")
    return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
