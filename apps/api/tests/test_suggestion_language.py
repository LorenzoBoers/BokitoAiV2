"""AI language policy: reply language (mirror the customer or pinned) and
workspace language (team-facing summaries)."""

import json

import pytest
from httpx import AsyncClient

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.language import (
    normalize_platform_language,
    platform_default_ui_language,
    reply_language_instruction,
    resolve_reply_language,
    resolve_workspace_language,
    workspace_language_instruction,
)
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _tenant(settings: dict | None = None) -> Tenant:
    return Tenant(slug="t", name="T", settings_json=json.dumps(settings or {}))


def _account(ai_config: dict | None = None) -> ChannelAccount:
    return ChannelAccount(
        tenant_id=None,
        channel="email",
        provider="outlook",
        address="a@b.c",
        settings_json=json.dumps({"ai_config": ai_config or {}}),
    )


# ---------------------------------------------------------------------------
# Resolution precedence
# ---------------------------------------------------------------------------


def test_reply_language_defaults_to_auto():
    assert resolve_reply_language(_tenant(), None) == "auto"
    assert resolve_reply_language(None, None) == "auto"


def test_reply_language_tenant_setting():
    tenant = _tenant({"ai_reply_language": "nl"})
    assert resolve_reply_language(tenant, None) == "nl"


def test_reply_language_mailbox_overrides_tenant():
    tenant = _tenant({"ai_reply_language": "nl"})
    account = _account({"reply_language": "en"})
    assert resolve_reply_language(tenant, account) == "en"


def test_reply_language_ignores_invalid_values():
    tenant = _tenant({"ai_reply_language": "klingon"})
    account = _account({"reply_language": 42})
    assert resolve_reply_language(tenant, account) == "auto"


def test_platform_language_normalizes_to_nl_or_en():
    assert normalize_platform_language("en") == "en"
    assert normalize_platform_language("NL") == "nl"
    assert normalize_platform_language("") == "nl"
    assert normalize_platform_language("fr") == "nl"
    assert normalize_platform_language(None) == "nl"
    assert platform_default_ui_language() in ("en", "nl")


def test_workspace_language_defaults_to_platform():
    expected = platform_default_ui_language()
    assert resolve_workspace_language(_tenant()) == expected
    assert resolve_workspace_language(None) == expected


def test_workspace_language_tenant_setting():
    assert resolve_workspace_language(_tenant({"ai_workspace_language": "nl"})) == "nl"


# ---------------------------------------------------------------------------
# Prompt instructions
# ---------------------------------------------------------------------------


def test_auto_instruction_mirrors_customer():
    text = reply_language_instruction("auto")
    assert "same language as the customer" in text


def test_fixed_instruction_names_language():
    assert "Dutch" in reply_language_instruction("nl")
    assert "German" in reply_language_instruction("de")


def test_workspace_instruction_covers_no_reply_summary():
    text = workspace_language_instruction("nl")
    assert "Dutch" in text
    assert "NO_REPLY_NEEDED" in text


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ai_modes_roundtrip_with_languages(client: AsyncClient):
    headers = await _login(client)

    r = await client.get("/api/settings/ai-modes", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply_language"] == "auto"
    assert body["workspace_language"] == platform_default_ui_language()

    r = await client.put(
        "/api/settings/ai-modes",
        headers=headers,
        json={"reply_language": "auto", "workspace_language": "nl"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["workspace_language"] == "nl"

    r = await client.get("/api/settings/ai-modes", headers=headers)
    assert r.json()["workspace_language"] == "nl"
    # channel modes untouched
    assert r.json()["channel_ai_modes"]["email"] in ("suggest", "auto", "off")


@pytest.mark.asyncio
async def test_ai_modes_rejects_invalid_language(client: AsyncClient):
    headers = await _login(client)
    r = await client.put(
        "/api/settings/ai-modes", headers=headers, json={"reply_language": "xx"}
    )
    assert r.status_code == 400
    r = await client.put(
        "/api/settings/ai-modes", headers=headers, json={"workspace_language": "auto"}
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_mailbox_ai_config_reply_language(client: AsyncClient):
    headers = await _login(client)
    listing = await client.get("/api/email/accounts", headers=headers)
    assert listing.status_code == 200, listing.text
    connections = listing.json()
    assert connections
    conn_id = connections[0]["id"]

    r = await client.put(
        f"/api/email/connections/{conn_id}/ai-config",
        headers=headers,
        json={"ai_config": {"mode": "suggest", "reply_language": "nl"}},
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"/api/email/connections/{conn_id}/ai-config", headers=headers)
    assert r.json()["ai_config"]["reply_language"] == "nl"

    # Empty string clears the override.
    r = await client.put(
        f"/api/email/connections/{conn_id}/ai-config",
        headers=headers,
        json={"ai_config": {"mode": "suggest", "reply_language": ""}},
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/email/connections/{conn_id}/ai-config", headers=headers)
    assert "reply_language" not in r.json()["ai_config"]

    # Invalid values are rejected.
    r = await client.put(
        f"/api/email/connections/{conn_id}/ai-config",
        headers=headers,
        json={"ai_config": {"reply_language": "xx"}},
    )
    assert r.status_code == 400
