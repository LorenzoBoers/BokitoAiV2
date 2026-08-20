"""Member lifecycle & transactional mail: driver selection, invite hardening,
session hygiene and the soft email-verification gate."""

import asyncio
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.models.auth import Session, User
from app.models.signal import Signal, SignalEvent
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

REFRESH_COOKIE = get_settings().refresh_cookie_name


async def _login(client: AsyncClient, email: str, password: str) -> str:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _owner_headers(client: AsyncClient) -> dict:
    token = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


async def _workspace_id(client: AsyncClient, headers: dict) -> str:
    r = await client.get("/api/app/workspaces", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


async def _invite(client: AsyncClient, headers: dict, ws: str, email: str, role: str = "member") -> dict:
    r = await client.post(
        "/api/app/workspace-invites",
        headers=headers,
        json={"workspace_id": ws, "email": email, "role": role},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _reset_invite_resend_history():
    from app.services import workspaces_portal

    workspaces_portal._resend_history.clear()
    yield
    workspaces_portal._resend_history.clear()


# --- Mail driver selection + fallback -----------------------------------------


def test_mail_unconfigured_by_default():
    from app.services import transactional_mail as tm

    assert tm.mail_configured() is False


@pytest.mark.asyncio
async def test_send_mail_returns_false_and_logs_when_unconfigured():
    from app.services import transactional_mail as tm

    assert await tm.send_mail("a@b.c", "Subject", "Body") is False


@pytest.mark.asyncio
async def test_send_mail_schedules_delivery_when_resend_configured(monkeypatch):
    from app.services import transactional_mail as tm

    fake = get_settings().model_copy(update={"resend_api_key": "re_test_key"})
    monkeypatch.setattr(tm, "get_settings", lambda: fake)

    delivered: list[tuple] = []

    async def fake_retry(to, subject, text, html, kind):
        delivered.append((to, subject, kind))

    monkeypatch.setattr(tm, "_deliver_with_retry", fake_retry)
    assert await tm.send_mail("a@b.c", "Subject", "Body", kind="invite") is True
    # Give the fire-and-forget task a tick to run.
    await asyncio.sleep(0)
    assert delivered == [("a@b.c", "Subject", "invite")]


@pytest.mark.asyncio
async def test_delivery_falls_back_to_smtp_when_resend_fails(monkeypatch):
    from app.services import transactional_mail as tm

    fake = get_settings().model_copy(
        update={"resend_api_key": "re_test_key", "smtp_host": "smtp.test.local"}
    )
    monkeypatch.setattr(tm, "get_settings", lambda: fake)

    async def failing_resend(to, subject, text, html):
        raise RuntimeError("resend down")

    smtp_calls: list[str] = []

    def fake_smtp(to, subject, text, html):
        smtp_calls.append(to)

    monkeypatch.setattr(tm, "_deliver_resend", failing_resend)
    monkeypatch.setattr(tm, "_deliver_smtp_sync", fake_smtp)
    await tm._attempt_delivery("a@b.c", "Subject", "Body", None)
    assert smtp_calls == ["a@b.c"]


@pytest.mark.asyncio
async def test_delivery_raises_when_all_providers_fail(monkeypatch):
    from app.services import transactional_mail as tm

    fake = get_settings().model_copy(update={"resend_api_key": "re_test_key"})
    monkeypatch.setattr(tm, "get_settings", lambda: fake)

    async def failing_resend(to, subject, text, html):
        raise RuntimeError("resend down")

    monkeypatch.setattr(tm, "_deliver_resend", failing_resend)
    with pytest.raises(RuntimeError):
        await tm._attempt_delivery("a@b.c", "Subject", "Body", None)


def test_html_template_escapes_and_renders_cta():
    from app.services.transactional_mail import render_mail_html

    html = render_mail_html(
        title="Join <Acme>",
        paragraphs=["Hello & welcome"],
        cta_label="Accept invite",
        cta_url="https://app.test/accept?token=a&b",
        footer="Expires in 7 days",
    )
    assert "Join &lt;Acme&gt;" in html
    assert "Hello &amp; welcome" in html
    assert "Accept invite" in html
    assert "https://app.test/accept?token=a&amp;b" in html
    assert "Expires in 7 days" in html


def test_production_warns_when_no_mail_provider():
    from app.config import Settings, production_config_warnings

    prod = Settings(environment="prod", _env_file=None)
    warnings = production_config_warnings(prod)
    assert any("mail provider" in w for w in warnings)
    assert production_config_warnings(Settings(environment="dev", _env_file=None)) == []
    configured = Settings(environment="prod", resend_api_key="re_x", _env_file=None)
    assert production_config_warnings(configured) == []


# --- Invite hardening ----------------------------------------------------------


@pytest.mark.asyncio
async def test_invite_dedupe_replaces_pending_invite(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)

    first = await _invite(client, headers, ws, "dupe@example.com")
    second = await _invite(client, headers, ws, "dupe@example.com", role="admin")

    # Same row, rotated token, updated role — no stacked duplicates.
    assert first["id"] == second["id"]
    assert first["invite_link"] != second["invite_link"]
    assert second["role"] == "admin"
    r = await client.get(f"/api/app/workspaces/{ws}/invites", headers=headers)
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_inviting_existing_member_is_rejected(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    r = await client.post(
        "/api/app/workspace-invites",
        headers=headers,
        json={"workspace_id": ws, "email": TEST_EMAIL, "role": "member"},
    )
    assert r.status_code == 400
    assert "already a member" in r.json()["error"]["message"]


@pytest.mark.asyncio
async def test_invite_resend_rotates_token_and_rate_limits(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    invite = await _invite(client, headers, ws, "slow@example.com")

    links = {invite["invite_link"]}
    for _ in range(3):
        r = await client.post(
            f"/api/app/workspaces/{ws}/invites/{invite['id']}/resend", headers=headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mail_sent"] is False  # no provider in tests
        links.add(body["invite_link"])
    # Every resend rotated the token.
    assert len(links) == 4

    # Fourth resend within the window is throttled.
    r = await client.post(
        f"/api/app/workspaces/{ws}/invites/{invite['id']}/resend", headers=headers
    )
    assert r.status_code == 429

    # The old (pre-rotation) token no longer resolves.
    old_token = invite["invite_link"].split("token=")[1]
    r = await client.get("/api/auth/invite-info", params={"token": old_token})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_resend_unknown_invite_404(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    r = await client.post(
        f"/api/app/workspaces/{ws}/invites/00000000-0000-0000-0000-000000000000/resend",
        headers=headers,
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_accept_invite_marks_email_verified(client: AsyncClient, session_override):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    invite = await _invite(client, headers, ws, "fresh@example.com")
    token = invite["invite_link"].split("token=")[1]

    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": "freshpass123", "display_name": "Fresh"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email_verified"] is True

    user = (
        await session_override.execute(select(User).where(User.email == "fresh@example.com"))
    ).scalar_one()
    assert user.email_verified is True


# --- Session & removal hygiene --------------------------------------------------


@pytest.mark.asyncio
async def test_member_removal_revokes_sessions_and_unassigns_threads(
    client: AsyncClient, session_override
):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)

    invite = await _invite(client, headers, ws, "leaver@example.com")
    token = invite["invite_link"].split("token=")[1]
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": "leaverpass123", "display_name": "Leaver"},
    )
    assert r.status_code == 200, r.text

    leaver = (
        await session_override.execute(select(User).where(User.email == "leaver@example.com"))
    ).scalar_one()
    sessions = (
        await session_override.execute(select(Session).where(Session.user_id == leaver.id))
    ).scalars().all()
    assert sessions, "accepting the invite must create a refresh session"

    # A thread assigned to the leaver.
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Handover",
            "body_text": "Who owns this?",
            "contact_email": "cust@example.com",
        },
    )
    assert r.status_code == 200, r.text
    signal_id = r.json()["id"]
    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(signal_id)))
    ).scalar_one()
    signal.assigned_user_id = leaver.id
    session_override.add(signal)
    await session_override.commit()

    # Remove the member.
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    leaver_row = next(m for m in r.json() if m["email"] == "leaver@example.com")
    r = await client.delete(
        f"/api/app/workspaces/{ws}/members/{leaver_row['uuid']}", headers=headers
    )
    assert r.status_code == 200, r.text

    # Thread is back in the unassigned queue with an audit event.
    await session_override.refresh(signal)
    assert signal.assigned_user_id is None
    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id, SignalEvent.event_type == "unassigned"
            )
        )
    ).scalars().all()
    assert events

    # Last membership gone: refresh sessions revoked.
    sessions = (
        await session_override.execute(select(Session).where(Session.user_id == leaver.id))
    ).scalars().all()
    assert sessions == []


@pytest.mark.asyncio
async def test_logout_deletes_server_side_session(client: AsyncClient):
    await _login(client, TEST_EMAIL, TEST_PASSWORD)
    raw_cookie = client.cookies.get(REFRESH_COOKIE)
    assert raw_cookie

    r = await client.post("/api/auth/refresh")
    assert r.status_code == 200

    r = await client.post("/api/auth/logout")
    assert r.status_code == 200

    # Replay the old cookie: the Session row is gone, so refresh must fail.
    client.cookies.set(REFRESH_COOKIE, raw_cookie)
    r = await client.post("/api/auth/refresh")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_revokes_all_sessions(client: AsyncClient, session_override):
    await _login(client, TEST_EMAIL, TEST_PASSWORD)
    old_cookie = client.cookies.get(REFRESH_COOKIE)
    assert old_cookie

    r = await client.post("/api/auth/password-reset-request", json={"email": TEST_EMAIL})
    token = r.json().get("dev_token")
    assert token
    r = await client.post(
        "/api/auth/password-reset", json={"token": token, "password": "resetpass123"}
    )
    assert r.status_code == 200, r.text

    user = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalar_one()
    sessions = (
        await session_override.execute(select(Session).where(Session.user_id == user.id))
    ).scalars().all()
    assert sessions == []

    # Old refresh cookie is dead.
    client.cookies.set(REFRESH_COOKIE, old_cookie)
    r = await client.post("/api/auth/refresh")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_change_password_rotates_sessions_keeping_current_device(
    client: AsyncClient, session_override
):
    token = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}
    # A second device/session that must be revoked.
    await _login(client, TEST_EMAIL, TEST_PASSWORD)

    user = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalar_one()
    before = (
        await session_override.execute(select(Session).where(Session.user_id == user.id))
    ).scalars().all()
    assert len(before) >= 2

    r = await client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": TEST_PASSWORD, "new_password": "changedpass123"},
    )
    assert r.status_code == 200, r.text

    after = (
        await session_override.execute(select(Session).where(Session.user_id == user.id))
    ).scalars().all()
    # All old sessions revoked; exactly the reissued one remains.
    assert len(after) == 1
    assert {s.id for s in after}.isdisjoint({s.id for s in before})

    # Fresh cookie from the change-password response still refreshes.
    r = await client.post("/api/auth/refresh")
    assert r.status_code == 200, r.text


# --- Soft verification gate ------------------------------------------------------


@pytest.mark.asyncio
async def test_unverified_signup_blocked_from_outbound_until_verified(client: AsyncClient):
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "unverified@example.com",
            "password": "unverified123",
            "tenant_slug": "unverified-co",
            "tenant_name": "Unverified Co",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email_verified"] is False
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Inbound ingestion works (not gated).
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Hello",
            "body_text": "Hi there",
            "contact_email": "someone@example.com",
        },
    )
    assert r.status_code == 200, r.text
    signal_id = r.json()["id"]

    # Outbound reply is gated.
    r = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "We are on it.", "action": "send"},
    )
    assert r.status_code == 403
    assert "Verify your email" in r.text

    # Connecting a mailbox is gated too.
    r = await client.get(
        "/api/email/oauth/start",
        headers=headers,
        params={"provider": "gmail", "return_url": "http://localhost:5174/settings"},
    )
    assert r.status_code == 403

    # Verify via the resend flow's dev token, then the gate opens.
    r = await client.post(
        "/api/auth/resend-verification", json={"email": "unverified@example.com"}
    )
    verify_token = r.json().get("dev_token")
    assert verify_token
    r = await client.post("/api/auth/verify-email", json={"token": verify_token})
    assert r.status_code == 200

    r = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "We are on it.", "action": "send"},
    )
    assert r.status_code == 200, r.text
