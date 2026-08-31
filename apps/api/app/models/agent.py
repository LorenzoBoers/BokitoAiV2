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
    # company = shared workforce agent. Legacy rows may still have kind=personal
    # (inactive); new agents are always company.
    kind: str = Field(default="company", index=True)  # company
    owner_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    # Who may open a direct chat with this company agent.
    chat_access: str = Field(default="nobody")  # everyone | selected | nobody
    # Exactly one active company agent per tenant carries the lead flag; it is
    # the default fallback whenever nothing more specific is bound to an item.
    is_lead: bool = Field(default=False, index=True)
    model: str = "bokito-ai-3-1"
    provider: str = Field(default="platform")
    system_prompt: str = ""
    thinking_budget: int = 0
    max_tokens: int = 4096
    max_loops: int = 15
    cost_aware: bool = False
    # Hard cost ceiling per task in cents; 0 = no cap.
    max_cost_cents: int = 0
    # Passport: allowed tools (enforced). Empty list = all default tools allowed.
    tools_json: str = Field(default="[]")
    # Passport: autonomy level governs how tool actions are gated.
    autonomy_level: str = Field(default="approval")  # manual | approval | auto
    # Passport: free-form permission scopes (e.g. ["platform:doc:write"]).
    permission_scopes_json: str = Field(default="[]")
    is_active: bool = True
    slug: str = ""
    # Misc agent settings (e.g. email_signature_html used on outbound replies).
    settings_json: str = Field(default="{}")
    runtime_status: str = Field(default="standby")
    parent_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    current_activity_summary: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgentChatUser(SQLModel, table=True):
    """Allowlist rows for company agents with chat_access='selected'."""

    __tablename__ = "agent_chat_users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    status: str = Field(default="running")  # running | completed | failed
    trigger_type: str = Field(default="manual")
    trigger_id: Optional[str] = None
    subject: str = ""
    tokens_input: int = 0
    tokens_output: int = 0
    result_json: str = Field(default="{}")
    task_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_tasks.id", index=True)
    step_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstream_steps.id")
    parent_run_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_runs.id", index=True)
    run_role: str = Field(default="main")  # main | delegate | judge | orchestrator
    segment_index: int = 0
    runtime_snapshot_json: str = Field(default="{}")
    checkpoint_json: str = Field(default="{}")
    pause_reason: Optional[str] = None
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
    sequence: int = 0
    detail_level: str = Field(default="summary")  # summary | full
    created_at: datetime = Field(default_factory=datetime.utcnow)
