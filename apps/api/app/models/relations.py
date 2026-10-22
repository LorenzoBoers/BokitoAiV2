"""Explicit setup links that used to live in JSON.

Access grants and the binds from a flow to a channel or a connection. Flow
stages and their owners live only in ``Workstream.stages_json``.
"""

from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

GRANT_RESOURCE_KINDS = ("channel", "calendar", "connection", "module")
GRANT_PRINCIPAL_KINDS = ("user", "agent", "department")


class ResourceGrant(SQLModel, table=True):
    """Who may use one channel, calendar, connection, or module."""

    __tablename__ = "resource_grants"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    resource_kind: str = Field(index=True, max_length=32)
    channel_account_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="channel_accounts.id", index=True
    )
    calendar_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="tenant_calendars.id", index=True
    )
    connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id", index=True
    )
    # Module resource identity after ModuleInstall drop (catalog slug).
    module_slug: Optional[str] = Field(default=None, max_length=64, index=True)
    principal_kind: str = Field(max_length=32)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    department_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    level: str = Field(max_length=16)
    created_at: datetime = Field(default_factory=utcnow)


class WorkstreamConnection(SQLModel, table=True):
    """A flow uses a connection."""

    __tablename__ = "workstream_connections"

    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", primary_key=True)
    connection_id: uuid.UUID = Field(
        foreign_key="integration_connections.id", primary_key=True, index=True
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    purpose: str = Field(default="read", max_length=16)
    created_at: datetime = Field(default_factory=utcnow)


class WorkstreamChannel(SQLModel, table=True):
    """A flow listens on a channel."""

    __tablename__ = "workstream_channels"

    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", primary_key=True)
    channel_account_id: uuid.UUID = Field(
        foreign_key="channel_accounts.id", primary_key=True, index=True
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
