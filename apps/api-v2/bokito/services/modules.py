"""Module installs: seed types, playbooks and skills; gate module tools."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.connection import Connection, ConnectionKind
from bokito.domain.identity import Posture
from bokito.domain.orient import DocKind, SignalType
from bokito.domain.platform import ModuleInstall
from bokito.domain.work import Playbook
from bokito.errors import Conflict, NotFound
from bokito.modules import ModuleSpec, get_module
from bokito.services import knowledge as knowledge_svc
from bokito.services import work as work_svc


async def get_install(
    session: AsyncSession, tenant_id: uuid.UUID, slug: str
) -> ModuleInstall | None:
    return await session.scalar(
        select(ModuleInstall).where(
            ModuleInstall.tenant_id == tenant_id, ModuleInstall.module == slug
        )
    )


async def list_installs(session: AsyncSession, tenant_id: uuid.UUID) -> list[ModuleInstall]:
    rows = await session.scalars(
        select(ModuleInstall)
        .where(ModuleInstall.tenant_id == tenant_id)
        .order_by(ModuleInstall.module)
    )
    return list(rows.all())


async def installed_slugs(session: AsyncSession, tenant_id: uuid.UUID) -> set[str]:
    rows = await session.scalars(
        select(ModuleInstall.module).where(
            ModuleInstall.tenant_id == tenant_id, ModuleInstall.enabled.is_(True)
        )
    )
    return set(rows.all())


def _posture(value: str | None) -> Posture | None:
    return Posture(value) if value else None


async def _seed(session: AsyncSession, tenant_id: uuid.UUID, spec: ModuleSpec) -> dict[str, int]:
    """Create what is missing; never overwrite an operator's edits."""
    created = {"signal_types": 0, "playbooks": 0, "docs": 0}
    playbook_ids: dict[str, uuid.UUID] = {}
    for seed in spec.playbooks:
        existing = await session.scalar(
            select(Playbook).where(Playbook.tenant_id == tenant_id, Playbook.slug == seed.slug)
        )
        if existing is None:
            existing = await work_svc.create_playbook(
                session,
                tenant_id,
                name=seed.name,
                description=seed.description,
                steps=seed.steps,
                autonomy_cap=_posture(seed.autonomy_cap),
                module=spec.slug,
            )
            if existing.slug != seed.slug:
                existing.slug = seed.slug
            created["playbooks"] += 1
        playbook_ids[seed.slug] = existing.id
    for seed in spec.signal_types:
        existing = await session.scalar(
            select(SignalType).where(
                SignalType.tenant_id == tenant_id, SignalType.slug == seed.slug
            )
        )
        if existing is None:
            session.add(
                SignalType(
                    tenant_id=tenant_id,
                    slug=seed.slug,
                    name=seed.name,
                    description=seed.description,
                    color=seed.color,
                    fields=list(seed.fields),
                    recognition=dict(seed.recognition),
                    autonomy_cap=_posture(seed.autonomy_cap),
                    playbook_id=playbook_ids.get(seed.playbook_slug or ""),
                    module=spec.slug,
                    enabled=True,
                )
            )
            created["signal_types"] += 1
        elif not existing.enabled and existing.module == spec.slug:
            existing.enabled = True
    for doc in spec.docs:
        if await knowledge_svc.get_by_path(session, tenant_id, doc.path) is None:
            await knowledge_svc.upsert(
                session,
                tenant_id,
                title=doc.title,
                body=doc.body,
                kind=DocKind(doc.kind),
                path=doc.path,
                frontmatter={"module": spec.slug},
                published=True,
                source=f"module:{spec.slug}",
            )
            created["docs"] += 1
    await session.flush()
    return created


async def install(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    slug: str,
    *,
    connection_id: uuid.UUID | None = None,
    settings: dict[str, Any] | None = None,
    user_id: uuid.UUID | None = None,
) -> tuple[ModuleInstall, dict[str, int]]:
    spec = get_module(slug)
    if connection_id is not None:
        conn = await session.get(Connection, connection_id)
        if not conn or conn.tenant_id != tenant_id:
            raise NotFound("connection not found", code="connection_not_found")
        if spec.connection_provider and (
            conn.kind != ConnectionKind(spec.connection_kind)
            or conn.provider != spec.connection_provider
        ):
            raise Conflict(
                f"module {slug} needs a {spec.connection_kind} connection with provider "
                f"{spec.connection_provider}",
                code="module_connection_mismatch",
            )
    existing = await get_install(session, tenant_id, slug)
    if existing and existing.enabled:
        raise Conflict(f"module {slug} is already installed", code="module_installed")
    if existing is None:
        existing = ModuleInstall(tenant_id=tenant_id, module=slug)
        session.add(existing)
    existing.version = spec.version
    existing.enabled = True
    existing.connection_id = connection_id
    existing.settings = {**_defaults(spec), **(existing.settings or {}), **(settings or {})}
    existing.installed_by_user_id = user_id
    await session.flush()
    created = await _seed(session, tenant_id, spec)
    return existing, created


def _defaults(spec: ModuleSpec) -> dict[str, Any]:
    return {
        key: field.get("default")
        for key, field in (spec.settings_schema or {}).items()
        if "default" in field
    }


async def update_settings(
    session: AsyncSession,
    install_row: ModuleInstall,
    *,
    settings: dict[str, Any] | None = None,
    connection_id: uuid.UUID | None = None,
) -> ModuleInstall:
    if settings is not None:
        install_row.settings = {**(install_row.settings or {}), **settings}
    if connection_id is not None:
        install_row.connection_id = connection_id
    await session.flush()
    return install_row


async def uninstall(session: AsyncSession, tenant_id: uuid.UUID, slug: str) -> ModuleInstall:
    """Disable the module: its tools stop, its types are disabled, playbooks deactivated.

    Nothing is deleted: conversations keep their Signal type, runs keep their history.
    """
    row = await get_install(session, tenant_id, slug)
    if row is None or not row.enabled:
        raise NotFound(f"module {slug} is not installed", code="module_not_installed")
    row.enabled = False
    types = await session.scalars(
        select(SignalType).where(SignalType.tenant_id == tenant_id, SignalType.module == slug)
    )
    for st in types.all():
        st.enabled = False
    playbooks = await session.scalars(
        select(Playbook).where(Playbook.tenant_id == tenant_id, Playbook.module == slug)
    )
    for pb in playbooks.all():
        pb.active = False
    await session.flush()
    return row


def install_view(spec: ModuleSpec, row: ModuleInstall | None) -> dict[str, Any]:
    out = spec.to_public()
    out["installed"] = bool(row and row.enabled)
    out["install"] = (
        {
            "id": str(row.id),
            "version": row.version,
            "settings": row.settings or {},
            "connection_id": str(row.connection_id) if row.connection_id else None,
            "enabled": row.enabled,
            "installed_at": row.created_at,
            "updated_at": row.updated_at,
        }
        if row
        else None
    )
    return out
