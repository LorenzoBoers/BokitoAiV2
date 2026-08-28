"""Workspace member recognition for inbound identity and agent context."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


@pytest.mark.asyncio
async def test_ingest_member_email_skips_contact_and_agent(session_override):
    from app.channels.base import InboundMessage, ingest_inbound
    from app.models.auth import Membership, Tenant, User
    from app.models.channel import Contact
    from app.models.signal import SignalMessage
    from app.services.auth import hash_password

    tenant = Tenant(slug="member-ingest", name="Member Ingest")
    user = User(
        email="teammate@example.com",
        password_hash=hash_password("x"),
        display_name="Teammate",
        email_verified=True,
    )
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(user)
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="member"))
    await session_override.commit()

    inbound = InboundMessage(
        channel="email",
        source="mock",
        sender_address="teammate@example.com",
        sender_name="Teammate",
        subject="Internal note via mail",
        body_text="Hello from me",
        external_id=f"ext-{uuid4()}",
    )
    signal, should_process = await ingest_inbound(session_override, tenant.id, inbound)
    assert should_process is False
    assert signal.contact_id is None

    contacts = (
        await session_override.execute(
            select(Contact).where(Contact.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert contacts == []

    msg = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id)
        )
    ).scalar_one()
    assert msg.author_user_id == user.id
    assert msg.from_address == "teammate@example.com"


@pytest.mark.asyncio
async def test_operator_context_marks_internal_user(session_override):
    from app.models.auth import Membership, Tenant, User
    from app.services.agent.loop import AgentLoop
    from app.services.auth import hash_password

    tenant = Tenant(slug="op-ctx", name="Op Ctx")
    user = User(
        email=TEST_EMAIL,
        password_hash=hash_password("x"),
        display_name="Operator Name",
        email_verified=True,
    )
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(user)
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    await session_override.commit()

    loop = AgentLoop(session_override, tenant.id, user.id, trust="operator")
    loop.agent = None
    text = await loop._operator_context()
    assert "Operator Name" in text
    assert TEST_EMAIL in text
    assert "workspace owner" in text
    assert "internal operator" in text


@pytest.mark.asyncio
async def test_list_members_includes_role(client: AsyncClient):
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get("/api/signals/members", headers=headers)
    assert res.status_code == 200
    rows = res.json()
    assert isinstance(rows, list)
    me = next(r for r in rows if r["email"] == TEST_EMAIL)
    assert me["role"] == "owner"
