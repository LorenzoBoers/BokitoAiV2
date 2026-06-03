import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Agent(SQLModel, table=True):
    __tablename__ = "agents"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    role: str = Field(default="assistant")  # assistant | po | orchestrator | coding | orchestra
    model: str = "claude-sonnet-4-20250514"
    provider: str = Field(default="platform")
    system_prompt: str = ""
    thinking_budget: int = 0
    max_tokens: int = 4096
    max_loops: int = 15
    cost_aware: bool = False
    tools_json: str = Field(default="[]")
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    status: str = Field(default="running")  # running | completed | failed
    trigger_type: str = Field(default="manual")
    trigger_id: Optional[str] = None
    subject: str = ""
    tokens_input: int = 0
    tokens_output: int = 0
    result_json: str = Field(default="{}")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class RunEvent(SQLModel, table=True):
    __tablename__ = "run_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    run_id: uuid.UUID = Field(foreign_key="agent_runs.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_type: str
    message: str = ""
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
