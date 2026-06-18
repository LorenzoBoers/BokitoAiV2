"""Email routing rules: deterministic inbound assignment/labeling.

A lightweight per-mailbox rule set evaluated when an inbound email signal is
created. Distinct from `ChannelBinding` (which routes threads to an agent).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

ROUTING_CONDITION_TYPES = ("sender_domain", "subject_contains", "mailbox")


class EmailRoutingRule(SQLModel, table=True):
    __tablename__ = "email_routing_rules"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    channel_account_id: uuid.UUID = Field(foreign_key="channel_accounts.id", index=True)
    priority: int = 100
    condition_type: str = Field(default="sender_domain")
    condition_value: str = ""
    # Stored as the dashboard's numeric user id (display hint for assignment).
    assign_to_user_id: Optional[int] = None
    labels_json: str = Field(default="[]")
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
