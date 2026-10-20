"""Auto-review: off, shadow and enforce; consequential and tainted calls never auto-allow."""

import dataclasses
import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.learning import Feedback
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services import auto_review
from app.services.auto_review import Verdict, outcome_for, parse_verdict
from app.services.notifications import resolve_decision
from app.tools import executor
from app.tools.registry import get_tool_spec


def test_parse_verdict_accepts_json_and_rejects_noise():
    v = parse_verdict('Sure: {"decision": "allow", "reason": "routine", "confidence": 0.93}', "enforce")
    assert v is not None and v.decision == "allow" and v.confidence == 0.93 and v.mode == "enforce"
    assert parse_verdict('{"decision": "maybe"}', "shadow") is None
    assert parse_verdict("no json", "shadow") is None


def test_enforce_rules():
    spec = get_tool_spec("create_tag")
    risky = dataclasses.replace(spec, consequential=True)
    sure = Verdict("allow", "routine", 0.9, "enforce")
    unsure = Verdict("allow", "routine", 0.6, "enforce")
    assert outcome_for(sure, spec, mode="enforce", tainted=False) == "allow"
    assert outcome_for(unsure, spec, mode="enforce", tainted=False) == "ask"
    assert outcome_for(sure, risky, mode="enforce", tainted=False) == "ask"
    assert outcome_for(sure, spec, mode="enforce", tainted=True) == "ask"
    assert outcome_for(Verdict("deny", "off-task", 0.4, "enforce"), risky, mode="enforce", tainted=False) == "deny"
    assert outcome_for(None, spec, mode="enforce", tainted=False) == "ask"
    assert outcome_for(Verdict("deny", "x", 1.0), spec, mode="shadow", tainted=False) == "ask"


async def _setup(session, mode: str):
    tenant = (await session.execute(select(Tenant))).scalars().first()
    settings = json.loads(tenant.settings_json or "{}")
    settings["tool_overrides"] = {**(settings.get("tool_overrides") or {}), "create_tag": "ask"}
    settings["auto_review"] = {"mode": mode, "instructions": ""}
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Docs")
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    agent = (await session.execute(select(Agent).where(Agent.slug == "assistant"))).scalar_one()
    return tenant, signal, agent


def _stub(monkeypatch, verdict: Verdict | None, ran: list):
    async def _classify(*args, mode, **kwargs):
        if verdict is None:
            raise TimeoutError
        return dataclasses.replace(verdict, mode=mode)

    async def _handler(session, spec, ctx, tool_input):
        ran.append(spec.name)
        return {"ok": True}

    monkeypatch.setattr(auto_review, "classify", _classify)
    monkeypatch.setattr(executor, "_invoke_handler", _handler)


async def _call(session, tenant, signal, agent):
    return await executor.execute_tool(
        session, tenant.id, None, "create_tag", {"name": "vip"},
        signal_id=signal.id, agent=agent, trust="operator",
    )


@pytest.mark.asyncio
async def test_shadow_stores_verdict_and_learns(client, session_override, monkeypatch):
    tenant, signal, agent = await _setup(session_override, "shadow")
    ran: list = []
    _stub(monkeypatch, Verdict("allow", "routine note", 0.95), ran)
    result = await _call(session_override, tenant, signal, agent)
    assert not ran
    decision = await session_override.get(DecisionRequest, __import__("uuid").UUID(result["decision_request_id"]))
    stored = json.loads(decision.auto_review_json)
    assert stored["decision"] == "allow" and stored["mode"] == "shadow" and not stored["applied"]

    await resolve_decision(session_override, tenant.id, decision.id, "reject", "rejected")
    await session_override.commit()
    row = (
        await session_override.execute(select(Feedback).where(Feedback.correction_key == "auto_review"))
    ).scalar_one()
    assert json.loads(row.metadata_json) == {"verdict": "allow", "human": "deny", "agree": False}
    stats = await auto_review.agreement(session_override, tenant.id)
    assert stats == {"sample_size": 1, "rate": 0.0}


@pytest.mark.asyncio
async def test_enforce_allows_routine_and_denies_wrong(client, session_override, monkeypatch):
    tenant, signal, agent = await _setup(session_override, "enforce")
    ran: list = []
    _stub(monkeypatch, Verdict("allow", "routine", 0.9), ran)
    assert (await _call(session_override, tenant, signal, agent)) == {"ok": True}
    assert ran == ["create_tag"]

    _stub(monkeypatch, Verdict("deny", "not asked for", 0.7), ran)
    denied = await _call(session_override, tenant, signal, agent)
    assert denied["status"] == "denied" and denied["reason"] == "auto_review"
    assert ran == ["create_tag"]


@pytest.mark.asyncio
async def test_enforce_failure_asks(client, session_override, monkeypatch):
    tenant, signal, agent = await _setup(session_override, "enforce")
    ran: list = []
    _stub(monkeypatch, None, ran)
    result = await _call(session_override, tenant, signal, agent)
    assert "decision_request_id" in result and not ran
    decision = await session_override.get(DecisionRequest, __import__("uuid").UUID(result["decision_request_id"]))
    assert decision.auto_review_json in ("", "{}")


@pytest.mark.asyncio
async def test_off_never_calls_the_model(client, session_override, monkeypatch):
    tenant, signal, agent = await _setup(session_override, "off")

    async def _boom(*args, **kwargs):
        raise AssertionError("classifier called while off")

    monkeypatch.setattr(auto_review, "classify", _boom)
    result = await _call(session_override, tenant, signal, agent)
    assert "decision_request_id" in result


@pytest.mark.asyncio
async def test_settings_endpoint(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get("/api/govern/auto-review", headers=headers)
    assert res.status_code == 200 and res.json()["mode"] == "off"
    bad = await client.put("/api/govern/auto-review", headers=headers, json={"mode": "always"})
    assert bad.status_code == 422
    ok = await client.put(
        "/api/govern/auto-review", headers=headers, json={"mode": "shadow", "instructions": "Refunds ask."}
    )
    assert ok.status_code == 200
    assert ok.json()["mode"] == "shadow" and ok.json()["instructions"] == "Refunds ask."
