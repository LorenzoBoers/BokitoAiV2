"""P7: workspaces, invites, profile, branding."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

APP = "/api/app"
AUTH = "/api/auth"


async def _login(client: AsyncClient) -> tuple[str, str]:
    res = await client.post(f"{AUTH}/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    data = res.json()
    tenant_id = data["tenant"]["id"]
    return data["access_token"], tenant_id


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_workspaces_and_members(client: AsyncClient):
    token, tenant_id = await _login(client)
    headers = _auth(token)

    listed = await client.get(f"{APP}/workspaces", headers=headers)
    assert listed.status_code == 200
    workspaces = listed.json()
    assert isinstance(workspaces, list)
    assert len(workspaces) >= 1
    ws = workspaces[0]
    assert ws["name"]
    assert ws["slug"]
    assert str(ws["id"]) == tenant_id or ws.get("workspace_id")

    members = await client.get(f"{APP}/workspaces/{tenant_id}/members", headers=headers)
    assert members.status_code == 200
    member_rows = members.json()
    assert any(m["email"] == TEST_EMAIL for m in member_rows)


@pytest.mark.asyncio
async def test_workspace_invite_and_profile(client: AsyncClient):
    token, tenant_id = await _login(client)
    headers = _auth(token)

    invite = await client.post(
        f"{APP}/workspace-invites",
        headers=headers,
        json={"workspace_id": tenant_id, "email": "invitee@example.com", "role": "member"},
    )
    assert invite.status_code == 200
    assert invite.json()["email"] == "invitee@example.com"

    invites = await client.get(f"{APP}/workspaces/{tenant_id}/invites", headers=headers)
    assert invites.status_code == 200
    assert any(i["email"] == "invitee@example.com" for i in invites.json())

    profile = await client.patch(
        f"{AUTH}/profile",
        headers=headers,
        json={"name": "Portal User", "job_title": "Ops Lead"},
    )
    assert profile.status_code == 200
    assert profile.json()["name"] == "Portal User"
    assert profile.json()["job_title"] == "Ops Lead"


@pytest.mark.asyncio
async def test_change_password_and_branding(client: AsyncClient):
    token, tenant_id = await _login(client)
    headers = _auth(token)

    bad = await client.post(
        f"{AUTH}/change-password",
        headers=headers,
        json={"current_password": "wrong", "new_password": "newpass123"},
    )
    assert bad.status_code == 400

    branding = await client.post(
        f"{AUTH}/workspaces/{tenant_id}/branding",
        headers=headers,
        data={"name": "Branded Tenant", "subdomain": "test", "brand_color": "#112233"},
    )
    assert branding.status_code == 200
    body = branding.json()
    assert body["name"] == "Branded Tenant"
    assert body.get("brand_color") == "#112233" or body.get("livechat_settings", {}).get("main_color") == "#112233"


@pytest.mark.asyncio
async def test_update_require_2fa_and_delete(client: AsyncClient):
    token, tenant_id = await _login(client)
    headers = _auth(token)

    updated = await client.post(
        f"{APP}/workspaces/{tenant_id}",
        headers=headers,
        json={"require_2fa": True},
    )
    assert updated.status_code == 200
    assert updated.json()["require_2fa"] is True

    listed = await client.get(f"{APP}/workspaces", headers=headers)
    assert any(w.get("require_2fa") for w in listed.json())

    deleted = await client.delete(f"{APP}/workspaces/{tenant_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True


@pytest.mark.asyncio
async def test_branding_appearance_json(client: AsyncClient):
    token, tenant_id = await _login(client)
    headers = _auth(token)

    appearance = {
        "welcome_title": "Hello",
        "welcome_subtitle": "How can we help?",
        "chatbot_name": "Bokito",
        "main_color": "#00FF99",
    }
    branding = await client.post(
        f"{AUTH}/workspaces/{tenant_id}/branding",
        headers=headers,
        data={
            "appearance_json": __import__("json").dumps(appearance),
            "brand_color": "#00FF99",
        },
    )
    assert branding.status_code == 200
    settings = branding.json().get("livechat_settings") or {}
    stored = settings.get("appearance") or {}
    assert stored.get("welcome_title") == "Hello"
    assert stored.get("chatbot_name") == "Bokito"
