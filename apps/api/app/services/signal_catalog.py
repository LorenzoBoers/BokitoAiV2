"""Workspace policy for categories, plus the backlog of missing categories.

Two things live here, both on ``Tenant.settings_json`` so no extra tables are
needed:

- ``signals.accept_roles`` - who may accept a proposed ticket on a thread
  (``admins`` = owner/admin only, ``members`` = anyone in the workspace).
- ``signals.stage_entry_policy`` / ``stage_entry_threshold`` - how an agent
  may place a ticket in a stage when its flow does not say (see
  ``services.ticket_work``), and ``due_soon_days`` - when a deadline counts
  as near.
- ``signals.backlog`` - patterns interpretation keeps seeing that no hashtag
  covers. Each entry holds a short name, one sentence, an example quote and a
  count. At ``BACKLOG_THRESHOLD`` sightings the entry is ready to become a
  category; an owner/admin promotes or dismisses it on `/settings/labels`.

Interpretation never invents hashtags on a thread - unknown patterns land here
instead, so the vocabulary only grows through a human decision.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError
from app.models.auth import Tenant

ACCEPT_ROLES = ("admins", "members")
DEFAULT_ACCEPT_ROLES = "admins"

#: Sightings before a backlog entry is offered as a new type.
BACKLOG_THRESHOLD = 3
#: Keep the settings blob bounded; the coldest entries fall off first.
MAX_BACKLOG_ENTRIES = 40
MAX_EXAMPLES = 3


def _tenant_settings(tenant: Tenant | None) -> dict[str, Any]:
    if tenant is None:
        return {}
    try:
        parsed = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _signals_section(settings: dict[str, Any]) -> dict[str, Any]:
    section = settings.get("signals")
    return section if isinstance(section, dict) else {}


def signal_policy(tenant: Tenant | None) -> dict[str, Any]:
    """Who may accept signals, and how often a pattern must recur."""
    section = _signals_section(_tenant_settings(tenant))
    accept_roles = str(section.get("accept_roles") or DEFAULT_ACCEPT_ROLES)
    if accept_roles not in ACCEPT_ROLES:
        accept_roles = DEFAULT_ACCEPT_ROLES
    from app.services.ticket_work import (
        DEFAULT_DUE_SOON_DAYS,
        DEFAULT_ENTRY_POLICY,
        DEFAULT_ENTRY_THRESHOLD,
        ENTRY_POLICIES,
    )

    def _int(key: str, default: int, low: int, high: int) -> int:
        try:
            value = int(section.get(key, default))
        except (TypeError, ValueError):
            value = default
        return min(high, max(low, value))

    entry = str(section.get("stage_entry_policy") or DEFAULT_ENTRY_POLICY)
    return {
        "accept_roles": accept_roles,
        "backlog_threshold": _int("backlog_threshold", BACKLOG_THRESHOLD, 1, 10),
        "stage_entry_policy": entry if entry in ENTRY_POLICIES else DEFAULT_ENTRY_POLICY,
        "stage_entry_threshold": _int("stage_entry_threshold", DEFAULT_ENTRY_THRESHOLD, 0, 10),
        "due_soon_days": _int("due_soon_days", DEFAULT_DUE_SOON_DAYS, 1, 60),
    }


def may_accept_signals(tenant: Tenant | None, role: str) -> bool:
    if role in ("owner", "admin"):
        return True
    return signal_policy(tenant)["accept_roles"] == "members"


async def update_signal_policy(
    session: AsyncSession,
    tenant: Tenant,
    *,
    accept_roles: str | None = None,
    backlog_threshold: int | None = None,
    stage_entry_policy: str | None = None,
    stage_entry_threshold: int | None = None,
    due_soon_days: int | None = None,
) -> dict[str, Any]:
    from fastapi import HTTPException

    from app.services.ticket_work import ENTRY_POLICIES

    if accept_roles is not None and accept_roles not in ACCEPT_ROLES:
        raise AppError("accept_roles must be 'admins' or 'members'", code="app_error", status_code=400)
    if backlog_threshold is not None and not 1 <= int(backlog_threshold) <= 10:
        raise AppError("backlog_threshold must be 1-10", code="app_error", status_code=400)
    if stage_entry_policy is not None and stage_entry_policy not in ENTRY_POLICIES:
        raise HTTPException(status_code=400, detail=f"stage_entry_policy must be one of {', '.join(ENTRY_POLICIES)}")
    if stage_entry_threshold is not None and not 0 <= int(stage_entry_threshold) <= 10:
        raise AppError("stage_entry_threshold must be 0-10", code="app_error", status_code=400)
    if due_soon_days is not None and not 1 <= int(due_soon_days) <= 60:
        raise AppError("due_soon_days must be 1-60", code="app_error", status_code=400)

    settings = _tenant_settings(tenant)
    section = dict(_signals_section(settings))
    if accept_roles is not None:
        section["accept_roles"] = accept_roles
    if backlog_threshold is not None:
        section["backlog_threshold"] = int(backlog_threshold)
    if stage_entry_policy is not None:
        section["stage_entry_policy"] = stage_entry_policy
    if stage_entry_threshold is not None:
        section["stage_entry_threshold"] = int(stage_entry_threshold)
    if due_soon_days is not None:
        section["due_soon_days"] = int(due_soon_days)
    settings["signals"] = section
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return signal_policy(tenant)


def _slug_key(value: str) -> str:
    from app.services.signal_tags import normalize_tag

    return normalize_tag(value)


def read_backlog(tenant: Tenant | None) -> list[dict[str, Any]]:
    """Backlog entries, hottest first, with a ``ready`` flag for the UI."""
    raw = _signals_section(_tenant_settings(tenant)).get("backlog")
    rows = raw if isinstance(raw, list) else []
    threshold = signal_policy(tenant)["backlog_threshold"]
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("key"):
            continue
        count = int(row.get("count") or 0)
        items.append(
            {
                "key": str(row["key"]),
                "name": str(row.get("name") or row["key"]),
                "sentence": str(row.get("sentence") or ""),
                "examples": [str(x) for x in (row.get("examples") or []) if x][:MAX_EXAMPLES],
                "count": count,
                "first_seen": row.get("first_seen"),
                "last_seen": row.get("last_seen"),
                "ready": count >= threshold,
                "agents": row.get("agents") if isinstance(row.get("agents"), dict) else {},
            }
        )
    items.sort(key=lambda row: (-row["count"], row["name"]))
    return items


async def _write_backlog(
    session: AsyncSession, tenant: Tenant, rows: list[dict[str, Any]], *, commit: bool = True
) -> None:
    settings = _tenant_settings(tenant)
    section = dict(_signals_section(settings))
    section["backlog"] = rows[:MAX_BACKLOG_ENTRIES]
    settings["signals"] = section
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    if commit:
        await session.commit()
        await session.refresh(tenant)


async def record_unknown(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    sentence: str = "",
    example: str = "",
    agent_id: UUID | None = None,
) -> dict[str, Any] | None:
    """Count one sighting of a pattern the catalog does not cover yet.

    ``agent_id`` is the agent that read it; the cluster goes to that agent's
    department lead as a proposal for a new flow (services/flow_proposals.py).

    Returns the stored entry, or ``None`` when the input is too thin to be
    useful (no name) or the pattern already matches an existing hashtag.
    """
    name = (name or "").strip()
    if len(name) < 3:
        return None
    key = _slug_key(name)
    if not key:
        return None

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return None

    from sqlalchemy import select

    from app.models.signal import SignalTag

    known = set(
        (
            await session.execute(select(SignalTag.name).where(SignalTag.tenant_id == tenant_id))
        ).scalars()
    )
    if key in known:
        return None

    raw = _signals_section(_tenant_settings(tenant)).get("backlog")
    rows = [row for row in (raw if isinstance(raw, list) else []) if isinstance(row, dict)]
    now = utcnow().isoformat()
    entry = next((row for row in rows if str(row.get("key")) == key), None)
    if entry is None:
        entry = {
            "key": key,
            "name": name[:60],
            "sentence": (sentence or "").strip()[:240],
            "examples": [],
            "count": 0,
            "first_seen": now,
        }
        rows.append(entry)
    entry["count"] = int(entry.get("count") or 0) + 1
    entry["last_seen"] = now
    if sentence and not entry.get("sentence"):
        entry["sentence"] = sentence.strip()[:240]
    quote = (example or "").strip()[:200]
    examples = [str(x) for x in (entry.get("examples") or []) if x]
    if quote and quote not in examples:
        examples.append(quote)
    entry["examples"] = examples[-MAX_EXAMPLES:]
    if agent_id is not None:
        agents = entry.get("agents") if isinstance(entry.get("agents"), dict) else {}
        agents[str(agent_id)] = int(agents.get(str(agent_id)) or 0) + 1
        entry["agents"] = agents

    rows.sort(key=lambda row: -int(row.get("count") or 0))
    await _write_backlog(session, tenant, rows)
    return entry


async def dismiss_backlog_entry(
    session: AsyncSession, tenant: Tenant, key: str, *, commit: bool = True
) -> bool:
    raw = _signals_section(_tenant_settings(tenant)).get("backlog")
    rows = [row for row in (raw if isinstance(raw, list) else []) if isinstance(row, dict)]
    kept = [row for row in rows if str(row.get("key")) != key]
    if len(kept) == len(rows):
        return False
    await _write_backlog(session, tenant, kept, commit=commit)
    return True


async def promote_backlog_entry(
    session: AsyncSession,
    tenant: Tenant,
    key: str,
    *,
    name: str | None = None,
    description: str | None = None,
):
    """Turn a backlog entry into a category with a new playbook and drop it from the backlog."""
    from fastapi import HTTPException

    from app.services.signal_tags import create_tag, promote_tag

    entry = next((row for row in read_backlog(tenant) if row["key"] == key), None)
    if entry is None:
        raise NotFoundError("Backlog entry not found")
    try:
        tag = await create_tag(
            session,
            tenant.id,
            name or entry["key"],
            description=(description if description is not None else entry["sentence"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if tag.workstream_id is None:
        tag = await promote_tag(session, tenant.id, tag.id, playbook_name=entry["name"])
    await dismiss_backlog_entry(session, tenant, key)
    return tag
