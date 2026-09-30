"""Connections: channels, model providers (BYOK), MCP servers, integrations, workbenches."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from bokito.api.schemas import ConnectionOut
from bokito.deps import DbSession, Operator
from bokito.domain.connection import ConnectionKind, ConnectionStatus
from bokito.domain.identity import Role
from bokito.services import audit
from bokito.services import connections as conn_svc

router = APIRouter(prefix="/connections", tags=["connections"])


def _out(conn) -> ConnectionOut:
    data = ConnectionOut.model_validate(conn)
    data.credentials_masked = conn_svc.masked_credentials(conn)
    return data


class ConnectionCreate(BaseModel):
    kind: ConnectionKind
    provider: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    address: str = ""
    credentials: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    disclosure_enabled: bool = True
    region: str = "eu"
    agent_id: uuid.UUID | None = None


class ConnectionPatch(BaseModel):
    name: str | None = None
    address: str | None = None
    credentials: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None
    disclosure_enabled: bool | None = None
    region: str | None = None
    agent_id: uuid.UUID | None = None
    status: ConnectionStatus | None = None


@router.get("", response_model=list[ConnectionOut], summary="Connections")
async def list_connections(
    session: DbSession, principal: Operator, kind: ConnectionKind | None = None
) -> list[ConnectionOut]:
    return [
        _out(c) for c in await conn_svc.list_connections(session, principal.tenant_id, kind=kind)
    ]


@router.post("", response_model=ConnectionOut, status_code=201, summary="Add a connection")
async def create_connection(
    body: ConnectionCreate, session: DbSession, principal: Operator
) -> ConnectionOut:
    principal.require_role(Role.admin)
    conn = await conn_svc.create(
        session,
        principal.tenant_id,
        kind=body.kind,
        provider=body.provider,
        name=body.name,
        address=body.address,
        credentials=body.credentials,
        settings=body.settings,
        disclosure_enabled=body.disclosure_enabled,
        region=body.region,
        agent_id=body.agent_id,
        status=ConnectionStatus.active
        if body.kind in (ConnectionKind.widget, ConnectionKind.model_provider)
        else ConnectionStatus.pending,
    )
    from bokito.channels import setup

    await setup.on_created(session, conn)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="connection.create",
        target_kind="connection",
        target_id=conn.id,
        payload={"kind": conn.kind.value, "provider": conn.provider},
    )
    await session.commit()
    return _out(conn)


@router.get("/{connection_id}", response_model=ConnectionOut, summary="Connection detail")
async def get_connection(
    connection_id: uuid.UUID, session: DbSession, principal: Operator
) -> ConnectionOut:
    return _out(await conn_svc.get(session, principal.tenant_id, connection_id))


@router.patch("/{connection_id}", response_model=ConnectionOut, summary="Update a connection")
async def update_connection(
    connection_id: uuid.UUID, body: ConnectionPatch, session: DbSession, principal: Operator
) -> ConnectionOut:
    principal.require_role(Role.admin)
    conn = await conn_svc.get(session, principal.tenant_id, connection_id)
    for key in ("name", "address", "disclosure_enabled", "region", "agent_id", "status"):
        value = getattr(body, key)
        if value is not None:
            setattr(conn, key, value)
    if body.settings is not None:
        conn.settings = {**(conn.settings or {}), **body.settings}
    if body.credentials is not None:
        conn_svc.set_credentials(conn, body.credentials)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="connection.update",
        target_kind="connection",
        target_id=conn.id,
        payload={
            "fields": [
                k for k, v in body.model_dump().items() if v is not None and k != "credentials"
            ]
        },
    )
    await session.commit()
    return _out(conn)


@router.post(
    "/{connection_id}/verify",
    response_model=ConnectionOut,
    summary="Verify credentials and activate",
)
async def verify_connection(
    connection_id: uuid.UUID, session: DbSession, principal: Operator
) -> ConnectionOut:
    principal.require_role(Role.admin)
    conn = await conn_svc.get(session, principal.tenant_id, connection_id)
    from bokito.channels import setup

    ok, message = await setup.verify(session, conn)
    await conn_svc.set_status(
        session, conn, ConnectionStatus.active if ok else ConnectionStatus.error, message
    )
    await session.commit()
    return _out(conn)


@router.delete("/{connection_id}", status_code=204, summary="Remove a connection")
async def delete_connection(
    connection_id: uuid.UUID, session: DbSession, principal: Operator
) -> None:
    principal.require_role(Role.admin)
    conn = await conn_svc.get(session, principal.tenant_id, connection_id)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="connection.delete",
        target_kind="connection",
        target_id=conn.id,
        payload={"kind": conn.kind.value, "provider": conn.provider},
    )
    await session.delete(conn)
    await session.commit()


@router.get("/catalog/providers", summary="Providers per connection kind", response_model=dict)
async def providers() -> dict[str, Any]:
    from bokito.channels import setup

    return setup.catalog()
