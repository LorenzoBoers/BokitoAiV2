"""The outward orientation: what changes outside that a client could use.

A department with ``settings.lens == "outward"`` (Research) gets a weekly
orientation instead of the morning snapshot. Its prompt lists the client
folders, a folder with a Profile doc, with a short excerpt of that profile.
The lead searches the web and calls ``post_trend`` for each client a trend
fits: an internal conversation labelled ``#trend`` in that folder, with who it
is for, why, how to use it, and the sources. One trend per title per folder
per week.
"""

from __future__ import annotations

from app.core.time import utcnow

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.signal import Signal
from app.models.team import Department
from app.models.workspace import WorkspaceDoc

OUTWARD = "outward"
OUTWARD_CRON = "0 8 * * 1"
TREND_TAG = "trend"
TREND_SOURCE = "trend"
PROFILE_TITLES = ("profiel", "profile")
MAX_FOLDERS = 20
EXCERPT = 500


def department_lens(dept: Department | None) -> str:
    if dept is None:
        return ""
    try:
        settings = json.loads(dept.settings_json or "{}")
    except json.JSONDecodeError:
        return ""
    return str(settings.get("lens") or "") if isinstance(settings, dict) else ""


def set_department_lens(dept: Department, lens: str) -> None:
    try:
        settings = json.loads(dept.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    settings["lens"] = lens
    dept.settings_json = json.dumps(settings)


async def client_folders(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(Project, WorkspaceDoc)
            .join(WorkspaceDoc, WorkspaceDoc.project_id == Project.id)
            .where(
                Project.tenant_id == tenant_id,
                Project.deleted_at.is_(None),
                WorkspaceDoc.deleted_at.is_(None),
                func.lower(WorkspaceDoc.title).in_(PROFILE_TITLES),
            )
            .order_by(Project.name)
            .limit(MAX_FOLDERS)
        )
    ).all()
    out = []
    for project, doc in rows:
        text = re.sub(r"\s+", " ", re.sub(r"^#.*$", "", doc.content or "", flags=re.M)).strip()
        out.append({"folder_id": str(project.id), "name": project.name, "profile": text[:EXCERPT]})
    return out


OUTWARD_TASK = (
    "You look outward for this workspace once a week. Search the web for what changed this week "
    "in the platforms, formats and markets of the clients below (web_search, fetch_url). For each "
    "client a finding fits, call post_trend once with that client's folder: who it is for, why it "
    "matters to them, how to use it, and the source links. Skip a client nothing fits. Then post "
    "one short line in this conversation with how many trends you filed."
)


def render_outward(folders: list[dict[str, Any]]) -> str:
    lines = ["## Clients"]
    if not folders:
        lines.append("No client folder has a Profile doc yet.")
    for row in folders:
        lines.append(f"- {row['name']} [folder {row['folder_id']}]: {row['profile'] or 'profile is empty'}")
    return "\n".join(lines)


async def outward_prompt(session: AsyncSession, tenant_id: UUID) -> str:
    folders = await client_folders(session, tenant_id)
    return f"{render_outward(folders)}\n\n## Your task\n{OUTWARD_TASK}"


def _week(now: datetime) -> str:
    iso = now.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def render_trend(*, for_whom: str, why: str, how: str, sources: list[str]) -> str:
    parts = []
    if for_whom.strip():
        parts.append(f"**For whom:** {for_whom.strip()}")
    if why.strip():
        parts.append(f"**Why:** {why.strip()}")
    if how.strip():
        parts.append(f"**How:** {how.strip()}")
    if sources:
        parts.append("**Sources:**\n" + "\n".join(f"- {s}" for s in sources))
    return "\n\n".join(parts)


async def post_trend(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    folder_id: UUID,
    title: str,
    for_whom: str = "",
    why: str = "",
    how: str = "",
    sources: list[str] | None = None,
    agent_id: UUID | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    from app.services.folders import folder_tag_ids
    from app.services.chat_runtime import post_message
    from app.services.ownership import apply_owner
    from app.services.signal_tags import add_signal_tag_ids, add_signal_tags

    now = now or utcnow()
    title = (title or "").strip()[:200]
    sources = [s.strip() for s in (sources or []) if str(s).strip()][:10]
    if not title:
        return {"error": "title_required"}
    if not sources:
        return {"error": "sources_required", "message": "A trend needs at least one source link."}
    folder = await session.get(Project, folder_id)
    if folder is None or folder.tenant_id != tenant_id or folder.deleted_at is not None:
        return {"error": "folder_not_found", "message": "Pass a folder id from the client list."}
    external_id = f"trend:{folder.id}:{_week(now)}:{_slug(title)}"
    existing = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.source == TREND_SOURCE,
                Signal.external_id == external_id,
            )
        )
    ).scalars().first()
    if existing is not None:
        return {"ok": True, "status": "exists", "signal_id": str(existing.id)}

    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source=TREND_SOURCE,
        external_id=external_id,
        subject=title,
        status="open",
        agent_id=agent_id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()
    if agent_id:
        await apply_owner(session, signal, "agent", agent_id)
    await add_signal_tag_ids(session, tenant_id, signal.id, await folder_tag_ids(session, folder.id))
    await add_signal_tags(session, tenant_id, signal.id, [TREND_TAG], actor_type="agent", actor_id=str(agent_id or ""))
    await post_message(
        session,
        signal,
        content=render_trend(for_whom=for_whom, why=why, how=how, sources=sources),
        role="assistant",
        trust="system",
        author_agent_id=agent_id,
        metadata={"trend": True, "sources": sources},
    )
    await session.commit()
    return {"ok": True, "status": "posted", "signal_id": str(signal.id), "folder": folder.name}
