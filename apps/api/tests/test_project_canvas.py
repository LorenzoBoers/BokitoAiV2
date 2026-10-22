"""Canvas nodes in folders: compile, CRUD, Govern, refresh trigger."""

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


def test_fragment_format_call_and_prop_map_compile():
    source = """
import { Heading, Stat, Table, BarChart } from "bokito/canvas"

export const kpiData = { bereik: 45200, groei: 12.5 }
export const contentData = [
  { datum: "2026-10-22", kanaal: "Instagram" },
  { datum: "2026-10-23", kanaal: "LinkedIn" }
]

export default function Canvas() {
  return (
    <>
      <Heading>Test</Heading>
      <Stat label="Bereik" value={kpiData.bereik.toLocaleString()} />
      <Table
        columns={contentData.map(item => ({ key: item.datum, header: item.datum }))}
        rows={contentData.map(item => ({
          [item.datum]: `${item.kanaal}`
        }))}
      />
      <BarChart data={contentData} />
    </>
  )
}
"""
    _compiled, tree = compile_canvas(source=source)
    assert tree["type"] == "Stack"
    assert tree["children"][0]["props"]["text"] == "Test"
    assert tree["children"][1]["props"]["value"] == 45200
    assert tree["children"][2]["props"]["columns"] == ["2026-10-22", "2026-10-23"]
    assert tree["children"][2]["props"]["rows"][1]["2026-10-23"] == "LinkedIn"


def test_compile_bokito_canvas_wrapper():
    source = """
<bokito/canvas>
  <Stat title="Engagement Rate" value="12.5%" />
  <Heading level="2" text="Doelgroep" />
</bokito/canvas>
"""
    _compiled, tree = compile_canvas(source=source)
    assert tree["type"] == "Stack"
    assert [child["type"] for child in tree["children"]] == ["Stat", "Heading"]
    assert tree["children"][0]["props"]["value"] == "12.5%"


def test_compile_hyphen_wrapper_and_pie():
    """The shape agents actually send when they add charts to a dashboard."""
    source = """
<bokito-canvas>
  <Stat title="Willekeurige Cijfers" value="{randomNumber: 42}" />
  <BarChart title="Verdeling" series={[
    {label: "0-10", value: 3},
    {label: "11-20", value: 5}
  ]} />
  <Card title="Gemiddelde" value="{average: 20.33}" />
  <PieChart title="Cijferverdeling" series={[
    {label: "Laag", percentage: 25},
    {label: "Hoog", percentage: 75}
  ]} />
</bokito-canvas>
"""
    _compiled, tree = compile_canvas(source=source)
    assert tree["type"] == "Stack"
    stat, chart, card, pie = tree["children"]
    assert stat["props"]["value"] == 42
    assert chart["props"]["series"][0]["points"][0] == {"x": "0-10", "y": 3}
    assert card["children"][0]["props"]["text"] == "20.33"
    assert pie["type"] == "PieChart"
    assert pie["props"]["slices"] == [
        {"name": "Laag", "value": 25},
        {"name": "Hoog", "value": 75},
    ]


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
        parse_source(
            'import { Stack } from "bokito/canvas"\n'
            "export default function C() { const x = window.location; return <Stack /> }"
        )
    with pytest.raises(CanvasCompileError):
        parse_source("<NotAThing />")


def test_compile_allows_window_in_prose():
    """Trading copy like 'AM window' is text, not the browser window global."""
    tree = parse_source(
        'import { Stack, Callout } from "bokito/canvas"\n'
        "export default function Canvas() {\n"
        '  const nextAction = "AM window opent om 09:45 ET";\n'
        "  return (\n"
        "    <Stack>\n"
        "      <Callout>Markt gesloten. AM window nog niet actief.</Callout>\n"
        "    </Stack>\n"
        "  )\n"
        "}\n"
    )
    callout = tree["children"][0]
    assert callout["type"] == "Callout"
    assert "AM window" in callout["props"]["text"]


@pytest.mark.asyncio
async def test_window_prose_applies_and_session_stays_usable(client: AsyncClient, session_override):
    """The compile runs in a worker thread. A prose 'window' must save, and a
    real compile error must come back as HTTP 400 without breaking the session."""
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import apply_canvas_document

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    created = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={"title": "AM desk"},
    )
    assert created.status_code == 200, created.text
    source = (
        'import { Stack, Callout } from "bokito/canvas"\n'
        "export default function Canvas() {\n"
        '  const nextAction = "AM window opent om 09:45 ET";\n'
        "  return <Stack><Callout>AM window nog niet actief.</Callout></Stack>\n"
        "}\n"
    )
    applied = await apply_canvas_document(
        session_override,
        tenant.id,
        {"canvas_id": created.json()["id"], "source": source},
    )
    assert "window" in applied["canvas"]["source"]
    still = (await session_override.execute(select(Tenant))).scalar_one()
    assert still.id == tenant.id

    with pytest.raises(HTTPException) as bad:
        await apply_canvas_document(
            session_override,
            tenant.id,
            {
                "canvas_id": created.json()["id"],
                "source": (
                    'import { Stack } from "bokito/canvas"\n'
                    "export default function C() { fetch('/x'); return <Stack /> }"
                ),
            },
        )
    assert bad.value.status_code == 400
    again = (await session_override.execute(select(Tenant))).scalar_one()
    assert again.id == tenant.id


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
    assert body["folder_id"] == project_id
    assert "owner_kind" not in body
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
        f"/api/workforce/canvases/{second.json()['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_default_location_and_forbidden_source(client: AsyncClient, session_override):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import apply_canvas_document
    from app.services.works_in import general_folder

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()

    empty = await client.get("/api/workforce/canvases/default-location", headers=headers)
    assert empty.status_code == 200
    general = await general_folder(session_override, tenant.id, create=False)
    assert general is not None
    assert empty.json() == {
        "folder_id": str(general.id),
        "canvas_id": None,
        "href": f"/folders/{general.id}?tab=canvas",
    }

    folder_id = await _make_project(client, headers, "canvas-morning")
    created = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={
            "title": "Morning scan",
            "new_thread": True,
            "folder_id": folder_id,
            "refresh_cadence": "weekly",
            "notes": "Open threads and running work",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["folder_id"] == folder_id
    assert created.json()["signal_id"]
    assert created.json()["empty"] is True
    assert created.json()["refresh_cadence"] == "weekly"
    assert created.json()["notes"] == "Open threads and running work"

    listed = await client.get(
        f"/api/workforce/canvases?folder_id={folder_id}",
        headers=headers,
    )
    assert listed.status_code == 200
    assert any(item["slug"] == "morning-scan" for item in listed.json()["items"])

    landed = await client.get("/api/workforce/canvases/default-location", headers=headers)
    assert landed.json()["canvas_id"] == created.json()["id"]
    assert landed.json()["folder_id"] == folder_id
    assert landed.json()["href"] == f"/folders/{folder_id}?tab=canvas&canvas={created.json()['id']}"
    gone = await client.get(
        "/api/workforce/canvases/default-location?canvas_id=00000000-0000-0000-0000-000000000000",
        headers=headers,
    )
    assert gone.json()["canvas_id"] == created.json()["id"]

    loose = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={"title": "Loose board"},
    )
    assert loose.status_code == 200, loose.text
    assert loose.json()["folder_id"] is None
    unfiled = await client.get(
        f"/api/workforce/canvases/default-location?canvas_id={loose.json()['id']}",
        headers=headers,
    )
    assert unfiled.json()["folder_id"] is None
    assert unfiled.json()["canvas_id"] == loose.json()["id"]
    assert unfiled.json()["href"].endswith(
        f"/t/{loose.json()['signal_id']}?canvas={loose.json()['id']}"
    )

    missing = await client.get("/api/workforce/canvases", headers=headers)
    assert missing.status_code == 400

    with pytest.raises(HTTPException) as bad:
        await apply_canvas_document(
            session_override,
            tenant.id,
            {
                "canvas_id": created.json()["id"],
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
    del session_override  # fixture required for DB session override
    headers = await _auth_headers(client)

    missing = await client.post(
        "/api/workforce/canvases",
        headers=headers,
        json={
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
        "/api/workforce/canvases",
        headers=headers,
        json={"signal_id": first.json()["signal_id"], "title": "  financieel   overzicht "},
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
            "signal_id": first.json()["signal_id"],
            "title": "Tweede dashboard",
            "kick": False,
        },
        change_kind="create",
    )
    canvas = applied["canvas"]
    assert canvas.get("reused") is not True
    assert canvas["folder_id"] == project_id
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
        title="From this chat",
        kick=False,
        signal_id=chat.id,
    )
    assert home["signal_id"] == str(chat.id)
    assert home["folder_id"] is None
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
        title="Own thread",
        kick=False,
        new_thread=True,
        folder_id=UUID(project_id),
    )
    assert other["signal_id"]
    assert other["signal_id"] != str(chat.id)
    assert other["thread"]["id"] == other["signal_id"]
    assert other["folder_id"] == project_id

    with pytest.raises(HTTPException) as homeless:
        await create_canvas(session_override, tenant.id, title="Nowhere", kick=False)
    assert homeless.value.status_code == 400


@pytest.mark.asyncio
async def test_assistant_home_canvas_keeps_one_refresh_thread(client, session_override):
    """Saving a canvas asked for in an assistant chat must not open a new thread each time."""
    from uuid import UUID

    from sqlalchemy import func, select

    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.project_canvas import create_canvas, get_canvas, patch_canvas_meta

    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    chat = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="chat",
        subject="Weekly updates",
        status="open",
        priority="normal",
    )
    session_override.add(chat)
    await session_override.commit()
    await session_override.refresh(chat)

    created = await create_canvas(
        session_override,
        tenant.id,
        title="ChargeCars weekly",
        refresh_cadence="weekly",
        kick=False,
        signal_id=chat.id,
    )
    await patch_canvas_meta(
        session_override,
        tenant.id,
        UUID(created["id"]),
        notes="Same canvas, saved again",
        refresh_cadence="weekly",
    )
    await get_canvas(session_override, tenant.id, canvas_id=UUID(created["id"]))
    live = await session_override.scalar(
        select(func.count())
        .select_from(Signal)
        .where(Signal.deleted_at.is_(None), Signal.subject.like("Refresh canvas%"))
    )
    assert live == 1


@pytest.mark.asyncio
async def test_binned_home_thread_does_not_mint_agenda_rows(client: AsyncClient, session_override):
    """Reading a canvas whose home chat was binned must not spawn a new wake each time."""
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy import func, select

    from app.models.signal import Signal
    from app.models.trigger import Trigger

    headers = await _auth_headers(client)
    project_id = await _make_project(client, headers, "canvas-binned-home")
    created = await client.post(
        f"/api/folders/{project_id}/canvases",
        headers=headers,
        json={"title": "Weekly board", "refresh_cadence": "weekly"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    home = await session_override.get(Signal, UUID(body["signal_id"]))
    assert home is not None
    home.deleted_at = datetime.utcnow()
    session_override.add(home)
    await session_override.commit()

    first = await client.get(f"/api/folders/{project_id}/canvases", headers=headers)
    second = await client.get(f"/api/folders/{project_id}/canvases", headers=headers)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["items"][0]["signal_id"] == second.json()["items"][0]["signal_id"]
    assert second.json()["items"][0]["signal_id"] != str(home.id)

    trigger = await session_override.get(Trigger, UUID(body["refresh_trigger_id"]))
    assert trigger is not None
    assert str(trigger.signal_id) == second.json()["items"][0]["signal_id"]
    live = await session_override.scalar(
        select(func.count())
        .select_from(Signal)
        .where(Signal.deleted_at.is_(None), Signal.subject.like("Refresh canvas%"))
    )
    assert live == 1


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
        f"/api/workforce/canvases/{body['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200, deleted.text

    await session_override.refresh(trigger)
    await session_override.refresh(signal)
    assert trigger.enabled is False
    assert trigger.next_run_at is None
    assert trigger.last_status == "canvas_binned"
    assert signal.next_at is None


@pytest.mark.asyncio
async def test_canvas_follows_its_thread_when_refiled(client: AsyncClient, session_override):
    from uuid import UUID

    from app.models.signal import Signal
    from app.services import folders

    headers = await _auth_headers(client)
    folder_a = await _make_project(client, headers, "canvas-refile-a")
    folder_b = await _make_project(client, headers, "canvas-refile-b")
    created = await client.post(
        f"/api/folders/{folder_a}/canvases",
        headers=headers,
        json={"title": "Moving board", "refresh_cadence": "manual"},
    )
    assert created.status_code == 200, created.text
    canvas_id = created.json()["id"]

    in_a = await client.get(f"/api/workforce/canvases?folder_id={folder_a}", headers=headers)
    assert in_a.status_code == 200, in_a.text
    assert [item["id"] for item in in_a.json()["items"]] == [canvas_id]
    in_b = await client.get(f"/api/workforce/canvases?folder_id={folder_b}", headers=headers)
    assert in_b.json()["items"] == []

    home = await session_override.get(Signal, UUID(created.json()["signal_id"]))
    assert home is not None
    await folders.file_in_folder(session_override, home, None)
    await folders.file_in_folder(session_override, home, UUID(folder_b))
    await session_override.commit()

    in_b = await client.get(f"/api/workforce/canvases?folder_id={folder_b}", headers=headers)
    assert [item["id"] for item in in_b.json()["items"]] == [canvas_id]
    assert in_b.json()["items"][0]["folder_id"] == folder_b
    in_a = await client.get(f"/api/workforce/canvases?folder_id={folder_a}", headers=headers)
    assert in_a.json()["items"] == []


@pytest.mark.asyncio
async def test_brand_kind_is_rejected(client: AsyncClient, session_override):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.canvas_content import CanvasContentError, normalize_kind
    from app.services.project_canvas import apply_canvas_document, create_canvas

    with pytest.raises(CanvasContentError):
        normalize_kind("brand")

    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    with pytest.raises(HTTPException) as direct:
        await create_canvas(
            session_override,
            tenant.id,
            new_thread=True,
            title="Huisstijl",
            canvas_kind="brand",
            kick=False,
        )
    assert direct.value.status_code == 400
    with pytest.raises(HTTPException) as applied:
        await apply_canvas_document(
            session_override,
            tenant.id,
            {"new_thread": True, "title": "Huisstijl", "kind": "brand", "kick": False},
            change_kind="create",
        )
    assert applied.value.status_code == 400


@pytest.mark.asyncio
async def test_slug_is_unique_per_conversation(client: AsyncClient, session_override):
    from uuid import UUID

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import create_canvas

    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    first = await create_canvas(
        session_override, tenant.id, new_thread=True, title="Board one", slug="board", kick=False
    )
    second = await create_canvas(
        session_override,
        tenant.id,
        signal_id=UUID(first["signal_id"]),
        title="Board two",
        slug="board",
        kick=False,
    )
    elsewhere = await create_canvas(
        session_override, tenant.id, new_thread=True, title="Board three", slug="board", kick=False
    )
    assert first["slug"] == "board"
    assert second["signal_id"] == first["signal_id"]
    assert second["slug"] == "board-2"
    assert elsewhere["signal_id"] != first["signal_id"]
    assert elsewhere["slug"] == "board"
