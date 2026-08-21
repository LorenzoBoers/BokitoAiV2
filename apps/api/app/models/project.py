import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    slug: str = Field(index=True)
    description: str = ""
    autonomous_scope: str = ""
    autonomous_mode: bool = False
    active_domains_json: str = Field(default="[]")
    github_connection_id: Optional[uuid.UUID] = None
    repo_binding_id: Optional[uuid.UUID] = None
    github_repo_full_name: Optional[str] = None
    github_default_branch: Optional[str] = None
    repo_source: Optional[str] = None
    repo_connected_at: Optional[datetime] = None
    repo_index_status: Optional[str] = None
    repo_indexed_at: Optional[datetime] = None
    repo_index_error: Optional[str] = None
    repo_last_commit_sha: Optional[str] = None
    po_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
