"""Workstream: the central repeatable-process node.

A Workstream is a tenant-owned playbook: a stage pipeline for tickets.
Runs are retained for history; the ordered step engine is retired.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

WORKSTREAM_STEP_KINDS = (
    "send_message",
    "agent_task",
    "wait_for_reply",
    "ask_decision",
    "call_tool",
    "schedule",
)
WORKSTREAM_WAIT_KINDS = ("input", "event", "time")
WORKSTREAM_ON_DEADLINE = ("continue", "remind_then_continue", "fail")
WORKSTREAM_RUN_STATUSES = (
    "running",
    "waiting",
    "awaiting_gate",
    "completed",
    "failed",
    "cancelled",
)
WORKSTREAM_INPUT_KINDS = ("manual", "queue_item", "signal", "trigger", "ticket")


class Workstream(SQLModel, table=True):
    """Reusable playbook: a stage pipeline for tickets. Attached to projects via
    `WorkstreamProject`; categories (`SignalTag.workstream_id`) feed it tickets."""

    __tablename__ = "workstreams"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    description: str = ""
    enabled: bool = True
    # Provenance when installed from a module template: the integrity check
    # before each run re-validates the template requirements (module installed,
    # integration connected, agents available).
    module_slug: str = ""
    template_slug: str = ""
    autonomy_level: str = Field(default="")  # empty follows the company; else a ceiling
    # Ticket pipeline: [{"key", "name", "kind": open|waiting|done}]; "[]" means
    # the default Open / Waiting / Done.
    stages_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)
    trash_was_enabled: Optional[bool] = Field(default=None)


class WorkstreamProject(SQLModel, table=True):
    """A playbook attached to a project. Its tickets filed on that project show
    on the project's board."""

    __tablename__ = "workstream_projects"

    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", primary_key=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Optional preferred Flow when a folder links several playbooks.
    is_default: bool = False
    position: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


# WorkstreamStep table retired — playbooks are stages-only (migration 076).
# Keep a non-table stub so legacy type hints in retired helpers still import.
class WorkstreamStep(SQLModel):
    """Deprecated stub. Do not query or persist."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    workstream_id: uuid.UUID | None = None
    tenant_id: uuid.UUID | None = None
    position: int = 0
    name: str = ""
    kind: str = "agent_task"
    goal: str = ""
    agent_id: Optional[uuid.UUID] = None
    agent_role: str = ""
    wait_kind: str = "input"
    deadline_hours: int = 0
    on_deadline: str = "continue"
    knowledge_section_ids_json: str = "[]"
    config_json: str = "{}"
    stage_key: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WorkstreamRun(SQLModel):
    """In-memory receipt only. No ``workstream_runs`` table.

    ``start_run`` returns a completed instance for API/trigger callers.
    Ticket stages live on ``Signal``; attribution uses ``AgentRun.workstream_id``.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID | None = None
    workstream_id: Optional[uuid.UUID] = None
    project_id: Optional[uuid.UUID] = None
    signal_id: Optional[uuid.UUID] = None
    status: str = "completed"
    input_kind: str = "manual"
    input_ref: str = ""
    input_text: str = ""
    wait_until: Optional[datetime] = None
    reminded_at: Optional[datetime] = None
    summary: str = ""
    error: str = ""
    context_json: str = "{}"
    triggered_by_type: str = "user"
    triggered_by_id: str = ""
    started_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
