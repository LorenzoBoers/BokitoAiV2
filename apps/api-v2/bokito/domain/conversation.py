"""Observe and Decide: conversations, messages, decisions, pins.

One thread model for every channel. Decisions live in the thread as messages
of kind `decision`; the `decisions` row carries the resolvable state.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, TimestampMixin, uuid_pk


class Channel(enum.StrEnum):
    email = "email"
    whatsapp = "whatsapp"
    widget = "widget"
    phone = "phone"
    slack = "slack"
    internal = "internal"
    api = "api"


class ConversationStatus(enum.StrEnum):
    open = "open"
    waiting = "waiting"
    snoozed = "snoozed"
    closed = "closed"


class MessageKind(enum.StrEnum):
    message = "message"
    note = "note"
    decision = "decision"
    action = "action"
    run = "run"
    system = "system"


class Direction(enum.StrEnum):
    inbound = "inbound"
    outbound = "outbound"
    internal = "internal"


class SendStatus(enum.StrEnum):
    none = "none"
    draft = "draft"
    queued = "queued"
    sent = "sent"
    delivered = "delivered"
    failed = "failed"


class DecisionStatus(enum.StrEnum):
    open = "open"
    approved = "approved"
    rejected = "rejected"
    expired = "expired"


class Conversation(TenantMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "channel", "external_id"),
        Index("ix_conversations_tenant_status_activity", "tenant_id", "status", "last_activity_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    channel: Mapped[Channel] = mapped_column(Enum(Channel, name="channel", native_enum=True))
    external_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[ConversationStatus] = mapped_column(
        Enum(ConversationStatus, name="conversation_status", native_enum=True),
        default=ConversationStatus.open,
    )
    subject: Mapped[str] = mapped_column(String(500), default="")
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL"), nullable=True
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    signal_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("signal_types.id", ondelete="SET NULL"), nullable=True
    )
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    participants: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    unread: Mapped[bool] = mapped_column(Boolean, default=False)
    handoff: Mapped[bool] = mapped_column(Boolean, default=False)
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_inbound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    compact_summary: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Message(TenantMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
        UniqueConstraint("tenant_id", "external_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    kind: Mapped[MessageKind] = mapped_column(
        Enum(MessageKind, name="message_kind", native_enum=True), default=MessageKind.message
    )
    direction: Mapped[Direction] = mapped_column(
        Enum(Direction, name="direction", native_enum=True), default=Direction.internal
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    author_contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True
    )
    author_label: Mapped[str] = mapped_column(String(200), default="")
    external_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    body: Mapped[str] = mapped_column(Text, default="")
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachments: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    send_status: Mapped[SendStatus] = mapped_column(
        Enum(SendStatus, name="send_status", native_enum=True), default=SendStatus.none
    )
    send_error: Mapped[str] = mapped_column(String(500), default="")
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Decision(TenantMixin, Base):
    """A pending choice for a human. One resolve path: `services.decision.resolve`."""

    __tablename__ = "decisions"
    __table_args__ = (Index("ix_decisions_tenant_status", "tenant_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[DecisionStatus] = mapped_column(
        Enum(DecisionStatus, name="decision_status", native_enum=True),
        default=DecisionStatus.open,
    )
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text, default="")
    options: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    tool_call: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(120), default="")
    chosen_option: Mapped[str | None] = mapped_column(String(120), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Pin(TenantMixin, Base):
    __tablename__ = "pins"
    __table_args__ = (UniqueConstraint("user_id", "conversation_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
