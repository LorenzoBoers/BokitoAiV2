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
    tenant_id: UUID | None,
    user_id: UUID | None,
    provider: str,
    flow: str,
    return_url: str,
) -> str | None:
    """Return a real authorize URL, or None when the provider is unconfigured.

    `tenant_id` is None for pre-auth login flows (`flow="login"`); those use
    identity-only scopes instead of the mailbox scopes.
    """
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
    scopes = None
    prompt = None
    if flow == "login" and provider == oauth_providers.MICROSOFT:
        scopes = oauth_providers.MICROSOFT_SSO_SCOPES
    if flow == "email" and provider == oauth_providers.MICROSOFT:
        prompt = "select_account"
    return oauth_providers.build_authorize_url(
        provider, state=state, redirect_uri=redirect_uri, scopes=scopes, prompt=prompt
    )


def _success_params(flow: str, provider: str) -> dict[str, str]:
    if flow == "email":
        return {"oauth_provider": provider, "oauth_status": "connected"}
    if flow == "github":
        return {"github": "connected"}
    return {"integration": "connected", "provider": provider}


def _error_redirect(return_url: str, flow: str, provider: str, reason: str) -> str:
    if flow == "login":
        return _append_query(
            return_url or get_settings().public_app_url, {"sso_error": reason}
        )
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
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="email:mailbox_connected",
        actor_type="user",
        resource_type="channel_account",
        resource_id=account.id,
        payload={"address": email, "provider": provider},
    )


async def _store_integration_credentials(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    identity: dict[str, Any],
    tokens: dict[str, Any],
    *,
    return_url: str = "",
) -> None:
    if provider == oauth_providers.GITHUB:
        conn = await ensure_github_connection(
            session, tenant_id, login=identity.get("login") or "github-user"
        )
    else:
        from app.services.module_connections import (
            oauth_connection_id_from_return_url,
            oauth_create_new_from_return_url,
        )

        connection_id = oauth_connection_id_from_return_url(return_url)
        create_new = oauth_create_new_from_return_url(return_url)
        serialized = await ensure_oauth_connection(
            session,
            tenant_id,
            provider,
            connection_id=connection_id,
            create_new=create_new and connection_id is None,
        )
        result = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == UUID(serialized["id"])
            )
        )
        conn = result.scalar_one()
    creds = _token_credentials(tokens)
    conn.credentials_json = json.dumps(creds)
    meta = json.loads(conn.metadata_json or "{}")
    if not isinstance(meta, dict):
        meta = {}
    if identity.get("login"):
        meta["github_login"] = identity["login"]
        meta["external_account_id"] = identity["login"]
    if identity.get("email"):
        meta["email"] = identity["email"]
        meta["identity"] = identity["email"]
    meta.pop("mock", None)
    meta.pop("verify_error", None)
    if provider == "moneybird":
        from datetime import datetime, timezone

        from app.services.moneybird import list_administrations, validate_credentials

        check = await validate_credentials(creds)
        if check.get("ok") and not check.get("note"):
            meta["last_verified_at"] = datetime.now(timezone.utc).isoformat()
            try:
                admins = await list_administrations(creds)
                if admins:
                    meta["identity"] = str(admins[0].get("name") or admins[0].get("id") or "")
            except Exception:
                pass
        else:
            meta["verify_error"] = str(
                check.get("error") or check.get("note") or "Moneybird verification failed"
            )
    conn.metadata_json = json.dumps(meta)
    conn.status = "active"
    session.add(conn)
    await session.commit()
    if provider in oauth_providers.CALENDAR_PROVIDERS:
        try:
            from app.services.calendar_sync import sync_connection

            await sync_connection(session, conn)
        except Exception:
            logger.exception("initial calendar sync failed for %s", provider)


async def _complete_sso_login(
    session: AsyncSession,
    *,
    return_url: str,
    provider: str,
    identity: dict[str, Any],
) -> tuple[str, str | None]:
    """Provision the user and mint a refresh session for an SSO login."""
    from app.services.auth import create_refresh_session
    from app.services.sso import provision_sso_user

    email = str(identity.get("email") or "").strip().lower()
    if not email:
        return _error_redirect(return_url, "login", provider, "no_email"), None
    try:
        user, _tenant = await provision_sso_user(
            session, email=email, name=str(identity.get("name") or "")
        )
    except Exception:
        logger.exception("SSO provisioning failed for %s", email)
        return _error_redirect(return_url, "login", provider, "provisioning_failed"), None
    refresh_token, _ = await create_refresh_session(session, user.id)
    url = _append_query(
        return_url or get_settings().public_app_url, {"sso": "connected"}
    )
    return url, refresh_token


async def complete_oauth(
    session: AsyncSession,
    *,
    state: str,
    code: str | None,
    error: str | None = None,
) -> tuple[str, str | None]:
    """Handle the OAuth callback.

    Returns (redirect_url, refresh_token). The refresh token is only set for
    SSO login flows; the callback route turns it into the session cookie.
    """
    result = await session.execute(select(OAuthState).where(OAuthState.state == state))
    row = result.scalar_one_or_none()
    if not row:
        return (
            _append_query(
                get_settings().public_app_url,
                {"oauth_status": "error", "oauth_error": "invalid_state"},
            ),
            None,
        )
    # Capture every field before delete+commit: expired ORM attributes on an
    # async session cannot be lazily refreshed afterwards.
    return_url, flow, provider = row.return_url, row.flow, row.provider
    tenant_id = row.tenant_id
    redirect_uri = row.redirect_uri
    expires_at = row.expires_at
    # One-shot: consume the state immediately.
    await session.delete(row)
    await session.commit()

    if error:
        return _error_redirect(return_url, flow, provider, error), None
    if expires_at < datetime.utcnow():
        return _error_redirect(return_url, flow, provider, "expired_state"), None
    if not code:
        return _error_redirect(return_url, flow, provider, "missing_code"), None

    try:
        tokens = await oauth_providers.exchange_code(
            provider, code=code, redirect_uri=redirect_uri
        )
        identity = await oauth_providers.fetch_identity(
            provider, tokens.get("access_token", "")
        )
    except Exception:
        logger.exception("OAuth token exchange failed for provider=%s", provider)
        return _error_redirect(return_url, flow, provider, "token_exchange_failed"), None

    if flow == "login":
        return await _complete_sso_login(
            session, return_url=return_url, provider=provider, identity=identity
        )

    try:
        if flow == "email":
            email = identity.get("email") or f"{provider}@bokito.local"
            await _store_email_credentials(session, tenant_id, provider, email, tokens)
        else:
            await _store_integration_credentials(
                session,
                tenant_id,
                provider,
                identity,
                tokens,
                return_url=return_url,
            )
    except Exception:
        logger.exception("OAuth credential storage failed for provider=%s", provider)
        return _error_redirect(return_url, flow, provider, "storage_failed"), None

    return (
        _append_query(
            return_url or get_settings().public_app_url, _success_params(flow, provider)
        ),
        None,
    )
