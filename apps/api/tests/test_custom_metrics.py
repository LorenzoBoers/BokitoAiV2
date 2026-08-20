"""Custom cockpit metrics: /api/metrics CRUD + points, record_metric agent tool."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_metric_crud_and_points(client: AsyncClient):
    headers = await _headers(client)

    create = await client.post(
        "/api/metrics",
        headers=headers,
        json={"label": "Open tickets", "unit": "count", "target": 5},
    )
    assert create.status_code == 200, create.text
    metric = create.json()
    assert metric["key"] == "open_tickets"
    assert metric["unit"] == "count"
    assert metric["latest_value"] is None

    # First point: latest value, no delta yet.
    p1 = await client.post(
        f"/api/metrics/{metric['id']}/points",
        headers=headers,
        json={"value": 12, "note": "start of week"},
    )
    assert p1.status_code == 200, p1.text
    assert p1.json()["latest_value"] == 12
    assert p1.json()["delta"] is None

    # Second point: delta against the previous observation.
    p2 = await client.post(
        f"/api/metrics/{metric['id']}/points", headers=headers, json={"value": 8}
    )
    assert p2.status_code == 200
    assert p2.json()["latest_value"] == 8
    assert p2.json()["delta"] == -4

    listing = await client.get("/api/metrics", headers=headers)
    assert listing.status_code == 200
    items = listing.json()["items"]
    row = next(m for m in items if m["id"] == metric["id"])
    assert row["latest_value"] == 8

    points = await client.get(f"/api/metrics/{metric['id']}/points", headers=headers)
    assert points.status_code == 200
    assert [p["value"] for p in points.json()["items"]] == [8, 12]

    patched = await client.patch(
        f"/api/metrics/{metric['id']}",
        headers=headers,
        json={"label": "Tickets open", "target": 3},
    )
    assert patched.status_code == 200
    assert patched.json()["label"] == "Tickets open"
    assert patched.json()["target"] == 3

    deleted = await client.delete(f"/api/metrics/{metric['id']}", headers=headers)
    assert deleted.status_code == 200
    listing2 = await client.get("/api/metrics", headers=headers)
    assert all(m["id"] != metric["id"] for m in listing2.json()["items"])


@pytest.mark.asyncio
async def test_record_metric_tool_creates_and_appends(client: AsyncClient, session_override):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.tools.builtin import _list_metrics, _record_metric
    from app.tools.registry import ToolContext

    tenant = (await session_override.execute(select(Tenant).limit(1))).scalars().first()
    assert tenant is not None
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=None)

    # First call creates the metric definition on the fly.
    out = await _record_metric(
        ctx, {"key": "MRR", "label": "Monthly recurring revenue", "value": 1500, "unit": "currency"}
    )
    assert out.get("error") is None
    assert out["key"] == "mrr"
    assert out["value"] == 1500

    out2 = await _record_metric(ctx, {"key": "mrr", "value": 1750})
    assert out2["value"] == 1750

    listed = await _list_metrics(ctx, {})
    row = next(m for m in listed["metrics"] if m["key"] == "mrr")
    assert row["latest_value"] == 1750
    assert row["delta"] == 250

    bad = await _record_metric(ctx, {"key": "mrr", "value": "not-a-number"})
    assert "error" in bad
