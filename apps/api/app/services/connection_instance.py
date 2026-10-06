"""One active connection per vendor account (``IntegrationConnection.instance_key``).

The key is the vendor's own numeric id for the account behind a login:
Moneybird administration id, KING omgevingscode. Stored as a digit string so
ids beyond 32 bits stay valid. Uniqueness is per tenant + provider among
active rows; a second connect to the same account lands on the existing row.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer

logger = logging.getLogger(__name__)

MERGED_STATUS = "merged"
# Converge runs inside a listing request; a slow vendor must not stall it.
_LIVE_TIMEOUT_S = 5.0


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _sort_key(value: str) -> tuple[int, int | str]:
    return (0, int(value)) if value.isdigit() else (1, value)


def instance_key_for(
    provider: str,
    *,
    administrations: list[dict[str, Any]] | None = None,
    auth: dict[str, Any] | None = None,
) -> str:
    """Stable key for the account behind a login; empty when unknown.

    One login can list several administrations; the lowest id is the key so
    the same login always resolves to the same row.
    """
    if provider == "moneybird":
        ids = [str(a.get("id") or "").strip() for a in administrations or []]
        ids = [i for i in ids if i]
        return min(ids, key=_sort_key) if ids else ""
    if provider == "king_accountancy":
        from app.services.king_finance import parse_administraties

        codes = [row["omgevingscode"] for row in parse_administraties(auth or {})]
        return min(codes, key=_sort_key) if codes else ""
    return ""


async def find_instance_owner(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    instance_key: str,
    *,
    exclude_id: UUID | None = None,
) -> IntegrationConnection | None:
    if not instance_key:
        return None
    query = select(IntegrationConnection).where(
        IntegrationConnection.tenant_id == tenant_id,
        IntegrationConnection.provider == provider,
        IntegrationConnection.instance_key == instance_key,
        IntegrationConnection.status == "active",
    )
    if exclude_id is not None:
        query = query.where(IntegrationConnection.id != exclude_id)
    result = await session.execute(query.order_by(IntegrationConnection.created_at.asc()))
    return result.scalars().first()


async def _mcp_server_ids(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> list[UUID]:
    rows = (
        await session.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.tenant_id == tenant_id,
                IntegrationBinding.connection_id == connection_id,
                IntegrationBinding.binding_type == "mcp_server",
            )
        )
    ).scalars().all()
    out: list[UUID] = []
    for row in rows:
        raw = str(_parse_json(row.config_json).get("mcp_server_id") or "").strip()
        try:
            out.append(UUID(raw))
        except ValueError:
            continue
    return out


async def merge_connection_into(
    session: AsyncSession,
    tenant_id: UUID,
    source: IntegrationConnection,
    target: IntegrationConnection,
    *,
    take_credentials: bool = True,
) -> None:
    """Fold ``source`` into ``target`` (caller commits).

    Module attachments, project links and module defaults move to the target;
    the source is marked ``merged`` and no longer counts as active. With
    ``take_credentials`` the source's (newer) tokens and verify stamps win.
    """
    from app.models.module_install import ModuleInstall
    from app.models.project_work import ProjectResource

    if take_credentials:
        target.credentials_json = source.credentials_json
        target_meta = _parse_json(target.metadata_json)
        source_meta = _parse_json(source.metadata_json)
        for key in ("identity", "email", "last_verified_at", "verify_error", "auth_type"):
            if key in source_meta:
                target_meta[key] = source_meta[key]
            elif key == "verify_error":
                target_meta.pop(key, None)
        target.metadata_json = json.dumps(target_meta)

    target_modules = set()
    bindings = (
        await session.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.tenant_id == tenant_id,
                IntegrationBinding.connection_id.in_([source.id, target.id]),
            )
        )
    ).scalars().all()
    for row in bindings:
        if row.connection_id == target.id and row.binding_type == "module":
            target_modules.add(str(_parse_json(row.config_json).get("module_slug") or ""))
    for row in bindings:
        if row.connection_id != source.id:
            continue
        if row.binding_type == "module":
            slug = str(_parse_json(row.config_json).get("module_slug") or "")
            if slug in target_modules:
                await session.delete(row)
                continue
            target_modules.add(slug)
            row.connection_id = target.id
            session.add(row)
        elif row.binding_type == "mcp_server":
            # Native MCP rows keep one server per connection: retire the source's.
            raw = str(_parse_json(row.config_json).get("mcp_server_id") or "").strip()
            try:
                server = await session.get(McpServer, UUID(raw))
            except ValueError:
                server = None
            if server is not None and server.tenant_id == tenant_id:
                server.is_active = False
                session.add(server)
            await session.delete(row)

    linked = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.connection_id == source.id,
            )
        )
    ).scalars().all()
    target_projects = set(
        (
            await session.execute(
                select(ProjectResource.project_id).where(
                    ProjectResource.tenant_id == tenant_id,
                    ProjectResource.connection_id == target.id,
                    ProjectResource.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    for res in linked:
        if res.project_id in target_projects:
            await session.delete(res)
            continue
        res.connection_id = target.id
        session.add(res)

    source_ids = {str(source.id), *(str(s) for s in await _mcp_server_ids(session, tenant_id, source.id))}
    target_servers = await _mcp_server_ids(session, tenant_id, target.id)
    target_ref = str(target_servers[0]) if target_servers else str(target.id)
    installs = (
        await session.execute(select(ModuleInstall).where(ModuleInstall.tenant_id == tenant_id))
    ).scalars().all()
    for install in installs:
        if install.default_connection_id and install.default_connection_id in source_ids:
            install.default_connection_id = target_ref
            session.add(install)

    source.status = MERGED_STATUS
    source.instance_key = ""
    session.add(source)
    session.add(target)
    await session.flush()


async def claim_instance_key(
    session: AsyncSession,
    tenant_id: UUID,
    conn: IntegrationConnection,
    instance_key: str,
) -> IntegrationConnection:
    """Bind ``conn`` to its vendor account; returns the surviving row.

    When another active row already owns the key, ``conn`` folds into it and
    the existing row is returned (caller commits).
    """
    if not instance_key:
        return conn
    owner = await find_instance_owner(
        session, tenant_id, conn.provider, instance_key, exclude_id=conn.id
    )
    if owner is None:
        conn.instance_key = instance_key
        session.add(conn)
        await session.flush()
        return conn
    await merge_connection_into(session, tenant_id, conn, owner)
    return owner


async def converge_duplicate_instances(session: AsyncSession, tenant_id: UUID) -> int:
    """Backfill keys for active accounting rows and collapse duplicates.

    Resolves Moneybird administration ids live (best effort) and KING codes
    from the stored MCP auth. Per key the oldest verified row survives.
    Returns the number of rows folded away.
    """
    rows = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.status == "active",
                IntegrationConnection.provider.in_(["moneybird", "king_accountancy"]),
            )
            .order_by(IntegrationConnection.created_at.asc())
        )
    ).scalars().all()
    per_provider: dict[str, int] = {}
    for conn in rows:
        per_provider[conn.provider] = per_provider.get(conn.provider, 0) + 1
    keyed: dict[tuple[str, str], list[IntegrationConnection]] = {}
    for conn in rows:
        key = conn.instance_key
        # A lone row cannot be a duplicate; it gets its key on the next verify.
        if not key and per_provider[conn.provider] > 1:
            key = await _resolve_key_live(session, tenant_id, conn)
        if key:
            keyed.setdefault((conn.provider, key), []).append(conn)
    folded = 0
    for (_provider, key), group in keyed.items():
        survivor = next(
            (c for c in group if _parse_json(c.metadata_json).get("last_verified_at")),
            group[0],
        )
        for conn in group:
            if conn.id == survivor.id:
                continue
            await merge_connection_into(
                session, tenant_id, conn, survivor, take_credentials=False
            )
            folded += 1
        if survivor.instance_key != key:
            survivor.instance_key = key
            session.add(survivor)
    await session.commit()
    if folded:
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action="integration:duplicates_merged",
            actor_type="system",
            resource_type="connection",
            summary=f"Merged {folded} duplicate connection(s) to the same account",
        )
    return folded


async def _resolve_key_live(
    session: AsyncSession, tenant_id: UUID, conn: IntegrationConnection
) -> str:
    if conn.provider == "moneybird":
        from app.services.crypto import get_connection_credentials
        from app.services.moneybird import has_moneybird_credentials, list_administrations

        creds = get_connection_credentials(conn)
        if not has_moneybird_credentials(creds):
            return ""
        try:
            admins = await asyncio.wait_for(list_administrations(creds), timeout=_LIVE_TIMEOUT_S)
        except Exception:  # noqa: BLE001 - offline, slow or expired token: leave unkeyed
            logger.info("moneybird instance key lookup failed for %s", conn.id)
            return ""
        return instance_key_for("moneybird", administrations=admins)
    if conn.provider == "king_accountancy":
        for sid in await _mcp_server_ids(session, tenant_id, conn.id):
            server = await session.get(McpServer, sid)
            if server is not None and server.is_active:
                return instance_key_for(
                    "king_accountancy", auth=_parse_json(server.auth_json)
                )
    return ""


_converged_tenants: set[UUID] = set()


async def converge_once(session: AsyncSession, tenant_id: UUID) -> None:
    """Run ``converge_duplicate_instances`` once per tenant per process."""
    if tenant_id in _converged_tenants:
        return
    _converged_tenants.add(tenant_id)
    try:
        await converge_duplicate_instances(session, tenant_id)
    except Exception:  # noqa: BLE001 - never block a listing on cleanup
        logger.exception("connection instance converge failed for %s", tenant_id)
        await session.rollback()
