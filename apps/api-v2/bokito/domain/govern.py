"""Govern: policies, changes (with rollback) and the append-only audit log."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, TimestampMixin, uuid_pk
from bokito.domain.identity import Posture


class Policy(TenantMixin, TimestampMixin, Base):
    """The one autonomy dial plus category allowances and tool overrides.

    allowances: {category: "allow" | "ask" | "deny"} for read, write,
    communicate, external, destructive. tool_overrides: {tool_name: same}.
    consequential: tool names that always ask regardless of posture.
    """

    __tablename__ = "policies"
    __table_args__ = (UniqueConstraint("tenant_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    posture: Mapped[Posture] = mapped_column(
        Enum(Posture, name="posture", native_enum=True, create_type=False),
        default=Posture.assisted,
    )
    allowances: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    tool_overrides: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    consequential: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    budgets: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    disclosure_text: Mapped[str] = mapped_column(Text, default="")


class ChangeStatus(enum.StrEnum):
    draft = "draft"
    applied = "applied"
    rejected = "rejected"
    rolled_back = "rolled_back"


class Change(TenantMixin, Base):
    """A proposed or applied change to the platform itself (agent, playbook, policy...)."""

    __tablename__ = "changes"
    __table_args__ = (Index("ix_changes_tenant_status", "tenant_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    status: Mapped[ChangeStatus] = mapped_column(
        Enum(ChangeStatus, name="change_status", native_enum=True), default=ChangeStatus.draft
    )
    target_kind: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    proposed_by: Mapped[str] = mapped_column(String(120), default="")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    decision_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decisions.id", ondelete="SET NULL"), nullable=True
    )
    applied_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(TenantMixin, Base):
    """Append-only. Never updated, never deleted by application code."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_tenant_created", "tenant_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    actor: Mapped[str] = mapped_column(String(120))
    trust: Mapped[str] = mapped_column(String(16), default="system")
    action: Mapped[str] = mapped_column(String(120), index=True)
    target_kind: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
