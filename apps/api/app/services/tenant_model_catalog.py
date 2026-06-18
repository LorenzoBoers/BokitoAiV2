"""Per-tenant model catalog CRUD and lookups."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider import ProviderConnection, TenantModel
from app.services import provider_connections as conn_svc
from app.services.provider_presets import get_preset


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return base or "model"


def serialize_tenant_model(
    model: TenantModel,
    connection: ProviderConnection | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": str(model.id),
        "connection_id": str(model.connection_id),
        "slug": model.slug,
        "model_id": model.model_id,
        "display_name": model.display_name,
        "kind": model.kind,
        "enabled": model.enabled,
        "supports_tools": model.supports_tools,
        "supports_vision": model.supports_vision,
        "context_window": model.context_window,
        "input_cost_per_mtok_cents": model.input_cost_per_mtok_cents,
        "output_cost_per_mtok_cents": model.output_cost_per_mtok_cents,
        "is_default_chat": model.is_default_chat,
        "is_default_embedding": model.is_default_embedding,
        "sort_order": model.sort_order,
    }
    if connection:
        data["provider_type"] = connection.provider_type
        data["connection_label"] = connection.label
    return data


async def tenant_has_models(session: AsyncSession, tenant_id: UUID) -> bool:
    result = await session.execute(
        select(TenantModel.id).where(TenantModel.tenant_id == tenant_id).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def list_models(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str | None = None,
    enabled_only: bool = False,
) -> list[TenantModel]:
    stmt = select(TenantModel).where(TenantModel.tenant_id == tenant_id)
    if kind:
        stmt = stmt.where(TenantModel.kind == kind)
    if enabled_only:
        stmt = stmt.where(TenantModel.enabled.is_(True))
    stmt = stmt.order_by(TenantModel.sort_order, TenantModel.display_name)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_model(
    session: AsyncSession, tenant_id: UUID, slug_or_model_id: str
) -> TenantModel | None:
    if not slug_or_model_id:
        return None
    result = await session.execute(
        select(TenantModel).where(
            TenantModel.tenant_id == tenant_id,
            TenantModel.slug == slug_or_model_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    result = await session.execute(
        select(TenantModel).where(
            TenantModel.tenant_id == tenant_id,
            TenantModel.model_id == slug_or_model_id,
        )
    )
    return result.scalar_one_or_none()


async def get_default_model(session: AsyncSession, tenant_id: UUID, kind: str) -> TenantModel | None:
    flag = TenantModel.is_default_chat if kind == "chat" else TenantModel.is_default_embedding
    result = await session.execute(
        select(TenantModel).where(
            TenantModel.tenant_id == tenant_id,
            TenantModel.kind == kind,
            flag.is_(True),
            TenantModel.enabled.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    models = await list_models(session, tenant_id, kind=kind, enabled_only=True)
    return models[0] if models else None


async def _clear_default_flags(session: AsyncSession, tenant_id: UUID, kind: str) -> None:
    flag = TenantModel.is_default_chat if kind == "chat" else TenantModel.is_default_embedding
    result = await session.execute(
        select(TenantModel).where(TenantModel.tenant_id == tenant_id, flag.is_(True))
    )
    for model in result.scalars().all():
        setattr(model, flag.key, False)
        session.add(model)


async def create_model(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    connection_id: UUID,
    model_id: str,
    display_name: str = "",
    kind: str = "chat",
    slug: str = "",
    enabled: bool = True,
    supports_tools: bool = True,
    supports_vision: bool = False,
    context_window: int = 0,
    input_cost_per_mtok_cents: int = 0,
    output_cost_per_mtok_cents: int = 0,
    is_default_chat: bool = False,
    is_default_embedding: bool = False,
    sort_order: int = 0,
) -> TenantModel:
    conn = await conn_svc.get_connection(session, tenant_id, connection_id)
    if not conn:
        raise ValueError("Provider connection not found")
    if not conn.enabled:
        raise ValueError("Provider connection is disabled")

    clean_model_id = (model_id or "").strip()
    if not clean_model_id:
        raise ValueError("Model ID is required")

    clean_slug = (slug or "").strip() or _slugify(clean_model_id)
    existing = await session.execute(
        select(TenantModel).where(
            TenantModel.tenant_id == tenant_id,
            TenantModel.slug == clean_slug,
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("A model with this slug already exists")

    if kind not in ("chat", "embedding"):
        raise ValueError("Invalid model kind")

    now = datetime.utcnow()
    if is_default_chat:
        await _clear_default_flags(session, tenant_id, "chat")
    if is_default_embedding:
        await _clear_default_flags(session, tenant_id, "embedding")

    model = TenantModel(
        tenant_id=tenant_id,
        connection_id=connection_id,
        slug=clean_slug,
        model_id=clean_model_id,
        display_name=(display_name or clean_model_id).strip(),
        kind=kind,
        enabled=enabled,
        supports_tools=supports_tools,
        supports_vision=supports_vision,
        context_window=context_window,
        input_cost_per_mtok_cents=input_cost_per_mtok_cents,
        output_cost_per_mtok_cents=output_cost_per_mtok_cents,
        is_default_chat=is_default_chat,
        is_default_embedding=is_default_embedding,
        sort_order=sort_order,
        created_at=now,
        updated_at=now,
    )
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return model


async def bulk_enable_presets(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
) -> list[TenantModel]:
    """Enable all preset models for the connection's provider type."""
    conn = await conn_svc.get_connection(session, tenant_id, connection_id)
    if not conn:
        raise ValueError("Provider connection not found")

    preset = get_preset(conn.provider_type)
    if not preset or not preset["models"]:
        raise ValueError("No preset models for this provider type")

    existing = await list_models(session, tenant_id)
    by_slug = {m.slug: m for m in existing}
    created: list[TenantModel] = []
    now = datetime.utcnow()

    for spec in preset["models"]:
        if spec["slug"] in by_slug:
            row = by_slug[spec["slug"]]
            if not row.enabled:
                row.enabled = True
                row.updated_at = now
                session.add(row)
            continue
        model = TenantModel(
            tenant_id=tenant_id,
            connection_id=connection_id,
            slug=spec["slug"],
            model_id=spec["model_id"],
            display_name=spec["display_name"],
            kind=spec["kind"],
            enabled=True,
            supports_tools=spec["supports_tools"],
            supports_vision=spec["supports_vision"],
            context_window=spec["context_window"],
            input_cost_per_mtok_cents=spec["input_cost_per_mtok_cents"],
            output_cost_per_mtok_cents=spec["output_cost_per_mtok_cents"],
            sort_order=spec["sort_order"],
            created_at=now,
            updated_at=now,
        )
        session.add(model)
        created.append(model)

    await session.commit()
    for model in created:
        await session.refresh(model)
    return created


async def update_model(
    session: AsyncSession,
    tenant_id: UUID,
    model_id: UUID,
    *,
    display_name: str | None = None,
    enabled: bool | None = None,
    is_default_chat: bool | None = None,
    is_default_embedding: bool | None = None,
    input_cost_per_mtok_cents: int | None = None,
    output_cost_per_mtok_cents: int | None = None,
) -> TenantModel:
    result = await session.execute(
        select(TenantModel).where(
            TenantModel.id == model_id,
            TenantModel.tenant_id == tenant_id,
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise ValueError("Model not found")

    now = datetime.utcnow()
    if display_name is not None:
        model.display_name = display_name.strip() or model.model_id
    if enabled is not None:
        model.enabled = enabled
    if input_cost_per_mtok_cents is not None:
        model.input_cost_per_mtok_cents = input_cost_per_mtok_cents
    if output_cost_per_mtok_cents is not None:
        model.output_cost_per_mtok_cents = output_cost_per_mtok_cents

    if is_default_chat is True:
        await _clear_default_flags(session, tenant_id, "chat")
        model.is_default_chat = True
    elif is_default_chat is False:
        model.is_default_chat = False

    if is_default_embedding is True:
        await _clear_default_flags(session, tenant_id, "embedding")
        model.is_default_embedding = True
    elif is_default_embedding is False:
        model.is_default_embedding = False

    model.updated_at = now
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return model


async def delete_model(session: AsyncSession, tenant_id: UUID, model_id: UUID) -> bool:
    result = await session.execute(
        select(TenantModel).where(
            TenantModel.id == model_id,
            TenantModel.tenant_id == tenant_id,
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        return False
    await session.delete(model)
    await session.commit()
    return True


async def list_models_with_connections(
    session: AsyncSession, tenant_id: UUID, *, enabled_only: bool = False
) -> list[dict[str, Any]]:
    models = await list_models(session, tenant_id, enabled_only=enabled_only)
    if not models:
        return []
    conn_ids = {m.connection_id for m in models}
    result = await session.execute(
        select(ProviderConnection).where(ProviderConnection.id.in_(conn_ids))
    )
    conns = {c.id: c for c in result.scalars().all()}
    return [serialize_tenant_model(m, conns.get(m.connection_id)) for m in models]
