"""Tenant provider connections and per-tenant model catalog APIs."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.model_catalog import ModelCatalog
from app.services import model_catalog as catalog_svc
from app.services import platform_secrets, provider_connections, tenant_model_catalog
from app.services.provider_presets import serialize_presets

router = APIRouter(prefix="/settings", tags=["models"])
staff_router = APIRouter(prefix="/staff", tags=["staff-models"])


def _require_staff(auth: AuthContext) -> None:
    if not auth.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


# --- Provider connections ---


class ProviderCreateBody(BaseModel):
    provider_type: str
    label: str = ""
    base_url: str = ""
    api_key: str


class ProviderUpdateBody(BaseModel):
    label: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    enabled: bool | None = None


@router.get("/providers")
async def list_providers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    connections = await provider_connections.list_connections(session, auth.tenant.id)
    return {
        "connections": [provider_connections.serialize_connection(c) for c in connections],
        "presets": serialize_presets(),
    }


@router.post("/providers")
async def create_provider(
    body: ProviderCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    try:
        conn = await provider_connections.create_connection(
            session,
            auth.tenant.id,
            provider_type=body.provider_type,
            label=body.label,
            base_url=body.base_url,
            api_key=body.api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return provider_connections.serialize_connection(conn)


@router.patch("/providers/{connection_id}")
async def update_provider(
    connection_id: UUID,
    body: ProviderUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    try:
        conn = await provider_connections.update_connection(
            session,
            auth.tenant.id,
            connection_id,
            label=body.label,
            base_url=body.base_url,
            api_key=body.api_key,
            enabled=body.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return provider_connections.serialize_connection(conn)


@router.delete("/providers/{connection_id}")
async def delete_provider(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    deleted = await provider_connections.delete_connection(session, auth.tenant.id, connection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"ok": True}


@router.post("/providers/{connection_id}/test")
async def test_provider(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    try:
        return await provider_connections.test_connection(session, auth.tenant.id, connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --- Tenant models ---


class TenantModelCreateBody(BaseModel):
    connection_id: UUID | None = None
    model_id: str = ""
    display_name: str = ""
    kind: str = "chat"
    slug: str = ""
    enabled: bool = True
    supports_tools: bool = True
    supports_vision: bool = False
    context_window: int = 0
    input_cost_per_mtok_cents: int = 0
    output_cost_per_mtok_cents: int = 0
    is_default_chat: bool = False
    is_default_embedding: bool = False
    enable_presets: bool = False


class TenantModelUpdateBody(BaseModel):
    display_name: str | None = None
    enabled: bool | None = None
    is_default_chat: bool | None = None
    is_default_embedding: bool | None = None
    input_cost_per_mtok_cents: int | None = None
    output_cost_per_mtok_cents: int | None = None


async def _tenant_models_payload(session: AsyncSession, tenant_id: UUID) -> dict:
    has_tenant = await tenant_model_catalog.tenant_has_models(session, tenant_id)
    if has_tenant:
        models = await tenant_model_catalog.list_models_with_connections(session, tenant_id)
        default_chat = next((m["slug"] for m in models if m.get("is_default_chat")), "")
        default_embedding = next((m["slug"] for m in models if m.get("is_default_embedding")), "")
        connections = await provider_connections.list_connections(session, tenant_id)
        return {
            "source": "tenant",
            "models": models,
            "connections": [provider_connections.serialize_connection(c) for c in connections],
            "default_chat": default_chat,
            "default_embedding": default_embedding,
            "presets": serialize_presets(),
        }

    # Legacy platform-catalog fallback when tenant has not configured providers yet.
    from app.services import tenant_models, tenant_secrets

    platform_models = await catalog_svc.list_models(session, enabled_only=True)
    prefs = await tenant_models.get_tenant_model_prefs(session, tenant_id)
    byok = await tenant_secrets.list_status(session, tenant_id)
    byok_providers = {row["provider"] for row in byok if row["is_set"]}
    return {
        "source": "platform",
        "models": [catalog_svc.serialize_model(m) for m in platform_models],
        "prefs": prefs,
        "byok": byok,
        "billable_providers": [p for p in ("anthropic", "openai") if p not in byok_providers],
        "presets": serialize_presets(),
    }


@router.get("/models")
async def get_tenant_models(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await _tenant_models_payload(session, auth.tenant.id)


@router.post("/models")
async def create_tenant_model(
    body: TenantModelCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.enable_presets:
        if not body.connection_id:
            raise HTTPException(status_code=400, detail="connection_id required for preset enable")
        try:
            created = await tenant_model_catalog.bulk_enable_presets(
                session, auth.tenant.id, body.connection_id
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"items": [tenant_model_catalog.serialize_tenant_model(m) for m in created]}

    if not body.connection_id:
        raise HTTPException(status_code=400, detail="connection_id is required")
    try:
        model = await tenant_model_catalog.create_model(
            session,
            auth.tenant.id,
            connection_id=body.connection_id,
            model_id=body.model_id,
            display_name=body.display_name,
            kind=body.kind,
            slug=body.slug,
            enabled=body.enabled,
            supports_tools=body.supports_tools,
            supports_vision=body.supports_vision,
            context_window=body.context_window,
            input_cost_per_mtok_cents=body.input_cost_per_mtok_cents,
            output_cost_per_mtok_cents=body.output_cost_per_mtok_cents,
            is_default_chat=body.is_default_chat,
            is_default_embedding=body.is_default_embedding,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    conn = await provider_connections.get_connection(session, auth.tenant.id, model.connection_id)
    return tenant_model_catalog.serialize_tenant_model(model, conn)


@router.patch("/models/{model_id}")
async def update_tenant_model(
    model_id: UUID,
    body: TenantModelUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    try:
        model = await tenant_model_catalog.update_model(
            session,
            auth.tenant.id,
            model_id,
            display_name=body.display_name,
            enabled=body.enabled,
            is_default_chat=body.is_default_chat,
            is_default_embedding=body.is_default_embedding,
            input_cost_per_mtok_cents=body.input_cost_per_mtok_cents,
            output_cost_per_mtok_cents=body.output_cost_per_mtok_cents,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    conn = await provider_connections.get_connection(session, auth.tenant.id, model.connection_id)
    return tenant_model_catalog.serialize_tenant_model(model, conn)


@router.delete("/models/{model_id}")
async def delete_tenant_model(
    model_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    deleted = await tenant_model_catalog.delete_model(session, auth.tenant.id, model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"ok": True}


class TenantModelPrefsBody(BaseModel):
    default_chat: str | None = None
    default_embedding: str | None = None
    allowed_chat: list[str] | None = None


@router.put("/models")
async def update_tenant_model_prefs_legacy(
    body: TenantModelPrefsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Legacy platform-catalog prefs (only when tenant has no self-managed models)."""
    from app.services import tenant_models

    auth.require_role("owner", "admin")
    if await tenant_model_catalog.tenant_has_models(session, auth.tenant.id):
        raise HTTPException(
            status_code=400,
            detail="Workspace uses self-managed models; update defaults via PATCH on model rows",
        )
    for slug, kind in (
        (body.default_chat, "chat"),
        (body.default_embedding, "embedding"),
    ):
        if slug:
            model = await catalog_svc.get_model(session, slug)
            if not model or model.kind != kind or not model.enabled:
                raise HTTPException(status_code=400, detail=f"Invalid {kind} model: {slug}")
    if body.allowed_chat:
        for slug in body.allowed_chat:
            model = await catalog_svc.get_model(session, slug)
            if not model or model.kind != "chat":
                raise HTTPException(status_code=400, detail=f"Invalid chat model: {slug}")
    await tenant_models.set_tenant_model_prefs(
        session,
        auth.tenant.id,
        default_chat=body.default_chat,
        default_embedding=body.default_embedding,
        allowed_chat=body.allowed_chat,
    )
    return await _tenant_models_payload(session, auth.tenant.id)


# --- Staff: catalog CRUD (platform resale) ---


class CatalogUpsertBody(BaseModel):
    slug: str | None = None
    provider: str | None = None
    kind: str | None = None
    model_id: str | None = None
    display_name: str | None = None
    context_window: int | None = None
    input_cost_per_mtok_cents: int | None = None
    output_cost_per_mtok_cents: int | None = None
    supports_tools: bool | None = None
    supports_vision: bool | None = None
    enabled: bool | None = None
    is_default_chat: bool | None = None
    is_default_embedding: bool | None = None
    sort_order: int | None = None


@staff_router.get("/models")
async def staff_list_models(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    models = await catalog_svc.list_models(session)
    return {"items": [catalog_svc.serialize_model(m, staff=True) for m in models]}


@staff_router.post("/models")
async def staff_create_model(
    body: CatalogUpsertBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    if not body.slug or not body.provider or not body.kind:
        raise HTTPException(status_code=400, detail="slug, provider and kind are required")
    existing = await catalog_svc.get_model(session, body.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Model slug already exists")
    model = ModelCatalog(
        slug=body.slug,
        provider=body.provider,
        kind=body.kind,
        model_id=body.model_id or body.slug,
        display_name=body.display_name or body.slug,
        context_window=body.context_window or 0,
        input_cost_per_mtok_cents=body.input_cost_per_mtok_cents or 0,
        output_cost_per_mtok_cents=body.output_cost_per_mtok_cents or 0,
        supports_tools=body.supports_tools if body.supports_tools is not None else True,
        supports_vision=bool(body.supports_vision),
        enabled=body.enabled if body.enabled is not None else True,
        is_default_chat=bool(body.is_default_chat),
        is_default_embedding=bool(body.is_default_embedding),
        sort_order=body.sort_order or 0,
    )
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return catalog_svc.serialize_model(model, staff=True)


@staff_router.patch("/models/{model_id}")
async def staff_update_model(
    model_id: UUID,
    body: CatalogUpsertBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    result = await session.execute(select(ModelCatalog).where(ModelCatalog.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    from datetime import datetime

    for field in (
        "provider", "kind", "model_id", "display_name", "context_window",
        "input_cost_per_mtok_cents", "output_cost_per_mtok_cents", "supports_tools",
        "supports_vision", "enabled", "is_default_chat", "is_default_embedding", "sort_order",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(model, field, value)
    model.updated_at = datetime.utcnow()
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return catalog_svc.serialize_model(model, staff=True)


@staff_router.delete("/models/{model_id}")
async def staff_delete_model(
    model_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    result = await session.execute(select(ModelCatalog).where(ModelCatalog.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    await session.delete(model)
    await session.commit()
    return {"ok": True}


class PlatformKeyBody(BaseModel):
    api_key: str


class MarkupBody(BaseModel):
    multiplier: float


@staff_router.get("/platform-keys")
async def staff_get_platform_keys(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    keys = await platform_secrets.list_platform_status(session)
    markup = await catalog_svc.get_markup_multiplier(session)
    return {"providers": keys, "markup": markup}


@staff_router.put("/platform-keys/{provider}")
async def staff_set_platform_key(
    provider: str,
    body: PlatformKeyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    if provider not in platform_secrets.PLATFORM_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")
    if not body.api_key.strip():
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    await platform_secrets.set_platform_secret(session, provider, body.api_key)
    return {"providers": await platform_secrets.list_platform_status(session)}


@staff_router.delete("/platform-keys/{provider}")
async def staff_delete_platform_key(
    provider: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    if provider not in platform_secrets.PLATFORM_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")
    await platform_secrets.delete_platform_secret(session, provider)
    return {"providers": await platform_secrets.list_platform_status(session)}


@staff_router.put("/markup")
async def staff_set_markup(
    body: MarkupBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    value = await catalog_svc.set_markup_multiplier(session, body.multiplier)
    return {"markup": value}
