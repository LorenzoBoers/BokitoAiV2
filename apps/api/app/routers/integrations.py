"""Integrations API group (marketplace, connections, MCP, email helpers).

Mounted under /api/integrations/* to match the dashboard INTEGRATIONS_API_BASE.
Platform marketplace paths use a double integrations segment
(/api/integrations/integrations/*) per integrationsRoutes.platform.*
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import user_numeric_id
from app.models.channel import ChannelAccount
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
)

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _account_numeric_id(account_id) -> int:
    return user_numeric_id(account_id)


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


@router.get("/integrations/providers")
async def get_providers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_providers(session, auth.tenant.id)


@router.get("/integrations/connections")
async def get_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str | None = Query(default=None),
):
    rows = await list_platform_connections(session, auth.tenant.id, provider)
    return {"connections": rows}


@router.post("/integrations/connections")
async def post_api_key_connection(
    body: ApiKeyConnectionCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await create_api_key_connection(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=body.api_key,
        display_name=body.display_name,
    )


@router.delete("/integrations/connections/{connection_id}")
async def delete_connection(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await revoke_connection(session, auth.tenant.id, connection_id)
    return {"ok": True}


@router.get("/integrations/connections/{connection_id}/resources")
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
    if conn.provider == "github":
        return {"items": MOCK_REPOS}
    return {"items": []}


@router.get("/integrations/oauth/start")
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

    if provider == "github":
        await ensure_github_connection(session, auth.tenant.id)
        authorize_url = mock_authorize_url(return_url, {"github": "connected"})
    elif provider == "outlook":
        email = auth.user.email or "outlook@bokito.local"
        await ensure_email_account(session, auth.tenant.id, "outlook", email)
        authorize_url = mock_authorize_url(
            return_url, {"oauth_provider": "outlook", "oauth_status": "connected"}
        )
    elif provider == "gmail":
        email = auth.user.email or "gmail@bokito.local"
        await ensure_email_account(session, auth.tenant.id, "gmail", email)
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


@router.get("/integrations/mcp/oauth/start")
async def mcp_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
):
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
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


@router.post("/integrations/mcp/install")
async def post_mcp_install(
    body: McpInstallBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    api_key = body.api_key or (body.auth.get("api_key") if body.auth else "") or "mock-key"
    display_name = body.display_name or body.name
    return await install_mcp(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=api_key,
        display_name=display_name,
        server_url=body.server_url,
        auth_type=body.auth_type,
        mcp_server_id=body.mcp_server_id,
    )


@router.get("/integrations/mcp/bindings")
async def get_mcp_bindings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_mcp_bindings(session, auth.tenant.id)


# --- Email OAuth (mock redirect back to dashboard) ---


async def _email_oauth_response(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    return_url: str,
    email: str,
) -> dict[str, str]:
    await ensure_email_account(session, tenant_id, provider, email)
    authorize_url = mock_authorize_url(
        return_url, {"oauth_provider": provider, "oauth_status": "connected"}
    )
    return {"authorize_url": authorize_url}


@router.get("/email/oauth/start")
async def email_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
):
    if provider not in ("outlook", "gmail"):
        raise HTTPException(status_code=400, detail="Unsupported email provider")
    email = auth.user.email or f"{provider}@bokito.local"
    return await _email_oauth_response(session, auth.tenant.id, provider, return_url, email)


@router.get("/email/outlook/oauth/start")
async def outlook_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str = Query(...),
):
    email = auth.user.email or "outlook@bokito.local"
    return await _email_oauth_response(session, auth.tenant.id, "outlook", return_url, email)


@router.get("/email/google/oauth/start")
async def google_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str = Query(...),
):
    email = auth.user.email or "gmail@bokito.local"
    return await _email_oauth_response(session, auth.tenant.id, "gmail", return_url, email)


# --- Email connections (dashboard contract) ---


@router.get("/email/connections")
async def list_email_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == auth.tenant.id, ChannelAccount.channel == "email"
        )
    )
    connections = []
    for index, account in enumerate(result.scalars().all()):
        provider = account.provider if account.provider in ("gmail", "outlook") else "gmail"
        connections.append(
            {
                "id": _account_numeric_id(account.id),
                "provider": provider,
                "mailbox_email": account.address,
                "display_name": account.display_name or account.address,
                "status": "active",
                "last_sync_at": None,
                "last_error": None,
                "signature_html": None,
                "is_enabled": account.is_enabled,
                "is_primary": index == 0,
            }
        )
    return connections


@router.put("/email/connections/{connection_id}/mailbox-settings")
async def update_mailbox_settings(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    del connection_id, body, auth
    return {"ok": True}


@router.put("/email/connections/{connection_id}/signature")
async def save_signature(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    del connection_id, auth
    return {"ok": True, "signature_html": body.get("signature_html", "")}


@router.get("/email/connections/{connection_id}/signature")
async def get_signature(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    del connection_id, auth
    return {"signature_html": ""}


@router.delete("/email/connections/{connection_id}")
async def disconnect_email_connection(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    del connection_id, auth
    return {"ok": True}


# --- MCP servers (legacy listing) ---


@router.get("/mcp/servers")
async def list_mcp_servers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(McpServer).where(McpServer.tenant_id == auth.tenant.id))
    return [
        {"id": str(s.id), "name": s.name, "server_url": s.server_url, "is_active": s.is_active}
        for s in result.scalars().all()
    ]
