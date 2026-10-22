"""The flow as recipe; the flow label is the work kind."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalTag


async def _headers(client):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _flow(client, headers, name: str) -> str:
    created = await client.post("/api/labels", headers=headers, json={"name": name})
    assert created.status_code == 200, created.text
    return created.json()["workstream_id"]


@pytest.mark.asyncio
async def test_patch_flow_recipe_validates_and_returns_it(client, session_override):
    headers = await _headers(client)
    ws_id = await _flow(client, headers, f"vat-{uuid4().hex[:4]}")

    bad_tool = await client.patch(f"/api/flows/{ws_id}", headers=headers, json={"capabilities": ["no_such_tool"]})
    assert bad_tool.status_code == 422
    bad_conn = await client.patch(
        f"/api/flows/{ws_id}", headers=headers, json={"capabilities": [f"connection:{uuid4()}"]}
    )
    assert bad_conn.status_code == 422

    ok = await client.patch(
        f"/api/flows/{ws_id}",
        headers=headers,
        json={
            "instructions": "Check the period, then file the return.",
            "capabilities": ["send_reply"],
            "expected_outcome": "The return is filed in the accounting connection",
        },
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert "work_kinds" not in body and "recipe_options" not in body
    assert body["instructions"] == "Check the period, then file the return."
    assert body["capabilities"] == ["send_reply"]
    assert body["expected_outcome"] == "The return is filed in the accounting connection"


@pytest.mark.asyncio
async def test_direct_flow_drops_waiting_stage_and_board(client, session_override):
    from app.services.tickets import project_board

    headers = await _headers(client)
    ws_id = await _flow(client, headers, f"quick-{uuid4().hex[:4]}")
    detail = (await client.get(f"/api/flows/{ws_id}", headers=headers)).json()
    assert detail["direct"] is False

    direct = await client.patch(f"/api/flows/{ws_id}", headers=headers, json={"direct": True})
    assert direct.status_code == 200, direct.text
    assert direct.json()["direct"] is True
    assert [s["kind"] for s in direct.json()["stages"]] == ["open", "done"]

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    tag = (
        await session_override.execute(select(SignalTag).where(SignalTag.workstream_id == UUID(ws_id)))
    ).scalar_one()
    from app.models.project import Project, ProjectTagLink

    folder = Project(tenant_id=tenant.id, name="Quick", slug=f"quick-{uuid4().hex[:6]}")
    session_override.add(folder)
    await session_override.flush()
    session_override.add(ProjectTagLink(tenant_id=tenant.id, project_id=folder.id, tag_id=tag.id))
    session_override.add(
        Signal(tenant_id=tenant.id, channel="email", status="open", ticket_tag_id=tag.id, ticket_status="open",
               project_id=folder.id)
    )
    await session_override.commit()
    assert await project_board(session_override, tenant.id, folder.id) == []

    staged = await client.patch(f"/api/flows/{ws_id}", headers=headers, json={"direct": False})
    assert [s["kind"] for s in staged.json()["stages"]] == ["open", "waiting", "done"]
    assert len(await project_board(session_override, tenant.id, folder.id)) == 1


@pytest.mark.asyncio
async def test_read_without_flow_label_has_no_kind_and_recipe_follows_the_label(client, session_override):
    from app.services.interpretation import apply_thread_read
    from app.services.workstreams import recipe_block

    headers = await _headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    tenant_id = tenant.id
    vat = await _flow(client, headers, f"vat-{uuid4().hex[:4]}")
    await client.patch(
        f"/api/flows/{vat}",
        headers=headers,
        json={"instructions": "File the return.", "expected_outcome": "The return is filed"},
    )

    signal = Signal(tenant_id=tenant_id, channel="email", status="open")
    session_override.add(signal)
    await session_override.commit()
    result = await apply_thread_read(
        session_override, tenant_id, signal.id, summary="Please file the VAT return", certainty=40
    )
    assert "work_kind" not in result and result["ticket_tag_id"] is None

    tag = (
        await session_override.execute(select(SignalTag).where(SignalTag.workstream_id == UUID(vat)))
    ).scalar_one()
    tag.description = "VAT returns and questions about them"
    signal = await session_override.get(Signal, signal.id)
    signal.ticket_tag_id = tag.id
    await session_override.commit()
    block = await recipe_block(session_override, signal)
    flow = await session_override.get(Workstream, UUID(vat))
    assert block.startswith(f"## Approach: flow {flow.name}")
    assert "Handles: VAT returns and questions about them" in block
    assert "File the return." in block and "Done means: The return is filed." in block
