"""Unified trigger model: cron, interval, heartbeat, and webhook wakes for agents.

Replaces the legacy orchestra Task (orchestra_tasks), AutomationTemplate, and
agenda orchestrator wake events with one schedulable entity.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

TRIGGER_KINDS = ("cron", "interval", "heartbeat", "webhook")


class Trigger(SQLModel, table=True):
    __tablename__ = "triggers"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    kind: str = Field(default="interval", index=True)  # cron | interval | heartbeat | webhook

    # Schedule: cron uses a 5-field expression; interval/heartbeat use minutes.
    cron_expr: str = ""
    interval_minutes: int = 0

    # Target: explicit agent, or fallback by role. Optional workstream to start instead.
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    agent_role: str = Field(default="orchestra")
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id")

    # Prompt for the wake. Heartbeat triggers also inject the heartbeat checklist doc.
    instructions: str = ""

    # Webhook triggers are fired via POST /api/hooks/{id} with this shared secret.
    webhook_secret: str = ""

    enabled: bool = True
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = Field(default=None, index=True)
    last_status: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
