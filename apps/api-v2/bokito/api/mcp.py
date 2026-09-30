"""Workspace MCP endpoint (Streamable HTTP, JSON-RPC 2.0) at `/api/mcp`.

One endpoint, one principal shape: a `bok2_` API token or an OAuth access
token resolves to `Principal(trust="api")`. Tools are the same registry the
dashboard palette and agents use; `tools/call` goes through `execute_tool`,
so policy applies and consequential calls come back as a Decision in the
thread instead of executing.

Stateless: no server-side session store. `Mcp-Session-Id` is echoed so
clients that require one keep working; GET opens a heartbeat-only SSE stream.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from bokito import __version__
from bokito.deps import ApiClient, DbSession, Principal
from bokito.domain.conversation import ConversationStatus
from bokito.domain.orient import Doc
from bokito.errors import AppError, Denied
from bokito.services import conversation as conv_svc
from bokito.services import decision as decision_svc
from bokito.services import knowledge as knowledge_svc
from bokito.services import modules as modules_svc
from bokito.services import oauth as oauth_svc
from bokito.tools.executor import execute_tool
from bokito.tools.registry import ToolDef, registry

router = APIRouter(prefix="/mcp", tags=["mcp"])

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
JSONRPC = "2.0"

INSTRUCTIONS = (
    "Bokito is the governed conversation layer of this company. Read with "
    "list_conversations, get_conversation, list_contacts and search_knowledge before "
    "acting. Writes and external actions run under the workspace policy: when a call "
    "returns status 'decision', an operator has to approve it in the thread; do not "
    "retry it. Never invent state that a read tool can give you."
)

PROMPTS: list[dict[str, Any]] = [
    {
        "name": "workspace_brief",
        "description": "What is open right now: attention queue, waiting decisions, recent runs.",
        "arguments": [],
    },
    {
        "name": "draft_reply",
        "description": "Draft a reply for a conversation in the workspace voice.",
        "arguments": [
            {"name": "conversation_id", "description": "Conversation UUID", "required": True}
        ],
    },
]


# JSON-RPC helpers -------------------------------------------------------------


def _ok(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC, "id": req_id, "result": result}


def _err(req_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "jsonrpc": JSONRPC,
        "id": req_id,
        "error": {"code": code, "message": message},
    }
    if data is not None:
        body["error"]["data"] = data
    return body


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def _annotations(tool: ToolDef) -> dict[str, Any]:
    read = tool.category == "read"
    return {
        "title": tool.name.replace("_", " "),
        "readOnlyHint": read,
        "destructiveHint": tool.consequential or tool.category == "destructive",
        "idempotentHint": read,
        "openWorldHint": tool.category in ("communicate", "external"),
    }


async def _tool_listing(session: AsyncSession, principal: Principal) -> list[dict[str, Any]]:
    installed = await modules_svc.installed_slugs(session, principal.tenant_id)
    out = []
    for t in registry.list(trust="api", modules=installed):
        out.append(
            {
                "name": t.name,
                "description": t.description,
                "inputSchema": t.schema(),
                "annotations": _annotations(t),
            }
        )
    return out


def _text_result(payload: Any, *, is_error: bool = False) -> dict[str, Any]:
    text = (
        payload
        if isinstance(payload, str)
        else json.dumps(payload, ensure_ascii=False, default=str)
    )
    result: dict[str, Any] = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if isinstance(payload, dict):
        result["structuredContent"] = payload
    return result


# Methods -----------------------------------------------------------------------


async def _tools_call(
    session: AsyncSession, principal: Principal, params: dict[str, Any]
) -> dict[str, Any]:
    name = str(params.get("name") or "")
    args = params.get("arguments") or {}
    if not name:
        raise RpcError(-32602, "tool name is required")
    if not isinstance(args, dict):
        raise RpcError(-32602, "arguments must be an object")
    conversation_id = None
    meta = params.get("_meta") or {}
    raw_conv = args.get("conversation_id") or meta.get("conversation_id")
    if raw_conv:
        try:
            conversation_id = uuid.UUID(str(raw_conv))
        except ValueError:
            conversation_id = None
    try:
        outcome = await execute_tool(
            session,
            principal,
            name,
            args,
            conversation_id=conversation_id,
            raise_on_deny=False,
        )
    except Denied as exc:
        await session.rollback()
        return _text_result({"status": "denied", "reason": exc.message}, is_error=True)
    except AppError as exc:
        await session.commit()
        return _text_result(
            {"status": "error", "code": exc.code, "message": exc.message, "details": exc.details},
            is_error=True,
        )
    await session.commit()
    if outcome.status == "decision":
        return _text_result(
            {
                "status": "decision",
                "run_id": str(outcome.run_id),
                "decision_id": str(outcome.decision_id),
                "hint": "An operator has to approve this call in the conversation thread. "
                "Do not retry; the result lands in the thread once resolved.",
            }
        )
    if outcome.status == "denied":
        return _text_result({"status": "denied", "reason": outcome.reason}, is_error=True)
    return _text_result({"status": "done", "run_id": str(outcome.run_id), "result": outcome.result})


def _doc_uri(doc: Doc) -> str:
    return f"bokito://docs/{doc.path}"


async def _resources_list(session: AsyncSession, principal: Principal) -> dict[str, Any]:
    docs = await knowledge_svc.list_docs(session, principal.tenant_id)
    return {
        "resources": [
            {
                "uri": _doc_uri(d),
                "name": d.title,
                "title": d.title,
                "description": f"{d.kind.value} document",
                "mimeType": "text/markdown",
            }
            for d in docs
            if d.kind.value in ("doc", "skill", "snippet")
        ]
    }


async def _resources_read(
    session: AsyncSession, principal: Principal, params: dict[str, Any]
) -> dict[str, Any]:
    uri = str(params.get("uri") or "")
    prefix = "bokito://docs/"
    if not uri.startswith(prefix):
        raise RpcError(-32002, f"unknown resource: {uri}")
    doc = await knowledge_svc.get_by_path(session, principal.tenant_id, uri[len(prefix) :])
    if not doc:
        raise RpcError(-32002, f"resource not found: {uri}")
    return {
        "contents": [
            {"uri": uri, "mimeType": "text/markdown", "text": f"# {doc.title}\n\n{doc.body}"}
        ]
    }


async def _prompts_get(
    session: AsyncSession, principal: Principal, params: dict[str, Any]
) -> dict[str, Any]:
    name = str(params.get("name") or "")
    args = params.get("arguments") or {}
    if name == "workspace_brief":
        f = conv_svc.ConversationFilters(status=[ConversationStatus.open], queue="attention")
        convs = await conv_svc.list_conversations(session, principal.tenant_id, f, limit=10)
        decisions = await decision_svc.list_open(session, principal.tenant_id, limit=10)
        lines = ["Open conversations needing attention:"]
        lines += [f"- {c.id}: {c.subject or '(no subject)'} [{c.channel.value}]" for c in convs]
        lines.append("")
        lines.append("Decisions waiting for an operator:")
        lines += [f"- {d.id}: {d.title}" for d in decisions] or ["- none"]
        return {
            "description": "Workspace brief",
            "messages": [{"role": "user", "content": {"type": "text", "text": "\n".join(lines)}}],
        }
    if name == "draft_reply":
        cid = str(args.get("conversation_id") or "")
        text = (
            f"Read conversation {cid} with get_conversation, then draft a reply in the "
            "workspace voice. Use suggest_reply if available; do not send without approval."
        )
        return {
            "description": "Draft a reply",
            "messages": [{"role": "user", "content": {"type": "text", "text": text}}],
        }
    raise RpcError(-32602, f"unknown prompt: {name}")


async def dispatch(
    session: AsyncSession, principal: Principal, message: dict[str, Any]
) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. Returns None for notifications."""
    method = message.get("method")
    req_id = message.get("id")
    params = message.get("params") or {}
    if not isinstance(method, str):
        return _err(req_id, -32600, "invalid request: method missing")
    if method.startswith("notifications/"):
        return None
    try:
        if method == "initialize":
            requested = str(params.get("protocolVersion") or PROTOCOL_VERSION)
            version = requested if requested in SUPPORTED_VERSIONS else PROTOCOL_VERSION
            return _ok(
                req_id,
                {
                    "protocolVersion": version,
                    "capabilities": {
                        "tools": {"listChanged": False},
                        "resources": {"subscribe": False, "listChanged": False},
                        "prompts": {"listChanged": False},
                    },
                    "serverInfo": {
                        "name": "bokito",
                        "title": "Bokito workspace",
                        "version": __version__,
                    },
                    "instructions": INSTRUCTIONS,
                },
            )
        if method == "ping":
            return _ok(req_id, {})
        if method == "tools/list":
            return _ok(req_id, {"tools": await _tool_listing(session, principal)})
        if method == "tools/call":
            return _ok(req_id, await _tools_call(session, principal, params))
        if method == "resources/list":
            return _ok(req_id, await _resources_list(session, principal))
        if method == "resources/templates/list":
            return _ok(req_id, {"resourceTemplates": []})
        if method == "resources/read":
            return _ok(req_id, await _resources_read(session, principal, params))
        if method == "prompts/list":
            return _ok(req_id, {"prompts": PROMPTS})
        if method == "prompts/get":
            return _ok(req_id, await _prompts_get(session, principal, params))
        if method in ("completion/complete", "logging/setLevel"):
            return _err(req_id, -32601, f"method not supported: {method}")
        return _err(req_id, -32601, f"method not found: {method}")
    except RpcError as exc:
        return _err(req_id, exc.code, exc.message, exc.data)


# HTTP surface ------------------------------------------------------------------


def _session_headers(request: Request) -> dict[str, str]:
    sid = request.headers.get("mcp-session-id") or uuid.uuid4().hex
    return {"Mcp-Session-Id": sid, "Cache-Control": "no-store"}


@router.post("", summary="MCP Streamable HTTP endpoint (JSON-RPC)", response_model=None)
async def mcp_post(request: Request, session: DbSession, principal: ApiClient) -> Response:
    headers = _session_headers(request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_err(None, -32700, "parse error"), status_code=400, headers=headers)
    messages = body if isinstance(body, list) else [body]
    if not messages or not all(isinstance(m, dict) for m in messages):
        return JSONResponse(_err(None, -32600, "invalid request"), status_code=400, headers=headers)
    responses: list[dict[str, Any]] = []
    for m in messages:
        out = await dispatch(session, principal, m)
        if out is not None:
            responses.append(out)
    if not responses:
        return Response(status_code=202, headers=headers)
    payload: Any = responses if isinstance(body, list) else responses[0]
    return JSONResponse(payload, headers=headers)


async def _heartbeat() -> AsyncIterator[bytes]:
    try:
        while True:
            yield b": keep-alive\n\n"
            await asyncio.sleep(15)
    except asyncio.CancelledError:  # client went away
        return


@router.get("", summary="MCP server-to-client stream (heartbeat only)", response_model=None)
async def mcp_get(request: Request, principal: ApiClient) -> Response:
    accept = request.headers.get("accept", "")
    if "text/event-stream" not in accept:
        return JSONResponse(
            {
                "error": {
                    "code": "not_acceptable",
                    "message": "Accept must include text/event-stream",
                }
            },
            status_code=406,
        )
    return StreamingResponse(
        _heartbeat(), media_type="text/event-stream", headers=_session_headers(request)
    )


@router.delete("", status_code=204, summary="End an MCP session", response_model=None)
async def mcp_delete(principal: ApiClient) -> Response:
    return Response(status_code=204)


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def mcp_resource_metadata() -> dict[str, Any]:
    return oauth_svc.protected_resource_metadata()
