"""Platform-global remote MCP marketplace catalog (staff-managed).

Hosts and providers mirror ``mcp_remote_catalog.json``. Native core adapters
(Alpaca, Bjorn, KING, …) stay in code and are never stored here.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class IntegrationCatalogHost(SQLModel, table=True):
    __tablename__ = "integration_catalog_hosts"

    slug: str = Field(primary_key=True, max_length=64)
    name: str = Field(default="")
    brand_color: str = Field(default="#475569", max_length=32)
    initials: str = Field(default="", max_length=8)
    logo_domain: str = Field(default="", max_length=255)
    simpleicons: str = Field(default="", max_length=64)
    description: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class IntegrationCatalogProvider(SQLModel, table=True):
    __tablename__ = "integration_catalog_providers"

    slug: str = Field(primary_key=True, max_length=64)
    static_id: str = Field(default="", max_length=64, index=True)
    host_slug: str = Field(default="custom", max_length=64, index=True, foreign_key="integration_catalog_hosts.slug")
    name: str = Field(default="")
    description: str = Field(default="")
    category: str = Field(default="Productivity", max_length=64)
    category_nl: str = Field(default="Productiviteit", max_length=64)
    auth_type: str = Field(default="mcp_remote_oauth", max_length=64)
    mcp_remote_url: str = Field(default="")
    mcp_transport: str = Field(default="streamable_http", max_length=64)
    status: str = Field(default="coming_soon", max_length=32, index=True)
    module: str | None = Field(default=None, max_length=64)
    sort_order: int = Field(default=100)
    enabled: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
