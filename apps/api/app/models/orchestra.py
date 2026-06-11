import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AgentProfile(SQLModel, table=True):
    __tablename__ = "agent_profiles"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    provider: str = Field(default="platform")
    model: str = "claude-sonnet-4-20250514"
    thinking_budget: int = 0
    max_tokens: int = 4096
    system_prompt: str = ""
    tools_json: str = Field(default="[]")
    max_cost_cents: int = 0
    cost_aware: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Workstream(SQLModel, table=True):
    __tablename__ = "workstreams"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
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
    agent_profile_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_profiles.id")
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


class WorkstreamRun(SQLModel, table=True):
    __tablename__ = "workstream_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    workstream_id: uuid.UUID = Field(foreign_key="workstreams.id", index=True)
    trigger_type: str = Field(default="manual")
    status: str = Field(default="running")  # running | completed | failed | cancelled
    report_json: str = Field(default="{}")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class WorkstreamStepRun(SQLModel, table=True):
    __tablename__ = "workstream_step_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    run_id: uuid.UUID = Field(foreign_key="workstream_runs.id", index=True)
    step_id: uuid.UUID = Field(foreign_key="workstream_steps.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    status: str = Field(default="running")
    log_text: str = ""
    output_json: str = Field(default="{}")
    tokens_in: int = 0
    tokens_out: int = 0
    iteration: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
