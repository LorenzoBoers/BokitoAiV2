"""Livechat widget compatibility endpoints."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post(
        "/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_session_start_returns_theme(client: AsyncClient):
    r = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "bokito-dashboard", "auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("session_token")
    assert body.get("identity_type") in ("anonymous", "authenticated")
    theme = body.get("agent_config", {}).get("theme", {})
    assert theme.get("main_color")
    assert body.get("tenant", {}).get("slug") == "test"


@pytest.mark.asyncio
async def test_session_start_resolves_assistant_name(client: AsyncClient):
    """Without a widget override the theme carries the company assistant's name."""
    r = await client.post(
        "/api/livechat/session/start",
        json={"auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert r.status_code == 200
    theme = r.json()["agent_config"]["theme"]
    assert theme["chatbot_name"] == "Test Assistant"
    assert theme["locale"] in ("nl", "en")
    assert theme["welcome_title"] in ("Welkom", "Welcome")


@pytest.mark.asyncio
async def test_widget_unread_counts_and_read_reset(client: AsyncClient, session_override):
    """Conversation lists report unread agent replies; reading the transcript resets them."""
    from datetime import datetime, timedelta

    from sqlalchemy import select as sa_select

    from app.models.auth import Tenant
    from app.models.channel import Contact
    from app.models.signal import Signal, SignalMessage

    r = await client.post(
        "/api/livechat/session/start",
        json={"auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert r.status_code == 200
    token = r.json()["session_token"]
    customer_id = r.json()["customer_id"]
    headers = {"Authorization": f"Bearer {token}"}

    tenant = (
        await session_override.execute(sa_select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    contact = Contact(tenant_id=tenant.id, channel="widget", address=customer_id)
    session_override.add(contact)
    await session_override.commit()
    await session_override.refresh(contact)
    signal = Signal(tenant_id=tenant.id, channel="widget", contact_id=contact.id, subject="Hi")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    now = datetime.utcnow()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            body_text="hello",
            created_at=now - timedelta(minutes=2),
        )
    )
    for i, offset in enumerate((1, 0)):
        session_override.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                kind="agent_message",
                body_text=f"reply {i}",
                created_at=now - timedelta(minutes=offset),
            )
        )
    await session_override.commit()

    r = await client.get("/api/livechat/customer/conversations", headers=headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["unread_count"] == 2

    # Fetching the transcript marks the thread as seen for this visitor.
    r = await client.get(f"/api/livechat/conversation/{signal.id}/messages", headers=headers)
    assert r.status_code == 200

    r = await client.get("/api/livechat/customer/conversations", headers=headers)
    assert r.json()["items"][0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_session_start_with_host_auth(client: AsyncClient):
    headers = await _auth_headers(client)
    token = headers["Authorization"].removeprefix("Bearer ").strip()
    r = await client.post(
        "/api/livechat/session/start",
        json={
            "agent_slug": "bokito-dashboard",
            "auth_mode": "optional",
            "host_auth_token": token,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("identity_type") == "authenticated"
    assert body.get("user", {}).get("email") == TEST_EMAIL


def test_theme_inherits_branding_mark():
    from app.models.auth import Tenant
    from app.services.livechat_compat import livechat_theme_from_tenant

    tenant = Tenant(
        slug="bourgondienadvies",
        name="Bourgondiënadvies",
        logo_url="https://cdn.example/logo.png",
        settings_json='{"favicon_url":"https://cdn.example/fav.png"}',
    )
    theme = livechat_theme_from_tenant(tenant)
    assert theme["widget_favicon_url"] == "https://cdn.example/fav.png"

    no_favicon = Tenant(slug="demo", name="Demo", logo_url="https://cdn.example/logo.png", settings_json="{}")
    assert livechat_theme_from_tenant(no_favicon)["widget_favicon_url"] == "https://cdn.example/logo.png"

    platform = Tenant(slug="bokito", name="Bokito", logo_url="/bokito-logo.svg", settings_json="{}")
    assert livechat_theme_from_tenant(platform)["widget_favicon_url"] == ""


def test_theme_name_chain_and_locale_defaults():
    """Widget name: explicit override -> assistant name -> tenant name. Never Bokito AI."""
    import json

    from app.models.auth import Tenant
    from app.services.livechat_compat import livechat_theme_from_tenant

    plain = Tenant(slug="demo", name="Bourgondiënadvies", settings_json="{}")
    theme = livechat_theme_from_tenant(plain)
    assert theme["chatbot_name"] == "Bourgondiënadvies"

    # A customized assistant name wins over the tenant name.
    assert livechat_theme_from_tenant(plain, assistant_name="Bo")["chatbot_name"] == "Bo"

    # An explicit widget override beats everything.
    explicit = Tenant(
        slug="demo",
        name="Bourgondiënadvies",
        settings_json=json.dumps(
            {"livechat_settings": {"appearance": {"chatbot_name": "Support"}}}
        ),
    )
    assert livechat_theme_from_tenant(explicit, assistant_name="Bo")["chatbot_name"] == "Support"

    # The generic bootstrap name "Assistant" is not a deliberate choice.
    generic = Tenant(
        slug="demo",
        name="Bourgondiënadvies",
        settings_json=json.dumps(
            {"livechat_settings": {"appearance": {"chatbot_name": "Assistant"}}}
        ),
    )
    assert livechat_theme_from_tenant(generic)["chatbot_name"] == "Bourgondiënadvies"


def test_theme_localized_welcome_defaults():
    import json

    from app.models.auth import Tenant
    from app.services.livechat_compat import livechat_theme_from_tenant

    dutch = Tenant(
        slug="nl", name="Demo", settings_json=json.dumps({"ai_workspace_language": "nl"})
    )
    theme = livechat_theme_from_tenant(dutch)
    assert theme["locale"] == "nl"
    assert theme["welcome_title"] == "Welkom"
    assert theme["welcome_subtitle"] == "Hoe kunnen we je helpen?"

    english = Tenant(
        slug="en", name="Demo", settings_json=json.dumps({"ai_workspace_language": "en"})
    )
    theme = livechat_theme_from_tenant(english)
    assert theme["locale"] == "en"
    assert theme["welcome_title"] == "Welcome"
    assert theme["welcome_subtitle"] == "How can we help?"

    # Explicit copy is never overridden by the defaults.
    custom = Tenant(
        slug="c",
        name="Demo",
        settings_json=json.dumps(
            {
                "ai_workspace_language": "nl",
                "livechat_settings": {"appearance": {"welcome_title": "Hoi!"}},
            }
        ),
    )
    theme = livechat_theme_from_tenant(custom)
    assert theme["welcome_title"] == "Hoi!"
    assert theme["welcome_subtitle"] == "Hoe kunnen we je helpen?"


@pytest.mark.asyncio
async def test_empty_conversations_hidden_from_history(client: AsyncClient, session_override):
    """Draft threads with no messages must not appear in the widget history list."""
    from sqlalchemy import select as sa_select

    from app.models.auth import Tenant
    from app.models.channel import Contact
    from app.models.signal import Signal, SignalMessage

    r = await client.post(
        "/api/livechat/session/start",
        json={"auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert r.status_code == 200
    token = r.json()["session_token"]
    customer_id = r.json()["customer_id"]
    headers = {"Authorization": f"Bearer {token}"}

    # POST /conversation creates an empty draft (same as the old "New chat" path).
    created = await client.post("/api/livechat/conversation", headers=headers, json={})
    assert created.status_code == 200
    empty_id = created.json()["conversation_id"]

    tenant = (
        await session_override.execute(sa_select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    contact = (
        await session_override.execute(
            sa_select(Contact).where(
                Contact.tenant_id == tenant.id,
                Contact.channel == "widget",
                Contact.address == customer_id,
            )
        )
    ).scalar_one()
    with_msg = Signal(
        tenant_id=tenant.id,
        channel="widget",
        contact_id=contact.id,
        subject="Real chat",
    )
    session_override.add(with_msg)
    await session_override.commit()
    await session_override.refresh(with_msg)
    session_override.add(
        SignalMessage(
            signal_id=with_msg.id,
            tenant_id=tenant.id,
            role="user",
            content="hello",
            channel="widget",
        )
    )
    await session_override.commit()

    listed = await client.get("/api/livechat/customer/conversations", headers=headers)
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()["items"]}
    assert empty_id not in ids
    assert str(with_msg.id) in ids
