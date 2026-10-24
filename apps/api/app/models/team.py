from app.core.time import utcnow

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

# Custom departments nest under the organization root (parent_id null, name All).
TEAM_KIND_CUSTOM = "custom"

# How a team-owned conversation gets picked up.
PICKUP_MODES = ("people", "round_robin", "least_open")

ALL_DEPARTMENT_NAME = "All"

# Departments sit at most this many levels below the organization root.
MAX_DEPARTMENT_DEPTH = 2

# open: colleagues may read the work read-only. shielded: only the branch and above.
DEPARTMENT_VISIBILITY = ("open", "shielded")

# Crew roles as the API speaks them; stored as ``duty``.
CREW_ROLES = ("contact", "accountable", "member")
FOCUS_MAX = 80


class Department(SQLModel, table=True):
    """A department: the one grouping of people and agents in a workspace.

    The table is ``departments``. ``Team`` remains an alias for older imports.

    Every tenant has one root (``parent_id`` null, stored name All). Operators
    see it as the organization: the workspace name and logo. Custom departments
    hang below it, at most ``MAX_DEPARTMENT_DEPTH`` levels deep. Every person is
    implicitly on the root; agents sit there only when placed.

    ``origin_module_slug`` marks a department created by a one-time module drop
    (see docs/architecture/module-one-time-drop.md). At most one live row per
    tenant+slug.
    """

    __tablename__ = "departments"
    __table_args__ = (
        Index(
            "uq_departments_tenant_origin_module",
            "tenant_id",
            "origin_module_slug",
            unique=True,
            postgresql_where=text(
                "origin_module_slug IS NOT NULL AND deleted_at IS NULL"
            ),
            sqlite_where=text(
                "origin_module_slug IS NOT NULL AND deleted_at IS NULL"
            ),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    description: str = ""
    kind: str = Field(default=TEAM_KIND_CUSTOM, index=True)
    pickup: str = Field(default="people")
    visibility: str = Field(default="open", max_length=16)
    # Custom departments appear as Communication folders; All is pinned too.
    pinned: bool = Field(default=True)
    # Nesting: null = All root. Children inherit membership upward to All.
    parent_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    # Catalog slug when this island was created by a module install drop.
    origin_module_slug: Optional[str] = Field(default=None, max_length=64, index=True)
    # Round-robin cursor: the member key that was picked last.
    last_pick: str = ""
    # Legacy light prefs; module prefs live under settings_json.modules.
    settings_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


MEMBER_DUTIES = ("primary", "backup", "member")


class WorkforceMemberType(str, Enum):
    """Directory type on Workforce. Stored on agents; people are ``person``."""

    person = "person"
    ai_agent = "ai_agent"


class DepartmentMember(SQLModel, table=True):
    __tablename__ = "department_members"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    department_id: uuid.UUID = Field(foreign_key="departments.id", index=True)
    member_kind: str = Field(default="user")  # user | agent
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    # primary agent = point of contact, primary user = accountable. Others walk by position.
    duty: str = Field(default="member", max_length=16)
    position: int = Field(default=0)
    # What this member does here, e.g. "Writes social posts". The point of contact delegates on it.
    focus: str = Field(default="", max_length=80)
    created_at: datetime = Field(default_factory=utcnow)


def is_root_department(team: Department) -> bool:
    """True for the tenant All root (undeletable)."""
    return team.parent_id is None and team.name == ALL_DEPARTMENT_NAME


# Older imports keep working. New code uses Department / DepartmentMember.
Team = Department
TeamMember = DepartmentMember
