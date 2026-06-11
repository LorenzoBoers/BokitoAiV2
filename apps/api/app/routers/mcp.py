"""Tenant-scoped MCP server: exposes the unified tool registry over HTTP.

Implements the MCP Streamable HTTP transport (JSON-RPC 2.0 over POST).
External clients (Cursor, IDEs, other agents) authenticate with a scoped
API token and call exactly the same governed tools internal agents use —
one implementation, two consumers. Every call flows through the allowance
policy engine with ``trust="api"``.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.api_token import ApiToken
from app.tools import execute_tool
from app.tools.registry import iter_tool_specs

router = APIRouter(prefix="/mcp", tags=["mcp"])

PROTOCOL_VERSION = "2025-03-26"
SERVER_INFO = {"name": "bokito-workspace", "version": "1.0.0"}


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


async def get_api_token(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> ApiToken:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    plain = authorization.split(" ", 1)[1].strip()
    from app.routers.govern import hash_token

    result = await session.execute(select(ApiToken).where(ApiToken.token_hash == hash_token(plain)))
    token = result.scalar_one_or_none()
    if not token or token.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Invalid or revoked token")
    token.last_used_at = datetime.utcnow()
    session.add(token)
    await session.flush()
    return token


def _token_scopes(token: ApiToken) -> set[str]:
    try:
        scopes = json.loads(token.scopes_json or "[]")
        return {str(s) for s in scopes} if isinstance(scopes, list) else set()
    except (json.JSONDecodeError, TypeError):
        return set()


def _rpc_result(req_id: int | str | None, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_error(req_id: int | str | None, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


@router.post("")
async def mcp_endpoint(
    body: JsonRpcRequest,
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    scopes = _token_scopes(token)

    if body.method == "initialize":
        return _rpc_result(
            body.id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": SERVER_INFO,
            },
        )

    if body.method in ("notifications/initialized", "initialized"):
        return _rpc_result(body.id, {})

    if body.method == "ping":
        return _rpc_result(body.id, {})

    if body.method == "tools/list":
        tools = [
            {
                "name": spec.name,
                "description": f"[{spec.category}] {spec.description}",
                "inputSchema": spec.input_schema,
            }
            for spec in iter_tool_specs()
            if not scopes or spec.category in scopes
        ]
        return _rpc_result(body.id, {"tools": tools})

    if body.method == "tools/call":
        params = body.params or {}
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}
        spec = next((s for s in iter_tool_specs() if s.name == tool_name), None)
        if spec is None:
            return _rpc_error(body.id, -32602, f"Unknown tool: {tool_name}")
        if scopes and spec.category not in scopes:
            return _rpc_error(body.id, -32602, f"Token not scoped for category: {spec.category}")

        result = await execute_tool(
            session,
            token.tenant_id,
            token.created_by_user_id,
            tool_name,
            arguments if isinstance(arguments, dict) else {},
            trust="api",
        )
        is_error = bool(isinstance(result, dict) and result.get("error"))
        return _rpc_result(
            body.id,
            {
                "content": [{"type": "text", "text": json.dumps(result, default=str)}],
                "isError": is_error,
            },
        )

    return _rpc_error(body.id, -32601, f"Method not found: {body.method}")
