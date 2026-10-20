"""Compaction checkpoints and messages to running subagents.

``signal_compactions`` records each time the older part of a conversation was
folded into ``Signal.compact_summary``: which messages, why, and how large the
history was. The conversation itself stays complete; only the model view
shrinks.

``subagent_messages`` holds follow-ups sent to a subagent (or from a subagent
to its parent). ``steer`` and ``interject`` land between two model rounds of a
running child; ``queue`` waits for a later segment.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class SignalCompaction(SQLModel, table=True):
    __tablename__ = "signal_compactions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    # Position range in the model-eligible history that was summarized.
    from_index: int = 0
    to_index: int = 0
    summary: str = ""
    trigger: str = "auto"  # auto | manual
    tokens_before: int = 0
    context_window: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SubagentMessage(SQLModel, table=True):
    __tablename__ = "subagent_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Soft links: runs may be purged independently of their messages.
    target_run_id: uuid.UUID = Field(index=True)
    sender_run_id: Optional[uuid.UUID] = Field(default=None, index=True)
    body: str = ""
    delivery: str = "steer"  # steer | queue | interject
    status: str = Field(default="pending", index=True)  # pending | delivered | dropped
    created_at: datetime = Field(default_factory=datetime.utcnow)
    delivered_at: Optional[datetime] = None
