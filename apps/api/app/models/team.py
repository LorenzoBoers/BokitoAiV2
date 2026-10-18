import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

# Custom departments nest under the All root (parent_id null, name All).
TEAM_KIND_CUSTOM = "custom"

# How a team-owned conversation gets picked up.
PICKUP_MODES = ("people", "agent_first", "round_robin", "least_open")

ALL_DEPARTMENT_NAME = "All"


class Department(SQLModel, table=True):
    """A department: the one grouping of people and agents in a workspace.

    The table is ``departments``. ``Team`` remains an alias for older imports.

    Every tenant has one root **All** (``parent_id`` null, name All). Custom
    departments are children of All (or of another custom department).
    """

    __tablename__ = "departments"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    description: str = ""
    kind: str = Field(default=TEAM_KIND_CUSTOM, index=True)
    pickup: str = Field(default="people")
    # Custom departments appear as Communication folders; All is pinned too.
    pinned: bool = Field(default=True)
    # Nesting: null = All root. Children inherit membership upward to All.
    parent_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    # Round-robin cursor: the member key that was picked last.
    last_pick: str = ""
    # Legacy light prefs; team marks are member facepiles (not editable).
    settings_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


MEMBER_DUTIES = ("primary", "backup", "member")


class DepartmentMember(SQLModel, table=True):
    __tablename__ = "department_members"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    department_id: uuid.UUID = Field(foreign_key="departments.id", index=True)
    member_kind: str = Field(default="user")  # user | agent
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    # Escalation: one primary person and one primary agent. Others walk by position.
    duty: str = Field(default="member", max_length=16)
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


def is_root_department(team: Department) -> bool:
    """True for the tenant All root (undeletable)."""
    return team.parent_id is None and team.name == ALL_DEPARTMENT_NAME


# Older imports keep working. New code uses Department / DepartmentMember.
Team = Department
TeamMember = DepartmentMember
