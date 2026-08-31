"""Accounting module tools: first-class registry tools over the module router.

Agents call ``accounting_*`` verbs; they never see vendor endpoints or MCP
server names. Reads are ungated (live reads, no mirror). Writes are always
proposals that land as a DecisionRequest in the thread; on approve the
matching ``accounting_apply_*`` tool executes the write through the vendor
adapter — behind the platform + tenant write switches (default off).
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


def _agent_id(ctx: ToolContext):
    return ctx.agent.id if ctx.agent is not None else None


def _read_handler(verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.accounting.router import call_accounting_verb

        return await call_accounting_verb(
            ctx.session, ctx.tenant_id, verb, tool_input, agent_id=_agent_id(ctx)
        )

    return handler


async def _company_label(ctx: ToolContext, tool_input: dict[str, Any]) -> str:
    """Readable administration name for the decision card; empty on any miss."""
    from app.modules.accounting.router import call_accounting_verb

    company_id = str(tool_input.get("company_id") or "").strip()
    if not company_id:
        return ""
    try:
        outcome = await call_accounting_verb(
            ctx.session,
            ctx.tenant_id,
            "list_companies",
            {k: tool_input[k] for k in ("connection_id",) if tool_input.get(k)},
            agent_id=_agent_id(ctx),
        )
    except Exception:
        return ""
    for company in outcome.get("companies") or []:
        if isinstance(company, dict) and str(company.get("id")) == company_id:
            return str(company.get("name") or "").strip()
    return ""


def _propose_handler(verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.accounting.router import build_proposal
        from app.tools.builtin import _create_decision_request

        if not tool_input.get("company_label"):
            label = await _company_label(ctx, tool_input)
            if label:
                tool_input = {**tool_input, "company_label": label}
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


def _apply_handler(verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.accounting.router import call_accounting_verb

        return await call_accounting_verb(
            ctx.session, ctx.tenant_id, verb, tool_input, agent_id=_agent_id(ctx)
        )

    return handler


# Apply tools execute the approved write. They are gated + mutating: a direct
# agent call escalates to a decision; resolve_decision runs them with
# approved=True after a human approves the matching proposal. The router
# additionally enforces the platform + tenant write switches.
_APPLIES: dict[str, tuple[str, dict[str, Any]]] = {
    "apply_party": (
        "Create or update a customer/supplier in the connected accounting package. "
        "Only runs after human approval; blocked while accounting writes are disabled.",
        {
            "role": {"type": "string", "enum": ["customer", "supplier"]},
            "party_id": {"type": "string", "description": "Empty to create; set to update."},
            "name": {"type": "string"},
            "email": {"type": "string"},
            "phone": {"type": "string"},
            "street": {"type": "string"},
            "postal_code": {"type": "string"},
            "city": {"type": "string"},
            "country": {"type": "string"},
        },
    ),
    "apply_booking": (
        "Create a journal booking in the connected accounting package. "
        "Only runs after human approval; blocked while accounting writes are disabled.",
        {
            "journal": {"type": "string", "description": "Journal/dagboek code."},
            "date": {"type": "string", "description": "YYYY-MM-DD"},
            "description": {"type": "string"},
            "reference": {"type": "string"},
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "account": {"type": "string"},
                        "description": {"type": "string"},
                        "debit": {"type": "number"},
                        "credit": {"type": "number"},
                        "tax_code": {"type": "string"},
                    },
                    "required": ["account"],
                },
            },
        },
    ),
}

for _verb, (_description, _props) in _APPLIES.items():
    register_tool(
        ToolSpec(
            name=f"accounting_{_verb}",
            description=_description,
            category="integrations",
            input_schema={
                "type": "object",
                "properties": {**_COMMON_PROPS, **_props},
            },
            handler=_apply_handler(_verb),
            mutating=True,
            gated=True,
        )
    )
