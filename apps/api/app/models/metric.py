"""Custom tenant KPIs shown on the Cockpit next to the built-in cards.

`CustomMetric` is the definition (label, unit, optional target); every
observation lands as a `CustomMetricPoint` so the Cockpit can show the latest
value plus its delta, and agents can append values over time via the
`record_metric` tool.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

METRIC_UNITS = ("number", "percent", "currency", "duration", "count")


class CustomMetric(SQLModel, table=True):
    __tablename__ = "custom_metrics"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Stable slug agents address the metric by (e.g. "mrr", "open_tickets").
    key: str = Field(default="", index=True)
    label: str = ""
    description: str = ""
    unit: str = "number"  # number | percent | currency | duration | count
    target: Optional[float] = None
    sort_order: int = 0
    created_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomMetricPoint(SQLModel, table=True):
    __tablename__ = "custom_metric_points"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    metric_id: uuid.UUID = Field(foreign_key="custom_metrics.id", index=True)
    value: float = 0.0
    note: str = ""
    source: str = "user"  # agent | user | system
    # Who/what recorded it (user id or agent id as string) for audit trails.
    recorded_by: str = ""
    recorded_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
