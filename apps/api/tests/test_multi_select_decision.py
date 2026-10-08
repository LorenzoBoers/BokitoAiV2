"""Multi-select proposal resolve stores option ids and posts an operator bubble."""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_multi_select_resolve_joins_labels_and_ids(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="test",
        subject="Tags",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()

    from app.tools import execute_tool

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Which tags?",
            "question": "Which tags?",
            "signal_id": str(signal.id),
            "selection": "multiple",
            "options": [
                {"id": "klacht", "label": "#klacht"},
                {"id": "storing", "label": "#storing"},
                {"id": "reject", "label": "None"},
            ],
        },
        signal_id=signal.id,
    )
    decision_id = UUID(result["decision_request_id"])
    msg = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.decision_id == decision_id,
            )
        )
    ).scalar_one()
    card_meta = json.loads(msg.metadata_json or "{}")
    assert card_meta.get("selection") == "multiple"

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{msg.id}/resolve",
        headers=headers,
        json={"action": "approved", "option_ids": ["klacht", "storing"]},
    )
    assert resolve.status_code == 200

    decision = await session_override.get(DecisionRequest, decision_id)
    await session_override.refresh(decision)
    assert decision.status == "approved"
    assert decision.chosen_option_id == "klacht,storing"

    replies = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.body_text == "#klacht, #storing",
            )
        )
    ).scalars().all()
    assert len(replies) == 1
    meta = json.loads(replies[0].metadata_json or "{}")
    assert meta.get("decision_response") is True
    assert meta.get("option_ids") == ["klacht", "storing"]
    # No showcase snapshots when the card had none — body still carries labels.
    assert meta.get("items") in (None, [],)
