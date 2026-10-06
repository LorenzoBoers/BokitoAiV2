"""Categories (hashtags with a playbook), tickets on conversations, project boards."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import SignalTag
from app.services import tickets as svc

router = APIRouter(prefix="/categories", tags=["categories"])
ticket_router = APIRouter(prefix="/signals", tags=["categories"])
board_router = APIRouter(prefix="/projects", tags=["categories"])


class CategoryCreateBody(BaseModel):
    name: str
    description: str = ""
    workstream_id: UUID | None = None
    playbook_name: str = ""


class CategoryPatchBody(BaseModel):
    description: str | None = None
    workstream_id: UUID | None = None
    create_mode: str | None = None
    send_mode: str | None = None
    autonomy_level: str | None = None
    ask_threshold: int | None = None
    auto_threshold: int | None = None
    requires_verification: bool | None = None
    show_in_nav: bool | None = None
    sort_order: int | None = None


class SignalPolicyBody(BaseModel):
    accept_roles: str | None = None
    backlog_threshold: int | None = None


class BacklogPromoteBody(BaseModel):
    name: str | None = None
    description: str | None = None


class TicketFileBody(BaseModel):
    """``project_id`` must be sent (null = No project) when the flow has projects.
    ``fields`` are optional intake values from the first open stage."""

    tag_id: UUID | None = None
    tag: str | None = None
    project_id: UUID | None = None
    fields: dict[str, str] | None = None


class TicketPatchBody(BaseModel):
    """``status``: ``open`` accepts a proposal, ``dismissed`` removes the action tag,
    ``waiting`` / ``done`` move to the first stage of that kind."""

    status: str | None = None
    stage_key: str | None = None
    project_id: UUID | None = None
    fields: dict[str, str] | None = None


async def _workstream_names(session: AsyncSession, tenant_id: UUID) -> dict[UUID, Workstream]:
    rows = await session.execute(select(Workstream).where(Workstream.tenant_id == tenant_id))
    return {ws.id: ws for ws in rows.scalars()}


async def _serialize_categories(session: AsyncSession, tenant_id: UUID, rows: list[SignalTag]) -> list[dict[str, Any]]:
    streams = await _workstream_names(session, tenant_id)
    counts = await svc.category_counts(session, tenant_id)
    out = []
    for row in rows:
        item = svc.serialize_category(row, workstream=streams.get(row.workstream_id))
        item["project_choices"] = await svc.project_choices(session, tenant_id, row)
        item.update(counts.get(row.id, svc.EMPTY_CATEGORY_COUNTS))
        out.append(item)
    return out


@router.get("")
async def list_categories(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Hashtags with a playbook, with their intake settings, project choices and
    ticket counts (``open``, ``waiting``, ``proposed``; ``filed_7d`` and
    ``filed_prev_7d`` count filings in the last and the previous seven days)."""
    rows = await svc.list_categories(session, auth.tenant.id)
    return {"items": await _serialize_categories(session, auth.tenant.id, rows)}


@router.post("")
async def create_category(
    body: CategoryCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a category: register the hashtag and attach ``workstream_id`` or a new playbook."""
    auth.require_role("owner", "admin")
    from app.services.signal_tags import create_tag, promote_tag

    try:
        tag = await create_tag(
            session, auth.tenant.id, body.name, description=body.description, user_id=auth.user.id
        )
        tag = await promote_tag(
            session,
            auth.tenant.id,
            tag.id,
            workstream_id=body.workstream_id,
            playbook_name=body.playbook_name,
            user_id=auth.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return (await _serialize_categories(session, auth.tenant.id, [tag]))[0]


@router.get("/policy")
async def get_signal_policy(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Who may accept proposed tickets, and how often a pattern must recur to be offered."""
    from app.services.signal_catalog import may_accept_signals, signal_policy

    return {
        **signal_policy(auth.tenant),
        "may_accept": may_accept_signals(auth.tenant, auth.role),
    }


@router.put("/policy")
async def put_signal_policy(
    body: SignalPolicyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.signal_catalog import update_signal_policy

    policy = await update_signal_policy(
        session,
        auth.tenant,
        accept_roles=body.accept_roles,
        backlog_threshold=body.backlog_threshold,
    )
    return {**policy, "may_accept": True}


@router.get("/backlog")
async def list_signal_backlog(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Patterns interpretation keeps seeing that no hashtag covers yet."""
    from app.services.signal_catalog import read_backlog, signal_policy

    return {
        "items": read_backlog(auth.tenant),
        "threshold": signal_policy(auth.tenant)["backlog_threshold"],
    }


@router.post("/backlog/{key}/promote")
async def promote_signal_backlog(
    key: str,
    body: BacklogPromoteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Turn a recurring unknown pattern into a category with a new playbook."""
    auth.require_role("owner", "admin")
    from app.services.signal_catalog import promote_backlog_entry

    row = await promote_backlog_entry(
        session, auth.tenant, key, name=body.name, description=body.description
    )
    return (await _serialize_categories(session, auth.tenant.id, [row]))[0]


@router.delete("/backlog/{key}")
async def dismiss_signal_backlog(
    key: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.signal_catalog import dismiss_backlog_entry

    removed = await dismiss_backlog_entry(session, auth.tenant, key)
    return {"ok": True, "removed": removed}


@router.patch("/{tag_id}")
async def patch_category(
    tag_id: UUID,
    body: CategoryPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Edit a category's intake settings or playbook. ``workstream_id: null`` makes it a free tag again."""
    auth.require_role("owner", "admin")
    from app.services.signal_tags import set_tag_playbook

    row = await svc.get_category(session, auth.tenant.id, tag_id)
    patch = body.model_dump(exclude_unset=True)
    if "workstream_id" in patch and patch["workstream_id"] != row.workstream_id:
        try:
            row = await set_tag_playbook(
                session, auth.tenant.id, row.id, workstream_id=patch["workstream_id"], commit=False
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    svc.apply_category_config(row, patch)
    if patch.get("description") is not None:
        row.description = str(patch["description"]).strip()[:300]
    if patch.get("show_in_nav") is not None:
        row.show_in_nav = bool(patch["show_in_nav"])
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return (await _serialize_categories(session, auth.tenant.id, [row]))[0]


@ticket_router.get("/{signal_id}/ticket")
async def get_ticket(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The conversation's ticket (category, stage, pipeline, project choices) or null."""
    signal = await svc._signal(session, auth.tenant.id, signal_id)
    return {"ticket": await svc.ticket_payload(session, signal)}


@ticket_router.put("/{signal_id}/ticket")
async def file_ticket(
    signal_id: UUID,
    body: TicketFileBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """File a category on the conversation. Replaces another category it had."""
    tag_id = body.tag_id
    if tag_id is None and body.tag:
        found = await svc.find_category(session, auth.tenant.id, body.tag)
        if found is None:
            raise HTTPException(status_code=404, detail="Category not found")
        tag_id = found.id
    if tag_id is None:
        raise HTTPException(status_code=400, detail="tag_id or tag is required")
    return await svc.file_ticket(
        session,
        auth.tenant.id,
        signal_id=signal_id,
        tag_id=tag_id,
        project_id=body.project_id,
        project_chosen="project_id" in body.model_fields_set,
        fields=body.fields,
        actor="operator",
        created_by_type="user",
        created_by_id=str(auth.user.id),
        user_id=auth.user.id,
    )


@ticket_router.patch("/{signal_id}/ticket")
async def patch_ticket(
    signal_id: UUID,
    body: TicketPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Accept or dismiss a proposal, move the ticket, or change its project."""
    if body.status == "open":
        from app.services.signal_catalog import may_accept_signals

        signal = await svc._signal(session, auth.tenant.id, signal_id)
        if signal.ticket_status == "proposed" and not may_accept_signals(auth.tenant, auth.role):
            raise HTTPException(
                status_code=403,
                detail="Only owners and admins may accept tickets in this workspace.",
            )
    ticket = await svc.update_ticket(
        session,
        auth.tenant.id,
        signal_id,
        body.model_dump(exclude_unset=True),
        actor_type="user",
        actor_id=str(auth.user.id),
    )
    return {"ticket": ticket}


@ticket_router.delete("/{signal_id}/ticket")
async def clear_ticket(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Take the category off the conversation and cancel its playbook run."""
    signal = await svc._signal(session, auth.tenant.id, signal_id)
    await svc.clear_ticket(session, signal)
    await session.commit()
    return {"ticket": None}


@board_router.get("/{project_id}/board")
async def project_board(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The project's playbooks, stacked, each with its stages and the tickets filed on this project."""
    project = await session.get(Project, project_id)
    if project is None or project.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"playbooks": await svc.project_board(session, auth.tenant.id, project_id)}
