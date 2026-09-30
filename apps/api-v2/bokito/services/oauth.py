"""Built-in OAuth 2.1 authorization server for MCP clients.

Scope of the implementation, deliberately small:

- RFC 7591 dynamic client registration (public clients, PKCE required)
- authorization code grant with PKCE S256; consent happens in web-v2
- refresh tokens with rotation; RFC 7009 revocation
- RFC 8414 / RFC 9728 metadata so MCP clients discover us from `/api/mcp`

Access tokens (`bok2o_`) resolve to a `Principal(trust="api")`, exactly like
`bok2_` API tokens. The scopes are `read`, `write`, `tools`.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.config import get_settings
from bokito.domain.base import utcnow
from bokito.domain.identity import Tenant
from bokito.domain.platform import OAuthClient, OAuthCode, OAuthToken
from bokito.errors import AppError, Unauthorized

ACCESS_PREFIX = "bok2o_"
REFRESH_PREFIX = "bok2r_"
SCOPES: tuple[str, ...] = ("read", "write", "tools")
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=30)
CODE_TTL = timedelta(minutes=10)


class OAuthError(AppError):
    """RFC 6749 error; `code` is the OAuth error name."""

    status_code = 400
    code = "invalid_request"


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


# Metadata --------------------------------------------------------------------


def api_base() -> str:
    s = get_settings()
    return s.public_api_url.rstrip("/") + s.api_prefix


def issuer() -> str:
    return api_base() + "/oauth"


def resource_url() -> str:
    return api_base() + "/mcp"


def authorization_server_metadata() -> dict[str, Any]:
    base = issuer()
    return {
        "issuer": base,
        "authorization_endpoint": base + "/authorize",
        "token_endpoint": base + "/token",
        "registration_endpoint": base + "/register",
        "revocation_endpoint": base + "/revoke",
        "scopes_supported": list(SCOPES),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "code_challenge_methods_supported": ["S256"],
        "service_documentation": get_settings().public_app_url.rstrip("/")
        + "/docs/developers/mcp-endpoint",
    }


def protected_resource_metadata() -> dict[str, Any]:
    return {
        "resource": resource_url(),
        "authorization_servers": [issuer()],
        "scopes_supported": list(SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_name": "Bokito workspace MCP",
        "resource_documentation": get_settings().public_app_url.rstrip("/")
        + "/docs/developers/mcp-endpoint",
    }


def resource_metadata_url() -> str:
    s = get_settings()
    return (
        s.public_api_url.rstrip("/")
        + "/.well-known/oauth-protected-resource"
        + s.api_prefix
        + "/mcp"
    )


def www_authenticate(error: str | None = None) -> str:
    parts = ['Bearer realm="bokito"', f'resource_metadata="{resource_metadata_url()}"']
    if error:
        parts.append(f'error="{error}"')
    return ", ".join(parts)


# Clients ---------------------------------------------------------------------


def redirect_allowed(uri: str, registered: list[Any]) -> bool:
    """Exact match, except loopback clients may use any port (RFC 8252 section 7.3)."""
    if uri in registered:
        return True
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False
    if parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        return False
    for r in registered:
        rp = urlparse(str(r))
        if (
            rp.scheme == parsed.scheme
            and rp.hostname == parsed.hostname
            and rp.path == parsed.path
            and rp.query == parsed.query
        ):
            return True
    return False


def _valid_redirect_uri(uri: str) -> bool:
    p = urlparse(uri)
    if p.scheme == "https" and p.netloc:
        return True
    if p.scheme == "http" and p.hostname in ("127.0.0.1", "localhost", "::1"):
        return True
    # Private-use URI schemes for native apps (e.g. cursor://, vscode://)
    return bool(p.scheme) and p.scheme not in ("javascript", "data", "file") and p.scheme != "http"


async def register_client(
    session: AsyncSession,
    *,
    redirect_uris: list[str],
    name: str = "",
    token_endpoint_auth_method: str = "none",
    scope: str = "",
) -> tuple[OAuthClient, str | None]:
    if not redirect_uris:
        raise OAuthError("redirect_uris is required", code="invalid_redirect_uri")
    for uri in redirect_uris:
        if not _valid_redirect_uri(uri):
            raise OAuthError(f"redirect_uri not allowed: {uri}", code="invalid_redirect_uri")
    if token_endpoint_auth_method not in ("none", "client_secret_post", "client_secret_basic"):
        raise OAuthError("unsupported token_endpoint_auth_method", code="invalid_client_metadata")
    requested = [s for s in scope.split() if s in SCOPES] if scope else list(SCOPES)
    secret: str | None = None
    if token_endpoint_auth_method != "none":
        secret = secrets.token_urlsafe(32)
    client = OAuthClient(
        client_id="mcp_" + secrets.token_urlsafe(16),
        client_secret_digest=_digest(secret) if secret else "",
        name=(name or "MCP client")[:200],
        redirect_uris=list(redirect_uris),
        grant_types=["authorization_code", "refresh_token"],
        scope=" ".join(requested),
        created_at=utcnow(),
    )
    session.add(client)
    await session.flush()
    return client, secret


def client_metadata(client: OAuthClient, secret: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "client_id": client.client_id,
        "client_name": client.name,
        "redirect_uris": list(client.redirect_uris or []),
        "grant_types": list(client.grant_types or []),
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_post"
        if client.client_secret_digest
        else "none",
        "scope": client.scope,
        "client_id_issued_at": int(client.created_at.timestamp()),
    }
    if secret:
        out["client_secret"] = secret
        out["client_secret_expires_at"] = 0
    return out


async def get_client(session: AsyncSession, client_id: str) -> OAuthClient | None:
    if not client_id:
        return None
    return await session.scalar(select(OAuthClient).where(OAuthClient.client_id == client_id))


def _authenticate_client(client: OAuthClient, client_secret: str | None) -> None:
    if not client.client_secret_digest:
        return
    if not client_secret or not secrets.compare_digest(
        _digest(client_secret), client.client_secret_digest
    ):
        raise OAuthError("client authentication failed", code="invalid_client")


# Authorization ---------------------------------------------------------------


@dataclass
class AuthorizeRequest:
    client: OAuthClient
    redirect_uri: str
    scope: str
    state: str
    code_challenge: str
    code_challenge_method: str
    resource: str


def normalize_scope(client: OAuthClient, requested: str) -> str:
    allowed = set(client.scope.split()) if client.scope else set(SCOPES)
    wanted = [s for s in requested.split() if s] if requested else sorted(allowed)
    unknown = [s for s in wanted if s not in SCOPES]
    if unknown:
        raise OAuthError(f"unknown scope: {' '.join(unknown)}", code="invalid_scope")
    denied = [s for s in wanted if s not in allowed]
    if denied:
        raise OAuthError(f"scope not registered: {' '.join(denied)}", code="invalid_scope")
    return " ".join(sorted(set(wanted), key=SCOPES.index))


async def validate_authorize(
    session: AsyncSession,
    *,
    response_type: str,
    client_id: str,
    redirect_uri: str,
    scope: str = "",
    state: str = "",
    code_challenge: str = "",
    code_challenge_method: str = "",
    resource: str = "",
) -> AuthorizeRequest:
    client = await get_client(session, client_id)
    if not client:
        raise OAuthError("unknown client", code="invalid_client")
    if not redirect_uri or not redirect_allowed(redirect_uri, client.redirect_uris or []):
        raise OAuthError("redirect_uri not registered", code="invalid_redirect_uri")
    if response_type != "code":
        raise OAuthError("only response_type=code is supported", code="unsupported_response_type")
    if not code_challenge or code_challenge_method != "S256":
        raise OAuthError("PKCE with S256 is required", code="invalid_request")
    if resource and resource.rstrip("/") != resource_url():
        raise OAuthError("unknown resource", code="invalid_target")
    return AuthorizeRequest(
        client=client,
        redirect_uri=redirect_uri,
        scope=normalize_scope(client, scope),
        state=state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        resource=resource,
    )


def consent_url(req: AuthorizeRequest) -> str:
    params = {
        "client_id": req.client.client_id,
        "redirect_uri": req.redirect_uri,
        "scope": req.scope,
        "state": req.state,
        "code_challenge": req.code_challenge,
        "code_challenge_method": req.code_challenge_method,
    }
    if req.resource:
        params["resource"] = req.resource
    return get_settings().public_app_url.rstrip("/") + "/oauth/consent?" + urlencode(params)


def error_redirect(redirect_uri: str, error: str, description: str, state: str) -> str:
    params = {"error": error, "error_description": description}
    if state:
        params["state"] = state
    sep = "&" if "?" in redirect_uri else "?"
    return redirect_uri + sep + urlencode(params)


async def issue_code(
    session: AsyncSession,
    *,
    req: AuthorizeRequest,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> str:
    raw = secrets.token_urlsafe(32)
    session.add(
        OAuthCode(
            code_digest=_digest(raw),
            client_id=req.client.client_id,
            user_id=user_id,
            tenant_id=tenant_id,
            redirect_uri=req.redirect_uri,
            scope=req.scope,
            code_challenge=req.code_challenge,
            code_challenge_method=req.code_challenge_method,
            expires_at=utcnow() + CODE_TTL,
        )
    )
    await session.flush()
    return raw


def code_redirect(req: AuthorizeRequest, code: str) -> str:
    params = {"code": code}
    if req.state:
        params["state"] = req.state
    sep = "&" if "?" in req.redirect_uri else "?"
    return req.redirect_uri + sep + urlencode(params)


# Tokens ----------------------------------------------------------------------


@dataclass
class Issued:
    access_token: str
    refresh_token: str
    scope: str
    expires_in: int

    def as_response(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "token_type": "Bearer",
            "expires_in": self.expires_in,
            "refresh_token": self.refresh_token,
            "scope": self.scope,
        }


async def _issue_pair(
    session: AsyncSession, *, client_id: str, user_id: uuid.UUID, tenant_id: uuid.UUID, scope: str
) -> Issued:
    now = utcnow()
    access = ACCESS_PREFIX + secrets.token_urlsafe(32)
    refresh = REFRESH_PREFIX + secrets.token_urlsafe(32)
    session.add_all(
        [
            OAuthToken(
                tenant_id=tenant_id,
                token_digest=_digest(access),
                token_type="access",
                client_id=client_id,
                user_id=user_id,
                scope=scope,
                expires_at=now + ACCESS_TTL,
                created_at=now,
            ),
            OAuthToken(
                tenant_id=tenant_id,
                token_digest=_digest(refresh),
                token_type="refresh",
                client_id=client_id,
                user_id=user_id,
                scope=scope,
                expires_at=now + REFRESH_TTL,
                created_at=now,
            ),
        ]
    )
    await session.flush()
    return Issued(access, refresh, scope, int(ACCESS_TTL.total_seconds()))


def _pkce_ok(verifier: str, challenge: str, method: str) -> bool:
    if method != "S256" or not verifier or not challenge:
        return False
    computed = _b64url(hashlib.sha256(verifier.encode()).digest())
    return secrets.compare_digest(computed, challenge)


async def exchange_code(
    session: AsyncSession,
    *,
    code: str,
    client_id: str,
    client_secret: str | None,
    redirect_uri: str,
    code_verifier: str,
) -> Issued:
    client = await get_client(session, client_id)
    if not client:
        raise OAuthError("unknown client", code="invalid_client")
    _authenticate_client(client, client_secret)
    row = await session.scalar(select(OAuthCode).where(OAuthCode.code_digest == _digest(code)))
    if not row or row.client_id != client_id:
        raise OAuthError("authorization code invalid", code="invalid_grant")
    if row.used_at is not None or row.expires_at < utcnow():
        raise OAuthError("authorization code expired or already used", code="invalid_grant")
    if redirect_uri and redirect_uri != row.redirect_uri:
        raise OAuthError("redirect_uri mismatch", code="invalid_grant")
    if not _pkce_ok(code_verifier, row.code_challenge, row.code_challenge_method):
        raise OAuthError("PKCE verification failed", code="invalid_grant")
    row.used_at = utcnow()
    return await _issue_pair(
        session,
        client_id=client_id,
        user_id=row.user_id,
        tenant_id=row.tenant_id,
        scope=row.scope,
    )


async def refresh(
    session: AsyncSession,
    *,
    refresh_token: str,
    client_id: str,
    client_secret: str | None,
    scope: str = "",
) -> Issued:
    client = await get_client(session, client_id)
    if not client:
        raise OAuthError("unknown client", code="invalid_client")
    _authenticate_client(client, client_secret)
    row = await session.scalar(
        select(OAuthToken).where(OAuthToken.token_digest == _digest(refresh_token))
    )
    if (
        not row
        or row.token_type != "refresh"
        or row.client_id != client_id
        or row.revoked_at is not None
        or row.expires_at < utcnow()
    ):
        raise OAuthError("refresh token invalid", code="invalid_grant")
    granted = set(row.scope.split())
    if scope:
        wanted = set(scope.split())
        if not wanted <= granted:
            raise OAuthError("scope exceeds the original grant", code="invalid_scope")
        new_scope = " ".join(sorted(wanted, key=SCOPES.index))
    else:
        new_scope = row.scope
    row.revoked_at = utcnow()
    return await _issue_pair(
        session,
        client_id=client_id,
        user_id=row.user_id,
        tenant_id=row.tenant_id,
        scope=new_scope,
    )


async def revoke_token(session: AsyncSession, raw: str) -> bool:
    row = await session.scalar(select(OAuthToken).where(OAuthToken.token_digest == _digest(raw)))
    if not row or row.revoked_at is not None:
        return False
    row.revoked_at = utcnow()
    await session.flush()
    return True


async def resolve_access_token(session: AsyncSession, raw: str) -> OAuthToken:
    row = await session.scalar(select(OAuthToken).where(OAuthToken.token_digest == _digest(raw)))
    if not row or row.token_type != "access" or row.revoked_at is not None:
        raise Unauthorized(
            "access token invalid",
            code="token_invalid",
            headers={"WWW-Authenticate": www_authenticate("invalid_token")},
        )
    if row.expires_at < utcnow():
        raise Unauthorized(
            "access token expired",
            code="token_expired",
            headers={"WWW-Authenticate": www_authenticate("invalid_token")},
        )
    row.last_used_at = utcnow()
    return row


# Grants (what the operator sees under Settings -> Developers) ---------------


async def list_grants(
    session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    stmt = select(OAuthToken).where(
        OAuthToken.tenant_id == tenant_id,
        OAuthToken.revoked_at.is_(None),
        OAuthToken.expires_at > utcnow(),
    )
    if user_id:
        stmt = stmt.where(OAuthToken.user_id == user_id)
    rows = (await session.scalars(stmt.order_by(OAuthToken.created_at.desc()))).all()
    by_client: dict[str, dict[str, Any]] = {}
    for t in rows:
        g = by_client.setdefault(
            t.client_id,
            {
                "client_id": t.client_id,
                "client_name": "",
                "scope": t.scope,
                "user_id": str(t.user_id),
                "created_at": t.created_at,
                "last_used_at": t.last_used_at,
                "active_tokens": 0,
            },
        )
        g["active_tokens"] += 1
        if t.last_used_at and (g["last_used_at"] is None or t.last_used_at > g["last_used_at"]):
            g["last_used_at"] = t.last_used_at
        if t.created_at < g["created_at"]:
            g["created_at"] = t.created_at
    if by_client:
        clients = (
            await session.scalars(
                select(OAuthClient).where(OAuthClient.client_id.in_(list(by_client)))
            )
        ).all()
        for c in clients:
            by_client[c.client_id]["client_name"] = c.name
    return list(by_client.values())


async def revoke_grant(session: AsyncSession, *, tenant_id: uuid.UUID, client_id: str) -> int:
    rows = (
        await session.scalars(
            select(OAuthToken).where(
                OAuthToken.tenant_id == tenant_id,
                OAuthToken.client_id == client_id,
                OAuthToken.revoked_at.is_(None),
            )
        )
    ).all()
    now = utcnow()
    for t in rows:
        t.revoked_at = now
    await session.flush()
    return len(rows)


async def consent_context(
    session: AsyncSession, *, client_id: str, tenant_id: uuid.UUID
) -> dict[str, Any]:
    client = await get_client(session, client_id)
    if not client:
        raise OAuthError("unknown client", code="invalid_client")
    tenant = await session.get(Tenant, tenant_id)
    return {
        "client_id": client.client_id,
        "client_name": client.name,
        "redirect_uris": list(client.redirect_uris or []),
        "scopes": list(SCOPES),
        "workspace_name": tenant.name if tenant else "",
    }
