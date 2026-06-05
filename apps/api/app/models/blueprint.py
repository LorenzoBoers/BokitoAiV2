import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class BlueprintDoc(SQLModel, table=True):
    __tablename__ = "blueprint_docs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    title: str = "Blueprint"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BlueprintPage(SQLModel, table=True):
    __tablename__ = "blueprint_pages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    doc_id: uuid.UUID = Field(foreign_key="blueprint_docs.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    parent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="blueprint_pages.id")
    title: str
    slug: str = Field(index=True)
    kind: str = Field(default="page")  # page | prd | sop | custom | overview | ...
    icon: Optional[str] = None
    is_pinned: bool = False
    is_locked: bool = False
    content_version: int = 0
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BlueprintBlock(SQLModel, table=True):
    __tablename__ = "blueprint_blocks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    page_id: uuid.UUID = Field(foreign_key="blueprint_pages.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    block_type: str = Field(default="paragraph")  # paragraph | heading | list | code
    content_json: str = Field(default="{}")
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BlueprintChangeRequest(SQLModel, table=True):
    __tablename__ = "blueprint_change_requests"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    page_id: Optional[uuid.UUID] = Field(default=None, foreign_key="blueprint_pages.id")
    title: str
    body: str = ""
    status: str = Field(default="pending")  # pending | in_progress | done | rejected
    priority: int = 2
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BlockRevision(SQLModel, table=True):
    __tablename__ = "block_revisions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    block_id: uuid.UUID = Field(foreign_key="blueprint_blocks.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    content_json: str
    change_note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
