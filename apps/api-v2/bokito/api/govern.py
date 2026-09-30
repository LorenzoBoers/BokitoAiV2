"""Govern: policy, changes, audit, API tokens, usage, outcomes, feedback."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from bokito.api.schemas import (
    ApiTokenOut,
    AuditEventOut,
    ChangeOut,
    FeedbackOut,
    PolicyOut,
    ToolOutcomeOut,
)
from bokito.deps import DbSession, Operator
from bokito.domain.base import utcnow
from bokito.domain.govern import ChangeStatus
from bokito.domain.identity import ApiToken, Role
from bokito.domain.metering import Feedback, FeedbackVerdict
from bokito.errors import NotFound
from bokito.services import audit, identity
from bokito.services import govern as govern_svc
from bokito.services import outcomes as outcomes_svc
from bokito.services import policy as policy_svc
from bokito.services import usage as usage_svc
from bokito.tools import execute_tool

router = APIRouter(tags=["govern"])


# Policy ---------------------------------------------------------------------


@router.get("/govern/policy", response_model=PolicyOut, summary="Autonomy policy")
async def get_policy(session: DbSession, principal: Operator) -> PolicyOut:
    policy = await policy_svc.get_policy(session, principal.tenant_id)
    await session.commit()
    return PolicyOut.model_validate(policy)


class PostureIn(BaseModel):
    posture: Literal["manual", "assisted", "autonomous"]


@router.post(
    "/govern/policy/posture",
    response_model=ToolOutcomeOut,
    summary="Set posture (tool: set_posture)",
)
async def set_posture(body: PostureIn, session: DbSession, principal: Operator) -> ToolOutcomeOut:
    principal.require_role(Role.admin)
    outcome = await execute_tool(session, principal, "set_posture", {"posture": body.posture})
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


class AllowanceIn(BaseModel):
    category: Literal["read", "write", "communicate", "external", "destructive"] | None = None
    tool_name: str | None = None
    verdict: Literal["allow", "ask", "deny"] | None = None


@router.post(
    "/govern/policy/allowances",
    response_model=PolicyOut,
    summary="Set allowance (tool: set_allowance)",
)
async def set_allowance(body: AllowanceIn, session: DbSession, principal: Operator) -> PolicyOut:
    principal.require_role(Role.admin)
    await execute_tool(session, principal, "set_allowance", body.model_dump())
    await session.commit()
    return PolicyOut.model_validate(await policy_svc.get_policy(session, principal.tenant_id))


class DisclosureIn(BaseModel):
    disclosure_text: str = Field(max_length=500)


@router.put(
    "/govern/policy/disclosure", response_model=PolicyOut, summary="AI disclosure text (Art. 50)"
)
async def set_disclosure(body: DisclosureIn, session: DbSession, principal: Operator) -> PolicyOut:
    principal.require_role(Role.admin)
    policy = await policy_svc.get_policy(session, principal.tenant_id)
    before = govern_svc.policy_snapshot(policy)
    policy.disclosure_text = body.disclosure_text.strip()
    await govern_svc.record_change(
        session,
        principal.tenant_id,
        target_kind="policy",
        target_id=policy.id,
        title="Disclosure text changed",
        before=before,
        after=govern_svc.policy_snapshot(policy),
        proposed_by=principal.actor,
        applied=True,
        applied_by_user_id=principal.user_id,
    )
    await session.commit()
    return PolicyOut.model_validate(policy)


# Changes --------------------------------------------------------------------


@router.get("/govern/changes", response_model=list[ChangeOut], summary="Platform changes")
async def list_changes(
    session: DbSession,
    principal: Operator,
    status: ChangeStatus | None = None,
    limit: int = Query(default=50, le=200),
) -> list[ChangeOut]:
    rows = await govern_svc.list_changes(session, principal.tenant_id, status=status, limit=limit)
    return [ChangeOut.model_validate(c) for c in rows]


@router.post(
    "/govern/changes/{change_id}/apply", response_model=ChangeOut, summary="Apply a draft change"
)
async def apply_change(change_id: uuid.UUID, session: DbSession, principal: Operator) -> ChangeOut:
    principal.require_role(Role.admin)
    change = await govern_svc.get_change(session, principal.tenant_id, change_id)
    await govern_svc.apply_change(session, change, user_id=principal.user_id)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="change.apply",
        target_kind="change",
        target_id=change.id,
    )
    await session.commit()
    return ChangeOut.model_validate(change)


@router.post(
    "/govern/changes/{change_id}/reject", response_model=ChangeOut, summary="Reject a draft change"
)
async def reject_change(change_id: uuid.UUID, session: DbSession, principal: Operator) -> ChangeOut:
    principal.require_role(Role.admin)
    change = await govern_svc.get_change(session, principal.tenant_id, change_id)
    await govern_svc.reject_change(session, change)
    await session.commit()
    return ChangeOut.model_validate(change)


@router.post(
    "/govern/changes/{change_id}/rollback",
    response_model=ChangeOut,
    summary="Roll back an applied change",
)
async def rollback_change(
    change_id: uuid.UUID, session: DbSession, principal: Operator
) -> ChangeOut:
    principal.require_role(Role.admin)
    change = await govern_svc.get_change(session, principal.tenant_id, change_id)
    await govern_svc.rollback_change(session, change)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="change.rollback",
        target_kind="change",
        target_id=change.id,
    )
    await session.commit()
    return ChangeOut.model_validate(change)


# Audit ----------------------------------------------------------------------


@router.get("/govern/audit", response_model=list[AuditEventOut], summary="Audit log")
async def list_audit(
    session: DbSession,
    principal: Operator,
    action: str | None = None,
    conversation_id: uuid.UUID | None = None,
    before: uuid.UUID | None = None,
    limit: int = Query(default=100, le=500),
) -> list[AuditEventOut]:
    rows = await audit.list_events(
        session,
        principal.tenant_id,
        action=action,
        conversation_id=conversation_id,
        limit=limit,
        before=before,
    )
    return [AuditEventOut.model_validate(e) for e in rows]


# API tokens -----------------------------------------------------------------


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=list)


class TokenCreated(ApiTokenOut):
    token: str


@router.get("/govern/tokens", response_model=list[ApiTokenOut], summary="API tokens")
async def list_tokens(session: DbSession, principal: Operator) -> list[ApiTokenOut]:
    principal.require_role(Role.admin)
    rows = (
        await session.scalars(
            select(ApiToken)
            .where(ApiToken.tenant_id == principal.tenant_id)
            .order_by(ApiToken.created_at.desc())
        )
    ).all()
    return [ApiTokenOut.model_validate(t) for t in rows]


@router.post(
    "/govern/tokens", response_model=TokenCreated, status_code=201, summary="Create an API token"
)
async def create_token(body: TokenCreate, session: DbSession, principal: Operator) -> TokenCreated:
    principal.require_role(Role.admin)
    raw, token = await identity.create_api_token(
        session,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        name=body.name,
        scopes=body.scopes,
    )
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="token.create",
        target_kind="api_token",
        target_id=token.id,
    )
    await session.commit()
    return TokenCreated(**ApiTokenOut.model_validate(token).model_dump(), token=raw)


@router.delete("/govern/tokens/{token_id}", status_code=204, summary="Revoke an API token")
async def revoke_token(token_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    token = await session.get(ApiToken, token_id)
    if not token or token.tenant_id != principal.tenant_id:
        raise NotFound("token not found", code="token_not_found")
    token.revoked_at = utcnow()
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="token.revoke",
        target_kind="api_token",
        target_id=token.id,
    )
    await session.commit()


# Usage, outcomes, feedback --------------------------------------------------


@router.get("/usage", summary="Usage report for a period", response_model=dict)
async def usage_report(
    session: DbSession,
    principal: Operator,
    since: datetime | None = None,
    until: datetime | None = None,
) -> dict[str, Any]:
    return await usage_svc.period_report(session, principal.tenant_id, since=since, until=until)


@router.get("/outcomes", summary="Outcome summary", response_model=dict)
async def outcomes_summary(
    session: DbSession, principal: Operator, since: datetime | None = None
) -> dict[str, Any]:
    return await outcomes_svc.summary(session, principal.tenant_id, since=since)


@router.post("/outcomes/compute", summary="Compute outcomes now", response_model=dict)
async def compute_outcomes(session: DbSession, principal: Operator) -> dict[str, Any]:
    n = await outcomes_svc.compute_all(session, tenant_id=principal.tenant_id)
    await session.commit()
    return {"computed": n}


class FeedbackIn(BaseModel):
    conversation_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    verdict: FeedbackVerdict
    comment: str = ""
    correction: str = ""
    learn: bool = Field(default=False, description="Store the correction as a knowledge snippet")


@router.post(
    "/feedback",
    response_model=FeedbackOut,
    status_code=201,
    summary="Give feedback on an agent action",
)
async def give_feedback(body: FeedbackIn, session: DbSession, principal: Operator) -> FeedbackOut:
    fb = Feedback(
        tenant_id=principal.tenant_id,
        conversation_id=body.conversation_id,
        message_id=body.message_id,
        run_id=body.run_id,
        agent_id=body.agent_id,
        verdict=body.verdict,
        comment=body.comment,
        correction=body.correction,
        by_user_id=principal.user_id,
        created_at=utcnow(),
    )
    session.add(fb)
    await session.flush()
    if body.learn and body.correction.strip():
        from bokito.domain.orient import DocKind
        from bokito.services import knowledge as kb

        doc = await kb.upsert(
            session,
            principal.tenant_id,
            title=f"Correction {utcnow():%Y-%m-%d %H:%M}",
            body=body.correction.strip(),
            kind=DocKind.snippet,
            path=f"snippets/correction-{fb.id.hex[:8]}.md",
            published=False,
            ai_maintained=False,
            source="feedback",
        )
        fb.learned_doc_id = doc.id
    await session.commit()
    return FeedbackOut.model_validate(fb)


@router.get("/feedback", response_model=list[FeedbackOut], summary="Recent feedback")
async def list_feedback(
    session: DbSession, principal: Operator, limit: int = Query(default=50, le=200)
) -> list[FeedbackOut]:
    rows = (
        await session.scalars(
            select(Feedback)
            .where(Feedback.tenant_id == principal.tenant_id)
            .order_by(Feedback.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [FeedbackOut.model_validate(f) for f in rows]
