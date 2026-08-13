"""Real OAuth2 authorization-code helpers for GitHub, Google (Gmail) and
Microsoft (Outlook).

Each provider is "configured" only when its client id + secret are present in
settings. Callers (start endpoints) fall back to the dev mock flow when a
provider is not configured, so local development needs no registered apps.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

# Internal provider keys. The app uses the slugs "gmail" and "outlook" for the
# email channel; those map onto the Google and Microsoft identity providers.
GITHUB = "github"
GOOGLE = "gmail"
MICROSOFT = "outlook"

_GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
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
# Platform sign-in only needs identity, not mailbox access.
MICROSOFT_SSO_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://graph.microsoft.com/User.Read",
]
_GITHUB_SCOPES = ["repo", "read:user", "user:email"]


def _credentials(provider: str) -> tuple[str, str]:
    s = get_settings()
    if provider == GITHUB:
        return s.github_oauth_client_id, s.github_oauth_client_secret
    if provider == GOOGLE:
        return s.google_oauth_client_id, s.google_oauth_client_secret
    if provider == MICROSOFT:
        return s.microsoft_oauth_client_id, s.microsoft_oauth_client_secret
    return "", ""


def is_configured(provider: str) -> bool:
    client_id, client_secret = _credentials(provider)
    return bool(client_id and client_secret)


def _authorize_endpoint(provider: str) -> str:
    if provider == GITHUB:
        return "https://github.com/login/oauth/authorize"
    if provider == GOOGLE:
        return "https://accounts.google.com/o/oauth2/v2/auth"
    if provider == MICROSOFT:
        tenant = get_settings().microsoft_oauth_tenant or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    raise ValueError(f"Unsupported OAuth provider: {provider}")


def _token_endpoint(provider: str) -> str:
    if provider == GITHUB:
        return "https://github.com/login/oauth/access_token"
    if provider == GOOGLE:
        return "https://oauth2.googleapis.com/token"
    if provider == MICROSOFT:
        tenant = get_settings().microsoft_oauth_tenant or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    raise ValueError(f"Unsupported OAuth provider: {provider}")


def _scopes(provider: str) -> list[str]:
    if provider == GITHUB:
        return _GITHUB_SCOPES
    if provider == GOOGLE:
        return _GOOGLE_SCOPES
    if provider == MICROSOFT:
        return _MICROSOFT_SCOPES
    return []


def build_authorize_url(
    provider: str,
    *,
    state: str,
    redirect_uri: str,
    scopes: list[str] | None = None,
) -> str:
    client_id, _ = _credentials(provider)
    params: dict[str, str] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": " ".join(scopes or _scopes(provider)),
    }
    if provider == GITHUB:
        params["allow_signup"] = "false"
    else:
        params["response_type"] = "code"
    if provider == GOOGLE:
        # Force a refresh token to be issued so background sync survives token expiry.
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        params["include_granted_scopes"] = "true"
    if provider == MICROSOFT:
        params["response_mode"] = "query"
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
    if provider == GITHUB:
        return {}
    client_id, client_secret = _credentials(provider)
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    if provider == GOOGLE:
        data["scope"] = " ".join(_GOOGLE_SCOPES)
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(_token_endpoint(provider), data=data, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def fetch_identity(provider: str, access_token: str) -> dict[str, Any]:
    """Return {email, login, name} for the authorized account (best-effort)."""
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        if provider == GITHUB:
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
        if provider == GOOGLE:
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
        if provider == MICROSOFT:
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
