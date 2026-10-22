"""Why this conversation runs the way it does: who answered, how far the AI may
go and what caps it, which docs it read, and where the conversation is filed.

``lines`` is what the panel shows, in order: one sentence per line (an i18n
``kind`` with ``params``) and the page where that setting is changed.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.ai_handling import mode_rank, resolve_for_signal
from app.services.deliveries import list_deliveries

AUTONOMY_HREF = "/settings/govern?tab=policy"
CHANNELS_HREF = "/settings/channels"
PRIVACY_HREF = "/settings/trust"


def _line(kind: str, href: str | None = None, **params: Any) -> dict[str, Any]:
    return {"kind": kind, "params": params, "href": href}


def _meta(row: SignalMessage | None) -> dict[str, Any]:
    if row is None:
        return {}
    try:
        data = json.loads(row.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def _last_agent_message(session: AsyncSession, signal: Signal) -> SignalMessage | None:
    return (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal.id, SignalMessage.author_agent_id.is_not(None))
            .order_by(func.coalesce(SignalMessage.received_at, SignalMessage.created_at).desc())
            .limit(1)
        )
    ).scalars().first()


async def _agent(
    session: AsyncSession, signal: Signal, last: SignalMessage | None
) -> tuple[Agent | None, str]:
    """The agent that answered (``reply``), else the owner (``owner``), else the one on turn."""
    for agent_id, via in ((last.author_agent_id if last else None, "reply"), (signal.agent_id, "owner")):
        if agent_id:
            agent = await session.get(Agent, agent_id)
            if agent is not None and agent.tenant_id == signal.tenant_id:
                return agent, via
    from app.services.signal_threads import _active_turn_payload

    turn = _active_turn_payload(signal) or {}
    if turn.get("kind") == "agent" and turn.get("ref_id"):
        try:
            agent = await session.get(Agent, UUID(str(turn["ref_id"])))
        except ValueError:
            agent = None
        if agent is not None and agent.tenant_id == signal.tenant_id:
            return agent, "addressed"
    return None, ""


async def _placement(session: AsyncSession, signal: Signal) -> dict[str, Any]:
    from app.models.channel import Contact
    from app.models.orchestra import Workstream
    from app.models.project import Project, ProjectTagLink
    from app.models.signal import CompanyTagLink, ContactTagLink, SignalTag, SignalTagLink

    folder: dict[str, Any] | None = None
    if signal.project_id:
        project = await session.get(Project, signal.project_id)
        if project is not None and project.tenant_id == signal.tenant_id and project.deleted_at is None:
            folder = {"id": str(project.id), "name": project.name, "tag": None, "origin": None}
            tags = (
                await session.execute(
                    select(SignalTag)
                    .join(ProjectTagLink, ProjectTagLink.tag_id == SignalTag.id)
                    .where(ProjectTagLink.project_id == project.id)
                    .order_by(ProjectTagLink.sort_order)
                )
            ).scalars().all()
            contact = await session.get(Contact, signal.contact_id) if signal.contact_id else None
            own = set(
                (
                    await session.execute(select(SignalTagLink.tag_id).where(SignalTagLink.signal_id == signal.id))
                ).scalars()
            )
            on_contact: set[UUID] = set()
            on_company: set[UUID] = set()
            if contact is not None:
                on_contact = set(
                    (
                        await session.execute(
                            select(ContactTagLink.tag_id).where(ContactTagLink.contact_id == contact.id)
                        )
                    ).scalars()
                )
                if contact.company_id:
                    on_company = set(
                        (
                            await session.execute(
                                select(CompanyTagLink.tag_id).where(CompanyTagLink.company_id == contact.company_id)
                            )
                        ).scalars()
                    )
            for tag in tags:
                origin = (
                    "conversation" if tag.id in own
                    else "contact" if tag.id in on_contact
                    else "company" if tag.id in on_company
                    else None
                )
                if origin is None:
                    continue
                folder["tag"] = {"id": str(tag.id), "name": tag.name}
                folder["origin"] = origin
                if origin != "conversation":
                    break
            if folder["origin"] == "contact" and contact is not None:
                folder["origin_href"] = f"/contacts/{contact.id}"
            elif folder["origin"] == "company" and contact is not None and contact.company_id:
                folder["origin_href"] = f"/contacts/companies/{contact.company_id}"

    flow: dict[str, Any] | None = None
    if signal.ticket_tag_id:
        tag = await session.get(SignalTag, signal.ticket_tag_id)
        ws = await session.get(Workstream, tag.workstream_id) if tag is not None and tag.workstream_id else None
        if ws is not None and ws.tenant_id == signal.tenant_id and ws.deleted_at is None:
            from app.services.tickets import workstream_stages

            stage = next((s for s in workstream_stages(ws) if s["key"] == signal.stage_key), None)
            flow = {
                "id": str(ws.id),
                "name": ws.name,
                "label": tag.name if tag is not None else "",
                "stage": {"key": stage["key"], "name": stage["name"]} if stage else None,
                "autonomy": ws.autonomy or "",
            }
    return {"folder": folder, "flow": flow}


def _delivery_lines(deliveries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replies collapse to one line per channel; every other delivery gets its own line."""
    lines: list[dict[str, Any]] = []
    replies: dict[str, int] = {}
    for row in deliveries:
        if row.get("target_kind") == "reply":
            channel = str(row.get("channel") or "")
            replies[channel] = replies.get(channel, 0) + 1
    for channel, count in replies.items():
        lines.append(_line("delivered_reply", None, channel=channel, count=count))
    for row in deliveries:
        kind = row.get("target_kind")
        if kind == "works_in" and not row.get("folder_id") and row.get("connection_id"):
            lines.append(
                _line(
                    "delivered_connection",
                    "/integrations",
                    connection=row.get("title") or row.get("provider") or "",
                )
            )
        elif kind == "works_in":
            lines.append(
                _line(
                    "delivered_works_in",
                    row.get("href"),
                    folder=row.get("folder_name") or "",
                    item=row.get("item_label") or "",
                    item_kind=row.get("item_kind") or "",
                )
            )
        elif kind == "folder":
            lines.append(
                _line("delivered_folder", row.get("href"), folder=row.get("folder_name") or "", title=row.get("title") or "")
            )
        elif kind == "knowledge":
            lines.append(_line("delivered_knowledge", "/knowledge"))
    return lines


def _handling_lines(handling, agent: Agent | None, flow: dict[str, Any] | None) -> list[dict[str, Any]]:
    source_href = {
        "workspace": AUTONOMY_HREF,
        "channel": CHANNELS_HREF,
        "flow": f"/flows/{flow['id']}" if flow else None,
    }.get(handling.source)
    lines = [
        _line(
            f"handling_{handling.source}",
            source_href,
            mode=handling.requested,
            source=handling.source_label,
        )
    ]
    cap_href = {
        "govern": AUTONOMY_HREF,
        "privacy": PRIVACY_HREF,
        "breaker": CHANNELS_HREF,
        "agent": f"/agents/{agent.id}" if agent is not None else None,
    }
    for cap in handling.ceilings:
        if mode_rank(cap["cap"]) >= mode_rank(handling.requested):
            continue
        reason = cap["reason"]
        lines.append(
            _line(
                f"cap_{reason}",
                cap_href.get(reason),
                mode=cap["cap"],
                agent=agent.name if agent is not None and reason == "agent" else "",
            )
        )
    return lines


async def explain_thread(session: AsyncSession, tenant: Tenant, signal_id: UUID) -> dict | None:
    signal = await session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != tenant.id:
        return None
    last = await _last_agent_message(session, signal)
    agent, agent_via = await _agent(session, signal, last)
    handling = await resolve_for_signal(session, tenant, signal, agent=agent)
    placement = await _placement(session, signal)

    knowledge = [
        {"doc_id": ref["doc_id"], "title": ref.get("title") or "", "href": f"/knowledge/{ref['doc_id']}"}
        for ref in _meta(last).get("knowledge_refs") or []
        if isinstance(ref, dict) and ref.get("doc_id")
    ]

    lines: list[dict[str, Any]] = []
    if agent is not None:
        lines.append(_line(f"agent_{agent_via}", f"/agents/{agent.id}", name=agent.name))
    else:
        lines.append(_line("agent_none", CHANNELS_HREF))
    lines.extend(_handling_lines(handling, agent, placement["flow"]))
    if last is not None:
        if knowledge:
            lines.extend(_line("knowledge_doc", ref["href"], title=ref["title"]) for ref in knowledge)
        else:
            lines.append(_line("knowledge_none", "/knowledge"))
    folder = placement["folder"]
    if folder:
        if folder.get("origin"):
            lines.append(
                _line(
                    f"folder_{folder['origin']}",
                    folder.get("origin_href") or f"/folders/{folder['id']}",
                    folder=folder["name"],
                    tag=folder["tag"]["name"],
                )
            )
        else:
            lines.append(_line("folder", f"/folders/{folder['id']}", folder=folder["name"]))
    flow = placement["flow"]
    if flow:
        lines.append(
            _line(
                "flow",
                f"/flows/{flow['id']}",
                flow=flow["name"],
                label=flow["label"],
                stage=flow["stage"]["name"] if flow["stage"] else "",
            )
        )
    deliveries = await list_deliveries(session, signal.id)
    lines.extend(_delivery_lines(deliveries))

    return {
        "effective": handling.effective,
        "requested": handling.requested,
        "source": handling.source,
        "source_label": handling.source_label,
        "ceiling": handling.ceiling,
        "clamped_by": handling.clamped_by,
        "reason": handling.reason,
        "agent": (
            {"id": str(agent.id), "name": agent.name, "via": agent_via} if agent is not None else None
        ),
        "ai_handling": {
            "effective": handling.effective,
            "requested": handling.requested,
            "layers": handling.layers,
            "ceilings": handling.ceilings,
        },
        "knowledge": knowledge,
        "placement": placement,
        "deliveries": deliveries,
        "lines": lines,
    }
