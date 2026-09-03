"""OAuth 2.1 + PKCE for vendor-hosted remote MCP servers (RFC 9728 / 8414)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse
from uuid import UUID

import os

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.oauth_state import OAuthState
from app.services.integrations_catalog import PROVIDER_BY_SLUG
from app.services.integrations_platform import (
    _append_query,
    register_mcp_server,
    test_mcp_server,
)

logger = logging.getLogger(__name__)

_MCP_REMOTE_FLOW = "mcp_remote"
_WELL_KNOWN_RESOURCE = "/.well-known/oauth-protected-resource"
_WELL_KNOWN_AS = "/.well-known/oauth-authorization-server"
_OPENID_AS = "/.well-known/openid-configuration"


@dataclass(frozen=True)
class McpOAuthDiscovery:
    mcp_url: str
    resource: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None
    issuer: str
    scopes_supported: tuple[str, ...] = ()


def mcp_oauth_redirect_uri() -> str:
    return f"{get_settings().public_api_url.rstrip('/')}/api/integrations/mcp/oauth/callback"


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def _parse_resource_metadata_url(www_auth: str) -> str | None:
    if not www_auth:
        return None
    match = re.search(r'resource_metadata="([^"]+)"', www_auth, flags=re.I)
    if match:
        return match.group(1)
    match = re.search(r"resource_metadata=([^\s,;]+)", www_auth, flags=re.I)
    if match:
        return match.group(1).strip('"')
    return None


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    response = await client.get(url, headers={"Accept": "application/json"})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object from {url}")
    return data


async def _fetch_as_metadata(client: httpx.AsyncClient, issuer: str) -> dict[str, Any]:
    base = issuer.rstrip("/")
    for path in (_WELL_KNOWN_AS, _OPENID_AS):
        try:
            return await _fetch_json(client, f"{base}{path}")
        except Exception:
            continue
    raise ValueError(f"No authorization-server metadata at {issuer}")


async def discover_mcp_oauth(mcp_url: str) -> McpOAuthDiscovery:
    """Discover OAuth endpoints for a remote MCP server URL."""
    url = mcp_url.strip()
    if not url:
        raise HTTPException(status_code=422, detail="MCP server URL is missing for this provider.")

    init_payload = {
        "jsonrpc": "2.0",
        "id": "oauth-probe",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "Bokito", "version": "1.0"},
        },
    }
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        probe = await client.post(url, json=init_payload, headers=headers)
        resource_meta_url: str | None = None
        if probe.status_code == 401:
            resource_meta_url = _parse_resource_metadata_url(probe.headers.get("www-authenticate", ""))
        elif probe.status_code in (403, 407):
            resource_meta_url = _parse_resource_metadata_url(probe.headers.get("www-authenticate", ""))

        if not resource_meta_url:
            parsed = urlparse(url)
            resource_meta_url = urlunparse(
                (parsed.scheme, parsed.netloc, _WELL_KNOWN_RESOURCE, "", "", "")
            )

        resource_doc = await _fetch_json(client, resource_meta_url)
        resource = str(resource_doc.get("resource") or url)
        auth_servers = resource_doc.get("authorization_servers") or []
        if not auth_servers:
            raise HTTPException(
                status_code=503,
                detail="This MCP server did not advertise an authorization server.",
            )
        issuer = str(auth_servers[0]).rstrip("/")
        as_doc = await _fetch_as_metadata(client, issuer)
        authorization_endpoint = str(as_doc.get("authorization_endpoint") or "")
        token_endpoint = str(as_doc.get("token_endpoint") or "")
        if not authorization_endpoint or not token_endpoint:
            raise HTTPException(
                status_code=503,
                detail="Authorization server metadata is incomplete for this MCP server.",
            )
        registration_endpoint = as_doc.get("registration_endpoint")
        scopes = as_doc.get("scopes_supported") or []
        scope_tuple = tuple(str(s) for s in scopes if isinstance(s, str))
        return McpOAuthDiscovery(
            mcp_url=url,
            resource=resource,
            authorization_endpoint=authorization_endpoint,
            token_endpoint=token_endpoint,
            registration_endpoint=str(registration_endpoint) if registration_endpoint else None,
            issuer=str(as_doc.get("issuer") or issuer),
            scopes_supported=scope_tuple,
        )


def _env_oauth_credentials(provider_slug: str) -> tuple[str, str]:
    prefix = provider_slug.upper()
    client_id = os.environ.get(f"{prefix}_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get(f"{prefix}_OAUTH_CLIENT_SECRET", "").strip()
    return client_id, client_secret


async def _register_oauth_client(
    discovery: McpOAuthDiscovery,
    *,
    provider_slug: str,
    redirect_uri: str,
) -> tuple[str, str | None]:
    client_id, client_secret = _env_oauth_credentials(provider_slug)
    if client_id:
        return client_id, client_secret or None
    if not discovery.registration_endpoint:
        raise HTTPException(
            status_code=503,
            detail=(
                "No OAuth client is configured for this MCP provider and dynamic "
                "registration is not supported."
            ),
        )
    payload = {
        "client_name": "Bokito",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            discovery.registration_endpoint,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        response.raise_for_status()
        body = response.json()
    registered_id = str(body.get("client_id") or "")
    if not registered_id:
        raise HTTPException(status_code=503, detail="Dynamic client registration returned no client_id.")
    secret = body.get("client_secret")
    return registered_id, str(secret) if secret else None


async def start_mcp_remote_oauth(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    provider: str,
    return_url: str,
) -> dict[str, str]:
    row = PROVIDER_BY_SLUG.get(provider)
    if not row or row.get("auth_type") != "mcp_remote_oauth":
        raise HTTPException(status_code=400, detail="Provider does not support remote MCP OAuth.")
    mcp_url = str(row.get("mcp_remote_url") or "").strip()
    if not mcp_url:
        raise HTTPException(status_code=422, detail="This provider has no MCP server URL configured.")

    discovery = await discover_mcp_oauth(mcp_url)
    redirect_uri = mcp_oauth_redirect_uri()
    client_id, client_secret = await _register_oauth_client(
        discovery, provider_slug=provider, redirect_uri=redirect_uri
    )
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(32)

    scope = " ".join(discovery.scopes_supported[:8]) if discovery.scopes_supported else ""
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": discovery.resource,
    }
    if scope:
        params["scope"] = scope

    context = {
        "code_verifier": verifier,
        "client_id": client_id,
        "client_secret": client_secret,
        "token_endpoint": discovery.token_endpoint,
        "resource": discovery.resource,
        "mcp_url": discovery.mcp_url,
        "issuer": discovery.issuer,
        "redirect_uri": redirect_uri,
        "return_url": return_url,
    }
    session.add(
        OAuthState(
            state=state,
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            flow=_MCP_REMOTE_FLOW,
            return_url=return_url,
            redirect_uri=redirect_uri,
            context_json=json.dumps(context),
        )
    )
    await session.commit()
    authorize_url = f"{discovery.authorization_endpoint}?{urlencode(params)}"
    return {"authorize_url": authorize_url, "provider": provider, "state": state}


async def _exchange_mcp_code(context: dict[str, Any], code: str) -> dict[str, Any]:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": str(context["redirect_uri"]),
        "client_id": str(context["client_id"]),
        "code_verifier": str(context["code_verifier"]),
        "resource": str(context["resource"]),
    }
    client_secret = context.get("client_secret")
    headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
    auth: tuple[str, str] | None = None
    if client_secret:
        auth = (str(context["client_id"]), str(client_secret))
        data.pop("client_id", None)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            str(context["token_endpoint"]),
            data=data,
            headers=headers,
            auth=auth,
        )
        response.raise_for_status()
        body = response.json()
    if not isinstance(body, dict) or not body.get("access_token"):
        raise ValueError("Token endpoint returned no access_token")
    return body


def _token_auth_payload(tokens: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "auth_type": "oauth2",
        "access_token": tokens.get("access_token", ""),
        "token_type": tokens.get("token_type", "Bearer"),
        "scope": tokens.get("scope", ""),
        "mode": "remote_oauth",
    }
    if tokens.get("refresh_token"):
        payload["refresh_token"] = tokens["refresh_token"]
    expires_in = tokens.get("expires_in")
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        payload["expires_at"] = (
            datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        ).isoformat()
    return payload


async def complete_mcp_remote_oauth(
    session: AsyncSession,
    *,
    state: str,
    code: str | None,
    error: str | None = None,
) -> str:
    result = await session.execute(select(OAuthState).where(OAuthState.state == state))
    row = result.scalar_one_or_none()
    if not row or row.flow != _MCP_REMOTE_FLOW:
        return _append_query(
            get_settings().public_app_url,
            {"integration_error": "invalid_state", "provider": ""},
        )

    return_url = row.return_url
    provider = row.provider
    tenant_id = row.tenant_id
    expires_at = row.expires_at
    context_raw = row.context_json or "{}"
    await session.delete(row)
    await session.commit()

    if error:
        return _append_query(
            return_url or get_settings().public_app_url,
            {"integration_error": error, "provider": provider},
        )
    if expires_at < datetime.utcnow():
        return _append_query(
            return_url or get_settings().public_app_url,
            {"integration_error": "expired_state", "provider": provider},
        )
    if not code or tenant_id is None:
        return _append_query(
            return_url or get_settings().public_app_url,
            {"integration_error": "missing_code", "provider": provider},
        )

    try:
        context = json.loads(context_raw)
        if not isinstance(context, dict):
            raise ValueError("invalid context")
        tokens = await _exchange_mcp_code(context, code)
    except Exception as exc:
        logger.exception("MCP OAuth token exchange failed for %s", provider)
        return _append_query(
            return_url or get_settings().public_app_url,
            {"integration_error": str(exc) or "token_exchange_failed", "provider": provider},
        )

    auth_payload = _token_auth_payload(tokens)
    mcp_url = str(context.get("mcp_url") or "")
    display_name = PROVIDER_BY_SLUG.get(provider, {}).get("name") or provider
    server, conn, binding = await register_mcp_server(
        session,
        tenant_id,
        name=display_name,
        server_url=mcp_url,
        auth=auth_payload,
        provider=provider,
        credentials=_token_auth_payload(tokens),
        metadata={"mode": "remote_oauth", "mcp_remote_url": mcp_url},
    )
    binding_cfg = json.loads(binding.config_json or "{}")
    if isinstance(binding_cfg, dict):
        binding_cfg["mode"] = "remote_oauth"
        binding.config_json = json.dumps(binding_cfg)
        session.add(binding)
    try:
        await test_mcp_server(session, tenant_id, server.id)
    except Exception:
        logger.exception("MCP discovery after OAuth failed for %s", provider)
    from app.modules.catalog import enable_module_for_provider

    await enable_module_for_provider(session, tenant_id, provider)
    await session.commit()
    return _append_query(
        return_url or get_settings().public_app_url,
        {"integration": "connected", "provider": provider},
    )
