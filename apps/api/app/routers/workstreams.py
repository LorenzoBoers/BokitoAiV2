from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.orchestra import Workstream
from app.services import workstreams as svc

router = APIRouter(prefix="/workstreams", tags=["workstreams"])


class WorkstreamCreateBody(BaseModel):
    name: str
    description: str = ""
    stages: list[dict[str, Any]] | None = None
    # Omitted values use the flow-label default (blue + route). Empty string clears the mark.
    color: str | None = None
    icon: str | None = None


class WorkstreamPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    tag_ids: list[UUID] | None = None
    stages: list[dict[str, Any]] | None = None


class RunStartBody(BaseModel):
    input_kind: str = "manual"
    input_text: str = ""
    input_ref: str = ""
    signal_id: UUID | None = None
    project_id: UUID | None = None


class RunResumeBody(BaseModel):
    input_text: str = ""


@router.get("")
async def list_workstreams(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    project_id: UUID | None = None,
):
    return {"items": await svc.list_workstreams(session, auth.tenant.id, project_id=project_id)}


@router.post("")
async def create_workstream(
    body: WorkstreamCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a flow and make its hashtag the flow's one action tag."""
    auth.require_role("owner", "admin")
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.signal import SignalTag
    from app.services.signal_tags import (
        FLOW_LABEL_COLOR,
        FLOW_LABEL_ICON,
        flow_label_color,
        flow_label_icon,
        normalize_tag,
    )
    from app.services.tickets import validate_stages

    tag_name = normalize_tag(body.name)
    if not tag_name:
        raise HTTPException(status_code=400, detail="A flow needs a hashtag name")
    tag = (
        await session.execute(
            select(SignalTag).where(
                SignalTag.tenant_id == auth.tenant.id, SignalTag.name == tag_name
            )
        )
    ).scalar_one_or_none()
    if tag is not None and tag.workstream_id is not None:
        raise HTTPException(
            status_code=400, detail=f"#{tag_name} is already the action tag of another flow"
        )

    ws = Workstream(
        tenant_id=auth.tenant.id,
        name=tag_name[:120],
        description=body.description,
    )
    if body.stages is not None:
        from app.services.stage_checkups import validate_stage_owners

        ws.stages_json = validate_stages(body.stages)
        await validate_stage_owners(session, auth.tenant.id, ws.stages_json)
    else:
        # A flow is its stages: without them tickets have nowhere to move and
        # the board renders empty. Seed the default pipeline; edit afterwards.
        from app.services.tickets import default_stages_json

        ws.stages_json = default_stages_json()
    session.add(ws)
    await session.flush()
    from app.services.setup_links import sync_flow_stages

    await sync_flow_stages(session, ws)
    label_color = flow_label_color(body.color if body.color is not None else FLOW_LABEL_COLOR)
    label_icon = flow_label_icon(body.icon if body.icon is not None else FLOW_LABEL_ICON)
    if tag is None:
        tag = SignalTag(
            tenant_id=auth.tenant.id,
            name=tag_name,
            description=body.description,
            created_by_user_id=auth.user.id,
        )
    tag.color = label_color
    tag.icon = label_icon
    tag.workstream_id = ws.id
    tag.show_in_nav = True
    session.add(tag)
    await session.commit()
    await session.refresh(ws)
    return await svc.serialize_workstream_full(session, ws)


@router.get("/runs")
async def list_all_runs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    workstream_id: UUID | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
):
    return {
        "items": await svc.list_runs(
            session,
            auth.tenant.id,
            workstream_id=workstream_id,
            project_id=project_id,
            limit=limit,
        )
    }


@router.get("/runs/{run_id}")
async def get_run_detail(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.run_detail(session, auth.tenant.id, run_id)


@router.post("/runs/{run_id}/resume")
async def resume_run(
    run_id: UUID,
    body: RunResumeBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.resume_run(
        session, auth.tenant.id, run_id, input_text=body.input_text
    )
    return svc.serialize_run(run)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.cancel_run(session, auth.tenant.id, run_id)
    return svc.serialize_run(run)


@router.post("/runs/{run_id}/promote")
async def promote_run(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Distill a completed run into a knowledge section via an agent job."""
    return await svc.promote_run_to_knowledge(session, auth.tenant.id, run_id)


@router.get("/{workstream_id}")
async def get_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ws = await svc.get_workstream(session, auth.tenant.id, workstream_id)
    return await svc.serialize_workstream_full(session, ws)


@router.get("/{workstream_id}/board")
async def get_workstream_board(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The flow's live tickets: columns are its stages; lanes are folders that
    share the flow's action tag (plus `id: null` for tickets without a project)."""
    from app.services.tickets import workstream_board

    return await workstream_board(session, auth.tenant.id, workstream_id)


@router.patch("/{workstream_id}")
async def patch_workstream(
    workstream_id: UUID,
    body: WorkstreamPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    ws = await svc.get_workstream(session, auth.tenant.id, workstream_id)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and str(patch["name"]).strip():
        ws.name = str(patch["name"]).strip()
    if "description" in patch and patch["description"] is not None:
        ws.description = str(patch["description"])
    stages_changed = False
    if patch.get("stages") is not None:
        from app.services.stage_checkups import validate_stage_owners
        from app.services.tickets import validate_stages

        stages_json = validate_stages(patch["stages"])
        await validate_stage_owners(session, auth.tenant.id, stages_json)
        stages_changed = stages_json != ws.stages_json
        ws.stages_json = stages_json
        from app.services.setup_links import sync_flow_stages

        await sync_flow_stages(session, ws)
    if patch.get("tag_ids") is not None:
        await _set_playbook_tags(session, auth.tenant.id, ws, patch["tag_ids"])
    from datetime import datetime

    ws.updated_at = datetime.utcnow()
    session.add(ws)
    if stages_changed:
        from app.services.stage_checkups import resync_flow

        await resync_flow(session, ws)
    await session.commit()
    await session.refresh(ws)
    return await svc.serialize_workstream_full(session, ws)


async def _set_playbook_tags(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, tag_ids: list[UUID]
) -> None:
    """The flow's one action tag. Setting a tag moves it here from any other
    flow; an empty list turns the current one back into a free hashtag.

    The stored ``name`` is the operator title and stays independent. Only seed
    it from the tag when the title is still empty.
    """
    from datetime import datetime

    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.signal import SignalTag
    from app.services.signal_tags import set_tag_playbook

    wanted = set(tag_ids)
    if len(wanted) > 1:
        raise HTTPException(status_code=400, detail="A flow has exactly one action tag")
    current = {
        row.id
        for row in (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id, SignalTag.workstream_id == ws.id
                )
            )
        ).scalars()
    }
    try:
        for tag_id in current - wanted:
            await set_tag_playbook(session, tenant_id, tag_id, workstream_id=None, commit=False)
        for tag_id in wanted - current:
            await set_tag_playbook(session, tenant_id, tag_id, workstream_id=ws.id, commit=False)
            tag = await session.get(SignalTag, tag_id)
            if tag is not None:
                tag.show_in_nav = True
                session.add(tag)
    except (ValueError, LookupError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not (ws.name or "").strip():
        linked = (
            await session.execute(
                select(SignalTag.name)
                .where(SignalTag.tenant_id == tenant_id, SignalTag.workstream_id == ws.id)
                .order_by(SignalTag.name)
            )
        ).scalars().all()
        if linked:
            ws.name = str(linked[0])[:120]
            ws.updated_at = datetime.utcnow()
            session.add(ws)


@router.delete("/{workstream_id}")
async def delete_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    await svc.delete_workstream(session, auth.tenant.id, workstream_id)
    await session.commit()
    return {"ok": True}


@router.post("/{workstream_id}/runs")
async def start_run(
    workstream_id: UUID,
    body: RunStartBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.start_run(
        session,
        auth.tenant.id,
        workstream_id,
        input_kind=body.input_kind,
        input_text=body.input_text,
        input_ref=body.input_ref,
        signal_id=body.signal_id,
        project_id=body.project_id,
        triggered_by_type="user",
        triggered_by_id=str(auth.user.id),
    )
    return svc.serialize_run(run)


@router.get("/{workstream_id}/runs")
async def list_runs(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 50,
):
    return {
        "items": await svc.list_runs(
            session, auth.tenant.id, workstream_id=workstream_id, limit=limit
        )
    }
