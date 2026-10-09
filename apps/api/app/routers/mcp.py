"""Tenant-scoped MCP server: exposes the unified tool registry over HTTP.

Implements the MCP Streamable HTTP transport (JSON-RPC 2.0 over POST + GET
SSE probe). External clients (Cursor, IDEs, other agents) authenticate with
either an OAuth access token (URL-only connect) or a scoped ``bok_`` API
token, and call exactly the same governed tools internal agents use — one
implementation, two consumers. Every call flows through the allowance policy
engine with ``trust="api"``.

Also advertises ``resources/*`` (product-help markdown) and ``prompts/*`` so
clients that probe those surfaces get useful shortcuts.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.api_token import ApiToken
from app.models.auth import Membership, User
from app.services import mcp_oauth_as as asvc
from app.services import product_help as help_svc
from app.tools import execute_tool
from app.tools.registry import ToolSpec, iter_tool_specs

router = APIRouter(prefix="/mcp", tags=["mcp"])

# Agent-only tools an MCP client cannot use; set_ai_handling covers handing a
# conversation back to the AI from outside.
_MCP_HIDDEN_TOOLS = frozenset({"take_over_conversation"})

PROTOCOL_VERSION = "2025-03-26"
SERVER_VERSION = "1.4.0"


def _server_info() -> dict[str, Any]:
    app = asvc.app_origin()
    return {
        "name": "bokito-workspace",
        "version": SERVER_VERSION,
        "title": "Bokito",
        "websiteUrl": f"{app}/docs/developers/mcp-endpoint",
        "icons": [
            {
                "src": f"{app}/bokito-logo.png",
                "mimeType": "image/svg+xml",
                "sizes": ["any"],
            }
        ],
    }


def _instructions() -> str:
    return (
        "Bokito workspace MCP. Paste only this URL in Cursor — authorize in the "
        "browser and pick a workspace. Tools share Govern allowances with in-app "
        "agents (trust=api). Prefer get_tenant_overview, list_threads, and "
        "search_index before inventing state. Consequential tools raise a "
        "Decision instead of executing — resolve in Communication or via "
        "resolve_decision. Docs: /docs/developers/mcp-endpoint. Revoke clients "
        "under Settings → Developers → Connected MCP clients."
    )


# Product-help backed resources (slug → article under docs/product-help).
_RESOURCES = [
    {
        "uri": "bokito://docs/mcp-endpoint",
        "name": "MCP endpoint guide",
        "description": "How to connect Cursor or Claude to this workspace",
        "mimeType": "text/markdown",
        "slug": "mcp-endpoint",
    },
    {
        "uri": "bokito://docs/api-overview",
        "name": "API overview",
        "description": "REST, webhooks and MCP surfaces",
        "mimeType": "text/markdown",
        "slug": "api-overview",
    },
    {
        "uri": "bokito://docs/authentication",
        "name": "Authentication",
        "description": "API tokens, OAuth, and workspace auth",
        "mimeType": "text/markdown",
        "slug": "authentication",
    },
    {
        "uri": "bokito://docs/govern-autonomy",
        "name": "Govern & autonomy",
        "description": "How tool allowances and decisions gate MCP calls",
        "mimeType": "text/markdown",
        "slug": "autonomy",
    },
]

_PROMPTS = [
    {
        "name": "tenant_overview",
        "description": "Summarize this workspace: posture, open work, and recent activity",
        "arguments": [],
        "text": (
            "Give me a concise operator brief for this Bokito workspace.\n"
            "1. Call get_tenant_overview.\n"
            "2. Call list_recent_activity (limit 10) if available.\n"
            "3. Summarize: autonomy posture, open threads needing humans, "
            "pending decisions, and anything unusual. Do not invent IDs."
        ),
    },
    {
        "name": "open_threads",
        "description": "List open conversations that need a human",
        "arguments": [],
        "text": (
            "List open conversations that need a human.\n"
            "1. Call list_threads with status/open filters the tool accepts.\n"
            "2. For the top 5, note contact, channel, last message summary, "
            "and whether AI is paused or a decision is waiting.\n"
            "3. Suggest the next human action per thread."
        ),
    },
    {
        "name": "pending_decisions",
        "description": "Find open decisions and prepare resolve_decision calls",
        "arguments": [],
        "text": (
            "Find pending Decision cards that block work.\n"
            "1. Use list_threads / get_tenant_overview to locate awaiting_decision items.\n"
            "2. For each, state what approve vs reject would do.\n"
            "3. Do not call resolve_decision until I confirm — it is consequential."
        ),
    },
    {
        "name": "search_knowledge",
        "description": "Search workspace knowledge for an operator question",
        "arguments": [
            {
                "name": "query",
                "description": "What to look up in workspace knowledge",
                "required": True,
            }
        ],
        "text": (
            "Search Bokito knowledge for: {query}\n"
            "1. Call search_index with that query.\n"
            "2. If needed, read_doc on the best hits.\n"
            "3. Answer with citations (doc titles/ids). Say when nothing matches."
        ),
    },
]


def _tool_annotations(spec: ToolSpec) -> dict[str, Any]:
    """MCP tool annotations so hosts can hint risk to operators."""
    read_only = not spec.mutating and not spec.consequential
    return {
        "title": f"{spec.category}: {spec.name}",
        "readOnlyHint": read_only,
        "destructiveHint": bool(spec.consequential or (spec.mutating and spec.gated)),
        "idempotentHint": read_only,
        "openWorldHint": spec.category in {"integrations", "channels", "messaging"},
    }


def _public_resources() -> list[dict[str, Any]]:
    return [
        {
            "uri": r["uri"],
            "name": r["name"],
            "description": r["description"],
            "mimeType": r["mimeType"],
        }
        for r in _RESOURCES
    ]


def _read_resource_text(uri: str) -> tuple[dict[str, Any], str] | None:
    match = next((r for r in _RESOURCES if r["uri"] == uri), None)
    if match is None:
        return None
    article = help_svc.get_article(str(match["slug"]), lang="en")
    if article is not None:
        text = help_svc.raw_markdown(article)
    else:
        text = (
            f"# {match['name']}\n\n"
            f"{match['description']}.\n\n"
            f"Open `{match['uri'].replace('bokito://docs/', '/docs/')}` in the "
            "Bokito app. Paste only the MCP URL in Cursor; authorize in the "
            "browser and pick a workspace.\n"
        )
    return match, text


def _prompt_messages(prompt: dict[str, Any], arguments: dict[str, Any]) -> list[dict[str, Any]]:
    template = str(prompt.get("text") or prompt["description"])
    try:
        text = template.format(**{k: str(v) for k, v in arguments.items()})
    except KeyError:
        text = template
    return [
        {
            "role": "user",
            "content": {"type": "text", "text": text},
        }
    ]


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


@dataclass
class McpPrincipal:
    tenant_id: uuid.UUID
    user_id: uuid.UUID | None
    scopes: set[str]
    source: str  # "oauth" | "api_token" | "job_token"
    tool_allowlist: set[str] | None = None
    job_id: uuid.UUID | None = None


def _unauthorized(detail: str = "Missing or invalid bearer token") -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": asvc.www_authenticate_challenge()},
    )


async def get_mcp_auth(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> McpPrincipal:
    del request
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Missing bearer token")
    plain = authorization.split(" ", 1)[1].strip()
    if not plain:
        raise _unauthorized("Missing bearer token")

    if plain.startswith(asvc.ACCESS_TOKEN_PREFIX) or not plain.startswith("bok_"):
        oauth = await asvc.lookup_access_token(session, plain)
        if oauth is not None:
            oauth.last_used_at = datetime.utcnow()
            session.add(oauth)
            await session.flush()
            return McpPrincipal(
                tenant_id=oauth.tenant_id,
                user_id=oauth.user_id,
                scopes=asvc.scopes_from_json(oauth.scopes_json),
                source="oauth",
            )
        if plain.startswith(asvc.ACCESS_TOKEN_PREFIX):
            raise _unauthorized("Invalid or expired OAuth token")

    from app.routers.govern import hash_token

    result = await session.execute(
        select(ApiToken).where(ApiToken.token_hash == hash_token(plain))
    )
    token = result.scalar_one_or_none()
    if not token or token.revoked_at is not None:
        raise _unauthorized("Invalid or revoked token")
    if getattr(token, "expires_at", None) and token.expires_at < datetime.utcnow():
        raise _unauthorized("Token expired")
    token.last_used_at = datetime.utcnow()
    session.add(token)
    await session.flush()
    allowlist = _api_token_allowlist(token)
    is_job = bool(getattr(token, "job_id", None) and allowlist is not None)
    return McpPrincipal(
        tenant_id=token.tenant_id,
        user_id=token.created_by_user_id,
        scopes=set() if is_job else _api_token_scopes(token),
        source="job_token" if is_job else "api_token",
        tool_allowlist=allowlist if is_job else None,
        job_id=token.job_id if is_job else None,
    )


async def get_api_token(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> ApiToken:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Missing bearer token")
    plain = authorization.split(" ", 1)[1].strip()
    from app.routers.govern import hash_token

    result = await session.execute(
        select(ApiToken).where(ApiToken.token_hash == hash_token(plain))
    )
    token = result.scalar_one_or_none()
    if not token or token.revoked_at is not None:
        raise _unauthorized("Invalid or revoked token")
    token.last_used_at = datetime.utcnow()
    session.add(token)
    await session.flush()
    return token


def _api_token_scopes(token: ApiToken) -> set[str]:
    try:
        scopes = json.loads(token.scopes_json or "[]")
        return {str(s) for s in scopes} if isinstance(scopes, list) else set()
    except (json.JSONDecodeError, TypeError):
        return set()


def _api_token_allowlist(token: ApiToken) -> set[str] | None:
    """Return a tool-name allowlist for job tokens; None means category scopes apply."""
    if not getattr(token, "job_id", None):
        return None
    try:
        tools = json.loads(getattr(token, "tool_allowlist_json", None) or "[]")
        if isinstance(tools, list) and tools:
            return {str(t) for t in tools}
    except (json.JSONDecodeError, TypeError):
        pass
    return set()


async def _principal_role(session: AsyncSession, principal: McpPrincipal) -> str | None:
    if not principal.user_id:
        return None
    user = (
        await session.execute(select(User).where(User.id == principal.user_id))
    ).scalar_one_or_none()
    if user and user.is_staff:
        return "admin"
    result = await session.execute(
        select(Membership).where(
            Membership.tenant_id == principal.tenant_id,
            Membership.user_id == principal.user_id,
        )
    )
    membership = result.scalar_one_or_none()
    return membership.role if membership else None


def _rpc_result(req_id: int | str | None, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_error(req_id: int | str | None, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


@router.get("")
async def mcp_get(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    """Streamable HTTP GET probe / idle SSE stream.

    Auth is optional for Accept negotiation; authenticated clients get a short
    keep-alive stream. Unauthenticated probes still learn the resource is here.
    """
    accept = (request.headers.get("accept") or "").lower()
    if "text/event-stream" not in accept and "*/*" not in accept:
        return JSONResponse(
            status_code=406,
            content={"error": {"code": "not_acceptable", "message": "Accept text/event-stream"}},
            headers={"WWW-Authenticate": asvc.www_authenticate_challenge()},
        )

    async def _events():
        # Minimal idle stream; JSON-RPC traffic is POST.
        yield "event: endpoint\ndata: /api/mcp\n\n"
        yield ": keepalive\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    }
    if not authorization:
        headers["WWW-Authenticate"] = asvc.www_authenticate_challenge()
    return StreamingResponse(_events(), media_type="text/event-stream", headers=headers)


@router.delete("")
async def mcp_delete_session(
    mcp_session_id: Annotated[str | None, Header(alias="Mcp-Session-Id")] = None,
):
    """Streamable HTTP session teardown (stateless — always succeeds)."""
    del mcp_session_id
    return Response(status_code=204)


@router.post("")
async def mcp_endpoint(
    body: JsonRpcRequest,
    principal: Annotated[McpPrincipal, Depends(get_mcp_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    mcp_session_id: Annotated[str | None, Header(alias="Mcp-Session-Id")] = None,
):
    scopes = principal.scopes
    session_id = (mcp_session_id or "").strip() or str(uuid.uuid4())

    # Notifications have no id — return 202 empty body (streamable HTTP).
    if body.method in ("notifications/initialized", "initialized") and body.id is None:
        return Response(status_code=202, headers={"Mcp-Session-Id": session_id})

    if body.method == "initialize":
        payload = _rpc_result(
            body.id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {"listChanged": False},
                    "resources": {"subscribe": False, "listChanged": False},
                    "prompts": {"listChanged": False},
                },
                "serverInfo": _server_info(),
                "instructions": _instructions(),
            },
        )
        return JSONResponse(content=payload, headers={"Mcp-Session-Id": session_id})

    if body.method in ("notifications/initialized", "initialized"):
        return JSONResponse(
            content=_rpc_result(body.id, {}),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "ping":
        return JSONResponse(
            content=_rpc_result(body.id, {}),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "resources/list":
        return JSONResponse(
            content=_rpc_result(body.id, {"resources": _public_resources()}),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "resources/read":
        params = body.params or {}
        uri = str(params.get("uri") or "")
        loaded = _read_resource_text(uri)
        if loaded is None:
            return JSONResponse(
                content=_rpc_error(body.id, -32602, f"Unknown resource: {uri}"),
                headers={"Mcp-Session-Id": session_id},
            )
        match, text = loaded
        return JSONResponse(
            content=_rpc_result(
                body.id,
                {
                    "contents": [
                        {
                            "uri": uri,
                            "mimeType": match["mimeType"],
                            "text": text,
                        }
                    ]
                },
            ),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "prompts/list":
        prompts = [
            {
                "name": p["name"],
                "description": p["description"],
                "arguments": p.get("arguments") or [],
            }
            for p in _PROMPTS
        ]
        return JSONResponse(
            content=_rpc_result(body.id, {"prompts": prompts}),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "prompts/get":
        params = body.params or {}
        name = str(params.get("name") or "")
        match = next((p for p in _PROMPTS if p["name"] == name), None)
        if match is None:
            return JSONResponse(
                content=_rpc_error(body.id, -32602, f"Unknown prompt: {name}"),
                headers={"Mcp-Session-Id": session_id},
            )
        args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        return JSONResponse(
            content=_rpc_result(
                body.id,
                {
                    "description": match["description"],
                    "messages": _prompt_messages(match, args),
                },
            ),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "tools/list":
        allowlist = principal.tool_allowlist
        tools = [
            {
                "name": spec.name,
                "description": f"[{spec.category}] {spec.description}",
                "inputSchema": spec.input_schema,
                "annotations": _tool_annotations(spec),
            }
            for spec in iter_tool_specs()
            if spec.name not in _MCP_HIDDEN_TOOLS
            and (
                (allowlist is not None and spec.name in allowlist)
                or (allowlist is None and (not scopes or spec.category in scopes))
            )
        ]
        return JSONResponse(
            content=_rpc_result(body.id, {"tools": tools}),
            headers={"Mcp-Session-Id": session_id},
        )

    if body.method == "tools/call":
        params = body.params or {}
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}
        spec = next((s for s in iter_tool_specs() if s.name == tool_name), None)
        if spec is None:
            return JSONResponse(
                content=_rpc_error(body.id, -32602, f"Unknown tool: {tool_name}"),
                headers={"Mcp-Session-Id": session_id},
            )
        if principal.tool_allowlist is not None:
            if tool_name not in principal.tool_allowlist:
                return JSONResponse(
                    content=_rpc_error(body.id, -32602, f"Token not allowed to call {tool_name}"),
                    headers={"Mcp-Session-Id": session_id},
                )
        elif scopes and spec.category not in scopes:
            return JSONResponse(
                content=_rpc_error(
                    body.id, -32602, f"Token not scoped for category: {spec.category}"
                ),
                headers={"Mcp-Session-Id": session_id},
            )

        user_role = await _principal_role(session, principal)
        tool_args = arguments if isinstance(arguments, dict) else {}
        # Job tokens may only write to their own job; inject the bound id.
        if principal.job_id is not None and tool_name in {
            "report_progress",
            "ask_question",
            "attach_artifact",
        }:
            tool_args = {**tool_args, "job_id": str(principal.job_id)}
        result = await execute_tool(
            session,
            principal.tenant_id,
            principal.user_id,
            tool_name,
            tool_args,
            trust="api",
            user_role=user_role,
        )
        if isinstance(result, dict) and result.get("decision_id"):
            result = {
                **result,
                "hint": (
                    "A Decision was raised — resolve it in Communication or call "
                    "resolve_decision after approval."
                ),
            }
        is_error = bool(isinstance(result, dict) and result.get("error"))
        return JSONResponse(
            content=_rpc_result(
                body.id,
                {
                    "content": [{"type": "text", "text": json.dumps(result, default=str)}],
                    "isError": is_error,
                },
            ),
            headers={"Mcp-Session-Id": session_id},
        )

    return JSONResponse(
        content=_rpc_error(body.id, -32601, f"Method not found: {body.method}"),
        headers={"Mcp-Session-Id": session_id},
    )
