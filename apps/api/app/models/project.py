import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    slug: str = Field(index=True)
    description: str = ""
    autonomous_scope: str = ""
    active_domains_json: str = Field(default="[]")
    # Default coding workbench used when dispatch does not name a connection.
    workbench_connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id", index=True
    )
    # External surfaces (repo, drive, notion, vibecode) live in ProjectResource.
    po_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    # None inherits the workspace daily/hourly token cap (Usage).
    token_budget_daily: Optional[int] = Field(default=None)
    token_budget_hourly: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


class ProjectAgent(SQLModel, table=True):
    """Roster: which agents work on a project (many per project).

    `is_default` marks the agent that handles project threads without a more
    specific assignment; `po_agent_id` on the project stays the orchestrator.
    """

    __tablename__ = "project_agents"
    __table_args__ = (UniqueConstraint("project_id", "agent_id", name="uq_project_agent"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    is_default: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
