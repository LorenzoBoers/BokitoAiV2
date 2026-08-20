"""LEARNING layer models.

`Feedback` captures human signals on agent output (thumbs / score / comment).
`EvalScore` stores computed quality and autonomy metrics over a time window
that feed the Cockpit and the recursive guardrail/persona adjustments.
`InboxRule` is the sensing-layer action policy: a per-sender instruction the
platform learns from repeated operator choices on "No reply needed" cards
(auto-close, auto-task, or mute AI for a sender/domain/list).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Feedback(SQLModel, table=True):
    __tablename__ = "feedback_entries"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    subject_type: str = Field(default="message", index=True)  # message | run | decision | signal
    subject_id: str = Field(default="", index=True)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    score: Optional[int] = None  # 1-5
    sentiment: Optional[str] = None  # up | down
    comment: str = ""
    processed: bool = Field(default=False, index=True)
    processed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InboxRule(SQLModel, table=True):
    """Learned or manual per-sender automation for inbound threads.

    Lifecycle: rows start as ``suggested`` (candidates that count consistent
    operator choices), become ``active`` through explicit confirmation (or
    auto-promotion under the autonomous posture), and can be ``paused`` from
    the rules UI without losing their history.
    """

    __tablename__ = "inbox_rules"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    match_type: str = Field(default="sender", index=True)  # sender | domain | list_id
    match_value: str = Field(default="", index=True)  # normalized (lowercase)
    label: str = ""  # human-readable, e.g. "PrepMyMeal newsletter"
    action: str = "auto_close"  # auto_close | auto_task | mute_ai
    status: str = Field(default="suggested", index=True)  # suggested | active | paused
    source: str = "learned"  # learned | manual
    # Consistent operator choices observed while `suggested` (promotion counter).
    observations: int = 0
    # Threads the active rule actually handled.
    hit_count: int = 0
    last_hit_at: Optional[datetime] = None
    created_by_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EvalScore(SQLModel, table=True):
    __tablename__ = "eval_scores"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    scope: str = Field(default="tenant", index=True)  # tenant | agent | run | signal
    scope_id: str = Field(default="", index=True)
    metric: str = Field(default="", index=True)  # autonomy_rate | resolution_quality | csat | escalation_rate
    value: float = 0.0
    sample_size: int = 0
    window_start: Optional[datetime] = None
    window_end: Optional[datetime] = None
    details_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
