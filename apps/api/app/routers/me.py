"""Per-user settings: UI preferences and chat defaults."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import UserPreference
from app.services.language import platform_default_ui_language
from app.services.operator_prefs import close_email_on_send
from app.services.personal_agents import allowed_company_agents, get_user_preference
from app.services.user_memory import clear_user_memory, delete_user_memory, list_user_memory

router = APIRouter(prefix="/me", tags=["me"])


class PreferencesPatch(BaseModel):
    default_chat_agent_id: UUID | None = None
    ui_language: str | None = None
    # First-run tour state (intro_done, completed, dismissed, version, ...).
    # Shallow-merged so future tour keys need no API change.
    tour: dict | None = None
    # Invited members: personal language/notifications wizard finished.
    personal_wizard_completed: bool | None = None
    # Communication hub folder defaults: which sub-view a folder opens on.
    # Shape: {
    #   "default_queue": "open",
    #   "channel_defaults": {"team:<uuid>": "for_you"},
    # }
    inbox_folders: dict | None = None
    # Post-login / home landing: communication (default) or overview (/cockpit).
    default_landing: str | None = None
    # Numeric EmailConnection / ChannelAccount id used as From: when starting
    # outbound mail. Null clears the preference.
    default_outbound_connection_id: int | None = None
    # Personal Communication/Agenda rail pins. Each pin is {ref, position}.
    # ref is folder:<id>, tag:<name>, or path:<folder_id>:<tag_id>.
    rail_pins: list[dict] | None = None
    # Workspace-default rail rows this person hid (same ref shape as rail_pins).
    rail_hidden_defaults: list[str] | None = None
    # Communication sidebar: section order, hidden, collapsed, expanded leaves.
    sidebar: dict | None = None
    # Personal: sending an email reply closes that conversation.
    close_email_on_send: bool | None = None


# Matches SUB_QUEUES in apps/dashboard/src/lib/messages-paths.ts.
INBOX_SUB_QUEUES = ("for_you", "open", "unassigned", "closed")
DEFAULT_LANDINGS = ("chat", "communication", "overview")

def _default_landing_state(stored: dict) -> str:
    raw = stored.get("default_landing")
    return raw if raw in DEFAULT_LANDINGS else "chat"


def _outbound_connection_id(stored: dict) -> int | None:
    raw = stored.get("default_outbound_connection_id")
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int) and raw > 0:
        return raw
    if isinstance(raw, str) and raw.isdigit():
        value = int(raw)
        return value if value > 0 else None
    return None


def _tour_state(stored: dict) -> dict:
    tour = stored.get("tour")
    return tour if isinstance(tour, dict) else {}


def _inbox_folders_state(stored: dict) -> dict:
    raw = stored.get("inbox_folders")
    if not isinstance(raw, dict):
        return {"default_queue": "open", "channel_defaults": {}}
    default_queue = raw.get("default_queue")
    if default_queue not in INBOX_SUB_QUEUES:
        default_queue = "open"
    channel_defaults = raw.get("channel_defaults")
    if not isinstance(channel_defaults, dict):
        channel_defaults = {}
    cleaned = {
        str(key)[:80]: value
        for key, value in channel_defaults.items()
        if value in INBOX_SUB_QUEUES
    }
    return {
        "default_queue": default_queue,
        "channel_defaults": cleaned,
    }


_CANONICAL_SECTIONS = ("folders", "flows", "channels", "agents", "teams", "settings")
MAX_RAIL_PINS = 80
MAX_SIDEBAR_ITEMS = 400


def _normalize_section(value: str) -> str:
    if value in ("hashtags", "projects"):
        return "folders"
    return value


def _rail_pins_state(stored: dict) -> list[dict]:
    raw = stored.get("rail_pins")
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        ref = str(item.get("ref") or "").strip()[:80]
        if not ref or ref in seen:
            continue
        seen.add(ref)
        try:
            position = int(item.get("position") or 0)
        except (TypeError, ValueError):
            position = 0
        out.append({"ref": ref, "position": position})
        if len(out) >= MAX_RAIL_PINS:
            break
    out.sort(key=lambda row: row["position"])
    return out


def _rail_hidden_defaults_state(stored: dict) -> list[str]:
    raw = stored.get("rail_hidden_defaults")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        ref = item.strip()[:80]
        if ref and ref not in out:
            out.append(ref)
        if len(out) >= MAX_RAIL_PINS:
            break
    return out


def _item_ids(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        ref = item.strip()[:120]
        if ref and ref not in out:
            out.append(ref)
        if len(out) >= MAX_SIDEBAR_ITEMS:
            break
    return out


def _item_order_state(raw: object) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, value in raw.items():
        parent = str(key).strip()[:80]
        if not parent:
            continue
        ids = _item_ids(value)
        if ids:
            out[parent] = ids
        if len(out) >= 80:
            break
    return out


def _fill_section_order(order: list[str]) -> list[str]:
    middle = [section for section in order if section != "settings"]
    for section in _CANONICAL_SECTIONS:
        if section == "settings" or section in middle:
            continue
        insert_at = len(middle)
        default_idx = _CANONICAL_SECTIONS.index(section)
        for prior in reversed(_CANONICAL_SECTIONS[:default_idx]):
            if prior in middle:
                insert_at = middle.index(prior) + 1
                break
        middle.insert(insert_at, section)
    return middle + ["settings"]


def _sidebar_state(stored: dict) -> dict:
    raw = stored.get("sidebar")
    if not isinstance(raw, dict):
        raw = {}
    order_raw = raw.get("order") if isinstance(raw.get("order"), list) else []
    order: list[str] = []
    for item in order_raw:
        if not isinstance(item, str):
            continue
        section = _normalize_section(item)
        if section in _CANONICAL_SECTIONS and section not in order:
            order.append(section)
    order = _fill_section_order(order)
    hidden = [
        _normalize_section(item)
        for item in (raw.get("hidden") if isinstance(raw.get("hidden"), list) else [])
        if isinstance(item, str) and _normalize_section(item) in _CANONICAL_SECTIONS
    ]
    collapsed = [
        _normalize_section(item)
        for item in (raw.get("collapsed") if isinstance(raw.get("collapsed"), list) else [])
        if isinstance(item, str) and _normalize_section(item) in _CANONICAL_SECTIONS
    ]
    expanded = [
        str(item)[:80]
        for item in (raw.get("expanded_leaves") if isinstance(raw.get("expanded_leaves"), list) else [])
        if isinstance(item, str)
    ][:200]
    hidden_items = _item_ids(raw.get("hidden_items"))
    if "queue:for_you" in hidden_items and "queue:open" in hidden_items:
        hidden_items = [item for item in hidden_items if item != "queue:open"]
    return {
        "order": order,
        "hidden": list(dict.fromkeys(hidden)),
        "collapsed": list(dict.fromkeys(collapsed)),
        "expanded_leaves": expanded,
        "item_order": _item_order_state(raw.get("item_order")),
        "hidden_items": hidden_items,
    }


@router.get("/preferences")
async def get_my_preferences(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    import json

    try:
        stored = json.loads(auth.user.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    lang = stored.get("ui_language")
    if lang not in ("en", "nl"):
        lang = platform_default_ui_language()
    return {
        "ui_language": lang,
        "tour": _tour_state(stored),
        "personal_wizard_completed": bool(stored.get("personal_wizard_completed")),
        "inbox_folders": _inbox_folders_state(stored),
        "default_landing": _default_landing_state(stored),
        "default_outbound_connection_id": _outbound_connection_id(stored),
        "rail_pins": _rail_pins_state(stored),
        "rail_hidden_defaults": _rail_hidden_defaults_state(stored),
        "sidebar": _sidebar_state(stored),
        "close_email_on_send": close_email_on_send(stored),
    }


@router.patch("/preferences")
async def patch_my_preferences(
    body: PreferencesPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    import json

    try:
        stored = json.loads(auth.user.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    if body.ui_language is not None:
        if body.ui_language not in ("en", "nl"):
            raise HTTPException(status_code=400, detail="ui_language must be en or nl")
        stored["ui_language"] = body.ui_language
    if body.tour is not None:
        merged = {**_tour_state(stored), **body.tour}
        # Scalars only, bounded size: this is UI flag state, not a data store.
        cleaned = {
            str(k)[:40]: v
            for k, v in merged.items()
            if isinstance(v, (bool, int, float, str)) and len(str(v)) <= 64
        }
        if len(cleaned) > 20:
            raise HTTPException(status_code=400, detail="tour state too large")
        stored["tour"] = cleaned
    if body.personal_wizard_completed is not None:
        stored["personal_wizard_completed"] = bool(body.personal_wizard_completed)
    if body.inbox_folders is not None:
        current = _inbox_folders_state(stored)
        merged = {**current, **body.inbox_folders}
        default_queue = merged.get("default_queue")
        if default_queue not in INBOX_SUB_QUEUES:
            raise HTTPException(status_code=400, detail="default_queue must be one of open/mine/unassigned/closed")
        channel_defaults = merged.get("channel_defaults")
        if not isinstance(channel_defaults, dict):
            raise HTTPException(status_code=400, detail="channel_defaults must be an object")
        cleaned_defaults: dict[str, str] = {}
        for key, value in channel_defaults.items():
            # Sending null/invalid for a key drops that override.
            if value in INBOX_SUB_QUEUES:
                cleaned_defaults[str(key)[:80]] = value
        if len(cleaned_defaults) > 100:
            raise HTTPException(status_code=400, detail="too many channel defaults")
        stored["inbox_folders"] = {
            "default_queue": default_queue,
            "channel_defaults": cleaned_defaults,
        }
    if body.default_landing is not None:
        if body.default_landing not in DEFAULT_LANDINGS:
            raise HTTPException(
                status_code=400,
                detail="default_landing must be chat, communication, or overview",
            )
        stored["default_landing"] = body.default_landing
    if "default_outbound_connection_id" in body.model_fields_set:
        if body.default_outbound_connection_id is None:
            stored.pop("default_outbound_connection_id", None)
        elif body.default_outbound_connection_id <= 0:
            raise HTTPException(status_code=400, detail="default_outbound_connection_id must be positive")
        else:
            stored["default_outbound_connection_id"] = int(body.default_outbound_connection_id)
    if body.rail_pins is not None:
        stored["rail_pins"] = _rail_pins_state({"rail_pins": body.rail_pins})
    if body.rail_hidden_defaults is not None:
        stored["rail_hidden_defaults"] = _rail_hidden_defaults_state(
            {"rail_hidden_defaults": body.rail_hidden_defaults}
        )
    if body.sidebar is not None:
        stored["sidebar"] = _sidebar_state({"sidebar": body.sidebar})
    if body.close_email_on_send is not None:
        stored["close_email_on_send"] = bool(body.close_email_on_send)
    auth.user.settings_json = json.dumps(stored)
    session.add(auth.user)

    default_chat_agent_id: str | None = None
    if body.default_chat_agent_id is not None:
        company = await allowed_company_agents(
            session, auth.tenant.id, auth.user.id, is_admin=auth.role in ("owner", "admin")
        )
        valid_ids = {a.id for a in company}
        # Explicit null clears the preference; otherwise must be a permitted company agent.
        if body.default_chat_agent_id not in valid_ids:
            # Allow clearing via a sentinel? Prefer Optional and use a separate flag.
            # Callers send a company agent id only.
            raise HTTPException(status_code=400, detail="Not a permitted chat target")
        pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
        if not pref:
            pref = UserPreference(tenant_id=auth.tenant.id, user_id=auth.user.id)
            session.add(pref)
        pref.default_chat_agent_id = body.default_chat_agent_id
        pref.updated_at = datetime.utcnow()
        default_chat_agent_id = str(body.default_chat_agent_id)
    else:
        pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
        if pref and pref.default_chat_agent_id:
            default_chat_agent_id = str(pref.default_chat_agent_id)

    await session.commit()
    stored_lang = stored.get("ui_language")
    return {
        "ui_language": stored_lang if stored_lang in ("en", "nl") else platform_default_ui_language(),
        "tour": _tour_state(stored),
        "personal_wizard_completed": bool(stored.get("personal_wizard_completed")),
        "inbox_folders": _inbox_folders_state(stored),
        "default_landing": _default_landing_state(stored),
        "default_outbound_connection_id": _outbound_connection_id(stored),
        "rail_pins": _rail_pins_state(stored),
        "rail_hidden_defaults": _rail_hidden_defaults_state(stored),
        "sidebar": _sidebar_state(stored),
        "close_email_on_send": close_email_on_send(stored),
        "default_chat_agent_id": default_chat_agent_id,
    }


@router.get("/chat-default")
async def get_chat_default(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Preferred company agent for new chats, if any."""
    pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
    company = await allowed_company_agents(
        session, auth.tenant.id, auth.user.id, is_admin=auth.role in ("owner", "admin")
    )
    default_id = pref.default_chat_agent_id if pref else None
    if default_id and default_id not in {a.id for a in company}:
        default_id = None
    return {
        "default_chat_agent_id": str(default_id) if default_id else None,
        "agents": [
            {"id": str(a.id), "name": a.name, "role": a.role} for a in company
        ],
    }


def _serialize_memory_entry(entry) -> dict:
    return {
        "key": entry.key,
        "content": entry.content,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


@router.get("/assistant-memory")
async def get_my_assistant_memory(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Facts Bokito remembers about this person across workspaces."""
    entries = await list_user_memory(session, auth.user.id)
    return {"entries": [_serialize_memory_entry(e) for e in entries]}


@router.delete("/assistant-memory/{key}")
async def delete_my_assistant_memory_entry(
    key: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    removed = await delete_user_memory(session, auth.user.id, key, commit=True)
    if not removed:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return {"ok": True, "key": key}


@router.delete("/assistant-memory")
async def clear_my_assistant_memory(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    count = await clear_user_memory(session, auth.user.id, commit=True)
    return {"ok": True, "deleted": count}
