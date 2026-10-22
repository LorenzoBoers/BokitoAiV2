"""Spreadsheet canvas: stored JSON, exported as CSV, Excel, or Google Sheets.

This module is the ``kind=sheet`` table. Cells are text or finite numbers.
Export is an operator action from the canvas; it does not open a second
conversation. Logo and brand colour live in workspace Settings, not here.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import zipfile
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.modules.documents.adapters import google_drive

MAX_TABS = 8
MAX_COLUMNS = 30
MAX_ROWS = 500
MAX_CELL = 1000
_BAD_NAME = re.compile(r"[:\\/?*\[\]]")
_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
_FORMULA = re.compile(r"^[=+\-@]")


def _fail(message: str) -> Exception:
    from app.services.canvas_content import CanvasContentError

    return CanvasContentError(message)


@dataclass(frozen=True)
class SheetTab:
    name: str
    columns: list[str]
    rows: list[list[Any]]


def is_empty(source: str | None) -> bool:
    from app.services.canvas_content import CanvasContentError

    try:
        tabs = load_tabs(source or "")
    except CanvasContentError:
        return True
    for tab in tabs:
        if any(str(col).strip() for col in tab.columns):
            return False
        if any(str(cell).strip() for row in tab.rows for cell in row):
            return False
    return True


def normalize_source(raw: str) -> str:
    tabs = load_tabs(raw)
    payload = {
        "tabs": [
            {"name": tab.name, "columns": tab.columns, "rows": tab.rows}
            for tab in tabs
        ]
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def load_tabs(raw: str) -> list[SheetTab]:
    text = (raw or "").strip()
    if not text:
        return [SheetTab("Sheet1", [], [])]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        data = _extract_json_value(text)
        if data is None:
            raise _fail(
                "A sheet stores JSON with columns and rows, or tabs"
            ) from exc
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise _fail("A sheet stores JSON with columns and rows, or tabs") from exc
    if isinstance(data, list):
        blocks = _blocks_from_list(data)
    elif isinstance(data, dict):
        incoming = data.get("tabs")
        if isinstance(incoming, list):
            blocks = [block for block in incoming if isinstance(block, dict)]
        else:
            blocks = [data]
    else:
        raise _fail("A sheet stores a JSON object")
    if len(blocks) > MAX_TABS:
        raise _fail(f"A sheet can hold {MAX_TABS} tabs")
    used: set[str] = set()
    tabs: list[SheetTab] = []
    for index, block in enumerate(blocks):
        pairs = [_column_pair(cell) for cell in _list(block.get("columns"), "columns")]
        columns = [header for header, _key in pairs]
        keys = [key for _header_name, key in pairs]
        rows = [
            _row_for(item, columns, keys) for item in _list(block.get("rows"), "rows")
        ]
        width = max([len(columns), *[len(row) for row in rows]], default=0)
        if width > MAX_COLUMNS:
            raise _fail(f"A sheet can hold {MAX_COLUMNS} columns")
        if len(rows) > MAX_ROWS:
            raise _fail(f"A sheet can hold {MAX_ROWS} rows")
        if len(columns) < width:
            columns = columns + [""] * (width - len(columns))
        rows = [row + [""] * (width - len(row)) for row in rows]
        tabs.append(
            SheetTab(
                name=_tab_name(str(block.get("name") or ""), used, index),
                columns=columns,
                rows=rows,
            )
        )
    return tabs or [SheetTab("Sheet1", [], [])]


def sheet_csv(source: str) -> str:
    tabs = load_tabs(source)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    several = len(tabs) > 1
    for tab in tabs:
        header = (["Sheet"] if several else []) + [_csv_cell(col) for col in tab.columns]
        writer.writerow(header)
        for row in tab.rows:
            cells = [_csv_cell(cell) for cell in row]
            writer.writerow(([tab.name] if several else []) + cells)
    return buffer.getvalue()


def sheet_xlsx(source: str) -> bytes:
    tabs = load_tabs(source)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", _content_types(len(tabs)))
        package.writestr("_rels/.rels", _root_rels())
        package.writestr("xl/workbook.xml", _workbook(tabs))
        package.writestr("xl/_rels/workbook.xml.rels", _workbook_rels(len(tabs)))
        for index, tab in enumerate(tabs, start=1):
            package.writestr(f"xl/worksheets/sheet{index}.xml", _worksheet(tab))
    return archive.getvalue()


def export_filename(title: str, ext: str) -> str:
    stem = _FILENAME.sub("-", title or "").strip("-.")[:60] or "sheet"
    return f"{stem}.{ext}"


async def publish_google_sheet(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    source: str,
) -> dict[str, str]:
    """Create a Google Sheet from this canvas using the workspace Drive connection."""
    from app.services.calendar_sync import _access_token

    conn = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == "google_drive",
                IntegrationConnection.status == "active",
            )
            .order_by(IntegrationConnection.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail="Connect Google Drive under Connections first.",
        )
    token = await _access_token(session, conn)
    if not token:
        raise HTTPException(
            status_code=409,
            detail="Google Drive needs to be connected again under Connections.",
        )
    tabs = load_tabs(source)
    payload = {
        "title": (title or "Sheet")[:200],
        "tabs": [{"name": tab.name, "values": _grid(tab)} for tab in tabs],
    }
    try:
        try:
            created = await google_drive.sheets_create(token, payload)
        except google_drive.DriveAuthError:
            token = await _access_token(session, conn, force_refresh=True)
            if not token:
                raise HTTPException(
                    status_code=409,
                    detail="Google Drive needs to be connected again under Connections.",
                ) from None
            created = await google_drive.sheets_create(token, payload)
    except google_drive.DriveAuthError as exc:
        raise HTTPException(
            status_code=409,
            detail="Google Drive needs to be connected again under Connections.",
        ) from exc
    except google_drive.DriveError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "spreadsheet_id": str(created.get("spreadsheet_id") or ""),
        "url": str(created.get("url") or ""),
        "title": str(created.get("title") or title),
    }


def detach_sheet_speech(text: str) -> str:
    """Chat stays a sentence. The sheet table and its JSON belong on the canvas."""
    if not text or not text.strip():
        return ""
    cleaned = _FENCE.sub("", text)
    cleaned = _strip_embedded_sheet(cleaned)
    kept: list[str] = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if _TABLE_LINE.match(line) or _RULE_LINE.match(stripped):
            continue
        if _PROGRESS.match(stripped.lstrip("-* ")):
            continue
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


_FENCE = re.compile(r"```[^\n]*\n.*?```", re.DOTALL)
_TABLE_LINE = re.compile(r"^\s*\|")
_RULE_LINE = re.compile(r"^([-*_])\1{2,}$")
_PROGRESS = re.compile(
    r"(?i)^(ik maak|de sheet|laat me|hier is de sheet|de laatste|ik voeg|"
    r"alternatief\b|voeg de data|i am (?:now )?making|the sheet is)"
)


def _extract_json_value(text: str) -> Any | None:
    for opener, closer in (("[", "]"), ("{", "}")):
        start = text.find(opener)
        while start >= 0:
            end = _balanced_end(text, start, opener, closer)
            if end is not None:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
            start = text.find(opener, start + 1)
    return None


def _balanced_end(text: str, start: int, opener: str, closer: str) -> int | None:
    depth = 0
    quote: str | None = None
    escape = False
    for index in range(start, len(text)):
        ch = text[index]
        if quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return index + 1
    return None


def _strip_embedded_sheet(text: str) -> str:
    """Drop one JSON value that is a sheet, wherever it sits in the sentence."""
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        while start >= 0:
            end = _balanced_end(text, start, opener, closer)
            if end is None:
                break
            chunk = text[start:end]
            if "columns" in chunk or "tabs" in chunk:
                try:
                    json.loads(chunk)
                except json.JSONDecodeError:
                    start = text.find(opener, start + 1)
                    continue
                return (text[:start] + text[end:]).strip()
            start = text.find(opener, start + 1)
    return text


def _blocks_from_list(data: list[Any]) -> list[dict[str, Any]]:
    if data and all(
        isinstance(item, dict) and ("columns" in item or "rows" in item or "tabs" in item)
        for item in data
    ):
        blocks: list[dict[str, Any]] = []
        for item in data:
            incoming = item.get("tabs") if isinstance(item, dict) else None
            if isinstance(incoming, list):
                blocks.extend(block for block in incoming if isinstance(block, dict))
            elif isinstance(item, dict):
                blocks.append(item)
        return blocks
    return [{"columns": [], "rows": data}]


def _column_pair(value: Any) -> tuple[str, str]:
    """Header shown in the sheet, and the key a dict row is read with."""
    if isinstance(value, dict):
        header = ""
        for key in ("header", "label", "title", "name"):
            if key in value and not isinstance(value[key], (dict, list)):
                header = str(_cell(value[key]))
                break
        ident = ""
        if "id" in value and not isinstance(value["id"], (dict, list)):
            ident = str(_cell(value["id"]))
        header = header or ident
        return header, ident or header
    header = _header(value)
    return header, header


def _list(value: Any, label: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise _fail(f"A sheet {label} list must be an array")
    return value


def _header(value: Any) -> str:
    cell = _cell(value)
    return str(cell)


def _row(value: Any) -> list[Any]:
    if not isinstance(value, list):
        raise _fail("Each sheet row is a list of cells")
    return [_cell(cell) for cell in value]


def _row_for(value: Any, columns: list[str], keys: list[str] | None = None) -> list[Any]:
    if isinstance(value, dict):
        id_keys = keys or []
        if id_keys and any(key in value for key in id_keys):
            return [_cell(value.get(key)) for key in id_keys]
        if columns and any(key in value for key in columns):
            return [_cell(value.get(column)) for column in columns]
        return [_cell(cell) for cell in value.values()]
    return _row(value)


def _cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _fail("A sheet cell must be text or a finite number")
        return value
    if isinstance(value, str):
        text = "".join(ch for ch in value if ch >= " " or ch in "\t\n\r").strip()
        if len(text) > MAX_CELL:
            raise _fail("A sheet cell is too long")
        return text
    if isinstance(value, dict):
        for key in ("header", "name", "title", "label", "value"):
            if key in value and not isinstance(value[key], (dict, list)):
                return _cell(value[key])
    raise _fail("A sheet cell must be text or a number")


def _tab_name(raw: str, used: set[str], index: int) -> str:
    name = _BAD_NAME.sub(" ", raw).strip() or f"Sheet{index + 1}"
    name = name[:31]
    base = name
    n = 2
    while name.casefold() in used:
        suffix = f" {n}"
        name = base[: 31 - len(suffix)] + suffix
        n += 1
    used.add(name.casefold())
    return name


def _csv_cell(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if _FORMULA.match(text):
        return f"'{text}"
    return text


def _grid(tab: SheetTab) -> list[list[Any]]:
    return [list(tab.columns), *[list(row) for row in tab.rows]]


def _xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _col(index: int) -> str:
    name = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        name = chr(65 + rem) + name
    return name


def _content_types(count: int) -> str:
    sheets = "".join(
        '<Override PartName="/xl/worksheets/sheet'
        f'{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f"{sheets}</Types>"
    )


def _root_rels() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def _workbook(tabs: list[SheetTab]) -> str:
    sheets = "".join(
        f'<sheet name="{_xml(tab.name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, tab in enumerate(tabs, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheets}</sheets></workbook>"
    )


def _workbook_rels(count: int) -> str:
    rels = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{rels}</Relationships>"
    )


def _worksheet(tab: SheetTab) -> str:
    grid = _grid(tab)
    rows: list[str] = []
    for r_index, row in enumerate(grid, start=1):
        cells: list[str] = []
        for c_index, value in enumerate(row):
            ref = f"{_col(c_index)}{r_index}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                continue
            text = _csv_cell(value)
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{_xml(text)}</t></is></c>'
            )
        rows.append(f'<row r="{r_index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(rows)}</sheetData></worksheet>'
    )
