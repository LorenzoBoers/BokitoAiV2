"""Authorization-server helpers for the workspace MCP OAuth flow."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Membership, Tenant, User
from app.models.oauth_as import (
    McpOAuthAccessToken,
    McpOAuthAuthRequest,
    McpOAuthAuthorizationCode,
    McpOAuthClient,
    McpOAuthRefreshToken,
)
from app.tools.registry import TOOL_CATEGORIES

ACCESS_TOKEN_PREFIX = "bok_oa_"
REFRESH_TOKEN_PREFIX = "bok_or_"
AUTH_CODE_TTL_MINUTES = 10
AUTH_REQUEST_TTL_MINUTES = 30
ACCESS_TOKEN_TTL_MINUTES = 60
REFRESH_TOKEN_TTL_DAYS = 30

# Cursor MCP OAuth callbacks (desktop + web/agents). Always accepted.
CURSOR_REDIRECT_URIS = (
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "https://cursor.com/api/mcp/oauth/callback",
    "https://www.cursor.com/agents/mcp/oauth/callback",
    "http://localhost:8787/callback",
    "http://127.0.0.1:8787/callback",
)

DEFAULT_CONSENT_SCOPES = (
    "workspace",
    "projects",
    "messaging",
    "agents",
    "delegation",
    "tickets",
    "triggers",
)


def hash_opaque(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mcp_resource_url() -> str:
    return f"{get_settings().public_api_url.rstrip('/')}/api/mcp"


def public_origin() -> str:
    return get_settings().public_api_url.rstrip("/")


def app_origin() -> str:
    return get_settings().public_app_url.rstrip("/")


def oauth_issuer() -> str:
    """Path-based issuer under /api so discovery is proxied (SPA does not catch it).

    OpenID Connect Discovery resolves to
    ``{issuer}/.well-known/openid-configuration`` → ``/api/oauth/.well-known/...``.
    """
    return f"{public_origin()}/api/oauth"


def prm_metadata_url() -> str:
    return f"{oauth_issuer()}/.well-known/oauth-protected-resource"


def scopes_supported() -> list[str]:
    return list(TOOL_CATEGORIES)


def parse_scopes(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return list(DEFAULT_CONSENT_SCOPES)
    if isinstance(raw, list):
        parts = [str(s).strip() for s in raw if str(s).strip()]
    else:
        parts = [p.strip() for p in str(raw).split() if p.strip()]
    if not parts:
        return []
    allowed = set(TOOL_CATEGORIES)
    return [p for p in parts if p in allowed]


def scopes_to_json(scopes: list[str]) -> str:
    return json.dumps(scopes)


def scopes_from_json(raw: str | None) -> set[str]:
    try:
        data = json.loads(raw or "[]")
        return {str(s) for s in data} if isinstance(data, list) else set()
    except (json.JSONDecodeError, TypeError):
        return set()


def redirect_uris_from_json(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
        return [str(u) for u in data] if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def is_loopback_redirect(uri: str) -> bool:
    try:
        parsed = urlparse(uri)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1")


def redirect_uri_allowed(uri: str, registered: list[str]) -> bool:
    if not uri:
        return False
    if uri in CURSOR_REDIRECT_URIS:
        return True
    if uri in registered:
        return True
    # Loopback with any port when client registered a loopback host.
    if is_loopback_redirect(uri):
        for reg in registered:
            if not is_loopback_redirect(reg):
                continue
            try:
                a, b = urlparse(uri), urlparse(reg)
            except Exception:
                continue
            if (a.hostname or "").lower() == (b.hostname or "").lower() and a.path == b.path:
                return True
    return False


def verify_pkce(verifier: str, challenge: str, method: str = "S256") -> bool:
    if not verifier or not challenge:
        return False
    if method == "plain":
        return secrets.compare_digest(verifier, challenge)
    if method != "S256":
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return secrets.compare_digest(computed, challenge)


def protected_resource_metadata() -> dict[str, Any]:
    return {
        "resource": mcp_resource_url(),
        # Path issuer so OIDC discovery lands under /api (Caddy proxies /api/*).
        "authorization_servers": [oauth_issuer()],
        "scopes_supported": scopes_supported(),
        "bearer_methods_supported": ["header"],
        "resource_documentation": f"{app_origin()}/docs/developers/mcp-endpoint",
    }


def normalize_resource(url: str | None) -> str:
    raw = (url or mcp_resource_url()).strip()
    return raw.rstrip("/") or mcp_resource_url().rstrip("/")


def resource_matches(stored: str | None, requested: str | None) -> bool:
    if not requested:
        return True
    return normalize_resource(stored) == normalize_resource(requested)


def authorization_server_metadata() -> dict[str, Any]:
    issuer = oauth_issuer()
    origin = public_origin()
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{origin}/api/oauth/authorize",
        "token_endpoint": f"{origin}/api/oauth/token",
        "registration_endpoint": f"{origin}/api/oauth/register",
        "revocation_endpoint": f"{origin}/api/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "scopes_supported": scopes_supported(),
        "client_id_metadata_document_supported": True,
        "resource_indicators_supported": True,
        "authorization_response_iss_parameter_supported": True,
    }


def www_authenticate_challenge() -> str:
    # Absolute PRM URL under /api — never the SPA catch-all at /.well-known.
    meta = prm_metadata_url()
    scope = " ".join(DEFAULT_CONSENT_SCOPES)
    return (
        f'Bearer realm="bokito", '
        f'resource_metadata="{meta}", '
        f'scope="{scope}"'
    )


async def get_or_resolve_client(
    session: AsyncSession, client_id: str
) -> McpOAuthClient | None:
    result = await session.execute(
        select(McpOAuthClient).where(McpOAuthClient.client_id == client_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    if client_id.startswith("https://"):
        return await _fetch_client_id_metadata(session, client_id)
    return None


async def _fetch_client_id_metadata(
    session: AsyncSession, client_id: str
) -> McpOAuthClient | None:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as http:
            res = await http.get(client_id)
            if res.status_code != 200:
                return None
            doc = res.json()
    except Exception:
        return None
    if not isinstance(doc, dict):
        return None
    if str(doc.get("client_id") or "") != client_id:
        return None
    redirects = doc.get("redirect_uris") or []
    if not isinstance(redirects, list) or not redirects:
        return None
    row = McpOAuthClient(
        client_id=client_id,
        client_name=str(doc.get("client_name") or "")[:200],
        redirect_uris_json=json.dumps([str(u) for u in redirects]),
        token_endpoint_auth_method=str(
            doc.get("token_endpoint_auth_method") or "none"
        ),
    )
    session.add(row)
    await session.flush()
    return row


async def register_client(
    session: AsyncSession,
    *,
    redirect_uris: list[str],
    client_name: str = "",
    token_endpoint_auth_method: str = "none",
) -> tuple[McpOAuthClient, str | None]:
    if not redirect_uris:
        raise ValueError("redirect_uris required")
    client_id = f"mcp_{secrets.token_urlsafe(24)}"
    secret: str | None = None
    secret_hash: str | None = None
    method = token_endpoint_auth_method or "none"
    if method != "none":
        secret = secrets.token_urlsafe(32)
        secret_hash = hash_opaque(secret)
    row = McpOAuthClient(
        client_id=client_id,
        client_secret_hash=secret_hash,
        client_name=(client_name or "MCP client")[:200],
        redirect_uris_json=json.dumps([str(u) for u in redirect_uris]),
        token_endpoint_auth_method=method,
    )
    session.add(row)
    await session.flush()
    return row, secret


async def create_auth_request(
    session: AsyncSession,
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    scope: str,
    code_challenge: str,
    code_challenge_method: str,
    resource: str,
) -> McpOAuthAuthRequest:
    row = McpOAuthAuthRequest(
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=state or "",
        scope=scope or "",
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method or "S256",
        resource=normalize_resource(resource),
        expires_at=datetime.utcnow() + timedelta(minutes=AUTH_REQUEST_TTL_MINUTES),
    )
    session.add(row)
    await session.flush()
    return row


async def get_auth_request(
    session: AsyncSession, request_id: uuid.UUID
) -> McpOAuthAuthRequest | None:
    result = await session.execute(
        select(McpOAuthAuthRequest).where(McpOAuthAuthRequest.id == request_id)
    )
    row = result.scalar_one_or_none()
    if not row or row.expires_at < datetime.utcnow():
        return None
    return row


async def user_can_access_tenant(
    session: AsyncSession, user: User, tenant_id: uuid.UUID
) -> bool:
    if user.is_staff:
        return True
    result = await session.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def membership_role(
    session: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> str | None:
    result = await session.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.tenant_id == tenant_id,
        )
    )
    membership = result.scalar_one_or_none()
    return membership.role if membership else None


async def issue_authorization_code(
    session: AsyncSession,
    *,
    auth_request: McpOAuthAuthRequest,
    user: User,
    tenant_id: uuid.UUID,
    scopes: list[str] | None = None,
) -> tuple[str, str]:
    """Mint a code and return (plain_code, redirect_url_with_query)."""
    resolved_scopes = parse_scopes(scopes if scopes is not None else auth_request.scope)
    plain = secrets.token_urlsafe(32)
    row = McpOAuthAuthorizationCode(
        code_hash=hash_opaque(plain),
        client_id=auth_request.client_id,
        user_id=user.id,
        tenant_id=tenant_id,
        scopes_json=scopes_to_json(resolved_scopes),
        redirect_uri=auth_request.redirect_uri,
        code_challenge=auth_request.code_challenge,
        code_challenge_method=auth_request.code_challenge_method or "S256",
        resource=auth_request.resource or mcp_resource_url(),
        expires_at=datetime.utcnow() + timedelta(minutes=AUTH_CODE_TTL_MINUTES),
    )
    session.add(row)
    await session.delete(auth_request)
    await session.flush()

    params: dict[str, str] = {"code": plain, "iss": oauth_issuer()}
    if auth_request.state:
        params["state"] = auth_request.state
    redirect = auth_request.redirect_uri
    sep = "&" if "?" in redirect else "?"
    return plain, f"{redirect}{sep}{urlencode(params)}"


@dataclass
class IssuedTokens:
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str
    resource: str
    token_type: str = "Bearer"


async def exchange_authorization_code(
    session: AsyncSession,
    *,
    code: str,
    client_id: str,
    redirect_uri: str,
    code_verifier: str,
    client_secret: str | None = None,
    resource: str | None = None,
) -> IssuedTokens:
    client = await get_or_resolve_client(session, client_id)
    if not client:
        raise ValueError("invalid_client")
    if client.client_secret_hash:
        if not client_secret or hash_opaque(client_secret) != client.client_secret_hash:
            raise ValueError("invalid_client")

    result = await session.execute(
        select(McpOAuthAuthorizationCode).where(
            McpOAuthAuthorizationCode.code_hash == hash_opaque(code)
        )
    )
    row = result.scalar_one_or_none()
    if (
        not row
        or row.used_at is not None
        or row.expires_at < datetime.utcnow()
        or row.client_id != client_id
        or row.redirect_uri != redirect_uri
    ):
        raise ValueError("invalid_grant")
    if not verify_pkce(code_verifier, row.code_challenge, row.code_challenge_method):
        raise ValueError("invalid_grant")
    if resource and not resource_matches(row.resource, resource):
        raise ValueError("invalid_target")

    row.used_at = datetime.utcnow()
    session.add(row)
    tokens = await _mint_token_pair(
        session,
        client_id=client_id,
        user_id=row.user_id,
        tenant_id=row.tenant_id,
        scopes_json=row.scopes_json,
        resource=normalize_resource(row.resource),
        family_id=uuid.uuid4(),
    )
    await session.flush()
    return tokens


async def refresh_access_token(
    session: AsyncSession,
    *,
    refresh_token: str,
    client_id: str,
    client_secret: str | None = None,
    resource: str | None = None,
) -> IssuedTokens:
    client = await get_or_resolve_client(session, client_id)
    if not client:
        raise ValueError("invalid_client")
    if client.client_secret_hash:
        if not client_secret or hash_opaque(client_secret) != client.client_secret_hash:
            raise ValueError("invalid_client")

    result = await session.execute(
        select(McpOAuthRefreshToken).where(
            McpOAuthRefreshToken.token_hash == hash_opaque(refresh_token)
        )
    )
    row = result.scalar_one_or_none()
    if not row or row.client_id != client_id:
        raise ValueError("invalid_grant")
    if row.revoked_at is not None:
        # Refresh-token reuse: kill the whole rotation family.
        await revoke_token_family(session, row.family_id)
        raise ValueError("invalid_grant")
    if row.expires_at < datetime.utcnow():
        raise ValueError("invalid_grant")
    if resource and not resource_matches(row.resource, resource):
        raise ValueError("invalid_target")

    row.revoked_at = datetime.utcnow()
    session.add(row)
    if row.access_token_id:
        access = (
            await session.execute(
                select(McpOAuthAccessToken).where(
                    McpOAuthAccessToken.id == row.access_token_id
                )
            )
        ).scalar_one_or_none()
        if access and access.revoked_at is None:
            access.revoked_at = datetime.utcnow()
            session.add(access)

    tokens = await _mint_token_pair(
        session,
        client_id=client_id,
        user_id=row.user_id,
        tenant_id=row.tenant_id,
        scopes_json=row.scopes_json,
        resource=normalize_resource(row.resource),
        family_id=row.family_id,
    )
    await session.flush()
    return tokens


async def _mint_token_pair(
    session: AsyncSession,
    *,
    client_id: str,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    scopes_json: str,
    resource: str,
    family_id: uuid.UUID | None = None,
) -> IssuedTokens:
    access_plain = ACCESS_TOKEN_PREFIX + secrets.token_urlsafe(32)
    refresh_plain = REFRESH_TOKEN_PREFIX + secrets.token_urlsafe(32)
    bound = normalize_resource(resource)
    family = family_id or uuid.uuid4()
    access = McpOAuthAccessToken(
        token_hash=hash_opaque(access_plain),
        token_prefix=access_plain[:16],
        client_id=client_id,
        user_id=user_id,
        tenant_id=tenant_id,
        scopes_json=scopes_json,
        resource=bound,
        expires_at=datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
    )
    session.add(access)
    await session.flush()
    refresh = McpOAuthRefreshToken(
        token_hash=hash_opaque(refresh_plain),
        access_token_id=access.id,
        family_id=family,
        client_id=client_id,
        user_id=user_id,
        tenant_id=tenant_id,
        scopes_json=scopes_json,
        resource=bound,
        expires_at=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    )
    session.add(refresh)
    scope_list = sorted(scopes_from_json(scopes_json))
    return IssuedTokens(
        access_token=access_plain,
        refresh_token=refresh_plain,
        expires_in=ACCESS_TOKEN_TTL_MINUTES * 60,
        scope=" ".join(scope_list),
        resource=bound,
    )


async def lookup_access_token(
    session: AsyncSession, plain: str
) -> McpOAuthAccessToken | None:
    result = await session.execute(
        select(McpOAuthAccessToken).where(
            McpOAuthAccessToken.token_hash == hash_opaque(plain)
        )
    )
    row = result.scalar_one_or_none()
    if (
        not row
        or row.revoked_at is not None
        or row.expires_at < datetime.utcnow()
    ):
        return None
    # Audience bind: token must be for this MCP resource.
    if not resource_matches(row.resource, mcp_resource_url()):
        return None
    return row


async def revoke_token_family(session: AsyncSession, family_id: uuid.UUID) -> None:
    now = datetime.utcnow()
    refresh_rows = (
        await session.execute(
            select(McpOAuthRefreshToken).where(
                McpOAuthRefreshToken.family_id == family_id
            )
        )
    ).scalars().all()
    access_ids: list[uuid.UUID] = []
    for rt in refresh_rows:
        if rt.revoked_at is None:
            rt.revoked_at = now
            session.add(rt)
        if rt.access_token_id:
            access_ids.append(rt.access_token_id)
    if access_ids:
        access_rows = (
            await session.execute(
                select(McpOAuthAccessToken).where(McpOAuthAccessToken.id.in_(access_ids))
            )
        ).scalars().all()
        for at in access_rows:
            if at.revoked_at is None:
                at.revoked_at = now
                session.add(at)
    await session.flush()


async def revoke_token(session: AsyncSession, token: str) -> None:
    if not token:
        return
    digest = hash_opaque(token)
    access = (
        await session.execute(
            select(McpOAuthAccessToken).where(McpOAuthAccessToken.token_hash == digest)
        )
    ).scalar_one_or_none()
    if access and access.revoked_at is None:
        access.revoked_at = datetime.utcnow()
        session.add(access)
        # Also revoke refresh tokens pointing at this access token.
        linked = (
            await session.execute(
                select(McpOAuthRefreshToken).where(
                    McpOAuthRefreshToken.access_token_id == access.id
                )
            )
        ).scalars().all()
        for rt in linked:
            if rt.revoked_at is None:
                rt.revoked_at = datetime.utcnow()
                session.add(rt)
    refresh = (
        await session.execute(
            select(McpOAuthRefreshToken).where(McpOAuthRefreshToken.token_hash == digest)
        )
    ).scalar_one_or_none()
    if refresh:
        await revoke_token_family(session, refresh.family_id)
    await session.flush()


async def list_grants_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Active OAuth grants grouped by client + tenant for the operator UI."""
    rows = (
        await session.execute(
            select(McpOAuthRefreshToken).where(
                McpOAuthRefreshToken.user_id == user_id,
                McpOAuthRefreshToken.revoked_at.is_(None),
                McpOAuthRefreshToken.expires_at > datetime.utcnow(),
            )
        )
    ).scalars().all()
    grouped: dict[tuple[str, uuid.UUID], dict[str, Any]] = {}
    for rt in rows:
        key = (rt.client_id, rt.tenant_id)
        if key not in grouped:
            client = await get_or_resolve_client(session, rt.client_id)
            tenant = (
                await session.execute(select(Tenant).where(Tenant.id == rt.tenant_id))
            ).scalar_one_or_none()
            grouped[key] = {
                "id": f"{rt.client_id}:{rt.tenant_id}",
                "client_id": rt.client_id,
                "client_name": (client.client_name if client else "") or rt.client_id,
                "tenant_id": str(rt.tenant_id),
                "tenant_name": tenant.name if tenant else str(rt.tenant_id),
                "tenant_slug": tenant.slug if tenant else "",
                "scopes": sorted(scopes_from_json(rt.scopes_json)),
                "created_at": rt.created_at.isoformat() + "Z",
                "family_id": str(rt.family_id),
            }
        else:
            # Keep earliest created_at.
            existing = grouped[key]["created_at"]
            candidate = rt.created_at.isoformat() + "Z"
            if candidate < existing:
                grouped[key]["created_at"] = candidate
    return sorted(grouped.values(), key=lambda g: g["created_at"], reverse=True)


async def revoke_grant(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    client_id: str,
    tenant_id: uuid.UUID,
) -> int:
    """Revoke every refresh (and linked access) for a user+client+tenant grant."""
    rows = (
        await session.execute(
            select(McpOAuthRefreshToken).where(
                McpOAuthRefreshToken.user_id == user_id,
                McpOAuthRefreshToken.client_id == client_id,
                McpOAuthRefreshToken.tenant_id == tenant_id,
                McpOAuthRefreshToken.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    families = {rt.family_id for rt in rows}
    for family_id in families:
        await revoke_token_family(session, family_id)
    # Also revoke orphan access tokens for this grant.
    access_rows = (
        await session.execute(
            select(McpOAuthAccessToken).where(
                McpOAuthAccessToken.user_id == user_id,
                McpOAuthAccessToken.client_id == client_id,
                McpOAuthAccessToken.tenant_id == tenant_id,
                McpOAuthAccessToken.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    now = datetime.utcnow()
    for at in access_rows:
        at.revoked_at = now
        session.add(at)
    await session.flush()
    return len(families)
