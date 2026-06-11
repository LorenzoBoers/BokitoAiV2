import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Notification(SQLModel, table=True):
    __tablename__ = "notifications"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    kind: str = Field(default="status_update")  # status_update | decision_request | proactive
    title: str
    body: str = ""
    status: str = Field(default="unread")  # unread | read | archived
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserNotificationPreference(SQLModel, table=True):
    __tablename__ = "user_notification_preferences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    prefs_json: str = Field(default="[]")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DecisionRequest(SQLModel, table=True):
    __tablename__ = "decision_requests"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    notification_id: Optional[uuid.UUID] = Field(default=None, foreign_key="notifications.id")
    message_id: Optional[uuid.UUID] = Field(default=None, index=True)
    signal_id: Optional[uuid.UUID] = Field(default=None, foreign_key="signals.id", index=True)
    title: str
    summary: str = ""
    status: str = Field(default="awaiting_human")  # awaiting_human | approved | rejected | deferred
    options_json: str = Field(default="[]")
    chosen_option_id: Optional[str] = None
    source_type: str = Field(default="agent")  # agent | email | system
    source_id: Optional[str] = None
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    platform_change_id: Optional[uuid.UUID] = Field(default=None, foreign_key="platform_changes.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
