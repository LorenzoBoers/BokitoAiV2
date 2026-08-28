"""Per-user settings: the personal assistant and chat preferences."""

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
from app.services.personal_agents import (
    allowed_company_agents,
    get_or_create_personal_agent,
    get_user_preference,
)

router = APIRouter(prefix="/me", tags=["me"])


class AssistantPatch(BaseModel):
    name: str | None = None
    instructions: str | None = None
    default_chat_agent_id: UUID | None = None


class PreferencesPatch(BaseModel):
    ui_language: str | None = None
    # First-run tour state (intro_done, completed, dismissed, version, ...).
    # Shallow-merged so future tour keys need no API change.
    tour: dict | None = None
    # Communication hub folder defaults: which sub-view a channel/tag opens on,
    # plus which tags stay pinned in the Tags sidebar section.
    # Shape: {
    #   "default_queue": "open",
    #   "channel_defaults": {"channel:email:12": "mine"},
    #   "sidebar_tags": ["billing", "vip"],
    # }
    inbox_folders: dict | None = None


# Matches SUB_QUEUES in apps/dashboard/src/lib/messages-paths.ts.
INBOX_SUB_QUEUES = ("open", "mine", "unassigned", "closed")
MAX_SIDEBAR_TAGS = 40
MAX_SIDEBAR_TAG_LEN = 40


def _tour_state(stored: dict) -> dict:
    tour = stored.get("tour")
    return tour if isinstance(tour, dict) else {}


def _clean_sidebar_tags(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        tag = item.strip().lower()[:MAX_SIDEBAR_TAG_LEN]
        if not tag or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= MAX_SIDEBAR_TAGS:
            break
    return out


def _inbox_folders_state(stored: dict) -> dict:
    raw = stored.get("inbox_folders")
    if not isinstance(raw, dict):
        return {"default_queue": "open", "channel_defaults": {}, "sidebar_tags": []}
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
        "sidebar_tags": _clean_sidebar_tags(raw.get("sidebar_tags")),
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
        "inbox_folders": _inbox_folders_state(stored),
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
            "sidebar_tags": _clean_sidebar_tags(merged.get("sidebar_tags")),
        }
    auth.user.settings_json = json.dumps(stored)
    session.add(auth.user)
    await session.commit()
    stored_lang = stored.get("ui_language")
    return {
        "ui_language": stored_lang if stored_lang in ("en", "nl") else platform_default_ui_language(),
        "tour": _tour_state(stored),
        "inbox_folders": _inbox_folders_state(stored),
    }


async def _assistant_payload(session: AsyncSession, auth: AuthContext) -> dict:
    agent = await get_or_create_personal_agent(session, auth.tenant.id, auth.user)
    pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
    default_id = agent.id
    if pref and pref.default_chat_agent_id:
        default_id = pref.default_chat_agent_id
    return {
        "agent": {
            "id": str(agent.id),
            "name": agent.name,
            "instructions": agent.system_prompt,
            "model": agent.model,
            "kind": agent.kind,
        },
        "default_chat_agent_id": str(default_id),
    }


@router.get("/assistant")
async def get_my_assistant(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _assistant_payload(session, auth)


@router.patch("/assistant")
async def patch_my_assistant(
    body: AssistantPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    agent = await get_or_create_personal_agent(session, auth.tenant.id, auth.user)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Assistant name cannot be empty")
        agent.name = name
    if body.instructions is not None:
        agent.system_prompt = body.instructions
    agent.updated_at = datetime.utcnow()

    if body.default_chat_agent_id is not None:
        valid_ids = {agent.id} | {
            a.id
            for a in await allowed_company_agents(
                session, auth.tenant.id, auth.user.id, is_admin=auth.role in ("owner", "admin")
            )
        }
        if body.default_chat_agent_id not in valid_ids:
            raise HTTPException(status_code=400, detail="Not a permitted chat target")
        pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
        if not pref:
            pref = UserPreference(tenant_id=auth.tenant.id, user_id=auth.user.id)
            session.add(pref)
        pref.default_chat_agent_id = body.default_chat_agent_id
        pref.updated_at = datetime.utcnow()

    await session.commit()
    return await _assistant_payload(session, auth)
