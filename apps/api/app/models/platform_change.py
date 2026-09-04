"""Draft/versioning layer for platform self-maintenance.

Every structural mutation (agent, workstream, workspace doc, integration, graph)
can be proposed as a PlatformChange. Users accept or reject drafts unless
yolo mode applies (direct apply without draft queue).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

PLATFORM_RESOURCE_TYPES = frozenset(
    {
        "agent",
        "workstream",
        "workspace_doc",
        "integration",
        "mcp_server",
        "canvas_node",
        "canvas_edge",
        "agent_passport",
        # Learning-loop proposals (system-proposed, human-accepted in Govern).
        "autonomy_posture",
        "persona_review",
        "case_type",
        "case_type_binding",
    }
)

CHANGE_KINDS = frozenset({"create", "update", "delete", "connect", "review"})
CHANGE_STATUSES = frozenset(
    {
        "draft",
        "pending_review",
        "accepted",
        "rejected",
        "superseded",
        "applied_yolo",
    }
)


class PlatformChange(SQLModel, table=True):
    __tablename__ = "platform_changes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    resource_type: str = Field(index=True)
    resource_id: str = Field(default="", index=True)
    change_kind: str = Field(default="update", index=True)
    status: str = Field(default="pending_review", index=True)
    version: int = Field(default=0, index=True)
    summary: str = ""
    before_json: str = Field(default="{}")
    after_json: str = Field(default="{}")
    proposed_by_type: str = Field(default="agent", index=True)  # agent | user | system
    proposed_by_id: str = Field(default="", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, index=True)
    decision_id: Optional[uuid.UUID] = Field(default=None, foreign_key="decision_requests.id")
    resolved_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    resolved_at: Optional[datetime] = None
