import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Tenant(SQLModel, table=True):
    __tablename__ = "tenants"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(index=True, unique=True)
    name: str
    logo_url: Optional[str] = None
    settings_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    display_name: str = ""
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Membership(SQLModel, table=True):
    __tablename__ = "memberships"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    role: str = Field(default="admin")  # admin | member
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Session(SQLModel, table=True):
    __tablename__ = "sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    refresh_token_hash: str
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
