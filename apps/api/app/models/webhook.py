"""Outbound webhooks: tenant-configured endpoints + delivery log."""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class WebhookEndpoint(SQLModel, table=True):
    """A tenant-configured HTTPS endpoint that receives signed platform events.

    ``events_json`` holds the subscribed event names (``["*"]`` = all).
    The signing secret is Fernet-encrypted at rest and shown to owners/admins
    so they can verify the ``X-Bokito-Signature`` HMAC.
    """

    __tablename__ = "webhook_endpoints"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    url: str = Field(default="")
    description: str = Field(default="")
    events_json: str = Field(default='["*"]')
    secret_encrypted: str = Field(default="")
    active: bool = Field(default=True)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    last_delivery_at: datetime | None = Field(default=None)
    last_status: str = Field(default="")  # "200" | "failed" | ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WebhookDelivery(SQLModel, table=True):
    """One event delivery attempt-set to one endpoint (pruned to recent rows)."""

    __tablename__ = "webhook_deliveries"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    endpoint_id: uuid.UUID = Field(foreign_key="webhook_endpoints.id", index=True)
    event: str = Field(default="", index=True)
    payload_json: str = Field(default="{}")
    status: str = Field(default="pending", index=True)  # pending | delivered | failed
    status_code: int = Field(default=0)
    attempts: int = Field(default=0)
    error: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    delivered_at: datetime | None = Field(default=None)
