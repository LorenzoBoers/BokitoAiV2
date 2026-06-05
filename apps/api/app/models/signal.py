"""Unified SENSING substrate.

A `Signal` is one inbound/outbound thread regardless of channel (email, chat,
widget, webhook or integration event). It replaces the previously split
inbox/email/conversation stacks. Interpretation fields (category, urgency,
impact, summary, certainty, intent, sentiment) are populated by the
INTERPRETATION layer; they are nullable until triaged.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

SIGNAL_CHANNELS = ("email", "chat", "widget", "webhook", "integration", "internal")
SIGNAL_STATUSES = ("open", "pending", "closed", "spam", "archived")
SIGNAL_PRIORITIES = ("low", "normal", "high", "urgent")


class Signal(SQLModel, table=True):
    __tablename__ = "signals"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel: str = Field(default="email", index=True)  # see SIGNAL_CHANNELS
    source: str = Field(default="", index=True)  # provider/source slug: gmail, outlook, widget, slack...
    external_id: str = Field(default="", index=True)
    connection_id: Optional[uuid.UUID] = Field(default=None, foreign_key="integration_connections.id")

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

    # INTERPRETATION layer output (nullable until triaged).
    category: Optional[str] = Field(default=None, index=True)
    urgency: Optional[int] = None  # 0-100
    impact: Optional[int] = None  # 0-100
    intent: Optional[str] = None
    sentiment: Optional[str] = None  # positive | neutral | negative
    summary: str = ""
    certainty: Optional[int] = None  # 0-100 confidence of the triage
    triaged_at: Optional[datetime] = None

    last_message_at: Optional[datetime] = Field(default_factory=datetime.utcnow, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SignalMessage(SQLModel, table=True):
    __tablename__ = "signal_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    direction: str = Field(default="inbound")  # inbound | outbound | internal | system
    role: str = Field(default="user")  # user | assistant | system | tool
    author_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")

    from_address: str = ""
    to_addresses: str = Field(default="[]")
    subject: str = ""
    body_text: str = ""
    body_html: str = ""
    body_preview: str = ""
    external_id: str = Field(default="", index=True)
    attachments_json: str = Field(default="[]")
    send_status: Optional[str] = None  # sending | sent | failed
    auto_sent: bool = False
    decision_id: Optional[uuid.UUID] = None

    received_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SignalEvent(SQLModel, table=True):
    __tablename__ = "signal_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    signal_id: uuid.UUID = Field(foreign_key="signals.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_type: str = ""
    actor_type: str = "system"  # user | agent | system
    actor_id: str = ""
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
