"""Social reactions on timeline messages (LinkedIn-style stack)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class MessageReaction(SQLModel, table=True):
    """One reaction per actor per message.

    Actors are users or agents. Kind is a small fixed palette (see
    ``app.services.message_reactions``).
    """

    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "message_id",
            "actor_type",
            "actor_id",
            name="uq_message_reactions_actor",
        ),
        Index("ix_message_reactions_message", "message_id"),
        Index("ix_message_reactions_signal", "signal_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    message_id: uuid.UUID = Field(foreign_key="signal_messages.id", index=True)
    kind: str = Field(default="up", max_length=32, index=True)
    actor_type: str = Field(default="user", max_length=16)  # user | agent
    actor_id: uuid.UUID
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
