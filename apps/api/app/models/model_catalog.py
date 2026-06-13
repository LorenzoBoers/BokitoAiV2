import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, UniqueConstraint


class ModelCatalog(SQLModel, table=True):
    """Platform-global catalog of supported LLM/embedding models.

    Staff-managed. Tenants choose among ``enabled`` rows and set defaults;
    agents reference a row by ``slug``. Pricing is the provider list price in
    integer cents per 1,000,000 tokens and drives metering + resale cost.
    """

    __tablename__ = "model_catalog"
    __table_args__ = (UniqueConstraint("slug", name="uq_model_catalog_slug"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(index=True)  # stable id, e.g. "claude-sonnet-4"
    provider: str = Field(index=True)  # anthropic | openai
    kind: str = Field(default="chat", index=True)  # chat | embedding
    model_id: str = ""  # real provider API string, e.g. "claude-sonnet-4-20250514"
    display_name: str = ""
    context_window: int = 0
    input_cost_per_mtok_cents: int = 0
    output_cost_per_mtok_cents: int = 0
    supports_tools: bool = True
    supports_vision: bool = False
    enabled: bool = True
    is_default_chat: bool = False
    is_default_embedding: bool = False
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PlatformSecret(SQLModel, table=True):
    """Platform-global (Bokito) fallback API key per provider, encrypted.

    Used when a tenant has no own key (BYOK). Usage on platform keys is
    billable (token resale). One row per provider.
    """

    __tablename__ = "platform_secrets"
    __table_args__ = (UniqueConstraint("provider", name="uq_platform_secret_provider"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    provider: str = Field(index=True)  # anthropic | openai
    encrypted_value: str = Field(default="")
    last4: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PlatformSetting(SQLModel, table=True):
    """Platform-global key/value config (staff-managed), e.g. resale markup."""

    __tablename__ = "platform_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_platform_setting_key"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    key: str = Field(index=True)
    value: str = Field(default="")
    updated_at: datetime = Field(default_factory=datetime.utcnow)
