"""Workspace markdown documents: memory, persona, skills, docs, daily logs, heartbeats."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

DOC_KINDS = ("doc", "memory", "persona", "skill", "daily_log", "heartbeat", "project_doc")


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
    source_type: str = Field(index=True)  # workspace_doc | email | repo_file | doc
    source_id: str = Field(index=True)
    title: str = ""
    content: str = ""
    embedding_json: str = Field(default="[]")
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
