from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlmodel import Field, SQLModel


class UsageLedger(SQLModel, table=True):
    __tablename__ = "usage_ledger"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scope: str = Field(default="chat")  # chat | email | workstream | orchestration
    scope_id: Optional[str] = None
    # Fine-grained call classification: chat | embedding | voice_tts | image | …
    call_type: str = Field(default="chat")
    provider: str = ""
    model: str = ""
    # Real provider/model behind a virtual Bokito slug (empty when same as above).
    backing_provider: str = Field(default="")
    backing_model: str = Field(default="")
    # Which key paid for this call: tenant (BYOK) | platform (Bokito, billable) | mock
    key_source: str = Field(default="mock")
    # Hosting region of the provider that processed the call: eu | us | unknown.
    region: str = Field(default="unknown")
    billable: bool = False
    tokens_in: int = 0
    tokens_out: int = 0
    # Raw token kinds (Anthropic cache); tokens_in may be billing-equivalent.
    tokens_in_uncached: int = 0
    tokens_cache_write: int = 0
    tokens_cache_read: int = 0
    # Non-token meters (image count, audio seconds, realtime minutes).
    units: int = 0
    unit_kind: str = Field(default="token")  # token | image | audio_second | realtime_minute | tts_char
    # Provider list cost and customer charge, both in integer micro-USD (1e-6 USD).
    provider_cost_micros: int = 0
    customer_cost_micros: int = 0
    # Legacy rounded cents (customer charge) kept for cockpit/project rollups.
    cost_cents: int = 0
    price_book_id: Optional[UUID] = Field(default=None, foreign_key="price_books.id")
    price_rule_version: int = 0
    agent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agents.id", index=True)
    run_id: Optional[uuid.UUID] = Field(default=None, foreign_key="agent_runs.id", index=True)
    ticket_tag_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="signal_tags.id", index=True
    )
    workstream_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="workstreams.id", index=True
    )
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)


class PushSubscription(SQLModel, table=True):
    __tablename__ = "push_subscriptions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    endpoint: str
    keys_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utcnow)
