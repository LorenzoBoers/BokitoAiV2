"""Resolve the effective LLM configuration for a tenant.

Resolution order (matches ``resolve_model_call`` for chat/embeddings):
  1. Tenant BYOK secret
  2. Platform (Bokito) secret stored in ``platform_secrets``
  3. Global env key when ``LLM_MODE=live``

Tenants without their own key still run live when Bokito platform keys are set.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services import platform_secrets
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
    platform_anthropic = await platform_secrets.get_platform_secret(session, "anthropic")
    platform_openai = await platform_secrets.get_platform_secret(session, "openai")

    anthropic_key = (
        tenant_anthropic
        or platform_anthropic
        or (settings.anthropic_api_key if global_live else "")
        or ""
    )
    openai_key = (
        tenant_openai
        or platform_openai
        or (settings.openai_api_key if global_live else "")
        or ""
    )

    return TenantLLMConfig(
        anthropic_api_key=anthropic_key,
        openai_api_key=openai_key,
    )
