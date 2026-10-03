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


class HandoverCode(SQLModel, table=True):
    """Short code that carries a widget conversation over to WhatsApp.

    The customer sends the code in a prefilled WhatsApp message; inbound
    matching links the number to the widget person and continues there.
    """

    __tablename__ = "handover_codes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    code: str = Field(index=True)
    from_signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    whatsapp_account_id: Optional[uuid.UUID] = Field(default=None, foreign_key="channel_accounts.id")
    to_signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id")
    # Customer language for the prefilled message and the summary on WhatsApp.
    language: str = "en"
    expires_at: datetime = Field(index=True)
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
