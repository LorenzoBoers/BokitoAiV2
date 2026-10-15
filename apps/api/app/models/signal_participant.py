"""Who is in a conversation (humans, agents, contacts, teams).

Ownership (``Signal.assignee_kind``) stays the single responsible party for
For-you / turn routing. Participants answer “who is involved” for multi-party
and agent↔agent threads.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

PARTICIPANT_KINDS = ("user", "agent", "contact", "team")
PARTICIPANT_ROLES = ("owner", "member", "watcher")


class SignalParticipant(SQLModel, table=True):
    __tablename__ = "signal_participants"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "signal_id",
            "kind",
            "ref_id",
            name="uq_signal_participants_member",
        ),
        Index("ix_signal_participants_signal", "signal_id"),
        Index("ix_signal_participants_ref", "kind", "ref_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    kind: str = Field(max_length=16, index=True)  # user | agent | contact | team
    ref_id: uuid.UUID = Field(index=True)
    role: str = Field(default="member", max_length=16)  # owner | member | watcher
    joined_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    )
    left_at: datetime | None = Field(default=None)
    invited_by_kind: str = Field(default="", max_length=16)
    invited_by_id: uuid.UUID | None = Field(default=None)
    # session | mention | assign | a2a | backfill | invite | …
    joined_via: str = Field(default="", max_length=32)
