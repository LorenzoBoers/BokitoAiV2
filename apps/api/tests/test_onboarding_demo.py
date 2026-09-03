"""Onboarding demo thread, first_decision step, and the channel return nudge."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select


async def _signup(client: AsyncClient, slug: str) -> dict:
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": f"{slug}@example.com",
            "password": "test-password",
            "tenant_slug": slug,
            "tenant_name": slug.title(),
        },
    )
    assert signup.status_code == 200, signup.text
    return {"Authorization": f"Bearer {signup.json()['access_token']}"}


@pytest.mark.asyncio
async def test_demo_thread_seed_resolve_and_first_decision_step(client: AsyncClient):
    headers = await _signup(client, "demo-co")

    created = await client.post("/api/app/onboarding/demo-thread", headers=headers)
    assert created.status_code == 200, created.text
    signal_id = created.json()["signal_id"]
    assert created.json()["created"] is True

    # Idempotent: a second call returns the same thread.
    again = await client.post("/api/app/onboarding/demo-thread", headers=headers)
    assert again.json() == {"signal_id": signal_id, "created": False}

    # The pending demo decision does not complete the step yet.
    status = await client.get("/api/app/onboarding", headers=headers)
    steps = {s["id"]: s["done"] for s in status.json()["steps"]}
    assert steps["first_decision"] is False

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    card = next(m for m in detail.json()["messages"] if m.get("kind") == "decision_request")

    resolved = await client.post(
        f"/api/signals/{signal_id}/messages/{card['id']}/resolve",
        headers=headers,
        json={"action": "approve", "option_id": "approve"},
    )
    assert resolved.status_code == 200, resolved.text
    # Demo threads never teach inbox rules.
    assert resolved.json().get("rule_suggestion") is None

    status2 = await client.get("/api/app/onboarding", headers=headers)
    steps2 = {s["id"]: s["done"] for s in status2.json()["steps"]}
    assert steps2["first_decision"] is True

    # Explicit removal works too.
    removed = await client.delete("/api/app/onboarding/demo-thread", headers=headers)
    assert removed.json()["removed"] == 1
    gone = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_demo_thread_removed_when_real_channel_connects(
    client: AsyncClient, unparked_channels
):
    headers = await _signup(client, "demo-cleanup-co")
    created = await client.post("/api/app/onboarding/demo-thread", headers=headers)
    signal_id = created.json()["signal_id"]

    account = await client.post(
        "/api/channels/accounts",
        json={"channel": "slack", "provider": "slack", "address": "TDEMO"},
        headers=headers,
    )
    assert account.status_code == 200, account.text

    gone = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_channel_nudge_sends_once(client: AsyncClient, session_override, monkeypatch):
    from app.models.auth import Tenant
    from app.services import transactional_mail
    from app.services.onboarding_demo import send_channel_nudges

    headers = await _signup(client, "nudge-co")
    assert headers  # tenant + owner exist now

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "nudge-co"))
    ).scalar_one()
    tenant.created_at = datetime.utcnow() - timedelta(hours=25)
    session_override.add(tenant)
    await session_override.commit()

    sent_mails: list[tuple[str, str]] = []

    async def _fake_send_mail(to, subject, text, html=None, *, kind="generic"):
        sent_mails.append((to, subject))
        return True

    monkeypatch.setattr(transactional_mail, "send_mail", _fake_send_mail)

    sent = await send_channel_nudges(session_override)
    assert sent >= 1
    assert any(to == "nudge-co@example.com" for to, _ in sent_mails)

    # The timestamp in tenant settings prevents a second send.
    assert await send_channel_nudges(session_override) == 0
