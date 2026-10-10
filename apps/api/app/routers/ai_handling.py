"""AI handling API: one setting, four layers (workspace, channel, contact, conversation).

Every response carries the resolved payload ``{effective, requested, source,
ceiling, clamped_by, reason, until_close, ...}`` so a picker can explain where
the value comes from and whether Govern caps it.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal
from app.services import ai_handling as svc

router = APIRouter(prefix="/ai-handling", tags=["ai-handling"])

Mode = Literal["manual", "assisted", "autonomous"]
Scope = Literal["workspace", "channel", "contact", "conversation"]


class PromotionProgress(BaseModel):
    drafts_resolved: int = 0
    unedited: int = 0
    target_drafts: int = 50
    target_rate: float = 0.8


class AiHandlingPayload(BaseModel):
    effective: Mode
    requested: Mode
    source: str
    source_label: str = ""
    ceiling: Mode
    clamped_by: str | None = None
    reason: str | None = None
    until_close: bool = False
    inherited: Mode
    inherited_source: str
    inherited_source_label: str = ""
    own: Mode | None = None
    promotion: PromotionProgress | None = None


class SafeguardSettings(BaseModel):
    certainty_threshold: int = Field(ge=1, le=10)
    new_contacts: bool


class BreakerSettings(BaseModel):
    enabled: bool
    max_autonomous_per_hour: int = Field(ge=1)
    max_negative_per_hour: int = Field(ge=1)


class DisclosureSettings(BaseModel):
    enabled: bool
    text: str = ""


AfterHumanReply = Literal["return_to_agent", "keep_with_human", "ask"]
ReopenOwner = Literal["same_owner", "route_again"]


class RoutingSettings(BaseModel):
    """Workspace routing policy (what happens around handovers)."""

    after_human_reply: AfterHumanReply = "return_to_agent"
    close_after_agent_reply: bool = False
    close_after_human_reply: bool = False
    reopen_owner: ReopenOwner = "same_owner"
    # Agent <-> people handovers per conversation per 24h before people keep it; 0 = off.
    bounce_limit: int = Field(default=3, ge=0, le=20)


class RoutingOverride(BaseModel):
    """Channel values; a null field follows the workspace default."""

    after_human_reply: AfterHumanReply | None = None
    close_after_agent_reply: bool | None = None
    close_after_human_reply: bool | None = None
    reopen_owner: ReopenOwner | None = None


class RoutingPolicyPayload(BaseModel):
    effective: RoutingOverride
    own: RoutingOverride
    inherited: RoutingOverride
    source: dict[str, str]
    bounce_limit: int


class ExceptionRow(BaseModel):
    id: str
    label: str = ""
    channel: str = ""
    mode: Mode | None = None
    address: str | None = None
    contact_name: str | None = None
    reason: str | None = None
    breaker_tripped_at: str | None = None


class Exceptions(BaseModel):
    channels: list[ExceptionRow]
    contacts: list[ExceptionRow]
    conversations: list[ExceptionRow]


class CatalogEntry(BaseModel):
    id: Mode
    icon: str
    tone: str


class AiHandlingOverview(BaseModel):
    workspace: AiHandlingPayload
    ceiling: Mode
    clamped_by: str | None = None
    safeguards: SafeguardSettings
    breaker: BreakerSettings
    disclosure: DisclosureSettings
    routing: RoutingSettings
    disclosure_preview: str | None = None
    catalog: list[CatalogEntry]
    exceptions: Exceptions
    can_raise: bool


class AiHandlingUpdate(BaseModel):
    mode: Mode | None = None
    reason: str | None = None
    # Take over: conversation scope + manual + assign the conversation to me.
    assign_to_me: bool = False


class AiHandlingSettingsUpdate(BaseModel):
    safeguards: SafeguardSettings | None = None
    breaker: BreakerSettings | None = None
    disclosure: DisclosureSettings | None = None
    routing: RoutingSettings | None = None


class Evidence(BaseModel):
    days: int
    drafts: int
    drafts_resolved: int
    unedited_rate: float | None = None
    escalations: int
    escalation_rate: float | None = None
    autonomous_replies: int


class OpenByMode(BaseModel):
    autonomous: int = 0
    assisted: int = 0
    manual: int = 0


class AiHandlingMetrics(BaseModel):
    days: int
    open_by_mode: OpenByMode
    open_total: int
    autonomous_replies: int
    handoffs: int
    handoff_rate: float | None = None
    assisted_edit_rate: float | None = None
    drafts_resolved: int


class AiHandlingPreview(BaseModel):
    scope: Scope
    target_id: str
    mode: Mode | None = None
    followers: int
    resulting: Mode
    evidence: Evidence
    allowed: bool


async def _overview(session: AsyncSession, auth: AuthContext) -> dict[str, Any]:
    from app.services.language import resolve_workspace_language

    tenant = auth.tenant
    settings = svc.workspace_settings(tenant)
    ceiling, clamped_by = svc.governance_ceiling(tenant)
    return {
        "workspace": svc.resolve_ai_handling(tenant, scope="workspace").to_payload(),
        "ceiling": ceiling,
        "clamped_by": clamped_by,
        "safeguards": settings["safeguards"],
        "breaker": settings["breaker"],
        "disclosure": settings["disclosure"],
        "routing": settings["routing"],
        "disclosure_preview": svc.disclosure_text(
            tenant, language=resolve_workspace_language(tenant)
        ),
        "catalog": svc.CATALOG,
        "exceptions": await svc.list_exceptions(session, tenant),
        "can_raise": auth.role in ("owner", "admin"),
    }


async def _target_payload(
    session: AsyncSession, auth: AuthContext, scope: str, target_id: str
) -> dict[str, Any]:
    tenant = auth.tenant
    if scope == "workspace":
        return svc.resolve_ai_handling(tenant, scope="workspace").to_payload()
    try:
        target_uuid = UUID(target_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
    if scope == "channel":
        account = await session.get(ChannelAccount, target_uuid)
        if account is None or account.tenant_id != tenant.id:
            raise HTTPException(status_code=404, detail="Channel not found")
        payload = svc.resolve_ai_handling(tenant, account, scope="channel").to_payload()
        from app.services.learning import PROMOTION_MIN_DRAFTS, PROMOTION_UNEDITED_RATE

        stats = await svc.evidence(session, tenant.id, account_id=account.id)
        payload["promotion"] = {
            "drafts_resolved": stats["drafts_resolved"],
            "unedited": stats["unedited"],
            "target_drafts": PROMOTION_MIN_DRAFTS,
            "target_rate": PROMOTION_UNEDITED_RATE,
        }
        return payload
    if scope == "contact":
        contact = await session.get(Contact, target_uuid)
        if contact is None or contact.tenant_id != tenant.id:
            raise HTTPException(status_code=404, detail="Contact not found")
        return svc.resolve_ai_handling(tenant, None, contact, scope="contact").to_payload()
    signal = await session.get(Signal, target_uuid)
    if signal is None or signal.tenant_id != tenant.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return (await svc.resolve_for_signal(session, tenant, signal)).to_payload()


@router.get("", response_model=AiHandlingOverview)
async def get_ai_handling(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Workspace default, Govern ceiling, safeguards, breaker, disclosure and
    every channel, contact and open conversation with its own value."""
    return await _overview(session, auth)


@router.get("/metrics", response_model=AiHandlingMetrics)
async def get_ai_handling_metrics(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    days: Annotated[int, Query(ge=1, le=90)] = 30,
):
    """Overview numbers: open conversations per effective mode, autonomous
    replies, handoffs (and their rate against autonomous replies) and how often
    people edited an assisted draft before sending, over the last ``days``."""
    return await svc.metrics(session, auth.tenant, days=days)


@router.put("/settings", response_model=AiHandlingOverview)
async def update_ai_handling_settings(
    body: AiHandlingSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Safeguards, breaker limits, AI disclosure and the routing policy (owner/admin).

    Routing: what happens after a person replies on an agent-owned
    conversation, whether replies close the conversation, who owns a reopened
    conversation and the bounce limit. Channels may override every routing
    value except the bounce limit (``PUT /ai-handling/channel/{id}/routing``).
    """
    from app.services.audit import record_audit

    auth.require_role("owner", "admin")
    before = svc.workspace_settings(auth.tenant)
    patch: dict[str, Any] = {}
    if body.safeguards is not None:
        patch["safeguards"] = body.safeguards.model_dump()
    if body.breaker is not None:
        patch["breaker"] = body.breaker.model_dump()
    if body.disclosure is not None:
        disclosure = body.disclosure.model_dump()
        disclosure["text"] = disclosure["text"].strip()[:200]
        patch["disclosure"] = disclosure
    if body.routing is not None:
        patch["routing"] = body.routing.model_dump()
    after = svc.update_workspace_block(auth.tenant, patch)
    session.add(auth.tenant)
    await record_audit(
        session,
        auth.tenant.id,
        action="ai_handling:settings",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="workspace",
        resource_id=str(auth.tenant.id),
        summary="AI handling safeguards, breaker or disclosure changed",
        before={k: before[k] for k in patch},
        after={k: after[k] for k in patch},
        commit=False,
    )
    await session.commit()
    return await _overview(session, auth)


async def _channel_for(session: AsyncSession, auth: AuthContext, account_id: UUID) -> ChannelAccount:
    account = await session.get(ChannelAccount, account_id)
    if account is None or account.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Channel not found")
    return account


@router.get("/channel/{account_id}/routing", response_model=RoutingPolicyPayload)
async def get_channel_routing(
    account_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Routing policy for one channel: effective values, the channel's own
    overrides, the inherited workspace defaults and per-key source."""
    account = await _channel_for(session, auth, account_id)
    return svc.resolve_routing(auth.tenant, account).to_payload()


@router.put("/channel/{account_id}/routing", response_model=RoutingPolicyPayload)
async def set_channel_routing(
    account_id: UUID,
    body: RoutingOverride,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Override routing values on one channel (owner/admin). Send a field as
    ``null`` to follow the workspace default again; omitted fields stay."""
    from app.services.audit import record_audit

    auth.require_role("owner", "admin")
    account = await _channel_for(session, auth, account_id)
    before = svc.channel_routing(account)
    patch = body.model_dump(exclude_unset=True)
    svc.set_account_routing(account, patch)
    session.add(account)
    await record_audit(
        session,
        auth.tenant.id,
        action="ai_handling:routing",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="channel",
        resource_id=str(account.id),
        summary=f"Routing policy changed on {account.display_name or account.address}",
        before=before,
        after=svc.channel_routing(account),
        commit=False,
    )
    await session.commit()
    return svc.resolve_routing(auth.tenant, account).to_payload()


@router.get("/{scope}/{target_id}", response_model=AiHandlingPayload)
async def get_target_handling(
    scope: Scope,
    target_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Resolved AI handling for one workspace, channel, contact or conversation."""
    return await _target_payload(session, auth, scope, target_id)


@router.put("/{scope}/{target_id}", response_model=AiHandlingPayload)
async def set_target_handling(
    scope: Scope,
    target_id: str,
    body: AiHandlingUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Set (or clear with ``mode: null``) one layer.

    Lowering is free. Raising to autonomous at channel, contact or workspace
    scope needs owner/admin; a member may set autonomous on a conversation only
    when its channel already resolves to autonomous. Conversation values are
    temporary: closing the conversation clears them. Take over is
    ``conversation`` + ``manual`` + ``assign_to_me``; hand back is ``mode: null``.
    """
    if scope == "workspace":
        target_id = str(auth.tenant.id)
    result = await svc.set_ai_handling(
        session,
        auth.tenant,
        scope,
        target_id,
        body.mode,
        actor_type="user",
        actor_id=str(auth.user.id),
        role=auth.role,
        reason=body.reason,
        assign_to_me=auth.user.id if body.assign_to_me else None,
    )
    return result.to_payload()


@router.get("/{scope}/{target_id}/preview", response_model=AiHandlingPreview)
async def preview_target_handling(
    scope: Scope,
    target_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    mode: Annotated[Mode | None, Query()] = None,
):
    """What a change would touch: open conversations following this layer,
    the resulting effective mode, and 30-day evidence for this channel."""
    tenant = auth.tenant
    if scope == "workspace":
        target_id = str(tenant.id)
    current = await _target_payload(session, auth, scope, target_id)
    ceiling = current["ceiling"]
    requested = mode or current["inherited"]
    resulting = svc.min_mode(requested, ceiling)
    account_id: UUID | None = None
    inherited_effective = None
    if scope == "channel":
        account_id = UUID(target_id)
    elif scope == "conversation":
        signal = await session.get(Signal, UUID(target_id))
        if signal is not None:
            account_id = signal.channel_account_id
            account, contact = await svc.load_layers(session, tenant.id, signal)
            inherited_effective = svc.resolve_ai_handling(
                tenant, account, contact, None, scope="contact"
            ).effective
    return {
        "scope": scope,
        "target_id": target_id,
        "mode": mode,
        "followers": await svc.follower_count(session, tenant, scope, target_id),
        "resulting": resulting,
        "evidence": await svc.evidence(session, tenant.id, account_id=account_id),
        "allowed": svc.can_set(auth.role, scope, mode, inherited_effective=inherited_effective),
    }


@router.post("/channel/{account_id}/reset-breaker", response_model=AiHandlingPayload)
async def reset_channel_breaker(
    account_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    keep_assisted: bool = False,
):
    """Clear a tripped breaker (owner/admin). ``keep_assisted`` pins the channel."""
    auth.require_role("owner", "admin")
    account = await session.get(ChannelAccount, account_id)
    if account is None or account.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Channel not found")
    await svc.reset_breaker(
        session, auth.tenant, account, keep_assisted=keep_assisted, actor_id=str(auth.user.id)
    )
    return svc.resolve_ai_handling(auth.tenant, account, scope="channel").to_payload()
