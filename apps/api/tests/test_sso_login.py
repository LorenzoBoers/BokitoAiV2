"""Platform SSO: Sign in with Microsoft / Google."""

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


def _configure_google():
    settings = get_settings()
    return patch.multiple(
        settings,
        google_oauth_client_id="google-client-id",
        google_oauth_client_secret="google-secret",
    )


async def _seed_login_state(
    session: AsyncSession,
    *,
    state: str = "sso-state-1",
    expired: bool = False,
    provider: str = "outlook",
) -> OAuthState:
    row = OAuthState(
        state=state,
        tenant_id=None,
        user_id=None,
        provider=provider,
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
    google = await client.get("/api/auth/google/start", params={"return_url": "http://test/app"})
    assert google.status_code == 503


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
    # Platform SSO may reuse the current Microsoft session; mailbox connect does not.
    assert "prompt" not in parse_qs(urlparse(authorize_url).query)

    state_value = parse_qs(urlparse(authorize_url).query)["state"][0]
    row = (
        await session_override.execute(select(OAuthState).where(OAuthState.state == state_value))
    ).scalar_one()
    assert row.flow == "login"
    assert row.tenant_id is None


@pytest.mark.asyncio
async def test_google_sso_start_uses_identity_scopes(
    client: AsyncClient, session_override: AsyncSession
):
    with _configure_google():
        res = await client.get(
            "/api/auth/google/start", params={"return_url": "http://test/app"}
        )
    assert res.status_code == 200
    authorize_url = res.json()["authorize_url"]
    assert "accounts.google.com" in authorize_url
    query = parse_qs(urlparse(authorize_url).query)
    scope = query["scope"][0]
    assert "openid" in scope
    assert "email" in scope
    assert "profile" in scope
    assert "gmail.modify" not in scope
    assert "gmail.send" not in scope
    assert query.get("prompt") == ["select_account"]
    assert "access_type" not in query

    state_value = query["state"][0]
    row = (
        await session_override.execute(select(OAuthState).where(OAuthState.state == state_value))
    ).scalar_one()
    assert row.flow == "login"
    assert row.provider == "gmail"
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
                return_value={
                    "email": "Bjorn@Accountancy.se",
                    "name": "Bjorn Revisor",
                    "subject": "ms-oid-bjorn-1",
                }
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
async def test_google_sso_callback_new_user_provisions_and_logs_in(
    client: AsyncClient, session_override: AsyncSession
):
    await _seed_login_state(
        session_override, state="google-sso-new", provider="gmail"
    )

    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "gat"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={
                    "email": "Casper@Bokito.ai",
                    "name": "Casper",
                    "subject": "google-sub-casper-1",
                }
            ),
        ),
    ):
        res = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "google-sso-new", "code": "g-code"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "sso=connected" in res.headers["location"]
    assert "bokito_refresh_token=" in res.headers.get("set-cookie", "")

    user = (
        await session_override.execute(select(User).where(User.email == "casper@bokito.ai"))
    ).scalar_one()
    assert user.email_verified is True
    assert user.password_hash == ""

    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["user"]["email"] == "casper@bokito.ai"


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
            new=AsyncMock(return_value={"email": TEST_EMAIL, "name": "Existing", "subject": "ms-oid-existing"}),
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
            new=AsyncMock(return_value={"email": "setpw@firm.se", "name": "Set PW", "subject": "ms-oid-setpw"}),
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


@pytest.mark.asyncio
async def test_sso_login_upserts_identity(
    client: AsyncClient, session_override: AsyncSession
):
    from app.models.user_identity import UserIdentity

    await _seed_login_state(session_override, state="sso-identity")
    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={
                    "email": "ident@firm.se",
                    "name": "Ident",
                    "subject": "ms-oid-ident-1",
                }
            ),
        ),
    ):
        res = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-identity", "code": "auth-code"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    user = (
        await session_override.execute(select(User).where(User.email == "ident@firm.se"))
    ).scalar_one()
    row = (
        await session_override.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == user.id,
                UserIdentity.provider == "microsoft",
            )
        )
    ).scalar_one()
    assert row.subject == "ms-oid-ident-1"
    assert row.email_at_link == "ident@firm.se"

    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["user"]["has_password"] is False


@pytest.mark.asyncio
async def test_sso_link_and_unlink(
    client: AsyncClient, session_override: AsyncSession
):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    from app.models.user_identity import UserIdentity

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["user"]["has_password"] is True

    listed = await client.get(
        "/api/auth/sso/identities",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listed.status_code == 200
    body = listed.json()
    assert body["has_password"] is True
    assert {p["id"] for p in body["providers"]} == {"google", "microsoft"}

    with _configure_google():
        start = await client.get(
            "/api/auth/sso/google/link/start",
            headers={"Authorization": f"Bearer {token}"},
            params={"return_url": "http://test/app/settings/profile"},
        )
    assert start.status_code == 200
    authorize_url = start.json()["authorize_url"]
    state_value = parse_qs(urlparse(authorize_url).query)["state"][0]
    row = (
        await session_override.execute(select(OAuthState).where(OAuthState.state == state_value))
    ).scalar_one()
    assert row.flow == "link"
    assert row.user_id is not None

    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "gat"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={
                    "email": TEST_EMAIL,
                    "name": "Seed",
                    "subject": "google-sub-seed-1",
                }
            ),
        ),
    ):
        cb = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": state_value, "code": "g-code"},
            follow_redirects=False,
        )
    assert cb.status_code == 302
    assert "sso=linked" in cb.headers["location"]

    identity = (
        await session_override.execute(
            select(UserIdentity).where(UserIdentity.subject == "google-sub-seed-1")
        )
    ).scalar_one()
    assert identity.provider == "google"

    unlink = await client.delete(
        "/api/auth/sso/google",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlink.status_code == 200
    assert unlink.json()["providers"][0]["linked"] is False


@pytest.mark.asyncio
async def test_sso_unlink_blocked_when_last_method(
    client: AsyncClient, session_override: AsyncSession
):
    from app.models.user_identity import UserIdentity
    from app.services.tenant_bootstrap import bootstrap_tenant, default_tenant_settings, serialize_settings
    from app.models.auth import Tenant

    tenant = Tenant(
        slug="sso-only-ws",
        name="SSO Only",
        settings_json=serialize_settings(default_tenant_settings()),
    )
    user = User(email="onlysso@firm.se", password_hash="", email_verified=True)
    session_override.add(tenant)
    session_override.add(user)
    await session_override.flush()
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    user.last_tenant_id = tenant.id
    session_override.add(
        UserIdentity(
            user_id=user.id,
            provider="microsoft",
            subject="ms-only-1",
            email_at_link="onlysso@firm.se",
        )
    )
    await bootstrap_tenant(session_override, tenant.id)
    await session_override.commit()

    await _seed_login_state(session_override, state="sso-only-login")
    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={
                    "email": "onlysso@firm.se",
                    "name": "Only",
                    "subject": "ms-only-1",
                }
            ),
        ),
    ):
        await client.get(
            "/api/integrations/oauth/callback",
            params={"state": "sso-only-login", "code": "auth-code"},
            follow_redirects=False,
        )
    session_res = await client.post("/api/auth/refresh")
    token = session_res.json()["access_token"]

    blocked = await client.delete(
        "/api/auth/sso/microsoft",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert blocked.status_code == 403


@pytest.mark.asyncio
async def test_sso_link_rejects_subject_taken(
    client: AsyncClient, session_override: AsyncSession
):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    from app.models.user_identity import UserIdentity

    other = User(email="other@firm.se", password_hash="", email_verified=True)
    session_override.add(other)
    await session_override.flush()
    session_override.add(
        UserIdentity(
            user_id=other.id,
            provider="google",
            subject="google-taken-1",
            email_at_link="other@firm.se",
        )
    )
    await session_override.commit()

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    token = login.json()["access_token"]

    with _configure_google():
        start = await client.get(
            "/api/auth/sso/google/link/start",
            headers={"Authorization": f"Bearer {token}"},
            params={"return_url": "http://test/app/settings/profile"},
        )
    state_value = parse_qs(urlparse(start.json()["authorize_url"]).query)["state"][0]

    with (
        patch(
            "app.services.oauth_flow.oauth_providers.exchange_code",
            new=AsyncMock(return_value={"access_token": "gat"}),
        ),
        patch(
            "app.services.oauth_flow.oauth_providers.fetch_identity",
            new=AsyncMock(
                return_value={
                    "email": TEST_EMAIL,
                    "name": "Seed",
                    "subject": "google-taken-1",
                }
            ),
        ),
    ):
        cb = await client.get(
            "/api/integrations/oauth/callback",
            params={"state": state_value, "code": "g-code"},
            follow_redirects=False,
        )
    assert cb.status_code == 302
    assert "sso_error=subject_taken" in cb.headers["location"]
