"""The department as a domain: what it knows, which threads are its, whom it reaches.

Domain settings live in ``Department.settings_json["domain"]["questions"]``: a
question the lead agent asks the person accountable, and the answer once given.
Answered questions are facts the lead reads in every run (``domain_facts``).

``department_of_signal`` decides which department a thread belongs to: the
department that holds it, the flow it is filed on, the agent that owns it, or
the company's owning department. ``reach_people`` orders the human side for the
reach ladder: the person accountable, then the backup, then the other members.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalTag
from app.models.team import Department, DepartmentMember

OPEN = "open"
ANSWERED = "answered"
MAX_QUESTIONS = 40


def dept_settings(dept: Department | None) -> dict[str, Any]:
    if dept is None:
        return {}
    try:
        data = json.loads(dept.settings_json or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_dept_settings(dept: Department, data: dict[str, Any]) -> None:
    dept.settings_json = json.dumps(data)


def domain_questions(dept: Department | None) -> list[dict[str, Any]]:
    domain = dept_settings(dept).get("domain")
    rows = domain.get("questions") if isinstance(domain, dict) else None
    return [r for r in rows or [] if isinstance(r, dict) and r.get("key") and r.get("question")]


def _save_questions(dept: Department, rows: list[dict[str, Any]]) -> None:
    data = dept_settings(dept)
    domain = data.get("domain") if isinstance(data.get("domain"), dict) else {}
    domain["questions"] = rows[-MAX_QUESTIONS:]
    data["domain"] = domain
    write_dept_settings(dept, data)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


async def ask_domain_question(
    session: AsyncSession,
    tenant_id: UUID,
    dept: Department,
    question: str,
    *,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    """Record an open domain question and post it in the department room.

    The same question (case and spacing ignored) is never asked twice. Caller commits.
    """
    from app.services.chat_runtime import post_message
    from app.services.department_access import department_leads
    from app.services.teams import get_or_create_team_room

    text = question.strip()[:600]
    if not text:
        raise ValueError("question is required")
    rows = domain_questions(dept)
    for row in rows:
        if _norm(row["question"]) == _norm(text):
            return {**row, "duplicate": True}
    room = await get_or_create_team_room(session, tenant_id, dept)
    await session.flush()
    leads = await department_leads(session, tenant_id, dept.id)
    who = f"@[accountable](user:{leads['accountable_user_id']}) " if leads["accountable_user_id"] else ""
    message = await post_message(
        session,
        room,
        content=f"{who}Domain question: {text}",
        role="assistant" if agent_id else "user",
        trust="system",
        author_agent_id=agent_id,
        metadata={"domain_question": True},
    )
    row = {
        "key": uuid.uuid4().hex[:12],
        "question": text,
        "answer": "",
        "status": OPEN,
        "asked_by_agent_id": str(agent_id) if agent_id else None,
        "asked_at": datetime.utcnow().isoformat() + "Z",
        "answered_at": None,
        "answered_by_user_id": None,
        "signal_id": str(room.id),
        "message_id": str(message.id),
    }
    rows.append(row)
    _save_questions(dept, rows)
    session.add(dept)
    return row


async def answer_domain_question(
    session: AsyncSession,
    tenant_id: UUID,
    dept: Department,
    key: str,
    answer: str,
    *,
    user_id: UUID | None,
) -> dict[str, Any]:
    """Store the answer and post it in the department room. Caller commits."""
    from app.services.chat_runtime import post_message
    from app.services.teams import get_or_create_team_room

    text = answer.strip()[:2000]
    rows = domain_questions(dept)
    row = next((r for r in rows if r["key"] == key), None)
    if row is None:
        raise LookupError("Question not found")
    row["answer"] = text
    row["status"] = ANSWERED if text else OPEN
    row["answered_at"] = datetime.utcnow().isoformat() + "Z" if text else None
    row["answered_by_user_id"] = str(user_id) if (user_id and text) else None
    _save_questions(dept, rows)
    session.add(dept)
    if text:
        room = await get_or_create_team_room(session, tenant_id, dept)
        await post_message(
            session,
            room,
            content=f"Answer to \"{row['question']}\": {text}",
            role="user",
            trust="operator",
            author_user_id=user_id,
            metadata={"domain_answer": True, "domain_question_key": key},
        )
    return row


def domain_facts(dept: Department | None) -> list[dict[str, str]]:
    return [
        {"question": r["question"], "answer": r["answer"]}
        for r in domain_questions(dept)
        if r.get("status") == ANSWERED and r.get("answer")
    ]


def open_domain_questions(dept: Department | None) -> list[dict[str, Any]]:
    return [r for r in domain_questions(dept) if r.get("status") != ANSWERED]


async def agent_departments(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> list[tuple[Department, str]]:
    """The departments an agent is in, primary duty first."""
    rows = (
        await session.execute(
            select(Department, DepartmentMember.duty)
            .join(DepartmentMember, DepartmentMember.department_id == Department.id)
            .where(
                DepartmentMember.tenant_id == tenant_id,
                DepartmentMember.member_kind == "agent",
                DepartmentMember.agent_id == agent_id,
                Department.deleted_at.is_(None),
            )
        )
    ).all()
    order = {"primary": 0, "backup": 1}
    return sorted(((d, duty or "member") for d, duty in rows), key=lambda r: (order.get(r[1], 2), r[0].name.lower()))


async def department_of_signal(session: AsyncSession, signal: Signal) -> UUID | None:
    """Holder department, then the flow's department, then the owning agent's, then the company's.

    New conversations sit with All by default, so All only answers when nothing more specific does.
    """
    from app.models.channel import Contact
    from app.models.orchestra import Workstream
    from app.models.team import is_root_department

    held_by_all: UUID | None = None
    if signal.assignee_kind == "department" and signal.assignee_id:
        holder = await session.get(Department, signal.assignee_id)
        if holder is None or not is_root_department(holder):
            return signal.assignee_id
        held_by_all = holder.id
    if signal.ticket_tag_id:
        tag = await session.get(SignalTag, signal.ticket_tag_id)
        if tag is not None and tag.workstream_id:
            flow = await session.get(Workstream, tag.workstream_id)
            if flow is not None and flow.department_id:
                return flow.department_id
    if signal.assignee_kind == "agent" and signal.agent_id:
        own = await agent_departments(session, signal.tenant_id, signal.agent_id)
        specific = [d for d, _duty in own if d.parent_id is not None]
        if specific:
            return specific[0].id
    if signal.contact_id:
        contact = await session.get(Contact, signal.contact_id)
        if contact is not None and contact.owner_department_id:
            return contact.owner_department_id
    return held_by_all


async def reach_people(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> list[UUID]:
    """People to reach for this department: accountable, backup, then members; All as last resort."""
    from app.services.teams import all_department

    order = {"primary": 0, "backup": 1}
    out: list[UUID] = []
    for dept_id in (department_id, (await all_department(session, tenant_id)).id):
        rows = (
            await session.execute(
                select(DepartmentMember).where(
                    DepartmentMember.tenant_id == tenant_id,
                    DepartmentMember.department_id == dept_id,
                    DepartmentMember.member_kind == "user",
                )
            )
        ).scalars().all()
        for row in sorted(rows, key=lambda r: (order.get(r.duty or "member", 2), r.position)):
            if row.user_id and row.user_id not in out:
                out.append(row.user_id)
        if out:
            break
    return out


__all__ = [
    "ANSWERED",
    "OPEN",
    "agent_departments",
    "answer_domain_question",
    "ask_domain_question",
    "department_of_signal",
    "dept_settings",
    "domain_facts",
    "domain_questions",
    "open_domain_questions",
    "reach_people",
    "write_dept_settings",
]
