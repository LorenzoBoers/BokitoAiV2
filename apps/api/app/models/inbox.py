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
