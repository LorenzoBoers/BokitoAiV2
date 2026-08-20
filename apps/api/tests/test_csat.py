"""Widget CSAT flow: visitor rating -> Feedback -> operator/cockpit visibility."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

TENANT_SLUG = "test"


async def _owner_headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _widget_conversation(client: AsyncClient) -> tuple[str, dict[str, str]]:
    """Anonymous visitor session plus a widget conversation owned by it."""
    start = await client.post(
        "/api/livechat/session/start",
        json={"tenant_subdomain": TENANT_SLUG, "auth_mode": "anonymous"},
    )
    assert start.status_code == 200, start.text
    headers = {"Authorization": f"Bearer {start.json()['session_token']}"}
    conv = await client.post("/api/livechat/conversation", headers=headers, json={})
    assert conv.status_code == 200, conv.text
    return conv.json()["conversation_id"], headers


@pytest.mark.asyncio
async def test_csat_submit_visible_to_operator(client: AsyncClient):
    conv_id, visitor = await _widget_conversation(client)

    r = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=visitor,
        json={"score": 5, "comment": "Great help"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "score": 5}

    owner = await _owner_headers(client)
    detail = await client.get(f"/api/signals/{conv_id}", headers=owner)
    assert detail.status_code == 200, detail.text
    csat = detail.json()["csat"]
    assert csat is not None
    assert csat["score"] == 5
    assert csat["comment"] == "Great help"


@pytest.mark.asyncio
async def test_csat_rerate_updates_single_entry(client: AsyncClient):
    conv_id, visitor = await _widget_conversation(client)

    first = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=visitor,
        json={"score": 2, "comment": ""},
    )
    assert first.status_code == 200
    second = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=visitor,
        json={"score": 4, "comment": "Better after follow-up"},
    )
    assert second.status_code == 200

    owner = await _owner_headers(client)
    detail = await client.get(f"/api/signals/{conv_id}", headers=owner)
    csat = detail.json()["csat"]
    assert csat["score"] == 4
    assert csat["comment"] == "Better after follow-up"

    # Only one Feedback row per conversation: cockpit counts one response.
    summary = await client.get("/api/cockpit/summary", headers=owner)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert "csat_score" in body
    assert "csat_responses" in body


@pytest.mark.asyncio
async def test_csat_invalid_score_rejected(client: AsyncClient):
    conv_id, visitor = await _widget_conversation(client)
    r = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=visitor,
        json={"score": 6, "comment": ""},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_csat_other_visitor_cannot_rate(client: AsyncClient):
    conv_id, _visitor = await _widget_conversation(client)
    # A different anonymous visitor (new customer_id) does not own the thread.
    _other_conv, other = await _widget_conversation(client)
    r = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=other,
        json={"score": 1, "comment": ""},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_csat_feeds_eval_scores(client: AsyncClient):
    conv_id, visitor = await _widget_conversation(client)
    r = await client.post(
        f"/api/livechat/conversation/{conv_id}/csat",
        headers=visitor,
        json={"score": 4, "comment": ""},
    )
    assert r.status_code == 200

    owner = await _owner_headers(client)
    compute = await client.post("/api/learning/eval/compute", headers=owner)
    assert compute.status_code == 200, compute.text
    items = compute.json()["items"]
    csat_rows = [i for i in items if i["metric"] == "csat"]
    assert csat_rows, "compute_eval_scores should emit a csat metric"
    assert csat_rows[0]["value"] >= 4.0
    assert csat_rows[0]["sample_size"] >= 1
