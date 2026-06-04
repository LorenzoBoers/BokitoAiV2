import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, tenant_settings
from app.models.inbox import FeedbackQueueItem, InboxSettings, MessageFeedback
from app.models.orchestra import (
    AgentProfile,
    Task,
    Workstream,
    WorkstreamRun,
    WorkstreamStepRun,
)
from app.models.notification import UserNotificationPreference
from app.models.policy import ActionPolicy, ActionWhitelistEntry, AssistantPersona
from app.services.orchestra_runner import run_workstream_mock, trigger_task

router = APIRouter(tags=["orchestra-settings", "inbox-settings", "policy"])


class InboxSettingsUpdate(BaseModel):
    autonomous_reply: bool | None = None
    certainty_threshold: int | None = None
    rules_text: str | None = None
    labeling_enabled: bool | None = None


class FeedbackCreate(BaseModel):
    score: int
    comment: str = ""


class PersonaUpdate(BaseModel):
    tone: str | None = None
    do_text: str | None = None
    dont_text: str | None = None


class PolicyUpdate(BaseModel):
    mode: str


class TaskCreate(BaseModel):
    name: str
    instructions: str = ""
    schedule_kind: str = "on_demand"
    schedule_expr: str = ""
    enabled: bool = True


class AgentProfileCreate(BaseModel):
    name: str
    provider: str = "platform"
    model: str = "claude-sonnet-4-20250514"
    system_prompt: str = ""
    max_tokens: int = 4096
    cost_aware: bool = False


class WorkstreamCreate(BaseModel):
    name: str
    description: str = ""


@router.get("/inbox/settings")
async def get_inbox_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == auth.tenant.id))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = InboxSettings(tenant_id=auth.tenant.id)
        session.add(settings_row)
        await session.commit()
        await session.refresh(settings_row)
    return {
        "autonomous_reply": settings_row.autonomous_reply,
        "certainty_threshold": settings_row.certainty_threshold,
        "rules_text": settings_row.rules_text,
        "labeling_enabled": settings_row.labeling_enabled,
    }


@router.put("/inbox/settings")
async def update_inbox_settings(
    body: InboxSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == auth.tenant.id))
    row = result.scalar_one_or_none() or InboxSettings(tenant_id=auth.tenant.id)
    if body.autonomous_reply is not None:
        row.autonomous_reply = body.autonomous_reply
    if body.certainty_threshold is not None:
        row.certainty_threshold = body.certainty_threshold
    if body.rules_text is not None:
        row.rules_text = body.rules_text
    if body.labeling_enabled is not None:
        row.labeling_enabled = body.labeling_enabled
    session.add(row)
    await session.commit()
    return {"ok": True}


@router.post("/messages/{message_id}/feedback")
async def create_feedback(
    message_id: UUID,
    body: FeedbackCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    fb = MessageFeedback(
        tenant_id=auth.tenant.id,
        message_id=message_id,
        score=body.score,
        comment=body.comment,
        author_user_id=auth.user.id,
    )
    session.add(fb)
    await session.flush()
    session.add(
        FeedbackQueueItem(tenant_id=auth.tenant.id, message_feedback_id=fb.id, status="pending")
    )
    await session.commit()
    return {"id": str(fb.id)}


@router.get("/policy")
async def get_policy(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(ActionPolicy).where(ActionPolicy.tenant_id == auth.tenant.id))
    policy = result.scalar_one_or_none()
    wl = await session.execute(
        select(ActionWhitelistEntry).where(ActionWhitelistEntry.tenant_id == auth.tenant.id)
    )
    return {
        "mode": policy.mode if policy else "whitelist",
        "whitelist": [
            {"id": str(e.id), "action_type": e.action_type, "scope_signature": e.scope_signature}
            for e in wl.scalars().all()
        ],
    }


@router.put("/policy")
async def update_policy(
    body: PolicyUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.mode not in ("manual", "whitelist", "yolo"):
        raise HTTPException(status_code=400, detail="Invalid mode")
    result = await session.execute(select(ActionPolicy).where(ActionPolicy.tenant_id == auth.tenant.id))
    policy = result.scalar_one_or_none() or ActionPolicy(tenant_id=auth.tenant.id)
    policy.mode = body.mode
    session.add(policy)
    await session.commit()
    return {"ok": True}


DEFAULT_NOTIFICATION_ROWS = [
    {"id": "unassigned", "label": "Activity from all unassigned conversations", "channels": {"desktop": True, "email": False, "mobile": False}},
    {"id": "assigned-to-me", "label": "Activity for conversations assigned to you", "channels": {"desktop": True, "email": True, "mobile": True}},
    {"id": "team-conversations", "label": "Activity from your team conversations", "channels": {"desktop": True, "email": False, "mobile": False}},
    {"id": "assigned-to-others", "label": "Activity from conversations assigned to other teammates", "channels": {"desktop": False, "email": False, "mobile": False}},
    {"id": "mentions", "label": "When you are mentioned in conversations", "channels": {"desktop": True, "email": True, "mobile": True}},
    {"id": "started-by-you", "label": "Activity on conversations you started", "channels": {"desktop": True, "email": True, "mobile": True}},
    {"id": "status-changes", "label": "Ticket status changes", "channels": {"desktop": True, "email": True, "mobile": True}},
]


class NotificationPrefsBody(BaseModel):
    rows: list[dict] | None = None


@router.get("/user/notification-preferences")
async def get_notification_preferences(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.tenant_id == auth.tenant.id,
            UserNotificationPreference.user_id == auth.user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row or not row.prefs_json.strip():
        return {"rows": DEFAULT_NOTIFICATION_ROWS}
    try:
        parsed = json.loads(row.prefs_json)
        if isinstance(parsed, list) and parsed:
            return {"rows": parsed}
    except json.JSONDecodeError:
        pass
    return {"rows": DEFAULT_NOTIFICATION_ROWS}


@router.patch("/user/notification-preferences")
async def patch_notification_preferences(
    body: NotificationPrefsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = body.rows if isinstance(body.rows, list) else DEFAULT_NOTIFICATION_ROWS
    result = await session.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.tenant_id == auth.tenant.id,
            UserNotificationPreference.user_id == auth.user.id,
        )
    )
    pref = result.scalar_one_or_none() or UserNotificationPreference(
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
    )
    pref.prefs_json = json.dumps(rows)
    session.add(pref)
    await session.commit()
    return {"rows": rows}


@router.get("/persona")
async def get_persona(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(AssistantPersona).where(AssistantPersona.tenant_id == auth.tenant.id)
    )
    persona = result.scalar_one_or_none()
    if not persona:
        return {"tone": "", "do_text": "", "dont_text": ""}
    return {"tone": persona.tone, "do_text": persona.do_text, "dont_text": persona.dont_text}


@router.put("/persona")
async def update_persona(
    body: PersonaUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(AssistantPersona).where(AssistantPersona.tenant_id == auth.tenant.id)
    )
    persona = result.scalar_one_or_none() or AssistantPersona(tenant_id=auth.tenant.id)
    if body.tone is not None:
        persona.tone = body.tone
    if body.do_text is not None:
        persona.do_text = body.do_text
    if body.dont_text is not None:
        persona.dont_text = body.dont_text
    session.add(persona)
    await session.commit()
    return {"ok": True}


orchestra_router = APIRouter(prefix="/orchestra", tags=["orchestra"])


@orchestra_router.get("/settings")
async def orchestra_settings(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    settings = tenant_settings(auth.tenant)
    return {
        "orchestra_enabled": settings.get("orchestra_enabled", False),
        "monthly_budget_cents": settings.get("monthly_budget_cents", 0),
    }


@orchestra_router.get("/tasks")
async def list_tasks(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(Task).where(Task.tenant_id == auth.tenant.id))
    return [
        {
            "id": str(t.id),
            "name": t.name,
            "schedule_kind": t.schedule_kind,
            "enabled": t.enabled,
        }
        for t in result.scalars().all()
    ]


@orchestra_router.post("/tasks")
async def create_task(
    body: TaskCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    task = Task(tenant_id=auth.tenant.id, **body.model_dump())
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return {"id": str(task.id)}


@orchestra_router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await trigger_task(session, task_id, auth.tenant.id)
    return {"ok": True}


@orchestra_router.get("/agent-profiles")
async def list_profiles(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(AgentProfile).where(AgentProfile.tenant_id == auth.tenant.id))
    return [{"id": str(p.id), "name": p.name, "model": p.model} for p in result.scalars().all()]


@orchestra_router.post("/agent-profiles")
async def create_profile(
    body: AgentProfileCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    profile = AgentProfile(tenant_id=auth.tenant.id, **body.model_dump())
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return {"id": str(profile.id)}


@orchestra_router.get("/workstreams")
async def list_workstreams(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(Workstream).where(Workstream.tenant_id == auth.tenant.id))
    return [{"id": str(w.id), "name": w.name, "enabled": w.enabled} for w in result.scalars().all()]


@orchestra_router.post("/workstreams")
async def create_workstream(
    body: WorkstreamCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    ws = Workstream(tenant_id=auth.tenant.id, **body.model_dump())
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return {"id": str(ws.id)}


@orchestra_router.post("/workstreams/{workstream_id}/run")
async def run_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await run_workstream_mock(session, auth.tenant.id, workstream_id)
    return {"run_id": str(run.id), "status": run.status}


@orchestra_router.get("/workstream-runs")
async def list_runs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(WorkstreamRun).where(WorkstreamRun.tenant_id == auth.tenant.id).order_by(WorkstreamRun.started_at.desc())
    )
    return [
        {"id": str(r.id), "status": r.status, "started_at": r.started_at.isoformat()}
        for r in result.scalars().all()
    ]


@orchestra_router.get("/workstream-runs/{run_id}")
async def get_run(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run_result = await session.execute(
        select(WorkstreamRun).where(WorkstreamRun.id == run_id, WorkstreamRun.tenant_id == auth.tenant.id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    steps = await session.execute(
        select(WorkstreamStepRun).where(WorkstreamStepRun.run_id == run_id).order_by(WorkstreamStepRun.created_at)
    )
    return {
        "id": str(run.id),
        "status": run.status,
        "report": json.loads(run.report_json or "{}"),
        "steps": [
            {
                "id": str(s.id),
                "status": s.status,
                "log": s.log_text,
                "iteration": s.iteration,
            }
            for s in steps.scalars().all()
        ],
    }
