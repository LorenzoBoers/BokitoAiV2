"""Module tools, auto-registered from the module catalog.

Every ``ModuleToolCard`` on every ``ModuleSpec`` becomes a registry tool named
``{slug}_{verb}``; agents never see vendor endpoints or MCP server names.

- read cards: ungated live reads through ``call_module_verb``.
- propose cards: shape a DecisionRequest (via the provider's custom card or a
  generic one); never write directly.
- apply cards: gated + mutating; a direct agent call escalates to a decision,
  resolve_decision executes them after approval. Providers additionally
  enforce the platform + tenant write switches.

Shipping a new module needs zero changes here: add the ModuleSpec and a
provider package (see app/modules/dispatch.py).
"""

from __future__ import annotations

from typing import Any

from app.modules.catalog import MODULES, ModuleToolCard
from app.tools.registry import ToolContext, ToolSpec, register_tool

_COMMON_PROPS: dict[str, Any] = {
    "connection_id": {
        "type": "string",
        "description": "Module connection id; only needed when multiple packages are connected.",
    },
    "company_id": {
        "type": "string",
        "description": "Company/administration id from the module's list_companies tool. "
        "Optional when the tenant has one company.",
    },
}


def _agent_id(ctx: ToolContext):
    return ctx.agent.id if ctx.agent is not None else None


def _verb_handler(slug: str, verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.dispatch import call_module_verb

        return await call_module_verb(
            ctx.session, ctx.tenant_id, slug, verb, tool_input, agent_id=_agent_id(ctx)
        )

    return handler


async def _company_label(
    ctx: ToolContext, slug: str, tool_input: dict[str, Any]
) -> str:
    """Readable administration name for the decision card; empty on any miss."""
    from app.modules.dispatch import call_module_verb

    company_id = str(tool_input.get("company_id") or "").strip()
    if not company_id:
        return ""
    try:
        outcome = await call_module_verb(
            ctx.session,
            ctx.tenant_id,
            slug,
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


def _propose_handler(slug: str, verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.dispatch import build_module_proposal
        from app.tools.builtin import _create_decision_request

        if not tool_input.get("company_label"):
            label = await _company_label(ctx, slug, tool_input)
            if label:
                tool_input = {**tool_input, "company_label": label}
        proposal = build_module_proposal(slug, verb, tool_input)
        if proposal is None:
            return {"error": f"Unknown {slug} proposal: {verb}"}
        result = await _create_decision_request(
            ctx,
            {**proposal, "signal_id": tool_input.get("signal_id")},
        )
        return {
            **result,
            "note": (
                "Proposal recorded as a decision. Nothing is written to the "
                "connected package until a human approves and applies it."
            ),
        }

    return handler


_PROPOSE_PROPS: dict[str, Any] = {
    "title": {"type": "string", "description": "Short human title for the decision."},
    "summary": {"type": "string", "description": "What should change and why."},
    "payload": {"type": "object", "description": "Structured details of the proposed write."},
    "signal_id": {"type": "string"},
}


def _audience_for_card(card: ModuleToolCard) -> str:
    if card.exposure == "customer":
        return "customer"
    if card.exposure == "both":
        return "both"
    return "operator"


def _customer_read_handler(slug: str, verb: str):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        from app.modules.dispatch import call_module_verb
        from app.services.customer_verify import normalize_email

        email = normalize_email(ctx.assurance_email)
        if not email:
            return {
                "status": "needs_verification",
                "copy": "This conversation is not confirmed yet.",
            }
        try:
            parties_out = await call_module_verb(
                ctx.session,
                ctx.tenant_id,
                slug,
                "search_parties",
                {"query": email, "role": "customer"},
                agent_id=_agent_id(ctx),
            )
        except Exception as exc:
            return {"documents": [], "note": str(exc)}
        parties = parties_out.get("parties") or parties_out.get("items") or []
        party_id = ""
        if isinstance(parties, list):
            for party in parties:
                if not isinstance(party, dict):
                    continue
                party_email = normalize_email(
                    str(party.get("email") or party.get("address") or "")
                )
                if party_email == email:
                    party_id = str(party.get("id") or "")
                    break
        if not party_id:
            return {"documents": []}
        kind = "sales_invoice" if verb == "list_my_invoices" else None
        payload = {**tool_input, "party_id": party_id}
        if kind:
            payload["kind"] = kind
        try:
            docs_out = await call_module_verb(
                ctx.session,
                ctx.tenant_id,
                slug,
                "list_documents",
                payload,
                agent_id=_agent_id(ctx),
            )
        except Exception as exc:
            return {"documents": [], "note": str(exc)}
        documents = docs_out.get("documents") or docs_out.get("items") or []
        if not isinstance(documents, list):
            return {"documents": []}
        scoped = []
        for doc in documents:
            if not isinstance(doc, dict):
                continue
            doc_party = str(doc.get("party_id") or "")
            doc_email = normalize_email(str(doc.get("party_email") or ""))
            if doc_party and doc_party != party_id and doc_email and doc_email != email:
                continue
            if kind and str(doc.get("kind") or "") not in ("", kind):
                continue
            scoped.append(doc)
        return {"documents": scoped}

    return handler


def _register_card(slug: str, card: ModuleToolCard) -> None:
    name = f"{slug}_{card.verb}"
    audience = _audience_for_card(card)
    if card.kind == "read" and card.exposure == "customer":
        register_tool(
            ToolSpec(
                name=name,
                description=card.description,
                category="integrations",
                input_schema={
                    "type": "object",
                    "properties": {**_COMMON_PROPS, **card.input_props},
                },
                handler=_customer_read_handler(slug, card.verb),
                mutating=False,
                gated=True,
                audience=audience,
                min_assurance=card.min_assurance or "verified",
                sensitivity=card.sensitivity,
            )
        )
        return
    if card.kind == "read":
        register_tool(
            ToolSpec(
                name=name,
                description=card.description,
                category="integrations",
                input_schema={
                    "type": "object",
                    "properties": {**_COMMON_PROPS, **card.input_props},
                },
                handler=_verb_handler(slug, card.verb),
                mutating=False,
                gated=False,
                audience=audience,
                min_assurance=card.min_assurance or "none",
                sensitivity=card.sensitivity,
            )
        )
    elif card.kind == "propose":
        register_tool(
            ToolSpec(
                name=name,
                description=card.description,
                category="integrations",
                input_schema={
                    "type": "object",
                    "properties": {**_COMMON_PROPS, **_PROPOSE_PROPS, **card.input_props},
                    "required": list(card.required or ("summary",)),
                },
                handler=_propose_handler(slug, card.verb),
                gated=False,
                audience=audience,
            )
        )
    else:  # apply
        register_tool(
            ToolSpec(
                name=name,
                description=card.description,
                category="integrations",
                input_schema={
                    "type": "object",
                    "properties": {**_COMMON_PROPS, **card.input_props},
                    **({"required": list(card.required)} if card.required else {}),
                },
                handler=_verb_handler(slug, card.verb),
                mutating=True,
                gated=True,
                audience=audience,
            )
        )


for _module in MODULES:
    for _card in (*_module.tool_cards, *_module.apply_cards):
        _register_card(_module.slug, _card)
