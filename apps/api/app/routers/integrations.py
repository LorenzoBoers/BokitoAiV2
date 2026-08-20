"""Integrations API group (marketplace, connections, MCP, email helpers).

Mounted under /api/integrations/* to match the dashboard INTEGRATIONS_API_BASE.
Marketplace paths are served at /api/integrations/* (router prefix only).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.middleware.rate_limit import rate_limit
from app.models.integration import IntegrationConnection, McpServer
from app.services.integrations_catalog import PROVIDER_BY_SLUG
from app.services.integrations_platform import (
    MOCK_REPOS,
    create_api_key_connection,
    ensure_email_account,
    ensure_github_connection,
    ensure_oauth_connection,
    install_mcp,
    list_connections as list_platform_connections,
    list_mcp_bindings,
    list_providers,
    mock_authorize_url,
    revoke_connection,
    test_mcp_server,
)
from app.services.oauth_flow import complete_oauth, start_real_oauth

router = APIRouter(prefix="/integrations", tags=["integrations"])
settings = get_settings()


class ApiKeyConnectionCreate(BaseModel):
    provider: str
    api_key: str
    display_name: str | None = None


class McpInstallBody(BaseModel):
    provider: str = "custom_mcp"
    api_key: str = ""
    display_name: str | None = None
    mcp_server_id: int | None = None
    server_url: str | None = None
    auth_type: str = "api_key"
    name: str | None = None
    auth: dict = Field(default_factory=dict)


# --- Platform marketplace ---


@router.get("/providers")
async def get_providers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_providers(session, auth.tenant.id)


@router.get("/connections")
async def get_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str | None = Query(default=None),
):
    rows = await list_platform_connections(session, auth.tenant.id, provider)
    return {"connections": rows}


@router.post("/connections")
async def post_api_key_connection(
    body: ApiKeyConnectionCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await create_api_key_connection(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=body.api_key,
        display_name=body.display_name,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:connected",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="connection",
        resource_id=(result or {}).get("id", "") if isinstance(result, dict) else "",
        summary=body.provider,
    )
    return result


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await revoke_connection(session, auth.tenant.id, connection_id)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:revoked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="connection",
        resource_id=connection_id,
    )
    return {"ok": True}


@router.get("/connections/{connection_id}/resources")
async def connection_resources(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == auth.tenant.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.provider == "github" and not settings.is_production:
        return {"items": MOCK_REPOS}
    return {"items": []}


@router.get("/oauth/start")
async def platform_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
    project_id: str | None = Query(default=None),
):
    del project_id
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")

    # Email providers connect a mailbox (flow="email"); github connects an
    # integration. Try a real provider redirect first; fall back to the mock
    # flow when the provider has no client credentials configured.
    if provider in ("outlook", "gmail"):
        flow = "email"
    elif provider == "github":
        flow = "github"
    else:
        flow = "integration"

    real_url = await start_real_oauth(
        session,
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
        provider=provider,
        flow=flow,
        return_url=return_url,
    )
    if real_url:
        return {"authorize_url": real_url, "provider": provider}

    if settings.is_production:
        raise HTTPException(
            status_code=503,
            detail=(
                f"OAuth for {provider} is not configured on this server. "
                "Set the provider client credentials to enable it."
            ),
        )

    if provider == "github":
        await ensure_github_connection(session, auth.tenant.id)
        authorize_url = mock_authorize_url(return_url, {"github": "connected"})
    elif provider == "outlook":
        email = auth.user.email or "outlook@bokito.local"
        await ensure_email_account(
            session, auth.tenant.id, "outlook", email, seed_mock_credentials=True
        )
        authorize_url = mock_authorize_url(
            return_url, {"oauth_provider": "outlook", "oauth_status": "connected"}
        )
    elif provider == "gmail":
        email = auth.user.email or "gmail@bokito.local"
        await ensure_email_account(
            session, auth.tenant.id, "gmail", email, seed_mock_credentials=True
        )
        authorize_url = mock_authorize_url(
            return_url, {"oauth_provider": "gmail", "oauth_status": "connected"}
        )
    else:
        await ensure_oauth_connection(
            session,
            auth.tenant.id,
            provider,
            display_name=PROVIDER_BY_SLUG[provider]["name"],
        )
        authorize_url = mock_authorize_url(
            return_url, {"integration": "connected", "provider": provider}
        )

    return {"authorize_url": authorize_url, "provider": provider}


@router.get("/oauth/callback")
async def platform_oauth_callback(
    session: Annotated[AsyncSession, Depends(get_session)],
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    """Single OAuth redirect URI for all providers.

    Exchanges the authorization code for tokens, stores them on the mailbox or
    integration connection, then 302-redirects the browser back to the dashboard
    return URL with success/error params the frontend already understands.
    SSO login flows additionally set the refresh cookie so the app session
    starts on the next AuthContext boot.
    """
    target, refresh_token = await complete_oauth(
        session, state=state, code=code, error=error or error_description
    )
    response = RedirectResponse(url=target, status_code=302)
    if refresh_token:
        from app.config import get_settings as _get_settings

        _settings = _get_settings()
        response.set_cookie(
            key=_settings.refresh_cookie_name,
            value=refresh_token,
            httponly=True,
            samesite="lax",
            secure=_settings.is_production,
            max_age=_settings.refresh_token_expire_days * 86400,
        )
    return response


@router.get("/mcp/oauth/start")
async def mcp_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
):
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    if settings.is_production:
        raise HTTPException(
            status_code=503,
            detail=(
                "MCP OAuth is not available in production yet. "
                "Install the MCP server with its URL and API key instead."
            ),
        )
    await install_mcp(
        session,
        auth.tenant.id,
        provider=provider,
        api_key="mock-mcp-oauth",
        display_name=PROVIDER_BY_SLUG[provider]["name"],
        auth_type="oauth2",
    )
    authorize_url = mock_authorize_url(
        return_url, {"integration": "connected", "provider": provider}
    )
    return {"authorize_url": authorize_url, "provider": provider, "state": "mock"}


@router.post("/mcp/install", dependencies=[Depends(rate_limit("mcp-install", limit=10))])
async def post_mcp_install(
    body: McpInstallBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    api_key = body.api_key or (body.auth.get("api_key") if body.auth else "") or "mock-key"
    display_name = body.display_name or body.name
    installed = await install_mcp(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=api_key,
        display_name=display_name,
        server_url=body.server_url,
        auth_type=body.auth_type,
        mcp_server_id=body.mcp_server_id,
        auth=body.auth or None,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:mcp_installed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="mcp_server",
        resource_id=(installed.get("binding") or {}).get("id", ""),
        payload={
            "provider": body.provider,
            "server_url": body.server_url or "",
            "display_name": display_name or "",
        },
    )
    return installed


@router.get("/mcp/bindings")
async def get_mcp_bindings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_mcp_bindings(session, auth.tenant.id)


@router.post("/mcp/{server_id}/test")
async def post_mcp_test(
    server_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await test_mcp_server(session, auth.tenant.id, server_id)


# --- MCP servers (legacy listing) ---


@router.get("/mcp/servers")
async def list_mcp_servers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    import json as _json

    result = await session.execute(select(McpServer).where(McpServer.tenant_id == auth.tenant.id))
    rows = []
    for s in result.scalars().all():
        try:
            tools = _json.loads(s.tools_json or "[]")
        except (_json.JSONDecodeError, TypeError):
            tools = []
        rows.append(
            {
                "id": str(s.id),
                "name": s.name,
                "server_url": s.server_url,
                "is_active": s.is_active,
                "tools": tools if isinstance(tools, list) else [],
                "tools_synced_at": s.tools_synced_at.isoformat() if s.tools_synced_at else None,
            }
        )
    return rows
