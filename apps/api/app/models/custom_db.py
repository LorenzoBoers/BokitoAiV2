import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class CustomTable(SQLModel, table=True):
    __tablename__ = "custom_tables"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    organisation_id: int = Field(index=True)
    name: str
    slug: str = Field(index=True)
    description: str = ""
    icon: str = "Database"
    color: str = "#3b82f6"
    is_standard: bool = False
    magic_table_config_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomField(SQLModel, table=True):
    __tablename__ = "custom_fields"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    custom_table_id: int = Field(foreign_key="custom_tables.id", index=True)
    name: str
    slug: str
    field_type: str
    config_json: str = Field(default="{}")
    required: bool = False
    position: int = 0
    default_value_json: str = Field(default="null")
    is_system: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecord(SQLModel, table=True):
    __tablename__ = "custom_records"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    custom_table_id: int = Field(foreign_key="custom_tables.id", index=True)
    data_json: str = Field(default="{}")
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    owner_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomView(SQLModel, table=True):
    __tablename__ = "custom_views"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    custom_table_id: int = Field(foreign_key="custom_tables.id", index=True)
    name: str
    view_type: str = Field(default="grid")
    config_json: str = Field(default="{}")
    position: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecordActivity(SQLModel, table=True):
    __tablename__ = "custom_record_activities"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    record_id: int = Field(foreign_key="custom_records.id", index=True)
    user_id: int = 0
    user_name: str = "System"
    action: str
    field_changes_json: str = Field(default="[]")
    note: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecordComment(SQLModel, table=True):
    __tablename__ = "custom_record_comments"

    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    record_id: int = Field(foreign_key="custom_records.id", index=True)
    user_id: int = 0
    user_name: str = "User"
    content: str
    parent_id: Optional[int] = None
    mentions_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
