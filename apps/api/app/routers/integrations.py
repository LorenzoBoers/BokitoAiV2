"""Integrations API group (marketplace, connections, MCP, email helpers).

Mounted under /api/integrations/* to match the dashboard INTEGRATIONS_API_BASE.
Marketplace paths are served at /api/integrations/* (router prefix only).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.middleware.rate_limit import rate_limit
from app.models.integration import IntegrationConnection, McpServer
from app.services.integrations_catalog import PROVIDER_BY_SLUG
from app.services.integrations_platform import (
    MOCK_REPOS,
    create_api_key_connection,
    ensure_email_account,
    ensure_github_connection,
    ensure_oauth_connection,
    install_mcp,
    list_connections as list_platform_connections,
    list_mcp_bindings,
    list_providers,
    mock_authorize_url,
    revoke_connection,
    test_mcp_server,
)
from app.services.oauth_flow import complete_oauth, start_real_oauth

router = APIRouter(prefix="/integrations", tags=["integrations"])
settings = get_settings()


class ApiKeyConnectionCreate(BaseModel):
    provider: str
    api_key: str
    display_name: str | None = None


class ModuleEnableBody(BaseModel):
    """Lifecycle actions for a business module.

    Prefer ``action``. Legacy clients may still send ``enabled``.
    """

    action: str | None = None  # install | complete_setup | uninstall
    enabled: bool | None = None


class ModulePrefsBody(BaseModel):
    default_connection_id: str | None = None
    default_company_id: str | None = None
    clear_default_connection: bool = False
    # Owner/admin only: tenant-level write switch for module apply verbs.
    writes_enabled: bool | None = None
    # Owner/admin only: {"mode": "all_members"|"selected", "user_ids": [...]}.
    user_access: dict | None = None


class McpInstallBody(BaseModel):
    provider: str = "custom_mcp"
    api_key: str = ""
    display_name: str | None = None
    mcp_server_id: int | None = None
    server_url: str | None = None
    auth_type: str = "api_key"
    name: str | None = None
    auth: dict = Field(default_factory=dict)
    # Non-prod only: install without live provider verification (tests / demos).
    use_mock: bool = False
    # When set, attach the new registration to this module (must allow the provider).
    module_slug: str | None = None


class ModuleConnectionRenameBody(BaseModel):
    display_name: str


class ModuleSourceCreateBody(BaseModel):
    title: str = ""
    url: str
    auto_reindex: bool = True


class ModuleSourceDisableBody(BaseModel):
    disabled: bool = True


# --- Platform marketplace ---


async def _ensure_module_access(
    session: AsyncSession, auth: AuthContext, slug: str
) -> None:
    """403 for members outside the module's user_access selection."""
    from app.modules.catalog import user_can_access_module

    if not await user_can_access_module(
        session, auth.tenant.id, slug, user_id=auth.user.id, role=auth.role
    ):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this module. Ask an owner or admin.",
        )


@router.get("/providers")
async def get_providers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import user_can_access_module

    data = await list_providers(session, auth.tenant.id)
    for module in data.get("modules") or []:
        module["user_accessible"] = await user_can_access_module(
            session,
            auth.tenant.id,
            str(module.get("slug") or ""),
            user_id=auth.user.id,
            role=auth.role,
        )
    return data


@router.patch("/modules/{slug}")
async def patch_module(
    slug: str,
    body: ModuleEnableBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Install, finish setup, or uninstall a business module for this workspace."""
    from app.modules.catalog import (
        complete_module_setup,
        get_module,
        install_module,
        set_module_enabled,
        uninstall_module,
    )

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    action = (body.action or "").strip().lower()
    try:
        if action == "install":
            row = await install_module(
                session, auth.tenant.id, slug, actor_id=auth.user.id
            )
        elif action == "complete_setup":
            row = await complete_module_setup(
                session, auth.tenant.id, slug, actor_id=auth.user.id
            )
        elif action == "uninstall":
            row = await uninstall_module(
                session, auth.tenant.id, slug, actor_id=auth.user.id
            )
        elif body.enabled is not None:
            row = await set_module_enabled(
                session,
                auth.tenant.id,
                slug,
                body.enabled,
                actor_id=auth.user.id,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide action (install|complete_setup|uninstall) or enabled",
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"module": row}


class ModuleAgentAddBody(BaseModel):
    agent_id: str
    is_default: bool = False


class ModuleAgentPatchBody(BaseModel):
    is_default: bool | None = None
    # Company/administration ids this agent may access; [] or null via
    # clear_company_scope=True means all companies.
    company_ids: list[str] | None = None
    clear_company_scope: bool = False
    can_write: bool | None = None


@router.get("/modules/{slug}/agents")
async def get_module_agents(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import module_agents as module_agents_svc

    await _ensure_module_access(session, auth, slug)
    return await module_agents_svc.list_module_agents(session, auth.tenant.id, slug)


@router.post("/modules/{slug}/agents")
async def post_module_agent(
    slug: str,
    body: ModuleAgentAddBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import module_agents as module_agents_svc

    try:
        agent_id = UUID(body.agent_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid agent_id") from exc
    return await module_agents_svc.add_module_agent(
        session,
        auth.tenant.id,
        slug,
        agent_id,
        is_default=body.is_default,
    )


@router.patch("/modules/{slug}/agents/{agent_id}")
async def patch_module_agent(
    slug: str,
    agent_id: UUID,
    body: ModuleAgentPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import module_agents as module_agents_svc

    row = None
    if body.is_default is not None:
        row = await module_agents_svc.set_module_agent_default(
            session,
            auth.tenant.id,
            slug,
            agent_id,
            is_default=body.is_default,
        )
    if body.company_ids is not None or body.clear_company_scope or body.can_write is not None:
        row = await module_agents_svc.update_module_agent_access(
            session,
            auth.tenant.id,
            slug,
            agent_id,
            company_ids=body.company_ids,
            clear_company_scope=body.clear_company_scope,
            can_write=body.can_write,
        )
    if row is None:
        raise HTTPException(
            status_code=400,
            detail="Provide is_default, company_ids, clear_company_scope, or can_write",
        )
    return row


@router.delete("/modules/{slug}/agents/{agent_id}")
async def delete_module_agent(
    slug: str,
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import module_agents as module_agents_svc

    return await module_agents_svc.remove_module_agent(
        session, auth.tenant.id, slug, agent_id
    )


@router.get("/connected-summary")
async def get_connected_summary(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.integrations_platform import list_connected_summary

    return await list_connected_summary(session, auth.tenant.id)


@router.get("/modules/{slug}/eligible-connections")
async def get_module_eligible_connections(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_attach import list_eligible_connections

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    await _ensure_module_access(session, auth, slug)
    return {"connections": await list_eligible_connections(session, auth.tenant.id, slug)}


@router.post("/modules/{slug}/connections/{connection_id}/attach")
async def post_module_connection_attach(
    slug: str,
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.modules.catalog import get_module
    from app.services.module_attach import attach_connection_to_module

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    binding = await attach_connection_to_module(session, auth.tenant.id, connection_id, slug)
    return {"ok": True, "id": str(binding.connection_id), "module_slug": slug}


@router.post("/modules/{slug}/connections/{connection_id}/detach")
async def post_module_connection_detach(
    slug: str,
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.modules.catalog import get_module
    from app.services.module_attach import detach_connection_from_module

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    return await detach_connection_from_module(session, auth.tenant.id, connection_id, slug)


@router.get("/modules/{slug}/connections")
async def get_module_connections(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_connections import list_module_connections

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    await _ensure_module_access(session, auth, slug)
    try:
        return await list_module_connections(session, auth.tenant.id, slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/modules/{slug}/prefs")
async def patch_module_prefs(
    slug: str,
    body: ModulePrefsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module, update_module_prefs
    from app.services.module_connections import set_module_defaults

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    if body.writes_enabled is not None or body.user_access is not None:
        auth.require_role("owner", "admin")
    try:
        prefs = await set_module_defaults(
            session,
            auth.tenant.id,
            slug,
            default_connection_id=body.default_connection_id,
            default_company_id=body.default_company_id,
            clear_default_connection=body.clear_default_connection,
        )
        if body.writes_enabled is not None or body.user_access is not None:
            prefs = await update_module_prefs(
                session,
                auth.tenant.id,
                slug,
                writes_enabled=body.writes_enabled,
                user_access=body.user_access,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"prefs": prefs}


@router.patch("/modules/{slug}/connections/{connection_id}")
async def patch_module_connection(
    slug: str,
    connection_id: UUID,
    body: ModuleConnectionRenameBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_connections import rename_module_connection

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    try:
        row = await rename_module_connection(
            session,
            auth.tenant.id,
            connection_id,
            display_name=body.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"connection": row}


@router.post("/modules/{slug}/connections/{connection_id}/verify")
async def post_module_connection_verify(
    slug: str,
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.modules.catalog import get_module
    from app.services.module_connections import verify_module_connection

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    await _ensure_module_access(session, auth, slug)
    try:
        return await verify_module_connection(
            session, auth.tenant.id, slug, connection_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/modules/{slug}/connections/{connection_id}")
async def delete_module_connection(
    slug: str,
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.modules.catalog import get_module
    from app.services.module_connections import disconnect_module_connection

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    await _ensure_module_access(session, auth, slug)
    try:
        result = await disconnect_module_connection(
            session, auth.tenant.id, slug, connection_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:module_disconnected",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="module_connection",
        resource_id=connection_id,
        payload={"module_slug": slug},
    )
    return result


@router.get("/modules/{slug}/sources")
async def get_module_sources(
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_sources import ensure_platform_seeds, list_sources

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    await _ensure_module_access(session, auth, slug)
    await ensure_platform_seeds(session, auth.tenant.id, slug)
    return {"sources": await list_sources(session, auth.tenant.id, slug)}


@router.post("/modules/{slug}/sources")
async def post_module_source(
    slug: str,
    body: ModuleSourceCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_sources import create_tenant_source, serialize_source
    from app.workers.tasks import enqueue_module_source_index

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    try:
        row = await create_tenant_source(
            session,
            auth.tenant.id,
            slug,
            title=body.title,
            url=body.url,
            auto_reindex=body.auto_reindex,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await enqueue_module_source_index(str(row.id))
    return {"source": serialize_source(row)}


@router.post("/modules/{slug}/sources/{source_id}/reindex")
async def reindex_module_source(
    slug: str,
    source_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.models.module_source import ModuleSource
    from app.modules.catalog import get_module
    from app.services.module_sources import serialize_source
    from app.workers.tasks import enqueue_module_source_index

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    row = await session.get(ModuleSource, source_id)
    if row is None or row.tenant_id != auth.tenant.id or row.module_slug != slug:
        raise HTTPException(status_code=404, detail="Source not found")
    await enqueue_module_source_index(str(source_id))
    # Optimistic status; worker (or inline fallback) updates the real result.
    return {"source": serialize_source(row), "queued": True}


@router.patch("/modules/{slug}/sources/{source_id}")
async def patch_module_source(
    slug: str,
    source_id: UUID,
    body: ModuleSourceDisableBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_sources import serialize_source, set_source_disabled

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    try:
        row = await set_source_disabled(
            session, auth.tenant.id, source_id, disabled=body.disabled
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if row.module_slug != slug:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"source": serialize_source(row)}


@router.delete("/modules/{slug}/sources/{source_id}")
async def delete_module_source(
    slug: str,
    source_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.modules.catalog import get_module
    from app.services.module_sources import delete_tenant_source

    if get_module(slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    try:
        await delete_tenant_source(session, auth.tenant.id, source_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/modules/{module_slug}/companies")
async def get_module_companies(
    module_slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Companies/administrations across all connections of one module.

    Used by the Connected page to show module capacity and to hide the
    company picker when the tenant has exactly one company.
    """
    from app.modules.dispatch import call_module_verb

    await _ensure_module_access(session, auth, module_slug)
    return await call_module_verb(session, auth.tenant.id, module_slug, "list_companies")


@router.get("/connections")
async def get_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str | None = Query(default=None),
):
    rows = await list_platform_connections(session, auth.tenant.id, provider)
    return {"connections": rows}


@router.post("/connections")
async def post_api_key_connection(
    body: ApiKeyConnectionCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await create_api_key_connection(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=body.api_key,
        display_name=body.display_name,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:connected",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="connection",
        resource_id=(result or {}).get("id", "") if isinstance(result, dict) else "",
        summary=body.provider,
    )
    return result


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await revoke_connection(session, auth.tenant.id, connection_id)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:revoked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="connection",
        resource_id=connection_id,
    )
    return {"ok": True}


@router.get("/connections/{connection_id}/resources")
async def connection_resources(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == auth.tenant.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.provider == "github" and not settings.is_production:
        return {"items": MOCK_REPOS}
    return {"items": []}


@router.get("/oauth/start")
async def platform_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
    project_id: str | None = Query(default=None),
):
    del project_id
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    if PROVIDER_BY_SLUG[provider].get("status") == "coming_soon":
        raise HTTPException(status_code=400, detail="This integration is not available yet.")

    # Email providers connect a mailbox (flow="email"); github connects an
    # integration. Try a real provider redirect first; fall back to the mock
    # flow when the provider has no client credentials configured.
    if provider in ("outlook", "gmail"):
        flow = "email"
    elif provider == "github":
        flow = "github"
    else:
        flow = "integration"

    real_url = await start_real_oauth(
        session,
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
        provider=provider,
        flow=flow,
        return_url=return_url,
    )
    if real_url:
        return {"authorize_url": real_url, "provider": provider}

    if settings.is_production:
        raise HTTPException(
            status_code=503,
            detail=(
                f"OAuth for {provider} is not configured on this server. "
                "Set the provider client credentials to enable it."
            ),
        )

    if provider == "github":
        await ensure_github_connection(session, auth.tenant.id)
        authorize_url = mock_authorize_url(return_url, {"github": "connected"})
    elif provider == "outlook":
        email = auth.user.email or "outlook@bokito.local"
        await ensure_email_account(
            session, auth.tenant.id, "outlook", email, seed_mock_credentials=True
        )
        authorize_url = mock_authorize_url(
            return_url, {"oauth_provider": "outlook", "oauth_status": "connected"}
        )
    elif provider == "gmail":
        email = auth.user.email or "gmail@bokito.local"
        await ensure_email_account(
            session, auth.tenant.id, "gmail", email, seed_mock_credentials=True
        )
        authorize_url = mock_authorize_url(
            return_url, {"oauth_provider": "gmail", "oauth_status": "connected"}
        )
    elif provider == "moneybird":
        # Never create a ghost registration on OAuth start. A Moneybird row appears
        # only after the real OAuth callback stores tokens (or an API-key create).
        # Without client credentials configured, send the operator back with an error
        # instead of a fake "connected" placeholder.
        authorize_url = mock_authorize_url(
            return_url,
            {
                "provider": "moneybird",
                "integration_error": "oauth_not_configured",
            },
        )
    elif provider in ("google_calendar", "outlook_calendar"):
        from app.services.calendar_sync import sync_connection

        serialized = await ensure_oauth_connection(
            session,
            auth.tenant.id,
            provider,
            display_name="Google Calendar" if provider == "google_calendar" else "Outlook Calendar",
        )
        # Seed mock credentials so sync can populate demo events in dev.
        conn_id = serialized.get("id") if isinstance(serialized, dict) else None
        if conn_id:
            from uuid import UUID as _UUID

            try:
                conn = await session.get(IntegrationConnection, _UUID(str(conn_id)))
            except ValueError:
                conn = None
            if conn is not None:
                import json as _json

                creds = {}
                try:
                    creds = _json.loads(conn.credentials_json or "{}")
                except Exception:
                    creds = {}
                if not creds.get("access_token"):
                    conn.credentials_json = _json.dumps({"mock": True})
                    session.add(conn)
                    await session.commit()
                    await session.refresh(conn)
                await sync_connection(session, conn)
        authorize_url = mock_authorize_url(
            return_url, {"integration": "connected", "provider": provider}
        )
    else:
        # No mock success for generic integrations: a "connected" state must
        # always be backed by a real OAuth exchange.
        raise HTTPException(
            status_code=503,
            detail=f"OAuth for {provider} is not implemented yet.",
        )

    return {"authorize_url": authorize_url, "provider": provider}


@router.get("/oauth/callback")
async def platform_oauth_callback(
    session: Annotated[AsyncSession, Depends(get_session)],
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    """Single OAuth redirect URI for all providers.

    Exchanges the authorization code for tokens, stores them on the mailbox or
    integration connection, then 302-redirects the browser back to the dashboard
    return URL with success/error params the frontend already understands.
    SSO login flows additionally set the refresh cookie so the app session
    starts on the next AuthContext boot.
    """
    target, refresh_token = await complete_oauth(
        session, state=state, code=code, error=error or error_description
    )
    response = RedirectResponse(url=target, status_code=302)
    if refresh_token:
        from app.config import get_settings as _get_settings

        _settings = _get_settings()
        response.set_cookie(
            key=_settings.refresh_cookie_name,
            value=refresh_token,
            httponly=True,
            samesite="lax",
            secure=_settings.is_production,
            max_age=_settings.refresh_token_expire_days * 86400,
        )
    return response


@router.get("/mcp/oauth/start")
async def mcp_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: str = Query(...),
    return_url: str = Query(...),
):
    del session, return_url
    if provider not in PROVIDER_BY_SLUG:
        raise HTTPException(status_code=400, detail="Unknown provider")
    # No mock success: MCP OAuth connects only ship together with a real
    # authorization flow. Until then the catalog lists these as coming_soon.
    raise HTTPException(
        status_code=503,
        detail=(
            "MCP OAuth is not available yet. "
            "Install the MCP server with its URL and API key instead."
        ),
    )


@router.post("/mcp/install", dependencies=[Depends(rate_limit("mcp-install", limit=10))])
async def post_mcp_install(
    body: McpInstallBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    api_key = body.api_key or (body.auth.get("api_key") if body.auth else "") or ""
    display_name = body.display_name or body.name
    installed = await install_mcp(
        session,
        auth.tenant.id,
        provider=body.provider,
        api_key=api_key,
        display_name=display_name,
        server_url=body.server_url,
        auth_type=body.auth_type,
        mcp_server_id=body.mcp_server_id,
        auth=body.auth or None,
        use_mock=bool(body.use_mock),
        module_slug=body.module_slug,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="integration:mcp_installed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="mcp_server",
        resource_id=(installed.get("binding") or {}).get("id", ""),
        payload={
            "provider": body.provider,
            "server_url": body.server_url or "",
            "display_name": display_name or "",
            "verified": bool(installed.get("verified")),
            "use_mock": bool(body.use_mock),
        },
    )
    return installed


@router.get("/mcp/bindings")
async def get_mcp_bindings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_mcp_bindings(session, auth.tenant.id)


@router.post("/mcp/{server_id}/test")
async def post_mcp_test(
    server_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await test_mcp_server(session, auth.tenant.id, server_id)


# --- MCP servers (legacy listing) ---


@router.get("/mcp/servers")
async def list_mcp_servers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    import json as _json

    result = await session.execute(select(McpServer).where(McpServer.tenant_id == auth.tenant.id))
    rows = []
    for s in result.scalars().all():
        try:
            tools = _json.loads(s.tools_json or "[]")
        except (_json.JSONDecodeError, TypeError):
            tools = []
        rows.append(
            {
                "id": str(s.id),
                "name": s.name,
                "server_url": s.server_url,
                "is_active": s.is_active,
                "tools": tools if isinstance(tools, list) else [],
                "tools_synced_at": s.tools_synced_at.isoformat() if s.tools_synced_at else None,
            }
        )
    return rows
