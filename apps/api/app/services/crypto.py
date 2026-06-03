"""App-level encryption for credentials at rest."""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.config import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    key = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:
        return value
