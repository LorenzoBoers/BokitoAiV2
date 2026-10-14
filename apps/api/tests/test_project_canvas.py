"""Project/tenant canvas nodes — compile, CRUD, Govern, refresh trigger."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.services.project_canvas_compile import (
    CanvasCompileError,
    _collect_bindings,
    compile_canvas,
    parse_source,
)


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


def test_compile_inlines_const_bindings():
    source = """
import { Stack, BarChart, Stat } from "bokito/canvas"
export default function Canvas() {
  const total = 12500
  const randomData = {
    sales: [
      { month: "Jan", value: 4500 },
      { month: "Feb", value: 5200 }
    ]
  }
  return (
    <Stack>
      <Stat title="Omzet" value={total} />
      <BarChart title="Sales" series={randomData.sales} />
    </Stack>
  )
}
"""
    _source, tree = compile_canvas(source=source)
    stat, chart = tree["children"]
    assert stat["props"]["value"] == 12500
    points = chart["props"]["series"][0]["points"]
    assert points[0] == {"x": "Jan", "y": 4500}
    assert points[1] == {"x": "Feb", "y": 5200}


def test_collect_bindings_always_advances():
    source = "const x =\nconst x =\nreturn (<Stack />)"
    assert _collect_bindings(source) == {}


def test_compile_drops_jsx_comment_braces():
    source = """
import { Stack, Heading, Callout } from "bokito/canvas"
export default function C() {
  return (
    <Stack>
      {/* Header */}
      <Heading>Test Dashboard</Heading>
      {}
      <Callout>Body</Callout>
    </Stack>
  )
}
"""
    _source, tree = compile_canvas(source=source)
    types = [child["type"] for child in tree["children"]]
    assert types == ["Heading", "Callout"]
    assert all(
        (child.get("props") or {}).get("text") not in ("{", "}", "{}")
        for child in tree["children"]
    )


def test_compile_unrolls_const_map():
    source = """
import { Stack, Stat, Card } from "bokito/canvas"
export default function C() {
  const rows = [{ label: "A", value: 1 }, { label: "B", value: 2 }]
  return (
    <Stack>
      {rows.map((row, index) => (
        <Card key={index}>
          <Stat label={row.label} value={row.value} />
        </Card>
      ))}
    </Stack>
  )
}
"""
    _source, tree = compile_canvas(source=source)
    assert [child["type"] for child in tree["children"]] == ["Card", "Card"]
    assert tree["children"][0]["children"][0]["props"]["label"] == "A"
    assert tree["children"][1]["children"][0]["props"]["value"] == 2


def test_compile_normalizes_chart_data_and_table_rows():
    source = """
import { Stack, BarChart, Table } from "bokito/canvas"
export default function C() {
  const sales = [{ month: "Jan", value: 10 }, { month: "Feb", value: 20 }]
  const tableData = [{ name: "Alpha", status: "Open" }]
  return (
    <Stack>
      <BarChart data={sales} x="month" y="value" title="Sales" />
      <Table
        data={tableData}
        columns={[{ key: "name", header: "Name" }, { key: "status", header: "Status" }]}
      />
    </Stack>
  )
}
"""
    _source, tree = compile_canvas(source=source)
    chart, table = tree["children"]
    assert chart["props"]["series"][0]["points"][1] == {"x": "Feb", "y": 20}
    assert table["props"]["columns"] == ["Name", "Status"]
    assert table["props"]["rows"] == [["Alpha", "Open"]]


def test_compile_typical_dashboard_with_map_and_data_charts():
    source = """
import { Stack, Grid, Row, Heading, Callout, Divider, Stat, Table, BarChart, Card, Badge } from "bokito/canvas"
const salesData = [{ month: "Januari", value: 4500 }, { month: "Februari", value: 5200 }]
const stats = [{ label: "Omzet", value: "€ 245.000", trend: "12%" }]
const tableData = [{ name: "Project Alpha", status: "Actief" }]
export default function Canvas() {
  return (
    <Stack>
      <Heading level={1}>Test Dashboard</Heading>
      <Row>
        {stats.map((stat, index) => (
          <Card key={index}>
            <Stat label={stat.label} value={stat.value} trend={stat.trend} />
          </Card>
        ))}
      </Row>
      <BarChart data={salesData} x="month" y="value" title="Omzet" />
      <Table
        data={tableData}
        columns={[{ key: "name", header: "Project" }, { key: "status", header: "Status" }]}
      />
      <Callout type="info">Testdashboard</Callout>
      <Badge type="primary">Primary</Badge>
    </Stack>
  )
}
"""
    _source, tree = compile_canvas(source=source)
    types = [child["type"] for child in tree["children"]]
    assert types[:4] == ["Heading", "Row", "BarChart", "Table"]
    row = tree["children"][1]
    assert row["children"][0]["children"][0]["props"]["label"] == "Omzet"
    assert tree["children"][2]["props"]["series"][0]["points"][0]["x"] == "Januari"
    assert tree["children"][3]["props"]["rows"] == [["Project Alpha", "Actief"]]
    assert tree["children"][4]["props"]["tone"] == "info"


def test_compile_rejects_unbound_prop_expression():
    with pytest.raises(CanvasCompileError, match="Unsupported expression 'randomData'"):
        parse_source(
            'import { Stat } from "bokito/canvas"\n'
            "export default function C() { return <Stat value={randomData} /> }"
        )


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
        "/api/folders",
        headers=headers,
        json={
            "name": slug.replace("-", " ").title(),
            "slug": slug,
            "autonomous_scope": "Run the ops dashboard",
            "description": "Canvas test project",
            "tags": [slug],
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

    listed = await client.get(f"/api/folders/{project_id}/canvases", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["items"] == []

    created = await client.post(
        f"/api/folders/{project_id}/canvases",
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
    assert body["signal_id"]
    assert body["thread"]["id"] == body["signal_id"]
    assert body["thread"]["path"]

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
        f"/api/folders/{project_id}/canvases",
        headers=headers,
        json={
            "title": "Delivery",
            "notes": "Open queue and blockers",
        },
    )
    assert second.status_code == 200
    assert second.json()["refresh_cadence"] == "daily"
    assert second.json()["notes"] == "Open queue and blockers"
    listed = await client.get(f"/api/folders/{project_id}/canvases", headers=headers)
    assert len(listed.json()["items"]) == 2

    deleted = await client.delete(
        f"/api/folders/{project_id}/canvases/{second.json()['slug']}",
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


def test_cadence_labels_presets_and_custom():
    from types import SimpleNamespace

    from app.services.project_canvas import cadence_from_trigger

    daily = SimpleNamespace(enabled=True, kind="cron", cron_expr="0 7 * * *", interval_minutes=0)
    weekly = SimpleNamespace(enabled=True, kind="cron", cron_expr="0 7 * * 1", interval_minutes=0)
    custom = SimpleNamespace(enabled=True, kind="cron", cron_expr="15 9 * * 1-5", interval_minutes=0)
    once = SimpleNamespace(enabled=True, kind="once", cron_expr="", interval_minutes=0)
    assert cadence_from_trigger(daily) == "daily"
    assert cadence_from_trigger(weekly) == "weekly"
    assert cadence_from_trigger(custom) == "custom"
    assert cadence_from_trigger(once) == "manual"


@pytest.mark.asyncio
async def test_custom_refresh_cron_roundtrip(client: AsyncClient, session_override):
    from sqlalchemy import select

    from app.models.auth import Tenant

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tenant_id = str(tenant.id)

    missing = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={
            "owner_kind": "tenant",
            "owner_id": tenant_id,
            "title": "Missing cron",
            "refresh_cadence": "custom",
            "notes": "Needs a cron",
        },
    )
    assert missing.status_code == 400

    created = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={
            "owner_kind": "tenant",
            "owner_id": tenant_id,
            "title": "Weekday desk",
            "refresh_cadence": "custom",
            "refresh_cron": "15 9 * * 1-5",
            "notes": "Paper desk snapshot",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["refresh_cadence"] == "custom"
    assert body["refresh_cron"] == "15 9 * * 1-5"

    patched = await client.patch(
        f"/api/workforce/canvases/{body['id']}",
        headers=headers,
        json={"refresh_cadence": "custom", "refresh_cron": "30 8 * * 1"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["refresh_cadence"] == "custom"
    assert patched.json()["refresh_cron"] == "30 8 * * 1"


@pytest.mark.asyncio
async def test_same_title_reuses_canvas_and_agent_create_stays_in_chat(
    client: AsyncClient, session_override
):
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.trigger import Trigger
    from app.services.project_canvas import apply_canvas_document

    headers = await _auth_headers(client)
    project_id = await _make_project(client, headers, "canvas-reuse")
    first = await client.post(
        f"/api/folders/{project_id}/canvases",
        headers=headers,
        json={"title": "Financieel overzicht", "refresh_cadence": "daily"},
    )
    assert first.status_code == 200, first.text
    again = await client.post(
        f"/api/folders/{project_id}/canvases",
        headers=headers,
        json={"title": "  financieel   overzicht "},
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["reused"] is True
    listed = await client.get(f"/api/folders/{project_id}/canvases", headers=headers)
    assert len(listed.json()["items"]) == 1

    trigger = await session_override.get(Trigger, UUID(first.json()["refresh_trigger_id"]))
    assert trigger is not None
    assert trigger.signal_id is not None
    assert trigger.next_run_at is not None
    assert trigger.next_run_at > datetime.utcnow()

    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    applied = await apply_canvas_document(
        session_override,
        tenant.id,
        {
            "owner_kind": "project",
            "owner_id": project_id,
            "title": "Tweede dashboard",
            "kick": False,
        },
        change_kind="create",
    )
    canvas = applied["canvas"]
    assert canvas.get("reused") is not True
    assert canvas["signal_id"]
    assert canvas["thread"]["id"] == canvas["signal_id"]
    quiet = await session_override.get(Trigger, UUID(canvas["refresh_trigger_id"]))
    assert quiet is not None
    assert quiet.signal_id is not None
    assert str(quiet.signal_id) == canvas["signal_id"]
    assert quiet.next_run_at is not None
    assert quiet.next_run_at > datetime.utcnow()


@pytest.mark.asyncio
async def test_create_canvas_uses_current_thread_or_opens_new(client, session_override):
    from uuid import UUID

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.project_canvas import create_canvas

    headers = await _auth_headers(client)
    project_id = await _make_project(client, headers, "canvas-home-thread")
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    chat = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="agent_channel",
        subject="Planning call",
        status="open",
        priority="normal",
    )
    session_override.add(chat)
    await session_override.commit()
    await session_override.refresh(chat)

    home = await create_canvas(
        session_override,
        tenant.id,
        owner_kind="project",
        owner_id=UUID(project_id),
        title="From this chat",
        kick=False,
        signal_id=chat.id,
    )
    assert home["signal_id"] == str(chat.id)
    assert home["thread"]["id"] == str(chat.id)
    assert home["thread"]["path"]

    listed = await client.get(
        f"/api/workforce/canvases?signal_id={chat.id}",
        headers=headers,
    )
    assert listed.status_code == 200, listed.text
    ids = {item["id"] for item in listed.json()["items"]}
    assert home["id"] in ids

    other = await create_canvas(
        session_override,
        tenant.id,
        owner_kind="project",
        owner_id=UUID(project_id),
        title="Own thread",
        kick=False,
        signal_id=chat.id,
        new_thread=True,
    )
    assert other["signal_id"]
    assert other["signal_id"] != str(chat.id)
    assert other["thread"]["id"] == other["signal_id"]


@pytest.mark.asyncio
async def test_soft_delete_canvas_disables_refresh_trigger(client: AsyncClient, session_override):
    """Binning a canvas must stop its Agenda refresh wake (no ghost day blocks)."""
    from uuid import UUID

    from app.models.signal import Signal
    from app.models.trigger import Trigger

    headers = await _auth_headers(client)
    project_id = await _make_project(client, headers, "canvas-bin-refresh")
    created = await client.post(
        f"/api/folders/{project_id}/canvases",
        headers=headers,
        json={"title": "Daily board", "refresh_cadence": "daily"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    trigger_id = UUID(body["refresh_trigger_id"])
    signal_id = UUID(body["signal_id"])

    trigger = await session_override.get(Trigger, trigger_id)
    assert trigger is not None and trigger.enabled is True
    assert trigger.next_run_at is not None
    signal = await session_override.get(Signal, signal_id)
    assert signal is not None and signal.next_at is not None

    deleted = await client.delete(
        f"/api/folders/{project_id}/canvases/{body['slug']}",
        headers=headers,
    )
    assert deleted.status_code == 200, deleted.text

    await session_override.refresh(trigger)
    await session_override.refresh(signal)
    assert trigger.enabled is False
    assert trigger.next_run_at is None
    assert trigger.last_status == "canvas_binned"
    assert signal.next_at is None
