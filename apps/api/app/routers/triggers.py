"""Triggers API: scheduled wakes (cron/interval/heartbeat/webhook/once/event)
and agenda calendar occurrences."""

from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.middleware.rate_limit import rate_limit
from app.models.trigger import TRIGGER_KINDS, Trigger
from app.services import triggers as svc

router = APIRouter(tags=["triggers"])


def _naive_utc(value: datetime | None) -> datetime | None:
    """Normalize possibly tz-aware input to the naive-UTC convention used in the DB."""
    if value is None or value.tzinfo is None:
        return value
    from datetime import timezone

    return value.astimezone(timezone.utc).replace(tzinfo=None)


class TriggerCreateBody(BaseModel):
    name: str
    kind: str
    cron_expr: str = ""
    interval_minutes: int = 0
    agent_id: UUID | None = None
    agent_role: str = "orchestra"
    workstream_id: UUID | None = None
    instructions: str = ""
    enabled: bool = True
    run_at: datetime | None = None


class TriggerUpdateBody(BaseModel):
    name: str | None = None
    kind: str | None = None
    cron_expr: str | None = None
    interval_minutes: int | None = None
    agent_id: UUID | None = None
    agent_role: str | None = None
    workstream_id: UUID | None = None
    instructions: str | None = None
    enabled: bool | None = None
    run_at: datetime | None = None


@router.get("/agenda")
async def agenda(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
    agent_id: UUID | None = Query(None),
    sources: str | None = Query(
        None, description="Comma list of session, wake, calendar, follow_up (default all)"
    ),
    scheduled_only: bool = Query(
        False, description="Only sessions fired by a trigger (planning view)"
    ),
):
    """Time items in a window: agent sessions, planned wakes, calendar events
    and conversation follow-ups, in one shape. Agenda, the agent activity
    timeline and agent detail all read this endpoint."""
    now = datetime.utcnow()
    start = _naive_utc(from_) or now - timedelta(days=1)
    end = _naive_utc(to) or now + timedelta(days=14)
    if end <= start:
        raise HTTPException(status_code=400, detail="`to` must be after `from`")
    if end - start > timedelta(days=92):
        raise HTTPException(status_code=400, detail="Window too large (max 92 days)")
    from app.services.time_items import list_time_items

    wanted = [s.strip() for s in sources.split(",") if s.strip()] if sources else None
    items = await list_time_items(
        session,
        auth.tenant.id,
        start=start,
        end=end,
        agent_id=agent_id,
        sources=wanted,
        scheduled_only=scheduled_only,
    )
    return {
        "items": items,
        "now": now.replace(microsecond=0).isoformat(),
        "from": start.replace(microsecond=0).isoformat(),
        "to": end.replace(microsecond=0).isoformat(),
    }


@router.get("/triggers")
async def list_triggers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    kind: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
):
    stmt = select(Trigger).where(Trigger.tenant_id == auth.tenant.id, Trigger.deleted_at.is_(None))
    if kind:
        stmt = stmt.where(Trigger.kind == kind)
    stmt = stmt.order_by(Trigger.created_at).limit(limit)
    result = await session.execute(stmt)
    return {"triggers": [svc.serialize_trigger(t) for t in result.scalars().all()]}


@router.post("/triggers")
async def create_trigger(
    body: TriggerCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.kind not in TRIGGER_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid trigger kind: {body.kind}")
    trigger = await svc.create_trigger(
        session,
        auth.tenant.id,
        name=body.name,
        kind=body.kind,
        cron_expr=body.cron_expr,
        interval_minutes=body.interval_minutes,
        agent_id=body.agent_id,
        agent_role=body.agent_role,
        workstream_id=body.workstream_id,
        instructions=body.instructions,
        enabled=body.enabled,
        run_at=_naive_utc(body.run_at),
    )
    data = svc.serialize_trigger(trigger)
    # The webhook secret is only revealed once, at creation time.
    if trigger.webhook_secret:
        data["webhook_secret"] = trigger.webhook_secret
    return data


@router.patch("/triggers/{trigger_id}")
async def update_trigger(
    trigger_id: UUID,
    body: TriggerUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    trigger = await svc.get_trigger(session, auth.tenant.id, trigger_id)
    updates = body.model_dump(exclude_unset=True)
    run_at = _naive_utc(updates.pop("run_at", None))
    new_kind = updates.get("kind")
    if new_kind is not None and new_kind not in TRIGGER_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid trigger kind: {new_kind}")
    for field, value in updates.items():
        setattr(trigger, field, value)
    if trigger.kind == "cron" and svc.next_cron_run(trigger.cron_expr, trigger.created_at) is None:
        raise HTTPException(status_code=400, detail="Invalid cron expression")
    if trigger.kind in ("once", "event"):
        # One-shots keep their scheduled moment unless explicitly rescheduled.
        if run_at is not None:
            trigger.next_run_at = run_at
        elif "kind" in updates:
            # Kind changed into a one-shot without a new run_at — keep existing next_run_at if set.
            pass
    else:
        trigger.next_run_at = svc.compute_next_run(trigger)
    session.add(trigger)
    await session.commit()
    await session.refresh(trigger)
    return svc.serialize_trigger(trigger)


@router.delete("/triggers/{trigger_id}")
async def delete_trigger(
    trigger_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.trash import load_tenant, move_to_bin

    trigger = await svc.get_trigger(session, auth.tenant.id, trigger_id)
    await move_to_bin(
        session,
        await load_tenant(session, auth.tenant.id),
        resource_type="trigger",
        row=trigger,
        user_id=auth.user.id if auth.user else None,
        commit=True,
    )
    return {"ok": True}


@router.post("/triggers/{trigger_id}/run")
async def run_trigger(
    trigger_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    trigger = await svc.get_trigger(session, auth.tenant.id, trigger_id)
    return await svc.fire_trigger(session, trigger)


@router.post("/triggers/{trigger_id}/rotate-webhook-secret")
async def rotate_webhook_secret(
    trigger_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    trigger, secret = await svc.rotate_webhook_secret(session, auth.tenant.id, trigger_id)
    data = svc.serialize_trigger(trigger)
    data["webhook_secret"] = secret
    return data


@router.post("/triggers/{trigger_id}/test-webhook")
async def test_webhook(
    trigger_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.test_webhook_trigger(session, auth.tenant.id, trigger_id)


@router.post("/hooks/{trigger_id}", dependencies=[Depends(rate_limit("webhook-fire", limit=60))])
async def webhook_fire(
    trigger_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    payload: dict | None = None,
    x_bokito_secret: Annotated[str | None, Header()] = None,
    secret: str | None = Query(None),
):
    """Public webhook endpoint; authenticated by the trigger's shared secret."""
    result = await session.execute(select(Trigger).where(Trigger.id == trigger_id))
    trigger = result.scalar_one_or_none()
    if not trigger or trigger.kind != "webhook" or not trigger.enabled:
        raise HTTPException(status_code=404, detail="Trigger not found")
    provided = x_bokito_secret or secret or ""
    if not trigger.webhook_secret or provided != trigger.webhook_secret:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    return await svc.fire_trigger(session, trigger, payload=payload)


# ── channel bindings (retired: ChannelAccount.default_agent_id is the route) ──

CHANNEL_BINDINGS_RETIRED = {
    "status": "retired",
    "hint": (
        "Channel routing is the default agent on each channel account. "
        "Set it under Settings → Channels (or the widget handling agent)."
    ),
}


def _channel_bindings_retired() -> JSONResponse:
    return JSONResponse(status_code=410, content=CHANNEL_BINDINGS_RETIRED)


@router.get("/channels/bindings")
async def list_bindings_retired() -> JSONResponse:
    return _channel_bindings_retired()


@router.post("/channels/bindings")
async def create_binding_retired() -> JSONResponse:
    return _channel_bindings_retired()


@router.patch("/channels/bindings/{binding_id}")
async def update_binding_retired(binding_id: UUID) -> JSONResponse:
    del binding_id
    return _channel_bindings_retired()


@router.delete("/channels/bindings/{binding_id}")
async def delete_binding_retired(binding_id: UUID) -> JSONResponse:
    del binding_id
    return _channel_bindings_retired()
