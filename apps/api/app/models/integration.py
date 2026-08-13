import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class IntegrationConnection(SQLModel, table=True):
    __tablename__ = "integration_connections"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    provider: str = Field(index=True)
    display_name: str = ""
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
