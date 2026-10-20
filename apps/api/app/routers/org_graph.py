"""Organization canvas: a picture computed on the server."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.org_flow import build_org_flow, open_label_suggestion
from app.services.org_graph import build_org_graph

router = APIRouter(prefix="/org", tags=["org"])


@router.get("/graph")
async def org_graph(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await build_org_graph(session, auth.tenant.id)


@router.get("/flow")
async def org_flow(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
):
    """The Grid: channels, executors in department zones, flows and results for the period."""
    return await build_org_flow(session, auth.tenant, auth.user.id if auth.user else None, days=days)


class SuggestLabelsBody(BaseModel):
    node_id: str = Field(min_length=3, max_length=80)
    days: int = Field(default=7, ge=1, le=90)
    lang: Literal["en", "nl"] = "en"


@router.post("/flow/suggest-labels")
async def org_flow_suggest_labels(
    body: SuggestLabelsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Open an agent chat that proposes labels for a Grid node's unlabeled work."""
    if auth.user is None:
        raise HTTPException(status_code=403, detail="A signed-in operator is required")
    created = await open_label_suggestion(
        session,
        auth.tenant,
        auth.user,
        body.node_id,
        days=body.days,
        lang=body.lang,
        is_admin=auth.role in ("owner", "admin"),
    )
    if created is None:
        raise HTTPException(status_code=404, detail="No unlabeled work at this node")
    if created.get("error") == "no_agent":
        raise HTTPException(status_code=409, detail="No agent is available to chat with")
    return created
