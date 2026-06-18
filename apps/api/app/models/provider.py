"""Per-tenant LLM provider connections and model catalog."""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, UniqueConstraint


class ProviderConnection(SQLModel, table=True):
    """Tenant-owned provider credentials (BYOK).

    Each row stores an encrypted API key and optional custom base URL for
    OpenAI-compatible endpoints (OpenRouter, Groq, Ollama, etc.).
    """

    __tablename__ = "provider_connections"
    __table_args__ = (UniqueConstraint("tenant_id", "label", name="uq_provider_conn_tenant_label"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    provider_type: str = Field(index=True)  # anthropic | openai | openai_compatible
    label: str = Field(default="")
    base_url: str = Field(default="")
    encrypted_value: str = Field(default="")
    last4: str = Field(default="")
    enabled: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TenantModel(SQLModel, table=True):
    """Tenant-scoped model row linked to a provider connection.

    Agents reference models by ``slug`` (unique per tenant). When ``enabled`` is
    false the model cannot be assigned to agents or used as a default.
    """

    __tablename__ = "tenant_models"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_tenant_model_slug"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    connection_id: uuid.UUID = Field(foreign_key="provider_connections.id", index=True)
    slug: str = Field(index=True)
    model_id: str = Field(default="")
    display_name: str = Field(default="")
    kind: str = Field(default="chat", index=True)  # chat | embedding
    enabled: bool = Field(default=True)
    supports_tools: bool = Field(default=True)
    supports_vision: bool = Field(default=False)
    context_window: int = Field(default=0)
    input_cost_per_mtok_cents: int = Field(default=0)
    output_cost_per_mtok_cents: int = Field(default=0)
    is_default_chat: bool = Field(default=False)
    is_default_embedding: bool = Field(default=False)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
