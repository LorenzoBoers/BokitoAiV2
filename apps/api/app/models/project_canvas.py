"""Canvas — one saved piece of work on a conversation.

A canvas has exactly one home conversation (``signal_id``). A conversation
holds zero or more canvases. The folder of a canvas is derived from that
conversation's ``Signal.project_id`` (and moves when the thread is refiled).
``kind`` picks how the source is stored and drawn: dashboard (bokito/canvas),
document, diagram, drawing, image, code, email, sheet, or design. Only a dashboard
has an Agenda refresh. A sheet is a table the operator can export as CSV,
Excel, or a Google Sheet.
"""

from __future__ import annotations

from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

CANVAS_SCHEMA_VERSION = 2

KIND_DASHBOARD = "dashboard"
KIND_DOCUMENT = "document"
KIND_DIAGRAM = "diagram"
KIND_DRAWING = "drawing"
KIND_IMAGE = "image"
KIND_CODE = "code"
KIND_EMAIL = "email"
KIND_SHEET = "sheet"
KIND_DESIGN = "design"
CANVAS_KINDS = (
    KIND_DASHBOARD,
    KIND_DOCUMENT,
    KIND_DIAGRAM,
    KIND_DRAWING,
    KIND_IMAGE,
    KIND_CODE,
    KIND_EMAIL,
    KIND_SHEET,
    KIND_DESIGN,
)


class ProjectCanvas(SQLModel, table=True):
    __tablename__ = "project_canvases"
    __table_args__ = (
        Index(
            "uq_canvas_signal_slug_alive",
            "tenant_id",
            "signal_id",
            "slug",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    department_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    slug: str = Field(default="main", index=True, max_length=64)
    title: str = Field(default="Canvas")
    kind: str = Field(default=KIND_DASHBOARD, max_length=16)
    language: Optional[str] = Field(default=None, max_length=32)
    schema_version: int = Field(default=CANVAS_SCHEMA_VERSION)
    revision: int = Field(default=1)
    layout_json: str = Field(default="{}")
    widgets_json: str = Field(default="[]")
    source: str = Field(default="")
    tree_json: str = Field(default="{}")
    managing_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    refresh_trigger_id: Optional[uuid.UUID] = Field(default=None, foreign_key="triggers.id")
    updated_by_type: str = Field(default="system", max_length=32)
    updated_by_id: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    notes: Optional[str] = Field(default=None)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


class CanvasRevision(SQLModel, table=True):
    """One earlier body of a canvas, kept before the next write.

    The live row stays on ``ProjectCanvas``. This table holds the body that
    was current at ``revision``, for every kind. Restoring copies it forward
    as a newer revision instead of rewinding the counter.
    """

    __tablename__ = "canvas_revisions"
    __table_args__ = (
        UniqueConstraint("canvas_id", "revision", name="uq_canvas_revision"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    canvas_id: uuid.UUID = Field(foreign_key="project_canvases.id", index=True)
    revision: int = Field(default=1)
    title: str = Field(default="Canvas")
    kind: str = Field(default=KIND_DASHBOARD, max_length=16)
    language: Optional[str] = Field(default=None, max_length=32)
    source: str = Field(default="")
    tree_json: str = Field(default="{}")
    layout_json: str = Field(default="{}")
    updated_by_type: str = Field(default="system", max_length=32)
    updated_by_id: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=utcnow)
