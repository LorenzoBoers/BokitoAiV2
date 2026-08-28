"""Module-scoped knowledge sources (platform seeds + tenant URLs)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

MODULE_SOURCE_KINDS = ("web", "upload", "manual")
MODULE_SOURCE_ORIGINS = ("platform", "tenant")
MODULE_SOURCE_STATUSES = ("pending", "indexing", "ready", "error", "disabled")


class ModuleSource(SQLModel, table=True):
    """A knowledge source scoped to one integration module.

    Platform rows are seeded per tenant on first enable (tenant_id set) so
    RBAC and hybrid search stay tenant-isolated. Tenants may add their own
    URLs; platform-origin rows can be disabled but not deleted by operators.
    """

    __tablename__ = "module_sources"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    module_slug: str = Field(index=True)
    kind: str = Field(default="web", index=True)
    origin: str = Field(default="tenant", index=True)
    title: str = ""
    url: str = ""
    status: str = Field(default="pending", index=True)
    auto_reindex: bool = True
    workspace_doc_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="workspace_docs.id", index=True
    )
    last_synced_at: Optional[datetime] = None
    sync_error: str = ""
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
