import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class UsageLedger(SQLModel, table=True):
    __tablename__ = "usage_ledger"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scope: str = Field(default="chat")  # chat | email | workstream
    scope_id: Optional[str] = None
    provider: str = ""
    model: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    cost_cents: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PushSubscription(SQLModel, table=True):
    __tablename__ = "push_subscriptions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    endpoint: str
    keys_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
