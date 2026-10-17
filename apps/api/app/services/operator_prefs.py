"""Personal operator preferences stored on ``User.settings_json``."""

import json


def settings_dict(raw: str | None) -> dict:
    try:
        stored = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return stored if isinstance(stored, dict) else {}


def close_email_on_send(raw: str | dict | None) -> bool:
    """True when this person wants an email reply to close the conversation."""
    stored = raw if isinstance(raw, dict) else settings_dict(raw if isinstance(raw, str) else None)
    return stored.get("close_email_on_send") is True
