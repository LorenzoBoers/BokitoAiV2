"""Seed the default Bokito image models as ordinary tenant rows.

They use ``ProviderConnection`` + ``TenantModel`` with ``origin="platform"``,
the same tables a workspace uses when it adds its own provider. The connection
holds no key; resolution falls through to the platform secret or env key.
Chat resolve ignores ``origin="platform"`` so these rows do not replace Maki,
Bokito or Kong.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider import ProviderConnection, TenantModel
from app.services.provider_presets import MISTRAL_BASE_URL

PLATFORM_ORIGIN = "platform"

# provider_type, slug, model_id, display_name, kind, sort_order, base_url
DEFAULT_BOKITO_NODES: tuple[tuple[str, str, str, str, str, int, str], ...] = (
    ("openai", "bokito-image", "dall-e-2", "Bokito Image", "image", 0, ""),
    ("openai", "dall-e-2", "dall-e-2", "DALL-E 2", "image", 1, ""),
    (
        "mistral",
        "mistral-image",
        "mistral-small-latest",
        "Mistral Image",
        "image",
        2,
        MISTRAL_BASE_URL,
    ),
)


def _label(provider_type: str) -> str:
    return f"Bokito {provider_type}"


async def ensure_default_model_nodes(session: AsyncSession, tenant_id: UUID) -> None:
    """Insert missing platform links. Safe to call every time the models page opens."""
    now = datetime.utcnow()
    connections: dict[str, ProviderConnection] = {}
    for provider_type, _slug, _model_id, _name, _kind, _sort, base_url in DEFAULT_BOKITO_NODES:
        if provider_type in connections:
            continue
        label = _label(provider_type)
        existing = (
            await session.execute(
                select(ProviderConnection).where(
                    ProviderConnection.tenant_id == tenant_id,
                    ProviderConnection.label == label,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = ProviderConnection(
                tenant_id=tenant_id,
                provider_type=provider_type,
                label=label,
                base_url=base_url,
                encrypted_value="",
                origin=PLATFORM_ORIGIN,
                created_at=now,
                updated_at=now,
            )
            session.add(existing)
            await session.flush()
        connections[provider_type] = existing

    for provider_type, slug, model_id, display_name, kind, sort_order, _base in DEFAULT_BOKITO_NODES:
        found = (
            await session.execute(
                select(TenantModel).where(
                    TenantModel.tenant_id == tenant_id,
                    TenantModel.slug == slug,
                )
            )
        ).scalar_one_or_none()
        if found is not None:
            continue
        session.add(
            TenantModel(
                tenant_id=tenant_id,
                connection_id=connections[provider_type].id,
                slug=slug,
                model_id=model_id,
                display_name=display_name,
                kind=kind,
                enabled=True,
                supports_tools=False,
                supports_vision=False,
                origin=PLATFORM_ORIGIN,
                sort_order=sort_order,
                created_at=now,
                updated_at=now,
            )
        )
    await session.commit()
