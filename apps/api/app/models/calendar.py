"""External calendar events synced from Google Calendar / Outlook."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class CalendarEvent(SQLModel, table=True):
    """Cached event from an IntegrationConnection (google_calendar / outlook_calendar)."""

    __tablename__ = "calendar_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: uuid.UUID = Field(foreign_key="integration_connections.id", index=True)
    provider: str = Field(default="", index=True)  # google_calendar | outlook_calendar
    external_id: str = Field(default="", index=True)
    calendar_id: str = Field(default="primary")
    calendar_name: str = ""
    title: str = ""
    description: str = ""
    location: str = ""
    start_at: datetime = Field(index=True)
    end_at: datetime = Field(index=True)
    all_day: bool = False
    status: str = Field(default="confirmed")  # confirmed | tentative | cancelled
    html_link: str = ""
    attendees_json: str = Field(default="[]")
    metadata_json: str = Field(default="{}")
    synced_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
