"""Orient: who is writing, what it is about, what we know.

Contacts and organizations, typed recognition (signal types and signals) and
knowledge (docs with pgvector chunks).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
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
from bokito.domain.identity import Posture

EMBEDDING_DIMENSIONS = 1024


class Organization(TenantMixin, TimestampMixin, Base):
    __tablename__ = "organizations"
    __table_args__ = (Index("ix_organizations_tenant_name", "tenant_id", "name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(300))
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(40), default="customer")
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    notes: Mapped[str] = mapped_column(Text, default="")


class Contact(TenantMixin, TimestampMixin, Base):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_tenant_email", "tenant_id", "email"),
        Index("ix_contacts_tenant_phone", "tenant_id", "phone"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(300), default="")
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    language: Mapped[str] = mapped_column(String(8), default="")
    kind: Mapped[str] = mapped_column(String(40), default="customer")
    handles: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    memory: Mapped[str] = mapped_column(Text, default="")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SignalType(TenantMixin, TimestampMixin, Base):
    """Typed recognition: what kind of thing a conversation is about."""

    __tablename__ = "signal_types"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(16), default="")
    fields: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    recognition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    autonomy_cap: Mapped[Posture | None] = mapped_column(
        Enum(Posture, name="posture", native_enum=True, create_type=False), nullable=True
    )
    playbook_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="SET NULL"), nullable=True
    )
    module: Mapped[str] = mapped_column(String(64), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class SignalStatus(enum.StrEnum):
    open = "open"
    waiting = "waiting"
    done = "done"


class Signal(TenantMixin, TimestampMixin, Base):
    __tablename__ = "signals"
    __table_args__ = (Index("ix_signals_tenant_type_status", "tenant_id", "type_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("signal_types.id", ondelete="CASCADE")
    )
    status: Mapped[SignalStatus] = mapped_column(
        Enum(SignalStatus, name="signal_status", native_enum=True), default=SignalStatus.open
    )
    title: Mapped[str] = mapped_column(String(300), default="")
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(40), default="agent")
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocKind(enum.StrEnum):
    doc = "doc"
    memory = "memory"
    persona = "persona"
    skill = "skill"
    snippet = "snippet"


class Doc(TenantMixin, TimestampMixin, Base):
    __tablename__ = "docs"
    __table_args__ = (UniqueConstraint("tenant_id", "path"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[DocKind] = mapped_column(
        Enum(DocKind, name="doc_kind", native_enum=True), default=DocKind.doc
    )
    path: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    frontmatter: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_maintained: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(300), default="")
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL"), nullable=True
    )
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocChunk(TenantMixin, Base):
    __tablename__ = "doc_chunks"
    __table_args__ = (UniqueConstraint("doc_id", "position"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    doc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("docs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    heading: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
