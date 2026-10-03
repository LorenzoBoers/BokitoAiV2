"""Workbench connections: hand coding work to Cursor, Claude, Devin, GitHub.

A Workbench is a Connection of kind workbench. WorkJob is one dispatched job
on a signal/project. Provider adapters implement the shared interface.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

# Phase-1 live providers first; stubs remain for later phases.
WORKBENCH_PROVIDERS = (
    "cursor",
    "claude_managed",
    "devin",
    "github_copilot",
    "openai",
    "mcp",
)

WORK_JOB_STATES = (
    "queued",
    "running",
    "needs_input",
    "finished",
    "failed",
    "cancelled",
)

WORK_JOB_OUTCOMES = ("merged", "closed", "abandoned")


class WorkJob(SQLModel, table=True):
    """One dispatched coding job against a workbench Connection."""

    __tablename__ = "work_jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    case_id: Optional[uuid.UUID] = Field(default=None, foreign_key="cases.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    workbench_connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id", index=True
    )
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    provider: str = Field(default="cursor", index=True)
    state: str = Field(default="queued", index=True)
    # Canonical external id for webhook/poll idempotency (unique with provider).
    external_id: Optional[str] = Field(default=None, index=True)
    # Provider-native ids: task / agent / session / run.
    external_ids_json: str = Field(default="{}")
    # Artifacts: branch, pr, commit, url, file.
    artifacts_json: str = Field(default="[]")
    summary: str = ""
    brief_json: str = Field(default="{}")
    cost_cents: int = 0
    decision_id: Optional[uuid.UUID] = Field(default=None, index=True)
    requested_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    job_token_id: Optional[uuid.UUID] = Field(default=None, foreign_key="api_tokens.id")
    last_event_at: Optional[datetime] = Field(default=None)
    last_polled_at: Optional[datetime] = Field(default=None)
    outcome: Optional[str] = Field(default=None)
    budget_json: str = Field(default="{}")
    progress_message_id: Optional[uuid.UUID] = Field(default=None)
    seen_event_ids_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
