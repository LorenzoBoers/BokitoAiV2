"""Orchestration entities: tasks, runtime profiles, eval checkpoints, artifacts."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class RuntimeProfile(SQLModel, table=True):
    __tablename__ = "runtime_profiles"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    slug: str = ""
    role_tag: str = Field(default="executor")  # planner | executor | judge
    provider: str = Field(default="platform")
    model: str = "bokito-ai-3-1"
    thinking_budget: int = 0
    max_tokens: int = 4096
    max_loops: int = 25
    tools_json: str = Field(default="[]")
    autonomy_level: str = Field(default="approval")
    cost_aware: bool = False
    max_cost_cents: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentTask(SQLModel, table=True):
    __tablename__ = "agent_tasks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id", index=True)
    current_step_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstream_steps.id")
    default_runtime_profile_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="runtime_profiles.id"
    )
    title: str
    description: str = ""
    status: str = Field(default="queued")  # queued | running | paused | awaiting_decision | completed | failed | cancelled
    pause_reason: Optional[str] = None
    context_json: str = Field(default="{}")
    success_criteria_json: str = Field(default="{}")
    trigger_type: str = Field(default="manual")
    trigger_id: Optional[str] = None
    created_by: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
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
