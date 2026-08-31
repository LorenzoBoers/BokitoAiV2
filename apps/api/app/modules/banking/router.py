"""Banking module provider: the proof that the module backbone is generic.

Read-only PSD2 reads through GoCardless Bank Account Data. The module gate,
roster enforcement, connection resolution, and mock fallback follow the same
contract as accounting — but this provider was written without touching any
shared code: the catalog spec + this package is the whole module.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.accounting.schema import module_error
from app.modules.banking import mock as banking_mock
from app.modules.banking.adapters import gocardless

READ_VERBS = ("list_accounts", "get_balance", "list_transactions")


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def call_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    args = dict(args or {})
    from app.modules.catalog import active_module_connections, module_is_on

    if not await module_is_on(session, tenant_id, "banking"):
        return module_error(
            "module_off",
            "Banking is off. Turn it on at /modules/banking before agents "
            "use banking tools.",
        )

    if agent_id is not None:
        from app.services.module_agents import module_agent_access

        access = await module_agent_access(session, tenant_id, agent_id, "banking")
        if access is None:
            return module_error(
                "agent_forbidden",
                "This agent is not on the banking module roster. An operator "
                "can add it under Modules > Banking > Agents.",
            )

    if verb not in READ_VERBS:
        return module_error(
            "unsupported",
            f"Banking verb {verb} is not available; this module is read-only "
            "(payments only ship as proposals).",
        )

    connections = await active_module_connections(session, tenant_id, "banking")
    if not connections:
        return module_error(
            "no_connection",
            "No bank connection is registered. Open /modules/banking and "
            "connect a PSD2 provider.",
        )

    requested = str(args.get("connection_id") or "").strip()
    conn = None
    if requested:
        conn = next((c for c in connections if str(c.id) == requested), None)
        if conn is None:
            return module_error(
                "unknown_connection", f"No banking connection with id {requested}."
            )
    elif len(connections) == 1:
        conn = connections[0]
    else:
        return module_error(
            "ambiguous_connection",
            "Multiple bank connections are active. Pass connection_id or set "
            "a default under Modules > Banking.",
        )

    creds = _parse_json(conn.credentials_json)
    if not gocardless.has_gocardless_credentials(creds):
        if get_settings().is_production:
            return module_error(
                "no_credentials",
                "The bank connection has no usable credentials. Reconnect it "
                "under Modules > Banking.",
            )
        return banking_mock.mock_verb(str(conn.id), verb, args)
    return await gocardless.call(creds, str(conn.id), verb, args)
