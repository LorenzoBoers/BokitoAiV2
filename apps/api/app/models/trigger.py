"""Unified trigger model: cron, interval, heartbeat, and webhook wakes for agents.

Replaces the legacy orchestra Task (orchestra_tasks), AutomationTemplate, and
agenda orchestrator wake events with one schedulable entity.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

TRIGGER_KINDS = ("cron", "interval", "heartbeat", "webhook", "once", "event")


class Trigger(SQLModel, table=True):
    __tablename__ = "triggers"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    # cron | interval | heartbeat | webhook | once (one-shot agent task) | event (calendar item)
    kind: str = Field(default="interval", index=True)

    # Schedule: cron uses a 5-field expression; interval/heartbeat use minutes.
    # once/event use next_run_at directly as the scheduled moment.
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

    # The thread this rule is the schedule of. Every trigger has one: the wake
    # runs and reports there, and closing the thread lasts until the next run.
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    created_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    # Who the thread is for (its owner): a person or a team. Empty = the creator.
    recipient_kind: str = ""
    recipient_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    recipient_team_id: Optional[uuid.UUID] = Field(default=None, foreign_key="teams.id")

    # "" for operator/agent wakes; "stage_checkup" for the recurring look at a
    # ticket in a flow stage. It goes to the conversation's owner at fire time
    # (lifecycle lives in services/stage_checkups.py).
    purpose: str = Field(default="", index=True)
    stage_key: str = ""

    enabled: bool = True
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = Field(default=None, index=True)
    last_status: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)
    # Snapshot of enabled before a Bin move so restore can re-enable.
    trash_was_enabled: Optional[bool] = Field(default=None)
