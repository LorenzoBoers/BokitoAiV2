"""OAuth authorization-server tables for the workspace MCP resource.

Bokito is the AS for remote MCP clients (Cursor, etc.). Opaque access/refresh
tokens and authorization codes are stored hashed; plaintext is never persisted.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class McpOAuthClient(SQLModel, table=True):
    """Dynamically registered or CIMD-resolved OAuth client."""

    __tablename__ = "mcp_oauth_clients"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    client_id: str = Field(index=True, unique=True)
    client_secret_hash: str | None = Field(default=None)
    client_name: str = Field(default="")
    redirect_uris_json: str = Field(default="[]")
    token_endpoint_auth_method: str = Field(default="none")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpOAuthAuthRequest(SQLModel, table=True):
    """Pending authorize request parked while the user logs in / consents."""

    __tablename__ = "mcp_oauth_auth_requests"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    client_id: str = Field(index=True)
    redirect_uri: str = Field(default="")
    state: str = Field(default="")
    scope: str = Field(default="")
    code_challenge: str = Field(default="")
    code_challenge_method: str = Field(default="S256")
    resource: str = Field(default="")
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpOAuthAuthorizationCode(SQLModel, table=True):
    __tablename__ = "mcp_oauth_authorization_codes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code_hash: str = Field(index=True, unique=True)
    client_id: str = Field(index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scopes_json: str = Field(default="[]")
    redirect_uri: str = Field(default="")
    code_challenge: str = Field(default="")
    code_challenge_method: str = Field(default="S256")
    resource: str = Field(default="")
    expires_at: datetime = Field(index=True)
    used_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpOAuthAccessToken(SQLModel, table=True):
    __tablename__ = "mcp_oauth_access_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    token_hash: str = Field(index=True, unique=True)
    token_prefix: str = Field(default="")
    client_id: str = Field(index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scopes_json: str = Field(default="[]")
    resource: str = Field(default="")
    expires_at: datetime = Field(index=True)
    revoked_at: datetime | None = Field(default=None)
    last_used_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class McpOAuthRefreshToken(SQLModel, table=True):
    __tablename__ = "mcp_oauth_refresh_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    token_hash: str = Field(index=True, unique=True)
    access_token_id: uuid.UUID | None = Field(
        default=None, foreign_key="mcp_oauth_access_tokens.id", index=True
    )
    # Rotation family: reuse of a revoked RT revokes every token in the family.
    family_id: uuid.UUID = Field(default_factory=uuid.uuid4, index=True)
    client_id: str = Field(index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scopes_json: str = Field(default="[]")
    resource: str = Field(default="")
    expires_at: datetime = Field(index=True)
    revoked_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
