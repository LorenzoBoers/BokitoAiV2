"""HTTP MCP surface for Bokito-hosted partner integrations (KING, …)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.services.partner_mcp import (
    SUPPORTED_PARTNERS,
    call_partner_tool,
    partner_tools,
    resolve_partner_server,
)

router = APIRouter(prefix="/mcp/partners", tags=["partner-mcp"])

PROTOCOL_VERSION = "2025-03-26"


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


def _rpc_result(req_id: int | str | None, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_error(req_id: int | str | None, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


@router.post("/{partner_slug}")
async def partner_mcp_endpoint(
    partner_slug: str,
    body: JsonRpcRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
):
    slug = partner_slug.strip().lower()
    if slug not in SUPPORTED_PARTNERS:
        raise HTTPException(status_code=404, detail="Unknown partner MCP")

    token = _bearer(authorization)
    server = await resolve_partner_server(session, slug, token)
    auth = {}
    try:
        import json

        raw = json.loads(server.auth_json or "{}")
        if isinstance(raw, dict):
            auth = raw
    except (json.JSONDecodeError, TypeError):
        auth = {}

    method = (body.method or "").strip()
    params = body.params or {}

    if method in ("initialize", "notifications/initialized"):
        if method == "notifications/initialized":
            return _rpc_result(body.id, {})
        return _rpc_result(
            body.id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": f"bokito-partner-{slug}", "version": "1.0.0"},
            },
        )

    if method == "tools/list":
        tools = partner_tools(slug)
        return _rpc_result(
            body.id,
            {
                "tools": [
                    {
                        "name": t["name"],
                        "description": t.get("description") or "",
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                    for t in tools
                ]
            },
        )

    if method == "tools/call":
        name = str(params.get("name") or "").strip()
        if not name:
            return _rpc_error(body.id, -32602, "Missing tool name")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        outcome = await call_partner_tool(slug, auth, name, arguments)
        if outcome.get("error"):
            return _rpc_result(
                body.id,
                {
                    "content": [{"type": "text", "text": str(outcome["error"])}],
                    "isError": True,
                },
            )
        import json as _json

        return _rpc_result(
            body.id,
            {
                "content": [
                    {
                        "type": "text",
                        "text": _json.dumps(outcome, default=str),
                    }
                ],
                "isError": False,
            },
        )

    if method == "ping":
        return _rpc_result(body.id, {})

    return _rpc_error(body.id, -32601, f"Method not found: {method}")
