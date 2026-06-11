"""Unified, append-only audit log for the GOVERN & ASSURE layer.

Every consequential action (agent tool call, decision resolution, mutation)
records an AuditEvent so the trail is searchable across actors, resources and
outcomes from one place.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AuditEvent(SQLModel, table=True):
    __tablename__ = "audit_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    actor_type: str = Field(default="agent", index=True)  # user | agent | system
    actor_id: str = Field(default="", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, index=True)
    action: str = Field(default="", index=True)  # e.g. "tool_call:write_doc", "decision:approve"
    resource_type: str = Field(default="", index=True)
    resource_id: str = ""
    outcome: str = Field(default="executed", index=True)  # executed | denied | escalated | error
    summary: str = ""
    before_json: str = Field(default="{}")
    after_json: str = Field(default="{}")
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
