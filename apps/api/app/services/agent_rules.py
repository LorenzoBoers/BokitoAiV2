"""Agent autonomy: the ceiling per agent, exception rules, and certainty per action.

- ``Agent.autonomy_level`` is a ceiling with the AI handling modes
  (manual | assisted | autonomous).
- Rules live in ``Agent.settings_json["rules"]`` (one agent) and in the tenant
  settings ``agent_rules`` (every agent). Each rule:
  ``{id, text, mode, kind, tool, category, created_by, uses, approved, rejected}``.
  ``kind`` is ``hard`` (bound to a tool or tool category) or ``judgement``
  (a sentence the agent weighs; it cites the rule with ``rule_id``).
- A rule that grants ``autonomous`` needs an owner or admin. Consequential
  tools always ask, whatever the rules say.
"""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant

AUTONOMY_MODES = ("manual", "assisted", "autonomous")
LEGACY_AUTONOMY = {"approval": "assisted", "auto": "autonomous"}
RULE_KINDS = ("hard", "judgement")
CERTAINTY_THRESHOLD = 7
META_ARGS = ("certainty", "rule_id")
ADMIN_ROLES = ("owner", "admin")
UNSURE_PROPOSAL_AFTER = 3
_RANK = {"manual": 0, "assisted": 1, "autonomous": 2}


def normalize_autonomy(value: Any) -> str:
    raw = str(value or "").strip().lower()
    raw = LEGACY_AUTONOMY.get(raw, raw)
    return raw if raw in AUTONOMY_MODES else "assisted"


def _json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _clean_rule(raw: dict[str, Any], *, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    text = re.sub(r"\s+", " ", str(raw.get("text") or "")).strip()[:300]
    mode = normalize_autonomy(raw.get("mode"))
    kind = str(raw.get("kind") or "judgement")
    if kind not in RULE_KINDS:
        kind = "judgement"
    tool = str(raw.get("tool") or "").strip()[:80]
    category = str(raw.get("category") or "").strip()[:40]
    if kind == "hard" and not (tool or category):
        raise HTTPException(status_code=422, detail="A hard rule needs a tool or a category")
    if not text:
        raise HTTPException(status_code=422, detail="A rule needs a sentence")
    prev = previous or {}
    return {
        "id": str(raw.get("id") or prev.get("id") or uuid4().hex[:12]),
        "text": text,
        "mode": mode,
        "kind": kind,
        "tool": tool if kind == "hard" else "",
        "category": category if kind == "hard" else "",
        "created_by": str(prev.get("created_by") or raw.get("created_by") or ""),
        "uses": int(prev.get("uses") or 0),
        "approved": int(prev.get("approved") or 0),
        "rejected": int(prev.get("rejected") or 0),
    }


def _parse_rules(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rules = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        try:
            rules.append(_clean_rule(raw, previous=raw))
        except HTTPException:
            continue
    return rules


def agent_rules(agent: Agent | None) -> list[dict[str, Any]]:
    if agent is None:
        return []
    return _parse_rules(_json(agent.settings_json).get("rules"))


def workspace_rules(tenant: Tenant | None) -> list[dict[str, Any]]:
    if tenant is None:
        return []
    return _parse_rules(_json(tenant.settings_json).get("agent_rules"))


def all_rules(tenant: Tenant | None, agent: Agent | None) -> list[dict[str, Any]]:
    """Workspace rules first, then the agent's own; each tagged with its scope."""
    return [{**r, "scope": "workspace"} for r in workspace_rules(tenant)] + [
        {**r, "scope": "agent"} for r in agent_rules(agent)
    ]


def _store(tenant: Tenant, agent: Agent | None, rules: list[dict[str, Any]]) -> None:
    if agent is not None:
        settings = _json(agent.settings_json)
        settings["rules"] = rules
        agent.settings_json = json.dumps(settings)
    else:
        settings = _json(tenant.settings_json)
        settings["agent_rules"] = rules
        tenant.settings_json = json.dumps(settings)


def check_can_grant(rule: dict[str, Any], previous: dict[str, Any] | None, role: str | None) -> None:
    """Raising a rule to Autonomous is for owners and admins; stricter rules are for everyone."""
    if rule["mode"] != "autonomous" or role in ADMIN_ROLES:
        return
    if previous is not None and previous.get("mode") == "autonomous":
        return
    raise HTTPException(status_code=403, detail="Only owners and admins can let an agent act on its own")


async def set_rules(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent | None,
    rules: list[dict[str, Any]],
    *,
    role: str | None,
    user_id: UUID | None,
) -> list[dict[str, Any]]:
    """Replace the rule list (caller commits)."""
    current = {r["id"]: r for r in (agent_rules(agent) if agent is not None else workspace_rules(tenant))}
    cleaned = []
    for raw in rules:
        previous = current.get(str(raw.get("id") or ""))
        rule = _clean_rule({**raw, "created_by": str(user_id or "")}, previous=previous)
        check_can_grant(rule, previous, role)
        cleaned.append(rule)
    _store(tenant, agent, cleaned)
    session.add(agent if agent is not None else tenant)
    return cleaned


def add_rule(tenant: Tenant, agent: Agent | None, raw: dict[str, Any]) -> dict[str, Any]:
    """Append or replace one rule without a role check (used when applying an accepted proposal)."""
    rules = agent_rules(agent) if agent is not None else workspace_rules(tenant)
    previous = next((r for r in rules if r["id"] == raw.get("id")), None)
    rule = _clean_rule(raw, previous=previous)
    rules = [r for r in rules if r["id"] != rule["id"]] + [rule]
    _store(tenant, agent, rules)
    return rule


def matching_hard_rules(rules: list[dict[str, Any]], tool_name: str, category: str) -> list[dict[str, Any]]:
    tool_hits = [r for r in rules if r["kind"] == "hard" and r["tool"] == tool_name]
    if tool_hits:
        return tool_hits
    return [r for r in rules if r["kind"] == "hard" and not r["tool"] and r["category"] == category]


def strictest(rules: list[dict[str, Any]]) -> dict[str, Any] | None:
    return min(rules, key=lambda r: _RANK[r["mode"]]) if rules else None


def mode_to_allowance(mode: str) -> str:
    return "allow" if mode == "autonomous" else "ask"


def find_rule(rules: list[dict[str, Any]], rule_id: str) -> dict[str, Any] | None:
    return next((r for r in rules if r["id"] == rule_id), None)


def apply_judgement(
    mode: str,
    reason: str,
    *,
    rules: list[dict[str, Any]],
    certainty: Any,
    rule_id: str,
    consequential: bool,
) -> tuple[str, str]:
    """Refine a resolved allowance with the agent's own certainty and cited rule.

    Deny stays deny; a hard rule (reason ``rule:``) is not overridden by a
    cited judgement rule. An agent that is not sure enough always asks.
    """
    if mode == "deny":
        return mode, reason
    cited = find_rule(rules, rule_id) if rule_id and not reason.startswith("rule:") else None
    if cited is not None and cited["kind"] == "judgement":
        target = mode_to_allowance(cited["mode"])
        if target == "allow" and consequential:
            target = "ask"
        if target != mode:
            mode, reason = target, f"rule:{cited['id']}"
    if mode == "allow" and certainty is not None:
        try:
            value = int(certainty)
        except (TypeError, ValueError):
            value = None
        if value is not None and value < CERTAINTY_THRESHOLD:
            return "ask", "low_certainty"
    return mode, reason


def when_to_ask_prompt(rules: list[dict[str, Any]]) -> str:
    """System prompt block listing the rules an agent weighs itself."""
    judgement = [r for r in rules if r["kind"] == "judgement"]
    lines = [
        "## When to ask",
        f"Every action that changes something takes `certainty` (1-10). Below {CERTAINTY_THRESHOLD} it "
        "becomes a question to a person instead of running.",
    ]
    if judgement:
        lines.append("Rules from the team. When one applies, pass its id as `rule_id`:")
        for rule in judgement:
            label = {"manual": "never do this yourself", "assisted": "ask first", "autonomous": "do it yourself"}[
                rule["mode"]
            ]
            lines.append(f"- [{rule['id']}] {rule['text']} ({label})")
    return "\n".join(lines)


def record_outcome(tenant: Tenant, agent: Agent | None, rule_id: str, outcome: str) -> bool:
    """Count a use (``used``) or a human verdict (``approved`` / ``rejected``) on a rule."""
    for owner in (agent, None):
        rules = agent_rules(owner) if owner is not None else workspace_rules(tenant)
        rule = find_rule(rules, rule_id)
        if rule is None:
            continue
        key = "uses" if outcome == "used" else outcome
        if key not in ("uses", "approved", "rejected"):
            return False
        rule[key] = int(rule.get(key) or 0) + 1
        _store(tenant, owner, rules)
        return True
    return False


async def propose_rule(
    session: AsyncSession,
    tenant: Tenant,
    *,
    rule: dict[str, Any],
    agent: Agent | None,
    proposer_agent: Agent | None = None,
    user_id: UUID | None = None,
    signal_id: UUID | None = None,
    example: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A rule becomes a Govern proposal confirmed inline (owners and admins for Autonomous)."""
    from app.services.platform_changes import propose_platform_change

    cleaned = _clean_rule(rule)
    target = agent.name if agent is not None else "all agents"
    verb = {"manual": "never do", "assisted": "ask before", "autonomous": "may do on its own"}[cleaned["mode"]]
    change, outcome = await propose_platform_change(
        session,
        tenant,
        resource_type="agent_rule",
        change_kind="create",
        resource_id=str(agent.id) if agent is not None else "",
        after={"agent_id": str(agent.id) if agent is not None else None, "rule": cleaned, "example": example or {}},
        summary=f"Rule for {target}: {verb}: {cleaned['text']}"[:240],
        agent=proposer_agent,
        user_id=user_id,
        mode="ask",
        signal_id=signal_id,
    )
    return {"change_id": str(change.id), "status": change.status, "rule": cleaned, **outcome}


def _learn_option(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((o for o in options if isinstance(o, dict) and isinstance(o.get("learn"), dict)), None)


async def learn_from_decision(
    session: AsyncSession,
    tenant: Tenant,
    decision: Any,
    choice: str,
    *,
    user_id: UUID,
) -> dict[str, Any]:
    """The three buttons next to a decision: allow from now on, always ask, not sure yet."""
    from sqlalchemy import select

    from app.models.notification import DecisionRequest
    from app.tools.decision_copy import format_policy_decision

    if choice not in ("allow", "ask", "unsure"):
        raise HTTPException(status_code=422, detail="choice must be allow, ask or unsure")
    options = json.loads(decision.options_json or "[]")
    option = _learn_option(options)
    agent_id = None
    if option is not None:
        try:
            agent_id = UUID(str(option["learn"].get("agent_id") or ""))
        except ValueError:
            agent_id = None
    agent = await session.get(Agent, agent_id) if agent_id else None
    if option is None or agent is None or agent.tenant_id != tenant.id:
        raise HTTPException(status_code=400, detail="This decision has nothing to learn from")
    tool = str(option["learn"].get("tool") or option.get("action_type") or "")
    payload = option.get("payload") if isinstance(option.get("payload"), dict) else {}
    title, _ = format_policy_decision(tool, payload)
    example = {"tool": tool, "payload": payload, "decision_id": str(decision.id)}

    if choice == "unsure":
        settings = _json(agent.settings_json)
        unsure = settings.get("rule_unsure") if isinstance(settings.get("rule_unsure"), dict) else {}
        count = int(unsure.get(tool) or 0) + 1
        unsure[tool] = count
        settings["rule_unsure"] = unsure
        agent.settings_json = json.dumps(settings)
        session.add(agent)
        if count < UNSURE_PROPOSAL_AFTER:
            await session.commit()
            return {"status": "collected", "count": count}
        # Enough examples: propose what the team actually did with them.
        rows = (
            await session.execute(
                select(DecisionRequest.status).where(
                    DecisionRequest.tenant_id == tenant.id,
                    DecisionRequest.options_json.like(f'%"agent_id": "{agent.id}"%'),
                    DecisionRequest.options_json.like(f'%"tool": "{tool}"%'),
                    DecisionRequest.status.in_(("approved", "rejected")),
                )
            )
        ).scalars().all()
        unsure.pop(tool, None)
        settings["rule_unsure"] = unsure
        agent.settings_json = json.dumps(settings)
        approved = sum(1 for s in rows if s == "approved")
        mode = "autonomous" if rows and approved == len(rows) else "assisted"
        choice = "allow" if mode == "autonomous" else "ask"

    mode = "autonomous" if choice == "allow" else "assisted"
    text = f"{title} without asking" if mode == "autonomous" else f"Always ask before: {title}"
    return await propose_rule(
        session,
        tenant,
        rule={"text": text, "mode": mode, "kind": "hard", "tool": tool},
        agent=agent,
        user_id=user_id,
        signal_id=decision.signal_id,
        example=example,
    )


async def dry_run(
    session: AsyncSession,
    tenant: Tenant,
    agent: Agent | None,
    *,
    tool: str = "",
    certainty: int | None = None,
    rule_id: str = "",
) -> dict[str, Any]:
    """Try out: which rule applies and what the agent would do, without running anything."""
    from app.tools.policy import resolve_tool_mode
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec(tool) if tool else None
    if spec is None:
        raise HTTPException(status_code=422, detail="Pick a known action to try")
    mode, reason = await resolve_tool_mode(session, tenant, agent, spec, trust="operator")
    if spec.mutating and spec.gated:
        mode, reason = apply_judgement(
            mode,
            reason,
            rules=all_rules(tenant, agent),
            certainty=certainty,
            rule_id=rule_id,
            consequential=spec.consequential,
        )
    rule = find_rule(all_rules(tenant, agent), reason[5:]) if reason.startswith("rule:") else None
    outcome = {"allow": "runs", "ask": "asks", "deny": "refused"}[mode]
    return {"tool": tool, "mode": mode, "reason": reason, "outcome": outcome, "rule": rule}


def rule_reason_text(reason: str, tenant: Tenant | None, agent: Agent | None) -> str:
    """Operator line for a decision card: "Asked because of rule: money matters"."""
    if not reason.startswith("rule:"):
        return ""
    rule = find_rule(all_rules(tenant, agent), reason.split(":", 1)[1])
    return rule["text"] if rule else ""
