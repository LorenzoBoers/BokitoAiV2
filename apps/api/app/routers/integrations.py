import json
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.email import EmailAccount
from app.models.inbox_threads import user_numeric_id
from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _account_numeric_id(account_id) -> int:
    return user_numeric_id(account_id)


class ConnectionCreate(BaseModel):
    provider: str
    display_name: str = ""
    credentials: dict = {}
    metadata: dict = {}


class McpInstall(BaseModel):
    name: str
    server_url: str
    auth: dict = {}


@router.get("/connections")
async def list_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(IntegrationConnection).where(IntegrationConnection.tenant_id == auth.tenant.id)
    )
    return [
        {
            "id": str(c.id),
            "provider": c.provider,
            "display_name": c.display_name,
            "status": c.status,
            "metadata": json.loads(c.metadata_json or "{}"),
        }
        for c in result.scalars().all()
    ]


@router.post("/connections")
async def create_connection(
    body: ConnectionCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conn = IntegrationConnection(
        tenant_id=auth.tenant.id,
        provider=body.provider,
        display_name=body.display_name or body.provider,
        credentials_json=json.dumps(body.credentials),
        metadata_json=json.dumps(body.metadata),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return {"id": str(conn.id), "provider": conn.provider}


@router.get("/email/connections")
async def list_email_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Email/mailbox connections in the dashboard contract.

    Maps FastAPI EmailAccount rows to the connection shape the dashboard
    expects. Provider is normalized to gmail/outlook so the dashboard's
    normalizer accepts it (mock accounts are surfaced as gmail in V1).
    """
    result = await session.execute(select(EmailAccount).where(EmailAccount.tenant_id == auth.tenant.id))
    connections = []
    for index, account in enumerate(result.scalars().all()):
        provider = account.provider if account.provider in ("gmail", "outlook") else "gmail"
        connections.append(
            {
                "id": _account_numeric_id(account.id),
                "provider": provider,
                "mailbox_email": account.email_address,
                "display_name": account.email_address,
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
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {"ok": True}


@router.put("/email/connections/{connection_id}/signature")
async def save_signature(
    connection_id: int,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {"ok": True, "signature_html": body.get("signature_html", "")}


@router.get("/email/connections/{connection_id}/signature")
async def get_signature(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    return {"signature_html": ""}


@router.delete("/email/connections/{connection_id}")
async def disconnect_email_connection(
    connection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    return {"ok": True}


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


@router.post("/mcp/install")
async def install_mcp(
    body: McpInstall,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    server = McpServer(
        tenant_id=auth.tenant.id,
        name=body.name,
        server_url=body.server_url,
        auth_json=json.dumps(body.auth),
    )
    session.add(server)
    await session.flush()
    conn = IntegrationConnection(
        tenant_id=auth.tenant.id,
        provider="custom_mcp",
        display_name=body.name,
        metadata_json=json.dumps({"mcp_server_id": str(server.id)}),
    )
    session.add(conn)
    await session.flush()
    binding = IntegrationBinding(
        tenant_id=auth.tenant.id,
        connection_id=conn.id,
        binding_type="mcp_server",
        config_json=json.dumps({"mcp_server_id": str(server.id)}),
    )
    session.add(binding)
    await session.commit()
    return {"server_id": str(server.id), "connection_id": str(conn.id)}


@router.get("/mcp/bindings")
async def mcp_bindings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(McpServer).where(McpServer.tenant_id == auth.tenant.id, McpServer.is_active))
    servers = result.scalars().all()
    return {"mcp_server_ids": [str(s.id) for s in servers], "bindings": [{"name": s.name, "id": str(s.id)} for s in servers]}
