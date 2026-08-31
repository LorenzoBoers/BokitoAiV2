"""Accounting connection hook for the generic module Connections tab.

``app.services.module_connections`` discovers this module by convention
(``app.modules.{slug}.connections.list_rows``). Vendor-specific credential
parsing and identity extraction live here, next to the adapters, instead of
in shared code.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.modules.accounting.router import (
    call_accounting_verb,
    list_accounting_connections,
)


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def snapshot_rows(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Cheap connection names for the tenant snapshot (no live vendor calls)."""
    rows = await list_accounting_connections(session, tenant_id)
    return [
        {"name": conn.name, "vendor": conn.vendor}
        for conn in rows
    ]


async def list_rows(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Raw connection rows: id, vendor, credentials state, identity, companies."""
    rows = await list_accounting_connections(session, tenant_id)
    companies_outcome = await call_accounting_verb(session, tenant_id, "list_companies")
    companies_by_conn: dict[str, list[dict[str, Any]]] = {}
    for company in companies_outcome.get("companies") or []:
        if not isinstance(company, dict):
            continue
        cid = str(company.get("connection_id") or "")
        if cid:
            companies_by_conn.setdefault(cid, []).append(company)

    out: list[dict[str, Any]] = []
    for conn in rows:
        meta = dict(conn.auth)
        identity_fallback = None
        if conn.vendor == "king":
            from app.services.king_finance import parse_administraties

            admins = parse_administraties(conn.auth)
            if admins:
                identity_fallback = admins[0].get("name") or admins[0].get("omgevingscode")
        elif conn.vendor == "bjorn_lunden":
            from app.services.bjorn_lunden import parse_bl_credentials

            creds = parse_bl_credentials(conn.auth)
            identity_fallback = creds.get("user_key") or creds.get("client_id") or None
        elif conn.vendor == "moneybird":
            # Moneybird meta lives on IntegrationConnection.metadata_json.
            ic = await session.get(IntegrationConnection, UUID(conn.id))
            if ic is not None:
                meta = {**_parse_json(ic.metadata_json), **meta}
                identity_fallback = str(meta.get("email") or meta.get("identity") or "") or None
        out.append(
            {
                "id": conn.id,
                "kind": "mcp" if conn.vendor in ("king", "bjorn_lunden") else "oauth",
                "provider": conn.vendor,
                "vendor": conn.vendor,
                "display_name": conn.name,
                "has_credentials": conn.has_credentials,
                "meta": meta,
                "identity_fallback": identity_fallback,
                "companies": companies_by_conn.get(conn.id, []),
            }
        )
    return out


def verify_identity(server_url: str, auth: dict[str, Any]) -> str | None:
    """Identity string for a native MCP registration during live verify."""
    if server_url.startswith("native://king-accountancy"):
        from app.services.king_finance import parse_administraties

        admins = parse_administraties(auth)
        if admins:
            return admins[0].get("name") or admins[0].get("omgevingscode")
        return None
    from app.services.bjorn_lunden import parse_bl_credentials

    creds = parse_bl_credentials(auth)
    return creds.get("user_key") or creds.get("client_id") or None
