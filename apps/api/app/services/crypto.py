"""App-level encryption for credentials and secrets at rest."""

from __future__ import annotations

import base64
import hashlib
import json
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

# Prefix distinguishes Fernet ciphertext from legacy plaintext JSON.
_CRED_PREFIX = "enc:v1:"


@lru_cache(maxsize=1)
def _jwt_derived_fernet() -> Fernet:
    settings = get_settings()
    key = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


@lru_cache(maxsize=1)
def _credentials_fernet() -> Fernet:
    """Prefer dedicated CREDENTIALS_FERNET_KEY; fall back to JWT-derived key."""
    settings = get_settings()
    raw = (settings.credentials_fernet_key or "").strip()
    if raw:
        # Accept url-safe base64 Fernet key, or derive from arbitrary secret.
        try:
            return Fernet(raw.encode() if isinstance(raw, str) else raw)
        except Exception:
            key = hashlib.sha256(raw.encode()).digest()
            return Fernet(base64.urlsafe_b64encode(key))
    return _jwt_derived_fernet()


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _jwt_derived_fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _jwt_derived_fernet().decrypt(value.encode()).decode()
    except Exception:
        return value


def encrypt_credentials_blob(payload: dict[str, Any] | str) -> str:
    """Encrypt a credentials dict (or JSON string) for storage in credentials_json."""
    if isinstance(payload, str):
        raw = payload
    else:
        raw = json.dumps(payload)
    token = _credentials_fernet().encrypt(raw.encode()).decode()
    return f"{_CRED_PREFIX}{token}"


def decrypt_credentials_blob(stored: str | None) -> dict[str, Any]:
    """Dual-read: encrypted blob or legacy plaintext JSON object."""
    if not stored or not str(stored).strip():
        return {}
    text = str(stored).strip()
    if text.startswith(_CRED_PREFIX):
        token = text[len(_CRED_PREFIX) :]
        for factory in (_credentials_fernet, _jwt_derived_fernet):
            try:
                plain = factory().decrypt(token.encode()).decode()
                data = json.loads(plain)
                return data if isinstance(data, dict) else {}
            except (InvalidToken, json.JSONDecodeError, Exception):
                continue
        return {}
    # Legacy plaintext JSON
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def is_encrypted_credentials(stored: str | None) -> bool:
    return bool(stored and str(stored).startswith(_CRED_PREFIX))


def get_connection_credentials(conn: Any) -> dict[str, Any]:
    """Read credentials from ChannelAccount or IntegrationConnection."""
    return decrypt_credentials_blob(getattr(conn, "credentials_json", None))


def set_connection_credentials(conn: Any, payload: dict[str, Any]) -> None:
    """Write encrypted credentials onto a connection-like model.

    Also stamps non-secret readiness flags on settings_json when present so
    list serializers can avoid decrypting just to know “connected.”
    """
    conn.credentials_json = encrypt_credentials_blob(payload)
    stamp_credentials_ready(conn, payload)


def stamp_credentials_ready(conn: Any, payload: dict[str, Any] | None = None) -> None:
    """Persist connected/verified_at into settings_json without secrets.

    No-op for models without ``settings_json`` (e.g. IntegrationConnection).
    """
    if not hasattr(conn, "settings_json"):
        return
    settings_raw = getattr(conn, "settings_json", None)
    try:
        settings = json.loads(settings_raw or "{}")
        if not isinstance(settings, dict):
            settings = {}
    except (json.JSONDecodeError, TypeError):
        settings = {}

    creds = payload if isinstance(payload, dict) else get_connection_credentials(conn)
    provider = getattr(conn, "provider", "") or ""
    if provider == "smtp_imap":
        from app.services.smtp_imap import is_connected

        ready = is_connected(creds)
        if ready and not settings.get("verified_at"):
            from datetime import datetime

            settings["verified_at"] = datetime.utcnow().isoformat()
    else:
        ready = bool(creds.get("access_token") or creds.get("mock"))
    settings["connected"] = ready
    if ready and not settings.get("credentials_ready_at"):
        from datetime import datetime

        settings["credentials_ready_at"] = datetime.utcnow().isoformat()
    if not ready:
        settings.pop("credentials_ready_at", None)
    conn.settings_json = json.dumps(settings)


def credentials_ready_from_settings(settings: dict[str, Any] | None) -> bool | None:
    """Return True/False when settings has an explicit connected flag; else None."""
    if not isinstance(settings, dict):
        return None
    if "connected" not in settings:
        return None
    return bool(settings.get("connected"))
