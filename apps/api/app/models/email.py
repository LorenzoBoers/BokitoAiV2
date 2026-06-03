import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class EmailAccount(SQLModel, table=True):
    __tablename__ = "email_accounts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: Optional[uuid.UUID] = Field(default=None, foreign_key="integration_connections.id")
    email_address: str
    provider: str = "mock"  # mock | outlook | gmail
    is_enabled: bool = True
    sync_cursor: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EmailThread(SQLModel, table=True):
    __tablename__ = "email_threads"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    account_id: uuid.UUID = Field(foreign_key="email_accounts.id", index=True)
    subject: str = ""
    external_id: str = Field(default="", index=True)
    has_unread: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EmailMessage(SQLModel, table=True):
    __tablename__ = "email_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    thread_id: uuid.UUID = Field(foreign_key="email_threads.id", index=True)
    account_id: uuid.UUID = Field(foreign_key="email_accounts.id", index=True)
    direction: str = Field(default="inbound")  # inbound | outbound
    from_address: str = ""
    to_addresses: str = Field(default="[]")
    subject: str = ""
    body_text: str = ""
    body_html: str = ""
    external_id: str = Field(default="", index=True)
    is_read: bool = False
    processed_by_agent: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
