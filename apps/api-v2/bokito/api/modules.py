"""Modules API: catalog, install, settings, uninstall. Modules add types, playbooks and tools."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from bokito.deps import DbSession, Operator
from bokito.domain.identity import Role
from bokito.modules import get_module, list_modules
from bokito.services import audit
from bokito.services import modules as modules_svc

router = APIRouter(prefix="/modules", tags=["modules"])


@router.get("", summary="Module catalog with install state", response_model=list[dict])
async def catalog(session: DbSession, principal: Operator) -> list[dict[str, Any]]:
    installs = {r.module: r for r in await modules_svc.list_installs(session, principal.tenant_id)}
    return [modules_svc.install_view(spec, installs.get(spec.slug)) for spec in list_modules()]


@router.get("/{slug}", summary="One module", response_model=dict)
async def detail(slug: str, session: DbSession, principal: Operator) -> dict[str, Any]:
    spec = get_module(slug)
    row = await modules_svc.get_install(session, principal.tenant_id, slug)
    return modules_svc.install_view(spec, row)


class InstallIn(BaseModel):
    connection_id: uuid.UUID | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


@router.post("/{slug}/install", summary="Install a module", response_model=dict, status_code=201)
async def install(
    slug: str, body: InstallIn, session: DbSession, principal: Operator
) -> dict[str, Any]:
    principal.require_role(Role.admin)
    row, created = await modules_svc.install(
        session,
        principal.tenant_id,
        slug,
        connection_id=body.connection_id,
        settings=body.settings,
        user_id=principal.user_id,
    )
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="module.install",
        target_kind="module",
        target_id=slug,
        payload={"created": created, "connection_id": str(body.connection_id or "")},
    )
    await session.commit()
    out = modules_svc.install_view(get_module(slug), row)
    out["created"] = created
    return out


class SettingsIn(BaseModel):
    settings: dict[str, Any] | None = None
    connection_id: uuid.UUID | None = None


@router.patch("/{slug}", summary="Change module settings or connection", response_model=dict)
async def update(
    slug: str, body: SettingsIn, session: DbSession, principal: Operator
) -> dict[str, Any]:
    principal.require_role(Role.admin)
    row = await modules_svc.get_install(session, principal.tenant_id, slug)
    if row is None or not row.enabled:
        from bokito.errors import NotFound

        raise NotFound(f"module {slug} is not installed", code="module_not_installed")
    await modules_svc.update_settings(
        session, row, settings=body.settings, connection_id=body.connection_id
    )
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="module.update",
        target_kind="module",
        target_id=slug,
        payload={"settings": body.settings or {}},
    )
    await session.commit()
    return modules_svc.install_view(get_module(slug), row)


@router.delete("/{slug}", status_code=204, summary="Uninstall a module (disable, keep history)")
async def uninstall(slug: str, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    await modules_svc.uninstall(session, principal.tenant_id, slug)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="module.uninstall",
        target_kind="module",
        target_id=slug,
    )
    await session.commit()
