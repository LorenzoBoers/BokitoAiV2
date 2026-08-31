"""ModuleInstall: the anchor row for a module on a tenant.

Replaces the old ``Tenant.settings_json.modules`` blob. One row per
tenant + module slug carrying the install lifecycle and operator defaults.
ModuleAgent / ModuleSource / connections all hang off the same slug; this
table is the source of truth for whether that slug is live on the tenant.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class ModuleInstall(SQLModel, table=True):
    __tablename__ = "module_installs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_slug", name="uq_module_install"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    module_slug: str = Field(index=True, max_length=64)

    # not_installed | setup | installed
    install_state: str = Field(default="setup", max_length=16)

    # Tenant-level write switch: propose/apply verbs execute only when this
    # AND the platform write switch are on.
    writes_enabled: bool = Field(default=False)

    # Default registration for multi-connection modules (IntegrationConnection
    # or native McpServer id, stored as string until connections unify).
    default_connection_id: Optional[str] = Field(default=None, max_length=64)
    # JSON {connection_id: company/administration id} operator defaults.
    default_company_json: str = Field(default="{}")
    # JSON {"mode": "all_members"|"selected", "user_ids": [...]}.
    user_access_json: str = Field(default="{}")

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
