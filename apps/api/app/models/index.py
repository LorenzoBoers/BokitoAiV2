import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column
from sqlmodel import Field, SQLModel


class IndexChunk(SQLModel, table=True):
    __tablename__ = "index_chunks"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    source_type: str  # blueprint_block | email | doc | repo_file
    source_id: str = Field(index=True)
    title: str = ""
    content: str = ""
    embedding_json: str = Field(default="[]")  # stored as JSON array for portability without pgvector ext in tests
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
