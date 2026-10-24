"""Accountant verbs: workpapers and decisions. No ledger writes."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounting.schema import module_error
from app.modules.accountant.review import (
    dossier_items,
    engagement,
    estimates,
    filing_calendar,
    plausibility,
    size_class,
    statements_outline,
    tax_bridge,
    tie_outs,
)

_READS = {
    "engagement": engagement,
    "size_class": size_class,
    "filing_calendar": filing_calendar,
    "tie_outs": tie_outs,
    "estimates": estimates,
    "tax_bridge": tax_bridge,
    "statements_outline": statements_outline,
    "plausibility": plausibility,
}

_PROPOSE_TITLES = {
    "findings": "Year-file findings",
    "appropriation": "Profit appropriation",
    "compilation": "Compilation pack ready for a registered accountant",
    "dossier": "Year-file documents still missing",
}


async def call_verb(
    session: AsyncSession,
    tenant_id: UUID,
    verb: str,
    args: dict[str, Any] | None = None,
    *,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    """Run one accountant read. Propose verbs never reach this function."""
    del project_id
    from app.modules.catalog import module_is_on

    if not await module_is_on(session, tenant_id, "accountant"):
        return module_error(
            "module_off",
            "Accountant is off. Turn it on at /connections/accountant "
            "before agents use accountant tools.",
        )
    if agent_id is not None:
        from app.services.module_agents import agent_has_module

        if not await agent_has_module(session, tenant_id, agent_id, "accountant"):
            return module_error(
                "agent_forbidden",
                "This agent is not in the accountant department. Ask its point of "
                "contact, or add the agent to that department.",
            )
    handler = _READS.get(verb)
    if handler is None:
        return module_error("unknown_verb", f"Unknown accountant verb '{verb}'.")
    try:
        return handler(dict(args or {}))
    except ValueError as exc:
        return module_error("invalid_input", str(exc))


def build_proposal(verb: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """Decision card. Approving records the operator's review. Nothing is filed or signed."""
    if not verb.startswith("propose_") and verb != "request_dossier":
        return None
    kind = "dossier" if verb == "request_dossier" else verb.removeprefix("propose_")
    if kind not in _PROPOSE_TITLES:
        return None
    summary = str(args.get("summary") or args.get("description") or "").strip()
    if kind == "dossier" and not summary:
        lines = "\n".join(f"- {item}" for item in dossier_items())
        summary = "Documents still needed for the year file:\n" + lines
    if kind == "compilation":
        boundary = (
            "Approving records that the pack is ready for a registered accountant. "
            "Nothing is filed at the Kamer van Koophandel or the Belastingdienst, "
            "and Bokito does not sign a compilation report."
        )
        summary = f"{summary}\n\n{boundary}".strip()
    elif kind == "appropriation":
        boundary = "The general meeting decides the appropriation. This proposal does not book it."
        summary = f"{summary}\n\n{boundary}".strip() if summary else boundary
    elif kind == "findings":
        boundary = "Findings for management. Bookings, if any, stay a separate proposal for Accounting."
        summary = f"{summary}\n\n{boundary}".strip() if summary else boundary
    payload = {
        key: value
        for key, value in args.items()
        if key not in {"summary", "description", "title", "signal_id"}
    }
    inner = payload.pop("payload", None)
    if isinstance(inner, dict):
        payload = {**inner, **payload}
    return {
        "title": str(args.get("title") or _PROPOSE_TITLES[kind]),
        "summary": summary or _PROPOSE_TITLES[kind],
        "options": [
            {
                "id": "approve",
                "label": "Approve",
                "action_type": "approve",
                "payload": payload,
            },
            {"id": "reject", "label": "Reject", "action_type": "reject"},
        ],
    }
