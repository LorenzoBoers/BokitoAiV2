"""Google Drive and Sheets over the REST APIs with the connection's OAuth token."""

from __future__ import annotations

from typing import Any

import httpx

DRIVE = "https://www.googleapis.com/drive/v3"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
MAX_CONTENT_CHARS = 20000
MAX_FILES = 50
_FIELDS = "files(id,name,mimeType,modifiedTime,webViewLink,parents)"
_EXPORT = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}

transport: httpx.AsyncBaseTransport | None = None


class DriveAuthError(Exception):
    pass


class DriveError(Exception):
    pass


def _client(token: str) -> httpx.AsyncClient:
    kwargs: dict[str, Any] = {"timeout": 20.0, "headers": {"Authorization": f"Bearer {token}"}}
    if transport is not None:
        kwargs["transport"] = transport
    return httpx.AsyncClient(**kwargs)


def _check(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise DriveAuthError()
    if response.status_code >= 400:
        try:
            message = response.json().get("error", {}).get("message")
        except ValueError:
            message = response.text[:200]
        raise DriveError(f"Google returned {response.status_code}: {message}")


def _file(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "mime": row.get("mimeType"),
        "modified_at": row.get("modifiedTime"),
        "url": row.get("webViewLink"),
    }


def _limit(args: dict[str, Any]) -> int:
    try:
        return max(1, min(MAX_FILES, int(args.get("limit") or 20)))
    except (TypeError, ValueError):
        return 20


async def search(token: str, args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or "").replace("'", "\\'").strip()
    q = "trashed = false"
    if query:
        q += f" and (name contains '{query}' or fullText contains '{query}')"
    async with _client(token) as http:
        response = await http.get(f"{DRIVE}/files", params={"q": q, "pageSize": _limit(args), "fields": _FIELDS})
    _check(response)
    return {"files": [_file(r) for r in response.json().get("files") or []]}


async def list_files(token: str, args: dict[str, Any]) -> dict[str, Any]:
    folder = str(args.get("folder_id") or "root").replace("'", "").strip() or "root"
    q = f"'{folder}' in parents and trashed = false"
    async with _client(token) as http:
        response = await http.get(
            f"{DRIVE}/files",
            params={"q": q, "pageSize": _limit(args), "fields": _FIELDS, "orderBy": "modifiedTime desc"},
        )
    _check(response)
    return {"files": [_file(r) for r in response.json().get("files") or []]}


async def get_content(token: str, args: dict[str, Any]) -> dict[str, Any]:
    file_id = str(args.get("file_id") or "").strip()
    if not file_id:
        raise DriveError("file_id is required; use documents_search or documents_list first.")
    async with _client(token) as http:
        meta = await http.get(f"{DRIVE}/files/{file_id}", params={"fields": "id,name,mimeType,webViewLink"})
        _check(meta)
        info = meta.json()
        mime = str(info.get("mimeType") or "")
        if mime in _EXPORT:
            response = await http.get(f"{DRIVE}/files/{file_id}/export", params={"mimeType": _EXPORT[mime]})
        elif mime.startswith("text/") or mime in ("application/json", "application/csv"):
            response = await http.get(f"{DRIVE}/files/{file_id}", params={"alt": "media"})
        else:
            return {"file": _file(info), "content": "", "note": f"{mime} has no text content to read."}
    _check(response)
    text = response.text
    return {"file": _file(info), "content": text[:MAX_CONTENT_CHARS], "truncated": len(text) > MAX_CONTENT_CHARS}


def _sheet_args(args: dict[str, Any]) -> tuple[str, str]:
    sheet = str(args.get("spreadsheet_id") or "").strip()
    cell_range = str(args.get("range") or "A1:Z200").strip()
    if not sheet:
        raise DriveError("spreadsheet_id is required.")
    return sheet, cell_range


def _rows(args: dict[str, Any]) -> list[list[Any]]:
    values = args.get("values")
    if not isinstance(values, list) or not all(isinstance(r, list) for r in values):
        raise DriveError("values is a list of rows, each a list of cells.")
    return values


async def sheets_read(token: str, args: dict[str, Any]) -> dict[str, Any]:
    sheet, cell_range = _sheet_args(args)
    async with _client(token) as http:
        response = await http.get(f"{SHEETS}/{sheet}/values/{cell_range}")
    _check(response)
    return {"range": response.json().get("range"), "values": response.json().get("values") or []}


async def sheets_append(token: str, args: dict[str, Any]) -> dict[str, Any]:
    sheet, cell_range = _sheet_args(args)
    async with _client(token) as http:
        response = await http.post(
            f"{SHEETS}/{sheet}/values/{cell_range}:append",
            params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
            json={"values": _rows(args)},
        )
    _check(response)
    return {"updated": (response.json().get("updates") or {}).get("updatedRange")}


async def sheets_update(token: str, args: dict[str, Any]) -> dict[str, Any]:
    sheet, cell_range = _sheet_args(args)
    async with _client(token) as http:
        response = await http.put(
            f"{SHEETS}/{sheet}/values/{cell_range}",
            params={"valueInputOption": "USER_ENTERED"},
            json={"values": _rows(args)},
        )
    _check(response)
    return {"updated": response.json().get("updatedRange")}


async def sheets_create(token: str, args: dict[str, Any]) -> dict[str, Any]:
    """Create a spreadsheet and write each tab. Used by sheet-canvas export."""
    title = str(args.get("title") or "Sheet").strip()[:200] or "Sheet"
    incoming = args.get("tabs")
    if not isinstance(incoming, list) or not incoming:
        raise DriveError("tabs is a list of sheets to create.")
    tabs: list[dict[str, Any]] = []
    for index, tab in enumerate(incoming[:8]):
        if not isinstance(tab, dict):
            continue
        name = str(tab.get("name") or f"Sheet{index + 1}").strip()[:31] or f"Sheet{index + 1}"
        values = tab.get("values")
        if not isinstance(values, list) or not all(isinstance(row, list) for row in values):
            raise DriveError("Each tab values list is rows of cells.")
        tabs.append({"name": name, "values": values})
    if not tabs:
        raise DriveError("tabs is a list of sheets to create.")
    body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": tab["name"]}} for tab in tabs],
    }
    async with _client(token) as http:
        created = await http.post(SHEETS, json=body)
        _check(created)
        data = created.json()
        spreadsheet_id = str(data.get("spreadsheetId") or "")
        if not spreadsheet_id:
            raise DriveError("Google did not return a spreadsheet.")
        batch = {
            "valueInputOption": "RAW",
            "data": [
                {"range": f"'{tab['name'].replace(chr(39), chr(39) * 2)}'!A1", "values": tab["values"]}
                for tab in tabs
                if any(row for row in tab["values"])
            ],
        }
        if batch["data"]:
            updated = await http.post(f"{SHEETS}/{spreadsheet_id}/values:batchUpdate", json=batch)
            _check(updated)
    url = str(data.get("spreadsheetUrl") or f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}")
    return {"spreadsheet_id": spreadsheet_id, "url": url, "title": title}


VERBS = {
    "search": search,
    "list": list_files,
    "get_content": get_content,
    "sheets_read": sheets_read,
    "sheets_append": sheets_append,
    "sheets_update": sheets_update,
}
