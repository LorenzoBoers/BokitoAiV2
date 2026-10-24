"""What an agent sees of the organization on a turn (org rules on).

In order: the org chart with your place, who holds this conversation and
what you may do, and the knowledge along the department chain. The folder
docs, the flow recipe and, for a point of contact, the crew follow in the
loop.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal

CHART_LINES = 25
KNOWLEDGE_DOCS_PER_LEVEL = 6


async def knowledge_scope(
    session: AsyncSession, tenant_id: UUID, agent: Agent | None, signal: Signal | None
) -> tuple[list[UUID] | None, set[UUID] | None]:
    """The conversation's department chain (organization down) and the departments the agent may not read."""
    from app.services.department_domain import department_of_signal
    from app.services.department_visibility import hidden_department_ids
    from app.services.org_rules import org_rules_on
    from app.services.teams import department_chain

    if agent is None or not await org_rules_on(session, tenant_id):
        return None, None
    hidden = await hidden_department_ids(session, tenant_id, kind="agent", member_id=agent.id)
    if signal is None:
        return None, hidden
    chain = await department_chain(session, tenant_id, await department_of_signal(session, signal))
    return chain, hidden


async def org_chart_block(session: AsyncSession, tenant_id: UUID, agent: Agent) -> str:
    from app.services.teams import department_tree

    tree = await department_tree(session, tenant_id)
    if not tree:
        return ""
    me = str(agent.id)
    lines: list[str] = []
    for row in tree:
        contact = row.get("contact")
        seat = next((m for m in row["crew"] if m["kind"] == "agent" and m["id"] == me), None)
        line = "  " * row["depth"] + f"- {row['mention']}"
        if contact:
            line += f": point of contact @[{contact['name']}](agent:{contact['id']})"
        focus = next((m.get("focus") for m in row["crew"] if contact and m["id"] == contact["id"]), "")
        if focus:
            line += f" ({focus})"
        if seat is not None or (row["is_org"] and contact and contact["id"] == me):
            line += " <- you"
        lines.append(line)
    if len(lines) > CHART_LINES:
        lines = [*lines[:CHART_LINES], f"... {len(lines) - CHART_LINES} more (list_departments)"]
    return "## Organization\n" + "\n".join(lines)


async def responsibility_block(session: AsyncSession, signal: Signal, agent: Agent) -> str:
    from app.services.work_holder import may_act, responsibility

    who = await responsibility(session, signal)
    allowed, _why = await may_act(session, signal, agent)
    holder = f", holder {who.holder_name}" if who.holder_name else ""
    you = (
        "You may act on it."
        if allowed
        else "You may read it. To change it, ask the holder (ask_agent), hand it over (handoff_to), "
        "or take_over when you sit in that department or above."
    )
    return f"## This conversation\nIt is with {who.department_name}{holder}. {you}"


async def knowledge_chain_block(session: AsyncSession, tenant_id: UUID, chain: list[UUID]) -> str:
    """Docs per level from the organization down to the conversation's department (titles; read_doc for the body)."""
    from app.models.team import Department, is_root_department
    from app.models.workspace import WorkspaceDoc

    if not chain:
        return ""
    lines: list[str] = []
    for department_id in chain:
        dept = await session.get(Department, department_id)
        if dept is None:
            continue
        docs = (
            await session.execute(
                select(WorkspaceDoc.path, WorkspaceDoc.title)
                .where(
                    WorkspaceDoc.tenant_id == tenant_id,
                    WorkspaceDoc.department_id == department_id,
                    WorkspaceDoc.deleted_at.is_(None),
                    WorkspaceDoc.internal.is_(True),
                )
                .order_by(WorkspaceDoc.is_pinned.desc(), WorkspaceDoc.sort_order, WorkspaceDoc.path)
                .limit(KNOWLEDGE_DOCS_PER_LEVEL)
            )
        ).all()
        if not docs:
            continue
        label = "Organization" if is_root_department(dept) else dept.name
        lines.append(f"- {label}: " + ", ".join(f"{title or path} ({path})" for path, title in docs))
    if not lines:
        return ""
    return (
        "## Knowledge along the way\n"
        "Docs from the organization down to this conversation's department. The nearest "
        "level wins when they disagree. Open one with read_doc.\n" + "\n".join(lines)
    )


async def org_context(session: AsyncSession, tenant_id: UUID, agent: Agent, signal: Signal | None) -> str:
    """Org chart, responsibility and knowledge chain; empty while org rules are off."""
    from app.services.org_rules import org_rules_on

    if not await org_rules_on(session, tenant_id):
        return ""
    parts = [await org_chart_block(session, tenant_id, agent)]
    if signal is not None:
        parts.append(await responsibility_block(session, signal, agent))
        chain, _hidden = await knowledge_scope(session, tenant_id, agent, signal)
        parts.append(await knowledge_chain_block(session, tenant_id, chain or []))
    return "\n\n".join(p for p in parts if p)
