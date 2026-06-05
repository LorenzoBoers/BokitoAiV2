import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AgendaCalendar(SQLModel, table=True):
    __tablename__ = "agenda_calendars"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str
    kind: str = Field(default="user")  # user | orchestrator | team | external
    color: str = Field(default="#6366f1")
    is_system: bool = False
    external_provider: Optional[str] = None  # google | outlook
    external_connection_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="integration_connections.id"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgendaEvent(SQLModel, table=True):
    __tablename__ = "agenda_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    calendar_id: uuid.UUID = Field(foreign_key="agenda_calendars.id", index=True)
    kind: str = Field(default="user")  # user | orchestrator | implementation | external

    title: str
    description: str = ""
    location: str = ""
    starts_at: datetime
    ends_at: Optional[datetime] = None
    all_day: bool = False
    timezone: str = Field(default="UTC")

    status: str = Field(default="confirmed")
    priority: str = Field(default="normal")

    assigned_to_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")

    recurrence_freq: str = Field(default="none")  # none | hourly | daily | weekly | monthly
    recurrence_interval: int = Field(default=1)
    recurrence_until: Optional[datetime] = None

    prompt: str = ""
    agent_role: str = Field(default="orchestra")
    enabled: bool = True
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None

    external_id: Optional[str] = None
    external_etag: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
