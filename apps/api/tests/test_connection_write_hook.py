"""Every write through a connection ends in the delivery hook."""

import json
from uuid import uuid4

import pytest

from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services import deliveries
from app.tools.executor import _writes_through_connection
from app.tools.registry import _ensure_builtin_loaded, iter_tool_specs


def _connection_tools() -> list:
    _ensure_builtin_loaded()
    out = []
    for spec in iter_tool_specs():
        props = (spec.input_schema or {}).get("properties") or {}
        if spec.mutating and ("connection_id" in props or _writes_through_connection(spec.name)):
            out.append(spec)
    return out


def test_every_write_capable_connection_tool_reaches_the_hook():
    tools = _connection_tools()
    assert any(_writes_through_connection(spec.name) for spec in tools)
    missing = [
        spec.name
        for spec in tools
        if not _writes_through_connection(spec.name)
        and spec.name not in deliveries.APPROVED_CONNECTION_WRITES
        and spec.name not in deliveries.CONNECTION_SETTINGS_TOOLS
    ]
    assert missing == [], f"connection writes without the delivery hook: {missing}"


@pytest.mark.asyncio
async def test_module_verbs_call_the_hook_from_the_executor(session_override, monkeypatch):
    from app.tools import execute_tool
    from app.tools.registry import get_tool_spec

    tenant = Tenant(slug=f"hook-{uuid4().hex[:6]}", name="Hook")
    session_override.add(tenant)
    await session_override.flush()
    signal = Signal(tenant_id=tenant.id, channel="email", status="open")
    session_override.add(signal)
    await session_override.commit()

    calls: list[str] = []

    async def fake_write(session, tenant_id, signal_id, *, tool_name, **_kw):
        calls.append(tool_name)

    async def fake_handler(ctx, tool_input):
        return {"ok": True, "external_ref": "X-1"}

    monkeypatch.setattr(deliveries, "record_connection_write", fake_write)
    for spec in _connection_tools():
        if not _writes_through_connection(spec.name):
            continue
        monkeypatch.setattr(get_tool_spec(spec.name), "handler", fake_handler)
        await execute_tool(
            session_override, tenant.id, None, spec.name, {"connection_id": str(uuid4())},
            signal_id=signal.id, approved=True,
        )
    expected = [s.name for s in _connection_tools() if _writes_through_connection(s.name)]
    assert calls == expected


@pytest.mark.asyncio
async def test_approved_calendar_event_calls_the_hook(session_override, monkeypatch):
    from app.services import calendar_sync
    from app.services.notifications import resolve_decision

    tenant = Tenant(slug=f"hook-{uuid4().hex[:6]}", name="Hook")
    session_override.add(tenant)
    await session_override.flush()
    signal = Signal(tenant_id=tenant.id, channel="email", status="open")
    session_override.add(signal)
    await session_override.flush()
    connection_id = str(uuid4())
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Create calendar event: Demo",
        options_json=json.dumps([
            {
                "id": "approve",
                "label": "Create event",
                "action_type": deliveries.APPROVED_CONNECTION_WRITES["calendar_propose_event"],
                "payload": {
                    "connection_id": connection_id,
                    "title": "Demo",
                    "start_at": "2026-10-21T10:00:00Z",
                    "end_at": "2026-10-21T11:00:00Z",
                },
            }
        ]),
    )
    session_override.add(decision)
    await session_override.commit()

    async def fake_create(*_a, **_kw):
        return {"id": "evt-1"}

    calls: list[dict] = []

    async def fake_write(session, tenant_id, signal_id, *, tool_name, tool_input, result, **_kw):
        calls.append({"tool": tool_name, "connection_id": tool_input["connection_id"], "signal_id": signal_id})

    monkeypatch.setattr(calendar_sync, "create_external_event", fake_create)
    monkeypatch.setattr(deliveries, "record_connection_write", fake_write)
    await resolve_decision(session_override, tenant.id, decision.id, "approve", "approved")
    assert calls == [{"tool": "calendar_create_event", "connection_id": connection_id, "signal_id": signal.id}]
