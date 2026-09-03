"""Accounting module router.

Resolves the tenant's accounting connections (KING, Björn Lundén, Moneybird),
routes a module verb to the right adapter, enforces the capability matrix,
and falls back to normalized mocks in development when credentials are
missing.

Writes: ``build_proposal`` shapes a DecisionRequest whose approve option is
the matching ``accounting_apply_*`` tool. Apply verbs run here only after
human approval and only when both write switches are on (``accounting`` in
the ``MODULE_WRITES_ENABLED`` env + the tenant's ModuleInstall
``writes_enabled`` pref); otherwise they return a ``writes_disabled`` error.
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
from app.modules.accounting.schema import (
    WRITE_PAYLOADS,
    module_error,
    ok_result,
    unsupported,
)

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

# Apply verbs execute an approved write through the vendor adapter. They are
# only reachable via an approved DecisionRequest (accounting_apply_* tools)
# and are guarded by the platform + tenant write switches.
APPLY_VERBS = (
    "apply_party",
    "apply_booking",
    "apply_document",
    "apply_payment",
)

# propose kind -> apply verb/tool used when the human approves.
PROPOSE_TO_APPLY = {
    "party": "apply_party",
    "booking": "apply_booking",
    "document": "apply_document",
}


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
    from app.services.module_attach import attached_connection_ids, attached_mcp_server_ids

    attached_ics = await attached_connection_ids(session, tenant_id, "accounting")
    attached_servers = await attached_mcp_server_ids(session, tenant_id, "accounting")

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
        if str(server.id) not in attached_servers:
            continue
        auth = _parse_json(server.auth_json)
        from app.services.partner_mcp import is_king_mcp_url

        if is_king_mcp_url(server.server_url):
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
            and not server.server_url.startswith("native://king-accountancy")
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
        if str(conn.id) not in attached_ics:
            continue
        from app.services.moneybird import has_moneybird_credentials

        from app.services.crypto import get_connection_credentials
        credentials = get_connection_credentials(conn)
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
    connections: list[AccountingConnection],
    args: dict[str, Any],
    *,
    default_connection_id: str | None = None,
) -> AccountingConnection | dict[str, Any]:
    requested = str(args.get("connection_id") or "").strip() or (
        str(default_connection_id or "").strip()
    )
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
        "first and pass connection_id, or set a default connection under Modules.",
    )


async def call_accounting_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    """Execute one module verb against the right adapter with normalized output.

    ``agent_id`` enables per-agent enforcement: roster membership, company
    scope, and write access from the ModuleAgent row.
    """
    args = dict(args or {})
    from app.modules.catalog import module_is_on

    if not await module_is_on(session, tenant_id, "accounting"):
        return module_error(
            "module_off",
            "Accounting is off. Turn it on at /connections/accounting "
            "before agents use accounting tools.",
        )

    company_scope: list[str] | None = None
    if agent_id is not None:
        from app.services.module_agents import module_agent_access, parse_company_scope

        access = await module_agent_access(session, tenant_id, agent_id, "accounting")
        if access is None:
            return module_error(
                "agent_forbidden",
                "This agent is not on the accounting module roster. An operator "
                "can add it under Modules > Accounting > Agents.",
            )
        company_scope = parse_company_scope(access)
        if verb in APPLY_VERBS and not access.can_write:
            return module_error(
                "write_forbidden",
                "This agent has read-only access to accounting. An operator can "
                "grant write access under Modules > Accounting > Agents.",
            )

    connections = await list_accounting_connections(session, tenant_id)
    if not connections:
        return module_error(
            "no_connection",
            "No accounting package is connected. Open /connections/accounting "
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
        if company_scope is not None:
            companies = [c for c in companies if str(c.get("id") or "") in company_scope]
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

    from app.modules.catalog import get_module_prefs

    prefs = await get_module_prefs(session, tenant_id, "accounting")
    default_connection_id = str(prefs.get("default_connection_id") or "").strip() or None
    resolved = _resolve_connection(
        connections, args, default_connection_id=default_connection_id
    )
    if isinstance(resolved, dict):
        return resolved
    conn = resolved

    capability = capability_for_verb(verb)
    if capability and not vendor_supports(conn.vendor, capability):
        return unsupported(capability, VENDOR_LABELS.get(conn.vendor, conn.vendor))

    if verb in APPLY_VERBS:
        gate = await writes_gate(session, tenant_id)
        if gate is not None:
            return gate
        payload_model = WRITE_PAYLOADS.get(verb)
        if payload_model is not None:
            payload_fields = {
                k: v for k, v in args.items() if k in payload_model.model_fields
            }
            try:
                validated = payload_model(**payload_fields)
            except Exception as exc:
                return module_error("invalid_payload", f"Invalid {verb} payload: {exc}")
            args = {**args, **validated.model_dump()}

    if verb == "summarize":
        requested = str(args.get("company_id") or "").strip()
        if company_scope is not None:
            if requested and requested not in company_scope:
                return _company_forbidden(requested)
            if not requested and len(company_scope) == 1:
                args["company_id"] = company_scope[0]
        return await _summarize(conn, args, company_scope=company_scope)

    if not str(args.get("company_id") or "").strip():
        company_map = prefs.get("default_company_by_connection")
        if isinstance(company_map, dict):
            preferred = str(company_map.get(conn.id) or "").strip()
            if preferred:
                args["company_id"] = preferred
        if not str(args.get("company_id") or "").strip():
            if company_scope is not None and len(company_scope) == 1:
                args["company_id"] = company_scope[0]
            else:
                default = await _default_company_id(conn)
                if default:
                    args["company_id"] = default

    company_id = str(args.get("company_id") or "").strip()
    if company_scope is not None and company_id and company_id not in company_scope:
        return _company_forbidden(company_id)

    return await _dispatch(conn, verb, args)


def _company_forbidden(company_id: str) -> dict[str, Any]:
    return module_error(
        "company_forbidden",
        f"This agent is not allowed to access administration {company_id}. "
        "Its accounting scope is limited; ask an operator to widen it under "
        "Modules > Accounting > Agents.",
    )


async def _summarize(
    conn: AccountingConnection,
    args: dict[str, Any],
    *,
    company_scope: list[str] | None = None,
) -> dict[str, Any]:
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
    if company_scope is not None:
        companies = [c for c in companies if str(c.get("id") or "") in company_scope]
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


async def writes_gate(session: AsyncSession, tenant_id: UUID) -> dict[str, Any] | None:
    """Both write switches (platform env + tenant ModuleInstall pref) must be on."""
    from app.modules.dispatch import module_writes_gate

    return await module_writes_gate(session, tenant_id, "accounting")


# Generic dispatch entry point (app.modules.dispatch imports by convention).
async def call_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    return await call_accounting_verb(session, tenant_id, verb, args, agent_id=agent_id)


def build_proposal(verb: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """Shape a DecisionRequest payload for one accounting write proposal.

    Approve options point at the registered ``accounting_apply_*`` tool for
    that write kind, so resolve_decision executes it (behind the write
    switches). Kinds without an apply path (match, send) resolve as a
    recorded human decision only.
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
    inner = payload.pop("payload", None)
    if isinstance(inner, dict):
        # Flatten the structured write details next to connection/company ids
        # so the apply tool receives one flat payload.
        payload = {**inner, **payload}
    apply_verb = PROPOSE_TO_APPLY.get(kind)
    approve_action = f"accounting_{apply_verb}" if apply_verb else "approve"
    return {
        "title": str(args.get("title") or titles.get(kind, f"Accounting {kind}")),
        "summary": description
        or f"Proposed accounting write ({kind}). Review the payload and approve to apply it.",
        "options": [
            {
                "id": "approve",
                "label": "Approve",
                "action_type": approve_action,
                "payload": payload,
            },
            {"id": "reject", "label": "Reject", "action_type": "reject"},
        ],
    }
