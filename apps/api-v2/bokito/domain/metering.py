"""Feedback: usage (tokens and channel costs), outcomes, operator feedback."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, uuid_pk


class UsageKind(enum.StrEnum):
    llm = "llm"
    embedding = "embedding"
    channel_message = "channel_message"
    tool = "tool"


class UsageEvent(TenantMixin, Base):
    __tablename__ = "usage_events"
    __table_args__ = (
        Index("ix_usage_events_tenant_created", "tenant_id", "created_at"),
        Index("ix_usage_events_conversation", "conversation_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[UsageKind] = mapped_column(Enum(UsageKind, name="usage_kind", native_enum=True))
    provider: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    region: Mapped[str] = mapped_column(String(16), default="")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    units: Mapped[int] = mapped_column(Integer, default=1)
    cost_eur: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    billed_by_tenant: Mapped[bool] = mapped_column(Boolean, default=False)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Outcome(TenantMixin, Base):
    """One row per closed conversation: resolved by agents, handed off, time saved."""

    __tablename__ = "outcomes"
    __table_args__ = (Index("ix_outcomes_tenant_computed", "tenant_id", "computed_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), unique=True
    )
    resolved_by_agent: Mapped[bool] = mapped_column(Boolean, default=False)
    handoff: Mapped[bool] = mapped_column(Boolean, default=False)
    reopened: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_messages: Mapped[int] = mapped_column(Integer, default=0)
    human_messages: Mapped[int] = mapped_column(Integer, default=0)
    first_response_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolution_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_saved_seconds: Mapped[int] = mapped_column(Integer, default=0)
    cost_eur: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    signal_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FeedbackVerdict(enum.StrEnum):
    good = "good"
    bad = "bad"
    corrected = "corrected"


class Feedback(TenantMixin, Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    verdict: Mapped[FeedbackVerdict] = mapped_column(
        Enum(FeedbackVerdict, name="feedback_verdict", native_enum=True)
    )
    comment: Mapped[str] = mapped_column(Text, default="")
    correction: Mapped[str] = mapped_column(Text, default="")
    by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    learned_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("docs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
