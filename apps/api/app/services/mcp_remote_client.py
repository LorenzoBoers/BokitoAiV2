"""Client for vendor-hosted MCP servers over Streamable HTTP.

One path for discovery (``tools/list``) and calls (``tools/call``):

- ``initialize`` then ``notifications/initialized``; the server's
  ``Mcp-Session-Id`` and protocol version go on every later request.
- Responses are JSON or an SSE stream; both are read.
- A 404 on a known session means it expired: initialize again, once.
- A 401 refreshes the OAuth token once (``ensure_fresh_token``); when that
  fails the connection is marked ``needs_reconnect``.

Servers that do not implement ``initialize`` (plain JSON-RPC endpoints) keep
working stateless.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection, McpServer
from app.services.mcp_auth import mcp_auth_headers

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
SESSION_TTL_S = 15 * 60
REFRESH_MARGIN_S = 60
MAX_SCHEMA_CHARS = 4000
MAX_TOOL_PAGES = 10

HEALTH_OK = "ok"
HEALTH_RECONNECT = "needs_reconnect"
HEALTH_ERROR = "error"


class McpCallError(Exception):
    def __init__(self, message: str, *, needs_reconnect: bool = False, status: int | None = None):
        super().__init__(message)
        self.needs_reconnect = needs_reconnect
        self.status = status


@dataclass
class _Session:
    session_id: str | None
    protocol_version: str
    stateless: bool
    expires: float


_SESSIONS: dict[UUID, _Session] = {}
# Tests swap in an ``httpx.MockTransport``; None is the network.
transport: httpx.AsyncBaseTransport | None = None


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, follow_redirects=True, transport=transport)


def forget_session(server_id: UUID) -> None:
    _SESSIONS.pop(server_id, None)


def _auth_of(server: McpServer) -> dict[str, Any]:
    try:
        data = json.loads(server.auth_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def parse_rpc_body(response: httpx.Response, request_id: str | None) -> dict[str, Any] | None:
    """The JSON-RPC message answering ``request_id`` from a JSON or SSE body."""
    if response.status_code == 202 or not response.content:
        return None
    ctype = response.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        found: dict[str, Any] | None = None
        data_lines: list[str] = []

        def flush() -> dict[str, Any] | None:
            if not data_lines:
                return None
            raw = "\n".join(data_lines)
            data_lines.clear()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                return None
            if isinstance(message, dict) and (request_id is None or str(message.get("id")) == request_id):
                return message
            return None

        for line in response.text.splitlines():
            if not line.strip():
                found = flush() or found
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        found = flush() or found
        return found
    try:
        body = response.json()
    except ValueError as exc:
        raise McpCallError(f"MCP server returned no JSON ({response.status_code})") from exc
    if isinstance(body, list):
        body = next((m for m in body if isinstance(m, dict) and str(m.get("id")) == request_id), None)
    return body if isinstance(body, dict) else None


async def connection_for_server(session: AsyncSession, server: McpServer) -> IntegrationConnection | None:
    rows = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == server.tenant_id,
                IntegrationConnection.metadata_json.contains(str(server.id)),
            )
        )
    ).scalars().all()
    return rows[0] if rows else None


async def record_health(
    session: AsyncSession, server: McpServer, status: str, error: str = ""
) -> tuple[str, str]:
    """Store the connection's health on its metadata. Returns (before, after)."""
    conn = await connection_for_server(session, server)
    if conn is None:
        return "", status
    try:
        meta = json.loads(conn.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    before = str((meta.get("health") or {}).get("status") or "")
    meta["health"] = {
        "status": status,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "error": error[:300],
    }
    conn.metadata_json = json.dumps(meta)
    session.add(conn)
    return before, status


def _expires_soon(auth: dict[str, Any]) -> bool:
    raw = auth.get("expires_at")
    if not raw:
        return False
    try:
        at = datetime.fromisoformat(str(raw))
    except ValueError:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return at <= datetime.now(timezone.utc) + timedelta(seconds=REFRESH_MARGIN_S)


async def ensure_fresh_token(
    session: AsyncSession, server: McpServer, *, force: bool = False
) -> bool:
    """Refresh a remote OAuth access token when it is about to expire (or ``force``).

    Returns True when a new token was stored. Needs the ``refresh_token``,
    ``token_endpoint`` and ``client_id`` saved at connect time.
    """
    auth = _auth_of(server)
    refresh = auth.get("refresh_token")
    endpoint = auth.get("token_endpoint")
    client_id = auth.get("client_id")
    if not (refresh and endpoint and client_id):
        return False
    if not force and not _expires_soon(auth):
        return False
    data = {"grant_type": "refresh_token", "refresh_token": str(refresh), "client_id": str(client_id)}
    if auth.get("resource"):
        data["resource"] = str(auth["resource"])
    basic: tuple[str, str] | None = None
    if auth.get("client_secret"):
        basic = (str(client_id), str(auth["client_secret"]))
        data.pop("client_id")
    try:
        async with _client(20.0) as client:
            response = await client.post(
                str(endpoint),
                data=data,
                headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
                auth=basic,
            )
        response.raise_for_status()
        tokens = response.json()
    except Exception as exc:
        logger.info("MCP token refresh failed for %s: %s", server.name, exc)
        return False
    if not isinstance(tokens, dict) or not tokens.get("access_token"):
        return False
    auth["access_token"] = tokens["access_token"]
    if tokens.get("refresh_token"):
        auth["refresh_token"] = tokens["refresh_token"]
    expires_in = tokens.get("expires_in")
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        auth["expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()
    else:
        auth.pop("expires_at", None)
    server.auth_json = json.dumps(auth)
    session.add(server)
    conn = await connection_for_server(session, server)
    if conn is not None:
        from app.services.crypto import encrypt_credentials_blob

        conn.credentials_json = encrypt_credentials_blob(auth)
        session.add(conn)
    await session.flush()
    return True


def _headers(server: McpServer, state: _Session | None) -> dict[str, str]:
    headers = mcp_auth_headers(_auth_of(server))
    headers["Accept"] = "application/json, text/event-stream"
    if state is not None and not state.stateless:
        if state.session_id:
            headers["Mcp-Session-Id"] = state.session_id
        headers["MCP-Protocol-Version"] = state.protocol_version
    return headers


async def _initialize(client: httpx.AsyncClient, server: McpServer) -> _Session:
    payload = {
        "jsonrpc": "2.0",
        "id": "init",
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "Bokito", "version": "1.0"},
        },
    }
    response = await client.post(server.server_url, json=payload, headers=_headers(server, None))
    if response.status_code == 401:
        raise McpCallError("unauthorized", needs_reconnect=True, status=401)
    stateless = _Session(None, PROTOCOL_VERSION, True, time.monotonic() + SESSION_TTL_S)
    if response.status_code >= 400:
        return stateless
    try:
        message = parse_rpc_body(response, "init")
    except McpCallError:
        return stateless
    if not message or "error" in message or not isinstance(message.get("result"), dict):
        return stateless
    state = _Session(
        session_id=response.headers.get("mcp-session-id"),
        protocol_version=str(message["result"].get("protocolVersion") or PROTOCOL_VERSION),
        stateless=False,
        expires=time.monotonic() + SESSION_TTL_S,
    )
    await client.post(
        server.server_url,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers=_headers(server, state),
    )
    return state


async def rpc(
    session: AsyncSession,
    server: McpServer,
    method: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """Send one JSON-RPC request and return its ``result``. Raises ``McpCallError``."""
    await ensure_fresh_token(session, server)
    refreshed = False
    reinitialized = False
    async with _client(timeout) as client:
        while True:
            state = _SESSIONS.get(server.id)
            try:
                if state is None or state.expires < time.monotonic():
                    state = await _initialize(client, server)
                    _SESSIONS[server.id] = state
                request_id = f"{method}-{int(time.monotonic() * 1000)}"
                response = await client.post(
                    server.server_url,
                    json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}},
                    headers=_headers(server, state),
                )
                if response.status_code == 401:
                    raise McpCallError("unauthorized", needs_reconnect=True, status=401)
            except McpCallError as exc:
                if exc.status == 401 and not refreshed:
                    refreshed = True
                    forget_session(server.id)
                    if await ensure_fresh_token(session, server, force=True):
                        continue
                if exc.needs_reconnect:
                    await record_health(session, server, HEALTH_RECONNECT, str(exc))
                raise
            except httpx.HTTPError as exc:
                raise McpCallError(f"MCP server unreachable: {exc}") from exc
            if response.status_code == 404 and not state.stateless and not reinitialized:
                reinitialized = True
                forget_session(server.id)
                continue
            if response.status_code >= 400:
                raise McpCallError(
                    f"MCP server answered {response.status_code}: {response.text[:200]}",
                    status=response.status_code,
                )
            message = parse_rpc_body(response, request_id)
            if message is None:
                raise McpCallError("MCP server sent no answer")
            if message.get("error"):
                err = message["error"]
                text = err.get("message") if isinstance(err, dict) else str(err)
                raise McpCallError(str(text or "MCP error"))
            result = message.get("result")
            return result if isinstance(result, dict) else {"value": result}


def _compact_schema(schema: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return {}
    if len(json.dumps(schema)) <= MAX_SCHEMA_CHARS:
        return schema
    props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    slim = {
        name: {k: v for k, v in (spec or {}).items() if k in ("type", "enum", "description")}
        for name, spec in props.items()
    }
    for spec in slim.values():
        if isinstance(spec.get("description"), str):
            spec["description"] = spec["description"][:160]
    return {"type": "object", "properties": slim, "required": schema.get("required") or []}


def tool_row(raw: dict[str, Any]) -> dict[str, Any]:
    """The cached shape of one discovered tool."""
    annotations = raw.get("annotations") if isinstance(raw.get("annotations"), dict) else {}
    return {
        "name": str(raw.get("name", "")),
        "description": str(raw.get("description", ""))[:300],
        "input_schema": _compact_schema(raw.get("inputSchema")),
        "annotations": {
            k: annotations[k]
            for k in ("readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint", "title")
            if k in annotations
        },
    }


async def list_tools(session: AsyncSession, server: McpServer) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(MAX_TOOL_PAGES):
        result = await rpc(session, server, "tools/list", {"cursor": cursor} if cursor else {}, timeout=20.0)
        tools.extend(tool_row(t) for t in result.get("tools") or [] if isinstance(t, dict) and t.get("name"))
        cursor = result.get("nextCursor")
        if not cursor:
            break
    return tools


async def cached_tools(session: AsyncSession, tenant_id: UUID, server_name: str) -> tuple[McpServer | None, list[dict[str, Any]]]:
    server = (
        await session.execute(
            select(McpServer).where(McpServer.tenant_id == tenant_id, McpServer.name == server_name)
        )
    ).scalar_one_or_none()
    if server is None:
        return None, []
    try:
        tools = json.loads(server.tools_json or "[]")
    except json.JSONDecodeError:
        tools = []
    return server, [t for t in tools if isinstance(t, dict)] if isinstance(tools, list) else []


async def is_read_only_mcp_call(
    session: AsyncSession, tenant_id: UUID, tool_input: dict[str, Any] | None
) -> bool:
    """The server marks the tool ``readOnlyHint`` and not ``destructiveHint``.

    A missing hint counts as a write, so the workspace allowance decides.
    """
    if not isinstance(tool_input, dict):
        return False
    _, tools = await cached_tools(session, tenant_id, str(tool_input.get("server_name") or ""))
    name = str(tool_input.get("tool_name") or "")
    tool = next((t for t in tools if t.get("name") == name), None)
    hints = (tool or {}).get("annotations") or {}
    return bool(hints.get("readOnlyHint")) and not hints.get("destructiveHint")


async def call_tool(
    session: AsyncSession, server: McpServer, tool_name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    return await rpc(session, server, "tools/call", {"name": tool_name, "arguments": arguments or {}})
