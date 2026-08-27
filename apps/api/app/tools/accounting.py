"""Accounting module tools: first-class registry tools over the module router.

Agents call ``accounting_*`` verbs; they never see vendor endpoints or MCP
server names. Reads are ungated (live reads, no mirror). Writes are always
proposals that land as a DecisionRequest in the thread.
"""

from __future__ import annotations

from typing import Any

from app.tools.registry import ToolContext, ToolSpec, register_tool

_COMMON_PROPS: dict[str, Any] = {
    "connection_id": {
        "type": "string",
        "description": "Accounting connection id; only needed when multiple packages are connected.",
    },
    "company_id": {
        "type": "string",
        "description": "Company/administration id from accounting_list_companies. Optional when the tenant has one company.",
    },
}


def _read_handler(verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.accounting.router import call_accounting_verb

        return await call_accounting_verb(ctx.session, ctx.tenant_id, verb, tool_input)

    return handler


def _propose_handler(verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.accounting.router import build_proposal
        from app.tools.builtin import _create_decision_request

        proposal = build_proposal(verb, tool_input)
        if proposal is None:
            return {"error": f"Unknown accounting proposal: {verb}"}
        result = await _create_decision_request(
            ctx,
            {
                **proposal,
                "signal_id": tool_input.get("signal_id"),
            },
        )
        return {
            **result,
            "note": (
                "Proposal recorded as a decision. Nothing is written to the "
                "accounting package until a human approves and applies it."
            ),
        }

    return handler


def _register_read(verb: str, description: str, extra_props: dict[str, Any] | None = None) -> None:
    register_tool(
        ToolSpec(
            name=f"accounting_{verb}",
            description=description,
            category="integrations",
            input_schema={
                "type": "object",
                "properties": {**_COMMON_PROPS, **(extra_props or {})},
            },
            handler=_read_handler(verb),
            mutating=False,
            gated=False,
        )
    )


_register_read(
    "list_companies",
    "List companies/administrations across all connected accounting packages. "
    "Start here; it returns company_id and connection_id values for other accounting tools.",
)
_register_read(
    "get_company",
    "Fetch details for one company/administration.",
)
_register_read(
    "search_parties",
    "Search customers or suppliers by name, number, or email in one company.",
    {
        "query": {"type": "string"},
        "role": {"type": "string", "enum": ["customer", "supplier"]},
    },
)
_register_read(
    "get_party",
    "Fetch one customer or supplier with contact and balance details.",
    {
        "party_id": {"type": "string"},
        "role": {"type": "string", "enum": ["customer", "supplier"]},
    },
)
_register_read(
    "list_documents",
    "List accounting documents (sales invoices or purchase bills) for one company.",
    {
        "kind": {"type": "string", "enum": ["sales_invoice", "purchase_bill"]},
        "status": {"type": "string", "description": "Optional status filter, e.g. open, paid, late."},
        "from_date": {"type": "string", "description": "YYYY-MM-DD"},
        "to_date": {"type": "string", "description": "YYYY-MM-DD"},
    },
)
_register_read(
    "get_document",
    "Fetch a single accounting document with its lines and payment status.",
    {"document_id": {"type": "string"}},
)
_register_read(
    "list_accounts",
    "List ledger accounts from the chart of accounts.",
)
_register_read(
    "get_account",
    "Fetch one ledger account with its balance where the package provides it.",
    {"account_id": {"type": "string"}},
)
_register_read(
    "list_ledger",
    "List journal/general-ledger lines. Some packages only expose recent bookings.",
)
_register_read(
    "list_outstanding",
    "List outstanding receivables (open and overdue sales invoices).",
)
_register_read(
    "list_bank_mutations",
    "List bank mutations (read-only) where the package supports it.",
)
_register_read(
    "summarize",
    "Composite accounting overview for one company: outstanding, recent documents, ledger tail. "
    "Sections the package cannot serve are omitted.",
)


_PROPOSALS: dict[str, str] = {
    "propose_document": (
        "Propose creating an accounting document (e.g. a sales invoice draft). "
        "Creates a decision for the human; never writes directly."
    ),
    "propose_party": (
        "Propose creating a customer or supplier in the accounting package. "
        "Creates a decision for the human; never writes directly."
    ),
    "propose_booking": (
        "Propose a journal booking. Creates a decision for the human; never writes directly."
    ),
    "propose_match": (
        "Propose matching a bank mutation to a document. "
        "Creates a decision for the human; never writes directly."
    ),
    "propose_send": (
        "Propose sending an accounting document (e.g. invoice or reminder) to the party. "
        "Creates a decision for the human; never writes directly."
    ),
}

for _verb, _description in _PROPOSALS.items():
    register_tool(
        ToolSpec(
            name=f"accounting_{_verb}",
            description=_description,
            category="integrations",
            input_schema={
                "type": "object",
                "properties": {
                    **_COMMON_PROPS,
                    "title": {"type": "string", "description": "Short human title for the decision."},
                    "summary": {"type": "string", "description": "What should change and why."},
                    "payload": {"type": "object", "description": "Structured details of the proposed write."},
                    "signal_id": {"type": "string"},
                },
                "required": ["summary"],
            },
            handler=_propose_handler(_verb),
            gated=False,
        )
    )
