"""Workstream: the central repeatable-process node.

A Workstream is a tenant-owned, optionally project-bound definition of a
repeatable process: an ordered list of steps (minimum one). Each step is an
agent goal, a wait (for input, an event, or time), or a human gate. A
WorkstreamRun is one execution with a typed input; every agent step produces
an `AgentRun` (worklog via RunEvents) and the run ends with a summary.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

WORKSTREAM_STEP_KINDS = ("agent", "wait", "gate")
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
WORKSTREAM_INPUT_KINDS = ("manual", "queue_item", "signal", "trigger", "case")


class Workstream(SQLModel, table=True):
    """Repeatable process definition. Tenant-scoped, optional project binding."""

    __tablename__ = "workstreams"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    name: str
    description: str = ""
    enabled: bool = True
    # Per project one default workstream handles queue items without an
    # explicit routing choice by the PO agent.
    is_default: bool = Field(default=False)
    # Provenance when installed from a module template: the integrity check
    # before each run re-validates the template requirements (module installed,
    # integration connected, agents available).
    module_slug: str = ""
    template_slug: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorkstreamStep(SQLModel, table=True):
    """One linear step: agent goal, wait, or human gate."""

    __tablename__ = "workstream_steps"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    position: int = 0
    name: str
    kind: str = Field(default="agent")  # agent | wait | gate
    # Agent steps: the goal prompt for this step.
    goal: str = ""
    # Fixed agent, with role fallback when unset or inactive.
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    agent_role: str = ""
    # Wait steps: what the run waits for and what happens at the deadline.
    wait_kind: str = Field(default="input")  # input | event | time
    deadline_hours: int = 0  # 0 = no deadline (wait indefinitely for input/event)
    on_deadline: str = Field(default="continue")  # continue | remind_then_continue | fail
    # Handbook context: knowledge section ids the agent reads for this step.
    knowledge_section_ids_json: str = Field(default="[]")
    config_json: str = Field(default="{}")
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
    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)

    status: str = Field(default="running", index=True)  # see WORKSTREAM_RUN_STATUSES
    # Typed input: what started this run.
    input_kind: str = Field(default="manual")  # manual | queue_item | signal | trigger
    input_ref: str = ""  # id of the queue item / signal / trigger when applicable
    input_text: str = ""

    current_step_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstream_steps.id")
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
