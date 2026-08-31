"""Orchestration entities: the unified Task ledger, eval checkpoints, artifacts.

`AgentTask` is the single work ledger for the platform. Everything that must
be done — an orchestration job, a project queue item, a delegated chore, a
planned human action — is one row here, discriminated by `kind` and `origin`:

- `kind="job"`      — internal execution unit (workstream step run, trigger job)
- workflow kinds    — `feature | bug | task | idea | risk`: project queue items
                      that move through the proposed -> completed workflow
- `assignee_kind`   — `agent` (default) or `human`; human tasks surface in
                      Decisions/Agenda instead of waking an agent

Plain chat Q&A never creates a Task; a Task appears when real work starts or
is planned (see services/orchestration and services/project_work).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

# One status machine for the whole ledger. Workflow (queue) tasks move
# proposed -> queued -> analyzing -> planned -> running -> verifying ->
# completed, with rejected reachable pre-completion. Execution jobs use the
# queued -> running -> completed|failed|cancelled subset. `awaiting_human`
# marks a task blocked on a person (open decision, human assignee).
TASK_STATUSES = (
    "proposed",
    "queued",
    "analyzing",
    "planned",
    "running",
    "verifying",
    "paused",
    "awaiting_human",
    "completed",
    "failed",
    "cancelled",
    "rejected",
)

# Workflow kinds are the project-queue vocabulary; "job" is the internal
# execution unit created by dispatch paths (workstreams, triggers, delegation).
QUEUE_ITEM_KINDS = ("feature", "bug", "task", "idea", "risk")
TASK_KINDS = ("job", *QUEUE_ITEM_KINDS)
TASK_PRIORITIES = ("low", "normal", "high", "urgent")

# Provenance of the task: who/what put it on the ledger.
TASK_ORIGINS = (
    "manual",
    "user",
    "conversation",
    "agent",
    "api",
    "trigger",
    "chat",
    "inbound",
    "queue",
    "delegation",
    "workstream",
    "human",
)

TASK_ASSIGNEE_KINDS = ("agent", "human")


class AgentTask(SQLModel, table=True):
    """The unified Task: orchestration job, project queue item, or human task."""

    __tablename__ = "agent_tasks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    message_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signal_messages.id")
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id", index=True)
    current_step_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstream_steps.id")

    kind: str = Field(default="job", index=True)  # job | feature | bug | task | idea | risk
    title: str
    description: str = ""
    priority: str = Field(default="normal", index=True)
    status: str = Field(default="queued", index=True)  # see TASK_STATUSES
    pause_reason: Optional[str] = None

    # Provenance: where the task came from (the conversation is the source).
    origin: str = Field(default="manual")  # see TASK_ORIGINS
    duplicate_of_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_tasks.id")
    created_by: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_by_type: str = Field(default="user")  # user | agent | system
    created_by_id: str = ""

    # Assignment: an agent works it, or a human owns it (null user = any member).
    assignee_kind: str = Field(default="agent")  # agent | human
    assignee_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    assignee_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")

    # Workflow analysis outcome written by the project agent.
    impact_summary: str = ""
    analyzed_at: Optional[datetime] = None

    context_json: str = Field(default="{}")
    metadata_json: str = Field(default="{}")
    success_criteria_json: str = Field(default="{}")
    trigger_type: str = Field(default="manual")
    trigger_id: Optional[str] = None

    # Planned tasks: when set, the task is dormant until this moment.
    scheduled_for: Optional[datetime] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class EvalCheckpoint(SQLModel, table=True):
    __tablename__ = "eval_checkpoints"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_task_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_tasks.id", index=True)
    run_id: uuid.UUID = Field(foreign_key="agent_runs.id", index=True)
    step_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstream_steps.id")
    eval_kind: str = Field(default="rubric")  # rubric | tool_assert | llm_judge
    criteria_json: str = Field(default="{}")
    result_json: str = Field(default="{}")
    passed: bool = False
    retry_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TaskArtifact(SQLModel, table=True):
    __tablename__ = "task_artifacts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_task_id: uuid.UUID = Field(foreign_key="agent_tasks.id", index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_runs.id")
    name: str
    artifact_type: str = Field(default="text")  # text | json | file
    content_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
