"""Learned routing: questions on a topic go to the person who answers them.

The topic of a decision is its conversation's intent, else its category.
When one person answered at least ``MIN_ANSWERS`` decisions on a topic in the
last ``WINDOW`` and holds ``MIN_SHARE`` of them, the system proposes a Govern
change "Questions about invoices go to Lisa". Accepted, it becomes a routing
rule in tenant settings ``routing_rules``; ``resolve_addressee`` applies it
(routed ``rule``) after explicit targets and the agent's own setting.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.platform_change import PlatformChange
from app.models.signal import Signal

MIN_ANSWERS = 5
MIN_SHARE = 0.8
WINDOW = timedelta(days=60)


def topic_of(signal: Signal | None) -> str:
    if signal is None:
        return ""
    return str(signal.intent or signal.category or "").strip().lower()[:80]


def routing_rules(tenant: Tenant | None) -> list[dict[str, Any]]:
    try:
        settings = json.loads(tenant.settings_json or "{}") if tenant else {}
    except json.JSONDecodeError:
        settings = {}
    raw = settings.get("routing_rules") if isinstance(settings, dict) else None
    return [r for r in raw if isinstance(r, dict) and r.get("topic")] if isinstance(raw, list) else []


def rule_for_topic(tenant: Tenant | None, topic: str) -> dict[str, Any] | None:
    if not topic:
        return None
    return next((r for r in routing_rules(tenant) if r.get("topic") == topic), None)


def add_routing_rule(tenant: Tenant, topic: str, user_id: str) -> dict[str, Any]:
    """Store (or replace) the rule for a topic; caller adds the tenant and commits."""
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    settings = settings if isinstance(settings, dict) else {}
    rules = [r for r in routing_rules(tenant) if r.get("topic") != topic]
    rule = {"id": f"route_{secrets.token_hex(4)}", "topic": topic, "kind": "user", "user_id": user_id}
    rules.append(rule)
    settings["routing_rules"] = rules
    tenant.settings_json = json.dumps(settings)
    return rule


async def _pending_proposal(session: AsyncSession, tenant_id: UUID, topic: str) -> bool:
    rows = (
        await session.execute(
            select(PlatformChange.after_json).where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.resource_type == "routing_rule",
                PlatformChange.status.in_(("draft", "pending_review")),
            )
        )
    ).scalars().all()
    for raw in rows:
        try:
            if json.loads(raw or "{}").get("topic") == topic:
                return True
        except json.JSONDecodeError:
            continue
    return False


async def learn_from_answer(session: AsyncSession, decision: DecisionRequest) -> dict[str, Any] | None:
    """After a person resolved a decision: propose a routing rule when the pattern is clear."""
    if decision.resolved_by_user_id is None or decision.signal_id is None:
        return None
    signal = await session.get(Signal, decision.signal_id)
    topic = topic_of(signal)
    tenant = await session.get(Tenant, decision.tenant_id)
    if not topic or tenant is None:
        return None
    current = rule_for_topic(tenant, topic)
    if current and current.get("user_id") == str(decision.resolved_by_user_id):
        return None
    since = datetime.utcnow() - WINDOW
    topic_expr = func.lower(func.coalesce(func.nullif(Signal.intent, ""), Signal.category))
    rows = (
        await session.execute(
            select(DecisionRequest.resolved_by_user_id, func.count())
            .join(Signal, Signal.id == DecisionRequest.signal_id)
            .where(
                DecisionRequest.tenant_id == decision.tenant_id,
                DecisionRequest.resolved_by_user_id.is_not(None),
                DecisionRequest.resolved_at >= since,
                topic_expr == topic,
            )
            .group_by(DecisionRequest.resolved_by_user_id)
        )
    ).all()
    total = sum(int(count) for _, count in rows)
    leader, answers = max(rows, key=lambda row: int(row[1]), default=(None, 0))
    if leader is None or int(answers) < MIN_ANSWERS or int(answers) / max(total, 1) < MIN_SHARE:
        return None
    if current and current.get("user_id") == str(leader):
        return None
    if await _pending_proposal(session, decision.tenant_id, topic):
        return None
    person = await session.get(User, leader)
    name = (person.display_name or person.email) if person else "this person"

    from app.services.platform_changes import propose_platform_change

    change, outcome = await propose_platform_change(
        session,
        tenant,
        resource_type="routing_rule",
        change_kind="create",
        after={
            "topic": topic,
            "user_id": str(leader),
            "user_name": name,
            "answers": int(answers),
            "total": total,
        },
        before={"rule": current} if current else None,
        summary=f"Questions about {topic} go to {name} ({int(answers)} of {total} answered)"[:240],
        mode="ask",
    )
    return {"change_id": str(change.id), "status": change.status, **outcome}
