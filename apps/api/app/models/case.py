"""Typed intake nodes attached to a Signal thread."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

CASE_CREATE_MODES = ("ask_customer", "ask_operator", "auto", "manual_only")
CASE_FOLLOW_UP_MODES = ("label", "track", "route")
# Operator UI maps: label = Label only; track = Track as ticket;
# route = Track and run a playbook (via CaseTypeBinding to a workstream).
# `proposed` sits before the lifecycle: an unsure read the operator still has to
# accept on the thread. Everything accepted moves through open -> waiting -> done.
CASE_STATUSES = ("proposed", "open", "waiting", "done")
CASE_BINDING_TARGETS = ("workstream", "project")
CASE_PROJECT_LINK = ("never", "optional", "required")
CASE_AUDIENCES = ("customer", "internal", "both")
CASE_FIELD_KINDS = ("text", "number", "money", "date", "choice", "contact", "project")


class CaseType(SQLModel, table=True):
    __tablename__ = "case_types"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_case_types_tenant_slug"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    slug: str = Field(index=True)
    name: str
    description: str = ""
    create_mode: str = "ask_customer"
    # Outbound action policy for this type: draft | ask | send.
    # Draft is deliberately the safe default.
    send_mode: str = Field(default="draft")
    # label = stamp only (never queue); track = queue without route;
    # route = expect workstream/project bindings.
    follow_up_mode: str = "track"
    ask_threshold: int = 6
    auto_threshold: int = 9
    autonomy_level: str = Field(default="approval")  # manual | approval | auto
    requires_verification: bool = False
    # Optional project every case of this type lands in when the thread has none.
    default_project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id")
    allow_project_link: str = "optional"
    audience: str = "both"
    enabled: bool = True
    module_slug: str = ""
    template_slug: str = ""
    sort_order: int = 0
    # Optional JSON schema snippet for typed fields on this type (legacy mirror of CaseTypeField rows).
    fields_schema_json: str = Field(default="[]")
    # When true, Communication list may show a folder filter for this type.
    show_as_folder: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CaseTypeField(SQLModel, table=True):
    """Typed field definition on a signal type (amount, order number, …)."""

    __tablename__ = "case_type_fields"
    __table_args__ = (
        UniqueConstraint("tenant_id", "case_type_id", "slug", name="uq_case_type_fields_slug"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    case_type_id: uuid.UUID = Field(foreign_key="case_types.id", index=True)
    slug: str
    name: str
    kind: str = "text"
    required: bool = False
    choices_json: str = Field(default="[]")
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    # Extracted typed field values for this signal instance: {"amount": 12.5, ...}.
    fields_json: str = Field(default="{}")
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
