import pytest
from httpx import AsyncClient
from sqlalchemy import select


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed_thread(session_override) -> int:
    from app.models.auth import Tenant
    from app.models.inbox_threads import InboxMessage, InboxThread

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    thread = InboxThread(
        tenant_id=tenant.id,
        organisation_id=str(tenant.id),
        email_subject="Test thread",
        contact_name="Tester",
        contact_email="tester@example.com",
        status="open",
    )
    session_override.add(thread)
    await session_override.flush()
    session_override.add(
        InboxMessage(
            thread_id=thread.id,
            tenant_id=tenant.id,
            direction="inbound",
            from_address="tester@example.com",
            body_preview="Hello there",
        )
    )
    await session_override.commit()
    return thread.id


@pytest.mark.asyncio
async def test_list_and_get_threads(client: AsyncClient, session_override):
    thread_id = await _seed_thread(session_override)
    headers = await _auth_headers(client)

    listing = await client.get("/api/integrations/inbox/threads?view=all_open", headers=headers)
    assert listing.status_code == 200
    body = listing.json()
    assert "items" in body and body["itemsTotal"] >= 1
    assert any(item["id"] == thread_id for item in body["items"])

    detail = await client.get(f"/api/integrations/inbox/threads/{thread_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["thread"]["id"] == thread_id
    assert len(detail.json()["messages"]) >= 1


@pytest.mark.asyncio
async def test_reply_patch_pin_flow(client: AsyncClient, session_override):
    thread_id = await _seed_thread(session_override)
    headers = await _auth_headers(client)

    reply = await client.post(
        f"/api/integrations/inbox/threads/{thread_id}/reply",
        json={"body_text": "Thanks for reaching out", "action": "send_and_pending"},
        headers=headers,
    )
    assert reply.status_code == 200
    assert reply.json()["direction"] == "outbound"

    detail = await client.get(f"/api/integrations/inbox/threads/{thread_id}", headers=headers)
    assert detail.json()["thread"]["status"] == "pending"

    patch = await client.patch(
        f"/api/integrations/inbox/threads/{thread_id}",
        json={"status": "closed", "priority": "high"},
        headers=headers,
    )
    assert patch.status_code == 200
    assert patch.json()["status"] == "closed"

    pin = await client.post(f"/api/integrations/inbox/threads/{thread_id}/pin", headers=headers)
    assert pin.status_code == 200
    pins = await client.get("/api/integrations/inbox/pins", headers=headers)
    assert thread_id in pins.json()["thread_ids"]

    members = await client.get("/api/integrations/inbox/members", headers=headers)
    assert members.status_code == 200
    assert isinstance(members.json(), list)


@pytest.mark.asyncio
async def test_mark_read_unread(client: AsyncClient, session_override):
    thread_id = await _seed_thread(session_override)
    headers = await _auth_headers(client)

    read = await client.patch(f"/api/integrations/inbox/threads/{thread_id}/mark-read", headers=headers)
    assert read.status_code == 200
    assert read.json()["has_unread"] is False

    unread = await client.patch(f"/api/integrations/inbox/threads/{thread_id}/mark-unread", headers=headers)
    assert unread.json()["has_unread"] is True
