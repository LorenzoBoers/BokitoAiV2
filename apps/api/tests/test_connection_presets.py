"""Presets with fields, native Mailblue, Drive through the documents module, daily health."""

import json

import httpx
import pytest
from fastapi import HTTPException
from app.exceptions import AppError
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.integration import IntegrationConnection, McpServer
from app.models.signal import Signal


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def test_build_from_fields_validates_and_routes_targets():
    from app.services.connection_presets import build_from_fields, public_fields

    fields = public_fields("mailblue")
    assert [f["key"] for f in fields] == ["account_url", "api_key"]
    assert "target" not in fields[0]
    with pytest.raises((HTTPException, AppError)) as missing:
        build_from_fields("mailblue", {"account_url": "https://acme.api-us1.com"})
    assert missing.value.status_code == 422

    url, auth, api_key = build_from_fields(
        "mailblue", {"account_url": "https://acme.api-us1.com", "api_key": "k-1"}
    )
    assert url == "native://mailblue"
    assert auth == {"account_url": "https://acme.api-us1.com", "api_key": "k-1", "auth_type": "fields"}
    assert api_key == ""

    with pytest.raises((HTTPException, AppError)):
        build_from_fields("zapier_mcp", {"server_url": "http://not-https.example"})
    url, _, _ = build_from_fields("zapier_mcp", {"server_url": "https://mcp.zapier.com/api/mcp/s/abc"})
    assert url == "https://mcp.zapier.com/api/mcp/s/abc"


@pytest.mark.asyncio
async def test_mailblue_connector_reads_lists(monkeypatch):
    from app.services.native_connectors import _http, native_connector

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Api-Token"] == "k-1"
        if request.url.path == "/api/3/users/me":
            return httpx.Response(200, json={"user": {"id": "1"}})
        if request.url.path == "/api/3/lists":
            return httpx.Response(200, json={"lists": [{"id": "7", "name": "Nieuwsbrief", "subscriber_count": "40"}]})
        return httpx.Response(404, json={"message": "nope"})

    monkeypatch.setattr(_http, "transport", httpx.MockTransport(handler))
    connector = native_connector("native://mailblue")
    auth = {"account_url": "acme.api-us1.com", "api_key": "k-1"}
    assert (await connector.validate(auth))["ok"] is True
    out = await connector.call(auth, "list_lists", {})
    assert out["result"] == [{"id": "7", "name": "Nieuwsbrief", "subscribers": "40"}]
    assert all(t["annotations"]["readOnlyHint"] for t in connector.TOOLS)


@pytest.mark.asyncio
async def test_documents_verbs_use_the_drive_connection(client, session_override, monkeypatch):
    from app.modules.documents import router as documents
    from app.modules.documents.adapters import google_drive
    from app.services.crypto import set_connection_credentials

    tenant = await _tenant(session_override)
    missing = await documents.call_verb(session_override, tenant.id, "search", {"query": "plan"})
    assert missing["ok"] is False and missing["code"] == "not_connected"

    conn = IntegrationConnection(tenant_id=tenant.id, provider="google_drive", display_name="Drive")
    set_connection_credentials(conn, {"access_token": "tok"})
    session_override.add(conn)
    await session_override.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tok"
        if request.url.path.endswith("/files"):
            return httpx.Response(200, json={"files": [{"id": "f1", "name": "Contentplan", "mimeType": "x"}]})
        if "/values/" in request.url.path:
            return httpx.Response(200, json={"range": "A1:B2", "values": [["Datum", "Kanaal"]]})
        return httpx.Response(404, json={"error": {"message": "nope"}})

    monkeypatch.setattr(google_drive, "transport", httpx.MockTransport(handler))
    found = await documents.call_verb(session_override, tenant.id, "search", {"query": "plan"})
    assert found["ok"] is True
    assert found["files"][0]["name"] == "Contentplan"
    read = await documents.call_verb(
        session_override, tenant.id, "sheets_read", {"spreadsheet_id": "s1", "range": "A1:B2"}
    )
    assert read["ok"] is True and read["values"] == [["Datum", "Kanaal"]]


@pytest.mark.asyncio
async def test_bad_connection_becomes_internal_signal_once(client, session_override, monkeypatch):
    from app.services import connection_health
    from app.services.native_connectors import _http

    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id,
        name="Mailblue",
        server_url="native://mailblue",
        auth_json=json.dumps({"account_url": "https://acme.api-us1.com", "api_key": "k"}),
    )
    session_override.add(server)
    await session_override.flush()
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="mailblue",
        display_name="Mailblue",
        metadata_json=json.dumps({"mcp_server_id": str(server.id)}),
    )
    session_override.add(conn)
    await session_override.commit()

    status = {"code": 200}
    monkeypatch.setattr(
        _http, "transport", httpx.MockTransport(lambda r: httpx.Response(status["code"], json={"message": "x"}))
    )
    first = await connection_health.check_server(session_override, server)
    assert first["after"] == "ok"

    status["code"] = 403
    second = await connection_health.check_server(session_override, server)
    assert second["after"] == "error"
    again = await connection_health.check_server(session_override, server)
    assert again["after"] == "error"

    rows = (
        await session_override.execute(
            select(Signal).where(Signal.tenant_id == tenant.id, Signal.external_id == f"connection_health:{conn.id}")
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].channel == "internal" and rows[0].assignee_kind == "department"
