"""In-app call from an agent while a decision card is open."""

from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AgentCall(SQLModel, table=True):
    __tablename__ = "agent_calls"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    # Soft link: DecisionRequest.message_id already points at the card.
    decision_id: uuid.UUID = Field(index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    # ringing | live | missed | declined | ended
    status: str = Field(default="ringing", index=True)
    ring_until: datetime = Field(default_factory=utcnow)
    created_at: datetime = Field(default_factory=utcnow)
    answered_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
