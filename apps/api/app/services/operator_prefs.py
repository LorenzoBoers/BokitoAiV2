"""Personal operator preferences stored on ``User.settings_json``."""

import json

# Post-login start page. Legacy chat/communication/overview map onto these.
DEFAULT_LANDINGS = ("new", "inbox", "agenda", "today")
_LEGACY_LANDINGS = {
    "chat": "new",
    "communication": "inbox",
    "overview": "today",
}


def settings_dict(raw: str | None) -> dict:
    try:
        stored = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return stored if isinstance(stored, dict) else {}


def normalize_default_landing(raw: object) -> str:
    """Canonical start page; unknown or empty → new chat."""
    if isinstance(raw, str):
        if raw in DEFAULT_LANDINGS:
            return raw
        mapped = _LEGACY_LANDINGS.get(raw)
        if mapped:
            return mapped
    return "new"


def close_email_on_send(raw: str | dict | None) -> bool:
    """True when this person wants an email reply to close the conversation."""
    stored = raw if isinstance(raw, dict) else settings_dict(raw if isinstance(raw, str) else None)
    return stored.get("close_email_on_send") is True
