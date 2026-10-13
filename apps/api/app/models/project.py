import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    """A folder: a saved tag filterset (operators see Folder / Map).

    Membership is AND of ``project_tag_links``: a conversation matches when its
    effective tags (own links, action tag, contact/company) contain every tag
    in the set. The Communication/Agenda tree is derived from overlapping sets;
    there is no stored parent. ``Signal.project_id`` may cache the longest
    matching filterset for attribution. Canvas, docs and files stay on this hub.
    """

    __tablename__ = "projects"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    slug: str = Field(index=True)
    description: str = ""
    autonomous_scope: str = ""
    active_domains_json: str = Field(default="[]")
    # Sibling order in the derived tree / flat list.
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    trash_batch_id: Optional[uuid.UUID] = Field(default=None, index=True)


class ProjectTagLink(SQLModel, table=True):
    """One tag in a folder's AND filterset. Order is display-only."""

    __tablename__ = "project_tag_links"
    __table_args__ = (UniqueConstraint("project_id", "tag_id", name="uq_project_tag"),)

    project_id: uuid.UUID = Field(foreign_key="projects.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="signal_tags.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
