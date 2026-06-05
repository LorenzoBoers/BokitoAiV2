"""Multichannel inbox tables matching the dashboard inbox contract.

These use integer primary keys (Xano-compatible) so the existing rich
dashboard inbox UI works unchanged when the dashboard runs in bokito mode
(VITE_API_MODE=bokito) and talks to FastAPI instead of Xano.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


def user_numeric_id(user_id: uuid.UUID) -> int:
    """Derive a stable positive integer id from a user UUID.

    The dashboard inbox contract uses numeric user ids for assignee/members.
    This mapping is stable for a given user across requests.
    """
    return int(user_id.hex[:8], 16)


class InboxThread(SQLModel, table=True):
    __tablename__ = "inbox_threads"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    organisation_id: str = Field(default="", index=True)
    email_connection_id: Optional[int] = None
    graph_conversation_id: str = ""
    email_subject: str = "(No subject)"
    contact_email: str = ""
    contact_name: str = ""
    contact_phone: str = ""
    status: str = Field(default="open", index=True)  # open | pending | closed | spam
    priority: str = Field(default="normal")  # normal | high | urgent
    assigned_to_user_id: Optional[int] = None
    tags_json: str = Field(default="[]")
    last_message_at: Optional[datetime] = Field(default_factory=datetime.utcnow, index=True)
    has_unread: bool = True
    channel: str = Field(default="email", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InboxMessage(SQLModel, table=True):
    __tablename__ = "inbox_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(foreign_key="inbox_threads.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: Optional[int] = None
    direction: str = "inbound"  # inbound | outbound | internal | system
    from_address: str = ""
    to_addresses: str = ""
    subject: str = ""
    body_preview: str = ""
    body_html: Optional[str] = None
    graph_message_id: str = ""
    in_reply_to: Optional[str] = None
    author_user_id: Optional[int] = None
    is_read: bool = False
    send_status: Optional[str] = None  # sending | sent | failed
    attachments_json: str = Field(default="[]")
    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InboxEvent(SQLModel, table=True):
    __tablename__ = "inbox_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(foreign_key="inbox_threads.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_type: str = ""
    actor_user_id: Optional[int] = None
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InboxThreadPin(SQLModel, table=True):
    __tablename__ = "inbox_thread_pins"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: int = Field(index=True)
    thread_id: int = Field(foreign_key="inbox_threads.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
