"""Staff CRUD for the platform remote-MCP marketplace catalog."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import integration_catalog_store as store

router = APIRouter(prefix="/staff/integrations/catalog", tags=["staff-integration-catalog"])


def _require_staff(auth: AuthContext) -> None:
    if not auth.is_staff:
        raise HTTPException(status_code=403, detail="Staff only")


class HostBody(BaseModel):
    slug: str | None = None
    name: str | None = None
    brand_color: str | None = None
    initials: str | None = None
    logo_domain: str | None = None
    simpleicons: str | None = None
    description: str | None = None


class ProviderBody(BaseModel):
    slug: str | None = None
    static_id: str | None = None
    host_slug: str | None = None
    name: str | None = None
    description: str | None = None
    category: str | None = None
    category_nl: str | None = None
    auth_type: str | None = None
    mcp_remote_url: str | None = None
    mcp_transport: str | None = None
    status: str | None = None
    module: str | None = None
    sort_order: int | None = None
    enabled: bool | None = None


@router.get("/hosts")
async def staff_list_hosts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    await store.ensure_catalog_fresh(session)
    rows = await store.list_catalog_hosts(session)
    return {"items": [store.serialize_host(r) for r in rows]}


@router.post("/hosts")
async def staff_create_host(
    body: HostBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    if not body.slug:
        raise HTTPException(status_code=400, detail="slug is required")
    row = await store.upsert_host(
        session,
        slug=body.slug,
        name=body.name or body.slug,
        brand_color=body.brand_color or "#475569",
        initials=body.initials or "",
        logo_domain=body.logo_domain or "",
        simpleicons=body.simpleicons or "",
        description=body.description or "",
    )
    await store.refresh_remote_catalog_cache(session)
    return store.serialize_host(row)


@router.patch("/hosts/{slug}")
async def staff_patch_host(
    slug: str,
    body: HostBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    existing = await store.get_catalog_host(session, slug)
    if not existing:
        raise HTTPException(status_code=404, detail="Host not found")
    row = await store.upsert_host(
        session,
        slug=slug,
        name=body.name if body.name is not None else existing.name,
        brand_color=body.brand_color if body.brand_color is not None else existing.brand_color,
        initials=body.initials if body.initials is not None else existing.initials,
        logo_domain=body.logo_domain if body.logo_domain is not None else existing.logo_domain,
        simpleicons=body.simpleicons if body.simpleicons is not None else existing.simpleicons,
        description=body.description if body.description is not None else existing.description,
    )
    await store.refresh_remote_catalog_cache(session)
    return store.serialize_host(row)


@router.delete("/hosts/{slug}")
async def staff_delete_host(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    await store.delete_host(session, slug)
    await store.refresh_remote_catalog_cache(session)
    return {"ok": True}


@router.get("/providers")
async def staff_list_providers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    await store.ensure_catalog_fresh(session)
    rows = await store.list_catalog_providers(session, enabled_only=False)
    return {"items": [store.serialize_provider_row(r) for r in rows]}


@router.post("/providers")
async def staff_create_provider(
    body: ProviderBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    payload: dict[str, Any] = body.model_dump(exclude_unset=True)
    row = await store.create_provider(session, payload)
    await store.refresh_remote_catalog_cache(session)
    return store.serialize_provider_row(row)


@router.patch("/providers/{slug}")
async def staff_patch_provider(
    slug: str,
    body: ProviderBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    payload = body.model_dump(exclude_unset=True)
    row = await store.update_provider(session, slug, payload)
    await store.refresh_remote_catalog_cache(session)
    return store.serialize_provider_row(row)


@router.delete("/providers/{slug}")
async def staff_delete_provider(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_staff(auth)
    await store.delete_provider(session, slug)
    await store.refresh_remote_catalog_cache(session)
    return {"ok": True}
