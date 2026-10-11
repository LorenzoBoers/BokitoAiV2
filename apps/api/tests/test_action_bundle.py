"""Action bundles: one card per agent turn, approve all / some, and the
always / ask / never verdict per agent and tool. Plus the free-tag tools."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.platform_change import PlatformChange
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag
from app.tools.registry import ToolContext, get_tool_spec


async def _login(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _agent(session, tenant: Tenant) -> Agent:
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    assert agent is not None
    return agent


async def _chat_signal(session, tenant: Tenant, agent: Agent) -> Signal:
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="chat",
        subject="Tags",
        agent_id=agent.id,
    )
    session.add(signal)
    await session.flush()
    return signal


def _turn_ctx(session, tenant: Tenant, agent: Agent, signal: Signal) -> ToolContext:
    """Tool context of one agent turn: every ask it raises shares the bundle id."""
    return ToolContext(
        session=session,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
        turn_id=f"turn-{uuid4().hex[:8]}",
    )


async def _propose(ctx: ToolContext, action: str, payload: dict) -> DecisionRequest:
    from app.tools.builtin import _propose_action

    result = await _propose_action(
        ctx,
        {"question": f"{action}?", "action": action, "payload": payload, "approve_label": "Ja"},
    )
    decision = await ctx.session.get(DecisionRequest, UUID(str(result["decision_request_id"])))
    assert decision is not None
    return decision


def test_tag_tools_are_registered_and_gated():
    for name in ("create_tag", "update_tag"):
        spec = get_tool_spec(name)
        assert spec is not None, name
        assert spec.gated is True
        assert spec.mutating is True


@pytest.mark.asyncio
async def test_create_tag_and_set_thread_tags_create_missing(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = _turn_ctx(session_override, tenant, agent, signal)

    from app.tools.builtin import _create_tag, _set_thread_tags, _update_tag

    name = f"vip-{uuid4().hex[:6]}"
    out = await _create_tag(ctx, {"name": f"#{name}", "description": "Belangrijke klant"})
    assert out["ok"] is True
    assert out["tag"]["name"] == name
    assert out["tag"]["is_category"] is False

    renamed = await _update_tag(ctx, {"name": name, "new_name": f"{name}-2", "pinned": True})
    assert renamed["ok"] is True
    assert renamed["tag"]["name"] == f"{name}-2"
    assert renamed["tag"]["pinned"] is True

    fresh = f"nieuw-{uuid4().hex[:6]}"
    refused = await _set_thread_tags(ctx, {"tags": [fresh]})
    assert "error" in refused
    applied = await _set_thread_tags(ctx, {"tags": [fresh], "create_missing": True})
    assert applied["ok"] is True
    assert fresh in applied["tags"]


@pytest.mark.asyncio
async def test_turn_decisions_share_bundle_and_attach_to_bubble(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
        turn_id="turn-abc",
    )
    assert ctx.bundle_id == "turn-abc"
    first = await _propose(ctx, "create_tag", {"name": "een"})
    second = await _propose(ctx, "create_tag", {"name": "twee"})
    assert first.bundle_id == "turn-abc"
    assert second.bundle_id == "turn-abc"

    from app.services.agent.turn_persist import place_turn_decisions

    bubble = SignalMessage(
        tenant_id=tenant.id,
        signal_id=signal.id,
        role="assistant",
        kind="chat",
        body_text="Twee tags aanmaken?",
        author_agent_id=agent.id,
        metadata_json=json.dumps(
            {
                "activity": [
                    {"result": {"decision_request_id": str(first.id)}},
                    {"result": {"decision_request_id": str(second.id)}},
                ]
            }
        ),
    )
    session_override.add(bubble)
    await session_override.flush()
    await place_turn_decisions(session_override, signal, [bubble])
    await session_override.commit()

    meta = json.loads(bubble.metadata_json or "{}")
    bundle = meta["proposal"]["bundle"]
    assert [row["decision_id"] for row in bundle] == [str(first.id), str(second.id)]
    assert meta["proposal"]["bundle_id"] == "turn-abc"

    from app.services.signal_threads import get_message

    payload = await get_message(session_override, tenant.id, signal.id, bubble.id)
    rows = payload["payload"]["proposal"]["bundle"]
    assert len(rows) == 2
    assert rows[0]["action"]["tool"] == "create_tag"
    assert rows[0]["action"]["args"]["name"] == "een"
    assert rows[0]["action"]["fallback"] == "Create tag #een"
    assert rows[0]["learn"]["agent_id"] == str(agent.id)


@pytest.mark.asyncio
async def test_resolve_bundle_approve_all(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = _turn_ctx(session_override, tenant, agent, signal)
    names = [f"a-{uuid4().hex[:5]}", f"b-{uuid4().hex[:5]}"]
    decisions = [await _propose(ctx, "create_tag", {"name": n}) for n in names]
    await session_override.commit()

    res = await client.post(
        f"/api/signals/{signal.id}/decisions/resolve-bundle",
        headers=headers,
        json={"decision_ids": [str(d.id) for d in decisions], "approve": "all"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert [row["status"] for row in body["results"]] == ["approved", "approved"]

    for name in names:
        row = (
            await session_override.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == name)
            )
        ).scalar_one_or_none()
        assert row is not None, name

    bubbles = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.role == "user",
            )
        )
    ).scalars().all()
    assert len(bubbles) == 1
    text = bubbles[0].body_text or ""
    assert "Create tag" in text or "Hashtag" in text
    assert all(name in text for name in names)


@pytest.mark.asyncio
async def test_resolve_bundle_partial_and_failure_keeps_others(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = _turn_ctx(session_override, tenant, agent, signal)
    good = await _propose(ctx, "create_tag", {"name": f"ok-{uuid4().hex[:5]}"})
    broken = await _propose(ctx, "create_tag", {"name": ""})
    skipped = await _propose(ctx, "create_tag", {"name": f"skip-{uuid4().hex[:5]}"})
    await session_override.commit()

    res = await client.post(
        f"/api/signals/{signal.id}/decisions/resolve-bundle",
        headers=headers,
        json={
            "decision_ids": [str(good.id), str(broken.id), str(skipped.id)],
            "approve": [str(good.id), str(broken.id)],
            "reject": "rest",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    by_id = {row["decision_id"]: row for row in body["results"]}
    assert by_id[str(good.id)]["status"] == "approved"
    assert by_id[str(broken.id)]["status"] == "awaiting_human"
    assert by_id[str(broken.id)]["error"]
    assert by_id[str(skipped.id)]["status"] == "rejected"
    assert body["ok"] is False

    for decision, expected in ((good, "approved"), (broken, "awaiting_human"), (skipped, "rejected")):
        await session_override.refresh(decision)
        assert decision.status == expected, decision.title


@pytest.mark.asyncio
async def test_owner_verdict_applies_rule_immediately(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = _turn_ctx(session_override, tenant, agent, signal)
    decision = await _propose(ctx, "create_tag", {"name": f"rule-{uuid4().hex[:5]}"})
    await session_override.commit()

    res = await client.post(f"/api/notifications/decisions/{decision.id}/learn", headers=headers, json={"choice": "allow"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] is True
    assert body["rule"]["mode"] == "autonomous"
    assert body["rule"]["tool"] == "create_tag"

    from app.services.agent_rules import agent_rules

    await session_override.refresh(agent)
    rules = [r for r in agent_rules(agent) if r["tool"] == "create_tag"]
    assert len(rules) == 1 and rules[0]["mode"] == "autonomous"
    first_rule_id = rules[0]["id"]

    change = (
        await session_override.execute(
            select(PlatformChange).where(
                PlatformChange.tenant_id == tenant.id,
                PlatformChange.resource_type == "agent_rule",
                PlatformChange.resource_id == str(agent.id),
            ).order_by(PlatformChange.created_at.desc())
        )
    ).scalars().first()
    assert change is not None and change.status == "applied_yolo"

    # Never replaces the same tool's rule instead of stacking a second one.
    res = await client.post(f"/api/notifications/decisions/{decision.id}/learn", headers=headers, json={"choice": "deny"})
    assert res.status_code == 200, res.text
    await session_override.refresh(agent)
    rules = [r for r in agent_rules(agent) if r["tool"] == "create_tag"]
    assert len(rules) == 1
    assert rules[0]["mode"] == "manual"
    assert rules[0]["id"] == first_rule_id

    listing = await client.get("/api/govern/agent-rules", headers=headers)
    assert listing.status_code == 200
    rows = [a for a in listing.json()["agents"] if a["agent_id"] == str(agent.id)]
    assert rows and any(r["tool"] == "create_tag" for r in rows[0]["rules"])

    gone = await client.delete(f"/api/govern/agent-rules/{agent.id}/{first_rule_id}", headers=headers)
    assert gone.status_code == 200, gone.text
    assert all(r["id"] != first_rule_id for r in gone.json()["rules"])


@pytest.mark.asyncio
async def test_member_verdict_becomes_govern_draft(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant)
    signal = await _chat_signal(session_override, tenant, agent)
    ctx = _turn_ctx(session_override, tenant, agent, signal)
    decision = await _propose(ctx, "create_tag", {"name": f"draft-{uuid4().hex[:5]}"})
    await session_override.commit()

    from app.models.auth import User
    from app.services.agent_rules import agent_rules, learn_from_decision

    user = (await session_override.execute(select(User))).scalars().first()
    result = await learn_from_decision(
        session_override, tenant, decision, "allow", user_id=user.id, role="member"
    )
    assert result["applied"] is False
    assert result["status"] in ("pending_review", "draft")
    await session_override.refresh(agent)
    assert not any(r["tool"] == "create_tag" and r["mode"] == "autonomous" for r in agent_rules(agent))
