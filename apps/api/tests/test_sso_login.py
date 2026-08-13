"""Cycle 29: Sign in with Microsoft (platform SSO)."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Membership, User
from app.models.oauth_state import OAuthState


def _configure_microsoft():
    settings = get_settings()
    return patch.multiple(
        settings,
        microsoft_oauth_client_id="test-client-id",
        microsoft_oauth_client_secret="test-secret",
    )


async def _seed_login_state(
    session: AsyncSession, *, state: str = "sso-state-1", expired: bool = False
) -> OAuthState:
    row = OAuthState(
        state=state,
        tenant_id=None,
        user_id=None,
        provider="outlook",
        flow="login",
        return_url="http://test/app",
        redirect_uri="http://test/api/integrations/oauth/callback",
    )
    if expired:
        row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    session.add(row)
    await session.commit()
    return row


@pytest.mark.asyncio
async def test_sso_start_unconfigured_returns_503(client: AsyncClient):
    res = await client.get("/api/auth/microsoft/start", params={"return_url": "http://test/app"})
    assert res.status_code == 503


@pytest.mark.asyncio
async def test_sso_start_uses_identity_scopes(client: AsyncClient, session_override: AsyncSession):
    with _configure_microsoft():
        res = await client.get(
            "/api/auth/microsoft/start", params={"return_url": "http://test/app"}
        )
    assert res.status_code == 200
    authorize_url = res.json()["authorize_url"]
    assert "login.microsoftonline.com" in authorize_url
    scope = parse_qs(urlparse(authorize_url).query)["scope"][0]
    assert "User.Read" in scope
    # SSO must not request mailbox scopes.
    assert "Mail.ReadWrite" not in scope
    assert "Mail.Send" not in scope

    state_value = parse_qs(urlparse(authorize_url).query)["state"][0]
    row = (
        await session_override.execute(select(OAuthState).where(OAuthState.state == state_value))
    ).scalar_one()
    assert row.flow == "login"
    assert row.tenant_id is None


@pytest.mark.asyncio
async def test_sso_callback_new_user_provisions_and_logs_in(
    client: AsyncClient, session_override: AsyncSession
):
    await _seed_login_state(session_override, state="sso-new-user")

    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={"email": "Bjorn@Accountancy.se", "name": "Bjorn Revisor"}
            ),
        ),
    ):
        res = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-new-user", "code": "auth-code"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    location = res.headers["location"]
    assert "sso=connected" in location
    set_cookie = res.headers.get("set-cookie", "")
    assert "bokito_refresh_token=" in set_cookie

    user = (
        await session_override.execute(
            select(User).where(User.email == "bjorn@accountancy.se")
        )
    ).scalar_one()
    assert user.email_verified is True
    assert user.password_hash == ""
    membership = (
        await session_override.execute(
            select(Membership).where(Membership.user_id == user.id)
        )
    ).scalar_one()
    assert membership.role == "owner"

    # The cookie from the redirect mints an app session via /auth/refresh.
    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    body = refreshed.json()
    assert body["user"]["email"] == "bjorn@accountancy.se"
    assert body["access_token"]


@pytest.mark.asyncio
async def test_sso_callback_links_existing_user(
    client: AsyncClient, session_override: AsyncSession
):
    from scripts.seed import TEST_EMAIL

    await _seed_login_state(session_override, state="sso-existing")
    before = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalar_one()
    original_hash = before.password_hash

    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(return_value={"email": TEST_EMAIL, "name": "Existing"}),
        ),
    ):
        res = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-existing", "code": "auth-code"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "sso=connected" in res.headers["location"]

    users = (
        (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
        .scalars()
        .all()
    )
    assert len(users) == 1
    # Linking must not touch the existing password.
    assert users[0].password_hash == original_hash
    assert users[0].email_verified is True


@pytest.mark.asyncio
async def test_sso_callback_expired_state(client: AsyncClient, session_override: AsyncSession):
    await _seed_login_state(session_override, state="sso-expired", expired=True)
    res = await client.get(
        "/api/integrations/oauth/callback",
        params={"state": "sso-expired", "code": "auth-code"},
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert "sso_error=expired_state" in res.headers["location"]
    assert "set-cookie" not in {k.lower() for k in res.headers.keys()} or (
        "bokito_refresh_token" not in res.headers.get("set-cookie", "")
    )


@pytest.mark.asyncio
async def test_sso_callback_without_email_fails(
    client: AsyncClient, session_override: AsyncSession
):
    await _seed_login_state(session_override, state="sso-no-email")
    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(return_value={"email": "", "name": "No Mail"}),
        ),
    ):
        res = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-no-email", "code": "auth-code"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "sso_error=no_email" in res.headers["location"]


@pytest.mark.asyncio
async def test_passwordless_user_cannot_password_login(
    client: AsyncClient, session_override: AsyncSession
):
    user = User(email="ssoonly@firm.se", password_hash="", email_verified=True)
    session_override.add(user)
    await session_override.commit()

    res = await client.post(
        "/api/auth/login", json={"email": "ssoonly@firm.se", "password": "anything123"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_passwordless_user_can_set_initial_password(
    client: AsyncClient, session_override: AsyncSession
):
    await _seed_login_state(session_override, state="sso-set-pw")
    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(return_value={"email": "setpw@firm.se", "name": "Set PW"}),
        ),
    ):
        await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-set-pw", "code": "auth-code"},
            follow_redirects=False,
        )
    session_res = await client.post("/api/auth/refresh")
    assert session_res.status_code == 200
    token = session_res.json()["access_token"]

    change = await client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "", "new_password": "brand-new-pass-1"},
    )
    assert change.status_code == 200, change.text

    login = await client.post(
        "/api/auth/login",
        json={"email": "setpw@firm.se", "password": "brand-new-pass-1"},
    )
    assert login.status_code == 200
