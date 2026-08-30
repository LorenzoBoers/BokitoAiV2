"""Real OAuth2 authorization-code helpers for GitHub, Google and Microsoft.

Email uses gmail/outlook; calendars use google_calendar/outlook_calendar.
Each provider is "configured" only when its client id + secret are present in
settings. Callers fall back to the dev mock flow when not configured.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

GITHUB = "github"
GOOGLE = "gmail"
MICROSOFT = "outlook"
MONEYBIRD = "moneybird"
GOOGLE_CALENDAR = "google_calendar"
OUTLOOK_CALENDAR = "outlook_calendar"

_GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]
_GOOGLE_CALENDAR_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]
_MICROSOFT_SCOPES = [
    "offline_access",
    "openid",
    "email",
    "profile",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
]
_MICROSOFT_CALENDAR_SCOPES = [
    "offline_access",
    "openid",
    "email",
    "profile",
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "https://graph.microsoft.com/User.Read",
]
# Platform sign-in only needs identity, not mailbox access.
MICROSOFT_SSO_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://graph.microsoft.com/User.Read",
]
_GITHUB_SCOPES = ["repo", "read:user", "user:email"]
_MONEYBIRD_SCOPES = ["sales_invoices", "documents", "estimates", "bank", "settings"]

CALENDAR_PROVIDERS = frozenset({GOOGLE_CALENDAR, OUTLOOK_CALENDAR})


def _credential_key(provider: str) -> str:
    """Map calendar slugs onto the Google/Microsoft OAuth app credentials."""
    if provider == GOOGLE_CALENDAR:
        return GOOGLE
    if provider == OUTLOOK_CALENDAR:
        return MICROSOFT
    return provider


def _credentials(provider: str) -> tuple[str, str]:
    s = get_settings()
    key = _credential_key(provider)
    if key == GITHUB:
        return s.github_oauth_client_id, s.github_oauth_client_secret
    if key == GOOGLE:
        return s.google_oauth_client_id, s.google_oauth_client_secret
    if key == MICROSOFT:
        return s.microsoft_oauth_client_id, s.microsoft_oauth_client_secret
    if key == MONEYBIRD:
        return s.moneybird_oauth_client_id, s.moneybird_oauth_client_secret
    return "", ""


def is_configured(provider: str) -> bool:
    client_id, client_secret = _credentials(provider)
    return bool(client_id and client_secret)


def _authorize_endpoint(provider: str) -> str:
    key = _credential_key(provider)
    if key == GITHUB:
        return "https://github.com/login/oauth/authorize"
    if key == GOOGLE:
        return "https://accounts.google.com/o/oauth2/v2/auth"
    if key == MICROSOFT:
        tenant = get_settings().microsoft_oauth_tenant or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    if key == MONEYBIRD:
        return "https://moneybird.com/oauth/authorize"
    raise ValueError(f"Unsupported OAuth provider: {provider}")


def _token_endpoint(provider: str) -> str:
    key = _credential_key(provider)
    if key == GITHUB:
        return "https://github.com/login/oauth/access_token"
    if key == GOOGLE:
        return "https://oauth2.googleapis.com/token"
    if key == MICROSOFT:
        tenant = get_settings().microsoft_oauth_tenant or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    if key == MONEYBIRD:
        return "https://moneybird.com/oauth/token"
    raise ValueError(f"Unsupported OAuth provider: {provider}")


def _scopes(provider: str) -> list[str]:
    if provider == GITHUB:
        return _GITHUB_SCOPES
    if provider == GOOGLE:
        return _GOOGLE_SCOPES
    if provider == GOOGLE_CALENDAR:
        return _GOOGLE_CALENDAR_SCOPES
    if provider == MICROSOFT:
        return _MICROSOFT_SCOPES
    if provider == OUTLOOK_CALENDAR:
        return _MICROSOFT_CALENDAR_SCOPES
    if provider == MONEYBIRD:
        return _MONEYBIRD_SCOPES
    return []


def build_authorize_url(
    provider: str,
    *,
    state: str,
    redirect_uri: str,
    scopes: list[str] | None = None,
    prompt: str | None = None,
) -> str:
    client_id, _ = _credentials(provider)
    key = _credential_key(provider)
    params: dict[str, str] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": " ".join(scopes or _scopes(provider)),
    }
    if key == GITHUB:
        params["allow_signup"] = "false"
    else:
        params["response_type"] = "code"
    if key == GOOGLE:
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        params["include_granted_scopes"] = "true"
    if key == MICROSOFT:
        params["response_mode"] = "query"
        if prompt:
            params["prompt"] = prompt
    return f"{_authorize_endpoint(provider)}?{urlencode(params)}"


async def exchange_code(provider: str, *, code: str, redirect_uri: str) -> dict[str, Any]:
    """Exchange an authorization code for tokens. Raises httpx.HTTPStatusError."""
    client_id, client_secret = _credentials(provider)
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(_token_endpoint(provider), data=data, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(provider: str, *, refresh_token: str) -> dict[str, Any]:
    """Refresh an access token. GitHub OAuth Apps do not expire, so this is a no-op there."""
    if _credential_key(provider) == GITHUB:
        return {}
    client_id, client_secret = _credentials(provider)
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    if _credential_key(provider) == GOOGLE:
        data["scope"] = " ".join(_scopes(provider))
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(_token_endpoint(provider), data=data, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def fetch_identity(provider: str, access_token: str) -> dict[str, Any]:
    """Return {email, login, name} for the authorized account (best-effort)."""
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    key = _credential_key(provider)
    async with httpx.AsyncClient(timeout=20.0) as client:
        if key == GITHUB:
            user = (await client.get("https://api.github.com/user", headers=headers)).json()
            email = user.get("email") or ""
            if not email:
                try:
                    emails = (
                        await client.get("https://api.github.com/user/emails", headers=headers)
                    ).json()
                    primary = next(
                        (e for e in emails if e.get("primary") and e.get("verified")),
                        emails[0] if emails else None,
                    )
                    email = primary.get("email", "") if primary else ""
                except Exception:
                    email = ""
            return {
                "email": email,
                "login": user.get("login", ""),
                "name": user.get("name") or user.get("login", ""),
            }
        if key == GOOGLE:
            info = (
                await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo", headers=headers
                )
            ).json()
            return {
                "email": info.get("email", ""),
                "login": info.get("email", ""),
                "name": info.get("name", ""),
            }
        if key == MICROSOFT:
            info = (
                await client.get("https://graph.microsoft.com/v1.0/me", headers=headers)
            ).json()
            email = info.get("mail") or info.get("userPrincipalName") or ""
            return {
                "email": email,
                "login": email,
                "name": info.get("displayName", ""),
            }
    return {"email": "", "login": "", "name": ""}
