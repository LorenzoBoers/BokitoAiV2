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
    autonomy_level: str = Field(default="assisted")  # manual | assisted | autonomous
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
    # Per project one default playbook handles queue items without an explicit
    # routing choice by the PO agent.
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


class WorkstreamRun(SQLModel, table=True):
    """One execution of a workstream with a typed input.

    The worklog lives in the `AgentRun` rows (one per agent step, linked via
    `workstream_run_id`) and their RunEvents; `context_json` carries step
    outputs between steps.
    """

    __tablename__ = "workstream_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)

    status: str = Field(default="running", index=True)  # see WORKSTREAM_RUN_STATUSES
    # Typed input: what started this run.
    input_kind: str = Field(default="manual")  # see WORKSTREAM_INPUT_KINDS
    input_ref: str = ""  # id of the queue item / signal / trigger when applicable
    input_text: str = ""

    current_step_id: Optional[uuid.UUID] = Field(default=None)  # legacy; step engine retired
    # Waiting runs: deadline moment for the scheduler sweep (null = wait forever).
    wait_until: Optional[datetime] = Field(default=None, index=True)
    # Set when a reminder was sent for a remind_then_continue deadline.
    reminded_at: Optional[datetime] = None

    summary: str = ""
    error: str = ""
    context_json: str = Field(default="{}")

    triggered_by_type: str = Field(default="user")  # user | agent | trigger | system
    triggered_by_id: str = ""

    started_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
