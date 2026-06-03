import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class InboxSettings(SQLModel, table=True):
    __tablename__ = "inbox_settings"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True, unique=True)
    autonomous_reply: bool = False
    certainty_threshold: int = Field(default=7, ge=1, le=10)
    rules_text: str = ""
    labeling_enabled: bool = True
    config_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MessageFeedback(SQLModel, table=True):
    __tablename__ = "message_feedback"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    message_id: uuid.UUID = Field(foreign_key="conversation_messages.id", index=True)
    score: int = Field(ge=1, le=5)
    comment: str = ""
    author_user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackQueueItem(SQLModel, table=True):
    __tablename__ = "feedback_queue_items"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    message_feedback_id: uuid.UUID = Field(foreign_key="message_feedback.id", index=True)
    status: str = Field(default="pending")  # pending | picked | done
    created_at: datetime = Field(default_factory=datetime.utcnow)
