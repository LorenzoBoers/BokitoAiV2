"""One count rule: the rail, the folder list and the folder detail agree."""

import os

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _signal(session, tenant_id, subject: str, status: str = "open") -> Signal:
    signal = Signal(tenant_id=tenant_id, channel="widget", source="widget", subject=subject, status=status)
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


def _find(rows: list[dict], folder_id: str) -> dict | None:
    for row in rows:
        if row["id"] == folder_id:
            return row
        found = _find(row.get("children") or [], folder_id)
        if found is not None:
            return found
    return None


@pytest.mark.asyncio
async def test_rail_list_and_detail_share_counts_and_names(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    parent = await client.post("/api/folders", headers=headers, json={"name": "Clients", "tags": ["clients"]})
    assert parent.status_code == 200, parent.text
    parent_id = parent.json()["id"]
    child = await client.post(
        "/api/folders",
        headers=headers,
        json={"name": "", "tags": ["acme"], "parent_id": parent_id},
    )
    assert child.status_code == 200, child.text
    child_id = child.json()["id"]

    open_child = await _signal(session_override, tenant.id, "Open in child")
    closed_child = await _signal(session_override, tenant.id, "Closed in child", status="closed")
    open_parent = await _signal(session_override, tenant.id, "Open in parent")
    for signal, tags in ((open_child, ["clients", "acme"]), (closed_child, ["clients", "acme"]), (open_parent, ["clients"])):
        patched = await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": tags})
        assert patched.status_code == 200, patched.text

    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    listed = {row["id"]: row for row in (await client.get("/api/folders", headers=headers)).json()}
    detail = (await client.get(f"/api/folders/{parent_id}", headers=headers)).json()

    rail_parent = _find(nav["projects"], parent_id)
    rail_child = _find(nav["projects"], child_id)
    assert rail_parent is not None and rail_child is not None

    # Subtree rule: the parent counts its own conversation plus the child's.
    assert rail_parent["count"] == listed[parent_id]["open_count"] == detail["open_count"] == 2
    assert listed[parent_id]["closed_count"] == detail["closed_count"] == 1
    detail_child = next(row for row in detail["children"] if row["id"] == child_id)
    assert rail_child["count"] == listed[child_id]["open_count"] == detail_child["open_count"] == 1
    assert listed[child_id]["closed_count"] == detail_child["closed_count"] == 1

    # An unnamed folder shows the tags that set it apart from its parent.
    assert rail_child["display_name"] == listed[child_id]["display_name"] == detail_child["display_name"] == "acme"
    assert listed[parent_id]["display_name"] == detail["display_name"] == "Clients"
