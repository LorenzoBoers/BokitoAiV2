"""Canvas — AI-written snapshot dashboard (bokito/canvas).

A canvas is a child node of a Project or of the Tenant (Overview). Operators
add, delete and set metadata; agents write the document under Govern.
Refresh uses the existing Agenda Trigger, not a second scheduler.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

CANVAS_SCHEMA_VERSION = 2
OWNER_PROJECT = "project"
OWNER_TENANT = "tenant"
CANVAS_OWNERS = (OWNER_PROJECT, OWNER_TENANT)


class ProjectCanvas(SQLModel, table=True):
    __tablename__ = "project_canvases"
    __table_args__ = (
        Index(
            "uq_canvas_owner_slug_alive",
            "tenant_id",
            "owner_kind",
            "owner_id",
            "slug",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    owner_kind: str = Field(default=OWNER_PROJECT, max_length=16, index=True)
    owner_id: uuid.UUID = Field(index=True)
    # Kept for project delete cascade and older queries; mirrors owner_id when owner_kind=project.
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    slug: str = Field(default="main", index=True, max_length=64)
    title: str = Field(default="Canvas")
    schema_version: int = Field(default=CANVAS_SCHEMA_VERSION)
    revision: int = Field(default=1)
    layout_json: str = Field(default="{}")
    widgets_json: str = Field(default="[]")
    source: str = Field(default="")
    tree_json: str = Field(default="{}")
    managing_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    refresh_trigger_id: Optional[uuid.UUID] = Field(default=None, foreign_key="triggers.id")
    updated_by_type: str = Field(default="system", max_length=32)
    updated_by_id: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    notes: Optional[str] = Field(default=None)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)
