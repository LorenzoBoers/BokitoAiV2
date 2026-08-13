"""Short-lived OAuth state for the authorization-code flow (CSRF + context)."""

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Field, SQLModel


def _default_expiry() -> datetime:
    return datetime.utcnow() + timedelta(minutes=15)


class OAuthState(SQLModel, table=True):
    __tablename__ = "oauth_states"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # Opaque CSRF token sent to the provider and returned on the callback.
    state: str = Field(index=True, unique=True)
    # Null for pre-auth login flows (no tenant exists before SSO completes).
    tenant_id: Optional[uuid.UUID] = Field(default=None, foreign_key="tenants.id", index=True)
    user_id: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    # Provider slug (github | gmail | outlook | ...).
    provider: str = ""
    # Which surface initiated the flow: "email" | "github" | "integration" | "login".
    flow: str = "integration"
    # Where to send the browser back to after the callback completes.
    return_url: str = ""
    redirect_uri: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(default_factory=_default_expiry)
