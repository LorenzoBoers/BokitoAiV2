import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id", index=True)
    title: str = "New conversation"
    audience: str = Field(default="internal")  # internal | external
    channel: str = Field(default="assistant", index=True)
    source_ref: Optional[str] = None
    ai_paused: bool = False
    assigned_user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    last_message_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationMessage(SQLModel, table=True):
    __tablename__ = "conversation_messages"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    conversation_id: uuid.UUID = Field(foreign_key="conversations.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    role: str  # user | assistant | system | tool
    content: str = ""
    attachments_json: str = Field(default="[]")
    metadata_json: str = Field(default="{}")
    certainty: Optional[int] = None
    auto_sent: bool = False
    decision_request_id: Optional[uuid.UUID] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
