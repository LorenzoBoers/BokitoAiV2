"""App-level encryption for credentials and secrets at rest."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

# Prefix distinguishes Fernet ciphertext from legacy plaintext JSON.
_CRED_PREFIX = "enc:v1:"


def _jwt_derived_fernet() -> Fernet:
    settings = get_settings()
    key = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


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
    """Write encrypted credentials onto a connection-like model."""
    conn.credentials_json = encrypt_credentials_blob(payload)
