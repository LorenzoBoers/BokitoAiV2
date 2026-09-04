"""Workspace markdown documents: memory, persona, skills, docs, daily logs, heartbeats.

Knowledge is stored as pages (`WorkspaceDoc`) composed of small markdown
sections (`DocSection`). The section is the atomic unit: one topic, its own
maturity status, its own embedding chunk. `WorkspaceDoc.content` is a derived
render cache (sections joined in order) so whole-doc readers keep working.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

DOC_KINDS = ("doc", "memory", "persona", "skill", "daily_log", "heartbeat", "project_doc")

# Section maturity: draft (concept) -> review (written, awaiting verification)
# -> final (verified against reality).
DOC_SECTION_STATUSES = ("draft", "review", "final")


class WorkspaceDoc(SQLModel, table=True):
    __tablename__ = "workspace_docs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Project-scoped documentation (kind="project_doc"); null = org or agent knowledge.
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    # Agent-scoped personal knowledge; null = organization (or project) knowledge.
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    # Stable file-style path, unique per tenant (e.g. "memory.md", "skills/triage.md").
    path: str = Field(index=True)
    kind: str = Field(default="doc", index=True)
    title: str = ""
    # Markdown body (frontmatter stripped into frontmatter_json).
    content: str = ""
    frontmatter_json: str = Field(default="{}")
    is_pinned: bool = False
    sort_order: int = 0
    created_by_type: str = Field(default="user")  # user | agent | system
    created_by_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DocSection(SQLModel, table=True):
    """Atomic knowledge unit: one topic, small markdown body, own status.

    Sections belong to a page (`WorkspaceDoc`). The anchor is a stable slug of
    the heading so links and statuses survive edits. The preamble before the
    first `##` heading lives in a section with an empty heading.
    """

    __tablename__ = "doc_sections"
    __table_args__ = (UniqueConstraint("doc_id", "anchor", name="uq_doc_sections_anchor"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    doc_id: uuid.UUID = Field(foreign_key="workspace_docs.id", index=True)

    anchor: str
    heading: str = ""
    position: int = 0
    # Markdown body without the heading line.
    content: str = ""
    status: str = Field(default="draft", index=True)
    status_changed_at: Optional[datetime] = None
    status_changed_by_type: str = ""  # user | agent | system
    status_changed_by_id: str = ""
    # Short summary of what the section covers (agent- or user-written).
    summary: str = ""
    edited_by_type: str = Field(default="user")  # user | agent | system
    edited_by_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DocChunk(SQLModel, table=True):
    """Searchable chunk with embedding; evolved from the legacy IndexChunk.

    Embeddings stored as JSON for portability without pgvector in dev/tests.
    Doc-backed chunks set doc_id; other sources (email, repo files) use
    source_type/source_id only.
    """

    __tablename__ = "doc_chunks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    doc_id: Optional[uuid.UUID] = Field(default=None, foreign_key="workspace_docs.id", index=True)
    # 1:1 with a DocSection for doc-backed chunks (oversized sections may span more).
    section_id: Optional[uuid.UUID] = Field(default=None, foreign_key="doc_sections.id", index=True)
    source_type: str = Field(index=True)  # workspace_doc | email | repo_file | doc
    source_id: str = Field(index=True)
    title: str = ""
    content: str = ""
    embedding_json: str = Field(default="[]")
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
