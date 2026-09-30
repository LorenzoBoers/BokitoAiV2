"""Act: agents, playbooks, runs (the one ledger) and triggers."""

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
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from bokito.domain.base import Base, TenantMixin, TimestampMixin, uuid_pk
from bokito.domain.identity import Posture


class Agent(TenantMixin, TimestampMixin, Base):
    """An AI colleague. The passport is the whole configuration."""

    __tablename__ = "agents"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(200), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    tools: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    autonomy_cap: Mapped[Posture | None] = mapped_column(
        Enum(Posture, name="posture", native_enum=True, create_type=False), nullable=True
    )
    scopes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    channels: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    language: Mapped[str] = mapped_column(String(8), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    persona_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("docs.id", ondelete="SET NULL"), nullable=True
    )


class Playbook(TenantMixin, TimestampMixin, Base):
    """A repeatable way of working: ordered steps with an optional trigger."""

    __tablename__ = "playbooks"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    autonomy_cap: Mapped[Posture | None] = mapped_column(
        Enum(Posture, name="posture", native_enum=True, create_type=False), nullable=True
    )
    module: Mapped[str] = mapped_column(String(64), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class RunKind(enum.StrEnum):
    reply = "reply"
    playbook = "playbook"
    trigger = "trigger"
    tool = "tool"
    job = "job"


class RunStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    waiting = "waiting"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class Run(TenantMixin, Base):
    """The single execution ledger: agent replies, playbooks, tool calls, jobs."""

    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_tenant_status_created", "tenant_id", "status", "created_at"),
        Index("ix_runs_conversation", "conversation_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[RunKind] = mapped_column(Enum(RunKind, name="run_kind", native_enum=True))
    status: Mapped[RunStatus] = mapped_column(
        Enum(RunStatus, name="run_status", native_enum=True), default=RunStatus.queued
    )
    title: Mapped[str] = mapped_column(String(300), default="")
    actor: Mapped[str] = mapped_column(String(120), default="")
    trust: Mapped[str] = mapped_column(String(16), default="system")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    playbook_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="SET NULL"), nullable=True
    )
    trigger_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("triggers.id", ondelete="SET NULL"), nullable=True
    )
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    tool_name: Mapped[str] = mapped_column(String(120), default="")
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    step: Mapped[int] = mapped_column(Integer, default=0)
    checkpoint: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    cost_eur: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunEvent(TenantMixin, Base):
    __tablename__ = "run_events"
    __table_args__ = (Index("ix_run_events_run_seq", "run_id", "seq"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE")
    )
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TriggerKind(enum.StrEnum):
    cron = "cron"
    interval = "interval"
    webhook = "webhook"
    event = "event"


class Trigger(TenantMixin, TimestampMixin, Base):
    __tablename__ = "triggers"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[TriggerKind] = mapped_column(
        Enum(TriggerKind, name="trigger_kind", native_enum=True)
    )
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True
    )
    playbook_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="SET NULL"), nullable=True
    )
    instructions: Mapped[str] = mapped_column(Text, default="")
    webhook_secret: Mapped[str] = mapped_column(String(64), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_fire_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
