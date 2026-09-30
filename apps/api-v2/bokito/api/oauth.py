"""OAuth 2.1 authorization server endpoints for MCP clients.

Flow: the client discovers metadata (RFC 9728 -> RFC 8414), registers itself
(RFC 7591), sends the operator to `/authorize`, which validates and redirects to
the web-v2 consent page. The consent page, authenticated with the dashboard
JWT, posts to `/consent`; we mint a code and hand back the client redirect.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from bokito.deps import DbSession, Operator
from bokito.domain.identity import Role
from bokito.errors import Forbidden
from bokito.services import audit
from bokito.services import oauth as oauth_svc

router = APIRouter(prefix="/oauth", tags=["oauth"])
well_known = APIRouter(tags=["oauth"])


# Metadata ---------------------------------------------------------------------


@well_known.get(
    "/.well-known/oauth-authorization-server{path:path}",
    summary="Authorization server metadata (RFC 8414)",
    response_model=dict,
)
async def as_metadata(path: str = "") -> dict[str, Any]:
    return oauth_svc.authorization_server_metadata()


@well_known.get(
    "/.well-known/oauth-protected-resource{path:path}",
    summary="Protected resource metadata (RFC 9728)",
    response_model=dict,
)
async def resource_metadata(path: str = "") -> dict[str, Any]:
    return oauth_svc.protected_resource_metadata()


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
async def as_metadata_path_issuer() -> dict[str, Any]:
    return oauth_svc.authorization_server_metadata()


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def resource_metadata_path_issuer() -> dict[str, Any]:
    return oauth_svc.protected_resource_metadata()


# Registration -----------------------------------------------------------------


class ClientRegistration(BaseModel):
    redirect_uris: list[str] = Field(min_length=1, max_length=10)
    client_name: str = ""
    token_endpoint_auth_method: str = "none"
    grant_types: list[str] = Field(default_factory=lambda: ["authorization_code", "refresh_token"])
    response_types: list[str] = Field(default_factory=lambda: ["code"])
    scope: str = ""


@router.post(
    "/register",
    status_code=201,
    summary="Dynamic client registration (RFC 7591)",
    response_model=dict,
)
async def register(body: ClientRegistration, session: DbSession) -> dict[str, Any]:
    client, secret = await oauth_svc.register_client(
        session,
        redirect_uris=body.redirect_uris,
        name=body.client_name,
        token_endpoint_auth_method=body.token_endpoint_auth_method,
        scope=body.scope,
    )
    await session.commit()
    return oauth_svc.client_metadata(client, secret)


# Authorization ----------------------------------------------------------------


@router.get("/authorize", summary="Authorization endpoint (redirects to consent)")
async def authorize(
    session: DbSession,
    response_type: str = Query(default=""),
    client_id: str = Query(default=""),
    redirect_uri: str = Query(default=""),
    scope: str = Query(default=""),
    state: str = Query(default=""),
    code_challenge: str = Query(default=""),
    code_challenge_method: str = Query(default=""),
    resource: str = Query(default=""),
) -> RedirectResponse:
    try:
        req = await oauth_svc.validate_authorize(
            session,
            response_type=response_type,
            client_id=client_id,
            redirect_uri=redirect_uri,
            scope=scope,
            state=state,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            resource=resource,
        )
    except oauth_svc.OAuthError as exc:
        # Redirect errors only when the redirect_uri itself is registered (RFC 6749 4.1.2.1).
        if exc.code in ("invalid_client", "invalid_redirect_uri"):
            raise
        client = await oauth_svc.get_client(session, client_id)
        if client and oauth_svc.redirect_allowed(redirect_uri, client.redirect_uris or []):
            return RedirectResponse(
                oauth_svc.error_redirect(redirect_uri, exc.code, exc.message, state),
                status_code=302,
            )
        raise
    return RedirectResponse(oauth_svc.consent_url(req), status_code=302)


@router.get("/consent-context", summary="Consent screen context", response_model=dict)
async def consent_context(
    session: DbSession, principal: Operator, client_id: str = Query(default="")
) -> dict[str, Any]:
    return await oauth_svc.consent_context(
        session, client_id=client_id, tenant_id=principal.tenant_id
    )


class ConsentDecision(BaseModel):
    client_id: str
    redirect_uri: str
    scope: str = ""
    state: str = ""
    code_challenge: str
    code_challenge_method: str = "S256"
    resource: str = ""
    approve: bool


@router.post("/consent", summary="Approve or deny an MCP client", response_model=dict)
async def consent(body: ConsentDecision, session: DbSession, principal: Operator) -> dict[str, Any]:
    if principal.trust != "operator" or not principal.user_id:
        raise Forbidden("consent requires an operator session", code="operator_required")
    principal.require_role(Role.member)
    req = await oauth_svc.validate_authorize(
        session,
        response_type="code",
        client_id=body.client_id,
        redirect_uri=body.redirect_uri,
        scope=body.scope,
        state=body.state,
        code_challenge=body.code_challenge,
        code_challenge_method=body.code_challenge_method,
        resource=body.resource,
    )
    if not body.approve:
        await session.commit()
        return {
            "redirect_to": oauth_svc.error_redirect(
                req.redirect_uri, "access_denied", "the operator denied access", req.state
            )
        }
    code = await oauth_svc.issue_code(
        session, req=req, user_id=principal.user_id, tenant_id=principal.tenant_id
    )
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="oauth.consent",
        target_kind="oauth_client",
        target_id=req.client.client_id,
        payload={"client_name": req.client.name, "scope": req.scope},
    )
    await session.commit()
    return {"redirect_to": oauth_svc.code_redirect(req, code)}


# Tokens -----------------------------------------------------------------------


def _oauth_error_response(exc: oauth_svc.OAuthError) -> JSONResponse:
    status = 401 if exc.code == "invalid_client" else 400
    return JSONResponse(
        {"error": exc.code, "error_description": exc.message},
        status_code=status,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


@router.post("/token", summary="Token endpoint", response_model=dict)
async def token(
    session: DbSession,
    grant_type: Annotated[str, Form()] = "",
    code: Annotated[str, Form()] = "",
    redirect_uri: Annotated[str, Form()] = "",
    client_id: Annotated[str, Form()] = "",
    client_secret: Annotated[str | None, Form()] = None,
    code_verifier: Annotated[str, Form()] = "",
    refresh_token: Annotated[str, Form()] = "",
    scope: Annotated[str, Form()] = "",
) -> JSONResponse:
    try:
        if grant_type == "authorization_code":
            issued = await oauth_svc.exchange_code(
                session,
                code=code,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
                code_verifier=code_verifier,
            )
        elif grant_type == "refresh_token":
            issued = await oauth_svc.refresh(
                session,
                refresh_token=refresh_token,
                client_id=client_id,
                client_secret=client_secret,
                scope=scope,
            )
        else:
            raise oauth_svc.OAuthError(
                "grant_type must be authorization_code or refresh_token",
                code="unsupported_grant_type",
            )
    except oauth_svc.OAuthError as exc:
        await session.rollback()
        return _oauth_error_response(exc)
    await session.commit()
    return JSONResponse(
        issued.as_response(), headers={"Cache-Control": "no-store", "Pragma": "no-cache"}
    )


@router.post("/revoke", summary="Token revocation (RFC 7009)", status_code=200)
async def revoke(
    session: DbSession,
    token: Annotated[str, Form()] = "",
    token_type_hint: Annotated[str, Form()] = "",
) -> dict[str, Any]:
    # RFC 7009: respond 200 whether or not the token was known.
    if token:
        await oauth_svc.revoke_token(session, token)
        await session.commit()
    return {}


# Grants (operator side) --------------------------------------------------------


class GrantOut(BaseModel):
    client_id: str
    client_name: str
    scope: str
    user_id: str
    created_at: Any
    last_used_at: Any
    active_tokens: int


@router.get("/grants", summary="Connected MCP clients", response_model=list[GrantOut])
async def list_grants(session: DbSession, principal: Operator) -> list[GrantOut]:
    principal.require_role(Role.member)
    rows = await oauth_svc.list_grants(
        session,
        tenant_id=principal.tenant_id,
        user_id=None if principal.role in (Role.admin, Role.owner) else principal.user_id,
    )
    return [GrantOut(**r) for r in rows]


@router.delete("/grants/{client_id}", status_code=204, summary="Disconnect an MCP client")
async def revoke_grant(client_id: str, session: DbSession, principal: Operator, request: Request):
    principal.require_role(Role.admin)
    count = await oauth_svc.revoke_grant(
        session, tenant_id=principal.tenant_id, client_id=client_id
    )
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="oauth.revoke_grant",
        target_kind="oauth_client",
        target_id=client_id,
        payload={"tokens": count},
    )
    await session.commit()
    return None
