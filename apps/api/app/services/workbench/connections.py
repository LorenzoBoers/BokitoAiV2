"""CRUD for workbench IntegrationConnection rows (kind=workbench)."""

from __future__ import annotations

import json
import secrets
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.services.crypto import get_connection_credentials, set_connection_credentials
from app.services.workbench.capabilities import PHASE1_PROVIDERS, PROVIDER_LABELS, matrix_rows
from app.services.workbench.http_util import WorkbenchHttpError

PROVIDER_CRED_FIELDS = {
    "cursor": ("api_key",),
    "claude_managed": ("api_key",),
    "devin": ("api_key", "org_id"),
}


def serialize_connection(conn: IntegrationConnection) -> dict[str, Any]:
    meta = {}
    try:
        meta = json.loads(conn.metadata_json or "{}")
    except (json.JSONDecodeError, TypeError):
        meta = {}
    creds = get_connection_credentials(conn)
    return {
        "id": str(conn.id),
        "provider": conn.provider,
        "label": PROVIDER_LABELS.get(conn.provider, conn.display_name or conn.provider),
        "display_name": conn.display_name,
        "status": conn.status,
        "has_credentials": bool(creds.get("api_key") or creds.get("token")),
        "metadata": {
            k: v
            for k, v in (meta if isinstance(meta, dict) else {}).items()
            if k
            not in (
                "api_key",
                "token",
                "webhook_secret",
                "git_token",
                "github_token",
            )
        },
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
    }


async def list_connections(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.kind == "workbench",
            )
            .order_by(IntegrationConnection.created_at.desc())
        )
    ).scalars().all()
    return [serialize_connection(r) for r in rows]


async def upsert_connection(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    provider: str,
    api_key: str,
    display_name: str = "",
    metadata: dict[str, Any] | None = None,
    git_token: str | None = None,
) -> IntegrationConnection:
    if provider not in PHASE1_PROVIDERS:
        raise WorkbenchHttpError(f"Provider {provider} is not available yet")
    api_key = (api_key or "").strip()
    if not api_key:
        raise WorkbenchHttpError("api_key is required")

    meta = dict(metadata or {})
    if provider == "devin":
        org_id = str(meta.get("org_id") or meta.get("organization_id") or "").strip()
        if not org_id:
            raise WorkbenchHttpError("Devin requires org_id")
        meta["org_id"] = org_id

    existing = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.kind == "workbench",
                IntegrationConnection.provider == provider,
            )
        )
    ).scalar_one_or_none()

    creds: dict[str, Any] = {"api_key": api_key}
    if provider == "devin":
        creds["org_id"] = meta["org_id"]
    if git_token:
        creds["git_token"] = git_token.strip()
    if existing:
        old = get_connection_credentials(existing)
        if old.get("webhook_secret"):
            creds["webhook_secret"] = old["webhook_secret"]
        else:
            creds["webhook_secret"] = secrets.token_urlsafe(24)
        set_connection_credentials(existing, creds)
        existing.display_name = display_name or existing.display_name or PROVIDER_LABELS.get(provider, provider)
        existing.status = "active"
        # Merge metadata (non-secret).
        old_meta = {}
        try:
            old_meta = json.loads(existing.metadata_json or "{}")
        except (json.JSONDecodeError, TypeError):
            old_meta = {}
        if not isinstance(old_meta, dict):
            old_meta = {}
        old_meta.update({k: v for k, v in meta.items() if v is not None})
        old_meta["api_version"] = _api_version(provider)
        existing.metadata_json = json.dumps(old_meta)
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing

    creds["webhook_secret"] = secrets.token_urlsafe(24)
    meta["api_version"] = _api_version(provider)
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        kind="workbench",
        provider=provider,
        display_name=display_name or PROVIDER_LABELS.get(provider, provider),
        status="active",
        metadata_json=json.dumps(meta),
    )
    set_connection_credentials(conn, creds)
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def delete_connection(session: AsyncSession, tenant_id: UUID, connection_id: UUID) -> None:
    conn = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == connection_id,
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.kind == "workbench",
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise WorkbenchHttpError("Connection not found")
    conn.status = "revoked"
    set_connection_credentials(conn, {})
    session.add(conn)
    await session.commit()


def catalog() -> list[dict[str, Any]]:
    return matrix_rows()


def _api_version(provider: str) -> str:
    from app.services.workbench import get_adapter

    adapter = get_adapter(provider)
    return getattr(adapter, "api_version", "") if adapter else ""
