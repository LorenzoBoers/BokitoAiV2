import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class UsageLedger(SQLModel, table=True):
    __tablename__ = "usage_ledger"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scope: str = Field(default="chat")  # chat | email | workstream | orchestration
    scope_id: Optional[str] = None
    # Fine-grained call classification: chat | embedding | triage | eval | compaction | orchestration
    call_type: str = Field(default="chat")
    provider: str = ""
    model: str = ""
    # Which key paid for this call: tenant (BYOK) | platform (Bokito, billable) | mock
    key_source: str = Field(default="mock")
    billable: bool = False
    tokens_in: int = 0
    tokens_out: int = 0
    # Provider list cost and customer charge, both in integer micro-USD (1e-6 USD).
    provider_cost_micros: int = 0
    customer_cost_micros: int = 0
    # Legacy rounded cents (customer charge) kept for cockpit/project rollups.
    cost_cents: int = 0
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_runs.id", index=True)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PushSubscription(SQLModel, table=True):
    __tablename__ = "push_subscriptions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    endpoint: str
    keys_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
