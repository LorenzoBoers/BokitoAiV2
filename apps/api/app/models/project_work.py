"""Conversation-driven project work: doc links and project resources.

The project queue is the motor, the project doc is the truth, the conversation
is the source. Queue items live on the unified Task ledger
(`app.models.orchestration.AgentTask` with a workflow `kind`); the knowledge
layer lives in `app.models.workspace` (`WorkspaceDoc` pages + `DocSection`
atomic sections). `TaskDocLink` connects queue tasks to the documents (and
optionally the sections) they touch.

`ProjectResource` is the generic attachment slot for external surfaces a
project operates on (repo, drive, notion, vibecode tools). Connectors land
later; the slot, provider, and optional integration connection exist now.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

QUEUE_LINK_RELATIONS = ("implements", "modifies", "touches", "documents")

PROJECT_RESOURCE_TYPES = ("repo", "drive", "notion", "sheet", "vibecode", "site", "other")
PROJECT_RESOURCE_STATUSES = ("linked", "connected", "syncing", "error", "disconnected")


class TaskDocLink(SQLModel, table=True):
    """Queue task <-> knowledge document (and optionally a section).

    Prefer document-level links (`doc_id`). Section links remain for
    fine-grained analysis rows; `section_id` is nullable for document-only
    links and points at the atomic `doc_sections` knowledge unit.
    """

    __tablename__ = "task_doc_links"
    __table_args__ = (
        UniqueConstraint("task_id", "section_id", name="uq_task_section"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    task_id: uuid.UUID = Field(foreign_key="agent_tasks.id", index=True)
    doc_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workspace_docs.id", index=True)
    section_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="doc_sections.id", index=True
    )
    relation: str = Field(default="touches")
    created_by_type: str = Field(default="agent")
    created_by_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectResource(SQLModel, table=True):
    """External surface a project operates on (repo, drive, notion, vibecode).

    Generic slot prepared for future connectors: `connection_id` points at an
    integration connection once one exists; until then a resource is merely
    "linked" with an `external_ref` (repo full name, folder id, page id, url).
    Sync fields serve any indexed resource (repo index today, drives later).
    """

    __tablename__ = "project_resources"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", index=True)

    resource_type: str = Field(index=True)  # repo | drive | notion | sheet | vibecode | site | other
    provider: str = ""  # github | google_drive | notion | cursor | claude_code | ...
    connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id"
    )
    label: str = ""
    external_ref: str = ""
    config_json: str = Field(default="{}")

    status: str = Field(default="linked")  # linked | connected | syncing | error | disconnected
    sync_status: Optional[str] = None  # none | pending | indexing | ready | error
    synced_at: Optional[datetime] = None
    sync_error: Optional[str] = None
    # Last synced ref: commit sha for repos, change cursor for drives later.
    sync_ref: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
