"""Realtime voice session for an agent call.

The session carries three tools: consult the running agent, confirm the
open decision, or hang up. Audio stays between the browser and the voice
provider.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import get_settings
from app.exceptions import status_error
from app.services.language import LANGUAGE_NAMES

logger = logging.getLogger(__name__)

# Provider voice ids. Marin and cedar are the recommended pair.
VOICES: tuple[tuple[str, str], ...] = (
    ("marin", "Marin"),
    ("cedar", "Cedar"),
    ("alloy", "Alloy"),
    ("ash", "Ash"),
    ("ballad", "Ballad"),
    ("coral", "Coral"),
    ("echo", "Echo"),
    ("sage", "Sage"),
    ("shimmer", "Shimmer"),
    ("verse", "Verse"),
)
VOICE_IDS = frozenset(voice_id for voice_id, _label in VOICES)
# The provider allows 0.25–1.5, and only between turns.
SPEEDS: tuple[float, ...] = (0.75, 1.0, 1.25, 1.5)
# Spoken language on a call follows the profile languages.
CALL_LANGUAGES = ("nl", "en")


def voice_catalog() -> dict[str, Any]:
    return {
        "voices": [{"id": voice_id, "label": label} for voice_id, label in VOICES],
        "speeds": list(SPEEDS),
        "languages": list(CALL_LANGUAGES),
    }


def normalize_voice(value: str | None, *, fallback: str) -> str:
    raw = (value or "").strip().lower()
    if raw in VOICE_IDS:
        return raw
    fb = (fallback or "").strip().lower()
    return fb if fb in VOICE_IDS else "marin"


def match_speed(value: object) -> float | None:
    try:
        speed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    for choice in SPEEDS:
        if abs(choice - speed) < 0.001:
            return choice
    return None


def normalize_speed(value: object) -> float:
    return match_speed(value) or 1.0


def normalize_call_language(value: str | None, *, fallback: str) -> str:
    raw = (value or "").strip().lower()
    if raw in CALL_LANGUAGES:
        return raw
    fb = (fallback or "").strip().lower()
    return fb if fb in CALL_LANGUAGES else "nl"


def _settings_dict(settings_json: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _stored_call_parts(stored: dict[str, Any]) -> tuple[str | None, float | None, str | None]:
    raw_voice = stored.get("call_voice")
    raw_language = stored.get("call_language")
    raw_speed = stored.get("call_speed")
    voice = raw_voice.strip().lower() if isinstance(raw_voice, str) and raw_voice.strip() else None
    language = raw_language.strip().lower() if isinstance(raw_language, str) and raw_language.strip() else None
    speed = match_speed(raw_speed) if raw_speed not in (None, "") else None
    return voice, speed, language


def _platform_call(settings_json: str | None) -> tuple[str, float, str]:
    from app.services.language import platform_default_ui_language, resolve_user_ui_language

    language_fallback = (
        resolve_user_ui_language(settings_json)
        if settings_json
        else platform_default_ui_language()
    )
    return (
        normalize_voice(None, fallback=get_settings().openai_realtime_voice),
        1.0,
        normalize_call_language(None, fallback=language_fallback),
    )


def public_agent_call_defaults(settings_json: str | None) -> dict[str, Any]:
    """The agent's own voice, speed and spoken language, filled in when unset."""
    voice, speed, language = _stored_call_parts(_settings_dict(settings_json))
    platform_voice, platform_speed, platform_language = _platform_call(None)
    return {
        "voice": normalize_voice(voice, fallback=platform_voice),
        "speed": speed if speed is not None else platform_speed,
        "language": normalize_call_language(language, fallback=platform_language),
        **voice_catalog(),
    }


def resolve_call_prefs(
    settings_json: str | None,
    *,
    agent_settings: str | None = None,
    agent_id: Any = None,
) -> dict[str, Any]:
    """Voice for this call.

    A saved choice by this person for this agent wins. Otherwise the agent's
    default. Otherwise an older person-wide choice, then the platform default.
    """
    user = _settings_dict(settings_json)
    agent_voice, agent_speed, agent_language = _stored_call_parts(_settings_dict(agent_settings))
    agent_set = agent_voice is not None or agent_speed is not None or agent_language is not None
    platform_voice, platform_speed, platform_language = _platform_call(settings_json)
    override: dict[str, Any] | None = None
    if agent_id is not None:
        raw = user.get("call_overrides")
        row = raw.get(str(agent_id)) if isinstance(raw, dict) else None
        if isinstance(row, dict):
            override = row
    if override is not None:
        raw_voice = override.get("voice")
        raw_language = override.get("language")
        voice = normalize_voice(
            raw_voice if isinstance(raw_voice, str) else None,
            fallback=agent_voice or platform_voice,
        )
        speed = match_speed(override.get("speed")) or (agent_speed if agent_speed is not None else platform_speed)
        language = normalize_call_language(
            raw_language if isinstance(raw_language, str) else None,
            fallback=agent_language or platform_language,
        )
    elif agent_set:
        voice = normalize_voice(agent_voice, fallback=platform_voice)
        speed = agent_speed if agent_speed is not None else platform_speed
        language = normalize_call_language(agent_language, fallback=platform_language)
    else:
        legacy_voice, legacy_speed, legacy_language = _stored_call_parts(user)
        voice = normalize_voice(legacy_voice, fallback=platform_voice)
        speed = legacy_speed if legacy_speed is not None else platform_speed
        language = normalize_call_language(legacy_language, fallback=platform_language)
    return {
        "voice": voice,
        "speed": speed,
        "language": language,
        **voice_catalog(),
    }


def store_call_prefs(settings_json: str | None, *, voice: str, speed: float, language: str) -> str:
    stored = _settings_dict(settings_json)
    stored["call_voice"] = voice
    stored["call_speed"] = speed
    stored["call_language"] = language
    return json.dumps(stored)


def store_call_override(
    settings_json: str | None,
    *,
    agent_id: Any,
    voice: str,
    speed: float,
    language: str,
) -> str:
    """Remember this person's voice for one agent. The agent's default stays."""
    stored = _settings_dict(settings_json)
    overrides = stored.get("call_overrides")
    if not isinstance(overrides, dict):
        overrides = {}
    overrides[str(agent_id)] = {"voice": voice, "speed": speed, "language": language}
    stored["call_overrides"] = overrides
    return json.dumps(stored)


def apply_agent_call_defaults(
    settings_json: str | None,
    *,
    voice: str | None = None,
    speed: float | None = None,
    language: str | None = None,
) -> str:
    """Write the agent's default voice. Unknown values are rejected."""
    current = public_agent_call_defaults(settings_json)
    if voice is not None and voice.strip().lower() not in VOICE_IDS:
        raise ValueError("Unknown voice")
    if language is not None and language.strip().lower() not in CALL_LANGUAGES:
        raise ValueError("Unknown language")
    matched_speed = match_speed(speed) if speed is not None else None
    if speed is not None and matched_speed is None:
        raise ValueError("Unknown speed")
    next_voice = voice.strip().lower() if voice is not None else current["voice"]
    next_speed = matched_speed if matched_speed is not None else current["speed"]
    next_language = language.strip().lower() if language is not None else current["language"]
    stored = _settings_dict(settings_json)
    stored["call_voice"] = next_voice
    stored["call_speed"] = next_speed
    stored["call_language"] = next_language
    return json.dumps(stored)

_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "consult_run",
        "description": (
            "Look up one workspace fact that is not already in the conversation. "
            "Call this only when you cannot answer from what was already said. "
            "Say nothing while this runs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "What the run should look up or do, in one sentence.",
                }
            },
            "required": ["question"],
        },
    },
    {
        "type": "function",
        "name": "hang_up",
        "description": (
            "End this call. Say one short goodbye in the same turn, then call "
            "this. Use it when the person says goodbye, is done, or the "
            "decision is settled and nothing is left to ask."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "confirm_choice",
        "description": (
            "Record the person's choice on the open decision. Call this only "
            "after they clearly pick one of the options."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "option_id": {"type": "string"},
                "label": {"type": "string"},
            },
        },
    },
]


def voice_instructions(
    *,
    agent_name: str,
    title: str,
    summary: str,
    options: list[dict[str, Any]],
    reconnected: bool = False,
    language: str = "nl",
    conversation: bool = False,
    thread: str = "",
    learned: str = "",
    push_to_talk: bool = False,
) -> str:
    spoken = LANGUAGE_NAMES.get(language, "Dutch")
    lines = [
        f"You are {agent_name}, on a live call with the person you work with.",
        f"Speak only {spoken}. Every sentence you say is in {spoken}: "
        "the opening, the options, confirmations, and the goodbye. "
        "When the decision text or a run update is in another language, say it in "
        f"{spoken}. Do not switch language unless the person explicitly asks. "
        "You are the only voice on this call. Do not speak as another agent.",
        "Speak as that agent. Short spoken sentences. No lists, no markdown.",
    ]
    if conversation or not title.strip():
        if not push_to_talk:
            lines.append(
                "The person started voice mode on this conversation. "
                "Help with what they ask. Open with one short sentence, then listen."
            )
    else:
        lines.append(f"The open decision is: {title}.")
    if push_to_talk:
        lines.append(
            "The person holds a button to speak and releases it when that turn is done. "
            "Stay silent until they have spoken. Answer that turn, then wait. "
            "Do not greet them and do not fill a silence."
        )
    if summary.strip():
        lines.append(f"Context: {summary.strip()}")
    if options:
        lines.append("Options:")
        for option in options:
            label = str(option.get("label") or option.get("title") or option.get("id") or "")
            option_id = str(option.get("id") or "")
            if label:
                lines.append(f"- {label} (id: {option_id})")
    if reconnected:
        lines.append(
            "The line just reconnected after a page reload. You are already in this call. "
            "Continue where you left off. Do not introduce yourself again."
        )
    elif not push_to_talk and not conversation and title.strip():
        lines.append("Open by stating the decision and the options.")
    if thread.strip():
        lines.append("Recent conversation. Answer from this when you can:\n" + thread.strip())
    if learned.strip():
        lines.append(
            "Facts you already looked up. Use these. Do not look them up again:\n" + learned.strip()
        )
    lines.extend(
        [
            "Answer from the conversation and the facts above. "
            "Call consult_run only when a workspace fact is missing from that context. "
            "When you call it, say nothing else in that turn. "
            "Do not say you are looking, checking, or that the person should wait. "
            "Do not call consult_run again until the person says something new.",
            "When you are told to speak a run result, say it in one or two sentences "
            "and stop. Do not call any tool for that result.",
            "When the person picks an option, call confirm_choice with its id, then confirm aloud.",
            "When the person says goodbye, is done, or the decision is settled "
            "and nothing is left to ask, say one short goodbye and call hang_up. "
            "Do not ask another question after that.",
            "You cannot change the workspace yourself. Only the run can.",
        ]
    )
    return "\n".join(lines)


_PREVIEW_LINES = {
    "nl": "Hoi, ik ben {name}. Zo klink ik.",
    "en": "Hi, I'm {name}. This is how I sound.",
}


async def preview_call_voice(
    *,
    voice: str,
    speed: float,
    language: str,
    name: str,
) -> bytes:
    """A short sample in this voice, so the identity screen can play it."""
    if voice.strip().lower() not in VOICE_IDS:
        raise status_error(status_code=422, detail="Unknown voice")
    if language.strip().lower() not in CALL_LANGUAGES:
        raise status_error(status_code=422, detail="Unknown language")
    matched = match_speed(speed)
    if matched is None:
        raise status_error(status_code=422, detail="Unknown speed")
    settings = get_settings()
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise status_error(status_code=503, detail="Voice is not configured")
    spoken = language.strip().lower()
    who = (name or "").strip()[:40] or "Bokito"
    payload = {
        "model": "gpt-4o-mini-tts",
        "voice": voice.strip().lower(),
        "input": _PREVIEW_LINES[spoken].format(name=who),
        "speed": matched,
        "response_format": "mp3",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.warning("voice preview failed: %s", exc)
        raise status_error(status_code=503, detail="Voice is unavailable") from exc
    if response.status_code >= 400:
        logger.warning("voice preview %s %s", response.status_code, response.text[:180])
        raise status_error(status_code=503, detail="Voice is unavailable")
    if not response.content:
        raise status_error(status_code=503, detail="Voice is unavailable")
    return response.content


async def create_realtime_secret(
    instructions: str,
    *,
    language: str = "nl",
    voice: str | None = None,
    speed: float | None = None,
    push_to_talk: bool = False,
) -> dict[str, Any]:
    settings = get_settings()
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise status_error(status_code=503, detail="Voice is not configured")
    spoken = language if language in CALL_LANGUAGES else "nl"
    payload = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": settings.openai_realtime_model,
            "instructions": instructions,
            "tools": _TOOLS,
            "tool_choice": "auto",
            "audio": {
                "input": {
                    "transcription": {
                        "model": "whisper-1",
                        "language": spoken,
                    },
                    # Hold-to-talk commits the turn itself. Server VAD would answer mid-sentence.
                    **({"turn_detection": None} if push_to_talk else {}),
                },
                "output": {
                    "voice": normalize_voice(voice, fallback=settings.openai_realtime_voice),
                    "speed": normalize_speed(1.0 if speed is None else speed),
                },
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.warning("realtime client secret failed: %s", exc)
        raise status_error(status_code=503, detail="Voice is unavailable") from exc
    if response.status_code >= 400:
        logger.warning("realtime client secret %s", response.status_code)
        raise status_error(status_code=503, detail="Voice is unavailable")
    body = response.json()
    value = str(body.get("value") or "")
    if not value:
        raise status_error(status_code=503, detail="Voice is unavailable")
    return {"value": value, "expires_at": body.get("expires_at")}
