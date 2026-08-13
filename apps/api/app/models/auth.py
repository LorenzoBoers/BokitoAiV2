import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


def user_numeric_id(user_id: uuid.UUID) -> int:
    """Derive a stable positive integer id from a UUID.

    The dashboard inbox contract uses numeric user ids for assignee/members.
    This mapping is stable for a given UUID across requests.
    """
    return int(user_id.hex[:8], 16)


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
    # Empty string means passwordless (SSO-only) account.
    password_hash: str = ""
    display_name: str = ""
    job_title: str = ""
    avatar_url: Optional[str] = None
    is_active: bool = True
    is_staff: bool = False
    email_verified: bool = False
    # Per-user preferences (widget theme/sound, hidden conversations, ...).
    settings_json: str = Field(default="{}")
    # Workspace the user was last active in; login/refresh scope the JWT to
    # this tenant so the session survives workspace switches.
    last_tenant_id: Optional[uuid.UUID] = Field(default=None, foreign_key="tenants.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Membership(SQLModel, table=True):
    __tablename__ = "memberships"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    role: str = Field(default="member")  # owner | admin | member
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserPreference(SQLModel, table=True):
    """Per-user, per-tenant preferences (e.g. default chat target)."""

    __tablename__ = "user_preferences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    default_chat_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Session(SQLModel, table=True):
    __tablename__ = "sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    # SHA-256 hex of the raw refresh token (high-entropy random, so an
    # unsalted digest is safe and enables O(1) lookup on refresh).
    refresh_token_hash: str = Field(index=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Invite(SQLModel, table=True):
    __tablename__ = "invites"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    email: str = Field(index=True)
    role: str = Field(default="member")
    token: str = Field(index=True, unique=True)
    invited_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
