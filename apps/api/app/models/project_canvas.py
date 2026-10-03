"""Project canvas — flexible AI-maintained layout for dashboards and boards.

One primary canvas per project (`slug=main`) holds a versioned widget grid.
Domain data stays in queue/docs/resources; widgets either embed static content
or bind to live project surfaces. New widget types extend the allowlist without
schema migrations.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

# Schema version for layout/widget document shape. Bump when breaking.
CANVAS_SCHEMA_VERSION = 1

# Extensible widget type registry (server validates; clients ignore unknowns).
WIDGET_TYPES = frozenset(
    {
        "markdown",
        "metric",
        "status",
        "queue_summary",
        "queue_list",
        "resources",
        "budget",
        "work_jobs",
        "links",
        "table",
        "chart",
        "iframe",
        "spacer",
    }
)

# Live-bound types resolve data at read time (hydrate).
LIVE_WIDGET_TYPES = frozenset(
    {
        "queue_summary",
        "queue_list",
        "resources",
        "budget",
        "work_jobs",
    }
)


class ProjectCanvas(SQLModel, table=True):
    __tablename__ = "project_canvases"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "slug", name="uq_project_canvas_slug"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", index=True)
    slug: str = Field(default="main", index=True, max_length=64)
    title: str = Field(default="Canvas")
    schema_version: int = Field(default=CANVAS_SCHEMA_VERSION)
    # Optimistic concurrency: clients send expected_revision on write.
    revision: int = Field(default=1)
    layout_json: str = Field(default="{}")
    widgets_json: str = Field(default="[]")
    updated_by_type: str = Field(default="system", max_length=32)  # system | user | agent
    updated_by_id: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    notes: Optional[str] = Field(default=None)  # optional operator/AI changelog blurb
