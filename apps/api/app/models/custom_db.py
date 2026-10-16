"""Retired: custom_* tables dropped in Alembic 101.

The builder router is unmounted. Stubs remain so dead service/router modules
still import without registering SQLAlchemy tables.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class CustomTable(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    organisation_id: int = 0
    name: str = ""
    slug: str = ""
    description: str = ""
    icon: str = "Database"
    color: str = "#3b82f6"
    is_standard: bool = False
    magic_table_config_json: str = "{}"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomField(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    custom_table_id: int = 0
    name: str = ""
    slug: str = ""
    field_type: str = "text"
    options_json: str = "[]"
    required: bool = False
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecord(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    custom_table_id: int = 0
    data_json: str = "{}"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomView(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    custom_table_id: int = 0
    name: str = ""
    config_json: str = "{}"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecordActivity(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    custom_record_id: int = 0
    kind: str = ""
    payload_json: str = "{}"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CustomRecordComment(SQLModel):
    id: Optional[int] = None
    tenant_id: uuid.UUID | None = None
    custom_record_id: int = 0
    body: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
