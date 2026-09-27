"""OAuth 2.1 authorization server for the workspace MCP resource."""

from __future__ import annotations

import uuid
from typing import Annotated, Any
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import mcp_oauth_as as asvc
from app.services.auth import verify_refresh_token

router = APIRouter(tags=["oauth"])
well_known = APIRouter(tags=["oauth"])
mcp_well_known = APIRouter(prefix="/mcp", tags=["oauth"])


class RegisterBody(BaseModel):
    redirect_uris: list[str] = Field(min_length=1)
    client_name: str = ""
    token_endpoint_auth_method: str = "none"
    grant_types: list[str] | None = None
    response_types: list[str] | None = None


class ConsentBody(BaseModel):
    authorize_request_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    scopes: list[str] | None = None


def _oauth_error(
    error: str, description: str = "", status_code: int = 400
) -> JSONResponse:
    body: dict[str, str] = {"error": error}
    if description:
        body["error_description"] = description
    return JSONResponse(status_code=status_code, content=body)


async def _user_from_refresh_cookie(request: Request, session: AsyncSession):
    settings = get_settings()
    raw = request.cookies.get(settings.refresh_cookie_name)
    if not raw:
        return None
    return await verify_refresh_token(session, raw)


@well_known.get("/.well-known/oauth-protected-resource")
@well_known.get("/.well-known/oauth-protected-resource/api/mcp")
async def protected_resource_meta():
    return asvc.protected_resource_metadata()


@well_known.get("/.well-known/oauth-authorization-server")
@well_known.get("/.well-known/oauth-authorization-server/api/oauth")
async def authorization_server_meta():
    return asvc.authorization_server_metadata()


# Path-issuer discovery under /api/oauth (proxied by Caddy; SPA cannot swallow it).
@router.get("/oauth/.well-known/oauth-protected-resource")
@router.get("/oauth/.well-known/oauth-protected-resource/api/mcp")
async def protected_resource_meta_under_api():
    return asvc.protected_resource_metadata()


@router.get("/oauth/.well-known/oauth-authorization-server")
@router.get("/oauth/.well-known/openid-configuration")
async def authorization_server_meta_under_api():
    return asvc.authorization_server_metadata()


@mcp_well_known.get("/.well-known/oauth-protected-resource")
async def protected_resource_at_mcp_path():
    """RFC 9728 path insert after the MCP resource URL."""
    return asvc.protected_resource_metadata()


@router.post("/oauth/register")
async def register_client(
    body: RegisterBody,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        client, secret = await asvc.register_client(
            session,
            redirect_uris=body.redirect_uris,
            client_name=body.client_name,
            token_endpoint_auth_method=body.token_endpoint_auth_method or "none",
        )
        await session.commit()
    except ValueError as exc:
        return _oauth_error("invalid_client_metadata", str(exc))

    payload: dict[str, Any] = {
        "client_id": client.client_id,
        "client_name": client.client_name,
        "redirect_uris": asvc.redirect_uris_from_json(client.redirect_uris_json),
        "grant_types": body.grant_types
        or ["authorization_code", "refresh_token"],
        "response_types": body.response_types or ["code"],
        "token_endpoint_auth_method": client.token_endpoint_auth_method,
        "client_id_issued_at": int(client.created_at.timestamp()),
    }
    if secret:
        payload["client_secret"] = secret
    return payload


@router.get("/oauth/authorize")
async def authorize(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    client_id: Annotated[str, Query()],
    redirect_uri: Annotated[str, Query()],
    response_type: Annotated[str, Query()] = "code",
    state: Annotated[str, Query()] = "",
    scope: Annotated[str, Query()] = "",
    code_challenge: Annotated[str, Query()] = "",
    code_challenge_method: Annotated[str, Query()] = "S256",
    resource: Annotated[str, Query()] = "",
):
    if response_type != "code":
        return _oauth_error("unsupported_response_type", "Only response_type=code")
    if not code_challenge or code_challenge_method != "S256":
        return _oauth_error("invalid_request", "PKCE S256 required")

    client = await asvc.get_or_resolve_client(session, client_id)
    if not client:
        return _oauth_error("invalid_client", "Unknown client_id", status_code=400)

    registered = asvc.redirect_uris_from_json(client.redirect_uris_json)
    if not asvc.redirect_uri_allowed(redirect_uri, registered):
        return _oauth_error("invalid_request", "redirect_uri not allowed")

    auth_req = await asvc.create_auth_request(
        session,
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=state,
        scope=scope,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        resource=resource or asvc.mcp_resource_url(),
    )
    await session.commit()

    consent_path = f"/oauth/mcp?request_id={auth_req.id}"
    app_base = asvc.app_origin()
    user = await _user_from_refresh_cookie(request, session)
    if user is None:
        login = (
            f"{app_base}/login?return_to={quote(consent_path, safe='')}"
        )
        return RedirectResponse(login, status_code=302)
    return RedirectResponse(f"{app_base}{consent_path}", status_code=302)


@router.get("/oauth/consent-context")
async def consent_context(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    request_id: Annotated[uuid.UUID, Query()],
):
    user = await _user_from_refresh_cookie(request, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")

    auth_req = await asvc.get_auth_request(session, request_id)
    if auth_req is None:
        raise HTTPException(status_code=404, detail="Authorization request expired")

    client = await asvc.get_or_resolve_client(session, auth_req.client_id)
    from app.routers.auth import _build_memberships

    memberships = await _build_memberships(session, user)
    scopes = asvc.parse_scopes(auth_req.scope)
    return {
        "request_id": str(auth_req.id),
        "client_id": auth_req.client_id,
        "client_name": client.client_name if client else auth_req.client_id,
        "redirect_uri": auth_req.redirect_uri,
        "scopes": scopes,
        "scopes_supported": asvc.scopes_supported(),
        "memberships": memberships,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "name": user.display_name or user.email,
        },
    }


@router.post("/oauth/consent")
async def consent(
    body: ConsentBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await _user_from_refresh_cookie(request, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")

    auth_req = await asvc.get_auth_request(session, body.authorize_request_id)
    if auth_req is None:
        raise HTTPException(status_code=404, detail="Authorization request expired")

    if body.tenant_id is None:
        raise HTTPException(status_code=400, detail="tenant_id required")
    if not await asvc.user_can_access_tenant(session, user, body.tenant_id):
        raise HTTPException(status_code=403, detail="Not a member of that workspace")

    _code, redirect_url = await asvc.issue_authorization_code(
        session,
        auth_request=auth_req,
        user=user,
        tenant_id=body.tenant_id,
        scopes=body.scopes,
    )
    await session.commit()
    return {"redirect_to": redirect_url}


@router.post("/oauth/deny")
async def deny(
    body: ConsentBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await _user_from_refresh_cookie(request, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")

    auth_req = await asvc.get_auth_request(session, body.authorize_request_id)
    if auth_req is None:
        raise HTTPException(status_code=404, detail="Authorization request expired")

    params = {"error": "access_denied"}
    if auth_req.state:
        params["state"] = auth_req.state
    redirect = auth_req.redirect_uri
    sep = "&" if "?" in redirect else "?"
    await session.delete(auth_req)
    await session.commit()
    return {"redirect_to": f"{redirect}{sep}{urlencode(params)}"}


@router.post("/oauth/token")
async def token(
    session: Annotated[AsyncSession, Depends(get_session)],
    grant_type: Annotated[str, Form()],
    code: Annotated[str | None, Form()] = None,
    redirect_uri: Annotated[str | None, Form()] = None,
    client_id: Annotated[str | None, Form()] = None,
    client_secret: Annotated[str | None, Form()] = None,
    code_verifier: Annotated[str | None, Form()] = None,
    refresh_token: Annotated[str | None, Form()] = None,
    resource: Annotated[str | None, Form()] = None,
):
    if not client_id:
        return _oauth_error("invalid_client", "client_id required", status_code=401)

    try:
        if grant_type == "authorization_code":
            if not code or not redirect_uri or not code_verifier:
                return _oauth_error(
                    "invalid_request", "code, redirect_uri and code_verifier required"
                )
            issued = await asvc.exchange_authorization_code(
                session,
                code=code,
                client_id=client_id,
                redirect_uri=redirect_uri,
                code_verifier=code_verifier,
                client_secret=client_secret,
                resource=resource,
            )
        elif grant_type == "refresh_token":
            if not refresh_token:
                return _oauth_error("invalid_request", "refresh_token required")
            issued = await asvc.refresh_access_token(
                session,
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                resource=resource,
            )
        else:
            return _oauth_error("unsupported_grant_type")
        await session.commit()
    except ValueError as exc:
        err = str(exc)
        status = 401 if err == "invalid_client" else 400
        return _oauth_error(err, status_code=status)

    return {
        "access_token": issued.access_token,
        "token_type": issued.token_type,
        "expires_in": issued.expires_in,
        "refresh_token": issued.refresh_token,
        "scope": issued.scope,
        "resource": issued.resource,
    }


@router.post("/oauth/revoke")
async def revoke(
    session: Annotated[AsyncSession, Depends(get_session)],
    token: Annotated[str, Form()],
    client_id: Annotated[str | None, Form()] = None,
):
    del client_id  # optional; revoke by token value alone
    await asvc.revoke_token(session, token)
    await session.commit()
    return JSONResponse(status_code=200, content={})


@router.get("/oauth/grants")
async def list_grants(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """List active MCP OAuth grants for the signed-in user (Developers UI)."""
    items = await asvc.list_grants_for_user(session, auth.user.id)
    return {"items": items}


@router.delete("/oauth/grants/{client_id}/{tenant_id}")
async def revoke_grant(
    client_id: str,
    tenant_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    count = await asvc.revoke_grant(
        session,
        user_id=auth.user.id,
        client_id=client_id,
        tenant_id=tenant_id,
    )
    await session.commit()
    return {"revoked_families": count}
