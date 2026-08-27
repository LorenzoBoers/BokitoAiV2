"""Cycle 10: @mention and assignment notifications on signal threads."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _add_teammate(client: AsyncClient, owner: dict, email: str) -> dict:
    """Invite + accept a second member; returns their auth headers."""
    r = await client.post(
        "/api/auth/invite", headers=owner, json={"email": email, "role": "member"}
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": "teammate123", "display_name": "Teammate"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_thread(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Refund request",
            "body_text": "Customer asks about a refund.",
            "contact_email": "customer@example.com",
            "contact_name": "Customer",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _member_num(client: AsyncClient, headers: dict, email: str) -> int:
    r = await client.get("/api/signals/members", headers=headers)
    assert r.status_code == 200
    return next(m["id"] for m in r.json() if m["email"] == email)


async def _notifications(client: AsyncClient, headers: dict) -> list[dict]:
    r = await client.get("/api/notifications", headers=headers)
    assert r.status_code == 200
    return r.json()


@pytest.mark.asyncio
async def test_mention_in_note_notifies_target(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "teammate@example.com")
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "teammate@example.com")

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": f"Can you take this one @[Teammate](user:{num})?"},
    )
    assert r.status_code == 200, r.text

    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "mention"]
    assert len(rows) == 1
    assert "mentioned you" in rows[0]["title"]
    assert rows[0]["payload"]["signal_id"] == signal_id

    # The author does not see the teammate's personal notification.
    owner_rows = [n for n in await _notifications(client, owner) if n["kind"] == "mention"]
    assert owner_rows == []


@pytest.mark.asyncio
async def test_mention_added_on_note_edit_notifies_target(client: AsyncClient):
    """Editing a note to add a mention pings the teammate exactly once."""
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "edited-in@example.com")
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "edited-in@example.com")

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": "Plain note without any mention."},
    )
    assert r.status_code == 200, r.text
    note_id = r.json()["id"]
    assert [n for n in await _notifications(client, teammate) if n["kind"] == "mention"] == []

    r = await client.patch(
        f"/api/signals/{signal_id}/notes/{note_id}",
        headers=owner,
        json={"body_text": f"Forgot to ping you @[Teammate](user:{num})"},
    )
    assert r.status_code == 200, r.text
    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "mention"]
    assert len(rows) == 1
    assert rows[0]["payload"]["signal_id"] == signal_id

    # Editing again without changing the mention does not re-notify.
    r = await client.patch(
        f"/api/signals/{signal_id}/notes/{note_id}",
        headers=owner,
        json={"body_text": f"Still yours @[Teammate](user:{num}) - updated wording"},
    )
    assert r.status_code == 200
    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "mention"]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_self_mention_is_ignored(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, TEST_EMAIL)

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": f"Note to self @[Me](user:{num})"},
    )
    assert r.status_code == 200
    rows = [n for n in await _notifications(client, owner) if n["kind"] == "mention"]
    assert rows == []


@pytest.mark.asyncio
async def test_mention_respects_preference(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "quiet@example.com")
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "quiet@example.com")

    # Teammate turns off mention notifications (desktop channel).
    r = await client.patch(
        "/api/user/notification-preferences",
        headers=teammate,
        json={
            "rows": [
                {"id": "mentions", "label": "Mentions", "channels": {"desktop": False}}
            ]
        },
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": f"Ping @[Quiet](user:{num})"},
    )
    assert r.status_code == 200
    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "mention"]
    assert rows == []


@pytest.mark.asyncio
async def test_assignment_notifies_assignee(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "assignee@example.com")
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "assignee@example.com")

    r = await client.patch(
        f"/api/signals/{signal_id}",
        headers=owner,
        json={"assigned_to_user_id": num},
    )
    assert r.status_code == 200, r.text

    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "assignment"]
    assert len(rows) == 1
    assert "assigned" in rows[0]["title"]
    assert rows[0]["payload"]["signal_id"] == signal_id

    # Re-assigning to the same person does not re-notify.
    r = await client.patch(
        f"/api/signals/{signal_id}",
        headers=owner,
        json={"assigned_to_user_id": num},
    )
    assert r.status_code == 200
    rows = [n for n in await _notifications(client, teammate) if n["kind"] == "assignment"]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_self_assignment_not_notified(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, TEST_EMAIL)

    r = await client.patch(
        f"/api/signals/{signal_id}",
        headers=owner,
        json={"assigned_to_user_id": num},
    )
    assert r.status_code == 200
    rows = [n for n in await _notifications(client, owner) if n["kind"] == "assignment"]
    assert rows == []
