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


def test_diagram_and_code_are_stored_without_the_jsx_compiler():
    diagram, _ = prepare_content("diagram", "flowchart TD\n  A-->B", language=None, tenant_id="T")
    assert diagram.startswith("flowchart")
    code, lang = prepare_content("code", "select 1\n", language="sql", tenant_id="T")
    assert lang == "sql"
    assert "select 1" in code


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
