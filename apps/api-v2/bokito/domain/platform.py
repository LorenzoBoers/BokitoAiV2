"""Platform tables: module installs, notifications, push subscriptions, OAuth AS."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ModuleInstall(TenantMixin, TimestampMixin, Base):
    __tablename__ = "module_installs"
    __table_args__ = (UniqueConstraint("tenant_id", "module"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    module: Mapped[str] = mapped_column(String(64))
    version: Mapped[str] = mapped_column(String(32), default="")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    installed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Notification(TenantMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    href: Mapped[str] = mapped_column(String(500), default="")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PushSubscription(TenantMixin, Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "endpoint"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    platform: Mapped[str] = mapped_column(String(16), default="web")
    endpoint: Mapped[str] = mapped_column(String(600))
    keys: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthClient(Base):
    """Dynamically registered MCP client (RFC 7591)."""

    __tablename__ = "oauth_clients"

    id: Mapped[uuid.UUID] = uuid_pk()
    client_id: Mapped[str] = mapped_column(String(64), unique=True)
    client_secret_digest: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(200), default="")
    redirect_uris: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    grant_types: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    scope: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OAuthCode(Base):
    __tablename__ = "oauth_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code_digest: Mapped[str] = mapped_column(String(64), unique=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE")
    )
    redirect_uri: Mapped[str] = mapped_column(String(600))
    scope: Mapped[str] = mapped_column(String(300), default="")
    code_challenge: Mapped[str] = mapped_column(String(128), default="")
    code_challenge_method: Mapped[str] = mapped_column(String(8), default="S256")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthToken(TenantMixin, Base):
    """Access or refresh token issued by the built-in authorization server."""

    __tablename__ = "oauth_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    token_digest: Mapped[str] = mapped_column(String(64), unique=True)
    token_type: Mapped[str] = mapped_column(String(8), default="access")
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    scope: Mapped[str] = mapped_column(String(300), default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
