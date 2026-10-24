"""Per-agent resource scope."""

from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class AgentScope(SQLModel, table=True):
    """One row per (agent, resource_kind, resource_id) an agent is allowed to
    touch. No rows for a kind = unrestricted; any row for a kind turns that
    kind into an allowlist. ``can_write`` gates mutations per row.

    Kinds: ``project`` | ``knowledge`` | ``channel`` | ``connection``.
    ``connection_id`` is set when the kind is ``connection``.
    """

    __tablename__ = "agent_scopes"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "agent_id", "resource_kind", "resource_id", name="uq_agent_scope"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    resource_kind: str = Field(index=True, max_length=32)
    resource_id: str = Field(max_length=128)
    connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id", index=True
    )
    can_write: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
