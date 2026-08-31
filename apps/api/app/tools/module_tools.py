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


def _register_card(slug: str, card: ModuleToolCard) -> None:
    name = f"{slug}_{card.verb}"
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
            )
        )


for _module in MODULES:
    for _card in (*_module.tool_cards, *_module.apply_cards):
        _register_card(_module.slug, _card)
