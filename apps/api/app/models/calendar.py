"""External calendar events and first-class tenant calendars."""

from __future__ import annotations

from app.core.time import utcnow

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class TenantCalendar(SQLModel, table=True):
    """One Google/Outlook calendar synced into the workspace.

    The IntegrationConnection holds OAuth; this row holds sync, access and tags.
    """

    __tablename__ = "tenant_calendars"
    __table_args__ = (
        UniqueConstraint("connection_id", "external_id", name="uq_tenant_calendars_connection_external"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    department_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="departments.id", index=True
    )
    connection_id: uuid.UUID = Field(foreign_key="integration_connections.id", index=True)
    external_id: str = Field(default="", index=True)
    name: str = ""
    color: str = ""
    is_primary: bool = False
    writable: bool = False
    sync_enabled: bool = False
    # Same access_list shape as connections: use < manage. Empty = default.
    access_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CalendarTagLink(SQLModel, table=True):
    """One hashtag on one tenant calendar (filtering in Agenda)."""

    __tablename__ = "calendar_tag_links"

    calendar_id: uuid.UUID = Field(foreign_key="tenant_calendars.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="signal_tags.id", primary_key=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)


class CalendarEvent(SQLModel, table=True):
    """Cached event from an IntegrationConnection (google_calendar / outlook_calendar)."""

    __tablename__ = "calendar_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: uuid.UUID = Field(foreign_key="integration_connections.id", index=True)
    tenant_calendar_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="tenant_calendars.id", index=True
    )
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
    # Set once someone opens the meeting as a conversation.
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    synced_at: datetime = Field(default_factory=utcnow)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
