"""AI handling: how the AI treats a conversation (autonomous / assisted / manual).

One layered setting replaces the old channel-type modes, mailbox ``ai_config.mode``,
``Signal.ai_paused`` takeover and ``inbox.autonomous_reply``:

- ``autonomous`` replies and acts on its own within Govern (consequential tools ask).
- ``assisted`` drafts replies and proposes actions; read-only tools only.
- ``manual`` does not act unprompted; on-demand AI stays available.

Resolution: workspace default -> channel (ChannelAccount) -> contact -> conversation.
The most specific non-null layer wins. The result is capped by a ceiling:
privacy-off means manual, the Govern ``messaging`` allowance (deny/ask/allow ->
manual/assisted/autonomous) and a tripped channel breaker (assisted).

Conversation overrides are temporary: closing clears them, Take over sets
manual (reason ``operator_takeover``), hand back clears them. Assigning a
person no longer holds the conversation: the owner says who is responsible,
the AI handling says what the agent may do.

Routing policy (``settings_json.ai_handling.routing``, channel override in
``ai_config.routing``): what happens after a person replies on an agent-owned
conversation, whether replies close the conversation, who owns a reopened
conversation, and the bounce limit between agent and people.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal, SignalEvent

AiHandlingMode = Literal["manual", "assisted", "autonomous"]
AiHandlingScope = Literal["workspace", "channel", "contact", "conversation"]

AI_HANDLING_MODES: tuple[str, ...] = ("manual", "assisted", "autonomous")
AI_HANDLING_SCOPES: tuple[str, ...] = ("workspace", "channel", "contact", "conversation")
_RANK = {mode: index for index, mode in enumerate(AI_HANDLING_MODES)}

DEFAULT_WORKSPACE_MODE: AiHandlingMode = "assisted"
DEFAULT_CERTAINTY_THRESHOLD = 7
DEFAULT_BREAKER = {"max_autonomous_per_hour": 30, "max_negative_per_hour": 3}

# Legacy values written before AI handling existed (ai_mode suggest/auto/off).
LEGACY_MODE_MAP = {"auto": "autonomous", "suggest": "assisted", "off": "manual"}

# Conversation override reasons with lifecycle meaning.
REASON_ASSIGNED = "assigned"
REASON_TAKEOVER = "operator_takeover"
REASON_HANDOFF = "handoff_requested"
REASON_ESCALATED = "escalated"
# Too many agent <-> people handovers in a day: people keep it until hand back.
REASON_BOUNCE = "bounce_limit"
# Holds that only an explicit hand back releases (a reply does not).
STICKY_HOLD_REASONS = (REASON_TAKEOVER, REASON_BOUNCE)

AFTER_HUMAN_REPLY_OPTIONS: tuple[str, ...] = ("return_to_agent", "keep_with_human", "ask")
REOPEN_OWNER_OPTIONS: tuple[str, ...] = ("same_owner", "route_again")
ROUTING_KEYS: tuple[str, ...] = (
    "after_human_reply",
    "close_after_agent_reply",
    "close_after_human_reply",
    "reopen_owner",
)
DEFAULT_ROUTING: dict[str, Any] = {
    "after_human_reply": "return_to_agent",
    "close_after_agent_reply": False,
    "close_after_human_reply": False,
    "reopen_owner": "same_owner",
}
DEFAULT_BOUNCE_LIMIT = 3
BOUNCE_WINDOW_HOURS = 24

# Channels where anonymous contacts are normal (widget visitors stay pending
# until they leave an email), so the new-contact safeguard does not apply.
_ANONYMOUS_CHANNELS = {"widget"}


def normalize_mode(value: Any) -> str | None:
    """Accept ``{"mode": ...}`` objects, bare modes and legacy ai_mode values."""
    if isinstance(value, dict):
        value = value.get("mode")
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    value = LEGACY_MODE_MAP.get(value, value)
    return value if value in _RANK else None


def min_mode(*modes: str) -> str:
    valid = [m for m in modes if m in _RANK]
    return min(valid, key=lambda m: _RANK[m]) if valid else "manual"


def mode_rank(mode: str) -> int:
    return _RANK.get(mode, 0)


# ---------------------------------------------------------------------------
# Settings readers
# ---------------------------------------------------------------------------


def _json_obj(raw: str | None) -> dict:
    try:
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _tenant_settings(tenant: Tenant | None) -> dict:
    return _json_obj(tenant.settings_json) if tenant is not None else {}


def workspace_settings(tenant: Tenant | None) -> dict[str, Any]:
    """Normalized ``settings_json.ai_handling`` block with defaults filled in."""
    raw = _tenant_settings(tenant).get("ai_handling")
    data = raw if isinstance(raw, dict) else {}
    safeguards = data.get("safeguards") if isinstance(data.get("safeguards"), dict) else {}
    breaker = data.get("breaker") if isinstance(data.get("breaker"), dict) else {}
    disclosure = data.get("disclosure") if isinstance(data.get("disclosure"), dict) else {}
    try:
        threshold = int(safeguards.get("certainty_threshold", DEFAULT_CERTAINTY_THRESHOLD))
    except (TypeError, ValueError):
        threshold = DEFAULT_CERTAINTY_THRESHOLD

    def _limit(key: str) -> int:
        try:
            return max(1, int(breaker.get(key, DEFAULT_BREAKER[key])))
        except (TypeError, ValueError):
            return DEFAULT_BREAKER[key]

    routing_raw = data.get("routing") if isinstance(data.get("routing"), dict) else {}
    routing = {**DEFAULT_ROUTING, **normalize_routing(routing_raw)}
    try:
        bounce_limit = int(routing_raw.get("bounce_limit", DEFAULT_BOUNCE_LIMIT))
    except (TypeError, ValueError):
        bounce_limit = DEFAULT_BOUNCE_LIMIT
    routing["bounce_limit"] = min(20, max(0, bounce_limit))

    return {
        "default": {"mode": normalize_mode(data.get("default")) or DEFAULT_WORKSPACE_MODE},
        "safeguards": {
            "certainty_threshold": min(10, max(1, threshold)),
            "new_contacts": bool(safeguards.get("new_contacts", True)),
        },
        "routing": routing,
        "breaker": {
            "enabled": bool(breaker.get("enabled", True)),
            "max_autonomous_per_hour": _limit("max_autonomous_per_hour"),
            "max_negative_per_hour": _limit("max_negative_per_hour"),
        },
        "disclosure": {
            "enabled": bool(disclosure.get("enabled", True)),
            "text": str(disclosure.get("text") or "").strip()[:200],
        },
    }


def workspace_mode(tenant: Tenant | None) -> str:
    return workspace_settings(tenant)["default"]["mode"]


def normalize_routing(raw: Any) -> dict[str, Any]:
    """Only the valid routing keys with valid values (no defaults filled in)."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    value = raw.get("after_human_reply")
    if isinstance(value, str) and value in AFTER_HUMAN_REPLY_OPTIONS:
        out["after_human_reply"] = value
    for key in ("close_after_agent_reply", "close_after_human_reply"):
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    value = raw.get("reopen_owner")
    if isinstance(value, str) and value in REOPEN_OWNER_OPTIONS:
        out["reopen_owner"] = value
    return out


def channel_routing(account: ChannelAccount | None) -> dict[str, Any]:
    """The channel's own routing values (keys it overrides)."""
    return normalize_routing(account_ai_config(account).get("routing"))


@dataclass
class RoutingPolicy:
    effective: dict[str, Any]
    own: dict[str, Any]
    inherited: dict[str, Any]
    source: dict[str, str]
    bounce_limit: int

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


def resolve_routing(tenant: Tenant | None, account: ChannelAccount | None = None) -> RoutingPolicy:
    """Workspace routing defaults with the channel's overrides on top."""
    workspace = workspace_settings(tenant)["routing"]
    inherited = {key: workspace[key] for key in ROUTING_KEYS}
    own = channel_routing(account) if account is not None else {}
    effective = {**inherited, **own}
    source = {key: ("channel" if key in own else "workspace") for key in ROUTING_KEYS}
    return RoutingPolicy(
        effective=effective,
        own=own,
        inherited=inherited,
        source=source,
        bounce_limit=int(workspace["bounce_limit"]),
    )


def set_account_routing(account: ChannelAccount, patch: dict[str, Any]) -> None:
    """Write channel overrides; a ``None`` value clears that key (follows workspace)."""
    settings_obj = _json_obj(account.settings_json)
    cfg = settings_obj.get("ai_config") if isinstance(settings_obj.get("ai_config"), dict) else {}
    current = normalize_routing(cfg.get("routing"))
    for key in ROUTING_KEYS:
        if key not in patch:
            continue
        if patch[key] is None:
            current.pop(key, None)
        else:
            current.update(normalize_routing({key: patch[key]}))
    if current:
        cfg["routing"] = current
    else:
        cfg.pop("routing", None)
    settings_obj["ai_config"] = cfg
    account.settings_json = json.dumps(settings_obj)


async def routing_for_signal(
    session: AsyncSession, tenant: Tenant | None, signal: Signal
) -> RoutingPolicy:
    account, _contact = await load_layers(session, signal.tenant_id, signal)
    return resolve_routing(tenant, account)


def account_ai_config(account: ChannelAccount | None) -> dict:
    if account is None:
        return {}
    cfg = _json_obj(account.settings_json).get("ai_config")
    return cfg if isinstance(cfg, dict) else {}


def channel_mode(account: ChannelAccount | None) -> str | None:
    return normalize_mode(account_ai_config(account).get("ai_handling"))


def breaker_tripped_at(account: ChannelAccount | None) -> str | None:
    value = account_ai_config(account).get("breaker_tripped_at")
    return str(value) if value else None


def contact_mode(contact: Contact | None) -> str | None:
    if contact is None or not contact.ai_handling:
        return None
    try:
        return normalize_mode(json.loads(contact.ai_handling))
    except (json.JSONDecodeError, TypeError):
        return normalize_mode(contact.ai_handling)


def conversation_mode(signal: Signal | None) -> str | None:
    return normalize_mode(signal.ai_handling) if signal is not None else None


def is_held(signal: Signal | None) -> bool:
    """A person holds this conversation: its own override is manual."""
    return conversation_mode(signal) == "manual"


def governance_ceiling(tenant: Tenant | None) -> tuple[str, str | None]:
    """(ceiling, clamped_by) from privacy and the Govern messaging allowance."""
    if tenant is None:
        return "autonomous", None
    from app.services.privacy import tenant_allows_llm_message_bodies
    from app.tools.policy import tenant_allowances

    if not tenant_allows_llm_message_bodies(tenant):
        return "manual", "privacy"
    allowance = tenant_allowances(tenant).get("messaging", "ask")
    if allowance == "deny":
        return "manual", "govern"
    if allowance == "ask":
        return "assisted", "govern"
    return "autonomous", None


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


@dataclass
class AiHandling:
    effective: str
    requested: str
    source: str
    source_label: str
    ceiling: str
    clamped_by: str | None
    reason: str | None
    until_close: bool
    inherited: str
    inherited_source: str
    inherited_source_label: str
    own: str | None

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


def resolve_ai_handling(
    tenant: Tenant | None,
    account: ChannelAccount | None = None,
    contact: Contact | None = None,
    signal: Signal | None = None,
    *,
    scope: str = "conversation",
    agent: Any = None,
    tag_autonomy: str | None = None,
    flow_autonomy: str | None = None,
) -> AiHandling:
    """Effective AI handling for the most specific target given.

    ``scope`` names the layer the payload describes: ``own`` is that layer's
    value and ``inherited`` is what it would follow without one. ``agent`` is
    the agent that would answer; its autonomy is one more ceiling.
    """
    layers: list[tuple[str, str | None, str]] = [
        ("workspace", workspace_mode(tenant), tenant.name if tenant else ""),
        ("channel", channel_mode(account), (account.display_name or account.address) if account else ""),
        ("contact", contact_mode(contact), (contact.display_name or contact.address) if contact else ""),
        ("conversation", conversation_mode(signal), ""),
    ]
    scope_index = AI_HANDLING_SCOPES.index(scope) if scope in AI_HANDLING_SCOPES else 3
    relevant = layers[: scope_index + 1]

    requested, source, source_label = DEFAULT_WORKSPACE_MODE, "workspace", ""
    for name, mode, label in relevant:
        if mode:
            requested, source, source_label = mode, name, label

    inherited, inherited_source, inherited_label = DEFAULT_WORKSPACE_MODE, "workspace", ""
    for name, mode, label in relevant[:-1] if scope_index > 0 else []:
        if mode:
            inherited, inherited_source, inherited_label = mode, name, label
    if scope_index == 0:
        inherited, inherited_source, inherited_label = DEFAULT_WORKSPACE_MODE, "default", ""
    own = relevant[-1][1]

    ceiling, clamped_by = governance_ceiling(tenant)
    if account is not None and breaker_tripped_at(account) and mode_rank(ceiling) > mode_rank("assisted"):
        ceiling, clamped_by = "assisted", "breaker"
    if agent is not None:
        from app.services.agent_rules import normalize_autonomy

        agent_level = normalize_autonomy(getattr(agent, "autonomy_level", None))
        if mode_rank(agent_level) < mode_rank(ceiling):
            ceiling, clamped_by = agent_level, "agent"
    from app.services.agent_rules import scope_autonomy_ceiling

    for level, reason in ((tag_autonomy, "tag"), (flow_autonomy, "flow")):
        cap = scope_autonomy_ceiling(level)
        if cap and mode_rank(cap) < mode_rank(ceiling):
            ceiling, clamped_by = cap, reason
    effective = min_mode(requested, ceiling)
    return AiHandling(
        effective=effective,
        requested=requested,
        source=source,
        source_label=source_label,
        ceiling=ceiling,
        clamped_by=clamped_by if effective != requested else None,
        reason=(signal.ai_handling_reason or None) if signal is not None and source == "conversation" else None,
        until_close=scope == "conversation" and own is not None,
        inherited=inherited,
        inherited_source=inherited_source,
        inherited_source_label=inherited_label,
        own=own,
    )


async def load_layers(
    session: AsyncSession, tenant_id: UUID, signal: Signal
) -> tuple[ChannelAccount | None, Contact | None]:
    account: ChannelAccount | None = None
    if signal.channel_account_id:
        account = await session.get(ChannelAccount, signal.channel_account_id)
        if account is not None and account.tenant_id != tenant_id:
            account = None
    if account is None and signal.channel == "widget":
        account = await widget_account(session, tenant_id)
    contact: Contact | None = None
    if signal.contact_id:
        contact = await session.get(Contact, signal.contact_id)
        if contact is not None and contact.tenant_id != tenant_id:
            contact = None
        if contact is not None and contact.merged_into_id:
            merged = await session.get(Contact, contact.merged_into_id)
            contact = merged or contact
    return account, contact


async def widget_account(session: AsyncSession, tenant_id: UUID) -> ChannelAccount | None:
    return (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "widget"
            )
        )
    ).scalars().first()


async def resolve_for_signal(
    session: AsyncSession, tenant: Tenant | None, signal: Signal
) -> AiHandling:
    from app.models.agent import Agent

    account, contact = await load_layers(session, signal.tenant_id, signal)
    agent = await session.get(Agent, signal.agent_id) if signal.agent_id else None
    tag_autonomy = None
    flow_autonomy = None
    if signal.ticket_tag_id:
        from app.models.orchestra import Workstream
        from app.models.signal import SignalTag

        tag = await session.get(SignalTag, signal.ticket_tag_id)
        if tag is not None and tag.tenant_id == signal.tenant_id:
            tag_autonomy = tag.autonomy_level
            if tag.workstream_id:
                flow = await session.get(Workstream, tag.workstream_id)
                if flow is not None and flow.tenant_id == signal.tenant_id:
                    flow_autonomy = flow.autonomy_level
    return resolve_ai_handling(
        tenant,
        account,
        contact,
        signal,
        agent=agent,
        tag_autonomy=tag_autonomy,
        flow_autonomy=flow_autonomy,
    )


# ---------------------------------------------------------------------------
# Per-run safeguards
# ---------------------------------------------------------------------------


async def apply_safeguards(
    session: AsyncSession,
    tenant: Tenant | None,
    signal: Signal,
    handling: AiHandling,
    *,
    contact: Contact | None = None,
) -> tuple[str, str | None]:
    """Mode used for this one reply. Only autonomous can be downgraded.

    A downgrade writes an ``ai_handling_downgraded`` SignalEvent (not committed).
    """
    if handling.effective != "autonomous":
        return handling.effective, None
    cfg = workspace_settings(tenant)["safeguards"]
    reason: str | None = None
    if signal.certainty is not None and signal.certainty < cfg["certainty_threshold"]:
        reason = "low_certainty"
    elif (
        cfg["new_contacts"]
        and contact is not None
        and contact.status == "pending"
        and signal.channel not in _ANONYMOUS_CHANNELS
    ):
        reason = "new_contact"
    else:
        from app.models.signal import SignalTag

        send_mode = None
        if signal.ticket_tag_id and signal.ticket_status in ("open", "waiting"):
            tag = await session.get(SignalTag, signal.ticket_tag_id)
            send_mode = tag.send_mode if tag and tag.send_mode in ("draft", "ask") else None
        if send_mode:
            reason = "category"
    if reason is None:
        return "autonomous", None
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="ai_handling_downgraded",
            actor_type="system",
            actor_id="",
            payload_json=json.dumps({"from": "autonomous", "to": "assisted", "reason": reason}),
        )
    )
    return "assisted", reason


# ---------------------------------------------------------------------------
# Permissions and writes
# ---------------------------------------------------------------------------


def can_set(
    role: str, scope: str, mode: str | None, *, inherited_effective: str | None = None
) -> bool:
    """Lowering is free; raising to autonomous is guarded.

    Owner/admin may set anything. A member may set assisted, manual or clear at
    any scope, and autonomous only on a conversation whose channel already
    resolves to autonomous.
    """
    if role in ("owner", "admin"):
        return True
    if mode != "autonomous":
        return scope != "workspace" or mode is None
    return scope == "conversation" and inherited_effective == "autonomous"


def _event(
    signal: Signal,
    *,
    before: str | None,
    after: str | None,
    scope: str,
    reason: str | None,
    actor_type: str,
    actor_id: str,
    via: str = "",
) -> SignalEvent:
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type="ai_handling_changed",
        actor_type=actor_type,
        actor_id=actor_id,
        payload_json=json.dumps(
            {"from": before, "to": after, "scope": scope, "reason": reason or "", "via": via}
        ),
    )


def hold_conversation(
    session: AsyncSession,
    signal: Signal,
    *,
    reason: str,
    actor_type: str = "user",
    actor_id: str = "",
    via: str = "",
) -> bool:
    """Set the conversation override to manual. Returns True when it changed."""
    before = conversation_mode(signal)
    if before == "manual" and (signal.ai_handling_reason or "") == reason:
        return False
    signal.ai_handling = "manual"
    signal.ai_handling_reason = reason
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        _event(
            signal,
            before=before,
            after="manual",
            scope="conversation",
            reason=reason,
            actor_type=actor_type,
            actor_id=actor_id,
            via=via,
        )
    )
    return before != "manual"


def release_conversation(
    session: AsyncSession,
    signal: Signal,
    *,
    reason: str = "",
    actor_type: str = "user",
    actor_id: str = "",
    via: str = "",
) -> bool:
    """Clear the conversation override. Returns True when one was set."""
    before = conversation_mode(signal)
    if before is None:
        return False
    signal.ai_handling = None
    signal.ai_handling_reason = None
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        _event(
            signal,
            before=before,
            after=None,
            scope="conversation",
            reason=reason,
            actor_type=actor_type,
            actor_id=actor_id,
            via=via,
        )
    )
    return True


def on_status_change(session: AsyncSession, signal: Signal, *, actor_id: str = "") -> None:
    """Closing a conversation clears its temporary override."""
    if signal.status == "closed":
        release_conversation(session, signal, reason="closed", actor_id=actor_id, via="close")


def on_assignment_change(
    session: AsyncSession,
    signal: Signal,
    *,
    before_assignee: UUID | None,
    before_kind: str | None = None,
    actor_id: str = "",
) -> None:
    """Owner changes no longer hold the conversation; moving it to an agent releases one.

    Who owns the conversation and what the agent may do are two settings. A
    person as owner keeps the channel's AI handling (assisted drafts for them).
    Handing the conversation to an agent is an explicit "the agent handles
    this", so every conversation hold (take over, handoff, escalation, bounce
    limit) is released. Moving it to a team releases the legacy ``assigned``
    hold only.
    """
    kind_changed = before_kind is not None and before_kind != (signal.assignee_kind or "")
    if signal.assigned_user_id == before_assignee and not kind_changed:
        return
    reason = signal.ai_handling_reason or ""
    if signal.assignee_kind == "agent" and is_held(signal):
        release_conversation(session, signal, reason="assigned_to_agent", actor_id=actor_id, via="assign")
    elif signal.assignee_kind == "team" and reason == REASON_ASSIGNED:
        release_conversation(session, signal, reason="unassigned", actor_id=actor_id, via="assign")
    elif signal.assignee_kind == "user" and reason == REASON_ASSIGNED:
        # Legacy hold from before owner and AI handling were separated.
        release_conversation(session, signal, reason="reassigned", actor_id=actor_id, via="assign")


def set_account_mode(account: ChannelAccount, mode: str | None) -> None:
    settings_obj = _json_obj(account.settings_json)
    cfg = settings_obj.get("ai_config") if isinstance(settings_obj.get("ai_config"), dict) else {}
    if mode is None:
        cfg.pop("ai_handling", None)
    else:
        cfg["ai_handling"] = {"mode": mode}
    cfg.pop("mode", None)
    cfg.pop("suggestions_enabled", None)
    settings_obj["ai_config"] = cfg
    account.settings_json = json.dumps(settings_obj)


def update_workspace_block(tenant: Tenant, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge ``patch`` into ``settings_json.ai_handling`` and return the normalized block."""
    settings_obj = _tenant_settings(tenant)
    block = settings_obj.get("ai_handling") if isinstance(settings_obj.get("ai_handling"), dict) else {}
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(block.get(key), dict):
            block[key] = {**block[key], **value}
        else:
            block[key] = value
    settings_obj["ai_handling"] = block
    tenant.settings_json = json.dumps(settings_obj)
    return workspace_settings(tenant)


async def _open_signals_for(
    session: AsyncSession, tenant_id: UUID, *, contact_id: UUID | None = None
) -> list[Signal]:
    stmt = select(Signal).where(
        Signal.tenant_id == tenant_id, Signal.status.in_(("open", "pending"))
    )
    if contact_id is not None:
        stmt = stmt.where(Signal.contact_id == contact_id)
    return list((await session.execute(stmt.limit(200))).scalars().all())


async def set_ai_handling(
    session: AsyncSession,
    tenant: Tenant,
    scope: str,
    target_id: str,
    mode: str | None,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    role: str = "member",
    reason: str | None = None,
    assign_to_me: UUID | None = None,
) -> AiHandling:
    """Write one layer. Checks direction permission, audits, logs on threads.

    Commits. Raises HTTPException(400/403/404) on invalid input.
    """
    from app.services.audit import record_audit

    if scope not in AI_HANDLING_SCOPES:
        raise HTTPException(status_code=400, detail="Unknown scope")
    if mode is not None:
        mode = normalize_mode(mode)
        if mode is None:
            raise HTTPException(status_code=400, detail="Unknown mode")
    if scope == "workspace" and mode is None:
        raise HTTPException(status_code=400, detail="Workspace default needs a mode")

    signal: Signal | None = None
    account: ChannelAccount | None = None
    contact: Contact | None = None
    before: str | None
    affected: list[Signal] = []

    def _uuid(value: str) -> UUID:
        try:
            return UUID(str(value))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Not found") from exc

    if scope == "workspace":
        before = workspace_mode(tenant)
        inherited_effective = None
    elif scope == "channel":
        account = await session.get(ChannelAccount, _uuid(target_id))
        if account is None or account.tenant_id != tenant.id:
            raise HTTPException(status_code=404, detail="Channel not found")
        before = channel_mode(account)
        inherited_effective = None
    elif scope == "contact":
        contact = await session.get(Contact, _uuid(target_id))
        if contact is None or contact.tenant_id != tenant.id:
            raise HTTPException(status_code=404, detail="Contact not found")
        before = contact_mode(contact)
        inherited_effective = None
    else:
        signal = await session.get(Signal, _uuid(target_id))
        if signal is None or signal.tenant_id != tenant.id:
            raise HTTPException(status_code=404, detail="Conversation not found")
        account, contact = await load_layers(session, tenant.id, signal)
        before = conversation_mode(signal)
        inherited_effective = resolve_ai_handling(
            tenant, account, contact, None, scope="contact"
        ).effective

    if not can_set(role, scope, mode, inherited_effective=inherited_effective):
        raise HTTPException(
            status_code=403,
            detail="Only an owner or admin can raise AI handling to autonomous here",
        )

    if scope == "workspace":
        update_workspace_block(tenant, {"default": {"mode": mode}})
        session.add(tenant)
    elif scope == "channel" and account is not None:
        set_account_mode(account, mode)
        session.add(account)
    elif scope == "contact" and contact is not None:
        contact.ai_handling = json.dumps({"mode": mode}) if mode else None
        session.add(contact)
        affected = await _open_signals_for(session, tenant.id, contact_id=contact.id)
    elif signal is not None:
        signal.ai_handling = mode
        signal.ai_handling_reason = (reason or (REASON_TAKEOVER if mode == "manual" else "operator")) if mode else None
        if assign_to_me is not None and mode == "manual":
            from app.services.ownership import picked_up_event, set_owner

            if signal.assignee_kind == "team":
                session.add(
                    await picked_up_event(session, signal, assign_to_me, signal.assignee_team_id, via="take_over")
                )
            set_owner(signal, "user", assign_to_me, by_user_id=assign_to_me)
        elif mode is None and before == "manual":
            # Hand back: the agent owns the next reply again when it may.
            from app.services.handover import hand_to_agent

            signal.ai_handling_reason = None
            actor_uuid = UUID(actor_id) if actor_type == "user" and actor_id else None
            became_owner = await hand_to_agent(
                session,
                tenant,
                signal,
                actor_type=actor_type,
                actor_id=actor_id,
                via="hand_back",
                by_user_id=actor_uuid,
            )
            if (
                not became_owner
                and actor_uuid is not None
                and signal.assignee_kind == "user"
                and signal.assigned_user_id == actor_uuid
            ):
                # The agent may not own it (assisted / manual channel): the
                # person who hands back returns it to the channel team so it
                # shows in the queue instead of staying on their plate.
                from app.services.ownership import resolve_assignee, set_owner

                team_id = await resolve_assignee(session, tenant.id, signal, "team", None)
                set_owner(signal, "team", team_id, by_user_id=actor_uuid)
        signal.updated_at = datetime.utcnow()
        session.add(signal)
        affected = [signal]
        if mode == "manual":
            from app.services.agent_sessions import close_open_sessions_for_thread

            if actor_type == "user" and actor_id:
                await close_open_sessions_for_thread(
                    session, tenant.id, UUID(actor_id), signal.id, summary="Human takeover"
                )

    for thread in affected:
        session.add(
            _event(
                thread,
                before=before,
                after=mode,
                scope=scope,
                reason=reason,
                actor_type=actor_type,
                actor_id=actor_id,
                via="ai_handling",
            )
        )

    await record_audit(
        session,
        tenant.id,
        action="ai_handling:changed",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type=scope,
        resource_id=str(target_id),
        summary=f"AI handling {scope}: {before or 'inherit'} -> {mode or 'inherit'}",
        before={"mode": before},
        after={"mode": mode},
        commit=False,
    )
    await session.commit()

    from app.gateway.publish import publish_thread_update

    for thread in affected:
        await publish_thread_update(thread)

    if scope == "workspace":
        return resolve_ai_handling(tenant, scope="workspace")
    if scope == "channel":
        return resolve_ai_handling(tenant, account, scope="channel")
    if scope == "contact":
        return resolve_ai_handling(tenant, None, contact, scope="contact")
    return resolve_ai_handling(tenant, account, contact, signal)


# ---------------------------------------------------------------------------
# Preview and evidence
# ---------------------------------------------------------------------------


async def follower_count(
    session: AsyncSession, tenant: Tenant, scope: str, target_id: str
) -> int:
    """Open conversations whose effective handling comes from this layer."""
    stmt = select(Signal).where(
        Signal.tenant_id == tenant.id,
        Signal.status.in_(("open", "pending")),
        Signal.channel.notin_(("internal", "assistant")),
        Signal.ai_handling.is_(None),
    )
    if scope == "channel":
        stmt = stmt.where(Signal.channel_account_id == UUID(str(target_id)))
    elif scope == "contact":
        stmt = stmt.where(Signal.contact_id == UUID(str(target_id)))
    elif scope == "conversation":
        return 1
    signals = list((await session.execute(stmt.limit(1000))).scalars().all())
    if scope == "contact":
        return len(signals)
    count = 0
    contact_cache: dict[UUID, Contact | None] = {}
    account_cache: dict[UUID, ChannelAccount | None] = {}
    for sig in signals:
        if sig.contact_id:
            if sig.contact_id not in contact_cache:
                contact_cache[sig.contact_id] = await session.get(Contact, sig.contact_id)
            if contact_mode(contact_cache[sig.contact_id]):
                continue
        if scope == "workspace" and sig.channel_account_id:
            if sig.channel_account_id not in account_cache:
                account_cache[sig.channel_account_id] = await session.get(
                    ChannelAccount, sig.channel_account_id
                )
            if channel_mode(account_cache[sig.channel_account_id]):
                continue
        count += 1
    return count


async def evidence(
    session: AsyncSession, tenant_id: UUID, *, account_id: UUID | None = None, days: int = 30
) -> dict[str, Any]:
    """Last-N-days outcome numbers that back a raise to autonomous."""
    from app.models.notification import DecisionRequest

    since = datetime.utcnow() - timedelta(days=days)
    # Reply drafts are the "Suggested reply" cards; choosing "send" ships the
    # draft as written, "edit" means a person rewrote it first.
    drafts_stmt = select(DecisionRequest.status, DecisionRequest.chosen_option_id).where(
        DecisionRequest.tenant_id == tenant_id,
        DecisionRequest.created_at >= since,
        DecisionRequest.title == "Suggested reply",
    )
    if account_id is not None:
        drafts_stmt = drafts_stmt.join(Signal, Signal.id == DecisionRequest.signal_id).where(
            Signal.channel_account_id == account_id
        )
    rows = (await session.execute(drafts_stmt)).all()
    resolved = [r for r in rows if r[0] in ("approved", "rejected")]
    unedited = sum(1 for status_value, option in rows if status_value == "approved" and option == "send")

    events_stmt = select(SignalEvent.event_type, func.count()).where(
        SignalEvent.tenant_id == tenant_id,
        SignalEvent.created_at >= since,
        SignalEvent.event_type.in_(("escalated", "ai_handling_downgraded")),
    )
    if account_id is not None:
        events_stmt = events_stmt.join(Signal, Signal.id == SignalEvent.signal_id).where(
            Signal.channel_account_id == account_id
        )
    events = dict((await session.execute(events_stmt.group_by(SignalEvent.event_type))).all())

    from app.models.signal import SignalMessage

    auto_stmt = select(func.count()).select_from(SignalMessage).where(
        SignalMessage.tenant_id == tenant_id,
        SignalMessage.created_at >= since,
        SignalMessage.auto_sent.is_(True),
    )
    if account_id is not None:
        auto_stmt = auto_stmt.join(Signal, Signal.id == SignalMessage.signal_id).where(
            Signal.channel_account_id == account_id
        )
    autonomous_replies = int((await session.execute(auto_stmt)).scalar() or 0)
    drafts = len(rows)
    return {
        "days": days,
        "drafts": drafts,
        "drafts_resolved": len(resolved),
        "unedited": unedited,
        "unedited_rate": round(unedited / len(resolved), 3) if resolved else None,
        "escalations": int(events.get("escalated", 0)),
        "escalation_rate": round(int(events.get("escalated", 0)) / drafts, 3) if drafts else None,
        "autonomous_replies": autonomous_replies,
    }


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------


def _set_breaker(account: ChannelAccount, tripped_at: str | None, reason: str = "") -> None:
    settings_obj = _json_obj(account.settings_json)
    cfg = settings_obj.get("ai_config") if isinstance(settings_obj.get("ai_config"), dict) else {}
    if tripped_at:
        cfg["breaker_tripped_at"] = tripped_at
        cfg["breaker_reason"] = reason
    else:
        cfg.pop("breaker_tripped_at", None)
        cfg.pop("breaker_reason", None)
    settings_obj["ai_config"] = cfg
    account.settings_json = json.dumps(settings_obj)


async def breaker_counts(
    session: AsyncSession, tenant_id: UUID, account_id: UUID, *, since: datetime
) -> dict[str, int]:
    """Autonomous replies and negative signals on one channel since ``since``."""
    from app.models.learning import Feedback
    from app.models.signal import SignalMessage

    replies = int(
        (
            await session.execute(
                select(func.count())
                .select_from(SignalMessage)
                .join(Signal, Signal.id == SignalMessage.signal_id)
                .where(
                    SignalMessage.tenant_id == tenant_id,
                    Signal.channel_account_id == account_id,
                    SignalMessage.created_at >= since,
                    SignalMessage.direction == "outbound",
                    SignalMessage.author_agent_id.is_not(None),
                    SignalMessage.decision_id.is_(None),
                )
            )
        ).scalar()
        or 0
    )
    escalations = int(
        (
            await session.execute(
                select(func.count())
                .select_from(SignalEvent)
                .join(Signal, Signal.id == SignalEvent.signal_id)
                .where(
                    SignalEvent.tenant_id == tenant_id,
                    Signal.channel_account_id == account_id,
                    SignalEvent.created_at >= since,
                    SignalEvent.event_type.in_(("escalated", "ai_handling_changed")),
                    SignalEvent.payload_json.contains(REASON_HANDOFF)
                    | (SignalEvent.event_type == "escalated"),
                )
            )
        ).scalar()
        or 0
    )
    down_ids = [
        row[0]
        for row in (
            await session.execute(
                select(Feedback.subject_id).where(
                    Feedback.tenant_id == tenant_id,
                    Feedback.created_at >= since,
                    Feedback.sentiment == "down",
                    Feedback.subject_type == "message",
                )
            )
        ).all()
    ]
    negative_feedback = 0
    if down_ids:
        message_ids = []
        for raw in down_ids:
            try:
                message_ids.append(UUID(str(raw)))
            except ValueError:
                continue
        if message_ids:
            negative_feedback = int(
                (
                    await session.execute(
                        select(func.count())
                        .select_from(SignalMessage)
                        .join(Signal, Signal.id == SignalMessage.signal_id)
                        .where(
                            SignalMessage.id.in_(message_ids),
                            Signal.channel_account_id == account_id,
                        )
                    )
                ).scalar()
                or 0
            )
    return {"autonomous_replies": replies, "negative": escalations + negative_feedback}


async def check_breaker(
    session: AsyncSession, tenant: Tenant | None, account: ChannelAccount | None
) -> bool:
    """Trip the channel breaker when the hourly limits are exceeded.

    Only runs for channels that resolve to autonomous. Tripping caps the
    channel at assisted, writes an ``ai_breaker_tripped`` pill on its open
    threads and opens a Govern decision (resume or keep assisted). Commits
    when it trips. Returns True when it tripped now.
    """
    if tenant is None or account is None or breaker_tripped_at(account):
        return False
    cfg = workspace_settings(tenant)["breaker"]
    if not cfg["enabled"]:
        return False
    if resolve_ai_handling(tenant, account, scope="channel").effective != "autonomous":
        return False
    since = datetime.utcnow() - timedelta(hours=1)
    counts = await breaker_counts(session, tenant.id, account.id, since=since)
    reason = None
    if counts["autonomous_replies"] > cfg["max_autonomous_per_hour"]:
        reason = "reply_volume"
    elif counts["negative"] >= cfg["max_negative_per_hour"]:
        reason = "negative_feedback"
    if reason is None:
        return False
    await trip_breaker(session, tenant, account, reason=reason, counts=counts)
    return True


async def trip_breaker(
    session: AsyncSession,
    tenant: Tenant,
    account: ChannelAccount,
    *,
    reason: str,
    counts: dict[str, int] | None = None,
) -> None:
    from app.services.audit import record_audit
    from app.services.signal_decisions import create_decision

    now = datetime.utcnow()
    _set_breaker(account, now.isoformat(), reason)
    session.add(account)
    label = account.display_name or account.address
    open_threads = list(
        (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant.id,
                    Signal.channel_account_id == account.id,
                    Signal.status.in_(("open", "pending")),
                )
                .limit(100)
            )
        ).scalars().all()
    )
    for thread in open_threads:
        session.add(
            SignalEvent(
                signal_id=thread.id,
                tenant_id=tenant.id,
                event_type="ai_breaker_tripped",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps(
                    {"channel_account_id": str(account.id), "reason": reason, "to": "assisted"}
                ),
            )
        )
    await record_audit(
        session,
        tenant.id,
        action="ai_handling:breaker_tripped",
        actor_type="system",
        resource_type="channel",
        resource_id=str(account.id),
        summary=f"Autonomous paused on {label}: {reason}",
        payload=counts or {},
        commit=False,
    )
    payload = {"channel_account_id": str(account.id)}
    await create_decision(
        session,
        tenant.id,
        title=f"Autonomous paused on {label}",
        summary=(
            "Too many autonomous replies in the last hour."
            if reason == "reply_volume"
            else "Several negative reactions or handoffs in the last hour."
        )
        + " The channel drafts replies for approval until you resume it.",
        options=[
            {
                "id": "resume",
                "label": "Resume autonomous",
                "action_type": "reset_ai_breaker",
                "payload": payload,
            },
            {
                "id": "keep_assisted",
                "label": "Keep assisted",
                "action_type": "keep_ai_assisted",
                "payload": payload,
            },
        ],
        source_type="system",
        source_id=f"ai_breaker:{account.id}",
    )
    await session.commit()


async def reset_breaker(
    session: AsyncSession,
    tenant: Tenant,
    account: ChannelAccount,
    *,
    keep_assisted: bool = False,
    actor_id: str = "",
) -> None:
    """Clear the breaker. ``keep_assisted`` also pins the channel to assisted."""
    from app.services.audit import record_audit

    _set_breaker(account, None)
    if keep_assisted:
        set_account_mode(account, "assisted")
    session.add(account)
    await record_audit(
        session,
        tenant.id,
        action="ai_handling:breaker_reset",
        actor_type="user" if actor_id else "system",
        actor_id=actor_id,
        resource_type="channel",
        resource_id=str(account.id),
        summary=(
            f"Breaker cleared on {account.display_name or account.address}"
            + (" (kept assisted)" if keep_assisted else "")
        ),
        commit=False,
    )
    await session.commit()


# ---------------------------------------------------------------------------
# AI disclosure
# ---------------------------------------------------------------------------

_DISCLOSURE_DEFAULTS = {
    "nl": "Beantwoord door de AI-assistent van {company}.",
    "en": "Answered by the AI assistant of {company}.",
}


def disclosure_text(tenant: Tenant | None, *, language: str = "en") -> str | None:
    """Line shown with autonomous replies, or None when disclosure is off."""
    cfg = workspace_settings(tenant)["disclosure"]
    if not cfg["enabled"]:
        return None
    template = cfg["text"] or _DISCLOSURE_DEFAULTS.get(language, _DISCLOSURE_DEFAULTS["en"])
    company = (tenant.name if tenant else "") or "this company"
    return template.replace("{company}", company)


async def list_exceptions(session: AsyncSession, tenant: Tenant) -> dict[str, list[dict[str, Any]]]:
    """Every layer below workspace that has its own value, for one overview."""
    accounts = (
        await session.execute(select(ChannelAccount).where(ChannelAccount.tenant_id == tenant.id))
    ).scalars().all()
    channels = [
        {
            "id": str(a.id),
            "channel": a.channel,
            "label": a.display_name or a.address,
            "mode": channel_mode(a),
            "breaker_tripped_at": breaker_tripped_at(a),
        }
        for a in accounts
        if channel_mode(a) or breaker_tripped_at(a)
    ]
    contact_rows = (
        await session.execute(
            select(Contact)
            .where(Contact.tenant_id == tenant.id, Contact.ai_handling.is_not(None))
            .limit(200)
        )
    ).scalars().all()
    contacts = [
        {
            "id": str(c.id),
            "label": c.display_name or c.address,
            "address": c.address,
            "channel": c.channel,
            "mode": contact_mode(c),
        }
        for c in contact_rows
        if contact_mode(c)
    ]
    signal_rows = (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant.id,
                Signal.ai_handling.is_not(None),
                Signal.status.in_(("open", "pending")),
            )
            .order_by(Signal.updated_at.desc())
            .limit(200)
        )
    ).scalars().all()
    conversations = [
        {
            "id": str(s.id),
            "label": s.subject or s.contact_name or s.contact_email,
            "contact_name": s.contact_name or s.contact_email,
            "channel": s.channel,
            "mode": conversation_mode(s),
            "reason": s.ai_handling_reason or "",
        }
        for s in signal_rows
        if conversation_mode(s)
    ]
    return {"channels": channels, "contacts": contacts, "conversations": conversations}


async def autonomous_override_count(session: AsyncSession, tenant: Tenant) -> int:
    exceptions = await list_exceptions(session, tenant)
    return sum(
        1 for rows in exceptions.values() for row in rows if row.get("mode") == "autonomous"
    )


async def metrics(session: AsyncSession, tenant: Tenant, *, days: int = 30) -> dict[str, Any]:
    """Overview block: open conversations per effective mode plus outcome rates.

    Resolution runs per conversation with cached layers; capped at 2000 open
    conversations so the Overview stays fast on large workspaces.
    """
    signals = list(
        (
            await session.execute(
                select(Signal)
                .where(
                    Signal.tenant_id == tenant.id,
                    Signal.status.in_(("open", "pending")),
                    Signal.channel.notin_(("internal", "assistant")),
                )
                .limit(2000)
            )
        ).scalars().all()
    )
    accounts: dict[UUID, ChannelAccount | None] = {}
    contacts: dict[UUID, Contact | None] = {}
    widget: ChannelAccount | None = None
    widget_loaded = False
    by_mode = {mode: 0 for mode in AI_HANDLING_MODES}
    for sig in signals:
        account: ChannelAccount | None = None
        if sig.channel_account_id:
            if sig.channel_account_id not in accounts:
                accounts[sig.channel_account_id] = await session.get(ChannelAccount, sig.channel_account_id)
            account = accounts[sig.channel_account_id]
        elif sig.channel == "widget":
            if not widget_loaded:
                widget, widget_loaded = await widget_account(session, tenant.id), True
            account = widget
        contact: Contact | None = None
        if sig.contact_id:
            if sig.contact_id not in contacts:
                contacts[sig.contact_id] = await session.get(Contact, sig.contact_id)
            contact = contacts[sig.contact_id]
        by_mode[resolve_ai_handling(tenant, account, contact, sig).effective] += 1

    since = datetime.utcnow() - timedelta(days=days)
    handoffs = int(
        (
            await session.execute(
                select(func.count())
                .select_from(SignalEvent)
                .where(
                    SignalEvent.tenant_id == tenant.id,
                    SignalEvent.created_at >= since,
                    (SignalEvent.event_type == "escalated")
                    | (
                        (SignalEvent.event_type == "ai_handling_changed")
                        & SignalEvent.payload_json.contains(REASON_HANDOFF)
                    ),
                )
            )
        ).scalar()
        or 0
    )
    stats = await evidence(session, tenant.id, days=days)
    autonomous_replies = stats["autonomous_replies"]
    return {
        "days": days,
        "open_by_mode": by_mode,
        "open_total": len(signals),
        "autonomous_replies": autonomous_replies,
        "handoffs": handoffs,
        "handoff_rate": round(handoffs / autonomous_replies, 3) if autonomous_replies else None,
        "assisted_edit_rate": (
            round(1 - stats["unedited_rate"], 3) if stats["unedited_rate"] is not None else None
        ),
        "drafts_resolved": stats["drafts_resolved"],
    }


CATALOG: list[dict[str, str]] = [
    {"id": "autonomous", "icon": "Zap", "tone": "ai"},
    {"id": "assisted", "icon": "PenLine", "tone": "ai"},
    {"id": "manual", "icon": "Hand", "tone": "muted"},
]
