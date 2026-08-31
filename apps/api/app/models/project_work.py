"""Conversation-driven project work: smart-doc sections, doc links, resources.

The project queue is the motor, the project doc is the truth, the conversation
is the source. Queue items live on the unified Task ledger
(`app.models.orchestration.AgentTask` with a workflow `kind`); this module
keeps the project-doc layer: the project agent analyzes a queue task against
the project documentation (`WorkspaceDoc` rows scoped by `project_id`), links
it to the doc sections it touches (`TaskDocLink`), and drives section statuses
on `ProjectDocSection` from open through implemented/verified.

`ProjectResource` is the generic attachment slot for external surfaces a
project operates on (repo, drive, notion, vibecode tools). Connectors land
later; the slot, provider, and optional integration connection exist now.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

DOC_SECTION_STATUSES = (
    "open",
    "planned",
    "in_progress",
    "implemented",
    "verified",
    "deprecated",
)

QUEUE_LINK_RELATIONS = ("implements", "modifies", "touches", "documents")

PROJECT_RESOURCE_TYPES = ("repo", "drive", "notion", "sheet", "vibecode", "site", "other")
PROJECT_RESOURCE_STATUSES = ("linked", "connected", "syncing", "error", "disconnected")


class ProjectDocSection(SQLModel, table=True):
    """Status layer over a project doc's markdown sections.

    Sections are synced from `##` headings on every doc save; the anchor stays
    stable across saves so links and statuses survive edits.
    """

    __tablename__ = "project_doc_sections"
    __table_args__ = (UniqueConstraint("doc_id", "anchor", name="uq_doc_section_anchor"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", index=True)
    doc_id: uuid.UUID = Field(foreign_key="workspace_docs.id", index=True)

    anchor: str
    heading: str = ""
    position: int = 0
    status: str = Field(default="open", index=True)
    status_changed_at: Optional[datetime] = None
    status_changed_by_type: str = ""  # user | agent | system
    status_changed_by_id: str = ""
    # Short agent-written summary of what the section covers.
    summary: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TaskDocLink(SQLModel, table=True):
    """Queue task <-> doc section link; history stays after tasks complete."""

    __tablename__ = "task_doc_links"
    __table_args__ = (
        UniqueConstraint("task_id", "section_id", name="uq_task_section"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    task_id: uuid.UUID = Field(foreign_key="agent_tasks.id", index=True)
    section_id: uuid.UUID = Field(foreign_key="project_doc_sections.id", index=True)
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
