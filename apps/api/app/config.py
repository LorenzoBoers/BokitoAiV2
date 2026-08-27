from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


DEV_JWT_SECRETS = {"dev-jwt-secret", "dev-jwt-secret-change-in-production"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Bokito AI OS"
    debug: bool = False
    api_prefix: str = "/api"

    # Platform UI / team-facing AI fallback. `en` or `nl`; anything else is `nl`.
    # Dashboard SPA uses VITE_PLATFORM_DEFAULT_LANGUAGE (baked at build time).
    platform_default_language: str = "nl"
    # Override path to product-help markdown (`en/` + `nl/` children). Empty
    # walks up to `docs/product-help` or the packaged `app/data/product_help`.
    product_help_dir: str = ""

    # "dev" | "prod" — prod enables fail-fast config checks and Secure cookies.
    environment: str = "dev"

    database_url: str = "postgresql+asyncpg://bokito:bokito@localhost:5432/bokito"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "dev-jwt-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    refresh_cookie_name: str = "bokito_refresh_token"

    llm_mode: str = "mock"  # mock | live
    # Dev-only: short-circuit agent/orchestration execution with canned results.
    bokito_mock_execution: bool = False

    # Optional external Bjorn Lunden MCP endpoint. When set, installing the
    # bjorn_lunden_mcp integration targets this URL; when empty, the built-in
    # native BLA API integration (services/bjorn_lunden.py) is used.
    bjorn_lunden_mcp_url: str = ""
    # KING Finance / KING Accountancy Cloudswitch partnerkey issued by
    # Björn Lundén NL (partners@muis.nl). Platform secret — never entered in
    # the dashboard. Empty = install stays pending; live reads need this plus
    # per-administratie omgevingscodes on the connection.
    king_finance_partner_key: str = ""
    # SOAP endpoint. Default is the documented Cloudswitch XML service.
    king_finance_base_url: str = "https://api.kingfinance.nl/v1/ws1_xml.asmx"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    # Raw provider fallback when a call bypasses the catalog; must be a real
    # API model id, not a virtual slug.
    default_chat_model: str = "claude-sonnet-4-6"
    # Default Anthropic extended-thinking budget for assistant/internal chat when
    # the agent has thinking_budget=0. Set to 0 to disable globally.
    chat_thinking_budget: int = 1024
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_claims_email: str = "mailto:admin@bokito.ai"

    # Observability. Empty DSN disables Sentry entirely (dev/test default).
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1
    # JSON log lines; always on in production, opt-in elsewhere.
    log_json: bool = False

    # Transactional email (invites, password reset, email verification).
    # Delivery order: Resend HTTP API (resend_api_key) -> SMTP (smtp_host) ->
    # dev log. When neither is configured, mail is logged instead and
    # non-production responses include dev magic links so flows stay testable.
    resend_api_key: str = ""
    # Svix signing secret (whsec_...) of the Resend `email.received` webhook;
    # empty disables the /api/inbound/resend endpoint.
    resend_webhook_secret: str = ""
    # Domain for the built-in per-tenant email address ({slug}-{token}@domain).
    bokito_inbound_domain: str = "in.bokito.ai"
    # From header for all transactional mail; falls back to smtp_from.
    mail_from: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Bokito <no-reply@bokito.ai>"
    smtp_use_tls: bool = True
    # Implicit SSL (SMTPS, typically port 465) instead of STARTTLS; also
    # inferred automatically when smtp_port is 465.
    smtp_ssl: bool = False

    worker_inbound_secret: str = "dev-worker-secret"
    use_signal_inbox: bool = True

    # File storage: local (dev) or s3 (R2 prod)
    storage_backend: str = "local"  # local | s3
    storage_local_path: str = "data/uploads"
    storage_s3_bucket: str = ""
    storage_s3_region: str = "auto"
    storage_s3_access_key: str = ""
    storage_s3_secret_key: str = ""
    storage_s3_endpoint: str = ""
    storage_public_base: str = ""

    cors_origins: str = "http://127.0.0.1:5174,http://127.0.0.1:5175,http://localhost:5174,http://localhost:5175"

    # Public origins used to build OAuth redirect URIs and post-OAuth returns.
    # `public_api_url` must match the redirect URI registered with each provider:
    #   {public_api_url}/api/integrations/oauth/callback
    public_api_url: str = "http://localhost:8000"
    public_app_url: str = "http://localhost:5174"

    # OAuth provider credentials. When a provider's client id/secret are empty,
    # the corresponding /oauth/start falls back to the dev mock flow (no real
    # redirect, connection created locally) so dev works without registering apps.
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    microsoft_oauth_client_id: str = ""
    microsoft_oauth_client_secret: str = ""
    microsoft_oauth_tenant: str = "common"
    # Moneybird OAuth app (https://moneybird.com/user/applications). Empty in
    # dev = the connect flow creates a pending connection served by mocks.
    moneybird_oauth_client_id: str = ""
    moneybird_oauth_client_secret: str = ""

    # WhatsApp Business Cloud API (Meta). One app-level webhook serves all
    # tenants: {public_api_url}/api/channels/whatsapp/webhook. When empty the
    # channel is effectively disabled (webhook rejects everything).
    meta_app_id: str = ""
    meta_app_secret: str = ""
    whatsapp_verify_token: str = ""

    @property
    def oauth_redirect_uri(self) -> str:
        return f"{self.public_api_url.rstrip('/')}/api/integrations/oauth/callback"

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in ("prod", "production")


def validate_production_settings(settings: "Settings") -> list[str]:
    """Return a list of fatal misconfigurations when running in production.

    Empty list means the config is safe to boot. Only enforced when
    ENVIRONMENT=prod so dev and tests are unaffected.
    """
    if not settings.is_production:
        return []
    errors: list[str] = []
    if settings.jwt_secret in DEV_JWT_SECRETS or len(settings.jwt_secret) < 32:
        errors.append(
            "JWT_SECRET must be a strong, non-default value (>=32 chars) in production."
        )
    if settings.llm_mode == "live" and not settings.anthropic_api_key:
        errors.append("ANTHROPIC_API_KEY is required when LLM_MODE=live.")
    if settings.llm_mode != "live":
        errors.append("LLM_MODE must be 'live' in production (mock responses are dev-only).")
    if settings.bokito_mock_execution:
        errors.append("BOKITO_MOCK_EXECUTION must be disabled in production.")
    if any(host in settings.cors_origins for host in ("localhost", "127.0.0.1")):
        errors.append("CORS_ORIGINS must not contain localhost/127.0.0.1 in production.")
    if settings.worker_inbound_secret == "dev-worker-secret" or len(settings.worker_inbound_secret) < 16:
        errors.append(
            "WORKER_INBOUND_SECRET must be a strong, non-default value (>=16 chars) in production."
        )
    # OAuth pairs must be complete: a client id without its secret means the
    # provider flow would silently fall back to the dev mock in prod.
    oauth_pairs = (
        ("GITHUB", settings.github_oauth_client_id, settings.github_oauth_client_secret),
        ("GOOGLE", settings.google_oauth_client_id, settings.google_oauth_client_secret),
        ("MICROSOFT", settings.microsoft_oauth_client_id, settings.microsoft_oauth_client_secret),
    )
    for name, client_id, client_secret in oauth_pairs:
        if bool(client_id) != bool(client_secret):
            errors.append(
                f"{name}_OAUTH_CLIENT_ID and {name}_OAUTH_CLIENT_SECRET must both be set (or both empty)."
            )
    # WhatsApp webhook needs both the app secret (signature check) and the
    # verify token (subscription handshake); one without the other means a
    # half-configured channel that silently drops events.
    if bool(settings.meta_app_secret) != bool(settings.whatsapp_verify_token):
        errors.append(
            "META_APP_SECRET and WHATSAPP_VERIFY_TOKEN must both be set (or both empty)."
        )
    return errors


def production_config_warnings(settings: "Settings") -> list[str]:
    """Non-fatal production misconfigurations, logged loudly at startup."""
    if not settings.is_production:
        return []
    warnings: list[str] = []
    if not settings.resend_api_key and not settings.smtp_host:
        warnings.append(
            "No transactional mail provider configured (RESEND_API_KEY or SMTP_HOST): "
            "invite, password-reset and verification emails will NOT be delivered."
        )
    return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()
