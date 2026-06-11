"""Channel layer: accounts and contacts.

`ChannelAccount` is a tenant-owned connection to an external surface (an email
mailbox, the embeddable web widget, a Slack workspace). It replaces the old
`EmailAccount` model and generalizes it across channels.

`Contact` is an external participant identity on a channel (a customer email
address, an anonymous widget visitor, a Slack user). Contacts enable
OpenClaw-style pairing/allowlist controls for inbound messages.

`ChannelBinding` deterministically routes inbound threads to an agent
(OpenClaw `agents.mapping` style): most specific match wins
(contact > channel account > channel), then priority.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

CHANNEL_ACCOUNT_CHANNELS = ("email", "widget", "slack", "internal")
CONTACT_STATUSES = ("approved", "pending", "blocked")


class ChannelAccount(SQLModel, table=True):
    __tablename__ = "channel_accounts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: Optional[uuid.UUID] = Field(default=None, foreign_key="integration_connections.id")
    channel: str = Field(default="email", index=True)
    provider: str = Field(default="mock")  # mock | gmail | outlook | widget | slack
    address: str = Field(default="", index=True)  # email address / widget slug / slack team id
    display_name: str = ""
    is_enabled: bool = True
    sync_cursor: str = ""
    credentials_json: str = Field(default="{}")
    settings_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChannelBinding(SQLModel, table=True):
    __tablename__ = "channel_bindings"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel: str = Field(default="widget", index=True)  # widget | email | assistant | internal | slack
    channel_account_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="channel_accounts.id", index=True
    )
    contact_id: Optional[uuid.UUID] = Field(default=None, foreign_key="contacts.id", index=True)
    agent_id: uuid.UUID = Field(foreign_key="agents.id", index=True)
    priority: int = 0
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Contact(SQLModel, table=True):
    __tablename__ = "contacts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel: str = Field(default="email", index=True)
    address: str = Field(default="", index=True)  # email / visitor key / slack user id
    display_name: str = ""
    status: str = Field(default="approved", index=True)  # approved | pending | blocked
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    metadata_json: str = Field(default="{}")
    last_seen_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
