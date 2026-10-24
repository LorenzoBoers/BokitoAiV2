"""Investing verbs. Market data waits for a broker. Workpapers do not."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounting.schema import module_error
from app.modules.investing.workpapers import WORKPAPERS

_MARKET = frozenset({"get_positions", "get_quotes", "list_watchlist"})


async def call_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    del project_id
    from app.modules.catalog import module_is_on

    if not await module_is_on(session, tenant_id, "investing"):
        return module_error(
            "module_off",
            "Investing is off. Turn it on at /connections/investing before agents use investing tools.",
        )
    if agent_id is not None:
        from app.services.module_agents import agent_has_module

        if not await agent_has_module(session, tenant_id, agent_id, "investing"):
            return module_error(
                "agent_forbidden",
                "This agent is not in the investing department. Ask its point of contact, or add the agent to that department.",
            )
    handler = WORKPAPERS.get(verb)
    if handler is not None:
        try:
            return handler(dict(args or {}))
        except ValueError as exc:
            return module_error("invalid_input", str(exc))
    if verb in _MARKET:
        return module_error(
            "no_connection",
            "No broker or price feed is connected. Twelve Data, Alpaca, Bitvavo, and TradingView are not live. "
            "Use advice_boundary, order_ticket, and concentration. Do not invent a quote.",
        )
    return module_error("unknown_verb", f"Unknown investing verb '{verb}'.")
