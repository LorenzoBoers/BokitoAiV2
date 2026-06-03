import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class ActionPolicy(SQLModel, table=True):
    __tablename__ = "action_policies"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True, unique=True)
    mode: str = Field(default="whitelist")  # manual | whitelist | yolo
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ActionWhitelistEntry(SQLModel, table=True):
    __tablename__ = "action_whitelist_entries"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    action_type: str = Field(index=True)
    scope_signature: str = Field(default="*")
    created_by: uuid.UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AssistantPersona(SQLModel, table=True):
    __tablename__ = "assistant_personas"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True, unique=True)
    tone: str = ""
    do_text: str = ""
    dont_text: str = ""
    escalation_prefs_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
