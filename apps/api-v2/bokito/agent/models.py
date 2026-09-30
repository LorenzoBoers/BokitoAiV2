"""Model resolution: which model answers, in which region, on whose key.

Order: agent.model -> tenant setting `default_model` -> managed default (EU).
A `model_provider` connection for the chosen provider means BYOK: the
tenant's own key and billing. Otherwise the managed key applies and usage is
metered to the workspace.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from bokito.config import get_settings
from bokito.domain.connection import ConnectionKind
from bokito.domain.identity import Tenant
from bokito.domain.work import Agent
from bokito.services import connections as conn_svc

PROVIDER_REGIONS = {"mistral": "eu", "openai": "us", "anthropic": "us", "azure-openai": "eu"}

# EUR per 1M tokens (input, output). Indicative list prices; refined per usage report.
PRICES: dict[str, tuple[float, float]] = {
    "mistral-large-latest": (1.8, 5.4),
    "mistral-medium-latest": (0.4, 1.8),
    "mistral-small-latest": (0.1, 0.3),
    "gpt-4.1": (1.8, 7.2),
    "gpt-4.1-mini": (0.36, 1.44),
    "gpt-4o-mini": (0.14, 0.55),
    "claude-sonnet-4-5": (2.7, 13.5),
    "claude-haiku-4-5": (0.9, 4.5),
}


@dataclass(frozen=True)
class ModelRef:
    provider: str
    model: str
    region: str
    api_key: str
    base_url: str = ""
    byok: bool = False
    connection_id: uuid.UUID | None = None

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"

    def cost_eur(self, tokens_in: int, tokens_out: int) -> float:
        price_in, price_out = PRICES.get(self.model, (1.0, 3.0))
        return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


def parse_model(value: str) -> tuple[str, str]:
    provider, sep, model = value.partition(":")
    if not sep:
        return "mistral", value
    return provider, model


async def resolve_model(
    session: AsyncSession, tenant: Tenant, agent: Agent | None = None
) -> ModelRef:
    settings = get_settings()
    chosen = (
        (agent.model if agent and agent.model else "")
        or str((tenant.settings or {}).get("default_model") or "")
        or settings.managed_model
    )
    provider, model = parse_model(chosen)

    conn = await conn_svc.first_active(session, tenant.id, ConnectionKind.model_provider, provider)
    if conn:
        creds = conn_svc.credentials_of(conn)
        return ModelRef(
            provider=provider,
            model=model,
            region=conn.region or PROVIDER_REGIONS.get(provider, "unknown"),
            api_key=str(creds.get("api_key") or ""),
            base_url=str((conn.settings or {}).get("base_url") or ""),
            byok=True,
            connection_id=conn.id,
        )

    managed_key = {
        "mistral": settings.mistral_api_key,
        "openai": settings.openai_api_key,
        "anthropic": settings.anthropic_api_key,
    }.get(provider, "")
    region = (
        settings.managed_model_region
        if provider == "mistral"
        else PROVIDER_REGIONS.get(provider, "unknown")
    )
    return ModelRef(provider=provider, model=model, region=region, api_key=managed_key)
