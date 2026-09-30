"""Linked SSO identities (Google / Microsoft) for Bokito accounts."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class UserIdentity(SQLModel, table=True):
    """One linked IdP account per provider per user."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identity_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_identity_user_provider"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    # Canonical product names: "google" | "microsoft"
    provider: str = Field(index=True)
    # Stable IdP subject (Google id/sub, Microsoft oid or Graph id).
    subject: str = Field(index=True)
    email_at_link: str = ""
    linked_at: datetime = Field(default_factory=datetime.utcnow)
