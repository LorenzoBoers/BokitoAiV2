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
    sync_window_days: int | None = None,
) -> str | None:
    """Return a real authorize URL, or None when the provider is unconfigured.

    `tenant_id` is None for pre-auth login flows (`flow="login"`); those use
    identity-only scopes instead of the mailbox scopes.
    `sync_window_days` is stored on the state for email installs so the callback
    can run the first Inbox sync with the operator's chosen backfill window.
    """
    if not oauth_providers.is_configured(provider):
        return None
    redirect_uri = get_settings().oauth_redirect_uri
    state = secrets.token_urlsafe(32)
    context: dict[str, Any] = {}
    if flow == "email" and sync_window_days is not None:
        from app.services.email_sync import clamp_sync_window_days

        context["sync_window_days"] = clamp_sync_window_days(sync_window_days)
    session.add(
        OAuthState(
            state=state,
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            flow=flow,
            return_url=return_url,
            redirect_uri=redirect_uri,
            context_json=json.dumps(context) if context else "",
        )
    )
    await session.commit()
    scopes = None
    prompt = None
    if flow in ("login", "link") and provider == oauth_providers.MICROSOFT:
        scopes = oauth_providers.MICROSOFT_SSO_SCOPES
    elif flow in ("login", "link") and provider == oauth_providers.GOOGLE:
        scopes = oauth_providers.GOOGLE_SSO_SCOPES
        prompt = "select_account"
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
    if flow in ("login", "link"):
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
    *,
    sync_window_days: int | None = None,
) -> None:
    """Store OAuth tokens and complete install only after the first Inbox sync."""
    from app.services.crypto import set_connection_credentials
    from app.services.email_sync import (
        DEFAULT_SYNC_WINDOW_DAYS,
        clear_sync_pause,
        set_account_sync_window,
        sync_account,
    )

    account = await ensure_email_account(session, tenant_id, provider, email)
    creds = _token_credentials(tokens)
    set_connection_credentials(account, creds)
    account.is_enabled = True
    window = sync_window_days if sync_window_days is not None else DEFAULT_SYNC_WINDOW_DAYS
    set_account_sync_window(account, window)
    # Clear prior sync markers so re-connect must prove first sync again.
    try:
        settings = json.loads(account.settings_json or "{}")
    except (json.JSONDecodeError, TypeError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    settings.pop("last_sync_at", None)
    clear_sync_pause(settings)
    account.settings_json = json.dumps(settings)
    session.add(account)
    await session.commit()
    await session.refresh(account)

    result = await sync_account(session, account)
    status = str(result.get("status") or "")
    if status != "ok":
        await session.refresh(account)
        try:
            settings = json.loads(account.settings_json or "{}")
        except (json.JSONDecodeError, TypeError):
            settings = {}
        detail = str(
            (settings.get("last_error") if isinstance(settings, dict) else None)
            or f"First mailbox sync failed ({status or 'unknown'})."
        ).strip()
        # Roll back tokens so the row cannot linger as Connecting.
        set_connection_credentials(account, {})
        account.is_enabled = False
        session.add(account)
        await session.commit()
        raise RuntimeError(detail)

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="email:mailbox_connected",
        actor_type="user",
        resource_type="channel_account",
        resource_id=account.id,
        payload={"address": email, "provider": provider, "synced": result.get("synced")},
    )


async def _calendar_account_target(
    session: AsyncSession, tenant_id: UUID, provider: str, email: str
) -> tuple[UUID | None, bool]:
    """(connection to refresh, create_new) for a calendar sign-in."""
    rows = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == provider,
                IntegrationConnection.status == "active",
            )
        )
    ).scalars().all()
    wanted = email.strip().lower()
    for conn in rows:
        try:
            meta = json.loads(conn.metadata_json or "{}")
        except (TypeError, json.JSONDecodeError):
            meta = {}
        known = str((meta or {}).get("email") or "").strip().lower()
        if wanted and known == wanted:
            return conn.id, False
        if not known:
            # A connection that never finished sign-in is reused, not duplicated.
            return conn.id, False
    return None, bool(rows)


async def _store_integration_credentials(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    identity: dict[str, Any],
    tokens: dict[str, Any],
    *,
    return_url: str = "",
    user_id: UUID | None = None,
) -> bool:
    """Persist tokens; True when they landed on an already-connected account."""
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
        if provider in oauth_providers.CALENDAR_PROVIDERS and connection_id is None:
            # One connection per calendar account: signing in again with the same
            # account refreshes it; another account becomes its own connection.
            connection_id, create_new = await _calendar_account_target(
                session, tenant_id, provider, str(identity.get("email") or "")
            )
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
    from app.services.crypto import set_connection_credentials

    set_connection_credentials(conn, creds)
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
    instance_key = ""
    if provider == "moneybird":
        from datetime import datetime, timezone

        from app.services.connection_instance import instance_key_for
        from app.services.moneybird import list_administrations, validate_credentials

        check = await validate_credentials(creds)
        if check.get("ok") and not check.get("note"):
            meta["last_verified_at"] = datetime.now(timezone.utc).isoformat()
            try:
                admins = await list_administrations(creds)
                if admins:
                    meta["identity"] = str(admins[0].get("name") or admins[0].get("id") or "")
                    instance_key = instance_key_for("moneybird", administrations=admins)
            except Exception:
                pass
        else:
            meta["verify_error"] = str(
                check.get("error") or check.get("note") or "Moneybird verification failed"
            )
    if provider == oauth_providers.ALPACA:
        from datetime import datetime, timezone

        from app.services.alpaca import (
            auth_payload_from_oauth_tokens,
            validate_credentials,
        )
        from app.services.integrations_platform import install_mcp

        # Default paper until the operator flips the connection; Connect tokens
        # work on both hosts (see Alpaca OAuth docs).
        paper = True
        mcp_auth = auth_payload_from_oauth_tokens(tokens, paper=paper)
        check = await validate_credentials(mcp_auth)
        if check.get("ok") and not check.get("note"):
            meta["last_verified_at"] = datetime.now(timezone.utc).isoformat()
            meta["identity"] = str(check.get("identity") or identity.get("login") or "")
            meta["auth_mode"] = "oauth"
            meta["paper"] = paper
            try:
                await install_mcp(
                    session,
                    tenant_id,
                    provider="alpaca_mcp",
                    api_key="",
                    auth=mcp_auth,
                    auth_type="oauth2",
                )
            except Exception:
                logger.exception("Alpaca Connect MCP install failed after OAuth")
                meta["verify_error"] = "oauth_ok_mcp_install_failed"
        else:
            meta["verify_error"] = str(
                check.get("error") or check.get("note") or "Alpaca verification failed"
            )
    conn.metadata_json = json.dumps(meta)
    conn.status = "active"
    session.add(conn)
    if provider in oauth_providers.CALENDAR_PROVIDERS:
        from app.services.calendar_sync import apply_default_access

        await apply_default_access(session, conn, user_id)
    reused = False
    if instance_key:
        from app.services.connection_instance import claim_instance_key

        survivor = await claim_instance_key(session, tenant_id, conn, instance_key)
        reused = survivor.id != conn.id
        conn = survivor
    from app.services.module_attach import maybe_auto_attach_from_return_url

    await maybe_auto_attach_from_return_url(session, tenant_id, conn, return_url)
    await session.commit()
    if provider in oauth_providers.CALENDAR_PROVIDERS:
        try:
            from app.services.calendar_sync import sync_connection

            await sync_connection(session, conn)
        except Exception:
            logger.exception("initial calendar sync failed for %s", provider)
    return reused


async def _complete_sso_login(
    session: AsyncSession,
    *,
    return_url: str,
    provider: str,
    identity: dict[str, Any],
) -> tuple[str, str | None]:
    """Provision the user and mint a refresh session for an SSO login."""
    from app.services.auth import create_refresh_session
    from app.services.user_identities import resolve_user_for_sso

    email = str(identity.get("email") or "").strip().lower()
    subject = str(identity.get("subject") or "").strip()
    if not email and not subject:
        return _error_redirect(return_url, "login", provider, "no_email"), None
    try:
        user = await resolve_user_for_sso(
            session,
            provider=provider,
            subject=subject,
            email=email,
            name=str(identity.get("name") or ""),
        )
    except ValueError as exc:
        reason = str(exc) if str(exc) in {"no_email", "subject_taken"} else "provisioning_failed"
        if reason == "no_email":
            return _error_redirect(return_url, "login", provider, "no_email"), None
        logger.exception("SSO provisioning failed for %s", email or subject)
        return _error_redirect(return_url, "login", provider, "provisioning_failed"), None
    except Exception:
        logger.exception("SSO provisioning failed for %s", email or subject)
        return _error_redirect(return_url, "login", provider, "provisioning_failed"), None
    refresh_token, _ = await create_refresh_session(session, user.id)
    url = _append_query(
        return_url or get_settings().public_app_url, {"sso": "connected"}
    )
    return url, refresh_token


async def _complete_sso_link(
    session: AsyncSession,
    *,
    return_url: str,
    provider: str,
    user_id: UUID,
    identity: dict[str, Any],
) -> tuple[str, str | None]:
    """Attach an IdP identity to an already authenticated user."""
    from app.models.auth import User
    from app.services.user_identities import upsert_identity

    user = await session.get(User, user_id)
    if user is None:
        return _error_redirect(return_url, "link", provider, "provisioning_failed"), None

    email = str(identity.get("email") or "").strip().lower()
    subject = str(identity.get("subject") or "").strip()
    if not subject:
        return _error_redirect(return_url, "link", provider, "no_email"), None
    if email and email != (user.email or "").strip().lower():
        return _error_redirect(return_url, "link", provider, "email_mismatch"), None
    if not email:
        # Require email so operators see which address was linked.
        return _error_redirect(return_url, "link", provider, "no_email"), None

    try:
        await upsert_identity(
            session,
            user_id=user.id,
            provider=provider,
            subject=subject,
            email=email,
            commit=True,
        )
    except ValueError as exc:
        reason = str(exc)
        if reason == "subject_taken":
            return _error_redirect(return_url, "link", provider, "subject_taken"), None
        return _error_redirect(return_url, "link", provider, "provisioning_failed"), None

    if not user.email_verified:
        user.email_verified = True
        session.add(user)
        await session.commit()

    url = _append_query(
        return_url or get_settings().public_app_url, {"sso": "linked"}
    )
    return url, None


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
    link_user_id = row.user_id
    redirect_uri = row.redirect_uri
    expires_at = row.expires_at
    try:
        context = json.loads(row.context_json or "{}")
    except (json.JSONDecodeError, TypeError):
        context = {}
    if not isinstance(context, dict):
        context = {}
    sync_window_days = context.get("sync_window_days")
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

    if flow == "link":
        if link_user_id is None:
            return _error_redirect(return_url, "link", provider, "provisioning_failed"), None
        return await _complete_sso_link(
            session,
            return_url=return_url,
            provider=provider,
            user_id=link_user_id,
            identity=identity,
        )

    try:
        if flow == "email":
            email = identity.get("email") or f"{provider}@bokito.local"
            await _store_email_credentials(
                session,
                tenant_id,
                provider,
                email,
                tokens,
                sync_window_days=int(sync_window_days)
                if sync_window_days is not None
                else None,
            )
        else:
            reused = await _store_integration_credentials(
                session,
                tenant_id,
                provider,
                identity,
                tokens,
                return_url=return_url,
                user_id=link_user_id,
            )
    except Exception as storage_exc:
        logger.exception("OAuth credential storage failed for provider=%s", provider)
        reason = "sync_failed" if flow == "email" else "storage_failed"
        # Prefer a short operator-facing reason when first sync failed.
        detail = str(storage_exc).strip()
        if flow == "email" and detail:
            return _error_redirect(return_url, flow, provider, reason), None
        return _error_redirect(return_url, flow, provider, reason), None

    params = _success_params(flow, provider)
    if flow != "email" and reused:
        params["connection_reused"] = "1"
    return (
        _append_query(return_url or get_settings().public_app_url, params),
        None,
    )
