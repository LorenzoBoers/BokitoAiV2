"""Unified SENSING substrate.

A `Signal` is one inbound/outbound thread regardless of channel (email, chat,
widget, webhook, integration, or internal agent communication). It replaces the
previously split inbox/email/conversation stacks.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

SIGNAL_CHANNELS = ("email", "chat", "widget", "webhook", "integration", "internal")
SIGNAL_STATUSES = ("open", "pending", "closed", "spam", "archived")
SIGNAL_PRIORITIES = ("low", "normal", "high", "urgent")
SIGNAL_MESSAGE_KINDS = (
    "user_message",
    "agent_message",
    "decision_request",
    "status_update",
    "task_result",
    "system_event",
    "internal_note",
)
EXTERNAL_CHANNELS = ("email", "chat", "widget", "webhook", "integration")


def is_internal_channel(channel: str) -> bool:
    return channel == "internal"


class Signal(SQLModel, table=True):
    __tablename__ = "signals"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel: str = Field(default="email", index=True)
    source: str = Field(default="", index=True)
    external_id: str = Field(default="", index=True)
    connection_id: Optional[uuid.UUID] = Field(default=None, foreign_key="integration_connections.id")
    email_account_id: Optional[uuid.UUID] = Field(default=None, foreign_key="email_accounts.id", index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    legacy_inbox_thread_id: Optional[int] = Field(default=None, index=True)

    subject: str = Field(default="(No subject)")
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""

    status: str = Field(default="open", index=True)
    priority: str = Field(default="normal", index=True)
    assigned_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    tags_json: str = Field(default="[]")
    has_unread: bool = True
    ai_paused: bool = False

    category: Optional[str] = Field(default=None, index=True)
    urgency: Optional[int] = None
    impact: Optional[int] = None
    intent: Optional[str] = None
    sentiment: Optional[str] = None
    summary: str = ""
    certainty: Optional[int] = None
    triaged_at: Optional[datetime] = None

    last_message_at: Optional[datetime] = Field(default_factory=datetime.utcnow, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SignalMessage(SQLModel, table=True):
    __tablename__ = "signal_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    kind: str = Field(default="user_message", index=True)
    direction: str = Field(default="inbound")
    role: str = Field(default="user")
    author_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    author_agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id")

    from_address: str = ""
    to_addresses: str = Field(default="[]")
    subject: str = ""
    body_text: str = ""
    body_html: str = ""
    body_preview: str = ""
    external_id: str = Field(default="", index=True)
    attachments_json: str = Field(default="[]")
    send_status: Optional[str] = None
    auto_sent: bool = False
    decision_id: Optional[uuid.UUID] = Field(default=None, foreign_key="decision_requests.id")

    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalEvent(SQLModel, table=True):
    __tablename__ = "signal_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_type: str = ""
    actor_type: str = "system"
    actor_id: str = ""
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalThreadPin(SQLModel, table=True):
    __tablename__ = "signal_thread_pins"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
