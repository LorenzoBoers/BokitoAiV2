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
from app.services import bokito_models
from app.services import model_catalog as catalog_svc
from app.services import platform_secrets, provider_connections, tenant_features, tenant_model_catalog
from app.services.provider_presets import serialize_presets

router = APIRouter(prefix="/settings", tags=["models"])
staff_router = APIRouter(prefix="/staff", tags=["staff-models"])


def _require_staff(auth: AuthContext) -> None:
    if not auth.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


def _require_custom_models_write(tenant) -> None:
    """Creating/updating BYOK providers or models needs entitlement + opt-in."""
    if not tenant_features.custom_models_active(tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Custom models are not enabled for this workspace",
        )


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
    if not tenant_features.custom_models_allowed(auth.tenant):
        return {"connections": [], "presets": serialize_presets()}
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
    _require_custom_models_write(auth.tenant)
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
    _require_custom_models_write(auth.tenant)
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
    _require_custom_models_write(auth.tenant)
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
    if not tenant_features.custom_models_allowed(auth.tenant):
        raise HTTPException(status_code=403, detail="Custom models are not available")
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


async def _managed_ai_status(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    overridden: bool,
    workspace_chat_mode: str | None = None,
) -> dict:
    """Managed Bokito AI tiers: platform catalog + platform keys, product-facing.

    When the tenant runs self-managed models (BYOK), managed tiers are on
    standby: BYOK models take precedence for resolution defaults.
    """
    from app.services import bokito_models, model_policy
    from app.services.model_resolution import _resolve_from_platform_catalog

    ws_mode = model_policy.normalize_workspace_mode(workspace_chat_mode)

    async def _tier_info(slug: str) -> dict:
        resolved = await _resolve_from_platform_catalog(
            session, tenant_id, kind="chat", model_slug=slug
        )
        catalog_row = await catalog_svc.get_model(session, slug)
        display = (
            catalog_row.display_name
            if catalog_row
            else bokito_models.display_name_for_slug(slug)
        )
        list_in, list_out = bokito_models.bill_prices_for_slug(slug) or (
            catalog_row.input_cost_per_mtok_cents if catalog_row else 0,
            catalog_row.output_cost_per_mtok_cents if catalog_row else 0,
        )
        return {
            "slug": slug,
            "display_name": display,
            "provider": "bokito",
            "tier": bokito_models.tier_hint(slug),
            "key_source": resolved.key_source,
            "ready": resolved.live,
            "region": resolved.region,
            "intended_region": resolved.intended_region or resolved.region,
            "fallback_active": resolved.fallback_active,
            "is_default_chat": slug == ws_mode,
            "is_workspace_default": slug == ws_mode,
            "kind": "chat",
            "enabled": True,
            "model_id": "",
            "context_window": int(catalog_row.context_window) if catalog_row else 0,
            "supports_tools": bool(catalog_row.supports_tools) if catalog_row else True,
            "supports_vision": bool(catalog_row.supports_vision) if catalog_row else False,
            "input_cost_per_mtok_cents": list_in,
            "output_cost_per_mtok_cents": list_out,
        }

    async def _embedding_info() -> dict:
        resolved = await _resolve_from_platform_catalog(
            session, tenant_id, kind="embedding", model_slug=None
        )
        catalog_row = await catalog_svc.get_model(session, resolved.slug)
        return {
            "slug": resolved.slug,
            "display_name": catalog_row.display_name if catalog_row else resolved.slug,
            "provider": resolved.provider,
            "key_source": resolved.key_source,
            "ready": resolved.live,
            "region": resolved.region,
            "intended_region": resolved.intended_region or resolved.region,
            "fallback_active": resolved.fallback_active,
        }

    models: list[dict] = []
    for slug in bokito_models.MANAGED_CHAT_SLUGS:
        row = await catalog_svc.get_model(session, slug)
        if row is None or not row.enabled:
            continue
        models.append(await _tier_info(slug))

    default_slug = (
        ws_mode
        if ws_mode in bokito_models.MANAGED_CHAT_SLUGS
        else catalog_svc.BOKITO_MODEL_SLUG
    )
    chat = next((m for m in models if m["slug"] == default_slug), None)
    if chat is None and models:
        chat = models[0]
    if chat is None:
        # Seed missing — still return a stub so older clients keep working.
        chat = await _tier_info(default_slug)
        models = [chat]

    embedding = await _embedding_info()
    any_ready = any(m.get("ready") for m in models)
    if overridden:
        status = "standby"
    elif any_ready:
        status = "active"
    else:
        status = "unconfigured"
    return {
        "name": "Bokito AI",
        "status": status,  # active | standby | unconfigured
        "chat": chat,
        "models": models,
        "default_chat": chat["slug"],
        "workspace_chat_mode": ws_mode,
        "embedding": embedding,
    }


async def _tenant_models_payload(session: AsyncSession, tenant) -> dict:
    """Bokito-first payload: managed card always; custom block only when gated."""
    from app.services import model_policy, tenant_models as tenant_models_svc

    tenant_id = tenant.id
    status = tenant_features.custom_models_status(tenant)
    active = status["active"]
    has_tenant_rows = await tenant_model_catalog.tenant_has_models(session, tenant_id)
    prefs = await tenant_models_svc.get_tenant_model_prefs(session, tenant_id)
    ws_mode = model_policy.workspace_chat_mode(prefs)
    managed = await _managed_ai_status(
        session,
        tenant_id,
        overridden=active and has_tenant_rows,
        workspace_chat_mode=ws_mode,
    )

    custom_block: dict = {
        "allowed": status["allowed"],
        "enabled": status["enabled"],
        "active": active,
        "models": [],
        "connections": [],
        "presets": serialize_presets(),
        "default_chat": "",
        "default_embedding": "",
    }
    if status["allowed"]:
        connections = await provider_connections.list_connections(session, tenant_id)
        custom_block["connections"] = [
            provider_connections.serialize_connection(c) for c in connections
        ]
        if active and has_tenant_rows:
            models = await tenant_model_catalog.list_models_with_connections(session, tenant_id)
            custom_block["models"] = models
            custom_block["default_chat"] = next(
                (m["slug"] for m in models if m.get("is_default_chat")), ""
            )
            custom_block["default_embedding"] = next(
                (m["slug"] for m in models if m.get("is_default_embedding")), ""
            )

    # Selectable chat list: all managed Bokito tiers, plus BYOK when active.
    selectable = [
        {
            "slug": m["slug"],
            "display_name": m["display_name"],
            "provider": "bokito",
            "region": m.get("region") or "",
            "tier": m.get("tier") or "standard",
            "kind": "chat",
            "enabled": True,
            "model_id": "",
            "is_default_chat": bool(m.get("is_default_chat")),
            "input_cost_per_mtok_cents": m.get("input_cost_per_mtok_cents") or 0,
            "output_cost_per_mtok_cents": m.get("output_cost_per_mtok_cents") or 0,
        }
        for m in managed.get("models") or [managed["chat"]]
    ]
    if active:
        for row in custom_block["models"]:
            if row.get("kind") == "chat" and row.get("enabled"):
                selectable.append(row)

    data_region = await _data_region_block(session, tenant_id)

    return {
        "source": "managed" if not active else "tenant",
        "managed": managed,
        "custom_models": custom_block,
        "data_region": data_region,
        "selectable_chat": selectable,
        # Backward-compat fields for older clients during rollout.
        "models": selectable if not active else custom_block["models"],
        "connections": custom_block["connections"],
        "presets": custom_block["presets"],
        "workspace_chat_mode": ws_mode,
        "default_chat": (
            custom_block["default_chat"]
            or (managed["chat"]["slug"] if ws_mode != model_policy.AUTOMATIC else "")
            or managed["chat"]["slug"]
        ),
        "default_embedding": (
            custom_block["default_embedding"] or managed["embedding"]["slug"]
        ),
    }


async def _data_region_block(session: AsyncSession, tenant_id: UUID) -> dict:
    """Workspace data-region policy plus the EU share of the last 30 days."""
    from datetime import datetime, timedelta

    from app.services.cockpit import usage_by_region
    from app.services.tenant_models import get_tenant_model_prefs

    prefs = await get_tenant_model_prefs(session, tenant_id)
    usage = await usage_by_region(
        session, tenant_id, since=datetime.utcnow() - timedelta(days=30)
    )
    # Agents on a US-hosted platform model that the policy redirects.
    from app.models.agent import Agent

    rows = (
        await session.execute(
            select(Agent.model).where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
        )
    ).all()
    redirected: set[str] = set()
    for (model_slug,) in rows:
        if not model_slug:
            continue
        row = await catalog_svc.get_model(session, model_slug)
        if row is None or bokito_models.is_bokito_provider(row.provider):
            continue
        if catalog_svc.model_region(row) != "eu":
            redirected.add(row.slug)
    return {
        "non_eu_platform_models": prefs["non_eu_platform_models"],
        "eu_share_pct_30d": usage["eu_share_pct"],
        "by_region_30d": usage["by_region"],
        "non_eu_models_in_use": sorted(redirected),
    }


class DataRegionPolicyBody(BaseModel):
    non_eu_platform_models: str


class WorkspaceChatModeBody(BaseModel):
    """Workspace Bokito AI default: automatic or a managed tier slug."""

    workspace_chat_mode: str


@router.patch("/models/workspace-chat-mode")
async def patch_workspace_chat_mode(
    body: WorkspaceChatModeBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Set the workspace Bokito AI default (Maki / Bokito / Kong / Automatic)."""
    from app.services import model_policy
    from app.services.tenant_models import set_tenant_model_prefs

    auth.require_role("owner", "admin")
    mode = model_policy.normalize_workspace_mode(body.workspace_chat_mode)
    if mode not in model_policy.WORKSPACE_MODES:
        raise HTTPException(status_code=400, detail="Invalid workspace chat mode")
    await set_tenant_model_prefs(session, auth.tenant.id, workspace_chat_mode=mode)
    refreshed = await tenant_features.get_tenant(session, auth.tenant.id)
    return await _tenant_models_payload(session, refreshed or auth.tenant)


@router.patch("/models/data-region")
async def patch_data_region_policy(
    body: DataRegionPolicyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Allow or block US-hosted platform models for this workspace (owner/admin)."""
    from app.services.tenant_models import set_tenant_model_prefs

    auth.require_role("owner", "admin")
    try:
        await set_tenant_model_prefs(
            session, auth.tenant.id, non_eu_platform_models=body.non_eu_platform_models
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    refreshed = await tenant_features.get_tenant(session, auth.tenant.id)
    return await _tenant_models_payload(session, refreshed or auth.tenant)


class CustomModelsOptInBody(BaseModel):
    enabled: bool


@router.patch("/models/custom")
async def patch_custom_models_opt_in(
    body: CustomModelsOptInBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Tenant opt-in to use own models (requires staff entitlement + env)."""
    auth.require_role("owner", "admin")
    try:
        await tenant_features.set_custom_models_opt_in(
            session, auth.tenant.id, enabled=body.enabled
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # Refresh auth.tenant settings from DB for the payload.
    refreshed = await tenant_features.get_tenant(session, auth.tenant.id)
    return await _tenant_models_payload(session, refreshed or auth.tenant)


@router.get("/models/runtime")
async def get_llm_runtime(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Lightweight live/mock flag for workspace banners (any member)."""
    from app.services.model_resolution import resolve_model_call

    call = await resolve_model_call(session, auth.tenant.id, kind="chat")
    live = bool(call.live)
    return {
        "live": live,
        "mode": "live" if live else "mock",
        "key_source": call.key_source,
        "slug": call.slug,
    }


@router.get("/models")
async def get_tenant_models(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await _tenant_models_payload(session, auth.tenant)


@router.post("/models")
async def create_tenant_model(
    body: TenantModelCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    _require_custom_models_write(auth.tenant)
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
    _require_custom_models_write(auth.tenant)
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
    _require_custom_models_write(auth.tenant)
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
    return await _tenant_models_payload(session, auth.tenant)


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


class BokitoBackingsBody(BaseModel):
    """Backing chain per managed tier, e.g. ``{"bokito-ai-3-1": ["mistral-medium-latest"]}``.

    Tiers left out keep the env / built-in chain.
    """

    routes: dict[str, list[str]]


async def _bokito_backings_payload(session: AsyncSession) -> dict:
    from app.services import provider_health
    from app.services.model_resolution import platform_key_for

    routes = await bokito_models.refresh_routes(session, force=True)
    sources = bokito_models.route_sources()
    tiers = []
    for tier in bokito_models.MANAGED_CHAT_SLUGS:
        steps = []
        for slug in routes.get(tier, ()):
            row = await catalog_svc.get_model(session, slug)
            provider = row.provider if row else ""
            key = await platform_key_for(session, provider) if provider else ""
            steps.append(
                {
                    "slug": slug,
                    "provider": provider,
                    "in_catalog": row is not None,
                    "has_platform_key": bool(key),
                    "cooling": provider_health.is_cooling(key, (row.model_id or row.slug) if row else slug),
                }
            )
        tiers.append(
            {
                "slug": tier,
                "display_name": bokito_models.display_name_for_slug(tier),
                "source": sources[tier],
                "steps": steps,
            }
        )
    return {
        "tiers": tiers,
        "defaults": {k: list(v) for k, v in bokito_models.DEFAULT_BACKINGS.items()},
    }


@staff_router.get("/bokito-backings")
async def staff_get_bokito_backings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Which catalog models (and providers) run each Bokito tier, in fallback order."""
    _require_staff(auth)
    return await _bokito_backings_payload(session)


@staff_router.put("/bokito-backings")
async def staff_set_bokito_backings(
    body: BokitoBackingsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Replace the staff override. Every step must be an existing non-Bokito chat model."""
    import json
    from datetime import datetime

    from app.models.model_catalog import PlatformSetting

    _require_staff(auth)
    try:
        routes = bokito_models.parse_routes(body.routes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for tier, chain in routes.items():
        for slug in chain:
            row = await catalog_svc.get_model(session, slug)
            if row is None or row.kind != "chat" or bokito_models.is_bokito_provider(row.provider):
                raise HTTPException(
                    status_code=400, detail=f"{slug} is not a chat model in the catalog ({tier})"
                )
    value = json.dumps({k: list(v) for k, v in routes.items()})
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == bokito_models.BACKINGS_SETTING_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        session.add(PlatformSetting(key=bokito_models.BACKINGS_SETTING_KEY, value=value))
    await session.commit()
    return await _bokito_backings_payload(session)


@staff_router.delete("/bokito-backings")
async def staff_reset_bokito_backings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Drop the staff override; tiers fall back to env / built-in chains."""
    from app.models.model_catalog import PlatformSetting

    _require_staff(auth)
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == bokito_models.BACKINGS_SETTING_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()
    return await _bokito_backings_payload(session)


@staff_router.put("/markup")
async def staff_set_markup(
    body: MarkupBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    value = await catalog_svc.set_markup_multiplier(session, body.multiplier)
    return {"markup": value}
