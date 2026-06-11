import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class ApiToken(SQLModel, table=True):
    """Tenant-scoped API token for the MCP server endpoint and external clients.

    Tokens are stored as SHA-256 hashes; the plain value is shown once on
    creation. ``scopes_json`` holds the tool categories the token may use
    (empty list = all categories, still subject to tenant allowances).
    """

    __tablename__ = "api_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str = Field(default="")
    token_hash: str = Field(index=True, unique=True)
    token_prefix: str = Field(default="")
    scopes_json: str = Field(default="[]")
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    last_used_at: datetime | None = Field(default=None)
    revoked_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
