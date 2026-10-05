"""Project/tenant canvas nodes — compile, CRUD, Govern, refresh trigger."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.services.project_canvas_compile import CanvasCompileError, compile_canvas, parse_source


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_compile_source_roundtrip():
    source = """
import { Stack, Grid, Stat, Heading } from "bokito/canvas"

export default function Canvas() {
  return (
    <Stack>
      <Heading>Launch</Heading>
      <Grid columns={2}>
        <Stat title="Open items" value="4" unit="items" source="Queue · today" />
        <Stat title="Done" value="2" />
      </Grid>
    </Stack>
  )
}
"""
    compiled_source, tree = compile_canvas(source=source)
    assert tree["type"] == "Stack"
    assert tree["children"][0]["type"] == "Heading"
    assert tree["children"][1]["type"] == "Grid"
    assert tree["children"][1]["children"][0]["props"]["value"] == "4"
    again, tree2 = compile_canvas(source=compiled_source)
    assert tree2["type"] == "Stack"
    assert again


def test_compile_rejects_fetch_and_foreign_import():
    with pytest.raises(CanvasCompileError):
        parse_source(
            'import { Stack } from "other"\nexport default function C() { return <Stack /> }'
        )
    with pytest.raises(CanvasCompileError):
        parse_source(
            'import { Stack } from "bokito/canvas"\n'
            "export default function C() { fetch('/x'); return <Stack /> }"
        )
    with pytest.raises(CanvasCompileError):
        parse_source("<NotAThing />")


async def _make_project(client: AsyncClient, headers: dict[str, str], slug: str) -> str:
    created = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={
            "name": slug.replace("-", " ").title(),
            "slug": slug,
            "autonomous_scope": "Run the ops dashboard",
            "description": "Canvas test project",
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["id"]


@pytest.mark.asyncio
async def test_project_canvas_nodes_and_conflict(client: AsyncClient, session_override):
    from uuid import UUID

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import apply_canvas_document, put_canvas_source

    headers = await _auth_headers(client)
    project_id = await _make_project(client, headers, "ops-board-canvas")

    listed = await client.get(f"/api/workforce/projects/{project_id}/canvases", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["items"] == []

    created = await client.post(
        f"/api/workforce/projects/{project_id}/canvases",
        headers=headers,
        json={"title": "NPS", "refresh_minutes": 60},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["slug"] == "nps"
    assert body["owner_kind"] == "project"
    assert body["empty"] is True
    assert body["refresh_cadence"] == "hourly"
    assert body["refresh_minutes"] == 60
    assert body["refresh_trigger_id"]

    source = """
import { Stack, Stat, Heading } from "bokito/canvas"
export default function Canvas() {
  return (
    <Stack>
      <Heading>NPS</Heading>
      <Stat title="NPS" value="72" unit="score" source="Survey · last 30 days" />
    </Stack>
  )
}
"""
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    applied = await apply_canvas_document(
        session_override,
        tenant.id,
        {
            "canvas_id": body["id"],
            "project_id": project_id,
            "notes": "Added KPI",
            "source": source,
        },
    )
    assert applied["status"] == "applied"
    next_body = applied["canvas"]
    assert next_body["empty"] is False
    stats = [n for n in next_body["tree"]["children"] if n["type"] == "Stat"]
    assert stats and stats[0]["props"]["value"] == "72"

    with pytest.raises(HTTPException) as conflict:
        await put_canvas_source(
            session_override,
            tenant.id,
            canvas_id=UUID(body["id"]),
            source=source,
            expected_revision=body["revision"],
        )
    assert conflict.value.status_code == 409

    second = await client.post(
        f"/api/workforce/projects/{project_id}/canvases",
        headers=headers,
        json={
            "title": "Delivery",
            "notes": "Open queue and blockers",
        },
    )
    assert second.status_code == 200
    assert second.json()["refresh_cadence"] == "daily"
    assert second.json()["notes"] == "Open queue and blockers"
    listed = await client.get(f"/api/workforce/projects/{project_id}/canvases", headers=headers)
    assert len(listed.json()["items"]) == 2

    deleted = await client.delete(
        f"/api/workforce/projects/{project_id}/canvases/{second.json()['slug']}",
        headers=headers,
    )
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_tenant_canvas_and_forbidden_source(client: AsyncClient, session_override):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import apply_canvas_document

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tenant_id = str(tenant.id)

    created = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={
            "owner_kind": "tenant",
            "owner_id": tenant_id,
            "title": "Morning scan",
            "refresh_cadence": "weekly",
            "notes": "Open threads and running work",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["owner_kind"] == "tenant"
    assert created.json()["empty"] is True
    assert created.json()["refresh_cadence"] == "weekly"
    assert created.json()["notes"] == "Open threads and running work"

    listed = await client.get(
        f"/api/workforce/canvases?owner_kind=tenant&owner_id={tenant_id}",
        headers=headers,
    )
    assert listed.status_code == 200
    assert any(item["slug"] == "morning-scan" for item in listed.json()["items"])

    with pytest.raises(HTTPException) as bad:
        await apply_canvas_document(
            session_override,
            tenant.id,
            {
                "canvas_id": created.json()["id"],
                "owner_kind": "tenant",
                "owner_id": tenant_id,
                "source": "import { Stack } from 'fs'\nexport default function C(){return <Stack />}",
            },
        )
    assert bad.value.status_code == 400
