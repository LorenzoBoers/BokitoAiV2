"""Cycle 32: email delivery for notifications (assignment, mention, decisions) + VAPID."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _add_teammate(client: AsyncClient, owner: dict, email: str) -> dict:
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
            "subject": "VAT question",
            "body_text": "How do I file my VAT return?",
            "contact_email": "client@example.com",
            "contact_name": "Client",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _member_num(client: AsyncClient, headers: dict, email: str) -> int:
    r = await client.get("/api/signals/members", headers=headers)
    assert r.status_code == 200
    return next(m["id"] for m in r.json() if m["email"] == email)


async def _set_prefs(client: AsyncClient, headers: dict, rows: list[dict]) -> None:
    r = await client.patch(
        "/api/user/notification-preferences", headers=headers, json={"rows": rows}
    )
    assert r.status_code == 200, r.text


@pytest.fixture()
def sent_mails(monkeypatch):
    """Capture notification mails instead of hitting SMTP."""
    sent: list[dict] = []

    async def fake_send_mail(to: str, subject: str, text: str, html=None, **kwargs) -> bool:
        sent.append({"to": to, "subject": subject, "text": text, "html": html})
        return True

    monkeypatch.setattr("app.services.notification_mail.send_mail", fake_send_mail)
    return sent


@pytest.mark.asyncio
async def test_assignment_email_sent_when_enabled(client: AsyncClient, sent_mails):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "mailme@example.com")
    await _set_prefs(
        client,
        teammate,
        [
            {
                "id": "assigned-to-me",
                "label": "Assigned",
                "channels": {"desktop": True, "email": True},
            }
        ],
    )
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "mailme@example.com")

    r = await client.patch(
        f"/api/signals/{signal_id}", headers=owner, json={"assigned_to_user_id": num}
    )
    assert r.status_code == 200, r.text

    assert len(sent_mails) == 1
    assert sent_mails[0]["to"] == "mailme@example.com"
    assert "assigned" in sent_mails[0]["subject"]
    assert signal_id in sent_mails[0]["text"]

    # Desktop notification still created alongside the email.
    rows = (await client.get("/api/notifications", headers=teammate)).json()
    assert any(n["kind"] == "assignment" for n in rows)


@pytest.mark.asyncio
async def test_assignment_email_not_sent_by_default(client: AsyncClient, sent_mails):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    await _add_teammate(client, owner, "nomail@example.com")
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "nomail@example.com")

    r = await client.patch(
        f"/api/signals/{signal_id}", headers=owner, json={"assigned_to_user_id": num}
    )
    assert r.status_code == 200
    assert sent_mails == []


@pytest.mark.asyncio
async def test_email_only_assignment_skips_desktop_row(client: AsyncClient, sent_mails):
    """Desktop off + email on: mail is sent but no in-app notification is created."""
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "emailonly@example.com")
    await _set_prefs(
        client,
        teammate,
        [
            {
                "id": "assigned-to-me",
                "label": "Assigned",
                "channels": {"desktop": False, "email": True},
            }
        ],
    )
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "emailonly@example.com")

    r = await client.patch(
        f"/api/signals/{signal_id}", headers=owner, json={"assigned_to_user_id": num}
    )
    assert r.status_code == 200
    assert len(sent_mails) == 1
    rows = (await client.get("/api/notifications", headers=teammate)).json()
    assert not any(n["kind"] == "assignment" for n in rows)


@pytest.mark.asyncio
async def test_mention_email_sent_when_enabled(client: AsyncClient, sent_mails):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    teammate = await _add_teammate(client, owner, "mention-mail@example.com")
    await _set_prefs(
        client,
        teammate,
        [
            {
                "id": "mentions",
                "label": "Mentions",
                "channels": {"desktop": True, "email": True},
            }
        ],
    )
    signal_id = await _create_thread(client, owner)
    num = await _member_num(client, owner, "mention-mail@example.com")

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": f"Please review @[Teammate](user:{num})"},
    )
    assert r.status_code == 200, r.text

    assert len(sent_mails) == 1
    assert sent_mails[0]["to"] == "mention-mail@example.com"
    assert "mentioned you" in sent_mails[0]["subject"]
    assert signal_id in sent_mails[0]["text"]


@pytest.mark.asyncio
async def test_vapid_endpoint_503_when_unconfigured(client: AsyncClient):
    r = await client.get("/api/push/vapid-public-key")
    assert r.status_code == 503
