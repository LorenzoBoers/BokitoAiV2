"""Browser DOM log for one tenant, kept 48 hours.

There is no product screen. Turn it on in tenant settings under ``debug_dom``
when a visual hitch needs the actual focus, animation, and size events.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow

FEATURES = frozenset({"communication", "canvas"})
_NAMES = frozenset({"focus", "key", "anim", "resize", "node"})
_DETAIL_KEYS = frozenset({"tag", "id", "role", "key", "typing", "name", "cls", "w", "h", "action"})
_SAFE_IDS = frozenset({"inbox-reply-composer"})
SETTINGS_KEY = "debug_dom"


def read_flag(settings_json: str | None) -> dict[str, Any]:
    try:
        settings = json.loads(settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        settings = {}
    raw = settings.get(SETTINGS_KEY) if isinstance(settings, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    enabled = bool(raw.get("enabled"))
    features = [str(item) for item in (raw.get("features") or []) if str(item) in FEATURES]
    if enabled and not features:
        features = ["communication"]
    return {"enabled": enabled, "features": features}


def write_flag(settings_json: str | None, *, enabled: bool, features: list[str]) -> str:
    try:
        settings = json.loads(settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    kept = [item for item in features if item in FEATURES]
    if enabled and not kept:
        kept = ["communication"]
    settings[SETTINGS_KEY] = {"enabled": bool(enabled), "features": kept}
    return json.dumps(settings)


def clean_event(raw: dict[str, Any]) -> dict[str, Any] | None:
    name = str(raw.get("name") or "").strip().lower()[:40]
    if name not in _NAMES:
        return None
    incoming = raw.get("detail") if isinstance(raw.get("detail"), dict) else {}
    detail: dict[str, Any] = {}
    for key in _DETAIL_KEYS:
        if key not in incoming:
            continue
        value = incoming[key]
        if isinstance(value, bool):
            detail[key] = value
        elif isinstance(value, int) and not isinstance(value, bool):
            detail[key] = value
        elif isinstance(value, float) and key in {"w", "h"}:
            detail[key] = int(value)
        elif isinstance(value, str):
            text_value = value.strip()[:80]
            if key == "id" and text_value not in _SAFE_IDS:
                continue
            detail[key] = text_value
    return {"name": name, "detail": detail}


async def record_debug_dom(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    feature: str,
    signal_id: UUID | None,
    events: list[dict[str, Any]],
    enabled: bool,
) -> int:
    """Store cleaned events when the tenant flag is on. Drops rows older than 48 hours."""
    if not enabled or feature not in FEATURES:
        return 0
    kept = [row for row in (clean_event(item) for item in events[:20]) if row is not None]
    await session.execute(
        text("delete from debug_dom_events where created_at < now() - interval '48 hours'")
    )
    if not kept:
        await session.commit()
        return 0
    now = utcnow()
    for row in kept:
        await session.execute(
            text(
                """
                insert into debug_dom_events
                    (id, tenant_id, user_id, signal_id, feature, name, detail, created_at)
                values
                    (:id, :tenant_id, :user_id, :signal_id, :feature, :name,
                     cast(:detail as jsonb), :created_at)
                """
            ),
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "user_id": user_id,
                "signal_id": signal_id,
                "feature": feature,
                "name": row["name"],
                "detail": json.dumps(row["detail"]),
                "created_at": now,
            },
        )
    await session.commit()
    return len(kept)
