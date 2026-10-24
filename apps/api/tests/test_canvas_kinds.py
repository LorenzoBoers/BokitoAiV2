"""Canvas kinds: one home thread, safe source per kind."""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from fastapi import HTTPException
from app.exceptions import AppError
from httpx import AsyncClient

from app.services.canvas_content import (
    CanvasContentError,
    content_is_empty,
    prepare_content,
    sanitize_email_html,
    sanitize_svg,
)
from app.services.canvas_sheet import sheet_csv, sheet_xlsx


def test_svg_keeps_tenant_image_and_drops_script_and_remote():
    raw = (
        '<svg viewBox="0 0 10 10">'
        "<script>alert(1)</script>"
        '<image href="https://evil.test/a.png" />'
        '<image href="/api/uploads/files/TENANT/pic.png" />'
        "</svg>"
    )
    out = sanitize_svg(raw, "TENANT")
    assert "<script" not in out.lower()
    assert "evil.test" not in out
    assert "/api/uploads/files/TENANT/pic.png" in out


def test_image_url_must_belong_to_the_tenant():
    with pytest.raises(CanvasContentError):
        prepare_content(
            "image",
            json.dumps({"url": "https://cdn.example/a.png", "alt": "x"}),
            language=None,
            tenant_id="TENANT",
        )
    stored, _lang = prepare_content(
        "image",
        json.dumps({"url": "/api/uploads/files/TENANT/pic.png", "alt": "Poster"}),
        language=None,
        tenant_id="TENANT",
    )
    assert json.loads(stored)["url"].endswith("/TENANT/pic.png")


def test_email_strips_script_and_remote_images():
    html = sanitize_email_html(
        '<p>Hello</p><script>alert(1)</script><img src="https://evil.test/a.png" alt="no" />',
        "TENANT",
    )
    assert "<script" not in html.lower()
    assert "alert" not in html
    assert "evil.test" not in html
    assert "<p>Hello</p>" in html


def test_sheet_accepts_a_list_of_id_columns_and_leaves_chat():
    from app.services.canvas_sheet import detach_sheet_speech

    stored, _lang = prepare_content(
        "sheet",
        json.dumps(
            [
                {
                    "columns": [
                        {"id": "dag", "label": "Dag", "type": "string"},
                        {"id": "min", "label": "Min", "type": "string"},
                    ],
                    "rows": [{"dag": "22 okt", "min": "9"}],
                }
            ]
        ),
        language=None,
        tenant_id="T",
    )
    tab = json.loads(stored)["tabs"][0]
    assert tab["columns"] == ["Dag", "Min"]
    assert tab["rows"] == [["22 okt", "9"]]
    speech = detach_sheet_speech(
        "Hier is de week.\n\n| Dag | Min |\n| --- | --- |\n| 22 okt | 9 |\n\n"
        + json.dumps({"columns": ["Dag"], "rows": [["22 okt"]]})
    )
    assert speech == "Hier is de week."
    assert "columns" not in speech


def test_sheet_accepts_header_objects_and_dict_rows():
    stored, _lang = prepare_content(
        "sheet",
        json.dumps(
            {
                "columns": [
                    {"header": "Datum", "type": "string"},
                    {"header": "Maximumtemperatuur", "type": "number"},
                ],
                "rows": [
                    {"Datum": "ma", "Maximumtemperatuur": 18},
                ],
            }
        ),
        language=None,
        tenant_id="T",
    )
    tab = json.loads(stored)["tabs"][0]
    assert tab["columns"] == ["Datum", "Maximumtemperatuur"]
    assert tab["rows"] == [["ma", 18]]


def test_sheet_stores_tabs_and_exports_csv_and_excel():
    stored, lang = prepare_content(
        "sheet",
        json.dumps(
            {
                "columns": ["Name", "Note"],
                "rows": [["Ada", "=1+1"], ["Bea", 2]],
            }
        ),
        language=None,
        tenant_id="T",
    )
    assert lang is None
    data = json.loads(stored)
    assert data["tabs"][0]["name"] == "Sheet1"
    assert data["tabs"][0]["rows"][1][1] == 2
    assert content_is_empty("sheet", stored) is False
    assert content_is_empty("sheet", "") is True
    text = sheet_csv(stored)
    assert text.splitlines()[0] == "Name,Note"
    assert "'=1+1" in text
    assert "2" in text
    package = sheet_xlsx(stored)
    assert package[:2] == b"PK"
    import zipfile
    from io import BytesIO

    with zipfile.ZipFile(BytesIO(package)) as archive:
        sheet = archive.read("xl/worksheets/sheet1.xml").decode()
    assert "Ada" in sheet
    assert "'=1+1" in sheet
    with pytest.raises(CanvasContentError):
        prepare_content(
            "sheet",
            json.dumps({"columns": ["A"], "rows": [[{"nested": True}]]}),
            language=None,
            tenant_id="T",
        )


@pytest.mark.asyncio
async def test_google_sheet_export_creates_a_spreadsheet():
    import httpx

    from app.modules.documents.adapters import google_drive

    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode() or "{}")
        if str(request.url).endswith(":batchUpdate"):
            seen["batch"] = body
            return httpx.Response(200, json={})
        seen["create"] = body
        return httpx.Response(
            200,
            json={
                "spreadsheetId": "abc",
                "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/abc",
            },
        )

    google_drive.transport = httpx.MockTransport(handler)
    try:
        created = await google_drive.sheets_create(
            "token",
            {"title": "Week", "tabs": [{"name": "Week", "values": [["Day", "Posts"], ["Mon", 2]]}]},
        )
    finally:
        google_drive.transport = None
    assert created["spreadsheet_id"] == "abc"
    assert created["url"].endswith("/abc")
    batch = seen["batch"]
    assert isinstance(batch, dict)
    assert batch["valueInputOption"] == "RAW"
    assert batch["data"][0]["range"] == "'Week'!A1"
    assert batch["data"][0]["values"][1][1] == 2


def test_sheet_edit_stores_a_table_block_as_source():
    from app.services.canvas_content import retarget_kind_edit

    blocks, source, error = retarget_kind_edit(
        "sheet",
        [
            {"type": "text", "text": "Weersvoorspellingen"},
            {
                "type": "table",
                "title": "Twee weken",
                "columns": ["Dag", "Max"],
                "rows": [["za 24 okt", 14], {"Dag": "zo 25 okt", "Max": 13}],
            },
        ],
        None,
    )
    assert error is None
    assert blocks is None
    tab = json.loads(source)["tabs"][0]
    assert tab["name"] == "Twee weken"
    assert tab["columns"] == ["Dag", "Max"]
    assert tab["rows"] == [["za 24 okt", 14], ["zo 25 okt", 13]]

    blocks, source, error = retarget_kind_edit(
        "sheet",
        [{"type": "text", "text": "alleen een zin"}],
        None,
    )
    assert blocks is None and source is None
    assert error["status"] == "invalid"
    assert "sheet" in error["error"]
    assert "edit_example" in error
    assert error["edit_example"]["columns"] == ["Dag", "Temp"]
    assert "Not a stat" not in error["error"]
    assert "heading alone" not in error["error"]

    blocks, source, error = retarget_kind_edit("sheet", [], None)
    assert error["status"] == "invalid"
    assert "empty blocks" in error["error"]
    assert error["edit_field"] == "source"

    kept, kept_source, error = retarget_kind_edit(
        "dashboard",
        [{"type": "stat", "label": "Omzet", "value": "1"}],
        None,
    )
    assert error is None
    assert kept[0]["type"] == "stat"
    assert kept_source is None

    _blocks, kept_source, error = retarget_kind_edit(
        "document",
        [{"type": "heading", "text": "Not markdown"}],
        None,
    )
    assert error["status"] == "invalid"
    assert "markdown" in error["error"]
    assert error["edit_field"] == "source"
    assert kept_source is None


def test_edit_body_contract_covers_every_kind():
    from app.models.project_canvas import CANVAS_KINDS
    from app.services.canvas_content import attach_edit_contract, edit_body_contract

    expected_field = {
        "dashboard": "blocks",
        "document": "source",
        "diagram": "source",
        "drawing": "source",
        "image": "image_prompt",
        "code": "source",
        "email": "source",
        "sheet": "source",
        "design": "source",
    }
    for kind in CANVAS_KINDS:
        contract = edit_body_contract(kind)
        assert contract["field"] == expected_field[kind]
        assert contract["example"] not in (None, "")
        assert "edit_example" in contract["hint"] or kind == "dashboard"
        reply = attach_edit_contract({"canvas_id": "x"}, kind)
        assert reply["edit_field"] == contract["field"]
        assert reply["edit_example"] == contract["example"]
    sheet = edit_body_contract("sheet")
    assert sheet["example"] == {"columns": ["Dag", "Temp"], "rows": [["za", "12"]]}


def test_diagram_and_code_are_stored_without_the_jsx_compiler():
    from app.services.canvas_content import edit_body_hint

    diagram, _ = prepare_content("diagram", "flowchart TD\n  A-->B", language=None, tenant_id="T")
    assert diagram.startswith("flowchart")
    code, lang = prepare_content("code", "select 1\n", language="sql", tenant_id="T")
    assert lang == "sql"
    assert "select 1" in code
    assert "Mermaid" in edit_body_hint("diagram")
    assert "blocks" in edit_body_hint("dashboard")
    assert "markdown" in edit_body_hint("document")


@pytest.mark.asyncio
async def test_kinds_share_one_thread_and_reject_a_refresh_of_a_document(
    client: AsyncClient, session_override
):
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.project_canvas import (
        canvas_refresh_wake,
        create_canvas,
        put_canvas_source,
    )
    from app.models.project import Project
    from app.services.projects import create_project

    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    made = await create_project(session_override, tenant.id, name="Kinds home", tags=["kinds-home"])
    await session_override.commit()
    folder = await session_override.get(Project, UUID(str(made["id"])))
    assert folder is not None

    dash = await create_canvas(
        session_override,
        tenant.id,
        new_thread=True,
        folder_id=folder.id,
        title="Kind dashboard home",
        canvas_kind="dashboard",
        updated_by_type="user",
    )
    note = await create_canvas(
        session_override,
        tenant.id,
        title="Kind document home",
        canvas_kind="document",
        source="# Report\n\nKept in the same conversation.",
        signal_id=UUID(dash["signal_id"]),
        updated_by_type="user",
    )
    assert dash["signal_id"]
    assert dash["folder_id"] == str(folder.id)
    assert note["signal_id"] == dash["signal_id"]
    assert note["folder_id"] == str(folder.id)
    assert note["kind"] == "document"
    assert note["empty"] is False
    assert "Report" in note["source"]

    chart = await put_canvas_source(
        session_override,
        tenant.id,
        canvas_id=UUID(note["id"]),
        source="flowchart TD\n  A-->B",
    )
    # put writes the document kind that already exists; mermaid is not compiled as JSX
    assert chart["kind"] == "document"

    diagram = await create_canvas(
        session_override,
        tenant.id,
        title="Kind diagram home",
        canvas_kind="diagram",
        source="flowchart TD\n  A-->B",
        signal_id=UUID(dash["signal_id"]),
        updated_by_type="user",
    )
    assert diagram["kind"] == "diagram"
    assert diagram["signal_id"] == dash["signal_id"]
    assert diagram["source"].startswith("flowchart")
    assert diagram["tree"]["type"] == "Stack"
    assert diagram["tree"]["children"] == []

    token = canvas_refresh_wake.set(True)
    try:
        with pytest.raises((HTTPException, AppError)) as denied:
            await put_canvas_source(
                session_override,
                tenant.id,
                canvas_id=UUID(note["id"]),
                source="# Again",
            )
        assert denied.value.status_code == 400
    finally:
        canvas_refresh_wake.reset(token)

    with pytest.raises((HTTPException, AppError)) as brand:
        await create_canvas(
            session_override,
            tenant.id,
            title="Huisstijl kinds",
            canvas_kind="brand",
            source=json.dumps({"voice": "Calm"}),
            signal_id=UUID(dash["signal_id"]),
            updated_by_type="user",
        )
    assert brand.value.status_code == 400


def test_design_frames_are_plain_text():
    from app.services.canvas_content import edit_body_hint

    stored, lang = prepare_content(
        "design",
        json.dumps(
            {
                "frames": [
                    {
                        "id": "home",
                        "x": 10,
                        "y": 20,
                        "w": 300,
                        "h": 200,
                        "title": "<b>Start</b>",
                        "text": "Hello<script>nope</script>",
                    }
                ]
            }
        ),
        language=None,
        tenant_id="T",
    )
    assert lang is None
    data = json.loads(stored)
    assert data["frames"][0]["title"] == "Start"
    assert "<" not in data["frames"][0]["text"]
    assert "frames" in edit_body_hint("design")
    empty, _ = prepare_content("design", "", language=None, tenant_id="T")
    assert content_is_empty("design", empty)
    with pytest.raises(CanvasContentError):
        prepare_content("design", "not json", language=None, tenant_id="T")


@pytest.mark.asyncio
async def test_every_kind_keeps_the_previous_body(client: AsyncClient, session_override):
    """A document and a dashboard both snapshot before the next write."""
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.project import Project
    from app.services.project_canvas import (
        create_canvas,
        list_canvas_revisions,
        put_canvas_source,
        restore_canvas_revision,
    )
    from app.services.projects import create_project

    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    made = await create_project(session_override, tenant.id, name="Versions home", tags=["versions-home"])
    await session_override.commit()
    folder = await session_override.get(Project, UUID(str(made["id"])))
    assert folder is not None

    note = await create_canvas(
        session_override,
        tenant.id,
        new_thread=True,
        folder_id=folder.id,
        title="Version document",
        canvas_kind="document",
        source="# First",
        updated_by_type="user",
    )
    second = await put_canvas_source(
        session_override,
        tenant.id,
        canvas_id=UUID(note["id"]),
        source="# Second",
    )
    assert second["revision"] == note["revision"] + 1
    kept = await list_canvas_revisions(session_override, tenant.id, UUID(note["id"]))
    assert kept[0]["revision"] == note["revision"]
    assert kept[0]["kind"] == "document"

    board = await create_canvas(
        session_override,
        tenant.id,
        title="Version dashboard",
        canvas_kind="dashboard",
        signal_id=UUID(note["signal_id"]),
        updated_by_type="user",
    )
    first_blocks = [{"type": "stat", "label": "Berichten", "value": "3"}]
    filled = await put_canvas_source(
        session_override,
        tenant.id,
        canvas_id=UUID(board["id"]),
        blocks=first_blocks,
    )
    changed = await put_canvas_source(
        session_override,
        tenant.id,
        canvas_id=UUID(board["id"]),
        blocks=[{"type": "stat", "label": "Berichten", "value": "9"}],
    )
    assert changed["blocks"][0]["value"] == "9"
    restored = await restore_canvas_revision(
        session_override,
        tenant.id,
        UUID(board["id"]),
        filled["revision"],
    )
    assert restored["revision"] > changed["revision"]
    assert restored["blocks"][0]["value"] == "3"
    history = await list_canvas_revisions(session_override, tenant.id, UUID(board["id"]))
    assert any(row["kind"] == "dashboard" for row in history)
