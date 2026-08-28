"""Accounting module router.

Resolves the tenant's accounting connections (KING, Björn Lundén, Moneybird),
routes a module verb to the right adapter, enforces the capability matrix,
and falls back to normalized mocks in development when credentials are
missing. Writes never happen here: ``build_proposal`` shapes a
DecisionRequest payload and the human approves in the thread.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.accounting import mock as accounting_mock
from app.modules.accounting.adapters import bjorn_lunden as bl_adapter
from app.modules.accounting.adapters import king as king_adapter
from app.modules.accounting.adapters import moneybird as mb_adapter
from app.modules.accounting.capabilities import capability_for_verb, vendor_supports
from app.modules.accounting.schema import module_error, ok_result, unsupported

VENDOR_LABELS = {
    "king": "KING Accountancy",
    "bjorn_lunden": "Björn Lundén",
    "moneybird": "Moneybird",
}

PROPOSE_VERBS = (
    "propose_document",
    "propose_party",
    "propose_booking",
    "propose_match",
    "propose_send",
)


@dataclass
class AccountingConnection:
    id: str
    vendor: str  # king | bjorn_lunden | moneybird
    name: str
    auth: dict[str, Any] = field(default_factory=dict)
    has_credentials: bool = False


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def list_accounting_connections(
    session: AsyncSession, tenant_id: UUID
) -> list[AccountingConnection]:
    """Discover active accounting connections across storage models.

    KING and Björn Lundén live as native ``McpServer`` rows; Moneybird lives
    directly on ``IntegrationConnection`` (OAuth tokens / personal token).
    """
    from app.models.integration import IntegrationConnection, McpServer

    connections: list[AccountingConnection] = []

    servers = (
        (
            await session.execute(
                select(McpServer).where(
                    McpServer.tenant_id == tenant_id, McpServer.is_active.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    for server in servers:
        auth = _parse_json(server.auth_json)
        if server.server_url.startswith("native://king-accountancy"):
            from app.services.king_finance import has_king_credentials

            connections.append(
                AccountingConnection(
                    id=str(server.id),
                    vendor="king",
                    name=server.name,
                    auth=auth,
                    has_credentials=has_king_credentials(auth),
                )
            )
        elif server.server_url.startswith("native://bjorn-lunden") or (
            server.server_url.startswith("native://")
            and not server.server_url.startswith("native://moneybird")
        ):
            from app.services.bjorn_lunden import has_bl_credentials

            connections.append(
                AccountingConnection(
                    id=str(server.id),
                    vendor="bjorn_lunden",
                    name=server.name,
                    auth=auth,
                    has_credentials=has_bl_credentials(auth),
                )
            )

    integration_rows = (
        (
            await session.execute(
                select(IntegrationConnection).where(
                    IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.provider == "moneybird",
                    IntegrationConnection.status == "active",
                )
            )
        )
        .scalars()
        .all()
    )
    for conn in integration_rows:
        from app.services.moneybird import has_moneybird_credentials

        credentials = _parse_json(conn.credentials_json)
        connections.append(
            AccountingConnection(
                id=str(conn.id),
                vendor="moneybird",
                name=conn.display_name or "Moneybird",
                auth=credentials,
                has_credentials=has_moneybird_credentials(credentials),
            )
        )

    return connections


async def _dispatch(
    conn: AccountingConnection, verb: str, args: dict[str, Any]
) -> dict[str, Any]:
    if not conn.has_credentials and not get_settings().is_production:
        return accounting_mock.mock_verb(conn.vendor, conn.id, verb, args)
    if conn.vendor == "king":
        return await king_adapter.call(conn.auth, conn.id, verb, args)
    if conn.vendor == "bjorn_lunden":
        return await bl_adapter.call(conn.auth, conn.id, verb, args)
    if conn.vendor == "moneybird":
        return await mb_adapter.call(conn.auth, conn.id, verb, args)
    return module_error("unknown_vendor", f"Unknown accounting vendor: {conn.vendor}")


async def _default_company_id(conn: AccountingConnection) -> str | None:
    """When the connection has exactly one company, use it silently."""
    outcome = await _dispatch(conn, "list_companies", {})
    companies = outcome.get("companies") if isinstance(outcome, dict) else None
    if isinstance(companies, list) and len(companies) == 1:
        return str(companies[0].get("id") or "") or None
    return None


def _resolve_connection(
    connections: list[AccountingConnection], args: dict[str, Any]
) -> AccountingConnection | dict[str, Any]:
    requested = str(args.get("connection_id") or "").strip()
    if requested:
        match = next((c for c in connections if c.id == requested), None)
        if match is None:
            return module_error(
                "unknown_connection", f"No accounting connection with id {requested}."
            )
        return match
    if len(connections) == 1:
        return connections[0]
    return module_error(
        "ambiguous_connection",
        "Multiple accounting connections are active. Call accounting_list_companies "
        "first and pass connection_id.",
    )


async def call_accounting_verb(
    session: AsyncSession, tenant_id: UUID, verb: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Execute one read verb against the right adapter with normalized output."""
    args = dict(args or {})
    from app.modules.catalog import module_is_on

    if not await module_is_on(session, tenant_id, "accounting"):
        return module_error(
            "module_off",
            "Accounting is off. Turn it on at /settings/modules/accounting "
            "before agents use accounting tools.",
        )
    connections = await list_accounting_connections(session, tenant_id)
    if not connections:
        return module_error(
            "no_connection",
            "No accounting package is connected. Open /settings/modules/accounting "
            "and connect KING Accountancy, Bjorn Lunden, or Moneybird.",
        )

    if verb == "list_companies":
        companies: list[dict[str, Any]] = []
        errors: list[str] = []
        for conn in connections:
            outcome = await _dispatch(conn, verb, args)
            if outcome.get("ok"):
                companies.extend(outcome.get("companies") or [])
            elif outcome.get("message"):
                errors.append(f"{VENDOR_LABELS.get(conn.vendor, conn.vendor)}: {outcome['message']}")
        result = ok_result(
            companies=companies,
            connections=[
                {
                    "connection_id": c.id,
                    "vendor": c.vendor,
                    "name": c.name,
                    "ready": c.has_credentials,
                }
                for c in connections
            ],
        )
        if errors:
            result["errors"] = errors
        return result

    resolved = _resolve_connection(connections, args)
    if isinstance(resolved, dict):
        return resolved
    conn = resolved

    capability = capability_for_verb(verb)
    if capability and not vendor_supports(conn.vendor, capability):
        return unsupported(capability, VENDOR_LABELS.get(conn.vendor, conn.vendor))

    if verb == "summarize":
        return await _summarize(conn, args)

    if not str(args.get("company_id") or "").strip():
        default = await _default_company_id(conn)
        if default:
            args["company_id"] = default

    return await _dispatch(conn, verb, args)


async def _summarize(conn: AccountingConnection, args: dict[str, Any]) -> dict[str, Any]:
    """Composite overview: companies, outstanding, recent documents, ledger tail.

    Degrades per capability: unsupported sections are simply omitted.
    """
    summary: dict[str, Any] = ok_result(
        vendor=conn.vendor,
        connection_id=conn.id,
        connection_name=conn.name,
    )
    companies_outcome = await _dispatch(conn, "list_companies", {})
    companies = companies_outcome.get("companies") or []
    summary["companies"] = companies

    company_id = str(args.get("company_id") or "").strip()
    if not company_id and len(companies) == 1:
        company_id = str(companies[0].get("id") or "")
    if not company_id:
        summary["note"] = "Pass company_id for outstanding, documents, and ledger details."
        return summary
    summary["company_id"] = company_id

    scoped = {"company_id": company_id}
    for section, verb in (
        ("outstanding", "list_outstanding"),
        ("documents", "list_documents"),
        ("ledger", "list_ledger"),
    ):
        capability = capability_for_verb(verb)
        if capability and not vendor_supports(conn.vendor, capability):
            continue
        outcome = await _dispatch(conn, verb, scoped)
        if outcome.get("ok"):
            value = outcome.get(section)
            if isinstance(value, list):
                summary[section] = value[:10]
    return summary


def build_proposal(verb: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """Shape a DecisionRequest payload for one accounting write proposal.

    The approved decision documents the intended change; no silent write
    happens (vendor write execution is a later slice).
    """
    if verb not in PROPOSE_VERBS:
        return None
    kind = verb.removeprefix("propose_")
    titles = {
        "document": "Create accounting document",
        "party": "Create accounting contact",
        "booking": "Create journal booking",
        "match": "Match bank mutation to document",
        "send": "Send accounting document",
    }
    description = str(args.get("summary") or args.get("description") or "").strip()
    payload = {k: v for k, v in args.items() if k not in ("summary", "description")}
    return {
        "title": str(args.get("title") or titles.get(kind, f"Accounting {kind}")),
        "summary": description
        or f"Proposed accounting write ({kind}). Review the payload and approve to record the decision.",
        "options": [
            {"id": "approve", "label": "Approve", "action_type": "approve", "payload": payload},
            {"id": "reject", "label": "Reject", "action_type": "reject"},
        ],
    }
