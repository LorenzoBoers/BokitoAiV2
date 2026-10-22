"""The Grid: from intake to result, computed on the server.

Four layers, left to right: ``input`` (channels), ``executor`` (agents and
people, grouped in department zones), ``work`` (flows) and ``result`` (reply,
folders with their Works in items, connections written without a folder,
knowledge, and two sinks). Paths come from conversations whose last message
falls inside the period; no new tables.

A folder node is a top folder: work in a subfolder counts there, and the node
lists its subfolders with their own counts.

The result of a conversation, in this order:
1. its ``delivered`` events in the period;
2. otherwise (``estimated``) its folder, else an outbound message as a reply;
3. still open: the sink "still open";
4. closed: the sink "done". Closing is done; the sink also says how many
   closed on purpose ("no reply needed", "handled outside Bokito").

The label of a conversation is its flow label, else the free label set first.

Clients draw what this returns. Colors, modes, issues and label splits are
decided here.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from statistics import median
from typing import Any
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.auth import Tenant, User
from app.models.channel import ChannelAccount, Contact
from app.models.project import Project
from app.models.signal import (
    Signal,
    SignalEvent,
    SignalMessage,
    SignalTag,
    SignalTagLink,
    is_internal_channel,
)
from app.models.team import Department, DepartmentMember, is_root_department
from app.services.agent_avatar import avatar_payload

LAYERS = ("input", "executor", "work", "result")
ZONE_NONE = "none"
REPLY = "result:reply"
KNOWLEDGE = "result:knowledge"
SINK_OPEN = "result:open"
SINK_CLOSED = "result:closed_without_result"
CONNECTION_RESULT = "result:connection:"
UNASSIGNED = "executor:unassigned"
NO_LABEL = "none"
# An executor is overloaded above this many open conversations, or above
# OVERLOAD_MEDIAN_FACTOR times the median of executors that hold open work.
OVERLOAD_OPEN = 15
OVERLOAD_MEDIAN_FACTOR = 2
# Closed on purpose: counted separately on the done sink.
CLOSED_ON_PURPOSE = ("no_reply", "handled_externally")
# Free labels have no mark; the Grid still tells them apart.
FREE_LABEL_PALETTE = ("teal", "violet", "orange", "emerald", "pink", "rose", "sky", "info", "warning", "accent")
NO_LABEL_COLOR = "neutral"
MODES = ("autonomous", "assisted", "manual", "human", "none")


def _free_label_color(tag_id: UUID) -> str:
    return FREE_LABEL_PALETTE[tag_id.int % len(FREE_LABEL_PALETTE)]


def _channel_node_id(signal: Signal, widget_id: UUID | None) -> str:
    if signal.channel_account_id:
        return f"channel:{signal.channel_account_id}"
    if signal.channel == "widget" and widget_id:
        return f"channel:{widget_id}"
    return f"channel:{signal.channel or 'other'}"


def _executor_node_id(signal: Signal) -> str:
    if signal.assignee_kind in ("agent", "user") and signal.assignee_id:
        return f"{signal.assignee_kind}:{signal.assignee_id}"
    if signal.agent_id:
        return f"agent:{signal.agent_id}"
    return UNASSIGNED


def _payload(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


class _Path:
    __slots__ = ("count", "modes", "by_label")

    def __init__(self) -> None:
        self.count = 0
        self.modes: Counter[str] = Counter()
        self.by_label: Counter[str] = Counter()

    def add(self, mode: str, label: str) -> None:
        self.count += 1
        self.modes[mode] += 1
        self.by_label[label] += 1

    def serialize(self, source: str, target: str) -> dict[str, Any]:
        mode = sorted(self.modes.items(), key=lambda kv: (-kv[1], MODES.index(kv[0])))[0][0]
        return {
            "source": source,
            "target": target,
            "count": self.count,
            "mode": mode,
            "by_label": dict(self.by_label),
        }


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None


def folder_roots(folders: dict[UUID, Project]) -> dict[UUID, UUID]:
    """Each folder mapped to its top-most ancestor (itself at the top)."""
    roots: dict[UUID, UUID] = {}
    for folder_id in folders:
        current, seen = folder_id, {folder_id}
        while folders[current].parent_id in folders and folders[current].parent_id not in seen:
            current = folders[current].parent_id
            seen.add(current)
        roots[folder_id] = current
    return roots


def overload_threshold(open_counts: list[int]) -> float:
    """Open conversations above which an executor is overloaded."""
    busy = [n for n in open_counts if n > 0]
    if not busy:
        return OVERLOAD_OPEN
    return min(OVERLOAD_OPEN, OVERLOAD_MEDIAN_FACTOR * median(busy))


def _node(node_id: str, kind: str, layer: str, label: str, href: str | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": kind,
        "layer": layer,
        "label": label,
        "href": href,
        "count": 0,
        "open": 0,
        "open_by_label": {},
        "issues": [],
        **extra,
    }


async def build_org_flow(session: AsyncSession, tenant: Tenant, user_id: UUID | None, *, days: int = 7) -> dict[str, Any]:
    from app.modules.catalog import get_module
    from app.services.ai_handling import resolve_ai_handling, resolve_for_signal, widget_account
    from app.services.org_graph import channel_href
    from app.services.presence import connected_user_ids_for, visible_user_status
    from app.services.signal_tags import FLOW_LABEL_COLOR, FLOW_LABEL_ICON, flow_label_color
    from app.services.signal_threads import _signals_with_open_decisions
    from app.services.workforce_runtime import company_agents
    from app.services.works_in import works_in_items
    from app.services.workstreams import operator_flows

    tenant_id = tenant.id
    days = max(1, min(int(days or 7), 90))
    since = utcnow() - timedelta(days=days)

    # Conversations: the period's traffic plus everything still open.
    signals = [
        s
        for s in (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant_id,
                    Signal.deleted_at.is_(None),
                    or_(Signal.last_message_at >= since, Signal.status != "closed"),
                )
            )
        ).scalars().all()
        if not is_internal_channel(s.channel or "") and s.channel != "assistant"
    ]
    in_period = {s.id for s in signals if s.last_message_at and s.last_message_at >= since}
    signal_ids = [s.id for s in signals]

    nodes: dict[str, dict[str, Any]] = {}

    # Input: every live channel, plus buckets for traffic without an account.
    widget = await widget_account(session, tenant_id)
    accounts = (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant_id,
                ChannelAccount.archived_at.is_(None),
                ChannelAccount.is_enabled.is_(True),
            )
        )
    ).scalars().all()
    accounts_by_id = {a.id: a for a in accounts}
    for account in accounts:
        if is_internal_channel(account.channel):
            continue
        nodes[f"channel:{account.id}"] = _node(
            f"channel:{account.id}",
            "channel",
            "input",
            account.display_name or account.address or account.channel,
            channel_href(account.channel, account.connection_id),
            channel=account.channel,
        )

    # Executors: every company agent, department members, and whoever holds work.
    agents = {a.id: a for a in await company_agents(session, tenant_id)}
    departments = {
        d.id: d
        for d in (
            await session.execute(
                select(Department).where(Department.tenant_id == tenant_id, Department.deleted_at.is_(None))
            )
        ).scalars().all()
        if not is_root_department(d)
    }
    members = (
        (
            await session.execute(
                select(DepartmentMember).where(
                    DepartmentMember.tenant_id == tenant_id,
                    DepartmentMember.department_id.in_(list(departments)),
                )
            )
        ).scalars().all()
        if departments
        else []
    )
    executor_departments: dict[str, set[UUID]] = defaultdict(set)
    for member in members:
        if member.member_kind == "agent" and member.agent_id:
            executor_departments[f"agent:{member.agent_id}"].add(member.department_id)
        elif member.user_id:
            executor_departments[f"user:{member.user_id}"].add(member.department_id)

    user_ids = {UUID(key.split(":", 1)[1]) for key in executor_departments if key.startswith("user:")}
    user_ids |= {s.assignee_id for s in signals if s.assignee_kind == "user" and s.assignee_id}
    users = (
        {u.id: u for u in (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}
        if user_ids
        else {}
    )
    for agent in agents.values():
        nodes[f"agent:{agent.id}"] = _node(
            f"agent:{agent.id}",
            "agent",
            "executor",
            agent.name,
            f"/agents/{agent.id}",
            job_title=(agent.job_title or "").strip() or None,
            description=(agent.description or "").strip() or None,
        )
        nodes[f"agent:{agent.id}"]["mark"] = {**avatar_payload(agent), "name": agent.name}
    for uid, user in users.items():
        name = (user.display_name or user.email or "").strip()
        title = (getattr(user, "job_title", None) or "").strip() or None
        nodes[f"user:{uid}"] = _node(
            f"user:{uid}",
            "user",
            "executor",
            name,
            "/team#directory",
            job_title=title,
        )
        image = (getattr(user, "avatar_url", None) or "").strip()
        nodes[f"user:{uid}"]["mark"] = {
            "avatar_kind": "image" if image else "initials",
            "avatar_image_url": image or None,
            "name": name,
        }

    # Work: operator flows, the same rows as the flows list.
    flows = await operator_flows(session, tenant_id)
    flows_by_id = {f.id: f for f in flows}
    flow_tags = (
        {
            t.workstream_id: t
            for t in (
                await session.execute(
                    select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.in_(list(flows_by_id)))
                )
            ).scalars()
        }
        if flows_by_id
        else {}
    )
    from app.services.department_overview import latest_scorecards

    scorecards = await latest_scorecards(session, tenant.id, [str(t.id) for t in flow_tags.values() if t is not None])
    for flow in flows:
        module = get_module(flow.module_slug) if flow.module_slug else None
        flow_tag = flow_tags.get(flow.id)
        card = scorecards.get(str(flow_tag.id)) if flow_tag else None
        nodes[f"flow:{flow.id}"] = _node(
            f"flow:{flow.id}",
            "flow",
            "work",
            flow.name,
            f"/flows/{flow.id}",
            module={"slug": module.slug, "name": module.name} if module else None,
            color=flow_label_color(flow_tag.color if flow_tag else None) or FLOW_LABEL_COLOR,
            icon=(flow_tag.icon if flow_tag else "") or FLOW_LABEL_ICON,
            done=0,
            autonomous_pct=card.get("autonomous_pct") if card else None,
        )
        # A flow sits in the lane of its department; All's flows run in the free lane.
        nodes[f"flow:{flow.id}"]["zones"] = [str(flow.department_id)] if flow.department_id in departments else []

    tag_ids = {s.ticket_tag_id for s in signals if s.ticket_tag_id}
    links = (
        (await session.execute(select(SignalTagLink).where(SignalTagLink.signal_id.in_(signal_ids)))).scalars().all()
        if signal_ids
        else []
    )
    # Oldest link first: without a flow label, the label set first counts.
    tags_by_signal: dict[UUID, list[UUID]] = defaultdict(list)
    for link in sorted(links, key=lambda row: (row.created_at or datetime.min, str(row.tag_id))):
        tags_by_signal[link.signal_id].append(link.tag_id)
        tag_ids.add(link.tag_id)
    tags = (
        {t.id: t for t in (await session.execute(select(SignalTag).where(SignalTag.id.in_(tag_ids)))).scalars().all()}
        if tag_ids
        else {}
    )

    def label_key(signal: Signal) -> str:
        tag = tags.get(signal.ticket_tag_id) if signal.ticket_tag_id else None
        if tag is not None and tag.workstream_id in flows_by_id:
            return str(tag.id)
        for tag_id in tags_by_signal.get(signal.id, []):
            if tag_id in tags and tags[tag_id].workstream_id is None:
                return str(tag_id)
        return NO_LABEL

    def flow_of(signal: Signal) -> str | None:
        tag = tags.get(signal.ticket_tag_id) if signal.ticket_tag_id else None
        if tag is not None and tag.workstream_id in flows_by_id:
            return f"flow:{tag.workstream_id}"
        return None

    # Results: deliveries first, then the folder, then an outbound message.
    delivered: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    if signal_ids:
        for row in (
            await session.execute(
                select(SignalEvent).where(
                    SignalEvent.signal_id.in_(signal_ids),
                    SignalEvent.event_type == "delivered",
                    SignalEvent.created_at >= since,
                )
            )
        ).scalars().all():
            delivered[row.signal_id].append(_payload(row.payload_json))
    # Outbound messages: any at all makes an estimated reply; those in the
    # period count as replies when no delivered reply was recorded.
    outbound_all: set[UUID] = set()
    outbound_in_period: Counter[UUID] = Counter()
    if signal_ids:
        for sid, total, recent in (
            await session.execute(
                select(
                    SignalMessage.signal_id,
                    func.count(),
                    func.sum(case((SignalMessage.created_at >= since, 1), else_=0)),
                )
                .where(
                    SignalMessage.signal_id.in_(signal_ids),
                    SignalMessage.direction == "outbound",
                    SignalMessage.kind.in_(("user_message", "agent_message")),
                )
                .group_by(SignalMessage.signal_id)
            )
        ).all():
            if total:
                outbound_all.add(sid)
            outbound_in_period[sid] = int(recent or 0)

    # Closed on purpose: no reply needed, or handled outside Bokito.
    on_purpose: dict[UUID, str] = {}
    closed_ids = [s.id for s in signals if s.status == "closed"]
    if closed_ids:
        for row in (
            await session.execute(
                select(SignalEvent).where(
                    SignalEvent.signal_id.in_(closed_ids),
                    SignalEvent.event_type.in_(("no_reply_noted", "suggestion_created", "handled_externally")),
                )
            )
        ).scalars().all():
            if row.event_type == "handled_externally":
                on_purpose[row.signal_id] = "handled_externally"
            elif row.event_type == "no_reply_noted" or _payload(row.payload_json).get("kind") == "action_suggestion":
                on_purpose.setdefault(row.signal_id, "no_reply")

    # Folders: a subfolder's work counts on its top folder.
    all_folders = {
        p.id: p
        for p in (
            await session.execute(select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None)))
        ).scalars().all()
    }
    root_of = folder_roots(all_folders)
    sub_tally: dict[UUID, Counter[str]] = defaultdict(Counter)

    def folder_node(folder_id: UUID | None) -> str | None:
        if folder_id is None or folder_id not in root_of:
            return None
        root = root_of[folder_id]
        node_id = f"folder:{root}"
        if node_id not in nodes:
            folder = all_folders[root]
            nodes[node_id] = _node(node_id, "folder", "result", folder.name, f"/folders/{folder.id}")
        return node_id

    for signal in signals:
        folder_node(signal.project_id)
    for rows in delivered.values():
        for data in rows:
            folder_node(_uuid(data.get("folder_id")))

    reply_channels: set[str] = set()
    connection_labels: dict[str, str] = {}
    replies: Counter[str] = Counter()
    closed_counts: Counter[str] = Counter()
    estimated = False

    def results_of(signal: Signal, channel_id: str) -> list[str]:
        nonlocal estimated
        out: list[str] = []
        subs: set[UUID] = set()
        delivered_replies = 0
        for data in delivered.get(signal.id, []):
            kind = data.get("target_kind")
            if kind == "reply":
                out.append(REPLY)
                delivered_replies += 1
                reply_channels.add(str(data.get("channel") or signal.channel or ""))
            elif kind in ("folder", "works_in"):
                folder_id = _uuid(data.get("folder_id"))
                node_id = folder_node(folder_id)
                if node_id:
                    out.append(node_id)
                    if folder_id != root_of[folder_id]:
                        subs.add(folder_id)
                elif data.get("connection_id"):
                    node_id = f"{CONNECTION_RESULT}{data['connection_id']}"
                    connection_labels.setdefault(node_id, str(data.get("title") or data.get("provider") or ""))
                    out.append(node_id)
            elif kind == "knowledge":
                out.append(KNOWLEDGE)
        for sub in subs:
            sub_tally[sub]["count"] += 1
        if delivered_replies:
            replies[channel_id] += delivered_replies
        if out:
            return list(dict.fromkeys(out))
        node_id = folder_node(signal.project_id)
        if node_id:
            estimated = True
            if signal.project_id != root_of[signal.project_id]:
                sub_tally[signal.project_id]["count"] += 1
            return [node_id]
        if signal.id in outbound_all:
            estimated = True
            reply_channels.add(signal.channel or "")
            replies[channel_id] += max(1, outbound_in_period.get(signal.id, 0))
            return [REPLY]
        if signal.status != "closed":
            return [SINK_OPEN]
        reason = on_purpose.get(signal.id)
        if reason:
            closed_counts[reason] += 1
        return [SINK_CLOSED]

    # Department per conversation decides an executor's main zone.
    contact_ids = {s.contact_id for s in signals if s.contact_id}
    contact_dept = (
        {
            c.id: c.owner_department_id
            for c in (await session.execute(select(Contact).where(Contact.id.in_(contact_ids)))).scalars().all()
        }
        if contact_ids
        else {}
    )

    def department_of(signal: Signal) -> UUID | None:
        if signal.assignee_kind == "department" and signal.assignee_id:
            return signal.assignee_id
        account = accounts_by_id.get(signal.channel_account_id) if signal.channel_account_id else None
        if account is not None and account.routing_department_id:
            return account.routing_department_id
        return contact_dept.get(signal.contact_id) if signal.contact_id else None

    decisions = await _signals_with_open_decisions(session, tenant_id, signal_ids=signal_ids) if signal_ids else set()
    cache: dict[str, Any] = {}
    paths: dict[tuple[str, str], _Path] = defaultdict(_Path)
    zone_votes: dict[str, Counter[UUID]] = defaultdict(Counter)
    executor_modes: dict[str, Counter[str]] = defaultdict(Counter)
    executor_why: dict[str, Counter[tuple[str, str, str]]] = defaultdict(Counter)

    def ensure(node_id: str, factory) -> dict[str, Any]:
        if node_id not in nodes:
            nodes[node_id] = factory()
        return nodes[node_id]

    for signal in signals:
        label = label_key(signal)
        channel_id = _channel_node_id(signal, widget.id if widget else None)
        executor_id = _executor_node_id(signal)
        if executor_id.startswith("agent:") and UUID(executor_id[6:]) not in agents:
            executor_id = UNASSIGNED
        if executor_id.startswith("user:") and UUID(executor_id[5:]) not in users:
            executor_id = UNASSIGNED
        flow_id = flow_of(signal)
        is_open = signal.status != "closed"

        if channel_id not in nodes:
            nodes[channel_id] = _node(
                channel_id, "channel", "input", signal.channel or "other", None, channel=signal.channel
            )
        if executor_id == UNASSIGNED and UNASSIGNED not in nodes:
            nodes[UNASSIGNED] = _node(UNASSIGNED, "unassigned", "executor", "", None)

        if executor_id.startswith("agent:"):
            handling = await resolve_for_signal(session, tenant, signal, cache=cache)
            mode = handling.effective
            if signal.id in in_period:
                executor_why[executor_id][(handling.effective, handling.source, handling.clamped_by or "")] += 1
        elif executor_id.startswith("user:"):
            mode = "human"
        else:
            mode = "none"

        dept = department_of(signal)
        if dept is not None:
            zone_votes[executor_id][dept] += 1

        results = results_of(signal, channel_id) if signal.id in in_period else []
        for result_id in results:
            if result_id == REPLY:
                ensure(REPLY, lambda: _node(REPLY, "reply", "result", "", None, channels=[]))
            elif result_id == KNOWLEDGE:
                ensure(KNOWLEDGE, lambda: _node(KNOWLEDGE, "knowledge", "result", "", "/knowledge"))
            elif result_id == SINK_OPEN:
                ensure(SINK_OPEN, lambda: _node(SINK_OPEN, "sink_open", "result", "", "/communication"))
            elif result_id == SINK_CLOSED:
                ensure(SINK_CLOSED, lambda: _node(SINK_CLOSED, "sink_closed_without_result", "result", "", None))
            elif result_id.startswith(CONNECTION_RESULT):
                ensure(
                    result_id,
                    lambda rid=result_id: _node(rid, "connection", "result", connection_labels.get(rid, ""), "/integrations"),
                )

        # Open counts on the nodes that hold the conversation now.
        if is_open:
            holders = [executor_id]
            if flow_id:
                holders.append(flow_id)
            folder_holder = folder_node(signal.project_id)
            if folder_holder:
                holders.append(folder_holder)
                if signal.project_id != root_of[signal.project_id]:
                    sub_tally[signal.project_id]["open"] += 1
            if SINK_OPEN in results:
                holders.append(SINK_OPEN)
            for holder in holders:
                if holder in nodes:
                    nodes[holder]["open"] += 1
                    nodes[holder]["open_by_label"][label] = nodes[holder]["open_by_label"].get(label, 0) + 1
            if signal.id in decisions and executor_id in nodes:
                nodes[executor_id]["waiting_on_you"] = nodes[executor_id].get("waiting_on_you", 0) + 1

        if signal.id not in in_period:
            continue
        executor_modes[executor_id][mode] += 1
        for node_id in {channel_id, executor_id, *(r for r in results), *((flow_id,) if flow_id else ())}:
            if node_id in nodes:
                nodes[node_id]["count"] += 1
        paths[(channel_id, executor_id)].add(mode, label)
        if flow_id:
            paths[(executor_id, flow_id)].add(mode, label)
            if signal.ticket_status in ("done", "closed"):
                nodes[flow_id]["done"] += 1
        source = flow_id or executor_id
        for result_id in results:
            if result_id == KNOWLEDGE:
                paths[(REPLY, KNOWLEDGE)].add(mode, label)
                continue
            paths[(source, result_id)].add(mode, label)

    # Folders: Works in items and the subfolders whose work counts here.
    for node_id, node in nodes.items():
        if node["kind"] != "folder":
            continue
        folder = all_folders[UUID(node_id[7:])]
        node["works_in"] = [
            {
                "key": i["key"],
                "kind": i["kind"],
                "origin": i["origin"],
                "in_bokito": i["origin"] == "bokito",
                "label": i["label"],
                "href": i["href"],
            }
            for i in await works_in_items(session, tenant_id, folder.id)
        ]
        subfolders = [f for fid, f in all_folders.items() if fid != folder.id and root_of[fid] == folder.id]
        node["children_count"] = len(subfolders)
        node["children"] = len(subfolders)
        node["subtitle"] = ""
        node["subfolders"] = [
            {
                "id": str(f.id),
                "label": f.name,
                "href": f"/folders/{f.id}",
                "count": sub_tally[f.id]["count"],
                "open": sub_tally[f.id]["open"],
            }
            for f in sorted(subfolders, key=lambda f: (-sub_tally[f.id]["count"], -sub_tally[f.id]["open"], f.name.lower()))
        ]
    if REPLY in nodes:
        nodes[REPLY]["channels"] = sorted(c for c in reply_channels if c)
    for node_id, node in nodes.items():
        if node["kind"] == "channel":
            node["replies"] = replies.get(node_id, 0)
    if closed_counts and SINK_CLOSED not in nodes:
        nodes[SINK_CLOSED] = _node(SINK_CLOSED, "sink_closed_without_result", "result", "", None)
    if SINK_CLOSED in nodes:
        nodes[SINK_CLOSED]["closed_on_purpose"] = {reason: closed_counts.get(reason, 0) for reason in CLOSED_ON_PURPOSE}

    # Zones: the department that saw most of an executor's work, ties by name.
    zones = [
        {
            "id": str(d.id),
            "label": d.name,
            "href": f"/departments/{d.id}",
            "hint": "agent_first" if d.pickup == "agent_first" else "people",
        }
        for d in sorted(departments.values(), key=lambda d: d.name.lower())
    ]
    zones.append({"id": ZONE_NONE, "label": "", "href": None, "hint": ""})
    connected = connected_user_ids_for(tenant_id)
    overload_at = overload_threshold(
        [n["open"] for n in nodes.values() if n["layer"] == "executor" and n["kind"] != "unassigned"]
    )
    for node_id, node in nodes.items():
        if node["layer"] != "executor" or node["kind"] == "unassigned":
            continue
        own = executor_departments.get(node_id, set())
        votes = zone_votes.get(node_id, Counter())
        ordered = sorted(own, key=lambda d: (-votes.get(d, 0), departments[d].name.lower()))
        node["zones"] = [str(d) for d in ordered]
        node.setdefault("waiting_on_you", 0)
        modes = executor_modes.get(node_id)
        node["autonomy"] = modes.most_common(1)[0][0] if modes else None
        node["autonomy_why"] = None
        if node["kind"] == "agent":
            why = executor_why.get(node_id)
            if why:
                (mode, source, clamped_by), _n = why.most_common(1)[0]
            else:
                idle = resolve_ai_handling(tenant, scope="workspace", agent=agents.get(UUID(node_id[6:])))
                mode, source, clamped_by = idle.effective, idle.source, idle.clamped_by or ""
                node["autonomy"] = mode
            node["autonomy_why"] = {"mode": mode, "source": source, "clamped_by": clamped_by or None}
        if node["open"] > overload_at:
            node["issues"].append("overloaded")
        if not own:
            node["issues"].append("no_department")
        if node["kind"] == "user" and node["open"]:
            user = users.get(UUID(node_id[5:]))
            if user is not None and visible_user_status(user, connected=str(user.id) in connected) != "available":
                node["issues"].append("offline")
    if UNASSIGNED in nodes:
        nodes[UNASSIGNED]["zones"] = []
        nodes[UNASSIGNED]["waiting_on_you"] = nodes[UNASSIGNED].get("waiting_on_you", 0)
        nodes[UNASSIGNED]["autonomy"] = None
        nodes[UNASSIGNED]["autonomy_why"] = None
        if nodes[UNASSIGNED]["open"]:
            nodes[UNASSIGNED]["issues"].append("unassigned")

    # "Open conversations" on the detail card: the Communication view for this node.
    for node_id, node in nodes.items():
        kind = node["kind"]
        href = node.get("href") or ""
        if kind == "channel":
            node["threads_href"] = href if href.startswith("/communication/") else None
        elif kind == "agent":
            node["threads_href"] = f"/communication/inbox/open?agent={node_id[6:]}"
        elif kind == "unassigned":
            node["threads_href"] = "/communication/inbox/unassigned"
        elif kind == "folder":
            node["threads_href"] = f"/communication/folder/{node_id[7:]}"
        elif kind == "sink_open":
            node["threads_href"] = "/communication/inbox/open"
        else:
            node["threads_href"] = None

    # Labels in the period, plus "no label" only when work has none.
    used = Counter()
    for path in paths.values():
        used.update(path.by_label)
    for node in nodes.values():
        used.update(node["open_by_label"])
    labels: list[dict[str, Any]] = []
    for key, _count in sorted(used.items(), key=lambda kv: -kv[1]):
        if key == NO_LABEL:
            continue
        tag = tags.get(UUID(key))
        if tag is None:
            continue
        flow_live = tag.workstream_id in flows_by_id
        color = (flow_label_color(tag.color) or FLOW_LABEL_COLOR) if flow_live else _free_label_color(tag.id)
        icon = ((tag.icon or "").strip() or FLOW_LABEL_ICON) if flow_live else ((tag.icon or "").strip() or None)
        labels.append(
            {
                "id": str(tag.id),
                "name": tag.name,
                "color": color,
                "icon": icon,
                "flow_id": str(tag.workstream_id) if flow_live else None,
            }
        )
    if used.get(NO_LABEL):
        labels.append({"id": None, "name": "", "color": NO_LABEL_COLOR, "icon": None, "flow_id": None})

    # Bottlenecks per department, addressed to its lead. Unassigned work is All's.
    from app.services.department_access import department_leads
    from app.services.teams import all_department

    root = await all_department(session, tenant_id)
    lead_names: dict[UUID, str | None] = {}

    async def lead_of(dept_id: UUID) -> str | None:
        if dept_id not in lead_names:
            lead_id = (await department_leads(session, tenant_id, dept_id))["lead_agent_id"]
            lead = agents.get(lead_id) if lead_id else None
            lead_names[dept_id] = lead.name if lead else None
        return lead_names[dept_id]

    issues: list[dict[str, Any]] = []
    for node in nodes.values():
        for issue in node["issues"]:
            zone = (node.get("zones") or [None])[0]
            dept_id = UUID(zone) if zone and zone != ZONE_NONE else root.id
            issues.append(
                {
                    "severity": "warning" if issue in ("overloaded", "unassigned") else "info",
                    "node_id": node["id"],
                    "message_key": issue,
                    "params": {"name": node["label"], "count": node["open"]},
                    "department_id": str(dept_id),
                    "department": departments[dept_id].name if dept_id in departments else root.name,
                    "lead": await lead_of(dept_id),
                }
            )

    return {
        "days": days,
        "since": since.isoformat() + "Z",
        "layers": list(LAYERS),
        "zones": zones,
        "nodes": list(nodes.values()),
        "paths": [path.serialize(s, t) for (s, t), path in paths.items()],
        "labels": labels,
        "estimated": estimated,
        "issues": issues,
    }


# ---------------------------------------------------------------------------
# Suggest labels: the Labels lens hands unlabeled work to a chat agent.
# ---------------------------------------------------------------------------

SUGGEST_SAMPLE = 15

_SUGGEST_TITLE = {"en": "Suggest labels: {node}", "nl": "Labels voorstellen: {node}"}
_SUGGEST_OPENER = {
    "en": (
        "Suggest labels for the work without a label at {node} over the last {days} days. "
        "These are up to {n} of those conversations, with sender and company:\n\n{lines}\n\n"
        "Send one label plan with propose_label_plan. Reuse existing labels first; who sent it "
        "goes on the company or an inbox rule, not in the label name."
    ),
    "nl": (
        "Stel labels voor voor het werk zonder label bij {node} in de afgelopen {days} dagen. "
        "Dit zijn maximaal {n} van die gesprekken, met afzender en bedrijf:\n\n{lines}\n\n"
        "Stuur één labelplan met propose_label_plan. Hergebruik eerst bestaande labels; wie het "
        "stuurde hoort op het bedrijf of in een inbox-regel, niet in de labelnaam."
    ),
}
_UNASSIGNED_NAME = {"en": "Unassigned", "nl": "Niet toegewezen"}


async def _suggest_node_name(session: AsyncSession, tenant_id: UUID, node_id: str, lang: str) -> str | None:
    from app.models.agent import Agent

    kind, _, raw_id = node_id.partition(":")
    if node_id == UNASSIGNED:
        return _UNASSIGNED_NAME[lang]
    try:
        row_id = UUID(raw_id)
    except ValueError:
        return raw_id if kind == "channel" and raw_id else None
    model = {"agent": Agent, "user": User, "folder": Project, "channel": ChannelAccount}.get(kind)
    if model is None:
        return None
    row = await session.get(model, row_id)
    if row is None or (kind != "user" and getattr(row, "tenant_id", None) != tenant_id):
        return None
    if kind == "user":
        return (row.display_name or row.email or "").strip()
    if kind == "channel":
        return row.display_name or row.address or row.channel
    return row.name


async def unlabeled_sample(
    session: AsyncSession, tenant_id: UUID, node_id: str, *, days: int = 7, limit: int = SUGGEST_SAMPLE
) -> list[Signal]:
    """Recent conversations at a Grid node with no flow label and no free label."""
    from sqlalchemy import exists

    from app.services.ai_handling import widget_account

    since = utcnow() - timedelta(days=max(1, min(int(days or 7), 90)))
    widget = await widget_account(session, tenant_id)
    rows = (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.deleted_at.is_(None),
                or_(Signal.last_message_at >= since, Signal.status != "closed"),
                Signal.ticket_tag_id.is_(None),
                ~exists().where(
                    SignalTagLink.signal_id == Signal.id,
                    SignalTagLink.tag_id == SignalTag.id,
                    SignalTag.workstream_id.is_(None),
                ),
            )
            .order_by(Signal.last_message_at.desc())
        )
    ).scalars().all()
    widget_id = widget.id if widget else None
    root_of: dict[UUID, UUID] = {}
    if node_id.startswith("folder:"):
        root_of = folder_roots(
            {
                p.id: p
                for p in (
                    await session.execute(
                        select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None))
                    )
                ).scalars().all()
            }
        )

    def at_node(signal: Signal) -> bool:
        if node_id.startswith("channel:"):
            return _channel_node_id(signal, widget_id) == node_id
        if node_id.startswith("folder:"):
            return signal.project_id in root_of and f"folder:{root_of[signal.project_id]}" == node_id
        return _executor_node_id(signal) == node_id

    picked = [
        s
        for s in rows
        if not is_internal_channel(s.channel or "") and s.channel != "assistant" and at_node(s)
    ]
    return picked[:limit]


async def _sample_companies(
    session: AsyncSession, tenant_id: UUID, sample: list[Signal]
) -> dict[UUID, str]:
    """Company name per contact in the sample, so the agent can scope by company."""
    from app.models.channel import Company, Contact

    contact_ids = {s.contact_id for s in sample if s.contact_id}
    if not contact_ids:
        return {}
    rows = (
        await session.execute(
            select(Contact.id, Company.name, Company.domain)
            .join(Company, Company.id == Contact.company_id)
            .where(Contact.tenant_id == tenant_id, Contact.id.in_(contact_ids))
        )
    ).all()
    return {contact_id: (name or domain) for contact_id, name, domain in rows if name or domain}


def _suggest_sender(signal: Signal, companies: dict[UUID, str]) -> str:
    parts = [p for p in (signal.contact_email or "", companies.get(signal.contact_id) if signal.contact_id else "") if p]
    return f" ({' · '.join(parts)})" if parts else ""


async def open_label_suggestion(
    session: AsyncSession,
    tenant: Tenant,
    user: User,
    node_id: str,
    *,
    days: int = 7,
    lang: str = "en",
    is_admin: bool = False,
) -> dict[str, Any] | None:
    """Open an agent chat that proposes labels for a node's unlabeled work.

    The opener lists the conversations; the agent proposes and the operator
    decides. Returns None when the node has no unlabeled work in the period.
    """
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.ownership import set_owner
    from app.services.personal_agents import allowed_company_agents, get_user_preference

    lang = "nl" if lang == "nl" else "en"
    name = await _suggest_node_name(session, tenant.id, node_id, lang)
    if name is None:
        return None
    sample = await unlabeled_sample(session, tenant.id, node_id, days=days)
    if not sample:
        return None
    companies = await _sample_companies(session, tenant.id, sample)
    company = await allowed_company_agents(session, tenant.id, user.id, is_admin=is_admin)
    if not company:
        return {"error": "no_agent"}
    pref = await get_user_preference(session, tenant.id, user.id)
    by_id = {a.id: a for a in company}
    agent = (
        by_id.get(pref.default_chat_agent_id) if pref and pref.default_chat_agent_id else None
    ) or next((a for a in company if a.is_lead), None) or company[0]

    lines = "\n".join(
        f"- [{(s.subject or s.contact_name or str(s.id)[:8]).strip()}](/threads/{s.id})"
        f"{_suggest_sender(s, companies)}"
        for s in sample
    )
    opener = _SUGGEST_OPENER[lang].format(node=name, days=days, n=len(sample), lines=lines)
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="chat",
        subject=_SUGGEST_TITLE[lang].format(node=name)[:250],
        owner_user_id=user.id,
        agent_id=agent.id,
        contact_name=user.display_name or user.email,
        has_unread=False,
    )
    set_owner(signal, "user", user.id, by_user_id=user.id)
    session.add(signal)
    await session.flush()
    await append_signal_chat_message(session, signal, role="user", content=opener, author_user_id=user.id)
    await session.commit()
    return {"id": str(signal.id), "agent_id": str(agent.id), "title": signal.subject, "has_opener": True}
