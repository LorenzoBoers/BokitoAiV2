"""Typed intake nodes attached to a Signal thread."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

CASE_CREATE_MODES = ("ask_customer", "ask_operator", "auto", "manual_only")
CASE_FOLLOW_UP_MODES = ("label", "track", "route")
CASE_STATUSES = (
    "proposed",
    "open",
    "waiting_customer",
    "waiting_operator",
    "linked",
    "closed",
    "cancelled",
)
CASE_BINDING_TARGETS = ("workstream", "project")
CASE_PROJECT_LINK = ("never", "optional", "required")
CASE_AUDIENCES = ("customer", "internal", "both")


class CaseType(SQLModel, table=True):
    __tablename__ = "case_types"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_case_types_tenant_slug"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    slug: str = Field(index=True)
    name: str
    description: str = ""
    create_mode: str = "ask_customer"
    # label = stamp only (never queue); track = queue without route;
    # route = expect workstream/project bindings.
    follow_up_mode: str = "track"
    ask_threshold: int = 6
    auto_threshold: int = 9
    requires_verification: bool = False
    allow_project_link: str = "optional"
    audience: str = "both"
    enabled: bool = True
    module_slug: str = ""
    template_slug: str = ""
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Case(SQLModel, table=True):
    __tablename__ = "cases"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    case_type_id: uuid.UUID = Field(foreign_key="case_types.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    contact_id: Optional[uuid.UUID] = Field(default=None, foreign_key="contacts.id")
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id")
    workstream_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workstreams.id")
    workstream_run_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="workstream_runs.id"
    )
    queue_item_id: Optional[uuid.UUID] = None
    title: str = ""
    summary: str = ""
    payload_json: str = Field(default="{}")
    status: str = Field(default="open", index=True)
    certainty: Optional[int] = None
    create_mode_used: str = ""
    created_by_type: str = ""
    created_by_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CaseTypeBinding(SQLModel, table=True):
    __tablename__ = "case_type_bindings"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "case_type_id",
            "target_kind",
            "target_id",
            name="uq_case_type_bindings_target",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    case_type_id: uuid.UUID = Field(foreign_key="case_types.id", index=True)
    target_kind: str
    target_id: uuid.UUID
    priority: int = 0
    auto_link: bool = True
    auto_start_run: bool = False
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
