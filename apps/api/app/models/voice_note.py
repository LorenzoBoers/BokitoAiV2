"""A spoken note from an agent to one person, delivered through the intercom queue."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.time import utcnow


class VoiceNote(SQLModel, table=True):
    __tablename__ = "voice_notes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    # The thread message this note speaks. The thread stays the log.
    message_id: Optional[uuid.UUID] = Field(default=None, index=True)
    # ack | result | question | digest
    kind: str = Field(default="result", max_length=16)
    text: str = ""
    storage_key: str = Field(default="", max_length=400)
    duration_ms: int = 0
    # queued | played | skipped
    status: str = Field(default="queued", index=True, max_length=16)
    reply_to_id: Optional[uuid.UUID] = Field(default=None)
    # Another agent asked this one (handoff); shown as "via ...".
    via_agent_id: Optional[uuid.UUID] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    played_at: Optional[datetime] = None
