"""Orchestrates the real OAuth authorization-code flow end to end.

`start_real_oauth` persists a CSRF state row and returns the provider's authorize
URL (or None when the provider is not configured, so the caller falls back to the
dev mock flow). `complete_oauth` is invoked by the single callback route: it
exchanges the code for tokens, stores them on the right entity, and returns the
dashboard URL to redirect the browser back to.
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.channel import ChannelAccount
from app.models.integration import IntegrationConnection
from app.models.oauth_state import OAuthState
from app.services import oauth_providers
from app.services.integrations_platform import (
    _append_query,
    ensure_email_account,
    ensure_github_connection,
    ensure_oauth_connection,
)

logger = logging.getLogger(__name__)


async def start_real_oauth(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    provider: str,
    flow: str,
    return_url: str,
) -> str | None:
    """Return a real authorize URL, or None when the provider is unconfigured."""
    if not oauth_providers.is_configured(provider):
        return None
    redirect_uri = get_settings().oauth_redirect_uri
    state = secrets.token_urlsafe(32)
    session.add(
        OAuthState(
            state=state,
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            flow=flow,
            return_url=return_url,
            redirect_uri=redirect_uri,
        )
    )
    await session.commit()
    return oauth_providers.build_authorize_url(
        provider, state=state, redirect_uri=redirect_uri
    )


def _success_params(flow: str, provider: str) -> dict[str, str]:
    if flow == "email":
        return {"oauth_provider": provider, "oauth_status": "connected"}
    if flow == "github":
        return {"github": "connected"}
    return {"integration": "connected", "provider": provider}


def _error_redirect(return_url: str, flow: str, provider: str, reason: str) -> str:
    params = {"oauth_status": "error", "oauth_error": reason}
    if flow != "email":
        params["provider"] = provider
    return _append_query(return_url or get_settings().public_app_url, params)


def _token_credentials(tokens: dict[str, Any]) -> dict[str, Any]:
    creds: dict[str, Any] = {
        "access_token": tokens.get("access_token", ""),
        "token_type": tokens.get("token_type", "Bearer"),
        "scope": tokens.get("scope", ""),
    }
    if tokens.get("refresh_token"):
        creds["refresh_token"] = tokens["refresh_token"]
    expires_in = tokens.get("expires_in")
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        creds["expires_at"] = (
            datetime.utcnow() + timedelta(seconds=int(expires_in))
        ).isoformat()
    return creds


async def _store_email_credentials(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    email: str,
    tokens: dict[str, Any],
) -> None:
    account = await ensure_email_account(session, tenant_id, provider, email)
    creds = _token_credentials(tokens)
    account.credentials_json = json.dumps(creds)
    account.is_enabled = True
    session.add(account)
    await session.commit()


async def _store_integration_credentials(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    identity: dict[str, Any],
    tokens: dict[str, Any],
) -> None:
    if provider == oauth_providers.GITHUB:
        conn = await ensure_github_connection(
            session, tenant_id, login=identity.get("login") or "github-user"
        )
    else:
        serialized = await ensure_oauth_connection(session, tenant_id, provider)
        result = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == UUID(serialized["id"])
            )
        )
        conn = result.scalar_one()
    creds = _token_credentials(tokens)
    conn.credentials_json = json.dumps(creds)
    meta = json.loads(conn.metadata_json or "{}")
    if identity.get("login"):
        meta["github_login"] = identity["login"]
        meta["external_account_id"] = identity["login"]
    if identity.get("email"):
        meta["email"] = identity["email"]
    conn.metadata_json = json.dumps(meta)
    conn.status = "active"
    session.add(conn)
    await session.commit()


async def complete_oauth(
    session: AsyncSession,
    *,
    state: str,
    code: str | None,
    error: str | None = None,
) -> str:
    """Handle the OAuth callback; returns the dashboard URL to redirect to."""
    result = await session.execute(select(OAuthState).where(OAuthState.state == state))
    row = result.scalar_one_or_none()
    if not row:
        return _append_query(
            get_settings().public_app_url, {"oauth_status": "error", "oauth_error": "invalid_state"}
        )
    return_url, flow, provider = row.return_url, row.flow, row.provider
    # One-shot: consume the state immediately.
    await session.delete(row)
    await session.commit()

    if error:
        return _error_redirect(return_url, flow, provider, error)
    if row.expires_at < datetime.utcnow():
        return _error_redirect(return_url, flow, provider, "expired_state")
    if not code:
        return _error_redirect(return_url, flow, provider, "missing_code")

    try:
        tokens = await oauth_providers.exchange_code(
            provider, code=code, redirect_uri=row.redirect_uri
        )
        identity = await oauth_providers.fetch_identity(
            provider, tokens.get("access_token", "")
        )
    except Exception:
        logger.exception("OAuth token exchange failed for provider=%s", provider)
        return _error_redirect(return_url, flow, provider, "token_exchange_failed")

    try:
        if flow == "email":
            email = identity.get("email") or f"{provider}@bokito.local"
            await _store_email_credentials(session, row.tenant_id, provider, email, tokens)
        else:
            await _store_integration_credentials(
                session, row.tenant_id, provider, identity, tokens
            )
    except Exception:
        logger.exception("OAuth credential storage failed for provider=%s", provider)
        return _error_redirect(return_url, flow, provider, "storage_failed")

    return _append_query(
        return_url or get_settings().public_app_url, _success_params(flow, provider)
    )
