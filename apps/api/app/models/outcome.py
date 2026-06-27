"""Tenant-scoped operational outcomes (trades, session summaries, errors)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

OUTCOME_SOURCES = ("trading_webhook", "mcp_poll", "agent")
OUTCOME_KINDS = ("trade_closed", "session_summary", "setup_skipped", "error")


class OperationalOutcome(SQLModel, table=True):
    __tablename__ = "operational_outcomes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    source: str = Field(default="trading_webhook", index=True)
    kind: str = Field(default="session_summary", index=True)
    subtype: str = Field(default="", index=True)
    payload_json: str = Field(default="{}")
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
