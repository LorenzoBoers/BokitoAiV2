"""Typed intake nodes attached to a Signal thread."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

CASE_CREATE_MODES = ("ask_customer", "ask_operator", "auto", "manual_only")
# A category (CaseType) with an enabled workstream binding files tickets that
# move through that workstream's stages; without one it only labels the
# conversation and the case is done at once.
# `proposed` sits before the lifecycle: an unsure read the operator still has to
# accept on the thread. Everything accepted moves through open -> waiting -> done,
# and a ticket's status always equals the kind of its current stage.
CASE_STATUSES = ("proposed", "open", "waiting", "done")
TICKET_STAGE_KINDS = ("open", "waiting", "done")
CASE_BINDING_TARGETS = ("workstream", "project")
CASE_PROJECT_LINK = ("never", "optional", "required")
CASE_AUDIENCES = ("customer", "internal", "both")
CASE_FIELD_KINDS = ("text", "number", "money", "date", "choice", "contact", "project")


class CaseType(SQLModel, table=True):
    __tablename__ = "case_types"
    __table_args__ = (
        Index(
            "uq_case_types_tenant_slug_alive",
            "tenant_id",
            "slug",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    slug: str = Field(index=True)
    name: str
    description: str = ""
    create_mode: str = "ask_customer"
    # Outbound action policy for this type: draft | ask | send.
    # Draft is deliberately the safe default.
    send_mode: str = Field(default="draft")
    ask_threshold: int = 6
    auto_threshold: int = 9
    autonomy_level: str = Field(default="assisted")  # manual | assisted | autonomous
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
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


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
    """The category of one conversation; a ticket when its category is bound to a workstream."""

    __tablename__ = "cases"
    # One category per conversation: a second intent is split into its own thread.
    __table_args__ = (UniqueConstraint("signal_id", name="uq_cases_signal"),)

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
    # Key into the workstream's stages; empty for label-only categories.
    stage_key: str = ""
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
