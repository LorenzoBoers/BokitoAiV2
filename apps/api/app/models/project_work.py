"""Conversation-driven project work: queue items, smart-doc sections, resources.

The project queue is the motor, the project doc is the truth, the conversation
is the source. A `ProjectQueueItem` captures an implementation request
(feature, bug, task, idea, risk) that originated from a thread, a user, or an
agent. The project agent analyzes it against the project documentation
(`WorkspaceDoc` rows scoped by `project_id`), links it to the doc sections it
touches (`QueueItemDocLink`), and drives section statuses on
`ProjectDocSection` from open through implemented/verified.

`ProjectResource` is the generic attachment slot for external surfaces a
project operates on (repo, drive, notion, vibecode tools). Connectors land
later; the slot, provider, and optional integration connection exist now.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

QUEUE_ITEM_KINDS = ("feature", "bug", "task", "idea", "risk")
QUEUE_ITEM_PRIORITIES = ("low", "normal", "high", "urgent")
# proposed -> accepted -> analyzing -> planned -> in_progress -> verifying -> done
# plus terminal "rejected" (any pre-done state can reject).
QUEUE_ITEM_STATUSES = (
    "proposed",
    "accepted",
    "analyzing",
    "planned",
    "in_progress",
    "verifying",
    "done",
    "rejected",
)

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


class ProjectQueueItem(SQLModel, table=True):
    __tablename__ = "project_queue_items"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="projects.id", index=True)

    kind: str = Field(default="task", index=True)
    title: str
    body: str = ""
    priority: str = Field(default="normal", index=True)
    status: str = Field(default="proposed", index=True)
    duplicate_of_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="project_queue_items.id"
    )

    # Provenance: where the request came from (the conversation is the source).
    origin_type: str = Field(default="user")  # conversation | user | agent | api | trigger
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    message_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signal_messages.id")
    created_by_type: str = Field(default="user")  # user | agent | system
    created_by_id: str = ""

    # Analysis outcome written by the project agent.
    impact_summary: str = ""
    analyzed_at: Optional[datetime] = None
    assigned_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")

    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


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


class QueueItemDocLink(SQLModel, table=True):
    """Queue item <-> doc section link; history stays after items complete."""

    __tablename__ = "queue_item_doc_links"
    __table_args__ = (
        UniqueConstraint("queue_item_id", "section_id", name="uq_queue_item_section"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    queue_item_id: uuid.UUID = Field(foreign_key="project_queue_items.id", index=True)
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
