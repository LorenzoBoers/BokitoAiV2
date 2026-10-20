"""Agent turns and asks in a conversation.

``agent_turns`` is the queue of who speaks next. A row is queued, one row
per conversation runs, and it ends done, failed or cancelled. The worker
claims the oldest queued row with ``FOR UPDATE SKIP LOCKED``; Redis only
rings the bell.

``agent_asks`` is a question one agent put to another. The answer and any
images in it go back to the agent that asked.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel


class AgentTurn(SQLModel, table=True):
    __tablename__ = "agent_turns"
    __table_args__ = (
        Index(
            "ux_agent_turns_one_running",
            "signal_id",
            unique=True,
            postgresql_where=text("status = 'running'"),
            sqlite_where=text("status = 'running'"),
        ),
        Index("ix_agent_turns_signal_status", "signal_id", "status"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    # human | mention | ask | handoff | answer | system | inline
    cause_kind: str = "human"
    cause_message_id: Optional[uuid.UUID] = Field(default=None)
    requested_by_kind: str = "user"
    requested_by_id: Optional[uuid.UUID] = Field(default=None)
    prompt: str = ""
    ask_id: Optional[uuid.UUID] = Field(default=None)
    # The human message this chain of agent turns answers.
    episode_id: Optional[uuid.UUID] = Field(default=None, index=True)
    # queued | running | done | failed | cancelled
    status: str = Field(default="queued", index=True)
    # spoke | silent | stalled | budget | error | cancelled
    outcome: str = ""
    lease_until: Optional[datetime] = Field(default=None)
    attempt: int = 0
    run_id: Optional[uuid.UUID] = Field(default=None)
    tokens: int = 0
    idempotency_key: str = Field(default="", unique=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class AgentAsk(SQLModel, table=True):
    __tablename__ = "agent_asks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    from_agent_id: uuid.UUID = Field(foreign_key="agents.id")
    to_agent_id: uuid.UUID = Field(foreign_key="agents.id")
    question: str = ""
    # open | answered | cancelled
    status: str = Field(default="open", index=True)
    answer_text: str = ""
    # [{"type": "text", "text": ...} | {"type": "image", "url": ..., "mime": ...}]
    answer_json: str = Field(default="[]")
    episode_id: Optional[uuid.UUID] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    answered_at: Optional[datetime] = None
