"""Single-use auth tokens for password reset and email verification."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

AUTH_TOKEN_KINDS = ("password_reset", "email_verify")


class AuthToken(SQLModel, table=True):
    __tablename__ = "auth_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    kind: str = Field(default="password_reset", index=True)
    token: str = Field(index=True, unique=True)
    expires_at: datetime
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
