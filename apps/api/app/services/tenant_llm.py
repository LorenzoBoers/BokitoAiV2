"""Resolve the effective LLM configuration for a tenant.

Per-tenant API keys (stored encrypted in ``tenant_secrets``) take precedence
over the global environment. A tenant that has its own Anthropic key runs
live regardless of the global ``LLM_MODE``; without a tenant key we fall back
to the env key only when the server is globally in live mode.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.tenant_secrets import get_secret

settings = get_settings()


@dataclass
class TenantLLMConfig:
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    @property
    def live(self) -> bool:
        """Chat runs live when an Anthropic key is available for this tenant."""
        return bool(self.anthropic_api_key)

    @property
    def embeddings_live(self) -> bool:
        """Embeddings run live when an OpenAI key is available for this tenant."""
        return bool(self.openai_api_key)


async def resolve_tenant_llm_config(session: AsyncSession, tenant_id: UUID) -> TenantLLMConfig:
    global_live = settings.llm_mode == "live"

    tenant_anthropic = await get_secret(session, tenant_id, "anthropic")
    tenant_openai = await get_secret(session, tenant_id, "openai")

    anthropic_key = tenant_anthropic or (settings.anthropic_api_key if global_live else "")
    openai_key = tenant_openai or (settings.openai_api_key if global_live else "")

    return TenantLLMConfig(
        anthropic_api_key=anthropic_key or "",
        openai_api_key=openai_key or "",
    )
