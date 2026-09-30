"""One `connections` table for every way the workspace touches the outside.

Channels (email, whatsapp, widget, phone), model providers (BYOK), MCP servers,
integrations (modules) and workbenches (Codex, Cursor) share this row; the
`kind` and `provider` select the adapter, `credentials` is Fernet-encrypted.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ConnectionKind(enum.StrEnum):
    email = "email"
    whatsapp = "whatsapp"
    widget = "widget"
    phone = "phone"
    slack = "slack"
    mcp = "mcp"
    integration = "integration"
    workbench = "workbench"
    model_provider = "model_provider"


class ConnectionStatus(enum.StrEnum):
    pending = "pending"
    active = "active"
    error = "error"
    disabled = "disabled"


class Connection(TenantMixin, TimestampMixin, Base):
    __tablename__ = "connections"
    __table_args__ = (Index("ix_connections_tenant_kind", "tenant_id", "kind"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[ConnectionKind] = mapped_column(
        Enum(ConnectionKind, name="connection_kind", native_enum=True)
    )
    provider: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(160))
    status: Mapped[ConnectionStatus] = mapped_column(
        Enum(ConnectionStatus, name="connection_status", native_enum=True),
        default=ConnectionStatus.pending,
    )
    status_message: Mapped[str] = mapped_column(String(500), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    credentials: Mapped[str] = mapped_column(Text, default="")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    capabilities: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    disclosure_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    region: Mapped[str] = mapped_column(String(16), default="eu")
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    public_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
