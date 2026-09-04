"""What the personal assistant remembers about a person, across workspaces.

Deliberately has no ``tenant_id``: this is the one store that follows a user
into every workspace they are a member of, so their Bokito helper keeps
knowing who they are and how they like to work. Business facts stay in
tenant-scoped knowledge — an agency's client data must never leak between
workspaces through this table.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class UserAssistantMemory(SQLModel, table=True):
    __tablename__ = "user_assistant_memory"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    # Short stable handle, e.g. "role", "working-style", "learning".
    key: str = Field(index=True)
    content: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
