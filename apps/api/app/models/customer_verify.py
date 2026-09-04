"""Pending magic-link tokens for thread-scoped customer assurance."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class CustomerVerifyToken(SQLModel, table=True):
    __tablename__ = "customer_verify_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    email: str = ""
    contact_id: Optional[uuid.UUID] = Field(default=None, foreign_key="contacts.id")
    token_hash: str = Field(index=True)
    expires_at: datetime = Field(index=True)
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
