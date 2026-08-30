"""Module agent roster: which agents may use a business module's tools."""

import uuid
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class ModuleAgent(SQLModel, table=True):
    """Roster: which agents may use a module's tools (many per module).

    ``is_default`` marks the agent used for module setup chat and as the
    primary owner when no more specific assignment applies.
    """

    __tablename__ = "module_agents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_slug", "agent_id", name="uq_module_agent"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    module_slug: str = Field(index=True, max_length=64)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    is_default: bool = Field(default=False)
    # JSON list of company/administration ids this agent may touch.
    # Empty string = no restriction (all companies of the module).
    company_ids_json: str = Field(default="")
    # Write access: without this flag the agent only gets read tools;
    # propose/apply module tools are filtered out.
    can_write: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
