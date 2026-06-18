"""GitHub integration routes (dashboard contract under INTEGRATIONS_API_BASE)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
import httpx

from app.services.integrations_platform import (
    MOCK_BRANCHES,
    MOCK_REPOS,
    ensure_github_connection,
    get_provider_access_token,
    list_github_connections,
    mock_authorize_url,
)
from app.services.oauth_flow import start_real_oauth

router = APIRouter(prefix="/github", tags=["github"])


@router.get("/oauth/start")
async def github_oauth_start(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str = Query(...),
    project_id: str | None = Query(default=None),
):
    del project_id
    real_url = await start_real_oauth(
        session,
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
        provider="github",
        flow="github",
        return_url=return_url,
    )
    if real_url:
        return {"authorize_url": real_url}
    await ensure_github_connection(session, auth.tenant.id)
    authorize_url = mock_authorize_url(return_url, {"github": "connected"})
    return {"authorize_url": authorize_url}


@router.get("/connections")
async def github_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {"connections": await list_github_connections(session, auth.tenant.id)}


@router.get("/connection")
async def github_connection_singular(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = await list_github_connections(session, auth.tenant.id)
    return {"connection": rows[0] if rows else None}


@router.delete("/connection")
async def github_disconnect_singular(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = await list_github_connections(session, auth.tenant.id)
    if not rows:
        return {"ok": True}
    from app.services.integrations_platform import revoke_connection

    await revoke_connection(session, auth.tenant.id, UUID(rows[0]["id"]))
    return {"ok": True}


@router.get("/repos")
async def github_repos(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    connection_id: str | None = Query(default=None),
):
    del connection_id
    rows = await list_github_connections(session, auth.tenant.id)
    if not rows:
        raise HTTPException(status_code=404, detail="No GitHub connection")
    token = await get_provider_access_token(session, auth.tenant.id, "github")
    if token:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    "https://api.github.com/user/repos",
                    params={"per_page": "100", "sort": "updated"},
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                )
                resp.raise_for_status()
                repos = resp.json()
            return {
                "items": [
                    {
                        "id": r.get("id"),
                        "full_name": r.get("full_name"),
                        "default_branch": r.get("default_branch", "main"),
                        "private": r.get("private", False),
                    }
                    for r in repos
                ]
            }
        except Exception:
            pass
    return {"items": MOCK_REPOS}


@router.get("/repos/{owner}/{repo}/branches")
async def github_branches(
    owner: str,
    repo: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    connection_id: str | None = Query(default=None),
):
    del connection_id
    rows = await list_github_connections(session, auth.tenant.id)
    if not rows:
        raise HTTPException(status_code=404, detail="No GitHub connection")
    token = await get_provider_access_token(session, auth.tenant.id, "github")
    if token:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}/branches",
                    params={"per_page": "100"},
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                )
                resp.raise_for_status()
                branches = resp.json()
            return {"branches": [b.get("name") for b in branches if b.get("name")]}
        except Exception:
            pass
    return {"branches": MOCK_BRANCHES}
