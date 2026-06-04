import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class WorkforceMessage(SQLModel, table=True):
    """Agent communication row for workforce / project hub UI."""

    __tablename__ = "workforce_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    thread_id: str = Field(index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="projects.id", index=True)
    subject: str = ""
    body: str = ""
    message_type: str = Field(default="decision_request", index=True)
    channel: str = Field(default="workforce")
    status: str = Field(default="awaiting_human", index=True)
    payload_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
