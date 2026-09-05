"""Cases API: typed intake on Signal threads.

Operators manage types and bindings here. There is no /cases inbox.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import cases as svc

router = APIRouter(prefix="/cases", tags=["cases"])
signal_cases_router = APIRouter(prefix="/signals", tags=["cases"])


class CaseCreateBody(BaseModel):
    case_type_id: UUID
    signal_id: UUID
    title: str = ""
    summary: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    certainty: int | None = None
    project_id: UUID | None = None


class CasePatchBody(BaseModel):
    title: str | None = None
    summary: str | None = None
    status: str | None = None
    project_id: UUID | None = None
    payload: dict[str, Any] | None = None


class CaseLinkBody(BaseModel):
    target_kind: str
    target_id: UUID
    auto_start_run: bool = False


class CaseTypeCreateBody(BaseModel):
    name: str
    slug: str = ""
    description: str = ""
    create_mode: str = "ask_customer"
    follow_up_mode: str = "track"
    ask_threshold: int = 6
    auto_threshold: int = 9
    requires_verification: bool = False
    allow_project_link: str = "optional"
    audience: str = "both"
    enabled: bool = True
    sort_order: int = 0


class CaseTypePatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    create_mode: str | None = None
    follow_up_mode: str | None = None
    ask_threshold: int | None = None
    auto_threshold: int | None = None
    requires_verification: bool | None = None
    allow_project_link: str | None = None
    audience: str | None = None
    enabled: bool | None = None
    sort_order: int | None = None


class BindingCreateBody(BaseModel):
    case_type_id: UUID
    target_kind: str
    target_id: UUID
    priority: int = 0
    auto_link: bool = True
    auto_start_run: bool = False
    enabled: bool = True


@router.get("/types")
async def list_types(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """List intake types for this workspace (platform defaults are seeded)."""
    rows = await svc.list_case_types(session, auth.tenant.id)
    return {"items": [svc.serialize_case_type(row) for row in rows]}


@router.post("/types")
async def create_type(
    body: CaseTypeCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create an intake type. Owner/admin only."""
    auth.require_role("owner", "admin")
    row = await svc.create_case_type(
        session,
        auth.tenant.id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        create_mode=body.create_mode,
        follow_up_mode=body.follow_up_mode,
        ask_threshold=body.ask_threshold,
        auto_threshold=body.auto_threshold,
        requires_verification=body.requires_verification,
        allow_project_link=body.allow_project_link,
        audience=body.audience,
        enabled=body.enabled,
        sort_order=body.sort_order,
    )
    return svc.serialize_case_type(row)


@router.patch("/types/{type_id}")
async def patch_type(
    type_id: UUID,
    body: CaseTypePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    row = await svc.update_case_type(
        session, auth.tenant.id, type_id, body.model_dump(exclude_unset=True)
    )
    return svc.serialize_case_type(row)


@router.delete("/types/{type_id}")
async def delete_type(
    type_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.delete_case_type(session, auth.tenant.id, type_id)


@router.get("/bindings")
async def list_bindings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    case_type_id: UUID | None = None,
    target_kind: str | None = None,
    target_id: UUID | None = None,
):
    rows = await svc.list_bindings(
        session,
        auth.tenant.id,
        case_type_id=case_type_id,
        target_kind=target_kind,
        target_id=target_id,
    )
    return {"items": [svc.serialize_binding(row) for row in rows]}


@router.post("/bindings")
async def create_binding(
    body: BindingCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    row = await svc.create_binding(
        session,
        auth.tenant.id,
        case_type_id=body.case_type_id,
        target_kind=body.target_kind,
        target_id=body.target_id,
        priority=body.priority,
        auto_link=body.auto_link,
        auto_start_run=body.auto_start_run,
        enabled=body.enabled,
    )
    return svc.serialize_binding(row)


@router.delete("/bindings/{binding_id}")
async def delete_binding(
    binding_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    await svc.delete_binding(session, auth.tenant.id, binding_id)
    return {"ok": True}


@router.get("")
async def list_cases(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    signal_id: UUID | None = None,
    status: str | None = None,
    case_type_id: UUID | None = None,
    q: str | None = None,
    include_labels: bool = True,
    limit: int | None = None,
    offset: int | None = None,
):
    """List cases for the hub queue, filterable by type, status and text.

    Hub queue should pass ``include_labels=false`` so label-only stamps
    (no follow-up) stay out of Open / Waiting pills.
    """
    rows = await svc.list_cases(
        session,
        auth.tenant.id,
        signal_id=signal_id,
        status=status,
        case_type_id=case_type_id,
        q=q,
        include_labels=include_labels,
        limit=limit,
        offset=offset,
    )
    subjects = await svc.signal_subjects(
        session, auth.tenant.id, [case.signal_id for case, _ in rows]
    )
    items = []
    for case, case_type in rows:
        item = svc.serialize_case(case, case_type)
        item["signal_subject"] = subjects.get(str(case.signal_id), "")
        items.append(item)
    return {"items": items}


@router.get("/stats")
async def get_case_stats(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Case counts per status, for the hub queue pills."""
    return {"counts": await svc.case_stats(session, auth.tenant.id)}


@router.post("")
async def create_case(
    body: CaseCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a case on a conversation. Operators skip the type.mode gate."""
    return await svc.create_case(
        session,
        auth.tenant.id,
        case_type_id=body.case_type_id,
        signal_id=body.signal_id,
        title=body.title,
        summary=body.summary,
        payload=body.payload,
        certainty=body.certainty,
        project_id=body.project_id,
        actor="operator",
        created_by_type="user",
        created_by_id=str(auth.user.id),
        user_id=auth.user.id,
    )


@router.get("/{case_id}")
async def get_case(
    case_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    case, case_type = await svc.get_case(session, auth.tenant.id, case_id)
    return svc.serialize_case(case, case_type)


@router.patch("/{case_id}")
async def patch_case(
    case_id: UUID,
    body: CasePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    case = await svc.update_case(
        session, auth.tenant.id, case_id, body.model_dump(exclude_unset=True)
    )
    case, case_type = await svc.get_case(session, auth.tenant.id, case.id)
    return svc.serialize_case(case, case_type)


@router.post("/{case_id}/link")
async def link_case(
    case_id: UUID,
    body: CaseLinkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    case = await svc.link_case(
        session,
        auth.tenant.id,
        case_id,
        target_kind=body.target_kind,
        target_id=body.target_id,
        auto_start_run=body.auto_start_run,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    case, case_type = await svc.get_case(session, auth.tenant.id, case.id)
    return svc.serialize_case(case, case_type)


@signal_cases_router.get("/{signal_id}/cases")
async def list_signal_cases(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Cases attached to one conversation."""
    rows = await svc.list_cases(session, auth.tenant.id, signal_id=signal_id)
    return {"items": [svc.serialize_case(case, case_type) for case, case_type in rows]}
