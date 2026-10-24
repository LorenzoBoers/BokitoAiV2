"""Platform and per-agent voice quality tiers (current vs top).

Staff sets the workspace-wide default on Ops. An agent may override it in
identity settings. Resolution: agent ``call_voice_model`` → platform setting →
``current``.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

SETTING_KEY = "voice_model_tier"
TIERS = ("current", "top")
DEFAULT_TIER = "current"

# Speech API (/v1/audio/speech) for voicemail + identity preview.
# Realtime model for live calls. ``current`` Realtime follows env
# ``OPENAI_REALTIME_MODEL`` so existing deploys stay put until staff picks Top.
_TIER_SPEECH = {
    "current": "gpt-4o-mini-tts",
    "top": "gpt-4o-mini-tts-2025-12-15",
}
_TIER_REALTIME = {
    "current": None,  # → settings.openai_realtime_model
    "top": "gpt-realtime-2.1",
}

_CACHE_TTL_S = 5.0
_cached_tier: str | None = None
_cached_at = 0.0


def normalize_tier(value: str | None) -> str | None:
    raw = (value or "").strip().lower()
    if raw in TIERS:
        return raw
    if raw in ("standard", "default"):
        return "current"
    if raw in ("premium", "ferrari"):
        return "top"
    return None


def tier_catalog() -> list[dict[str, Any]]:
    """Choices for Ops and agent identity (ids + which OpenAI models they use)."""
    from app.config import get_settings

    current_realtime = (get_settings().openai_realtime_model or "gpt-realtime-mini").strip()
    return [
        {
            "id": "current",
            "label": "Current",
            "tts_model": _TIER_SPEECH["current"],
            "realtime_model": current_realtime,
        },
        {
            "id": "top",
            "label": "Top",
            "tts_model": _TIER_SPEECH["top"],
            "realtime_model": _TIER_REALTIME["top"],
        },
    ]


def models_for_tier(tier: str) -> dict[str, str]:
    """Concrete OpenAI model ids for a resolved tier."""
    from app.config import get_settings

    key = normalize_tier(tier) or DEFAULT_TIER
    realtime = _TIER_REALTIME[key]
    if not realtime:
        realtime = (get_settings().openai_realtime_model or "gpt-realtime-mini").strip()
    return {
        "tier": key,
        "tts_model": _TIER_SPEECH[key],
        "realtime_model": realtime,
    }


def resolve_tier(
    *,
    agent_settings: str | dict[str, Any] | None = None,
    platform_tier: str | None = None,
) -> str:
    """Agent override, else platform, else current."""
    stored: dict[str, Any]
    if isinstance(agent_settings, dict):
        stored = agent_settings
    else:
        try:
            parsed = json.loads(agent_settings or "{}")
        except (json.JSONDecodeError, TypeError):
            parsed = {}
        stored = parsed if isinstance(parsed, dict) else {}
    agent_tier = normalize_tier(
        stored.get("call_voice_model") if isinstance(stored.get("call_voice_model"), str) else None
    )
    if agent_tier:
        return agent_tier
    return normalize_tier(platform_tier) or DEFAULT_TIER


def cached_platform_tier() -> str:
    return _cached_tier if _cached_tier in TIERS else DEFAULT_TIER


def set_cached_platform_tier(tier: str | None) -> None:
    global _cached_tier, _cached_at
    _cached_tier = normalize_tier(tier) or DEFAULT_TIER
    _cached_at = time.monotonic()


def reset_platform_tier_cache() -> None:
    global _cached_tier, _cached_at
    _cached_tier = None
    _cached_at = 0.0


async def load_platform_tier(session: AsyncSession, *, force: bool = False) -> str:
    """Staff Ops default from ``platform_settings`` (short process cache)."""
    global _cached_tier, _cached_at
    if (
        not force
        and _cached_tier in TIERS
        and time.monotonic() - _cached_at < _CACHE_TTL_S
    ):
        return _cached_tier
    from sqlalchemy import select

    from app.models.model_catalog import PlatformSetting

    row = (
        await session.execute(
            select(PlatformSetting.value).where(PlatformSetting.key == SETTING_KEY)
        )
    ).scalar_one_or_none()
    tier = normalize_tier(row if isinstance(row, str) else None) or DEFAULT_TIER
    set_cached_platform_tier(tier)
    return tier


async def save_platform_tier(session: AsyncSession, tier: str) -> str:
    """Persist staff Ops default; returns the normalized tier."""
    from sqlalchemy import select

    from app.models.model_catalog import PlatformSetting
    from app.core.time import utcnow

    next_tier = normalize_tier(tier)
    if next_tier is None:
        raise ValueError("Unknown voice model tier")
    row = (
        await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY)
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(PlatformSetting(key=SETTING_KEY, value=next_tier))
    else:
        row.value = next_tier
        row.updated_at = utcnow()
        session.add(row)
    await session.commit()
    set_cached_platform_tier(next_tier)
    return next_tier


async def resolve_voice_models(
    session: AsyncSession,
    *,
    agent_settings: str | dict[str, Any] | None = None,
) -> dict[str, str]:
    """Tier + model ids for this agent (or platform-only when settings omitted)."""
    platform = await load_platform_tier(session)
    tier = resolve_tier(agent_settings=agent_settings, platform_tier=platform)
    return models_for_tier(tier)


def public_voice_model_fields(
    *,
    agent_settings: str | None,
    platform_tier: str,
) -> dict[str, Any]:
    """Fields exposed on the agent payload for the identity dialog."""
    stored_tier = None
    try:
        parsed = json.loads(agent_settings or "{}")
    except (json.JSONDecodeError, TypeError):
        parsed = {}
    if isinstance(parsed, dict) and isinstance(parsed.get("call_voice_model"), str):
        stored_tier = normalize_tier(parsed["call_voice_model"])
    effective = resolve_tier(agent_settings=agent_settings, platform_tier=platform_tier)
    models = models_for_tier(effective)
    return {
        "call_voice_model": stored_tier,  # null = inherit platform
        "call_voice_model_effective": effective,
        "call_voice_models": tier_catalog(),
        "call_tts_model": models["tts_model"],
        "call_realtime_model": models["realtime_model"],
    }
