"""Per-site website chat channels."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _owner(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_widget_channel_page_and_extra_site(client: AsyncClient):
    headers = await _owner(client)
    listed = await client.get("/api/channels", headers=headers)
    assert listed.status_code == 200, listed.text
    widgets = [row for row in listed.json()["channels"] if row["kind"] == "widget"]
    if not widgets:
        seeded = await client.post("/api/channels/widget", headers=headers, json={"label": "Website chat"})
        assert seeded.status_code == 201, seeded.text
        listed = await client.get("/api/channels", headers=headers)
        widgets = [row for row in listed.json()["channels"] if row["kind"] == "widget"]
    assert len(widgets) >= 1
    first = widgets[0]
    assert first["configure_href"] == f"/settings/channels/{first['id']}"
    assert "archive" in first["actions"]

    got = await client.get(f"/api/channels/accounts/{first['id']}/widget", headers=headers)
    assert got.status_code == 200, got.text
    body = got.json()
    assert "appearance" in body
    assert "pre_chat_form" in body

    put = await client.put(
        f"/api/channels/accounts/{first['id']}/widget",
        headers=headers,
        data={
            "appearance_json": '{"welcome_title":"Hello site"}',
            "pre_chat_form": "1",
        },
    )
    assert put.status_code == 200, put.text
    assert put.json()["pre_chat_form"] is True
    assert put.json()["appearance"].get("welcome_title") == "Hello site"

    created = await client.post("/api/channels/widget", headers=headers, json={"label": "Shop"})
    assert created.status_code == 201, created.text
    extra = created.json()
    assert extra["kind"] == "widget"
    assert extra["label"] == "Shop"
    assert "archive" in extra["actions"]

    listed = await client.get("/api/channels", headers=headers)
    widgets = [row for row in listed.json()["channels"] if row["kind"] == "widget"]
    assert len(widgets) == 2
    assert all("archive" in row["actions"] for row in widgets)

    session = await client.post(
        "/api/livechat/session/start",
        json={
            "tenant_subdomain": "test",
            "auth_mode": "anonymous",
            "channel_account_id": extra["id"],
        },
    )
    assert session.status_code == 200, session.text
    theme = session.json()["agent_config"]["theme"]
    assert theme["surface"] == "site"

    removed = await client.delete(f"/api/channels/accounts/{first['id']}", headers=headers)
    assert removed.status_code == 200, removed.text
    last = await client.delete(f"/api/channels/accounts/{extra['id']}", headers=headers)
    assert last.status_code == 200, last.text
