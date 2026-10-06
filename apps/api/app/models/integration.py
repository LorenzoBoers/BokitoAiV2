import uuid
from datetime import datetime

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

# Calendar is reserved as a first-class Connection kind. Existing Google and
# Outlook rows may still use ``integration`` until the sync migration lands.
CALENDAR_CONNECTION_KIND = "calendar"
CONNECTION_KINDS = ("integration", "workbench", CALENDAR_CONNECTION_KIND)


_ACTIVE_INSTANCE = text("instance_key <> '' AND status = 'active'")


class IntegrationConnection(SQLModel, table=True):
    __tablename__ = "integration_connections"
    __table_args__ = (
        Index(
            "uq_integration_connection_instance",
            "tenant_id",
            "provider",
            "instance_key",
            unique=True,
            sqlite_where=_ACTIVE_INSTANCE,
            postgresql_where=_ACTIVE_INSTANCE,
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    kind: str = Field(default="integration", index=True)
    provider: str = Field(index=True)
    display_name: str = ""
    # Vendor's own numeric id for the external account (Moneybird
    # administration id, KING omgevingscode), as digits. One active row per
    # (tenant, provider, instance_key); empty means not resolved yet.
    instance_key: str = Field(default="")
    status: str = Field(default="active")
    credentials_json: str = Field(default="{}")
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class IntegrationBinding(SQLModel, table=True):
    __tablename__ = "integration_bindings"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: uuid.UUID = Field(foreign_key="integration_connections.id", index=True)
    binding_type: str  # mcp_server | mailbox | repository
    config_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpServer(SQLModel, table=True):
    __tablename__ = "mcp_servers"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    server_url: str
    auth_json: str = Field(default="{}")
    is_active: bool = True
    # Cached tools/list discovery result: [{"name", "description"}, ...]
    tools_json: str = Field(default="[]")
    tools_synced_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
