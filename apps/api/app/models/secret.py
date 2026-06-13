import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel, UniqueConstraint


class TenantSecret(SQLModel, table=True):
    """Per-tenant encrypted secret (e.g. LLM provider API keys).

    Values are encrypted at rest with the Fernet helper in
    ``app.services.crypto``. Only ``last4`` is ever shown back to the client;
    the raw key is decrypted on the server when resolving the tenant LLM
    configuration. One row per ``(tenant_id, provider)``.
    """

    __tablename__ = "tenant_secrets"
    __table_args__ = (UniqueConstraint("tenant_id", "provider", name="uq_tenant_secret_provider"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    provider: str = Field(index=True)  # anthropic | openai
    encrypted_value: str = Field(default="")
    last4: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
