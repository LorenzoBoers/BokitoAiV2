"""Workspace Bin index. Tombstones live on the source tables; this row is the UI."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

RESOURCE_TYPES = (
    "conversation",
    "contact",
    "company",
    "project",
    "canvas",
    "knowledge",
    "playbook",
    "trigger",
    "team",
    "inbox_rule",
    "saved_reply",
    "case_type",
    "project_resource",
    "queue_item",
)


class TrashEntry(SQLModel, table=True):
    __tablename__ = "trash_entries"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    resource_type: str = Field(index=True)
    resource_id: uuid.UUID = Field(index=True)
    title: str = ""
    preview: str = ""
    deleted_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    purge_after: datetime = Field(index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    batch_id: uuid.UUID = Field(index=True)
    parent_entry_id: Optional[uuid.UUID] = Field(default=None, foreign_key="trash_entries.id", index=True)
    restore_hint_json: str = Field(default="{}")
