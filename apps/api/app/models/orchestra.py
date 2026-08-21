import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Workstream(SQLModel, table=True):
    """Runnable multi-step orchestration. Optionally scoped to a project."""

    __tablename__ = "workstreams"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    name: str
    description: str = ""
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WorkstreamStep(SQLModel, table=True):
    __tablename__ = "workstream_steps"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    order: int = 0
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    runtime_profile_id: Optional[uuid.UUID] = Field(default=None, foreign_key="runtime_profiles.id")
    name: str
    step_kind: str = Field(default="agent")  # agent | eval | human_gate | tool
    prompt_template: str = ""
    handoff_template: str = ""
    input_from_steps_json: str = Field(default="[]")
    success_criteria_json: str = Field(default="{}")
    eval_kind: str = Field(default="rubric")
    on_success_step: Optional[uuid.UUID] = None
    on_fail_step: Optional[uuid.UUID] = None
    on_eval_fail_step: Optional[uuid.UUID] = None
    max_iterations: int = 3
    max_retries: int = 2
    config_json: str = Field(default="{}")
